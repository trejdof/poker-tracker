import json
import time
from flask import Blueprint, jsonify, request, Response, stream_with_context
from datetime import datetime, timezone
from ..database import db
from ..models.session import Session
from ..models.session_player import SessionPlayer
from ..models.player import Player
from ..models.hand import Hand
from ..models.hand_bet import HandBet
from ..models.buyin import Buyin
from ..models.transaction import Transaction
from ..utils.settlement import calculate_settlement

no_chips_bp = Blueprint("no_chips", __name__)


def _player_order(session_id):
    return SessionPlayer.query.filter_by(session_id=session_id).order_by(SessionPlayer.position, SessionPlayer.id).all()


def _positions(sp_ids, btn_idx):
    """Return (btn_idx, sb_idx, bb_idx) handling heads-up rule."""
    n = len(sp_ids)
    if n < 2:
        return btn_idx, btn_idx, btn_idx
    if n == 2:
        sb_idx = btn_idx
        bb_idx = (btn_idx + 1) % n
    else:
        sb_idx = (btn_idx + 1) % n
        bb_idx = (btn_idx + 2) % n
    return btn_idx, sb_idx, bb_idx


def get_game_state(session_id):
    session = db.session.get(Session, session_id)
    if not session:
        return None

    players = _player_order(session_id)
    sp_ids = [sp.id for sp in players]

    current_hand = Hand.query.filter_by(session_id=session_id).order_by(Hand.id.desc()).first()
    hand_count = Hand.query.filter_by(session_id=session_id).count()

    # Build player data
    player_data = []
    for sp in players:
        player = db.session.get(Player, sp.player_id)
        all_bets = (HandBet.query
                    .join(Hand)
                    .filter(Hand.session_id == session_id, HandBet.session_player_id == sp.id)
                    .all())
        hand_net = sum(b.amount for b in all_bets)

        buyins = Buyin.query.filter_by(session_player_id=sp.id).all()
        chips_in = sum(b.amount for b in buyins if b.type in ("buyin", "rebuy", "transfer_in"))
        chips_out = sum(b.amount for b in buyins if b.type in ("cashout", "transfer_out"))
        stack = chips_in - chips_out + hand_net

        current_hand_bets = []
        if current_hand and current_hand.status == "open":
            hand_bets = (HandBet.query
                         .filter_by(hand_id=current_hand.id, session_player_id=sp.id)
                         .order_by(HandBet.id)
                         .all())
            current_hand_bets = [{"id": b.id, "amount": b.amount, "type": b.type} for b in hand_bets]

        player_data.append({
            "session_player_id": sp.id,
            "player_id": sp.player_id,
            "player_name": player.name,
            "chips_in": chips_in,
            "chips_out": chips_out,
            "hand_net": hand_net,
            "stack": stack,
            "afk": sp.afk,
            "current_hand_bets": current_hand_bets,
        })

    # Build hand data
    hand_data = None
    if current_hand:
        if sp_ids and current_hand.button_session_player_id in sp_ids:
            btn_idx = sp_ids.index(current_hand.button_session_player_id)
        else:
            btn_idx = 0
        _, sb_idx, bb_idx = _positions(sp_ids, btn_idx)

        if current_hand.status == "open":
            all_bets = HandBet.query.filter_by(hand_id=current_hand.id).all()
            neg_sum = sum(b.amount for b in all_bets if b.amount < 0)
            pot = abs(neg_sum) + current_hand.carry_over
            hand_data = {
                "id": current_hand.id,
                "status": "open",
                "pot": pot,
                "carry_over": current_hand.carry_over,
                "button_sp_id": current_hand.button_session_player_id,
                "sb_sp_id": sp_ids[sb_idx] if sp_ids else None,
                "bb_sp_id": sp_ids[bb_idx] if sp_ids else None,
                "next_button_sp_id": None,
                "next_sb_sp_id": None,
                "next_bb_sp_id": None,
            }
        else:
            # Between hands — compute next positions using only active (non-AFK) players
            afk_ids = {sp.id for sp in players if sp.afk}
            active_ids = [sid for sid in sp_ids if sid not in afk_ids]
            if active_ids:
                # Advance button to next active player after last button
                n_all = len(sp_ids)
                next_btn_id = active_ids[0]
                for i in range(1, n_all + 1):
                    candidate = sp_ids[(btn_idx + i) % n_all]
                    if candidate in active_ids:
                        next_btn_id = candidate
                        break
                next_btn_active_idx = active_ids.index(next_btn_id)
                _, next_sb_active_idx, next_bb_active_idx = _positions(active_ids, next_btn_active_idx)
                next_sb_id = active_ids[next_sb_active_idx]
                next_bb_id = active_ids[next_bb_active_idx]
            else:
                next_btn_id = next_sb_id = next_bb_id = None
            hand_data = {
                "id": current_hand.id,
                "status": "closed",
                "pot": current_hand.remainder,
                "carry_over": current_hand.remainder,
                "button_sp_id": current_hand.button_session_player_id,
                "sb_sp_id": sp_ids[sb_idx] if sp_ids else None,
                "bb_sp_id": sp_ids[bb_idx] if sp_ids else None,
                "next_button_sp_id": next_btn_id,
                "next_sb_sp_id": next_sb_id,
                "next_bb_sp_id": next_bb_id,
            }

    return {
        "session_id": session_id,
        "status": session.status,
        "name": session.name,
        "small_blind": session.small_blind,
        "big_blind": session.big_blind,
        "current_hand": hand_data,
        "players": player_data,
        "hand_number": hand_count,
    }


@no_chips_bp.route("/sessions/<int:session_id>/reorder-players", methods=["POST"])
def reorder_players(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400
    # Only allow reorder before any hand has been started
    if Hand.query.filter_by(session_id=session_id).count() > 0:
        return jsonify({"error": "Cannot reorder after hands have started"}), 400

    data = request.get_json()
    ordered_ids = data.get("session_player_ids", [])

    players = {sp.id: sp for sp in SessionPlayer.query.filter_by(session_id=session_id).all()}
    if set(ordered_ids) != set(players.keys()):
        return jsonify({"error": "Must include all session player IDs"}), 400

    for pos, sp_id in enumerate(ordered_ids):
        players[sp_id].position = pos

    db.session.commit()
    return jsonify({"ok": True})


@no_chips_bp.route("/sessions/<int:session_id>/no-chips-buyin", methods=["POST"])
def no_chips_buyin(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400

    data = request.get_json()
    session_player_id = data.get("session_player_id")
    amount = data.get("amount")
    type_ = data.get("type", "buyin")

    if not session_player_id or not amount or int(amount) <= 0:
        return jsonify({"error": "session_player_id and positive amount required"}), 400
    if type_ not in ("buyin", "rebuy", "cashout"):
        return jsonify({"error": "type must be buyin, rebuy, or cashout"}), 400

    sp = db.get_or_404(SessionPlayer, session_player_id)
    if sp.session_id != session_id:
        return jsonify({"error": "Player not in this session"}), 400

    db.session.add(Buyin(session_player_id=session_player_id, amount=int(amount), type=type_))
    db.session.commit()
    return jsonify({"ok": True}), 201


@no_chips_bp.route("/sessions/<int:session_id>/set-afk", methods=["POST"])
def set_afk(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400
    data = request.get_json()
    session_player_id = data.get("session_player_id")
    if not session_player_id:
        return jsonify({"error": "session_player_id required"}), 400
    sp = db.get_or_404(SessionPlayer, session_player_id)
    if sp.session_id != session_id:
        return jsonify({"error": "Player not in this session"}), 400
    sp.afk = not sp.afk
    db.session.commit()
    return jsonify({"afk": sp.afk})


@no_chips_bp.route("/sessions/<int:session_id>/undo-buyin", methods=["POST"])
def undo_buyin(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400

    data = request.get_json()
    session_player_id = data.get("session_player_id")
    if not session_player_id:
        return jsonify({"error": "session_player_id required"}), 400

    sp = db.get_or_404(SessionPlayer, session_player_id)
    if sp.session_id != session_id:
        return jsonify({"error": "Player not in this session"}), 400

    last = Buyin.query.filter_by(session_player_id=session_player_id).order_by(Buyin.id.desc()).first()
    if not last:
        return jsonify({"error": "No buy-in to undo"}), 400

    db.session.delete(last)
    db.session.commit()
    return jsonify({"ok": True})


@no_chips_bp.route("/sessions/<int:session_id>/revert-last-hand", methods=["POST"])
def revert_last_hand(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400

    # Must have no currently open hand
    open_hand = Hand.query.filter_by(session_id=session_id, status="open").first()
    if open_hand:
        return jsonify({"error": "End the current hand first"}), 400

    last_hand = Hand.query.filter_by(session_id=session_id).order_by(Hand.id.desc()).first()
    if not last_hand or last_hand.status != "closed":
        return jsonify({"error": "No completed hand to revert"}), 400

    # Delete win bets from this hand
    HandBet.query.filter_by(hand_id=last_hand.id, type="win").delete()
    last_hand.status = "open"
    last_hand.remainder = 0
    db.session.commit()
    return jsonify({"ok": True})


@no_chips_bp.route("/sessions/<int:session_id>/no-chips-state", methods=["GET"])
def get_state(session_id):
    state = get_game_state(session_id)
    if not state:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(state)


@no_chips_bp.route("/sessions/<int:session_id>/stream")
def stream(session_id):
    def generate():
        last_json = None
        heartbeat = 0
        while True:
            try:
                db.session.remove()
                state = get_game_state(session_id)
                if state:
                    state_json = json.dumps(state, sort_keys=True)
                    if state_json != last_json:
                        last_json = state_json
                        yield f"data: {state_json}\n\n"
                heartbeat += 1
                if heartbeat >= 30:  # keepalive every ~15s
                    heartbeat = 0
                    yield ": keepalive\n\n"
                time.sleep(0.5)
            except GeneratorExit:
                db.session.remove()
                break
            except Exception:
                db.session.remove()
                time.sleep(1)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@no_chips_bp.route("/sessions/<int:session_id>/start-no-chips", methods=["POST"])
def start_no_chips_session(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400
    if session.status != "waiting":
        return jsonify({"error": "Session already started"}), 400
    players = _player_order(session_id)
    if len(players) < 2:
        return jsonify({"error": "Need at least 2 players to start"}), 400
    session.status = "open"
    session.started_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(session.to_dict())


@no_chips_bp.route("/sessions/<int:session_id>/finalize-no-chips", methods=["POST"])
def finalize_no_chips(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400
    if session.status != "open":
        return jsonify({"error": "Session is not open"}), 400

    open_hand = Hand.query.filter_by(session_id=session_id, status="open").first()
    if open_hand:
        return jsonify({"error": "End the current hand before finishing the game"}), 400

    players = _player_order(session_id)

    net_balances = {}
    for sp in players:
        all_bets = (HandBet.query
                    .join(Hand)
                    .filter(Hand.session_id == session_id, HandBet.session_player_id == sp.id)
                    .all())
        net_balances[sp.player_id] = sum(b.amount for b in all_bets)

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
        "session_id": session_id,
        "transactions": [t.to_dict() for t in saved],
        "net_balances": [
            {"player_id": pid, "player_name": db.session.get(Player, pid).name, "net": net}
            for pid, net in net_balances.items()
        ]
    })


@no_chips_bp.route("/sessions/<int:session_id>/hands", methods=["POST"])
def start_hand(session_id):
    session = db.get_or_404(Session, session_id)
    if session.type != "no_chips":
        return jsonify({"error": "Not a no-chips session"}), 400
    if session.status != "open":
        return jsonify({"error": "Session is not open"}), 400

    open_hand = Hand.query.filter_by(session_id=session_id, status="open").first()
    if open_hand:
        return jsonify({"error": "A hand is already in progress"}), 400

    all_players = _player_order(session_id)
    active_players = [sp for sp in all_players if not sp.afk]
    if len(active_players) < 2:
        return jsonify({"error": "Need at least 2 active players"}), 400

    all_sp_ids = [sp.id for sp in all_players]
    active_sp_ids = [sp.id for sp in active_players]
    last_hand = Hand.query.filter_by(session_id=session_id).order_by(Hand.id.desc()).first()
    carry_over = 0

    if last_hand is None:
        btn_sp_id = active_sp_ids[0]
    else:
        carry_over = last_hand.remainder
        last_btn = last_hand.button_session_player_id
        if last_btn in all_sp_ids:
            prev_idx = all_sp_ids.index(last_btn)
            n_all = len(all_sp_ids)
            btn_sp_id = active_sp_ids[0]
            for i in range(1, n_all + 1):
                candidate = all_sp_ids[(prev_idx + i) % n_all]
                if candidate in active_sp_ids:
                    btn_sp_id = candidate
                    break
        else:
            btn_sp_id = active_sp_ids[0]

    # Reset AFK flags now that we've determined who plays this hand
    for sp in all_players:
        if sp.afk:
            sp.afk = False

    btn_idx = active_sp_ids.index(btn_sp_id)
    sp_ids = active_sp_ids
    _, sb_idx, bb_idx = _positions(sp_ids, btn_idx)

    hand = Hand(
        session_id=session_id,
        button_session_player_id=btn_sp_id,
        status="open",
        carry_over=carry_over,
        remainder=0,
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(hand)
    db.session.flush()

    db.session.add(HandBet(hand_id=hand.id, session_player_id=sp_ids[sb_idx], amount=-session.small_blind, type="blind_sb"))
    db.session.add(HandBet(hand_id=hand.id, session_player_id=sp_ids[bb_idx], amount=-session.big_blind, type="blind_bb"))
    db.session.commit()
    return jsonify(hand.to_dict()), 201


@no_chips_bp.route("/sessions/<int:session_id>/hands/<int:hand_id>/bet", methods=["POST"])
def place_bet(session_id, hand_id):
    hand = db.get_or_404(Hand, hand_id)
    if hand.session_id != session_id:
        return jsonify({"error": "Hand not in this session"}), 400
    if hand.status != "open":
        return jsonify({"error": "Hand is not open"}), 400

    data = request.get_json()
    session_player_id = data.get("session_player_id")
    amount = data.get("amount")

    if not session_player_id or not amount or int(amount) <= 0:
        return jsonify({"error": "session_player_id and positive amount required"}), 400

    sp = db.get_or_404(SessionPlayer, session_player_id)
    if sp.session_id != session_id:
        return jsonify({"error": "Player not in this session"}), 400

    # Enforce stack limit if player has bought in
    buyins = Buyin.query.filter_by(session_player_id=session_player_id).all()
    chips_in = sum(b.amount for b in buyins if b.type in ("buyin", "rebuy", "transfer_in"))
    if chips_in > 0:
        chips_out = sum(b.amount for b in buyins if b.type in ("cashout", "transfer_out"))
        all_bets = (HandBet.query.join(Hand)
                    .filter(Hand.session_id == session_id, HandBet.session_player_id == session_player_id)
                    .all())
        hand_net = sum(b.amount for b in all_bets)
        current_stack = chips_in - chips_out + hand_net
        if int(amount) > current_stack:
            return jsonify({"error": f"Bet exceeds your stack ({current_stack})"}), 400

    db.session.add(HandBet(hand_id=hand_id, session_player_id=session_player_id, amount=-int(amount), type="bet"))
    db.session.commit()
    return jsonify({"ok": True}), 201


@no_chips_bp.route("/sessions/<int:session_id>/hands/<int:hand_id>/revert", methods=["POST"])
def revert_last_bet(session_id, hand_id):
    hand = db.get_or_404(Hand, hand_id)
    if hand.session_id != session_id:
        return jsonify({"error": "Hand not in this session"}), 400
    if hand.status != "open":
        return jsonify({"error": "Hand is not open"}), 400

    data = request.get_json()
    session_player_id = data.get("session_player_id")
    if not session_player_id:
        return jsonify({"error": "session_player_id required"}), 400

    last_bet = (HandBet.query
                .filter_by(hand_id=hand_id, session_player_id=session_player_id, type="bet")
                .order_by(HandBet.id.desc())
                .first())
    if not last_bet:
        return jsonify({"error": "No bet to revert"}), 400

    db.session.delete(last_bet)
    db.session.commit()
    return jsonify({"ok": True})


@no_chips_bp.route("/sessions/<int:session_id>/hands/<int:hand_id>/end", methods=["POST"])
def end_hand(session_id, hand_id):
    hand = db.get_or_404(Hand, hand_id)
    if hand.session_id != session_id:
        return jsonify({"error": "Hand not in this session"}), 400
    if hand.status != "open":
        return jsonify({"error": "Hand is not open"}), 400

    data = request.get_json()
    winner_ids = data.get("winner_session_player_ids", [])
    if not winner_ids:
        return jsonify({"error": "At least one winner required"}), 400

    for wid in winner_ids:
        sp = db.session.get(SessionPlayer, wid)
        if not sp or sp.session_id != session_id:
            return jsonify({"error": f"Invalid winner id {wid}"}), 400

    all_bets = HandBet.query.filter_by(hand_id=hand_id).all()
    neg_sum = sum(b.amount for b in all_bets if b.amount < 0)
    pot = abs(neg_sum) + hand.carry_over

    per_winner = pot // len(winner_ids)
    remainder = pot % len(winner_ids)

    for wid in winner_ids:
        db.session.add(HandBet(hand_id=hand_id, session_player_id=wid, amount=per_winner, type="win"))

    hand.status = "closed"
    hand.remainder = remainder
    db.session.commit()
    return jsonify({"ok": True, "pot": pot, "per_winner": per_winner, "remainder": remainder})
