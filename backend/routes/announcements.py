"""
Ankündigungsbild- und Auto-Slide-Editor: Editor-Seiten und API für das
Erstellen und Bearbeiten von Editor-Medien.

Beim Speichern entstehen zwei Dinge:
- die fertige PNG-Datei als normales Medienobjekt (type="image" für
  Ankündigungsbilder, type="auto_slide" für Auto-Slides), das auf dem
  Anzeigebildschirm läuft, und
- die editierbare Projektdatei (JSON), mit der das Medium jederzeit wieder
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
from ..models import AnnouncementTemplate, Media
from ..permissions import has_permission
from ..security import get_current_user, permission_required, roles_required
from ..services.announcements import (
    copy_media_to_element,
    delete_background,
    delete_project,
    load_project,
    save_project,
    store_background,
    store_element_image,
)

bp = Blueprint("announcements", __name__)

MAX_PNG_SIZE = 20 * 1024 * 1024  # gerenderte Ankündigungsbilder: max. 20 MB
_PNG_EXTS = (".png", ".jpg", ".jpeg")


def _default_project(media_type: str = "image") -> dict:
    """Neues Projekt mit dem festen Design (nur Inhalte sind bearbeitbar).

    Ankündigungsbilder: 1920×1080. Auto-Slides: hochformatige, vertikal
    wachsende Arbeitsfläche (1080 breit), Höhe und Gesamtdauer frei.
    """
    if media_type == "auto_slide":
        return {
            "version": 1,
            "name": "",
            "mediaType": "auto_slide",
            "width": 1080,
            "height": 3000,
            "duration": 30,
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
                "x": 540,
                "y": 700,
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
                "x": 540,
                "y": 860,
            },
            "info": {
                "x": 90,
                "y": 2620,
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
    return {
        "version": 1,
        "name": "",
        "mediaType": "image",
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


def _render_editor(project: dict, media_id: int | None, name: str, media_type: str = "image") -> str:
    """Rendert die Editor-Seite mit dem eingebetteten Projekt-JSON."""
    # `</` escapen, damit Textinhalte (z. B. aus der Projektdatei) das
    # eingebettete <script>-Tag nicht verlassen können.
    embedded = json.dumps(project, ensure_ascii=False).replace("</", "<\\/")
    return render_template(
        "announcement_editor.html",
        project_json=embedded,
        media_id=media_id,
        media_name=name,
        media_type=media_type,
        active="media",
    )


def _require_editor_permission(media: Media, action: str) -> None:
    """Erfordert ein Editor-Kategorie-Recht (Ankündigungsbild/Auto-Slide)."""
    user = get_current_user()
    if user is None:
        abort(401)
    perm = "auto_slides." + action if media.type == "auto_slide" else "announcements." + action
    if not has_permission(user, perm):
        abort(403)


@bp.get("/admin/announcements/new")
@permission_required("announcements.create")
def editor_new():
    """Öffnet den Editor für ein neues Ankündigungsbild."""
    return _render_editor(_default_project("image"), None, "", "image")


@bp.get("/admin/announcements/<int:media_id>/edit")
@permission_required("announcements.edit")
def editor_edit(media_id):
    """Öffnet den Editor für ein vorhandenes Ankündigungsbild."""
    media = db.session.get(Media, media_id)
    if media is None or media.type != "image" or not media.project_file:
        abort(404)
    project = load_project(media) or _default_project("image")
    return _render_editor(project, media.id, media.name, "image")


@bp.get("/admin/auto-slides/new")
@permission_required("auto_slides.create")
def auto_slide_new():
    """Öffnet den Editor für ein neues Auto-Slide (hochformatige Folie)."""
    return _render_editor(_default_project("auto_slide"), None, "", "auto_slide")


@bp.get("/admin/auto-slides/<int:media_id>/edit")
@permission_required("auto_slides.edit")
def auto_slide_edit(media_id):
    """Öffnet den Editor für ein vorhandenes Auto-Slide."""
    media = db.session.get(Media, media_id)
    if media is None or media.type != "auto_slide" or not media.project_file:
        abort(404)
    project = load_project(media) or _default_project("auto_slide")
    return _render_editor(project, media.id, media.name, "auto_slide")


@bp.get("/api/announcements/bg/<path:filename>")
@permission_required("announcements.view", "auto_slides.view")
def background_file(filename):
    """Liefert ein Hintergrund-/Element-Bild des Editors an den Admin-Bereich."""
    folder = Config.ANNOUNCEMENT_DIR
    if not folder.exists():
        abort(404)
    response = send_from_directory(str(folder), Path(filename).name, max_age=0)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


@bp.post("/api/announcements/elements")
@permission_required(
    "announcements.create", "announcements.edit",
    "auto_slides.create", "auto_slides.edit",
)
def upload_element_image():
    """Lädt ein Bild hoch, das als Element im Editor eingefügt wird."""
    file = request.files.get("file")
    name, error = store_element_image(file)
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"ok": True, "file": name, "url": f"/api/announcements/bg/{name}"})


@bp.post("/api/announcements/from-media/<int:media_id>")
@permission_required(
    "announcements.create", "announcements.edit",
    "auto_slides.create", "auto_slides.edit",
)
def element_from_media(media_id):
    """Übernimmt ein Bild aus der Medienbibliothek als Editor-Element."""
    media = db.session.get(Media, media_id)
    name, error = copy_media_to_element(media)
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"ok": True, "file": name, "url": f"/api/announcements/bg/{name}"})


# ---------------------------------------------------------------------------
# Design-Vorlagen
# ---------------------------------------------------------------------------

@bp.get("/api/announcement-templates")
@permission_required("announcements.view", "auto_slides.view")
def list_templates():
    """Alle gespeicherten Design-Vorlagen des Administrators."""
    rows = db.session.execute(
        select(AnnouncementTemplate).order_by(AnnouncementTemplate.created_at.desc())
    ).scalars().all()
    return jsonify({"templates": [t.to_dict() for t in rows]})


@bp.post("/api/announcement-templates")
@permission_required(
    "announcements.create", "announcements.edit",
    "auto_slides.create", "auto_slides.edit",
)
def create_template():
    """Speichert das aktuelle Design als benannte Vorlage."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:200]
    project = data.get("project")
    if not name:
        return jsonify({"error": "Bitte einen Namen für die Vorlage angeben."}), 400
    if not isinstance(project, dict):
        return jsonify({"error": "Ungültige Vorlagendaten."}), 400
    template = AnnouncementTemplate(
        name=name,
        project_json=json.dumps(project, ensure_ascii=False),
    )
    db.session.add(template)
    db.session.commit()
    return jsonify({"ok": True, "item": template.to_dict()}), 201


@bp.delete("/api/announcement-templates/<int:template_id>")
@roles_required("admin")
def delete_template(template_id):
    """Löscht eine gespeicherte Design-Vorlage."""
    template = db.session.get(AnnouncementTemplate, template_id)
    if template is None:
        return jsonify({"error": "Vorlage nicht gefunden."}), 404
    db.session.delete(template)
    db.session.commit()
    return jsonify({"ok": True})


@bp.get("/api/announcement-templates/<int:template_id>")
@permission_required("announcements.view", "auto_slides.view")
def get_template(template_id):
    """Liefert das Projekt-JSON einer Design-Vorlage."""
    template = db.session.get(AnnouncementTemplate, template_id)
    if template is None:
        return jsonify({"error": "Vorlage nicht gefunden."}), 404
    try:
        project = json.loads(template.project_json or "{}")
    except ValueError:
        return jsonify({"error": "Vorlage ist beschädigt."}), 500
    return jsonify({"ok": True, "project": project})


def _counts() -> dict:
    rows = db.session.execute(
        select(Media.type, func.count()).group_by(Media.type)
    ).all()
    return {media_type: int(count) for media_type, count in rows}


def _type_folder(media_type: str) -> Path:
    """Upload-Ordner eines Editor-Projekt-Medientyps (images | auto_slides)."""
    folder = Config.UPLOAD_DIR / Config.UPLOAD_FOLDERS.get(media_type, media_type)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _store_png(file_storage, media_type: str = "image") -> tuple[str | None, str | None]:
    """Speichert das gerenderte PNG als Bildmedium-Datei (ohne DB)."""
    if file_storage is None or not file_storage.filename:
        return None, "Kein gerendertes Bild übermittelt."
    ext = Path(file_storage.filename or "").suffix.lower()
    if ext not in _PNG_EXTS:
        return None, "Ungültiges Bildformat für den Editor."
    folder = _type_folder(media_type)
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


def _project_languages(project: dict) -> list:
    """Sprachliste des Projekts (mit Standardsprache zuerst)."""
    languages = [str(x) for x in (project.get("languages") or []) if str(x).strip()]
    if not languages:
        languages = ["de"]
    default = str(project.get("defaultLanguage") or languages[0])
    if default not in languages:
        languages.insert(0, default)
    return languages


def _unlink_png(stored_name: str | None, media_type: str = "image") -> None:
    """Entfernt eine gerenderte PNG-Datei des Editors (falls vorhanden)."""
    if not stored_name:
        return
    try:
        (_type_folder(media_type) / Path(stored_name).name).unlink(missing_ok=True)
    except OSError:
        pass


def _media_type(request, project: dict) -> str:
    """Medientyp aus Formular (Vorrang) oder Projekt-JSON, validiert."""
    media_type = (
        request.form.get("media_type")
        or project.get("mediaType")
        or "image"
    )
    if media_type not in ("image", "auto_slide"):
        return "image"
    return media_type


@bp.post("/api/announcements")
def create():
    """Erstellt ein neues Editor-Medium (multipart: file [+ file_<lang>] + project [+ background]).

    Der Medientyp (image | auto_slide) kommt aus dem Formularfeld
    "media_type" (bzw. dem Projekt-JSON). Auto-Slides landen unter
    uploads/auto_slides und tragen ihre Gesamtdauer in media.duration.
    """
    project, error = _parse_project(request.form.get("project"))
    if error:
        return jsonify({"error": error}), 400

    media_type = _media_type(request, project)
    user = get_current_user()
    if user is None:
        abort(401)
    perm = "auto_slides.create" if media_type == "auto_slide" else "announcements.create"
    if not has_permission(user, perm):
        abort(403)

    default_name = "Auto-Slide" if media_type == "auto_slide" else "Ankündigungsbild"
    name = (request.form.get("name") or "").strip() or (project.get("name") or "").strip() or default_name
    stored_name, error = _store_png(request.files.get("file"), media_type)
    if error:
        return jsonify({"error": error}), 400

    bg_error = _apply_background(project, request.files.get("background"))
    if bg_error:
        _unlink_png(stored_name, media_type)
        return jsonify({"error": bg_error}), 400

    # Sprachvarianten (außer Standardsprache) zusätzlich ablegen
    languages = _project_languages(project)
    default_lang = languages[0]
    lang_files = {}
    for lang in languages:
        if lang == default_lang:
            continue
        f = request.files.get("file_" + lang)
        if f is not None and f.filename:
            lang_name, error = _store_png(f, media_type)
            if error:
                for n in [stored_name] + list(lang_files.values()):
                    _unlink_png(n, media_type)
                return jsonify({"error": error}), 400
            lang_files[lang] = lang_name

    project["name"] = name
    project["mediaType"] = media_type
    max_order = db.session.execute(
        select(func.coalesce(func.max(Media.sort_order), 0))
    ).scalar()
    media = Media(
        type=media_type,
        name=name[:200],
        stored_name=stored_name,
        mime_type="image/png",
        size_bytes=(_type_folder(media_type) / stored_name).stat().st_size,
        duration=float(project.get("duration") or 0) if media_type == "auto_slide" else 0.0,
        sort_order=int(max_order) + 1,
        active=True,
        project_file=f"{uuid.uuid4().hex}.json",
        language_files=json.dumps(lang_files) if lang_files else "",
    )
    db.session.add(media)
    db.session.commit()
    save_project(media, project)
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.post("/api/announcements/<int:media_id>")
def update(media_id):
    """Speichert ein vorhandenes Editor-Medium erneut (multipart)."""
    media = db.session.get(Media, media_id)
    if media is None or media.type not in ("image", "auto_slide") or not media.project_file:
        return jsonify({"error": "Medienprojekt nicht gefunden."}), 404
    _require_editor_permission(media, "edit")
    media_type = media.type

    project, error = _parse_project(request.form.get("project"))
    if error:
        return jsonify({"error": error}), 400
    if "width" not in project:
        project["width"] = 1080 if media_type == "auto_slide" else 1920
    if "height" not in project:
        project["height"] = 3000 if media_type == "auto_slide" else 1080
    project["mediaType"] = media_type

    languages = _project_languages(project)
    default_lang = languages[0]

    old_project = load_project(media) or {}
    old_bg = (old_project.get("background") or {}).get("file")

    # Hintergrund zuerst speichern (kann fehlschlagen – dann bleibt alles alt)
    bg_error = _apply_background(project, request.files.get("background"))
    if bg_error:
        return jsonify({"error": bg_error}), 400
    new_bg = (project.get("background") or {}).get("file")

    # Neue Dateien zuerst ablegen; erst nach Erfolg die alten entfernen,
    # damit bei einem Fehler der bisherige Stand erhalten bleibt.
    stored = []

    def rollback():
        for n in stored:
            _unlink_png(n, media_type)
        if new_bg and new_bg != old_bg:
            delete_background(new_bg)
            project.setdefault("background", {})["file"] = old_bg

    stored_name, error = _store_png(request.files.get("file"), media_type)
    if error:
        rollback()
        return jsonify({"error": error}), 400
    stored.append(stored_name)

    old_lang_files = media.language_files_dict()
    lang_files = {}
    for lang in languages:
        if lang == default_lang:
            continue
        f = request.files.get("file_" + lang)
        if f is not None and f.filename:
            lang_name, error = _store_png(f, media_type)
            if error:
                rollback()
                return jsonify({"error": error}), 400
            lang_files[lang] = lang_name
            stored.append(lang_name)
        elif lang in old_lang_files:
            lang_files[lang] = old_lang_files[lang]  # bestehende Variante behalten

    # Erfolg: alte Dateien entfernen
    _unlink_png(media.stored_name, media_type)
    for lang, old_name in old_lang_files.items():
        if lang_files.get(lang) != old_name:
            _unlink_png(old_name, media_type)
    if old_bg and old_bg != new_bg:
        delete_background(old_bg)

    name = (request.form.get("name") or "").strip() or (project.get("name") or "").strip() or media.name
    project["name"] = name
    media.name = name[:200]
    media.stored_name = stored_name
    media.mime_type = "image/png"
    media.size_bytes = (_type_folder(media_type) / stored_name).stat().st_size
    media.duration = float(project.get("duration") or 0) if media_type == "auto_slide" else 0.0
    media.language_files = json.dumps(lang_files) if lang_files else ""
    db.session.commit()
    save_project(media, project)
    notify_display()
    return jsonify({"ok": True, "item": media.to_dict(), "counts": _counts()})


@bp.get("/api/announcements/<int:media_id>")
def get_project(media_id):
    """Liefert die Projektdatei eines Editor-Mediums (Ankündigungsbild/Auto-Slide)."""
    media = db.session.get(Media, media_id)
    if media is None or media.type not in ("image", "auto_slide") or not media.project_file:
        return jsonify({"error": "Medienprojekt nicht gefunden."}), 404
    _require_editor_permission(media, "view")
    project = load_project(media)
    if project is None:
        return jsonify({"error": "Projektdatei fehlt."}), 404
    return jsonify(project)
