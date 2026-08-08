"""
Medienverwaltung: Upload, Auflisten, Löschen, Umbenennen, Ersetzen,
Sortieren und Vorschau. Zugriff nur für Administratoren und Editoren.
"""

from flask import Blueprint, abort, jsonify, render_template, request
from sqlalchemy import func, select

from ..config import Config
from ..database import db
from ..events import notify_display
from ..models import Media
from ..permissions import has_any_permission, has_permission
from ..security import get_current_user, permission_required
from ..services.announcements import delete_project, duplicate_announcement
from ..services.media import delete_media_file, handle_upload, replace_file

bp = Blueprint("media", __name__)


def _category(media: Media) -> str:
    """Rechte-Kategorie eines Medienobjekts.

    - auto_slide      → ``auto_slides``
    - Ankündigungsbild (image mit Projektdatei) → ``announcements``
    - alle übrigen (Bilder, Videos, Audio)      → ``media``
    """
    if media.type == "auto_slide":
        return "auto_slides"
    if media.type == "image" and media.project_file:
        return "announcements"
    return "media"


def _require_action(action: str, media: Media) -> None:
    """Erfordert ein Kategorie-Recht für eine Aktion an einem Medienobjekt."""
    user = get_current_user()
    if user is None:
        abort(401)
    if not has_permission(user, f"{_category(media)}.{action}"):
        abort(403)


def _counts() -> dict:
    """Anzahl der Medien je Typ (für die Tabs)."""
    rows = db.session.execute(
        select(Media.type, func.count()).group_by(Media.type)
    ).all()
    return {media_type: int(count) for media_type, count in rows}


@bp.get("/admin/media")
@permission_required("media.view", "announcements.view", "auto_slides.view")
def page():
    """Verwaltungsseite für Medien."""
    return render_template(
        "media.html",
        max_sizes={t: round(n / 1024 / 1024) for t, n in Config.MAX_UPLOAD_SIZE.items()},
        allowed={t: list(ext) for t, ext in Config.UPLOAD_TYPES.items()},
    )


@bp.get("/api/media")
@permission_required("media.view", "announcements.view", "auto_slides.view")
def list_media():
    """Liefert die Medien eines Typs in Sortierreihenfolge."""
    media_type = request.args.get("type", "image")
    if media_type not in Config.UPLOAD_TYPES:
        return jsonify({"error": "Ungültiger Medientyp."}), 400

    # Pro Tab nur die passende Ansehen-Rechte abfragen (Bilder teilen sich
    # den Tab mit den Ankündigungsbildern).
    user = get_current_user()
    per_type = {"video": "media.view", "audio": "media.view", "auto_slide": "auto_slides.view"}
    if media_type in per_type and not has_permission(user, per_type[media_type]):
        abort(403)
    if media_type == "image" and not has_any_permission(user, "media.view", "announcements.view"):
        abort(403)

    rows = db.session.execute(
        select(Media)
        .where(Media.type == media_type)
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()

    return jsonify({"items": [m.to_dict() for m in rows], "counts": _counts()})


@bp.post("/api/media/upload")
@permission_required("media.create")
def upload():
    """Nimmt einen Datei-Upload entgegen (multipart/form-data, Feld 'file')."""
    file = request.files.get("file")
    media, error = handle_upload(file)
    if error:
        return jsonify({"error": error}), 400
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.post("/api/media/<int:media_id>/delete")
def delete(media_id):
    """Löscht eine Mediendatei (Datenbankeintrag + Datei)."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    _require_action("delete", media)
    delete_media_file(media)
    delete_project(media)  # Ankündigungsbilder: Projektdatei + Hintergrund entfernen
    db.session.delete(media)
    db.session.commit()
    notify_display()
    return jsonify({"ok": True, "counts": _counts()})


@bp.post("/api/media/<int:media_id>/rename")
def rename(media_id):
    """Benennt ein Medium um (nur Anzeigename, Datei bleibt unverändert)."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    _require_action("edit", media)

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Der Name darf nicht leer sein."}), 400
    media.name = name[:200]
    db.session.commit()
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict()})


@bp.post("/api/media/<int:media_id>/active")
def set_active(media_id):
    """
    Schaltet ein Medium ein oder aus.

    Inaktive Medien werden im Anzeigebildschirm nicht mehr abgespielt,
    bleiben aber für später gespeichert. Ohne Body wird der Status
    umgeschaltet, mit JSON {"active": true|false} explizit gesetzt.
    """
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    _require_action("toggle", media)

    data = request.get_json(silent=True) or {}
    if "active" in data:
        media.active = bool(data["active"])
    else:
        media.active = not media.active
    db.session.commit()
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict()})


@bp.post("/api/media/<int:media_id>/replace")
def replace(media_id):
    """Ersetzt die Datei eines Mediums durch einen neuen Upload."""
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    _require_action("replace", media)

    file = request.files.get("file")
    new_media, error = replace_file(media, file)
    if error:
        return jsonify({"error": error}), 400
    notify_display()
    return jsonify({"ok": True, "item": new_media.to_dict()})


@bp.post("/api/media/<int:media_id>/duplicate")
def duplicate(media_id):
    """
    Dupliziert ein Medium (Datei + Datenbankzeile). Bei Ankündigungsbildern
    werden zusätzlich Projektdatei und Hintergrundbild kopiert, damit die
    Kopie unabhängig weiterbearbeitet werden kann.
    """
    media = db.session.get(Media, media_id)
    if media is None:
        return jsonify({"error": "Datei nicht gefunden."}), 404
    _require_action("copy", media)

    if media.project_file:
        copy = duplicate_announcement(media)
    else:
        import shutil
        import uuid
        from pathlib import Path

        folder = Config.UPLOAD_DIR / Config.UPLOAD_FOLDERS.get(media.type, media.type)
        new_stored = f"{uuid.uuid4().hex}{Path(media.stored_name).suffix}"
        src = folder / media.stored_name
        dst = folder / new_stored
        if src.exists():
            shutil.copy2(src, dst)
        copy = Media(
            type=media.type,
            name=f"{media.name} (Kopie)",
            stored_name=new_stored,
            mime_type=media.mime_type,
            size_bytes=dst.stat().st_size if dst.exists() else 0,
            duration=media.duration or 0.0,
            sort_order=media.sort_order + 1,
            active=True,
        )
    db.session.add(copy)
    db.session.commit()
    notify_display()
    return jsonify({"ok": True, "item": copy.to_dict(), "counts": _counts()})


@bp.post("/api/media/reorder")
def reorder():
    """Übernimmt eine neue Sortierreihenfolge (JSON: {"type": ..., "ids": [..]}).

    Das Recht „Verschieben/Reihenfolge“ wird je Tab abgeprüft: Bilder werden
    sowohl über ``media.move`` als auch ``announcements.move`` gestattet
    (Ankündigungsbilder liegen im gleichen Tab), Videos/Audio über
    ``media.move`` und Auto-Slides über ``auto_slides.move``.
    """
    data = request.get_json(silent=True) or {}
    order = data.get("ids") or []
    media_type = data.get("type") or ""

    allowed = {
        "image": ("media.move", "announcements.move"),
        "video": ("media.move",),
        "audio": ("media.move",),
        "auto_slide": ("auto_slides.move",),
    }
    user = get_current_user()
    if user is None:
        abort(401)
    required = allowed.get(media_type, ())
    if not required or not any(has_permission(user, perm) for perm in required):
        abort(403)

    for position, media_id in enumerate(order, start=1):
        media = db.session.get(Media, int(media_id))
        if media is not None:
            media.sort_order = position
    db.session.commit()
    notify_display()
    return jsonify({"ok": True})
