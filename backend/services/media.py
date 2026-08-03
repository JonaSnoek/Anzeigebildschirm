"""
Dienstschicht für Medien-Dateien: Validierung, Speicherung und Löschen.

Sicherheitsaspekte:
- Nur eine feste Whitelist von Dateiendungen ist erlaubt (kein HTML/PHP o. Ä.)
- Dateien werden unter einem zufälligen UUID-Namen gespeichert
- Dateigrößen werden beim Schreiben streamweise begrenzt
- Ausgeliefert werden Dateien über send_from_directory (siehe routes/public.py)
  mit nosniff-Header – die Dateien werden niemals ausgeführt.
"""

import mimetypes
import shutil
import subprocess
import uuid
from pathlib import Path

from sqlalchemy import func, select

from ..config import BASE_DIR, Config
from ..database import db
from ..models import Media


def _probe_duration(path: Path) -> float:
    """
    Ermittelt die Dauer einer Videodatei (Sekunden) über ffprobe, falls
    verfügbar. Liefert 0.0, wenn die Dauer nicht ermittelt werden kann –
    dann meldet der erste Anzeige-Client die echte Länge zurück.
    """
    if not shutil.which("ffprobe"):
        return 0.0
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        value = float(result.stdout.strip())
        return round(value, 2) if value > 0 else 0.0
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0.0


def _classify(filename: str):
    """Bestimmt den Medientyp (image/video/audio) anhand der Dateiendung."""
    ext = Path(filename or "").suffix.lower()
    for media_type, extensions in Config.UPLOAD_TYPES.items():
        if ext in extensions:
            return media_type, ext
    return None, ext


def _upload_folder(media_type: str) -> Path:
    """Liefert den Zielordner für einen Medientyp (z. B. uploads/images)."""
    folder_name = Config.UPLOAD_FOLDERS.get(media_type, media_type)
    folder = Config.UPLOAD_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _stream_to_file(file_storage, media_type: str, ext: str):
    """
    Schreibt einen Upload streamweise auf die Platte und begrenzt die
    Dateigröße. Liefert (stored_name, destination_path, error).
    """
    folder = _upload_folder(media_type)

    stored_name = f"{uuid.uuid4().hex}{ext}"
    destination = folder / stored_name
    max_size = Config.MAX_UPLOAD_SIZE[media_type]
    size = 0
    too_large = False

    with open(destination, "wb") as out:
        while True:
            chunk = file_storage.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_size:
                too_large = True
                break
            out.write(chunk)

    if too_large:
        destination.unlink(missing_ok=True)
        return None, None, "Die Datei überschreitet die maximal zulässige Größe."

    return stored_name, destination, None


def handle_upload(file_storage) -> tuple[Media | None, str | None]:
    """Validiert und speichert einen Upload. Liefert (Media, Fehlertext)."""
    if file_storage is None or not file_storage.filename:
        return None, "Keine Datei ausgewählt."

    media_type, ext = _classify(file_storage.filename)
    if media_type is None:
        return None, "Dateiformat wird nicht unterstützt."

    stored_name, destination, error = _stream_to_file(file_storage, media_type, ext)
    if error:
        return None, error

    max_order = db.session.execute(
        select(func.coalesce(func.max(Media.sort_order), 0))
    ).scalar()

    media = Media(
        type=media_type,
        name=Path(file_storage.filename).stem,
        stored_name=stored_name,
        mime_type=(
            file_storage.mimetype
            or mimetypes.guess_type(file_storage.filename)[0]
            or "application/octet-stream"
        ),
        size_bytes=destination.stat().st_size,
        duration=_probe_duration(destination) if media_type == "video" else 0.0,
        sort_order=int(max_order) + 1,
    )
    db.session.add(media)
    db.session.commit()
    return media, None


def replace_file(media: Media, file_storage) -> tuple[Media | None, str | None]:
    """Ersetzt die Datei eines vorhandenen Mediums. Liefert (Media, Fehlertext)."""
    if file_storage is None or not file_storage.filename:
        return None, "Keine Datei ausgewählt."

    media_type, ext = _classify(file_storage.filename)
    if media_type is None or media_type != media.type:
        return None, "Die Ersatzdatei muss zum vorhandenen Medientyp passen."

    stored_name, destination, error = _stream_to_file(file_storage, media_type, ext)
    if error:
        return None, error

    delete_media_file(media)
    media.stored_name = stored_name
    media.mime_type = (
        file_storage.mimetype
        or mimetypes.guess_type(file_storage.filename)[0]
        or "application/octet-stream"
    )
    media.size_bytes = destination.stat().st_size
    media.duration = _probe_duration(destination) if media_type == "video" else 0.0
    db.session.commit()
    return media, None


def delete_media_file(media: Media) -> None:
    """Entfernt die physische Datei (falls vorhanden)."""
    file_path = _upload_folder(media.type) / media.stored_name
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass
