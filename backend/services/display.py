"""
Zentrale Anzeige-Logik: Playlist, Timeline und Echtzeit-Zustand.

Die Timeline beschreibt die Wiedergabe als reine Funktion der Zeit
(Zentrale Zeitsteuerung):

    phase = (serverzeit - cycle_start) % cycle_duration

Jedes Element hat einen Start- und Endzeitpunkt innerhalb des Zyklus.
Alle verbundenen Anzeigen leiten daraus denselben aktuellen Inhalt ab –
unabhängig davon, wann sie geöffnet wurden. Der Server gibt die Reihenfolge
und die Anzeigedauer zentral vor.

Element-Typen: "image", "video", "clock" (Uhr-Ansicht zwischen den Medien,
sofern clock_interstitial aktiv ist) und "weather" (eigene große Wetter-Ansicht,
sofern weather_interstitial aktiv ist).
"""

import time

from sqlalchemy import select

from ..database import db
from ..models import Media
from ..services import weather as weather_svc
from ..services.announcements import load_project
from ..services.settings import get_all_settings

# Fallback-Dauer für Videos, deren echte Länge noch nicht bekannt ist.
# Sobald ein Anzeige-Client die tatsächliche Länge meldet (/api/display/report),
# wird die Timeline automatisch neu berechnet und allen Geräten übertragen.
DEFAULT_VIDEO_DURATION = 15.0

# Cache für die Zyklus-Referenz (cycle_start) – wird nur neu gesetzt, wenn
# sich die Signatur (Playlist/Einstellungen) ändert.
_cache: dict = {"signature": None, "cycle_start": 0.0}


def _announcement_configs(items) -> dict:
    """
    Liefert je Ankündigungsbild dessen Wetter-Konfiguration (aus der
    Projektdatei). Nur Bilder mit aktiviertem Wetter und Standort zählen.

    Die Überschrift ist mehrsprachig: entweder ein String (legacy) oder ein
    {Sprache: Text}-Dict. Das Display wählt die passende Sprache selbst.
    """
    out: dict = {}
    for m in items:
        if m.type != "image" or not m.project_file:
            continue
        project = load_project(m) or {}
        w = project.get("weather") or {}
        location = (w.get("location") or "").strip()
        if not w.get("enabled") or not location:
            continue
        heading = w.get("heading") or ""
        if isinstance(heading, dict):
            heading = {k: str(v).strip() for k, v in heading.items() if v}
        else:
            heading = str(heading).strip()
        out[m.id] = {
            "enabled": True,
            "location": location,
            "heading": heading,
        }
    return out


def _playlist():
    """Aktive Bilder und Videos in zentraler Sortierreihenfolge."""
    rows = db.session.execute(
        select(Media)
        .where(Media.active.is_(True))
        .order_by(Media.sort_order.asc(), Media.id.asc())
    ).scalars().all()
    return [m for m in rows if m.type in ("image", "video")]


def _item_duration(item: Media, slide_duration: int) -> float:
    """Zentrale Anzeigedauer eines Mediums (Sekunden)."""
    if item.type == "video":
        return float(item.duration) if item.duration else DEFAULT_VIDEO_DURATION
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
    # wird eingeblendet, sobald das Interstitial aktiv ist – auch wenn das
    # kleine Widget während der Medien ausgeschaltet ist.
    clock_on = settings.get("clock_interstitial", "false") == "true"
    weather_on = settings.get("weather_interstitial", "false") == "true"

    def interstitial_slots():
        """Uhr- und Wetter-Zwischenansicht – einzeln, nie zusammen groß."""
        out = []
        if clock_on:
            out.append({"type": "clock", "id": None, "name": "", "url": "",
                        "duration": float(slide)})
        if weather_on:
            out.append({"type": "weather", "id": None, "name": "", "url": "",
                        "duration": float(slide)})
        return out

    def announcement_weather_slot(item):
        """Eigene Wetterseite eines Ankündigungsbildes (oder None)."""
        config = aw_configs.get(item.id)
        if not config:
            return None
        heading = config.get("heading") or ""
        return {
            "type": "weather-announcement",
            "id": item.id,
            "name": heading or item.name,
            "url": "",
            "duration": float(slide),
            "location": config["location"],
            "heading": heading,
        }

    slots = []
    for item in items:
        slots.append({
            "type": item.type,
            "id": item.id,
            "name": item.name,
            "url": f"/media/{item.type}/{item.stored_name}",
            "languages": {
                lang: f"/media/{item.type}/{name}"
                for lang, name in (item.language_files_dict() or {}).items()
            },
            "duration": _item_duration(item, slide),
        })
        # Direkt nach dem Ankündigungsbild dessen eigene Wetterseite einfügen.
        aw = announcement_weather_slot(item)
        if aw:
            slots.append(aw)
        if (clock_on or weather_on) and len(items) > 1:
            slots.extend(interstitial_slots())

    # Ein einzelnes Medium wiederholt sich ohne Zwischenansicht.
    if (clock_on or weather_on) and len(items) == 1 and loop:
        slots.extend(interstitial_slots())

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
        f"{m_id}:{cfg.get('enabled')}:{cfg.get('location')}:{cfg.get('heading')}"
        for m_id, cfg in aw_configs.items()
    )
    return "|".join([
        playlist,
        announce,
        str(settings.get("slide_duration", "8")),
        str(settings.get("loop", "true")),
        str(settings.get("clock_interstitial", "false")),
        str(settings.get("weather_interstitial", "false")),
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
        out[m.id] = {
            "location": config["location"],
            "heading": config["heading"],
            "weather": weather_svc.get_location_weather_snapshot(config["location"]),
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
    items = [m for m in rows if m.type in ("image", "video")]
    configs = _announcement_configs(items)
    for m in items:
        config = configs.get(m.id)
        if not config:
            continue
        try:
            weather_svc.get_location_weather(config["location"])
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

    items = [m for m in rows if m.type in ("image", "video")]
    audio = [m.to_dict() for m in rows if m.type == "audio"]

    return {
        "settings": settings,
        "media": [m.to_dict() for m in items],
        "audio": audio,
        "weather": weather_svc.get_weather_snapshot(settings.get("weather_city", "")),
        "announcement_weather": build_announcement_weather(items),
        "timeline": build_timeline(items, settings),
    }
