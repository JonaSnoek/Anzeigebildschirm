"""
Öffentliche Routen: Anzeigebildschirm, Anzeige-API, Echtzeit-Events (SSE)
und Medien-Auslieferung.

Diese Routen benötigen KEINEN Login, da der Anzeigebildschirm für Besucher
öffentlich zugänglich sein muss.

Echtzeit: Über /api/events (Server-Sent Events) erhalten alle geöffneten
Anzeigen automatisch den aktuellen Zustand inkl. zentraler Timeline.
Änderungen im Admin-Bereich erscheinen damit ohne manuelles Neuladen.
"""

import json
import queue
import time

from flask import Blueprint, Response, abort, current_app, jsonify, render_template, request, send_from_directory

from ..config import BASE_DIR, Config
from ..database import db
from ..events import hub
from ..models import Media
from ..services.display import (
    build_state,
    refresh_announcement_weather,
)
from ..services.settings import get_all_settings
from ..services import weather

bp = Blueprint("public", __name__)


def _no_cache(response) -> Response:
    """Dynamische Inhalte niemals im Browser-Cache halten."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


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
    Liefert Einstellungen, Medienliste, Wetter und die zentrale Timeline
    für den Anzeigebildschirm.

    - media: aktive Bilder und Videos (in Sortierreihenfolge, Playlist)
    - audio: aktive Audiodateien für die Hintergrundmusik
    - weather: Wetterdaten für das Wetter-Widget
    - timeline: zentrale Wiedergabeplanung (Start-/Endzeitpunkte je Element)
    - server_time: Serverzeit in Sekunden (für die Zeit-Synchronisation)
    """
    # Veraltete Standort-Wetterdaten der Ankündigungsbilder zuerst auffrischen
    # (nutzt den Cache weiter, falls das Netzwerk nicht verfügbar ist), damit
    # der folgende Zustandsaufbau bereits aktuelle Daten enthält.
    try:
        refresh_announcement_weather()
    except Exception:  # noqa: BLE001 – nie die Anzeige durch Wetter blockieren
        pass
    state = build_state()
    state["server_time"] = time.time()
    return _no_cache(jsonify(state))


def _sse_message(event: str, payload: dict) -> str:
    """Formatiert ein Ereignis im SSE-Format."""
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {data}\n\n"


def _sse_state(data: dict, ts: float) -> str:
    """Echtzeit-Zustand als SSE-Ereignis: {data: …, ts: …}."""
    return _sse_message("state", {"data": data, "ts": ts})


@bp.get("/api/events")
def events():
    """
    Echtzeit-Stream (Server-Sent Events).

    Liefert sofort den aktuellen Zustand und danach bei jeder Änderung ein
    neues `state`-Ereignis. Jedes Ereignis enthält die Serverzeit, damit die
    Anzeigen ihre Uhr exakt synchronisieren können. Ein Heartbeat hält die
    Verbindung offen; der Client verbindet sich automatisch neu.
    """
    q = hub.subscribe()
    try:
        refresh_announcement_weather()
    except Exception:  # noqa: BLE001 – nie die Anzeige durch Wetter blockieren
        pass
    initial = {"kind": "state", "data": build_state(), "ts": time.time()}

    def stream():
        try:
            yield "retry: 1000\n\n"
            yield _sse_state(initial["data"], initial["ts"])
            while True:
                try:
                    message = q.get(timeout=15)
                    yield _sse_state(
                        message.get("data", {}),
                        message.get("ts", time.time()),
                    )
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            hub.unsubscribe(q)

    response = Response(
        stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
    return response


@bp.post("/api/display/report")
def report_video_duration():
    """
    Öffentlich: Anzeigen melden die tatsächliche Videodauer zurück.

    Die zentrale Timeline nutzt diese Dauer, damit alle Geräte synchron
    bleiben. Die Anfrage ist bewusst CSRF-frei (sie ändert nur die Dauer
    eines Mediums) und wird direkt von den Anzeigegeräten gesendet.
    """
    data = request.get_json(silent=True) or {}
    media_id = data.get("video_id")
    duration = data.get("duration")
    try:
        media_id = int(media_id)
        duration = round(float(duration), 2)
    except (TypeError, ValueError):
        return jsonify({"error": "Ungültige Daten."}), 400

    media = db.session.get(Media, media_id)
    if media is None or media.type != "video":
        return jsonify({"error": "Video nicht gefunden."}), 404
    if duration <= 0:
        return jsonify({"error": "Ungültige Dauer."}), 400
    if not media.duration or abs(media.duration - duration) > 0.5:
        media.duration = duration
        db.session.commit()
        from ..events import notify_display

        notify_display()
    return jsonify({"ok": True})


@bp.get("/media/<media_type>/<filename>")
def media_file(media_type: str, filename: str):
    """Liefert eine hochgeladene Datei sicher aus dem Uploads-Verzeichnis."""
    if media_type not in Config.UPLOAD_TYPES:
        abort(404)
    folder = Config.UPLOAD_FOLDERS.get(media_type, media_type)
    response = send_from_directory(
        str(BASE_DIR / "uploads" / folder), filename, max_age=0
    )
    # Verhindert MIME-Sniffing und damit Ausführung als HTML
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Keine veralteten Inhalte: Browser prüft immer neu (Last-Modified/ETag)
    response.headers["Cache-Control"] = "no-cache"
    return response
