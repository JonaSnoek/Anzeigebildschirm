"""
Zentrale Konfiguration des Digital-Signage-Systems.

Alle Einstellungen lassen sich über Umgebungsvariablen (bzw. eine
.env-Datei) überschreiben. Dadurch ist die Anwendung ohne Änderungen
am Code auch später auf MariaDB o. Ä. umstellbar.
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Projekt-Root-Verzeichnis (eine Ebene über backend/)
BASE_DIR = Path(__file__).resolve().parent.parent

# Umgebungsvariablen aus der .env-Datei laden (falls vorhanden)
load_dotenv(BASE_DIR / ".env")


class Config:
    """Anwendungskonfiguration (über Umgebungsvariablen überschreibbar)."""

    # ---- Sicherheit -------------------------------------------------------
    SECRET_KEY = os.environ.get("SECRET_KEY") or "bitte-secret-key-in-.env-setzen"
    SESSION_COOKIE_NAME = "anzeige_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Auf "true" setzen, wenn hinter HTTPS betrieben wird.
    SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    PERMANENT_SESSION_LIFETIME = timedelta(hours=12)

    # ---- Datenbank ---------------------------------------------------------
    # Standard: SQLite. Für MariaDB z. B.:
    #   DATABASE_URL=mysql+pymysql://benutzer:passwort@host/datenbank
    SQLALCHEMY_DATABASE_URI = (
        os.environ.get("DATABASE_URL")
        or f"sqlite:///{(BASE_DIR / 'database' / 'anzeige.db').as_posix()}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ---- Server ------------------------------------------------------------
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", "5000"))

    # ---- Uploads -----------------------------------------------------------
    # Globales Limit für die gesamte Anfrage (größter Upload: Video).
    MAX_CONTENT_LENGTH = 600 * 1024 * 1024  # 600 MB

    UPLOAD_DIR = BASE_DIR / "uploads"

    # Medientyp -> Unterordner (Plural-Form)
    UPLOAD_FOLDERS = {
        "image": "images",
        "video": "videos",
        "audio": "audio",
    }

    # Erlaubte Dateiendungen je Medientyp
    UPLOAD_TYPES = {
        "image": (".jpg", ".jpeg", ".png", ".gif", ".webp"),
        "video": (".mp4", ".webm"),
        "audio": (".mp3", ".wav", ".ogg"),
    }

    # Maximale Dateigröße je Medientyp (in Bytes)
    MAX_UPLOAD_SIZE = {
        "image": 20 * 1024 * 1024,    # 20 MB
        "video": 500 * 1024 * 1024,   # 500 MB
        "audio": 100 * 1024 * 1024,   # 100 MB
    }

    # ---- Standard-Wiedergabe-Einstellungen ---------------------------------
    DEFAULT_SETTINGS = {
        "slide_duration": "8",      # Anzeigedauer pro Bild in Sekunden
        "transition": "fade",       # fade | none
        "autoplay": "true",         # automatische Wiedergabe
        "loop": "true",             # Wiederholen
        "volume": "70",             # Lautstärke 0–100
        "music_enabled": "true",    # Hintergrundmusik
    }
