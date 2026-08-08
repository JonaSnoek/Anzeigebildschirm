"""
Wiedergabe-Einstellungen: Anzeigedauer, Übergang, Autoplay, Loop,
Lautstärke und Hintergrundmusik. Zugriff für Admins und Editoren.
"""

from flask import Blueprint, abort, jsonify, render_template, request

from ..permissions import has_permission
from ..security import get_current_user, permission_required
from ..services.settings import get_all_settings, update_settings

bp = Blueprint("settings", __name__)

# Einstellungsschlüssel je Rechte-Kategorie. Der POST-Endpunkt prüft die
# Rechte aller Kategorien, die in der Anfrage vorkommen.
PLAYBACK_KEYS = {"slide_duration", "transition", "autoplay", "loop", "volume", "music_enabled"}
WIDGET_KEYS = {
    "clock_enabled", "clock_mode", "clock_x", "clock_y",
    "clock_size_pct", "clock_big_size_pct", "clock_interval",
    "weather_enabled", "weather_display", "weather_mode", "weather_x",
    "weather_y", "weather_size_pct", "weather_big_size_pct", "weather_interval",
}
WEATHER_KEYS = {"weather_city"}


@bp.get("/admin/settings")
@permission_required("settings.view")
def page():
    """Einstellungsseite."""
    return render_template("settings.html", settings=get_all_settings())


@bp.get("/api/settings")
@permission_required("settings.view")
def get_settings():
    """Liefert alle Einstellungen als JSON."""
    return jsonify(get_all_settings())


@bp.post("/api/settings")
def save_settings():
    """Speichert Einstellungen (JSON oder Formular).

    Prüft die Rechte der Kategorien, die die Anfrage enthält: nur
    Wiedergabe-Werte → ``settings.edit``, Widget-Werte → ``settings.widgets``,
    Wetter-Ort → ``settings.weather``. Fehlt ein Recht, wird die ganze
    Anfrage abgelehnt (403).
    """
    data = request.get_json(silent=True) or request.form.to_dict()
    keys = set(data.keys())
    required = set()
    if keys & PLAYBACK_KEYS:
        required.add("settings.edit")
    if keys & WIDGET_KEYS:
        required.add("settings.widgets")
    if keys & WEATHER_KEYS:
        required.add("settings.weather")
    user = get_current_user()
    if user is None:
        abort(401)
    if required and not all(has_permission(user, perm) for perm in required):
        abort(403)

    try:
        result = update_settings(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    from ..events import notify_display

    notify_display()
    return jsonify({"ok": True, "settings": result})
