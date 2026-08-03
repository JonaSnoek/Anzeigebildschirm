"""
Routen-Paket. Jede Datei enthält einen Blueprint für einen Bereich:

- public:    Anzeigebildschirm + Medien-Auslieferung (öffentlich)
- auth:      Login/Logout
- dashboard: Übersichtsseite
- media:     Medienverwaltung
- settings:  Wiedergabe-Einstellungen
- users:     Benutzerverwaltung

Neue Module (Wetter, Nachrichten, Kalender, RSS, …) fügt man einfach als
weitere Blueprint-Datei hier hinzu und registriert sie in create_app().
"""
