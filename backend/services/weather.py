"""
Wetter-Dienst für das Wetter-Widget.

Holt aktuelle Vorhersagedaten (heute + morgen) kostenlos über die
Open-Meteo-API (kein API-Schlüssel nötig) und cacht sie in der
Tabelle ``weather_data``. Ist kein Internet verfügbar, werden zuletzt
gespeicherte (oder manuell gepflegte) Werte verwendet.

Zustandswerte sind kurze, sprachunabhängige Schlüssel wie "sun" oder
"showers"; die Darstellung als Symbol und die Übersetzung übernimmt das
Frontend der Anzeige.
"""

import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..config import Config
from ..database import db
from ..models import WeatherData

OPEN_METEO_GEO = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"

# WMO-Wettercode -> (deutsche Beschreibung, Zustands-Schlüssel)
#
# Der Zustands-Schlüssel ist sprachunabhängig (z. B. "rain", "showers") und
# wird an der Anzeige in die gewählte Sprache übersetzt. Der Administrator
# wählt im Admin-Bereich (deutsch) nur den Zustand aus.
WMO = {
    0: ("Klar", "sun"),
    1: ("Überwiegend sonnig", "sun"),
    2: ("Teilweise bewölkt", "cloud-sun"),
    3: ("Bewölkt", "cloud"),
    45: ("Nebel", "fog"),
    48: ("Eisnebel", "fog"),
    51: ("Leichter Nieselregen", "rain"),
    53: ("Nieselregen", "rain"),
    55: ("Starker Nieselregen", "rain"),
    56: ("Gefrierender Nieselregen", "rain"),
    57: ("Gefrierender Nieselregen", "rain"),
    61: ("Leichter Regen", "rain"),
    63: ("Regen", "rain"),
    65: ("Starker Regen", "rain"),
    66: ("Gefrierender Regen", "rain"),
    67: ("Gefrierender Regen", "rain"),
    71: ("Leichter Schneefall", "snow"),
    73: ("Schneefall", "snow"),
    75: ("Starker Schneefall", "snow"),
    77: ("Schneegriesel", "snow"),
    80: ("Regenschauer", "showers"),
    81: ("Regenschauer", "showers"),
    82: ("Kräftige Regenschauer", "showers"),
    85: ("Schneeschauer", "snow"),
    86: ("Schneeschauer", "snow"),
    95: ("Gewitter", "storm"),
    96: ("Gewitter mit Hagel", "storm"),
    99: ("Gewitter mit Hagel", "storm"),
}


def _http_get_json(url: str, params: dict):
    """Kleiner HTTP-GET-Client (urllib, ohne Extra-Abhängigkeiten)."""
    query = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{query}", timeout=8) as res:
        return json.loads(res.read().decode("utf-8"))


def _describe(code) -> tuple[str, str]:
    """Übersetzt einen WMO-Code in (Beschreibung, Zustands-Schlüssel)."""
    try:
        return WMO.get(int(code), ("Unbekannt", "cloud"))
    except (TypeError, ValueError):
        return ("Unbekannt", "cloud")


def _geocode(city: str):
    """Ermittelt (lat, lon, aufgelöster Name) für einen Ortsnamen."""
    data = _http_get_json(OPEN_METEO_GEO, {"name": city, "count": 1, "language": "de"})
    results = data.get("results") or []
    if not results:
        raise ValueError(f"Ort nicht gefunden: {city}")
    first = results[0]
    return first["latitude"], first["longitude"], first.get("name", city)


def _fetch(city: str) -> dict:
    """Holt frische Wetterdaten. Wirft Exception bei Netzwerk-/API-Fehlern."""
    lat, lon, resolved = _geocode(city)
    data = _http_get_json(
        OPEN_METEO_FORECAST,
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "timezone": "auto",
            "forecast_days": 2,
        },
    )

    current = data.get("current", {})
    daily = data.get("daily", {})
    codes = daily.get("weather_code") or []

    today_desc, today_state = _describe(current.get("weather_code"))
    tomorrow_desc, tomorrow_state = _describe(codes[1] if len(codes) > 1 else 0)

    def _round(value, fallback="") -> str:
        try:
            return str(round(float(value)))
        except (TypeError, ValueError):
            return fallback

    return {
        "location": resolved,
        "today": {
            "temp": _round(current.get("temperature_2m")),
            "desc": today_desc,
            "state": today_state,
        },
        "tomorrow": {
            "temp": _round(
                daily.get("temperature_2m_max", [None])[0]
                if daily.get("temperature_2m_max")
                else None
            ),
            "desc": tomorrow_desc,
            "state": tomorrow_state,
        },
    }


def _first_row() -> WeatherData | None:
    """Liefert die (einzige) Wetter-Zeile oder None."""
    return db.session.execute(
        select(WeatherData).order_by(WeatherData.id.asc()).limit(1)
    ).scalar_one_or_none()


def _store(data: dict) -> WeatherData:
    """Schreibt Wetterdaten in die (einzelne) Datenbankzeile."""
    row = _first_row()
    if row is None:
        row = WeatherData()
        db.session.add(row)

    row.location = data.get("location", "")[:120]
    row.updated_at = datetime.now(timezone.utc)
    row.today_temp = data["today"]["temp"]
    row.today_desc = data["today"]["desc"][:120]
    row.today_icon = (data["today"].get("state") or data["today"].get("icon") or "")[:32]
    row.tomorrow_temp = data["tomorrow"]["temp"]
    row.tomorrow_desc = data["tomorrow"]["desc"][:120]
    row.tomorrow_icon = (data["tomorrow"].get("state") or data["tomorrow"].get("icon") or "")[:32]
    db.session.commit()
    return row


def _is_stale(row: WeatherData) -> bool:
    """True, wenn die Daten älter sind als WEATHER_TTL."""
    if row.updated_at is None:
        return True
    updated = row.updated_at
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - updated > timedelta(
        seconds=Config.WEATHER_TTL
    )


def _empty(city: str = "") -> dict:
    """Leere Wetterdaten (kein Ort/keine Daten verfügbar)."""
    return {
        "location": city,
        "updated_at": None,
        "today": {"temp": "", "desc": "Keine Daten", "icon": "cloud"},
        "tomorrow": {"temp": "", "desc": "Keine Daten", "icon": "cloud"},
    }


def get_weather(city: str = "", force: bool = False) -> dict:
    """
    Liefert Wetterdaten als Dict – aktualisiert automatisch, wenn die
    Daten veraltet sind, der Ort sich geändert hat oder force gesetzt ist.
    """
    row = _first_row()
    desired = (city or "").strip()
    needs_update = (
        force
        or row is None
        or _is_stale(row)
        or (desired and row.location.strip().lower() != desired.lower())
    )

    if needs_update and desired:
        try:
            return _store(_fetch(desired)).to_dict()
        except Exception:
            # Kein Internet/API-Fehler: zuletzt gespeicherte Werte verwenden
            pass

    if row is not None:
        return row.to_dict()
    return _empty(city)


def save_manual(data: dict) -> dict:
    """Speichert vom Admin manuell eingegebene Wetterdaten."""
    def _pick(section, key, default=""):
        value = (data.get(section) or {}).get(key)
        return default if value is None else str(value).strip()[:120]

    def _state(section):
        value = _pick(section, "state") or _pick(section, "icon", "cloud")
        return value[:32]

    payload = {
        "location": str(data.get("location") or "").strip()[:120],
        "today": {
            "temp": str(data.get("today_temp") or data.get("today", {}).get("temp") or "")[:16],
            "desc": _pick("today", "desc"),
            "state": _state("today"),
        },
        "tomorrow": {
            "temp": str(data.get("tomorrow_temp") or data.get("tomorrow", {}).get("temp") or "")[:16],
            "desc": _pick("tomorrow", "desc"),
            "state": _state("tomorrow"),
        },
    }
    return _store(payload).to_dict()
