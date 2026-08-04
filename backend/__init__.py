"""
Digital Signage – Backend-Paket.

Enthält die Flask-App (App-Factory), die Datenbank, die Modelle und
die modularen Blueprints (URL-Routen). Neue Module (z. B. Wetter,
Nachrichten) lassen sich als weitere Blueprints unter backend/routes/
ergänzen.
"""

import sys

from flask import Flask, render_template, request

from .config import BASE_DIR, Config
from .database import db
from .models import Setting
from .security import get_csrf_token, get_current_user, validate_csrf


def _ensure_directories() -> None:
    """Legt Upload- und Datenbank-Verzeichnisse an, falls sie fehlen."""
    folders = (
        BASE_DIR / "database",
        BASE_DIR / "uploads" / "images",
        BASE_DIR / "uploads" / "videos",
        BASE_DIR / "uploads" / "audio",
        BASE_DIR / "uploads" / "announcements",
    )
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)


def _seed_default_settings() -> None:
    """Stellt sicher, dass alle Standard-Einstellungen existieren."""
    for key, value in Config.DEFAULT_SETTINGS.items():
        if db.session.get(Setting, key) is None:
            db.session.add(Setting(key=key, value=value))
    db.session.commit()


def _migrate_schema() -> None:
    """
    Führt minimale Schema-Migrationen für bestehende Datenbanken aus.

    db.create_all() legt nur fehlende Tabellen an, ändert aber keine
    vorhandenen. Für die neue Spalte media.active wird deshalb ein
    ALTER TABLE ausgeführt (funktioniert mit SQLite und MariaDB/MySQL).
    """
    from sqlalchemy import inspect

    inspector = inspect(db.engine)
    try:
        columns = {c["name"] for c in inspector.get_columns("media")}
    except Exception:
        return  # Tabelle existiert noch nicht – create_all legt sie an
    if "active" not in columns:
        db.session.execute(
            db.text("ALTER TABLE media ADD COLUMN active BOOLEAN NOT NULL DEFAULT 1")
        )
        db.session.commit()
    if "duration" not in columns:
        db.session.execute(
            db.text("ALTER TABLE media ADD COLUMN duration FLOAT NOT NULL DEFAULT 0")
        )
        db.session.commit()
    if "project_file" not in columns:
        db.session.execute(
            db.text("ALTER TABLE media ADD COLUMN project_file VARCHAR(200)")
        )
        db.session.commit()

    # Wetter-Widget: neue Spalten für Höchst-/Mindesttemperatur und
    # Tagesverlauf (Morgen/Mittag/Abend).
    try:
        weather_columns = {c["name"] for c in inspector.get_columns("weather_data")}
    except Exception:
        weather_columns = set()
    weather_additions = {
        "today_temp_max": "ALTER TABLE weather_data ADD COLUMN today_temp_max VARCHAR(16) NOT NULL DEFAULT ''",
        "today_temp_min": "ALTER TABLE weather_data ADD COLUMN today_temp_min VARCHAR(16) NOT NULL DEFAULT ''",
        "tomorrow_temp_max": "ALTER TABLE weather_data ADD COLUMN tomorrow_temp_max VARCHAR(16) NOT NULL DEFAULT ''",
        "tomorrow_temp_min": "ALTER TABLE weather_data ADD COLUMN tomorrow_temp_min VARCHAR(16) NOT NULL DEFAULT ''",
        "today_course": "ALTER TABLE weather_data ADD COLUMN today_course TEXT NOT NULL DEFAULT ''",
        "tomorrow_course": "ALTER TABLE weather_data ADD COLUMN tomorrow_course TEXT NOT NULL DEFAULT ''",
    }
    for col, sql in weather_additions.items():
        if col not in weather_columns:
            db.session.execute(db.text(sql))
            db.session.commit()

    # Veraltete Einstellungsschlüssel entfernen (durch Slider-Konfiguration
    # mit Größe in Prozent und X/Y-Position ersetzt).
    for key in (
        "clock_size",
        "clock_position",
        "weather_size",
        "weather_position",
    ):
        old = db.session.get(Setting, key)
        if old is not None:
            db.session.delete(old)
    db.session.commit()


def create_app(config_class=Config) -> Flask:
    """
    App-Factory: baut und konfiguriert die Flask-Anwendung.

    static_folder/template_folder zeigen auf frontend/static und
    frontend/templates.
    """
    app = Flask(
        __name__,
        static_folder=str(BASE_DIR / "frontend" / "static"),
        template_folder=str(BASE_DIR / "frontend" / "templates"),
        static_url_path="/static",
    )
    app.config.from_object(config_class)

    if app.config["SECRET_KEY"] == "bitte-secret-key-in-.env-setzen":
        sys.stderr.write("WARNUNG: SECRET_KEY ist nicht gesetzt (Standardwert in Benutzung).\n")

    _ensure_directories()

    db.init_app(app)
    with app.app_context():
        db.create_all()
        _migrate_schema()
        _seed_default_settings()

    # CSRF-Schutz global für alle schreibenden Anfragen
    app.before_request(validate_csrf)

    # Modulare Blueprints registrieren
    from .routes import (
        announcements,
        auth,
        dashboard,
        media,
        public,
        settings,
        users,
        weather,
    )

    app.register_blueprint(public.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(dashboard.bp)
    app.register_blueprint(media.bp)
    app.register_blueprint(settings.bp)
    app.register_blueprint(users.bp)
    app.register_blueprint(weather.bp)
    app.register_blueprint(announcements.bp)

    @app.context_processor
    def _inject_globals() -> dict:
        """Stellt Variablen für alle Templates bereit."""
        return {
            "current_user": get_current_user(),
            "csrf_token": get_csrf_token,
            "site_name": "Digital Signage",
        }

    # ---- Fehlerbehandler ---------------------------------------------------
    @app.errorhandler(400)
    def _bad_request(err):
        if request.path.startswith("/api/"):
            return {"error": "Ungültige Anfrage."}, 400
        return render_template("error.html", code=400, message="Ungültige Anfrage."), 400

    @app.errorhandler(401)
    def _unauthorized(err):
        return {"error": "Nicht angemeldet."}, 401

    @app.errorhandler(403)
    def _forbidden(err):
        if request.path.startswith("/api/"):
            return {"error": "Keine Berechtigung."}, 403
        return render_template("error.html", code=403,
                               message="Keine Berechtigung für diese Aktion."), 403

    @app.errorhandler(404)
    def _not_found(err):
        if request.path.startswith("/api/"):
            return {"error": "Nicht gefunden."}, 404
        return render_template("error.html", code=404,
                               message="Die Seite wurde nicht gefunden."), 404

    @app.errorhandler(413)
    def _too_large(err):
        return {"error": "Die Datei ist zu groß."}, 413

    return app
