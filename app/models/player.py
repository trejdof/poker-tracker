from ..database import db


class Player(db.Model):
    __tablename__ = "players"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    bank_account = db.Column(db.String(18), nullable=False)
    total_balance = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "bank_account": self.bank_account,
            "total_balance": self.total_balance,
        }
