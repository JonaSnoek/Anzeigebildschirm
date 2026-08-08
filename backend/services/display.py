"""
Zentrale Anzeige-Logik: Playlist, Timeline und Echtzeit-Zustand.

Die Timeline beschreibt die Wiedergabe als reine Funktion der Zeit
(Zentrale Zeitsteuerung):

    phase = (serverzeit - cycle_start) % cycle_duration

Jedes Element hat einen Start- und Endzeitpunkt innerhalb des Zyklus.
Alle verbundenen Anzeigen leiten daraus denselben aktuellen Inhalt ab –
unabhängig davon, wann sie geöffnet wurden. Der Server gibt die Reihenfolge
und die Anzeigedauer zentral vor.

Element-Typen: "image", "video", "auto_slide" (hochformatige Folie, die mit
konstanter Geschwindigkeit über ihre Gesamtdauer scrollt), "clock" (Uhr-Ansicht
zwischen den Medien, sofern clock_interval aktiv ist) und "weather" (eigene
große Wetter-Ansicht, sofern weather_interval aktiv ist). Beide Intervalle sind
getrennt konfigurierbar (1 = nach jeder Folie, N = alle N Folien, off = aus).
Jedes Editor-Medium trägt außerdem
seine eigene Uhr-Konfiguration (Sichtbarkeit, Farbe, Schatten) im Slot.
"""

import time

from sqlalchemy import select

from ..database import db
from ..models import Media
from ..services import weather as weather_svc
from ..services.announcements import load_project
from ..services.settings import get_all_settings, interval_step

# Fallback-Dauer für Videos, deren echte Länge noch nicht bekannt ist.
# Sobald ein Anzeige-Client die tatsächliche Länge meldet (/api/display/report),
# wird die Timeline automatisch neu berechnet und allen Geräten übertragen.
DEFAULT_VIDEO_DURATION = 15.0

# Alle Medientypen, die in der Wiedergabe-Playlist laufen.
PLAYLIST_TYPES = ("image", "video", "auto_slide")

# Cache für die Zyklus-Referenz (cycle_start) – wird nur neu gesetzt, wenn
# sich die Signatur (Playlist/Einstellungen) ändert.
_cache: dict = {"signature": None, "cycle_start": 0.0}


def _html_widgets(project: dict) -> dict | None:
    """
    Liefert die HTML-Widgets eines Projekts für die Anzeige:
    `{width, height, items: [...]}` – oder None, wenn keine vorhanden sind.
    Der HTML-Code wird vollständig mitgegeben; das Display rendert jedes
    Widget in einem isolierten iframe (Refresh laut Intervall, Standard 5 Min).
    """
    elements = project.get("elements") or []
    items = [el for el in elements if el.get("type") == "html"]
    if not items:
        return None
    out_items = []
    for el in items:
        out_items.append({
            "id": str(el.get("id") or ""),
            "name": str(el.get("name") or "HTML-Widget"),
            "x": el.get("x") if isinstance(el.get("x"), (int, float)) else 0,
            "y": el.get("y") if isinstance(el.get("y"), (int, float)) else 0,
            "w": el.get("w") if isinstance(el.get("w"), (int, float)) else 0,
            "h": el.get("h") if isinstance(el.get("h"), (int, float)) else 0,
            "rotation": el.get("rotation") if isinstance(el.get("rotation"), (int, float)) else 0,
            "opacity": el.get("opacity") if isinstance(el.get("opacity"), (int, float)) else 1,
            "html": str(el.get("html") or ""),
            "refresh": el.get("refresh") is not False,
            "interval": int(min(max(float(el.get("interval") or 5), 1), 1440)),
        })
    return {
        "width": int(project.get("width") or 1920),
        "height": int(project.get("height") or 1080),
        "items": out_items,
    }


def _announcement_configs(items) -> dict:
    """
    Liefert je Editor-Medium (Ankündigungsbild/Auto-Slide) dessen
    Einstellungen aus der Projektdatei:

    - `clock`:  Uhr-Steuerung der Folie (Sichtbarkeit, Farbe, Schatten).
    - `weather`: Wetter-Konfiguration (nur wenn aktiviert UND Standort gesetzt).
    - `width`/`height`: Projekt-Abmessungen (bei Auto-Slides fürs Scrollen).

    Die Überschrift ist mehrsprachig: entweder ein String (legacy) oder ein
    {Sprache: Text}-Dict. Das Display wählt die passende Sprache selbst.
    """
    out: dict = {}
    for m in items:
        if not m.project_file:
            continue
        project = load_project(m) or {}
        clock = project.get("clock") or {}
        w = project.get("weather") or {}
        location = (w.get("location") or "").strip()
        heading = w.get("heading") or ""
        if isinstance(heading, dict):
            heading = {k: str(v).strip() for k, v in heading.items() if v}
        else:
            heading = str(heading).strip()
        entry: dict = {
            "clock": {
                "enabled": clock.get("enabled") is not False,
                "color": str(clock.get("color") or "#FFFFFF"),
                "shadow": clock.get("shadow") is not False,
            },
        }
        if m.type == "auto_slide":
            entry["width"] = int(project.get("width") or 1080)
            entry["height"] = int(project.get("height") or 1080)
        widgets = _html_widgets(project)
        if widgets:
            entry["widgets"] = widgets
        if w.get("enabled") and location:
            entry["weather"] = {
                "enabled": True,
                "location": location,
                "heading": heading,
                "headingShadow": w.get("headingShadow") is not False,
            }
        out[m.id] = entry
    return out


def _playlist():
    """Aktive Bilder, Videos und Auto-Slides in zentraler Sortierreihenfolge."""
    rows = db.session.execute(
        select(Media)
        .where(Media.active.is_(True))
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()
    return [m for m in rows if m.type in PLAYLIST_TYPES]


def _item_duration(item: Media, slide_duration: int) -> float:
    """Zentrale Anzeigedauer eines Mediums (Sekunden)."""
    if item.type == "video":
        return float(item.duration) if item.duration else DEFAULT_VIDEO_DURATION
    if item.type == "auto_slide":
        # Gesamtdauer aus dem Projekt wird beim Speichern auf media.duration
        # gespiegelt (siehe routes/announcements.py).
        return float(item.duration) if item.duration else float(slide_duration)
    return float(slide_duration)


def _timeline_slots(items, settings: dict, aw_configs: dict = None):
    """
    Baut die geordnete Element-Liste (Bilder/Videos + optionale Wetterseiten)
    mit Start-/Endzeitpunkt innerhalb des Zyklus.

    Zusätzlich zu den globalen Uhr-/Wetter-Zwischenansichten kann jedes
    Ankündigungsbild eine eigene Wetterseite direkt nach sich nach sich
    ziehen (weather-announcement-Slot, Konfiguration aus der Projektdatei).
    """
    aw_configs = aw_configs if aw_configs is not None else _announcement_configs(items)
    slide = int(settings.get("slide_duration", "8") or 8)
    loop = settings.get("loop", "true") != "false"
    # Zwischenansichten sind unabhängig vom Widget-Schalter: Die große Ansicht
    # wird eingeblendet, sobald das Intervall aktiv ist – auch wenn das kleine
    # Widget während der Medien ausgeschaltet ist. Intervall 0 = aus.
    clock_step = interval_step(settings, "clock_interval")
    weather_step = interval_step(settings, "weather_interval")

    def announcement_weather_slot(item):
        """Eigene Wetterseite eines Ankündigungsbildes (oder None)."""
        config = aw_configs.get(item.id)
        if not config:
            return None
        wc = config.get("weather")
        if not wc:
            return None
        heading = wc.get("heading") or ""
        return {
            "type": "weather-announcement",
            "id": item.id,
            "name": heading or item.name,
            "url": "",
            "duration": float(slide),
            "location": wc["location"],
            "heading": heading,
            "headingShadow": wc.get("headingShadow", True),
            "clock": config.get("clock") or {},
        }

    slots = []
    media_count = 0
    for item in items:
        config = aw_configs.get(item.id)
        slot = {
            "type": item.type,
            "id": item.id,
            "name": item.name,
            "url": f"/media/{item.type}/{item.stored_name}",
            "languages": {
                lang: f"/media/{item.type}/{name}"
                for lang, name in (item.language_files_dict() or {}).items()
            },
            "duration": _item_duration(item, slide),
            "clock": config.get("clock") if config else None,
            "widgets": config.get("widgets") if config else None,
        }
        # Auto-Slides scrollen vertikal: das Display braucht die
        # Projekt-Abmessungen, um die konstante Scrollgeschwindigkeit zu
        # berechnen (Ende exakt nach der Gesamtdauer).
        if item.type == "auto_slide" and config:
            slot["width"] = config.get("width")
            slot["height"] = config.get("height")
        slots.append(slot)
        # Direkt nach dem Ankündigungsbild dessen eigene Wetterseite einfügen.
        aw = announcement_weather_slot(item)
        if aw:
            slots.append(aw)
        # Uhr-/Wetter-Zwischenansichten nach jeder N-ten Medien-Folie
        # (unabhängige Intervalle; der Zähler zählt nur Bilder/Videos,
        # nie zusammen in einem Slot).
        media_count += 1
        if clock_step and media_count % clock_step == 0:
            slots.append({"type": "clock", "id": None, "name": "", "url": "",
                          "duration": float(slide)})
        if weather_step and media_count % weather_step == 0:
            slots.append({"type": "weather", "id": None, "name": "", "url": "",
                          "duration": float(slide)})

    # Ohne Loop endet der Zyklus sauber beim letzten Medium. Die Wetterseite
    # eines Ankündigungsbildes gehört zum Bild und wird NICHT entfernt.
    if not loop:
        while slots and slots[-1]["type"] in ("clock", "weather"):
            slots.pop()

    cursor = 0.0
    for index, slot in enumerate(slots):
        slot["index"] = index
        slot["start"] = cursor
        cursor += slot["duration"]
        slot["end"] = cursor
    return slots


def _signature(items, settings: dict, aw_configs: dict = None) -> str:
    """Fingerabdruck der Playlist – ändert sich bei jeder Inhaltsänderung."""
    aw_configs = aw_configs if aw_configs is not None else _announcement_configs(items)
    playlist = ",".join(
        f"{m.id}:{m.duration or 0}:{m.sort_order}:{m.active}" for m in items
    )
    announce = ",".join(
        f"{m_id}:{cfg.get('weather', {}).get('enabled')}:{cfg.get('weather', {}).get('location')}:{cfg.get('weather', {}).get('heading')}:{cfg.get('widgets')}:{cfg.get('width')}:{cfg.get('height')}"
        for m_id, cfg in aw_configs.items()
    )
    return "|".join([
        playlist,
        announce,
        str(settings.get("slide_duration", "8")),
        str(settings.get("loop", "true")),
        str(settings.get("clock_interval", "off")),
        str(settings.get("weather_interval", "off")),
    ])


def build_timeline(items, settings: dict) -> dict | None:
    """Berechnet die zentrale Timeline (oder None bei leerer Playlist)."""
    if not items:
        return None
    aw_configs = _announcement_configs(items)
    slots = _timeline_slots(items, settings, aw_configs)
    if not slots:
        return None

    cycle_duration = slots[-1]["end"]
    sig = _signature(items, settings, aw_configs)
    if _cache.get("signature") != sig:
        _cache["signature"] = sig
        _cache["cycle_start"] = time.time()

    return {
        "signature": sig,
        "cycle_start": _cache["cycle_start"],
        "cycle_duration": cycle_duration,
        "loop": settings.get("loop", "true") != "false",
        "items": slots,
    }


def build_announcement_weather(items) -> dict:
    """
    Liefert die Wetterdaten je Ankündigungsbild (id -> {location, heading,
    weather}) für die Anzeige. Nutzt den Cache ohne Netzwerkzugriff, damit
    Echtzeit-Broadcasts nie durch einen langsamen Wetter-Abruf verzögert werden.
    """
    out: dict = {}
    configs = _announcement_configs(items)
    for m in items:
        config = configs.get(m.id)
        if not config:
            continue
        wc = config.get("weather")
        if not wc:
            continue
        out[m.id] = {
            "location": wc["location"],
            "heading": wc["heading"],
            "headingShadow": wc.get("headingShadow", True),
            "weather": weather_svc.get_location_weather_snapshot(wc["location"]),
        }
    return out


def refresh_announcement_weather() -> None:
    """
    Aktualisiert veraltete Standort-Wetterdaten aller Ankündigungsbilder.
    Wird beim Laden der Anzeige-API aufgerufen (nur wenn veraltet; Fallback
    auf den Cache bei Netzwerkfehlern).
    """
    rows = db.session.execute(
        select(Media)
        .where(Media.active.is_(True))
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()
    items = [m for m in rows if m.type in PLAYLIST_TYPES]
    configs = _announcement_configs(items)
    for m in items:
        config = configs.get(m.id)
        if not config:
            continue
        wc = config.get("weather")
        if not wc:
            continue
        try:
            weather_svc.get_location_weather(wc["location"])
        except Exception:  # noqa: BLE001 – Netzwerkfehler ignorieren (Cache fällt zurück)
            pass


def build_state() -> dict:
    """Liefert den vollständigen Echtzeit-Zustand für Anzeigen und Vorschau."""
    settings = get_all_settings()
    rows = db.session.execute(
        select(Media)
        .where(Media.active.is_(True))
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()

    items = [m for m in rows if m.type in PLAYLIST_TYPES]
    audio = [m.to_dict() for m in rows if m.type == "audio"]

    return {
        "settings": settings,
        "media": [m.to_dict() for m in items],
        "audio": audio,
        "weather": weather_svc.get_weather_snapshot(settings.get("weather_city", "")),
        "announcement_weather": build_announcement_weather(items),
        "timeline": build_timeline(items, settings),
    }
