# Digital Signage – Digitales Anzeigesystem

Eine moderne, professionelle Webanwendung für **Ubuntu (Linux)**, die als
**Digital-Signage-System** dient. Besucher sehen ausschließlich den
öffentlichen Anzeigebildschirm – Administratoren verwalten Medien,
Wiedergabe und Benutzer über ein dunkles, modernes Dashboard.

> Läuft direkt auf einem Ubuntu-Server/-Container (LXC, Proxmox, VM) und
> optional auch als Docker-Container.

---

## Inhaltsverzeichnis

1. [Funktionen](#funktionen)
2. [Technologien](#technologien)
3. [Projektstruktur](#projektstruktur)
4. [Schnellstart](#schnellstart)
5. [Installation in einem Ubuntu-Container (ausführlich)](#installation-in-einem-ubuntu-container-ausführlich)
6. [Docker (optional)](#docker-optional)
7. [Konfiguration (.env)](#konfiguration-env)
8. [Kiosk-Modus am Monitor](#kiosk-modus-am-monitor)
9. [PWA: Installieren & Offline](#pwa-installieren--offline)
10. [Benutzer und Rollen](#benutzer-und-rollen)
11. [API-Übersicht](#api-übersicht)
12. [Sicherheit](#sicherheit)
13. [Erweiterbarkeit / neue Module](#erweiterbarkeit--neue-module)
14. [Umstellung auf MariaDB](#umstellung-auf-mariadb)
15. [Fehlerbehebung](#fehlerbehebung)
16. [Lizenz](#lizenz)

---

## Funktionen

### Öffentlicher Anzeigebildschirm (`/`)
- Vollbild-Anzeige auf einem Monitor (z. B. Chromium-Kiosk)
- Bilder (JPG, JPEG, PNG, GIF, WebP) als Diashow mit **konfigurierbarer
  Anzeigedauer** und **weichem Fade-Übergang**
- Videos (MP4, WebM) starten **automatisch** und spielen nacheinander
- Hintergrundmusik (MP3, WAV, OGG) dauerhaft im Hintergrund
- **Uhr + Datum**, die sich jede Sekunde aktualisiert:
  - **Größe** frei skalierbar über Schieberegler (30–600 %)
  - **Position** automatisch (ohne Medien mittig, mit Medien unten rechts)
    oder **frei wählbar** über **Drag & Drop** in der Live-Vorschau
    (Position wird sofort gespeichert)
  - **Zwischenansicht** (Interstitial): Uhr-Ansicht zwischen den Medien
  - ohne Medien: große Uhr mittig über den gesamten Bildschirm
- **Wetter-Widget** (optional): Ort, Temperatur und Zustand für heute und
  morgen – automatisch über Open-Meteo (kostenlos, ohne API-Schlüssel)
  oder manuell gepflegt; **zwei Darstellungen** (klein: Symbol + Temperatur,
  groß: Überschrift, großes Symbol, Beschreibung), Größe und Position wie
  bei der Uhr frei einstellbar
- **Zweisprachig** (🇩🇪 Deutsch / 🇬🇧 Englisch): Wochentage, „Heute"/„Morgen"
  und Wetterzustände werden in der gewählten Sprache angezeigt – Wechsel
  per Sprach-Schalter auf der Anzeige, **ohne Neuladen**
- **PWA / installierbar** (Windows, macOS, Linux, iOS, Android): als App
  auf den Homescreen/Desktop legen, **offline-fähig** (Anzeige + zuletzt
  geladene Medien bleiben ohne Internet sichtbar)
- **Medien einzeln ein-/ausblenden** (pro Datei, ohne Löschen)
- Erkennt automatisch neue/geänderte Medien (aktualisiert sich alle 30 s)

### Anmeldung (`/login`)
- Modernes Login mit Benutzername + Passwort
- Passwörter werden **mit bcrypt gehasht**, niemals im Klartext gespeichert

### Administrationsbereich
- **Dashboard:** Anzahl Bilder/Videos/Audiodateien/Benutzer, verwendeter und
  freier Speicherplatz, letzte Uploads, **Live-Vorschau** der aktuellen
  Anzeige (Uhr/Wetter/aktive Medien als eingebetteter Bildschirm)
- **Medienverwaltung:** Hochladen, Löschen, Ersetzen, Umbenennen, Sortieren
  (Drag & Drop + Pfeiltasten), Vorschau, **Ein/Aus-Schalter pro Datei**
- **Wiedergabe-Einstellungen:** Anzeigedauer, Übergang, Autoplay, Loop,
  Lautstärke, Hintergrundmusik, **Widgets** (Uhr und Wetter: aktiv,
  Größe per Schieberegler bis 600 %, Position automatisch oder per
  **Drag & Drop** in der Vorschau, wird sofort gespeichert) – mit
  **Live-Vorschau**, die exakt wie die Anzeige rendert (gleiche Symbole,
  Übersetzungen, Zustände) und jede Änderung in Echtzeit zeigt
- **Wetterdaten:** automatisch abrufen (Open-Meteo) oder **manuell pflegen**
  (Wetterzustand + Temperatur pro Tag, Symbol wird automatisch angezeigt)
- **Benutzerverwaltung:** Benutzer anlegen/löschen, Passwort ändern,
  Rollen vergeben, Benutzer deaktivieren

### Sicherheit
- bcrypt-Passwort-Hashing
- Serverseitige Sessions (HttpOnly-Cookie)
- CSRF-Schutz für alle schreibenden Anfragen
- Upload-Validierung (Whitelist von Dateiendungen, Größenlimits,
  UUID-Dateinamen, kein Ausführen hochgeladener Dateien)

---

## Technologien

| Bereich   | Technologie                                  |
|-----------|----------------------------------------------|
| Backend   | Python, Flask, Flask-SQLAlchemy              |
| Frontend  | HTML, CSS, JavaScript (Vanilla), Jinja2      |
| Datenbank | SQLite (später auf MariaDB umstellbar)       |
| Server    | Waitress (Produktion)                        |
| Betrieb   | Ubuntu/Debian, systemd oder Docker           |

---

## Projektstruktur

```
anzeige/
├── backend/                    # Flask-Backend
│   ├── routes/                 #   URL-Routen (modular, je ein Bereich)
│   │   ├── public.py           #     Anzeigebildschirm (öffentlich)
│   │   ├── auth.py             #     Login / Logout
│   │   ├── dashboard.py        #     Übersicht
│   │   ├── media.py            #     Medienverwaltung
│   │   ├── settings.py         #     Wiedergabe-Einstellungen
│   │   ├── weather.py          #     Wetterdaten (öffentlich + Admin)
│   │   └── users.py            #     Benutzerverwaltung
│   ├── services/               #   Geschäftslogik (Media, Settings, Weather)
│   ├── __init__.py             #   App-Factory
│   ├── config.py               #   Konfiguration (Umgebungsvariablen)
│   ├── database.py             #   Datenbank-Objekt
│   ├── models.py               #   Datenmodelle (User, Media, Setting, WeatherData)
│   ├── security.py             #   Auth, Rollen, CSRF
│   └── wsgi.py                 #   WSGI-Entrypoint
├── frontend/                   # Web-Frontend
│   ├── static/
│   │   ├── css/                #   style.css (Admin), display.css (Anzeige)
│   │   ├── js/                 #   admin.js, display.js
│   │   ├── icons/              #   PWA-Icons (192/512/maskable/180)
│   │   ├── manifest.json       #   PWA-Manifest
│   │   └── sw.js               #   Service Worker (Offline)
│   └── templates/              #   HTML-Templates (Jinja2)
├── uploads/                    # Hochgeladene Medien
│   ├── images/
│   ├── videos/
│   └── audio/
├── database/                   # SQLite-Datenbankdatei
├── scripts/
│   └── create_admin.py         # Benutzer/Konto-Verwaltung (CLI)
├── run.py                      # Produktionsserver (Waitress)
├── requirements.txt
├── install.sh                  # Automatische Installation
├── Dockerfile                  # Optionaler Docker-Container
├── .env.example                # Vorlage für die .env-Datei
├── .gitignore
├── LICENSE
└── README.md
```

---

## Schnellstart

Lokal auf einem Ubuntu-Rechner:

```bash
cd /pfad/zu/anzeige
sudo bash install.sh
```

Danach:
- Dashboard: `http://<ip>:5000/login`
- Anzeige:   `http://<ip>:5000/`

---

## Installation in einem Ubuntu-Container (ausführlich)

Die Anwendung wurde für Ubuntu-Container entwickelt (LXC, Proxmox, Docker,
einfache VM). Zwei Wege sind möglich:

- **Variante A:** Dateien auf den Container hochladen (Windows → Container)
- **Variante B:** Projekt per GitHub klonen

### Variante A – Dateien hochladen (z. B. von Windows)

#### Schritt 1: Projektordner auf den Container übertragen

Dein Projektordner heißt z. B. `Anzeigebildschirm`. Übertrage den gesamten
Ordner in den Container.

**Per SCP (von PowerShell/Terminal auf deinem Rechner):**

```powershell
# In das übergeordnete Verzeichnis wechseln (in dem "Anzeigebildschirm" liegt)
cd C:\Users\tiger\Desktop

# Upload als Benutzer "ubuntu" auf den Container mit IP 192.168.1.50
scp -r .\Anzeigebildschirm ubuntu@192.168.1.50:/home/ubuntu/anzeige
```

**Per LXC/PROXMOX (vom Host aus):**

```bash
# Auf dem LXC-Host (Proxmox-Terminal):
lxc file push -r /mnt/pfad/Anzeigebildschirm anzeige/root/anzeige
```

**Oder direkt im Container:** Wenn du einen Datei-Manager (z. B. SFTP,
WinSCP, Drag & Drop) verwendest, ziehe den Projektordner einfach in
`/home/ubuntu/anzeige` (oder `/opt/anzeige`).

#### Schritt 2: In den Container einloggen

```bash
ssh ubuntu@192.168.1.50
```

bzw. bei LXC:

```bash
lxc exec anzeige -- bash
```

#### Schritt 3: Installationsskript ausführen

> Das Skript **`install.sh`** übernimmt alles automatisch: Systempakete,
> Python-Virtualenv, Abhängigkeiten, Verzeichnisse, `.env` mit sicherer
> SECRET_KEY, Administrator-Konto und optional systemd-Dienst + Chromium.

```bash
cd /home/ubuntu/anzeige
chmod +x install.sh
sudo bash install.sh
```

**Hinweis:** Falls du die Dateien unter Windows bearbeitet hast und Fehler
wie „bad interpreter“ auftreten, Zeilenenden korrigieren:

```bash
sed -i 's/\r$//' install.sh
sudo bash install.sh
```

#### Schritt 4: Abfragen beantworten

Das Skript fragt interaktiv ab:

```
Systemd-Dienst einrichten und automatisch starten? [J/n]   → Enter (Ja)
Chromium für den Kiosk-Anzeigemodus installieren? [j/N]    → j, wenn ein Monitor angeschlossen ist
```

Danach fragt das Skript nach **Benutzername und Passwort** für das
Administrator-Konto.

#### Schritt 5: Zugreifen

```
Dashboard (Login):   http://<container-ip>:5000/login
Anzeigebildschirm:   http://<container-ip>:5000/
```

**Tipp:** LXC-Container IP anzeigen mit: `lxc list`

### Variante B – Per GitHub klonen

```bash
git clone https://github.com/DEIN_BENUTZER/anzeige.git
cd anzeige
sudo bash install.sh
```

### Manueller Start (ohne systemd)

```bash
cd /home/ubuntu/anzeige
sudo .venv/bin/python run.py
```

bzw. im Hintergrund:

```bash
sudo nohup .venv/bin/python run.py > /var/log/anzeige.log 2>&1 &
```

---

## Docker (optional)

Statt der direkten Installation kann auch ein Docker-Image gebaut werden:

```bash
docker build -t anzeige .
```

Starten (mit Datenträgern für dauerhafte Speicherung):

```bash
docker run -d --name anzeige -p 5000:5000 \
  -e SECRET_KEY=$(openssl rand -hex 32) \
  -v anzeige_uploads:/app/uploads \
  -v anzeige_db:/app/database \
  --restart unless-stopped anzeige
```

Im laufenden Container ein Administrator-Konto anlegen:

```bash
docker exec -it anzeige python scripts/create_admin.py
```

---

## Konfiguration (.env)

Die Datei `.env` liegt im Projekt-Root und wird automatisch geladen.
Vorlage: `.env.example`. Das Installationsskript erzeugt sie automatisch.

| Variable      | Bedeutung                                  | Standard   |
|---------------|--------------------------------------------|------------|
| `SECRET_KEY`  | Signiert Session-Cookies (unbedingt setzen) | –          |
| `HOST`        | Binde-Adresse                              | `0.0.0.0`  |
| `PORT`        | Port                                       | `5000`     |
| `COOKIE_SECURE` | `true`, wenn hinter HTTPS               | `false`    |
| `DATABASE_URL`  | optional, z. B. MariaDB                 | SQLite     |

Beispiel:

```dotenv
SECRET_KEY=3f2a9c…(64 hex Zeichen)
HOST=0.0.0.0
PORT=5000
```

---

## Kiosk-Modus am Monitor

Damit die Anzeige automatisch als Vollbild auf einem Monitor läuft,
Chromium im Kiosk-Modus starten (auf dem Gerät mit dem Monitor):

```bash
chromium --kiosk --noerrdialogs --disable-infobars \
         --autoplay-policy=no-user-gesture-required \
         --window-size=1920,1080 \
         http://<container-ip>:5000/
```

> `--autoplay-policy=no-user-gesture-required` ist wichtig, damit Videos und
> Musik ohne Klick automatisch starten.

---

## PWA: Installieren & Offline

Die Anzeige ist eine **Progressive Web App (PWA)**: Sie lässt sich auf jedem
Gerät als Vollbild-App installieren und funktioniert teilweise **ohne
Internet**.

### Auf dem Gerät installieren

- **Windows/macOS/Linux (Chromium/Edge/Chrome):** Anzeige öffnen
  (`http://<ip>:5000/`), in der Adressleiste das Installations-Symbol
  (PC-Monitor) wählen.
- **iOS (Safari):** „Teilen“ → „Zum Home-Bildschirm“.
- **Android (Chrome):** Menü → „Zum Startbildschirm hinzufügen“ / „App installieren“.

So läuft die Anzeige im Vollbild ohne Adressleiste (Kiosk-Ersatz, z. B.
`chromium --kiosk` ist dann nicht mehr nötig).

### Was offline funktioniert

- Startseite, Design und Skripte sind im Cache vorgeladen.
- `/api/display` und `/api/weather` werden als Netzwerk-zuerst gecacht:
  ohne Internet wird der **letzte Stand** angezeigt.
- Bereits geladene Medien werden beim Abspielen mitgecacht und bleiben
  offline abspielbar.
- Der **Admin-Bereich wird nie gecacht** (Login/Session bleiben serverseitig
  geschützt).

### Sprache wechseln

Der Sprach-Schalter **DE/EN** (unten links auf der Anzeige) wechselt
Wochentage, Datum und Wettertexte **sofort ohne Neuladen**. Die Auswahl wird
im Browser gespeichert (`localStorage`) und beim nächsten Öffnen übernommen.
Weitere Sprachen lassen sich ohne Admin-Änderung ergänzen (im
`I18N`-Objekt von `frontend/static/js/display.js`).

---

## Benutzer und Rollen

| Rolle | Rechte                                                        |
|-------|---------------------------------------------------------------|
| **Administrator** | Vollzugriff (Medien, Einstellungen, Benutzer)      |
| **Editor**        | Medien + Wiedergabe-Einstellungen, keine Benutzer  |
| **Viewer**        | Nur das Dashboard ansehen                          |

Schutzregeln in der Benutzerverwaltung:
- Das eigene Konto kann nicht gelöscht, deaktiviert oder degradiert werden.
- Der letzte Administrator kann nicht gelöscht/degradiert werden.

Weitere Benutzer anlegen:
- Über die Weboberfläche (Benutzer → „Neuer Benutzer“) **oder**
- Per Kommandozeile:

```bash
cd /home/ubuntu/anzeige
.venv/bin/python scripts/create_admin.py --username max --password geheim --role editor
```

---

## API-Übersicht

| Methode | Pfad                                   | Zugriff              | Zweck                        |
|---------|----------------------------------------|----------------------|------------------------------|
| GET     | `/`                                    | öffentlich           | Anzeigebildschirm            |
| GET     | `/sw.js`                               | öffentlich           | Service Worker (PWA)         |
| GET     | `/static/manifest.json`                | öffentlich           | PWA-Manifest                 |
| GET     | `/api/display`                         | öffentlich           | Daten für den Player (Medien + Uhr/Wetter-Einstellungen) |
| GET     | `/media/<typ>/<datei>`                 | öffentlich           | Medien ausliefern            |
| GET     | `/api/weather`                         | öffentlich           | Wetterdaten + Widget-Einstellungen |
| POST    | `/login` · `/logout`                   | –                    | An-/Abmeldung                |
| GET     | `/dashboard`                           | alle Rollen          | Statistik-Seite              |
| GET     | `/api/media?type=…`                    | admin/editor         | Medienliste                  |
| POST    | `/api/media/upload`                    | admin/editor         | Datei hochladen              |
| POST    | `/api/media/<id>/delete`               | admin/editor         | Datei löschen                |
| POST    | `/api/media/<id>/rename`               | admin/editor         | Umbenennen                   |
| POST    | `/api/media/<id>/replace`              | admin/editor         | Datei ersetzen               |
| POST    | `/api/media/<id>/active`               | admin/editor         | Medium ein-/ausblenden       |
| POST    | `/api/media/reorder`                   | admin/editor         | Reihenfolge speichern        |
| GET/POST| `/api/settings`                        | admin/editor         | Einstellungen lesen/speichern|
| POST    | `/api/weather/refresh`                 | admin/editor         | Wetter von Open-Meteo holen  |
| POST    | `/api/weather`                         | admin/editor         | Wetter manuell speichern     |
| GET     | `/api/users`                           | admin                | Benutzerliste                |
| POST    | `/api/users`                           | admin                | Benutzer anlegen             |
| POST    | `/api/users/<id>/…`                    | admin                | löschen/rolle/aktiv/passwort |

---

## Sicherheit

- **Passwörter:** bcrypt-Hash, nie im Klartext
- **Sessions:** serverseitig, HttpOnly, SameSite=Lax; `COOKIE_SECURE=true`
  hinter HTTPS empfohlen
- **CSRF:** Token bei jeder Schreiboperation (Formularfeld oder
  `X-CSRF-Token`-Header)
- **Uploads:**
  - Whitelist der Dateiendungen (keine ausführbaren Formate)
  - Größenlimits (Bilder 20 MB, Videos 500 MB, Audio 100 MB)
  - Zufällige UUID-Dateinamen, kein Pfad-Traversal möglich
  - Auslieferung mit `X-Content-Type-Options: nosniff`
  - Dateien werden vom Server **niemals ausgeführt**
- **Rollen:** Backend-seitige Prüfung aller Admin-Seiten und API-Routen

---

## Erweiterbarkeit / neue Module

Die Architektur ist modular. Neue Bereiche (Nachrichten, Kalender, RSS,
Webseiten, Live-Dashboards, Präsentationen, PDF, PowerPoint …) fügst du wie
folgt hinzu:

1. Neue Datei `backend/routes/neu.py` mit einem Blueprint anlegen
2. In `backend/__init__.py` registrieren:
   ```python
   from .routes import neu
   app.register_blueprint(neu.bp)
   ```
3. Neues Template unter `frontend/templates/` ablegen
4. Optional neue Module als „Modul“ im Anzeigebereich ergänzen

Das **Wetter-Widget** ist bereits als vollständiges Beispiel umgesetzt:
Modell (`WeatherData` in `backend/models.py`), Dienst
(`backend/services/weather.py`), Routen (`backend/routes/weather.py`) und
Frontend (Widget in `display.js`/`display.css` + Verwaltung in der
Wiedergabe-Seite).

Die Datenbankmodelle sind in `backend/models.py` zentral und werden beim
Start automatisch angelegt (`db.create_all()`). Für Schema-Änderungen in
bestehenden Tabellen führt die App beim Start eine minimale Migration aus
(siehe `_migrate_schema()` in `backend/__init__.py`). Für umfangreichere
Änderungen später Alembic-Migrationen hinzufügen.

---

## Umstellung auf MariaDB

1. Treiber installieren: `pip install pymysql`
2. Datenbank und Benutzer in MariaDB anlegen
3. In `.env` setzen:

```dotenv
DATABASE_URL=mysql+pymysql://benutzer:passwort@localhost:3306/anzeige
```

4. App neu starten – alle Modelle werden automatisch angelegt.

> SQLite-Daten vorher exportieren/importieren, falls vorhanden.

---

## Fehlerbehebung

| Problem                                  | Lösung                                                        |
|------------------------------------------|---------------------------------------------------------------|
| `bad interpreter` beim Skript            | `sed -i 's/\r$//' install.sh` ausführen, dann neu starten     |
| Port 5000 belegt                         | In `.env` `PORT` ändern, Dienst neu starten                   |
| Videos/Musik starten nicht automatisch   | Kiosk mit `--autoplay-policy=no-user-gesture-required` starten|
| Kein Administrator-Login möglich         | `sudo .venv/bin/python scripts/create_admin.py` ausführen     |
| Änderungen in der DB wirken nicht        | Dienst neu starten: `sudo systemctl restart anzeige`          |
| Fehler im Log                             | `journalctl -u anzeige -f`                                    |
| Permissions-Fehler bei Uploads           | `sudo chown -R $(whoami) uploads database`                    |

---

## Lizenz

[MIT](LICENSE) – frei verwendbar und erweiterbar.
