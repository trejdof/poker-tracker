from ..database import db


class Buyin(db.Model):
    __tablename__ = "buyins"

    id = db.Column(db.Integer, primary_key=True)
    session_player_id = db.Column(db.Integer, db.ForeignKey("session_players.id"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "session_player_id": self.session_player_id,
            "amount": self.amount,
        }
