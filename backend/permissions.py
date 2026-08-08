"""
Individuelle Benutzer-Berechtigungen.

Die Rollen (admin / editor / viewer) bleiben als Voreinstellung bestehen
(ROLE_TEMPLATES). Jeder Benutzer kann darüber hinaus über sein Feld
``permissions`` einzelne Rechte unabhängig aktivieren oder deaktivieren
(JSON-Dict ``{"rechts.key": true|false}``).

- Rechte-Schlüssel sind stabil (z. B. ``"media.delete"``) und werden von den
  Routen serverseitig geprüft (auch gegen manuelle API-Aufrufe).
- Administratoren haben immer vollen Zugriff (unabhängig von Overrides).
- ``resolve_permissions`` liefert die effektiven Rechte eines Benutzers:
  Rollen-Vorlage + Overrides.
"""

# Kategorien mit ihren Rechten. Reihenfolge = Anzeige-Reihenfolge im UI.
# Jedes Recht ist ein Tupel (Schlüssel, Beschriftung).
PERMISSION_CATALOG = [
    {
        "key": "media",
        "label": "Medien",
        "rights": [
            ("media.view", "Ansehen"),
            ("media.create", "Hochladen"),
            ("media.edit", "Umbenennen"),
            ("media.toggle", "Aktivieren/Deaktivieren"),
            ("media.move", "Verschieben/Reihenfolge"),
            ("media.copy", "Duplizieren"),
            ("media.replace", "Ersetzen"),
            ("media.delete", "Löschen"),
        ],
    },
    {
        "key": "announcements",
        "label": "Ankündigungsbilder",
        "rights": [
            ("announcements.view", "Ansehen"),
            ("announcements.create", "Erstellen"),
            ("announcements.edit", "Bearbeiten"),
            ("announcements.toggle", "Aktivieren/Deaktivieren"),
            ("announcements.move", "Verschieben/Reihenfolge"),
            ("announcements.copy", "Duplizieren"),
            ("announcements.replace", "Ersetzen"),
            ("announcements.delete", "Löschen"),
        ],
    },
    {
        "key": "auto_slides",
        "label": "Auto-Slides",
        "rights": [
            ("auto_slides.view", "Ansehen"),
            ("auto_slides.create", "Erstellen"),
            ("auto_slides.edit", "Bearbeiten"),
            ("auto_slides.toggle", "Aktivieren/Deaktivieren"),
            ("auto_slides.move", "Verschieben/Reihenfolge"),
            ("auto_slides.copy", "Duplizieren"),
            ("auto_slides.delete", "Löschen"),
        ],
    },
    {
        "key": "settings",
        "label": "Einstellungen",
        "rights": [
            ("settings.view", "Ansehen"),
            ("settings.edit", "Wiedergabeeinstellungen ändern"),
            ("settings.widgets", "Widgets verwalten"),
            ("settings.weather", "Wetter konfigurieren"),
        ],
    },
    {
        "key": "users",
        "label": "Benutzerverwaltung",
        "rights": [
            ("users.view", "Ansehen"),
            ("users.create", "Erstellen"),
            ("users.edit", "Bearbeiten (Rolle, Passwort)"),
            ("users.permissions", "Berechtigungen ändern"),
            ("users.deactivate", "Deaktivieren/Aktivieren"),
            ("users.delete", "Löschen"),
        ],
    },
]

ALL_PERMISSIONS = {
    key for category in PERMISSION_CATALOG for key, _ in category["rights"]
}

# Rollen-Vorlagen: Ausgangspunkte für die Rechte eines Benutzers.
ROLE_TEMPLATES = {
    "admin": set(ALL_PERMISSIONS),
    "editor": {key for key in ALL_PERMISSIONS if not key.startswith("users.")},
    "viewer": set(),
}


def resolve_permissions(user) -> set:
    """Effektive Rechte eines Benutzers (Rollen-Vorlage + Overrides).

    Administratoren behalten immer den vollen Zugriff.
    """
    if user is None:
        return set()
    if getattr(user, "role", None) == "admin":
        return set(ALL_PERMISSIONS)
    perms = set(ROLE_TEMPLATES.get(getattr(user, "role", "viewer"), set()))
    for key, granted in getattr(user, "permissions_dict", lambda: {})().items():
        if key not in ALL_PERMISSIONS:
            continue
        if granted:
            perms.add(key)
        else:
            perms.discard(key)
    return perms


def has_permission(user, perm: str) -> bool:
    """True, wenn der Benutzer ein bestimmtes Recht besitzt."""
    if user is None:
        return False
    if getattr(user, "role", None) == "admin":
        return True
    return perm in resolve_permissions(user)


def has_any_permission(user, *perms: str) -> bool:
    """True, wenn mindestens eines der angegebenen Rechte vorhanden ist."""
    return any(has_permission(user, perm) for perm in perms)
