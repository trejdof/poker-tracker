from flask import Blueprint, jsonify
from ..database import db
from ..models.transaction import Transaction
from ..models.player import Player

transactions_bp = Blueprint("transactions", __name__)


@transactions_bp.route("/transactions/<int:transaction_id>/confirm", methods=["POST"])
def confirm_transaction(transaction_id):
    t = db.get_or_404(Transaction, transaction_id)
    if t.confirmed:
        return jsonify({"error": "Already confirmed"}), 400

    t.confirmed = True

    # Update total_balance: payer loses, receiver gains
    from_player = db.session.get(Player, t.from_player_id)
    to_player = db.session.get(Player, t.to_player_id)
    from_player.total_balance -= t.amount
    to_player.total_balance += t.amount

    db.session.commit()
    return jsonify(t.to_dict())


@transactions_bp.route("/transactions/<int:transaction_id>/unconfirm", methods=["POST"])
def unconfirm_transaction(transaction_id):
    t = db.get_or_404(Transaction, transaction_id)
    if not t.confirmed:
        return jsonify({"error": "Not confirmed"}), 400

    t.confirmed = False

    from_player = db.session.get(Player, t.from_player_id)
    to_player = db.session.get(Player, t.to_player_id)
    from_player.total_balance += t.amount
    to_player.total_balance -= t.amount

    db.session.commit()
    return jsonify(t.to_dict())
