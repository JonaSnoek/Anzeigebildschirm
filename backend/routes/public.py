"""
Öffentliche Routen: Anzeigebildschirm, Anzeige-API und Medien-Auslieferung.

Diese Routen benötigen KEINEN Login, da der Anzeigebildschirm für Besucher
öffentlich zugänglich sein muss.
"""

from flask import Blueprint, abort, current_app, jsonify, render_template, send_from_directory

from ..config import BASE_DIR, Config
from ..database import db
from ..models import Media
from ..services.settings import get_all_settings
from ..services import weather

bp = Blueprint("public", __name__)


@bp.get("/")
def display():
    """Öffentlicher Anzeigebildschirm (Vollbildseite)."""
    return render_template("display.html")


@bp.get("/sw.js")
def service_worker():
    """Service Worker für die PWA (muss am Root liegen, damit die ganze
    Anwendung im Scope liegt und offline funktioniert)."""
    response = send_from_directory(current_app.static_folder, "sw.js")
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@bp.get("/api/display")
def api_display():
    """
    Liefert Einstellungen, Medienliste und Wetterdaten für den
    Anzeigebildschirm.

    - media: aktive Bilder und Videos (in Sortierreihenfolge, Playlist)
    - audio: aktive Audiodateien für die Hintergrundmusik
    - weather: Wetterdaten für das Wetter-Widget
    """
    rows = db.session.execute(
        db.select(Media)
        .where(Media.active.is_(True))
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()

    items = [m.to_dict() for m in rows if m.type in ("image", "video")]
    audio = [m.to_dict() for m in rows if m.type == "audio"]

    settings = get_all_settings()
    return jsonify(
        {
            "settings": settings,
            "media": items,
            "audio": audio,
            "weather": weather.get_weather(settings.get("weather_city", "")),
        }
    )


@bp.get("/media/<media_type>/<filename>")
def media_file(media_type: str, filename: str):
    """Liefert eine hochgeladene Datei sicher aus dem Uploads-Verzeichnis."""
    if media_type not in Config.UPLOAD_TYPES:
        abort(404)
    folder = Config.UPLOAD_FOLDERS.get(media_type, media_type)
    response = send_from_directory(
        str(BASE_DIR / "uploads" / folder), filename, max_age=3600
    )
    # Verhindert MIME-Sniffing und damit Ausführung als HTML
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
