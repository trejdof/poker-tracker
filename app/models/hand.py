from ..database import db
from datetime import datetime, timezone


class Hand(db.Model):
    __tablename__ = "hands"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False)
    button_session_player_id = db.Column(db.Integer, db.ForeignKey("session_players.id"), nullable=False)
    status = db.Column(db.String(10), nullable=False, default="open")  # open, closed
    carry_over = db.Column(db.Integer, nullable=False, default=0)
    remainder = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=True)

    bets = db.relationship("HandBet", backref="hand", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "button_session_player_id": self.button_session_player_id,
            "status": self.status,
            "carry_over": self.carry_over,
            "remainder": self.remainder,
        }
