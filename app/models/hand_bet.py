from ..database import db


class HandBet(db.Model):
    __tablename__ = "hand_bets"

    id = db.Column(db.Integer, primary_key=True)
    hand_id = db.Column(db.Integer, db.ForeignKey("hands.id"), nullable=False)
    session_player_id = db.Column(db.Integer, db.ForeignKey("session_players.id"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)  # negative = bet/blind, positive = win
    type = db.Column(db.String(20), nullable=False, default="bet")  # blind_sb, blind_bb, bet, win

    def to_dict(self):
        return {
            "id": self.id,
            "hand_id": self.hand_id,
            "session_player_id": self.session_player_id,
            "amount": self.amount,
            "type": self.type,
        }
