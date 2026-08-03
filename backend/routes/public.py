"""
Öffentliche Routen: Anzeigebildschirm, Anzeige-API und Medien-Auslieferung.

Diese Routen benötigen KEINEN Login, da der Anzeigebildschirm für Besucher
öffentlich zugänglich sein muss.
"""

from flask import Blueprint, abort, jsonify, render_template, send_from_directory

from ..config import BASE_DIR, Config
from ..database import db
from ..models import Media
from ..services.settings import get_all_settings

bp = Blueprint("public", __name__)


@bp.get("/")
def display():
    """Öffentlicher Anzeigebildschirm (Vollbildseite)."""
    return render_template("display.html")


@bp.get("/api/display")
def api_display():
    """
    Liefert Einstellungen und Medienliste für den Anzeigebildschirm.

    - media: Bilder und Videos (in Sortierreihenfolge, gemeinsame Playlist)
    - audio: Audiodateien für die Hintergrundmusik
    """
    rows = db.session.execute(
        db.select(Media).order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()

    items = [m.to_dict() for m in rows if m.type in ("image", "video")]
    audio = [m.to_dict() for m in rows if m.type == "audio"]

    return jsonify({"settings": get_all_settings(), "media": items, "audio": audio})


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
