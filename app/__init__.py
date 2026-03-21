import os
from flask import Flask, render_template, session as flask_session, request, redirect, url_for, jsonify
from .database import db


def create_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///poker.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me-in-production")
    app.config["APP_PASSWORD"] = os.environ.get("APP_PASSWORD", "poker123")

    db.init_app(app)

    from .routes.players import players_bp
    from .routes.qr import qr_bp
    from .routes.sessions import sessions_bp
    from .routes.transactions import transactions_bp
    app.register_blueprint(players_bp, url_prefix="/api")
    app.register_blueprint(qr_bp, url_prefix="/api")
    app.register_blueprint(sessions_bp, url_prefix="/api")
    app.register_blueprint(transactions_bp, url_prefix="/api")

    @app.before_request
    def require_auth():
        if request.endpoint in ("login", "static"):
            return
        if not flask_session.get("authenticated"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        error = None
        if request.method == "POST":
            if request.form.get("password") == app.config["APP_PASSWORD"]:
                flask_session["authenticated"] = True
                return redirect(url_for("index"))
            error = "Wrong password"
        return render_template("login.html", error=error)

    @app.route("/logout")
    def logout():
        flask_session.clear()
        return redirect(url_for("login"))

    @app.route("/")
    @app.route("/<path:path>")
    def index(path=None):
        return render_template("index.html")

    @app.route("/backup")
    def backup():
        import os
        from flask import send_file
        from datetime import datetime
        db_path = os.path.join(app.instance_path, "poker.db")
        filename = f"poker-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        return send_file(db_path, as_attachment=True, download_name=filename)

    with app.app_context():
        from .models import player, session, session_player, buyin, transaction
        db.create_all()

    return app
