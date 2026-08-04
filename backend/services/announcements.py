"""
Dienstschicht für Ankündigungsbilder.

Ein Ankündigungsbild besteht aus zwei Teilen:

1. Der fertigen PNG-Datei, die als ganz normales Bildmedium (type="image")
   in der Medienbibliothek liegt und vom Anzeigebildschirm verwendet wird.
2. Der editierbaren Projektdatei (JSON unter uploads/announcements/), die
   alle Bearbeitungsdaten enthält (Texte, Farben, Positionen, Größen,
   Schriftarten, Hintergrundbild, Overlay, Ebenen).

Hintergrundbilder des Editors liegen ebenfalls unter uploads/announcements/.
"""
import json
import shutil
import time
import uuid
from pathlib import Path

from ..config import Config
from ..models import Media

MAX_BG_SIZE = 20 * 1024 * 1024  # 20 MB, wie bei Bild-Uploads
_ALLOWED_BG_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp")
_ALLOWED_ELEMENT_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")


def announcements_dir() -> Path:
    folder = Config.ANNOUNCEMENT_DIR
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def project_path(project_file: str) -> Path:
    """Pfad zu einer Projektdatei (Name wird nicht auf Pfad-Seperatoren geprüft)."""
    return announcements_dir() / Path(project_file).name


def load_project(media: Media) -> dict | None:
    """Lädt die Projektdatei eines Mediums als Dict (oder None)."""
    if not media.project_file:
        return None
    path = project_path(media.project_file)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def save_project(media: Media, project: dict) -> None:
    """Schreibt die Projektdatei eines Mediums als JSON."""
    path = project_path(media.project_file)
    path.write_text(
        json.dumps(project, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def store_background(file_storage) -> tuple[str | None, str | None]:
    """
    Speichert ein hochgeladenes Hintergrundbild. Liefert (Dateiname, Fehler).
    """
    if file_storage is None or not file_storage.filename:
        return None, "Kein Hintergrundbild übermittelt."
    ext = Path(file_storage.filename or "").suffix.lower()
    if ext not in _ALLOWED_BG_EXTS:
        return None, "Ungültiges Hintergrundbild-Format."
    folder = announcements_dir()
    stored_name = f"bg_{uuid.uuid4().hex}{ext}"
    destination = folder / stored_name
    size = 0
    too_large = False
    with open(destination, "wb") as out:
        while True:
            chunk = file_storage.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BG_SIZE:
                too_large = True
                break
            out.write(chunk)
    if too_large:
        destination.unlink(missing_ok=True)
        return None, "Das Hintergrundbild ist zu groß."
    return stored_name, None


def delete_background(stored_name: str | None) -> None:
    """Entfernt eine Hintergrunddatei (falls vorhanden)."""
    if not stored_name:
        return
    target = announcements_dir() / Path(stored_name).name
    try:
        target.unlink(missing_ok=True)
    except OSError:
        # Windows: Kurzzeitig geöffnete Handles (Virenscanner, Dateidienst)
        # blockieren das Löschen – nach kurzem Warten erneut versuchen.
        for _ in range(5):
            try:
                time.sleep(0.1)
                target.unlink(missing_ok=True)
                break
            except OSError:
                continue


def store_element_image(file_storage) -> tuple[str | None, str | None]:
    """
    Speichert ein Bild, das im Editor als Element verwendet wird (Logo,
    Veranstaltungsbild, kleines Symbol). Liefert (Dateiname, Fehler).
    """
    if file_storage is None or not file_storage.filename:
        return None, "Keine Bilddatei übermittelt."
    ext = Path(file_storage.filename or "").suffix.lower()
    if ext not in _ALLOWED_ELEMENT_EXTS:
        return None, "Ungültiges Bildformat."
    folder = announcements_dir()
    stored_name = f"el_{uuid.uuid4().hex}{ext}"
    destination = folder / stored_name
    size = 0
    too_large = False
    with open(destination, "wb") as out:
        while True:
            chunk = file_storage.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BG_SIZE:
                too_large = True
                break
            out.write(chunk)
    if too_large:
        destination.unlink(missing_ok=True)
        return None, "Das Bild ist zu groß."
    return stored_name, None


def element_image_files(project: dict) -> list[str]:
    """Alle Dateinamen, die Elemente eines Projekts als Bild referenzieren."""
    files = []
    for element in project.get("elements") or []:
        if element.get("type") in ("image", "logo") and element.get("file"):
            files.append(element["file"])
    return files


def delete_element_images(project: dict) -> None:
    """Entfernt alle von Elementen referenzierten Bilddateien."""
    for name in element_image_files(project):
        delete_background(name)


def delete_project(media: Media) -> None:
    """Entfernt Projektdatei, Hintergrundbild und Element-Bilder."""
    project = load_project(media) or {}
    delete_element_images(project)
    background = project.get("background") or {}
    delete_background(background.get("file"))
    if media.project_file:
        project_path(media.project_file).unlink(missing_ok=True)


def duplicate_announcement(source: Media) -> Media:
    """
    Erstellt eine Kopie eines Ankündigungsbildes inkl. Projektdatei und
    Hintergrundbild (eigene Dateien, damit Löschen der Kopie das Original
    nicht beeinträchtigt).
    """
    project = load_project(source) or {}

    new_png = f"{uuid.uuid4().hex}.png"
    src_png = Config.UPLOAD_DIR / "images" / source.stored_name
    dst_png = Config.UPLOAD_DIR / "images" / new_png
    if src_png.exists():
        shutil.copy2(src_png, dst_png)

    bg_file = (project.get("background") or {}).get("file")
    new_bg = None
    if bg_file:
        src_bg = announcements_dir() / Path(bg_file).name
        if src_bg.exists():
            new_bg = f"bg_{uuid.uuid4().hex}{Path(bg_file).suffix}"
            shutil.copy2(src_bg, announcements_dir() / new_bg)
    if new_bg:
        project.setdefault("background", {})["file"] = new_bg

    # Element-Bilder kopieren (eigene Dateien für die Kopie), damit das
    # Löschen der Kopie die vom Original referenzierten Bilder nicht entfernt.
    new_el = {}
    for name in element_image_files(project):
        src_el = announcements_dir() / Path(name).name
        if src_el.exists():
            new_el[name] = f"el_{uuid.uuid4().hex}{Path(name).suffix}"
            shutil.copy2(src_el, announcements_dir() / new_el[name])
    if new_el:
        for element in project.get("elements") or []:
            if element.get("file") in new_el:
                element["file"] = new_el[element["file"]]

    new_project_file = f"{uuid.uuid4().hex}.json"
    copy = Media(
        type="image",
        name=f"{source.name} (Kopie)",
        stored_name=new_png,
        mime_type="image/png",
        size_bytes=dst_png.stat().st_size if dst_png.exists() else 0,
        duration=0.0,
        sort_order=source.sort_order + 1,
        active=True,
        project_file=new_project_file,
    )
    save_project(copy, project)
    return copy
