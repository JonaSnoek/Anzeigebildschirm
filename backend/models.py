"""
Datenbank-Modelle.

- User:         Administratoren, Editoren und Viewer
- Media:        hochgeladene Bilder, Videos und Audiodateien
- Setting:      Schlüssel-Wert-Speicher für Wiedergabe-Einstellungen
- WeatherData:  gecachte Wetterdaten für das Wetter-Widget
"""

import json
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text

from .database import db
from .permissions import ALL_PERMISSIONS


def _utcnow() -> datetime:
    """Zeitstempel in UTC (einheitliche Speicherung)."""
    return datetime.now(timezone.utc)


class User(db.Model):
    """Benutzerkonto mit Rolle und Aktiv-Status."""

    __tablename__ = "users"

    ROLES = ("admin", "editor", "viewer")

    id = db.Column(Integer, primary_key=True)
    username = db.Column(String(64), unique=True, nullable=False, index=True)
    password_hash = db.Column(String(128), nullable=False)
    role = db.Column(String(16), nullable=False, default="viewer")
    active = db.Column(Boolean, nullable=False, default=True)
    created_at = db.Column(DateTime, nullable=False, default=_utcnow)
    # Individuelle Berechtigungen: JSON-Dict {"rechts.key": true|false} mit
    # Overrides zur Rollen-Vorlage. Leer = Rollen-Vorlage gilt unverändert.
    permissions = db.Column(Text, nullable=False, default="")

    def set_password(self, password: str) -> None:
        """Hasht das Passwort mit bcrypt – niemals im Klartext speichern."""
        self.password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    def check_password(self, password: str) -> bool:
        """Prüft ein eingegebenes Passwort gegen den gespeicherten Hash."""
        try:
            return bcrypt.checkpw(
                password.encode("utf-8"), self.password_hash.encode("utf-8")
            )
        except ValueError:
            return False

    def permissions_dict(self) -> dict:
        """Individuelle Rechte-Overrides als Dict {Schlüssel: bool}."""
        if not self.permissions:
            return {}
        try:
            value = json.loads(self.permissions)
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}

    def set_permissions(self, overrides: dict) -> None:
        """Speichert Rechte-Overrides (nur gültige Schlüssel, boolesche Werte)."""
        cleaned = {}
        for key, granted in (overrides or {}).items():
            if key in ALL_PERMISSIONS:
                cleaned[key] = bool(granted)
        self.permissions = json.dumps(cleaned, ensure_ascii=False)

    def to_dict(self) -> dict:
        """Serielles Format für die API (ohne Passwort-Hash)."""
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "active": self.active,
            "permissions": self.permissions_dict(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Media(db.Model):
    """Eine hochgeladene Mediendatei."""

    __tablename__ = "media"

    id = db.Column(Integer, primary_key=True)
    type = db.Column(String(16), nullable=False, index=True)  # image | video | audio | auto_slide
    name = db.Column(String(200), nullable=False, default="")          # Anzeigename
    stored_name = db.Column(String(200), nullable=False, unique=True)  # Dateiname auf Platte
    mime_type = db.Column(String(120), nullable=False, default="application/octet-stream")
    size_bytes = db.Column(Integer, nullable=False, default=0)
    duration = db.Column(Float, nullable=False, default=0.0)  # Videos: Sekunden
    sort_order = db.Column(Integer, nullable=False, default=0, index=True)
    active = db.Column(Boolean, nullable=False, default=True, index=True)
    created_at = db.Column(DateTime, nullable=False, default=_utcnow)
    # Ankündigungsbilder: Dateiname der editierbaren Projektdatei (JSON unter
    # uploads/announcements/). Ist sie gesetzt, ist das Bild ein im Editor
    # erstelltes Ankündigungsbild und kann jederzeit wieder geöffnet werden.
    project_file = db.Column(String(200), nullable=True)
    # Sprachvarianten eines Ankündigungsbildes: JSON-Dict {Sprache: Dateiname}
    # für alle Sprachen außer der Standardsprache (die Standardsprache liegt
    # in stored_name). Das Display wählt daraus die passende PNG je Sprache.
    language_files = db.Column(Text, nullable=False, default="")

    def language_files_dict(self) -> dict:
        """Sprach-Map {lang: stored_name} (ohne die Standardsprache)."""
        if not self.language_files:
            return {}
        try:
            value = json.loads(self.language_files)
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}

    def to_dict(self) -> dict:
        """Serielles Format für die API."""
        return {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "url": f"/media/{self.type}/{self.stored_name}",
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "duration": self.duration or 0.0,
            "sort_order": self.sort_order,
            "active": self.active,
            "project_file": self.project_file,
            "languages": {
                lang: f"/media/{self.type}/{name}"
                for lang, name in self.language_files_dict().items()
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Setting(db.Model):
    """Eine Wiedergabe-Einstellung als Schlüssel-Wert-Paar."""

    __tablename__ = "settings"

    key = db.Column(String(64), primary_key=True)
    value = db.Column(Text, nullable=False, default="")


class WeatherData(db.Model):
    """
    Gecachte Wetterdaten für das Wetter-Widget (eine Zeile).

    Die Werte werden vom Dienst backend/services/weather.py befüllt –
    entweder automatisch über die Open-Meteo-API (kostenlos, ohne
    Schlüssel) oder manuell im Admin-Bereich (falls kein Internet
    verfügbar ist). Temperatur-Strings sind bewusst frei (z. B.
    "-3" oder "4"), Beschreibungen sind kurze Texte wie "Leicht bewölkt".
    """

    __tablename__ = "weather_data"

    id = db.Column(Integer, primary_key=True)
    location = db.Column(String(120), nullable=False, default="")
    updated_at = db.Column(DateTime, nullable=False, default=_utcnow)

    # Heute
    today_temp = db.Column(String(16), nullable=False, default="")
    today_temp_max = db.Column(String(16), nullable=False, default="")
    today_temp_min = db.Column(String(16), nullable=False, default="")
    today_desc = db.Column(String(120), nullable=False, default="")
    today_icon = db.Column(String(32), nullable=False, default="")
    today_course = db.Column(Text, nullable=False, default="")

    # Morgen
    tomorrow_temp = db.Column(String(16), nullable=False, default="")
    tomorrow_temp_max = db.Column(String(16), nullable=False, default="")
    tomorrow_temp_min = db.Column(String(16), nullable=False, default="")
    tomorrow_desc = db.Column(String(120), nullable=False, default="")
    tomorrow_icon = db.Column(String(32), nullable=False, default="")
    tomorrow_course = db.Column(Text, nullable=False, default="")

    def _course(self, prefix: str) -> list:
        """Tagesverlauf aus dem JSON-Spalteninhalt (oder leer)."""
        raw = getattr(self, prefix + "_course")
        if not raw:
            return []
        try:
            value = json.loads(raw)
            return value if isinstance(value, list) else []
        except (TypeError, ValueError):
            return []

    def to_dict(self) -> dict:
        """Serielles Format für die API.

        ``state`` ist der sprachunabhängige Zustands-Schlüssel (z. B. ``sun``,
        ``cloud``, ``showers``). ``icon`` bleibt als Abwärtskompatibilität.
        Die Höchsttemperatur fällt auf die aktuelle Temperatur zurück, falls
        kein Tageshöchstwert vorhanden ist. Die Mindesttemperatur tut das
        bewusst NICHT: Liegt kein Tiefstwert vor, bleibt sie leer (Anzeige
        „--“), damit Höchst- und Mindesttemperatur nie dieselbe Zahl zeigen.
        """
        def _day(prefix: str) -> dict:
            temp = getattr(self, prefix + "_temp")
            temp_max = getattr(self, prefix + "_temp_max") or temp
            temp_min = getattr(self, prefix + "_temp_min") or ""
            icon = getattr(self, prefix + "_icon")
            return {
                "temp": temp,
                "temp_max": temp_max,
                "temp_min": temp_min,
                "desc": getattr(self, prefix + "_desc"),
                "icon": icon,
                "state": icon,
                "course": self._course(prefix),
            }

        return {
            "location": self.location,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "today": _day("today"),
            "tomorrow": _day("tomorrow"),
        }


class LocationWeather(db.Model):
    """
    Pro-Standort-Wetterdaten für Ankündigungsbilder (eine Zeile je Ort).

    Im Gegensatz zum globalen Wetter-Widget (eine einzige Zeile) hält diese
    Tabelle für jeden im Editor hinterlegten Standort eigene Daten vor. Es
    werden ausschließlich Werte des aktuellen Tages gespeichert, denn die
    Wetterseite hinter einem Ankündigungsbild zeigt nur „heute“.
    """

    __tablename__ = "location_weather"

    location = db.Column(String(120), primary_key=True)
    updated_at = db.Column(DateTime, nullable=False, default=_utcnow)

    today_temp = db.Column(String(16), nullable=False, default="")
    today_temp_max = db.Column(String(16), nullable=False, default="")
    today_temp_min = db.Column(String(16), nullable=False, default="")
    today_desc = db.Column(String(120), nullable=False, default="")
    today_icon = db.Column(String(32), nullable=False, default="")
    today_course = db.Column(Text, nullable=False, default="")
    today_rain = db.Column(Boolean, nullable=False, default=False)
    today_rain_prob = db.Column(Integer, nullable=False, default=0)

    def to_dict(self) -> dict:
        """Serielles Format für die API (nur der aktuelle Tag)."""
        temp = self.today_temp
        return {
            "location": self.location,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "today": {
                "temp": temp,
                "temp_max": self.today_temp_max or temp,
                "temp_min": self.today_temp_min or "",
                "desc": self.today_desc,
                "icon": self.today_icon,
                "state": self.today_icon,
                "course": self._course(),
                "rain": bool(self.today_rain),
                "rain_prob": self.today_rain_prob or 0,
            },
        }

    def _course(self) -> list:
        raw = self.today_course
        if not raw:
            return []
        try:
            value = json.loads(raw)
            return value if isinstance(value, list) else []
        except (TypeError, ValueError):
            return []


class AnnouncementTemplate(db.Model):
    """
    Gespeicherte Design-Vorlagen für den Ankündigungsbild-Editor.

    Eine Vorlage ist ein Projekt-JSON-Fragment (Hintergrund, Overlay,
    Raster und Elemente) – also genau der gestalterische Teil eines
    Ankündigungsbildes. Der Administrator kann das aktuelle Design unter
    einem Namen speichern und beim Erstellen eines neuen Ankündigungsbildes
    wieder als Vorlage auswählen.
    """

    __tablename__ = "announcement_templates"

    id = db.Column(Integer, primary_key=True)
    name = db.Column(String(200), nullable=False)
    project_json = db.Column(Text, nullable=False, default="")
    created_at = db.Column(DateTime, nullable=False, default=_utcnow)

    def to_dict(self) -> dict:
        """Serielles Format für die API (ohne den Projekt-JSON selbst)."""
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
