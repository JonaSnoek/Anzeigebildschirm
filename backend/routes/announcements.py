"""
Ankündigungsbild-Editor: Editor-Seiten und API für das Erstellen und
Bearbeiten von Ankündigungsbildern.

Beim Speichern entstehen zwei Dinge:
- die fertige PNG-Datei als normales Bildmedium (type="image"), das auf dem
  Anzeigebildschirm wie jedes andere Bild läuft, und
- die editierbare Projektdatei (JSON), mit der das Bild jederzeit wieder
  geöffnet und verändert werden kann.
"""
import json
import mimetypes
import shutil
import uuid
from pathlib import Path

from flask import Blueprint, abort, jsonify, render_template, request, send_from_directory
from sqlalchemy import func, select

from ..config import BASE_DIR, Config
from ..database import db
from ..events import notify_display
from ..models import Media
from ..security import roles_required
from ..services.announcements import (
    delete_background,
    delete_project,
    load_project,
    save_project,
    store_background,
)

bp = Blueprint("announcements", __name__)

MAX_PNG_SIZE = 20 * 1024 * 1024  # gerenderte Ankündigungsbilder: max. 20 MB
_PNG_EXTS = (".png", ".jpg", ".jpeg")


def _default_project() -> dict:
    """Neues Projekt mit dem festen Design (nur Inhalte sind bearbeitbar)."""
    return {
        "version": 1,
        "name": "",
        "width": 1920,
        "height": 1080,
        "background": {
            "file": None,
            "zoom": 1.0,
            "offsetX": 0,
            "offsetY": 0,
        },
        "overlay": {
            "enabled": True,
            "color": "#000000",
            "opacity": 0.35,
        },
        "title": {
            "text": "Titel",
            "font": "Arial Black",
            "size": 150,
            "color": "#FFFFFF",
            "align": "center",
            "letterSpacing": 2,
            "x": 960,
            "y": 470,
        },
        "underline": {
            "enabled": True,
            "color": "#F4B942",
            "thickness": 16,
            "offsetY": 28,
            "widthPct": 0.8,
            "height": 60,
        },
        "subtitle": {
            "text": "Untertitel",
            "font": "Verdana",
            "size": 52,
            "color": "#E8E8E8",
            "align": "center",
            "lineHeight": 1.25,
            "letterSpacing": 1,
            "x": 960,
            "y": 610,
        },
        "info": {
            "x": 130,
            "y": 830,
            "width": 520,
            "height": 160,
            "radius": 30,
            "brush": True,
            "bgColor": "#FFFFFF",
            "opacity": 0.97,
            "iconColor": "#333333",
            "textColor": "#222222",
            "padX": 34,
            "padY": 22,
            "rowGap": 18,
            "iconSize": 46,
            "date": {"text": "Heute", "font": "Verdana", "size": 44, "weight": "bold"},
            "location": {"text": "Aula", "font": "Verdana", "size": 44, "weight": "bold"},
            "dateEnabled": True,
            "locationEnabled": True,
        },
        "grid": {"snap": True, "step": 24},
        "weather": {"enabled": False, "location": "", "heading": ""},
    }


def _render_editor(project: dict, media_id: int | None, name: str) -> str:
    """Rendert die Editor-Seite mit dem eingebetteten Projekt-JSON."""
    # `</` escapen, damit Textinhalte (z. B. aus der Projektdatei) das
    # eingebettete <script>-Tag nicht verlassen können.
    embedded = json.dumps(project, ensure_ascii=False).replace("</", "<\\/")
    return render_template(
        "announcement_editor.html",
        project_json=embedded,
        media_id=media_id,
        media_name=name,
        active="media",
    )


@bp.get("/admin/announcements/new")
@roles_required("admin", "editor")
def editor_new():
    """Öffnet den Editor für ein neues Ankündigungsbild."""
    return _render_editor(_default_project(), None, "")


@bp.get("/admin/announcements/<int:media_id>/edit")
@roles_required("admin", "editor")
def editor_edit(media_id):
    """Öffnet den Editor für ein vorhandenes Ankündigungsbild."""
    media = db.session.get(Media, media_id)
    if media is None or media.type != "image" or not media.project_file:
        abort(404)
    project = load_project(media) or _default_project()
    return _render_editor(project, media.id, media.name)


@bp.get("/api/announcements/bg/<path:filename>")
@roles_required("admin", "editor")
def background_file(filename):
    """Liefert ein Hintergrundbild des Editors an den Admin-Bereich."""
    folder = Config.ANNOUNCEMENT_DIR
    if not folder.exists():
        abort(404)
    response = send_from_directory(str(folder), Path(filename).name, max_age=0)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-cache"
    return response


def _counts() -> dict:
    rows = db.session.execute(
        select(Media.type, func.count()).group_by(Media.type)
    ).all()
    return {media_type: int(count) for media_type, count in rows}


def _store_png(file_storage) -> tuple[str | None, str | None]:
    """Speichert das gerenderte PNG als Bildmedium-Datei (ohne DB)."""
    if file_storage is None or not file_storage.filename:
        return None, "Kein gerendertes Bild übermittelt."
    ext = Path(file_storage.filename or "").suffix.lower()
    if ext not in _PNG_EXTS:
        return None, "Ungültiges Bildformat für das Ankündigungsbild."
    folder = Config.UPLOAD_DIR / "images"
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    destination = folder / stored_name
    size = 0
    too_large = False
    with open(destination, "wb") as out:
        while True:
            chunk = file_storage.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_PNG_SIZE:
                too_large = True
                break
            out.write(chunk)
    if too_large:
        destination.unlink(missing_ok=True)
        return None, "Das gerenderte Bild ist zu groß."
    return stored_name, None


def _parse_project(payload: str) -> tuple[dict | None, str | None]:
    try:
        project = json.loads(payload or "")
    except (TypeError, ValueError):
        return None, "Ungültige Projektdatei."
    if not isinstance(project, dict):
        return None, "Ungültige Projektdatei."
    return project, None


def _apply_background(project: dict, bg_file) -> str | None:
    """Speichert ein neues Hintergrundbild, falls übermittelt."""
    if bg_file is None:
        return None
    name, error = store_background(bg_file)
    if error:
        return error
    project.setdefault("background", {})["file"] = name
    return None


@bp.post("/api/announcements")
@roles_required("admin", "editor")
def create():
    """Erstellt ein neues Ankündigungsbild (multipart: file + project [+ background])."""
    project, error = _parse_project(request.form.get("project"))
    if error:
        return jsonify({"error": error}), 400

    name = (request.form.get("name") or "").strip() or (project.get("name") or "").strip() or "Ankündigungsbild"
    stored_name, error = _store_png(request.files.get("file"))
    if error:
        return jsonify({"error": error}), 400

    bg_error = _apply_background(project, request.files.get("background"))
    if bg_error:
        (Config.UPLOAD_DIR / "images" / stored_name).unlink(missing_ok=True)
        return jsonify({"error": bg_error}), 400

    project["name"] = name
    max_order = db.session.execute(
        select(func.coalesce(func.max(Media.sort_order), 0))
    ).scalar()
    media = Media(
        type="image",
        name=name[:200],
        stored_name=stored_name,
        mime_type="image/png",
        size_bytes=(Config.UPLOAD_DIR / "images" / stored_name).stat().st_size,
        sort_order=int(max_order) + 1,
        active=True,
        project_file=f"{uuid.uuid4().hex}.json",
    )
    db.session.add(media)
    db.session.commit()
    save_project(media, project)
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.post("/api/announcements/<int:media_id>")
@roles_required("admin", "editor")
def update(media_id):
    """Speichert ein vorhandenes Ankündigungsbild erneut (multipart)."""
    media = db.session.get(Media, media_id)
    if media is None or media.type != "image" or not media.project_file:
        return jsonify({"error": "Ankündigungsbild nicht gefunden."}), 404

    project, error = _parse_project(request.form.get("project"))
    if error:
        return jsonify({"error": error}), 400
    if "width" not in project:
        project["width"] = 1920
    if "height" not in project:
        project["height"] = 1080

    old_project = load_project(media) or {}
    old_bg = (old_project.get("background") or {}).get("file")

    # Hintergrund zuerst speichern (kann fehlschlagen – dann bleibt alles alt)
    bg_error = _apply_background(project, request.files.get("background"))
    if bg_error:
        return jsonify({"error": bg_error}), 400
    new_bg = (project.get("background") or {}).get("file")

    # Neues gerendertes Bild ablegen (alte Datei entfernen)
    stored_name, error = _store_png(request.files.get("file"))
    if error:
        # Neu gespeichertes Hintergrundbild zurückrollen, falls vorhanden
        if new_bg and new_bg != old_bg:
            delete_background(new_bg)
            project.setdefault("background", {})["file"] = old_bg
        return jsonify({"error": error}), 400
    old_png = Config.UPLOAD_DIR / "images" / media.stored_name
    try:
        old_png.unlink(missing_ok=True)
    except OSError:
        pass

    if old_bg and old_bg != new_bg:
        delete_background(old_bg)

    name = (request.form.get("name") or "").strip() or (project.get("name") or "").strip() or media.name
    project["name"] = name
    media.name = name[:200]
    media.stored_name = stored_name
    media.mime_type = "image/png"
    media.size_bytes = (Config.UPLOAD_DIR / "images" / stored_name).stat().st_size
    db.session.commit()
    save_project(media, project)
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.get("/api/announcements/<int:media_id>")
@roles_required("admin", "editor")
def get_project(media_id):
    """Liefert die Projektdatei eines Ankündigungsbildes."""
    media = db.session.get(Media, media_id)
    if media is None or media.type != "image" or not media.project_file:
        return jsonify({"error": "Ankündigungsbild nicht gefunden."}), 404
    project = load_project(media)
    if project is None:
        return jsonify({"error": "Projektdatei fehlt."}), 404
    return jsonify(project)
