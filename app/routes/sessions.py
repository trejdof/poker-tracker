from flask import Blueprint, jsonify, request
from datetime import datetime, timezone
from ..database import db
from ..models.session import Session
from ..models.session_player import SessionPlayer
from ..models.buyin import Buyin
from ..models.player import Player
from ..models.transaction import Transaction
from ..utils.settlement import calculate_settlement

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.route("/sessions", methods=["GET"])
def get_sessions():
    sessions = Session.query.filter_by(deleted=False).order_by(Session.id.desc()).all()
    result = []
    for s in sessions:
        d = s.to_dict()
        if s.status == "closed":
            unconfirmed = Transaction.query.filter_by(session_id=s.id, confirmed=False).count()
            d["unconfirmed_count"] = unconfirmed
        else:
            d["unconfirmed_count"] = 0
        result.append(d)
    return jsonify(result)


@sessions_bp.route("/sessions/deleted", methods=["GET"])
def get_deleted_sessions():
    sessions = Session.query.filter_by(deleted=True).order_by(Session.id.desc()).all()
    return jsonify([s.to_dict() for s in sessions])


@sessions_bp.route("/sessions", methods=["POST"])
def create_session():
    data = request.get_json()
    type_ = data.get("type", "").strip()

    if type_ not in ("cash", "tournament", "no_chips"):
        return jsonify({"error": "type must be 'cash', 'tournament', or 'no_chips'"}), 400

    default_buyin = int(data.get("default_buyin", 0))
    small_blind = int(data.get("small_blind", 5))
    big_blind = int(data.get("big_blind", 10))
    session = Session(type=type_, default_buyin=default_buyin, small_blind=small_blind, big_blind=big_blind)
    db.session.add(session)
    db.session.commit()
    return jsonify(session.to_dict()), 201


@sessions_bp.route("/sessions/<int:session_id>", methods=["GET"])
def get_session(session_id):
    session = db.get_or_404(Session, session_id)
    players = SessionPlayer.query.filter_by(session_id=session_id).all()
    data = session.to_dict()
    data["players"] = [p.to_dict() for p in players]
    data["total_chips"] = sum(p.total_buyin() for p in players)
    return jsonify(data)


@sessions_bp.route("/sessions/<int:session_id>/start", methods=["POST"])
def start_session(session_id):
    session = db.get_or_404(Session, session_id)
    if session.status != "waiting":
        return jsonify({"error": "Session already started"}), 400
    session.status = "open"
    session.started_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(session.to_dict())


@sessions_bp.route("/sessions/<int:session_id>/finalize", methods=["POST"])
def finalize_session(session_id):
    session = db.get_or_404(Session, session_id)
    if session.status != "open":
        return jsonify({"error": "Session is not open"}), 400

    data = request.get_json()
    final_stacks = data.get("final_stacks", [])

    session_players = SessionPlayer.query.filter_by(session_id=session_id).all()
    sp_map = {sp.id: sp for sp in session_players}

    if len(final_stacks) != len(session_players):
        return jsonify({"error": "Final stack required for every player"}), 400

    # Calculate net per player
    net_balances = {}
    for entry in final_stacks:
        sp_id = entry["session_player_id"]
        final_chips = int(entry["final_chips"])
        sp = sp_map.get(sp_id)
        if not sp:
            return jsonify({"error": f"Invalid session_player_id {sp_id}"}), 400
        net = final_chips - sp.total_buyin()
        net_balances[sp.player_id] = net

    # Save transactions (unconfirmed — balance updated on confirm)
    raw_transactions = calculate_settlement(net_balances)
    saved = []
    for from_id, to_id, amount in raw_transactions:
        t = Transaction(session_id=session_id, from_player_id=from_id, to_player_id=to_id, amount=amount, confirmed=False)
        db.session.add(t)
        saved.append(t)

    session.status = "closed"
    session.ended_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({
        "transactions": [t.to_dict() for t in saved],
        "net_balances": [
            {"player_id": pid, "player_name": db.session.get(Player, pid).name, "net": net}
            for pid, net in net_balances.items()
        ]
    })


@sessions_bp.route("/sessions/<int:session_id>/unfinalize", methods=["POST"])
def unfinalize_session(session_id):
    session = db.get_or_404(Session, session_id)
    if session.status != "closed":
        return jsonify({"error": "Session is not closed"}), 400

    transactions = Transaction.query.filter_by(session_id=session_id).all()
    if any(t.confirmed for t in transactions):
        return jsonify({"error": "Cannot reopen — some payments are already confirmed"}), 400

    for t in transactions:
        db.session.delete(t)

    session.status = "open"
    session.ended_at = None
    db.session.commit()
    return jsonify(session.to_dict())


@sessions_bp.route("/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    session = db.get_or_404(Session, session_id)
    if session.deleted:
        return jsonify({"error": "Already deleted"}), 400

    # Reverse confirmed transaction effects on player balances
    transactions = Transaction.query.filter_by(session_id=session_id).all()
    for t in transactions:
        if t.confirmed:
            from_player = db.session.get(Player, t.from_player_id)
            to_player = db.session.get(Player, t.to_player_id)
            from_player.total_balance += t.amount
            to_player.total_balance -= t.amount

    session.deleted = True
    db.session.commit()
    return jsonify({"message": "Game deleted"})


@sessions_bp.route("/sessions/<int:session_id>/restore", methods=["POST"])
def restore_session(session_id):
    session = db.get_or_404(Session, session_id)
    if not session.deleted:
        return jsonify({"error": "Game is not deleted"}), 400

    # Re-apply confirmed transaction effects on player balances
    transactions = Transaction.query.filter_by(session_id=session_id).all()
    for t in transactions:
        if t.confirmed:
            from_player = db.session.get(Player, t.from_player_id)
            to_player = db.session.get(Player, t.to_player_id)
            from_player.total_balance -= t.amount
            to_player.total_balance += t.amount

    session.deleted = False
    db.session.commit()
    return jsonify({"message": "Game restored"})


@sessions_bp.route("/sessions/<int:session_id>/settlement", methods=["GET"])
def get_settlement(session_id):
    session = db.get_or_404(Session, session_id)
    if session.status != "closed":
        return jsonify({"error": "Session is not closed"}), 400

    transactions = Transaction.query.filter_by(session_id=session_id).all()
    session_players = SessionPlayer.query.filter_by(session_id=session_id).all()

    net_balances = []
    for sp in session_players:
        player = db.session.get(Player, sp.player_id)
        # Net = sum of amounts received - sum of amounts paid for this session
        paid = sum(t.amount for t in transactions if t.from_player_id == sp.player_id)
        received = sum(t.amount for t in transactions if t.to_player_id == sp.player_id)
        net_balances.append({
            "player_id": sp.player_id,
            "player_name": player.name,
            "net": received - paid
        })

    return jsonify({
        "session": session.to_dict(),
        "transactions": [t.to_dict() for t in transactions],
        "net_balances": net_balances
    })


@sessions_bp.route("/sessions/<int:session_id>/activity", methods=["GET"])
def get_session_activity(session_id):
    session_players = SessionPlayer.query.filter_by(session_id=session_id).all()
    raw = []
    for sp in session_players:
        player = db.session.get(Player, sp.player_id)
        for b in sp.buyins:
            raw.append({"id": b.id, "player_name": player.name, "amount": b.amount, "type": b.type})

    # Pair transfer_out with transfer_in by closest ID and matching amount
    transfer_outs = [e for e in raw if e["type"] == "transfer_out"]
    transfer_ins  = [e for e in raw if e["type"] == "transfer_in"]
    used_ids = set()
    transfers = []
    for out in sorted(transfer_outs, key=lambda x: x["id"]):
        candidates = [e for e in transfer_ins if e["amount"] == abs(out["amount"]) and e["id"] not in used_ids]
        if candidates:
            best = min(candidates, key=lambda x: abs(x["id"] - out["id"]))
            used_ids.add(out["id"])
            used_ids.add(best["id"])
            transfers.append({
                "id": min(out["id"], best["id"]),
                "type": "transfer",
                "from_player": out["player_name"],
                "to_player": best["player_name"],
                "amount": abs(out["amount"]),
            })

    label_map = {"buyin": "Buy-in", "rebuy": "Re-buy", "cashout": "Cash Out"}
    entries = []
    for e in raw:
        if e["id"] in used_ids:
            continue
        entries.append({"id": e["id"], "type": e["type"], "player_name": e["player_name"],
                        "amount": e["amount"], "label": label_map.get(e["type"], e["type"])})
    entries += transfers
    entries.sort(key=lambda x: x["id"], reverse=True)
    return jsonify(entries)


@sessions_bp.route("/sessions/<int:session_id>/players", methods=["POST"])
def add_player(session_id):
    session = db.get_or_404(Session, session_id)
    if session.status not in ("waiting", "open"):
        return jsonify({"error": "Session is closed"}), 400

    data = request.get_json()
    player_id = data.get("player_id")
    amount = data.get("amount")

    if not player_id:
        return jsonify({"error": "player_id is required"}), 400

    is_no_chips = session.type == "no_chips"
    if not is_no_chips and (not amount or int(amount) <= 0):
        return jsonify({"error": "player_id and amount are required"}), 400

    db.get_or_404(Player, player_id)

    existing = SessionPlayer.query.filter_by(session_id=session_id, player_id=player_id).first()
    if existing:
        return jsonify({"error": "Player already in session"}), 409

    sp = SessionPlayer(session_id=session_id, player_id=player_id)
    db.session.add(sp)
    db.session.flush()

    if not is_no_chips:
        buyin = Buyin(session_player_id=sp.id, amount=int(amount))
        db.session.add(buyin)

    db.session.commit()
    return jsonify(sp.to_dict()), 201


@sessions_bp.route("/sessions/<int:session_id>/players/<int:session_player_id>", methods=["DELETE"])
def remove_player(session_id, session_player_id):
    session = db.get_or_404(Session, session_id)
    if session.status != "waiting":
        return jsonify({"error": "Can only remove players before the game starts"}), 400
    sp = db.get_or_404(SessionPlayer, session_player_id)
    db.session.delete(sp)
    db.session.commit()
    return jsonify({"message": "Player removed"})


@sessions_bp.route("/sessions/<int:session_id>/players/<int:session_player_id>/buyin", methods=["POST"])
def add_buyin(session_id, session_player_id):
    session = db.get_or_404(Session, session_id)
    if session.status == "closed":
        return jsonify({"error": "Session is closed"}), 400

    sp = db.get_or_404(SessionPlayer, session_player_id)
    data = request.get_json()
    amount = data.get("amount")
    type_ = data.get("type", "buyin")

    if not amount or int(amount) == 0:
        return jsonify({"error": "Valid amount is required"}), 400

    buyin = Buyin(session_player_id=sp.id, amount=int(amount), type=type_)
    db.session.add(buyin)
    db.session.commit()
    return jsonify(sp.to_dict()), 201
