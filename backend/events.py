"""
Echtzeit-Verteiler (Server-Sent Events) für die Anzeigebildschirme.

Ein einfacher In-Process-Pub/Sub-Hub: Jeder SSE-Client bekommt eine Queue,
auf die `publish()` Ereignisse legt. Der Hub lebt innerhalb eines
Server-Prozesses (Waitress mit Threads); für mehrere Worker-Prozesse wäre
ein externer Broker (z. B. Redis) nötig.

`notify_display()` wird nach jeder Änderung an Einstellungen, Medien oder
Wetter aufgerufen und verteilt den aktuellen Anzeigezustand inkl. Timeline
an alle verbundenen Geräte – so erscheinen Änderungen ohne Neuladen.
"""

import queue
import threading
import time


class Hub:
    """Pub/Sub-Verteiler für SSE-Clients (Thread-sicher)."""

    def __init__(self) -> None:
        self._subscribers: set = set()
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue:
        """Registriert einen neuen Client und liefert seine Ereignis-Queue."""
        q = queue.Queue()
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        """Entfernt einen Client (bei Verbindungsabbruch)."""
        with self._lock:
            self._subscribers.discard(q)

    def publish(self, payload: dict) -> None:
        """Verteilt ein Ereignis an alle verbundenen Clients."""
        with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            q.put_nowait(payload)


hub = Hub()


def notify_display() -> None:
    """Verteilt den aktuellen Anzeigezustand (inkl. Timeline) an alle Clients."""
    try:
        from .services.display import build_state  # lokaler Import (kein Zyklus)

        data = build_state()
    except Exception:  # noqa: BLE001 – Broadcast darf Anfragen nie brechen
        return
    hub.publish({"kind": "state", "data": data, "ts": time.time()})
