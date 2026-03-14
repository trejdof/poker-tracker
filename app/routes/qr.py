import io
import qrcode
from flask import Blueprint, send_file
from ..database import db
from ..models.player import Player

qr_bp = Blueprint("qr", __name__)


def format_account(account: str) -> str:
    """Convert AAA-BBBBBBBBBBB-CC to 18-digit NBS format."""
    parts = account.replace(" ", "").split("-")
    if len(parts) == 3:
        bank, number, check = parts
        return f"{bank}{number.zfill(13)}{check}"
    # Already 18 digits, return as-is
    return account


@qr_bp.route("/players/<int:player_id>/qr/<int:amount>", methods=["GET"])
def generate_qr(player_id, amount):
    player = db.get_or_404(Player, player_id)

    account = format_account(player.bank_account)
    nbs_string = (
        f"K:PR|V:01|C:1"
        f"|R:{account}"
        f"|N:{player.name}"
        f"|I:RSD{amount},"
        f"|SF:289"
    )

    print("QR STRING:", nbs_string)
    img = qrcode.make(nbs_string)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")
