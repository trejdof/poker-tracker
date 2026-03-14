from ..database import db


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False)
    from_player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    to_player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    confirmed = db.Column(db.Boolean, nullable=False, default=False)

    def to_dict(self):
        from .player import Player
        from_player = db.session.get(Player, self.from_player_id)
        to_player = db.session.get(Player, self.to_player_id)
        return {
            "id": self.id,
            "session_id": self.session_id,
            "from_player_id": self.from_player_id,
            "from_player_name": from_player.name,
            "to_player_id": self.to_player_id,
            "to_player_name": to_player.name,
            "to_bank_account": to_player.bank_account,
            "amount": self.amount,
            "confirmed": self.confirmed,
        }
