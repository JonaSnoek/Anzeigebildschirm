"""
Wetter-Routen: öffentliche Wetterdaten für das Widget sowie Admin-
Funktionen zum Aktualisieren und manuellen Pflegen der Werte.
"""

from flask import Blueprint, jsonify, request

from ..security import roles_required
from ..services.settings import get_all_settings
from ..services import weather

bp = Blueprint("weather", __name__)


@bp.get("/api/weather")
def public_weather():
    """Öffentlich: Wetterdaten + Wetter-Einstellungen für das Widget."""
    settings = get_all_settings()
    return jsonify(
        {
            "weather": weather.get_weather(settings.get("weather_city", "")),
            "settings": {
                "weather_enabled": settings.get("weather_enabled", "false"),
                "weather_display": settings.get("weather_display", "large"),
                "weather_mode": settings.get("weather_mode", "auto"),
            },
        }
    )


@bp.post("/api/weather/refresh")
@roles_required("admin", "editor")
def refresh_weather():
    """Holt frische Wetterdaten von Open-Meteo (überschreibt gecachte Werte)."""
    settings = get_all_settings()
    city = (request.get_json(silent=True) or {}).get("city") or settings.get("weather_city", "")
    if not city.strip():
        return jsonify({"error": "Bitte zuerst einen Ort in den Wiedergabe-Einstellungen angeben."}), 400
    try:
        data = weather.get_weather(city, force=True)
    except Exception as exc:  # noqa: BLE001 – alle Netzwerk-/API-Fehler abfangen
        return jsonify({"error": f"Wetter konnte nicht abgerufen werden: {exc}"}), 502
    from ..events import notify_display

    notify_display()
    return jsonify({"ok": True, "weather": data})


@bp.post("/api/weather")
@roles_required("admin", "editor")
def save_weather():
    """Speichert manuell gepflegte Wetterdaten (falls kein Internet verfügbar ist)."""
    data = request.get_json(silent=True) or {}
    try:
        result = weather.save_manual(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    from ..events import notify_display

    notify_display()
    return jsonify({"ok": True, "weather": result})
