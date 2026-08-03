"""
Datenbank-Modelle.

- User:   Administratoren, Editoren und Viewer
- Media:  hochgeladene Bilder, Videos und Audiodateien
- Setting: Schlüssel-Wert-Speicher für Wiedergabe-Einstellungen
"""

from datetime import datetime, timezone

import bcrypt
from sqlalchemy import Boolean, DateTime, Integer, String, Text

from .database import db


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

    def to_dict(self) -> dict:
        """Serielles Format für die API (ohne Passwort-Hash)."""
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "active": self.active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Media(db.Model):
    """Eine hochgeladene Mediendatei."""

    __tablename__ = "media"

    id = db.Column(Integer, primary_key=True)
    type = db.Column(String(16), nullable=False, index=True)  # image | video | audio
    name = db.Column(String(200), nullable=False, default="")          # Anzeigename
    stored_name = db.Column(String(200), nullable=False, unique=True)  # Dateiname auf Platte
    mime_type = db.Column(String(120), nullable=False, default="application/octet-stream")
    size_bytes = db.Column(Integer, nullable=False, default=0)
    sort_order = db.Column(Integer, nullable=False, default=0, index=True)
    created_at = db.Column(DateTime, nullable=False, default=_utcnow)

    def to_dict(self) -> dict:
        """Serielles Format für die API."""
        return {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "url": f"/media/{self.type}/{self.stored_name}",
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Setting(db.Model):
    """Eine Wiedergabe-Einstellung als Schlüssel-Wert-Paar."""

    __tablename__ = "settings"

    key = db.Column(String(64), primary_key=True)
    value = db.Column(Text, nullable=False, default="")
