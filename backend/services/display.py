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
from ..services.settings import get_all_settings

# Fallback-Dauer für Videos, deren echte Länge noch nicht bekannt ist.
# Sobald ein Anzeige-Client die tatsächliche Länge meldet (/api/display/report),
# wird die Timeline automatisch neu berechnet und allen Geräten übertragen.
DEFAULT_VIDEO_DURATION = 15.0

# Cache für die Zyklus-Referenz (cycle_start) – wird nur neu gesetzt, wenn
# sich die Signatur (Playlist/Einstellungen) ändert.
_cache: dict = {"signature": None, "cycle_start": 0.0}


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


def _timeline_slots(items, settings: dict):
    """
    Baut die geordnete Element-Liste (Bilder/Videos + optional Uhr-Ansichten
    zwischen den Medien) mit Start-/Endzeitpunkt innerhalb des Zyklus.
    """
    slide = int(settings.get("slide_duration", "8") or 8)
    loop = settings.get("loop", "true") != "false"
    clock_on = (
        settings.get("clock_interstitial", "false") == "true"
        and settings.get("clock_enabled", "true") != "false"
    )
    weather_on = (
        settings.get("weather_interstitial", "false") == "true"
        and settings.get("weather_enabled", "true") != "false"
    )

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

    slots = []
    for item in items:
        slots.append({
            "type": item.type,
            "id": item.id,
            "name": item.name,
            "url": f"/media/{item.type}/{item.stored_name}",
            "duration": _item_duration(item, slide),
        })
        if (clock_on or weather_on) and len(items) > 1:
            slots.extend(interstitial_slots())

    # Ein einzelnes Medium wiederholt sich ohne Zwischenansicht.
    if (clock_on or weather_on) and len(items) == 1 and loop:
        slots.extend(interstitial_slots())

    # Ohne Loop endet der Zyklus sauber beim letzten Medium.
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


def _signature(items, settings: dict) -> str:
    """Fingerabdruck der Playlist – ändert sich bei jeder Inhaltsänderung."""
    playlist = ",".join(
        f"{m.id}:{m.duration or 0}:{m.sort_order}:{m.active}" for m in items
    )
    return "|".join([
        playlist,
        str(settings.get("slide_duration", "8")),
        str(settings.get("loop", "true")),
        str(settings.get("clock_interstitial", "false")),
        str(settings.get("clock_enabled", "true")),
        str(settings.get("weather_interstitial", "false")),
        str(settings.get("weather_enabled", "true")),
    ])


def build_timeline(items, settings: dict) -> dict | None:
    """Berechnet die zentrale Timeline (oder None bei leerer Playlist)."""
    if not items:
        return None
    slots = _timeline_slots(items, settings)
    if not slots:
        return None

    cycle_duration = slots[-1]["end"]
    sig = _signature(items, settings)
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
        "timeline": build_timeline(items, settings),
    }
