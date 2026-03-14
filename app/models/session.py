from ..database import db
from datetime import datetime, timezone


class Session(db.Model):
    __tablename__ = "sessions"

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(20), nullable=False)  # 'cash' or 'tournament'
    status = db.Column(db.String(10), nullable=False, default="waiting")  # waiting, open, closed
    default_buyin = db.Column(db.Integer, nullable=False, default=0)
    started_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "default_buyin": self.default_buyin,
            "started_at": self.started_at.isoformat() if self.started_at else None,
        }
