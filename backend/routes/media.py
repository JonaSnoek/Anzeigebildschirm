"""
Medienverwaltung: Upload, Auflisten, Löschen, Umbenennen, Ersetzen,
Sortieren und Vorschau. Zugriff nur für Administratoren und Editoren.
"""

from flask import Blueprint, jsonify, render_template, request
from sqlalchemy import func, select

from ..config import Config
from ..database import db
from ..models import Media
from ..security import roles_required
from ..services.media import delete_media_file, handle_upload, replace_file

bp = Blueprint("media", __name__)


def _counts() -> dict:
    """Anzahl der Medien je Typ (für die Tabs)."""
    rows = db.session.execute(
        select(Media.type, func.count()).group_by(Media.type)
    ).all()
    return {media_type: int(count) for media_type, count in rows}


@bp.get("/admin/media")
@roles_required("admin", "editor")
def page():
    """Verwaltungsseite für Medien."""
    return render_template(
        "media.html",
        max_sizes={t: round(n / 1024 / 1024) for t, n in Config.MAX_UPLOAD_SIZE.items()},
        allowed={t: list(ext) for t, ext in Config.UPLOAD_TYPES.items()},
    )


@bp.get("/api/media")
@roles_required("admin", "editor")
def list_media():
    """Liefert die Medien eines Typs in Sortierreihenfolge."""
    media_type = request.args.get("type", "image")
    if media_type not in Config.UPLOAD_TYPES:
        return jsonify({"error": "Ungültiger Medientyp."}), 400

    rows = db.session.execute(
        select(Media)
        .where(Media.type == media_type)
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()

    return jsonify({"items": [m.to_dict() for m in rows], "counts": _counts()})


@bp.post("/api/media/upload")
@roles_required("admin", "editor")
def upload():
    """Nimmt einen Datei-Upload entgegen (multipart/form-data, Feld 'file')."""
    file = request.files.get("file")
    media, error = handle_upload(file)
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.post("/api/media/<int:media_id>/delete")
@roles_required("admin", "editor")
def delete(media_id):
    """Löscht eine Mediendatei (Datenbankeintrag + Datei)."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    delete_media_file(media)
    db.session.delete(media)
    db.session.commit()
    return jsonify({"ok": True, "counts": _counts()})


@bp.post("/api/media/<int:media_id>/rename")
@roles_required("admin", "editor")
def rename(media_id):
    """Benennt ein Medium um (nur Anzeigename, Datei bleibt unverändert)."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Der Name darf nicht leer sein."}), 400
    media.name = name[:200]
    db.session.commit()
    return jsonify({"ok": True, "item": media.to_dict()})


@bp.post("/api/media/<int:media_id>/replace")
@roles_required("admin", "editor")
def replace(media_id):
    """Ersetzt die Datei eines Mediums durch einen neuen Upload."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404

    file = request.files.get("file")
    new_media, error = replace_file(media, file)
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"ok": True, "item": new_media.to_dict()})


@bp.post("/api/media/reorder")
@roles_required("admin", "editor")
def reorder():
    """Übernimmt eine neue Sortierreihenfolge (JSON: {"ids": [..]})."""
    data = request.get_json(silent=True) or {}
    order = data.get("ids") or []
    for position, media_id in enumerate(order, start=1):
        media = db.session.get(Media, int(media_id))
        if media is not None:
            media.sort_order = position
    db.session.commit()
    return jsonify({"ok": True})
