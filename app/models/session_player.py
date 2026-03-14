from ..database import db


class SessionPlayer(db.Model):
    __tablename__ = "session_players"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)

    buyins = db.relationship("Buyin", backref="session_player", lazy=True, cascade="all, delete-orphan")

    def total_buyin(self):
        return sum(b.amount for b in self.buyins)

    def to_dict(self):
        from .player import Player
        player = db.session.get(Player, self.player_id)
        return {
            "id": self.id,
            "session_id": self.session_id,
            "player_id": self.player_id,
            "player_name": player.name,
            "total_buyin": self.total_buyin(),
            "buyins": [b.to_dict() for b in self.buyins],
        }
