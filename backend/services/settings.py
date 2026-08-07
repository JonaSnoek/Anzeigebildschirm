"""
Dienstschicht für Wiedergabe-Einstellungen.

Validiert alle Werte und speichert sie als Schlüssel-Wert-Paare in der
settings-Tabelle. Die Validierungsregeln stehen zentral in ALLOWED und
können bei neuen Einstellungen einfach erweitert werden.
"""

from sqlalchemy import select

from ..database import db
from ..models import Setting

# Validierungsregeln: key -> (typ, [parameter])
#   ("bool",)
#   ("choice", [erlaubte_werte])
#   ("int", minimum, maximum)
#   ("str", maximale_länge)
#   ("interval", minimum, maximum)  # "off" oder Ganzzahl (Folien-Intervall)
ALLOWED = {
    "slide_duration": ("int", 3, 300),
    "transition": ("choice", ["fade", "none"]),
    "autoplay": ("bool",),
    "loop": ("bool",),
    "volume": ("int", 0, 100),
    "music_enabled": ("bool",),

    # Uhr-Widget
    "clock_enabled": ("bool",),
    "clock_mode": ("choice", ["auto", "custom"]),
    "clock_x": ("int", 0, 100),
    "clock_y": ("int", 0, 100),
    "clock_size_pct": ("int", 30, 600),
    "clock_big_size_pct": ("int", 30, 600),
    "clock_interval": ("interval", 1, 999),

    # Wetter-Widget
    "weather_enabled": ("bool",),
    "weather_display": ("choice", ["small", "medium", "large"]),
    "weather_city": ("str", 120),
    "weather_mode": ("choice", ["auto", "custom"]),
    "weather_x": ("int", 0, 100),
    "weather_y": ("int", 0, 100),
    "weather_size_pct": ("int", 30, 600),
    "weather_big_size_pct": ("int", 30, 600),
    "weather_interval": ("interval", 1, 999),
}


def _normalize_interval(key: str, raw) -> str:
    """Normalisiert einen Folien-Intervallwert: \"off\" (deaktiviert) oder
    eine Ganzzahl zwischen minimum und maximum (1 = nach jeder Folie)."""
    if str(raw).strip().lower() in ("off", "false", "none", ""):
        return "off"
    rule = ALLOWED[key]
    low, high = rule[1], rule[2]
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Ungültiger Zahlenwert für {key}.") from exc
    if value < low or value > high:
        raise ValueError(f"Wert für {key} muss zwischen {low} und {high} liegen.")
    return str(value)


def get_all_settings() -> dict:
    """Liest alle gespeicherten Einstellungen als Dict (Key -> Value)."""
    rows = db.session.execute(select(Setting)).scalars().all()
    return {s.key: s.value for s in rows}


def interval_step(settings: dict, key: str, default: str = "off") -> int:
    """Folien-Intervall einer Einstellung: 0 = aus, sonst Anzahl Folien."""
    value = str(settings.get(key) if settings.get(key) is not None else default).strip().lower()
    if value in ("", "off", "false", "none"):
        return 0
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 0


def _normalize(key: str, raw) -> str:
    """Normalisiert und validiert einen Rohwert für eine Einstellung."""
    rule = ALLOWED.get(key)
    if rule is None:
        raise ValueError(f"Unbekannte Einstellung: {key}")

    kind = rule[0]
    if kind == "bool":
        if isinstance(raw, bool):
            return "true" if raw else "false"
        return "true" if str(raw).lower() in ("1", "true", "on", "ja", "yes") else "false"
    if kind == "choice":
        if raw not in rule[1]:
            raise ValueError(f"Ungültiger Wert für {key}: {raw}")
        return str(raw)
    if kind == "int":
        low, high = rule[1], rule[2]
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Ungültiger Zahlenwert für {key}.") from exc
        if value < low or value > high:
            raise ValueError(f"Wert für {key} muss zwischen {low} und {high} liegen.")
        return str(value)
    if kind == "interval":
        return _normalize_interval(key, raw)
    if kind == "str":
        return str(raw).strip()[: rule[1]]
    return str(raw)


def update_settings(data: dict) -> dict:
    """Schreibt gültige Einstellungen in die Datenbank. Wirft ValueError bei Fehlern."""
    for key in ALLOWED:
        if key not in data:
            continue
        value = _normalize(key, data[key])
        setting = db.session.get(Setting, key)
        if setting is None:
            setting = Setting(key=key, value=value)
            db.session.add(setting)
        else:
            setting.value = value
    db.session.commit()
    return get_all_settings()
