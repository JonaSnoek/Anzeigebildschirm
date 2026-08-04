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
from ..models import LocationWeather, WeatherData

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


# WMO-Codes mit Niederschlag (Regen/Schnee/Gewitter) → „Regen oder kein Regen“
RAIN_CODES = {
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77,
    80, 81, 82, 85, 86, 95, 96, 99,
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


def _is_rain(code) -> bool:
    """True, wenn der WMO-Code Niederschlag bedeutet."""
    try:
        return int(code) in RAIN_CODES
    except (TypeError, ValueError):
        return False


def _max_rain_prob(hourly: dict, day: str) -> int:
    """Maximale Regenwahrscheinlichkeit (0–100 %) für einen Tag."""
    if not day or not hourly:
        return 0
    times = hourly.get("time") or []
    probs = hourly.get("precipitation_probability") or []
    best = 0
    for i, ts in enumerate(times):
        if ts.startswith(day) and i < len(probs):
            try:
                best = max(best, int(probs[i]))
            except (TypeError, ValueError):
                continue
    return best


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
            "hourly": "temperature_2m,weather_code,precipitation_probability",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "timezone": "auto",
            "forecast_days": 2,
        },
    )

    current = data.get("current", {})
    daily = data.get("daily", {})
    hourly = data.get("hourly", {})
    codes = daily.get("weather_code") or []
    maxes = daily.get("temperature_2m_max") or []
    mins = daily.get("temperature_2m_min") or []
    daily_dates = daily.get("time") or []

    today_desc, today_state = _describe(current.get("weather_code"))
    tomorrow_desc, tomorrow_state = _describe(codes[1] if len(codes) > 1 else 0)

    def _round(value, fallback="") -> str:
        try:
            return str(round(float(value)))
        except (TypeError, ValueError):
            return fallback

    def _course(day: str) -> list:
        """Tagesverlauf (Morgen/Mittag/Abend) aus den Stundenwerten."""
        if not day:
            return []
        times = hourly.get("time") or []
        temps = hourly.get("temperature_2m") or []
        hcodes = hourly.get("weather_code") or []
        slots = []
        for i, ts in enumerate(times):
            if not ts.startswith(day):
                continue
            try:
                hour = int(ts[11:13])
            except (TypeError, ValueError, IndexError):
                continue
            slots.append(
                {
                    "hour": hour,
                    "temp": _round(temps[i]) if i < len(temps) else "",
                    "state": _describe(hcodes[i] if i < len(hcodes) else 0)[1],
                }
            )
        if not slots:
            return []
        result = []
        for label, target in (("morning", 9), ("noon", 13), ("evening", 18)):
            nearest = min(slots, key=lambda s: abs(s["hour"] - target))
            result.append(
                {"period": label, "temp": nearest["temp"], "state": nearest["state"]}
            )
        return result

    today_max = _round(maxes[0] if maxes else None)
    today_min = _round(mins[0] if mins else None)
    tomorrow_max = _round(maxes[1] if len(maxes) > 1 else None)
    tomorrow_min = _round(mins[1] if len(mins) > 1 else None)
    today_date = daily_dates[0] if daily_dates else ""
    tomorrow_date = daily_dates[1] if len(daily_dates) > 1 else ""

    return {
        "location": resolved,
        "today": {
            "temp": _round(current.get("temperature_2m")),
            "temp_max": today_max,
            "temp_min": today_min,
            "desc": today_desc,
            "state": today_state,
            "course": _course(today_date),
            "rain": _is_rain(current.get("weather_code")),
            "rain_prob": _max_rain_prob(hourly, today_date),
        },
        "tomorrow": {
            "temp": tomorrow_max or "",
            "temp_max": tomorrow_max,
            "temp_min": tomorrow_min,
            "desc": tomorrow_desc,
            "state": tomorrow_state,
            "course": _course(tomorrow_date),
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

    def _value(section, key):
        return str((data.get(section) or {}).get(key) or "").strip()[:16]

    row.location = data.get("location", "")[:120]
    row.updated_at = datetime.now(timezone.utc)
    row.today_temp = _value("today", "temp") or _value("today", "temp_max")
    row.today_temp_max = _value("today", "temp_max")
    row.today_temp_min = _value("today", "temp_min")
    row.today_desc = str(data["today"].get("desc") or "")[:120]
    row.today_icon = (data["today"].get("state") or data["today"].get("icon") or "")[:32]
    row.tomorrow_temp = _value("tomorrow", "temp") or _value("tomorrow", "temp_max")
    row.tomorrow_temp_max = _value("tomorrow", "temp_max")
    row.tomorrow_temp_min = _value("tomorrow", "temp_min")
    row.tomorrow_desc = str(data["tomorrow"].get("desc") or "")[:120]
    row.tomorrow_icon = (data["tomorrow"].get("state") or data["tomorrow"].get("icon") or "")[:32]
    # Tagesverlauf nur überschreiben, wenn er mitgeliefert wurde (manuelle
    # Bearbeitung soll zuvor abgerufene API-Werte nicht verwerfen).
    for prefix in ("today", "tomorrow"):
        course = (data.get(prefix) or {}).get("course")
        if course is not None:
            setattr(row, prefix + "_course", json.dumps(course, ensure_ascii=False))
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
        "today": {"temp": "", "temp_max": "", "temp_min": "", "desc": "Keine Daten", "icon": "cloud", "course": []},
        "tomorrow": {"temp": "", "temp_max": "", "temp_min": "", "desc": "Keine Daten", "icon": "cloud", "course": []},
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


def get_weather_snapshot(city: str = "") -> dict:
    """
    Liefert die zuletzt gespeicherten Wetterdaten, OHNE das Netzwerk zu
    kontaktieren. Wird für Echtzeit-Broadcasts verwendet, damit diese nie
    durch einen langsamen Wetter-Abruf verzögert werden.
    """
    row = _first_row()
    if row is not None:
        return row.to_dict()
    return _empty(city)


def save_manual(data: dict) -> dict:
    """Speichert vom Admin manuell eingegebene Wetterdaten."""
    def _pick(section, key, default=""):
        value = (data.get(section) or {}).get(key)
        return default if value is None else str(value).strip()[:120]

    def _value(section, key, default=""):
        value = (data.get(section) or {}).get(key)
        return default if value is None else str(value).strip()[:16]

    def _state(section):
        value = _pick(section, "state") or _pick(section, "icon", "cloud")
        return value[:32]

    today = {
        "temp": _value("today", "temp") or _value("today", "temp_max")
        or str(data.get("today_temp") or "")[:16],
        "temp_max": _value("today", "temp_max"),
        "temp_min": _value("today", "temp_min"),
        "desc": _pick("today", "desc"),
        "state": _state("today"),
    }
    tomorrow = {
        "temp": _value("tomorrow", "temp") or _value("tomorrow", "temp_max")
        or str(data.get("tomorrow_temp") or "")[:16],
        "temp_max": _value("tomorrow", "temp_max"),
        "temp_min": _value("tomorrow", "temp_min"),
        "desc": _pick("tomorrow", "desc"),
        "state": _state("tomorrow"),
    }
    payload = {
        "location": str(data.get("location") or "").strip()[:120],
        "today": today,
        "tomorrow": tomorrow,
    }
    return _store(payload).to_dict()


# ---------------------------------------------------------------------------
# Wetter pro Standort (Ankündigungsbilder)
# ---------------------------------------------------------------------------

def _location_row(location: str) -> LocationWeather | None:
    return db.session.get(LocationWeather, (location or "").strip()[:120])


def _store_location(location: str, data: dict) -> LocationWeather:
    """Schreibt Wetterdaten eines Standorts (nur der aktuelle Tag)."""
    row = _location_row(location)
    if row is None:
        row = LocationWeather(location=(location or "").strip()[:120])
        db.session.add(row)

    today = data.get("today") or {}
    row.updated_at = datetime.now(timezone.utc)
    row.today_temp = str(today.get("temp") or today.get("temp_max") or "")[:16]
    row.today_temp_max = str(today.get("temp_max") or "")[:16]
    row.today_temp_min = str(today.get("temp_min") or "")[:16]
    row.today_desc = str(today.get("desc") or "")[:120]
    row.today_icon = (today.get("state") or today.get("icon") or "")[:32]
    row.today_rain = bool(today.get("rain"))
    try:
        row.today_rain_prob = max(0, min(100, int(today.get("rain_prob") or 0)))
    except (TypeError, ValueError):
        row.today_rain_prob = 0
    course = today.get("course")
    if course is not None:
        row.today_course = json.dumps(course, ensure_ascii=False)
    db.session.commit()
    return row


def _empty_location(location: str = "") -> dict:
    """Leere Standort-Wetterdaten (kein Ort/keine Daten verfügbar)."""
    return {
        "location": location,
        "updated_at": None,
        "today": {
            "temp": "",
            "temp_max": "",
            "temp_min": "",
            "desc": "Keine Daten",
            "icon": "cloud",
            "course": [],
            "rain": False,
            "rain_prob": 0,
        },
    }


def get_location_weather(location: str = "", force: bool = False) -> dict:
    """
    Liefert Wetterdaten für einen Standort (heute), aktualisiert automatisch,
    wenn sie fehlen oder veraltet sind. Fallback auf den letzten Cache bei
    Netzwerkfehlern.
    """
    location = (location or "").strip()[:120]
    if not location:
        return _empty_location(location)
    row = _location_row(location)
    if force or row is None or _is_stale(row):
        try:
            return _store_location(location, _fetch(location)).to_dict()
        except Exception:
            # Kein Internet/API-Fehler: zuletzt gespeicherte Werte verwenden
            pass
    if row is not None:
        return row.to_dict()
    return _empty_location(location)


def get_location_weather_snapshot(location: str = "") -> dict:
    """Wie get_location_weather, aber OHNE Netzwerkzugriff (für Broadcasts)."""
    location = (location or "").strip()[:120]
    row = _location_row(location)
    if row is not None:
        return row.to_dict()
    return _empty_location(location)
