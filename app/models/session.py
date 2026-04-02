from ..database import db
from datetime import datetime, timezone


class Session(db.Model):
    __tablename__ = "sessions"

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(20), nullable=False)  # 'cash', 'tournament', 'no_chips'
    status = db.Column(db.String(10), nullable=False, default="waiting")  # waiting, open, closed
    default_buyin = db.Column(db.Integer, nullable=False, default=0)
    small_blind = db.Column(db.Integer, nullable=False, default=5)
    big_blind = db.Column(db.Integer, nullable=False, default=10)
    started_at = db.Column(db.DateTime, nullable=True)
    ended_at = db.Column(db.DateTime, nullable=True)
    deleted = db.Column(db.Boolean, nullable=False, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "default_buyin": self.default_buyin,
            "small_blind": self.small_blind,
            "big_blind": self.big_blind,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "deleted": self.deleted,
        }
