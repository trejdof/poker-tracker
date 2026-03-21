from flask import Blueprint, jsonify, request
from ..database import db
from ..models.player import Player
from ..models.transaction import Transaction

players_bp = Blueprint("players", __name__)


@players_bp.route("/players", methods=["GET"])
def get_players():
    players = Player.query.all()
    result = []
    for p in players:
        d = p.to_dict()
        pending_debt = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.from_player_id == p.id,
            Transaction.confirmed == False
        ).scalar() or 0
        pending_receivable = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.to_player_id == p.id,
            Transaction.confirmed == False
        ).scalar() or 0
        d["pending_debt"] = pending_debt
        d["pending_receivable"] = pending_receivable
        result.append(d)
    return jsonify(result)


@players_bp.route("/players", methods=["POST"])
def create_player():
    data = request.get_json()
    name = data.get("name", "").strip()
    bank_account = data.get("bank_account", "").strip()

    if not name or not bank_account:
        return jsonify({"error": "name and bank_account are required"}), 400
    if not bank_account.isdigit() or len(bank_account) != 18:
        return jsonify({"error": "Bank account must be exactly 18 digits"}), 400

    if Player.query.filter_by(name=name).first():
        return jsonify({"error": "Player with this name already exists"}), 409

    player = Player(name=name, bank_account=bank_account)
    db.session.add(player)
    db.session.commit()
    return jsonify(player.to_dict()), 201


@players_bp.route("/players/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    player = db.get_or_404(Player, player_id)
    data = request.get_json()

    if "name" in data:
        player.name = data["name"].strip()
    if "bank_account" in data:
        ba = data["bank_account"].strip()
        if not ba.isdigit() or len(ba) != 18:
            return jsonify({"error": "Bank account must be exactly 18 digits"}), 400
        player.bank_account = ba

    db.session.commit()
    return jsonify(player.to_dict())


@players_bp.route("/players/<int:player_id>", methods=["DELETE"])
def delete_player(player_id):
    player = db.get_or_404(Player, player_id)
    db.session.delete(player)
    db.session.commit()
    return jsonify({"message": f"Player '{player.name}' deleted"})


@players_bp.route("/players/<string:player_name>/profile", methods=["GET"])
def get_player_profile(player_name):
    from ..models.session import Session
    from ..models.session_player import SessionPlayer

    player = Player.query.filter_by(name=player_name).first_or_404()

    session_players = SessionPlayer.query.filter_by(player_id=player.id).all()
    games = []
    for sp in session_players:
        sess = db.session.get(Session, sp.session_id)
        if not sess or sess.status != "closed" or sess.deleted:
            continue

        paid = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.session_id == sess.id,
            Transaction.from_player_id == player.id,
            Transaction.confirmed == True
        ).scalar() or 0
        received = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.session_id == sess.id,
            Transaction.to_player_id == player.id,
            Transaction.confirmed == True
        ).scalar() or 0

        games.append({
            "session_id": sess.id,
            "type": sess.type,
            "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
            "total_buyin": sp.total_buyin(),
            "net": received - paid,
        })

    games.sort(key=lambda x: x["ended_at"] or "")

    pending_debt = db.session.query(db.func.sum(Transaction.amount)).filter(
        Transaction.from_player_id == player.id,
        Transaction.confirmed == False
    ).scalar() or 0
    pending_receivable = db.session.query(db.func.sum(Transaction.amount)).filter(
        Transaction.to_player_id == player.id,
        Transaction.confirmed == False
    ).scalar() or 0

    return jsonify({
        "player": {**player.to_dict(), "pending_debt": pending_debt, "pending_receivable": pending_receivable},
        "games": games,
    })
