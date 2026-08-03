"""
Wiedergabe-Einstellungen: Anzeigedauer, Übergang, Autoplay, Loop,
Lautstärke und Hintergrundmusik. Zugriff für Admins und Editoren.
"""

from flask import Blueprint, jsonify, render_template, request

from ..security import roles_required
from ..services.settings import get_all_settings, update_settings

bp = Blueprint("settings", __name__)


@bp.get("/admin/settings")
@roles_required("admin", "editor")
def page():
    """Einstellungsseite."""
    return render_template("settings.html", settings=get_all_settings())


@bp.get("/api/settings")
@roles_required("admin", "editor")
def get_settings():
    """Liefert alle Einstellungen als JSON."""
    return jsonify(get_all_settings())


@bp.post("/api/settings")
@roles_required("admin", "editor")
def save_settings():
    """Speichert Einstellungen (JSON oder Formular)."""
    data = request.get_json(silent=True) or request.form.to_dict()
    try:
        result = update_settings(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    from ..events import notify_display

    notify_display()
    return jsonify({"ok": True, "settings": result})
