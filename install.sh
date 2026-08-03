#!/usr/bin/env bash
#
# ======================================================================
#  Digital Signage – Installationsskript (Ubuntu / Debian)
# ======================================================================
#
#  Ausführen im Projektverzeichnis:
#      sudo bash install.sh
#
#  Das Skript:
#    1. installiert benötigte Systempakete (python3, venv, pip)
#    2. erstellt eine virtuelle Python-Umgebung (.venv)
#    3. installiert die Abhängigkeiten aus requirements.txt
#    4. legt Upload- und Datenbank-Verzeichnisse an
#    5. erzeugt eine sichere SECRET_KEY in der .env-Datei
#    6. erstellt ein Administrator-Konto
#    7. richtet optional einen systemd-Dienst ein
#    8. installiert optional Chromium für den Kiosk-Anzeigemodus
# ======================================================================

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$INSTALL_DIR/.venv"
SERVICE_NAME="anzeige"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

log()  { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
info() { printf '\033[1;33m[hinweis]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fehler]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. Root-Check ----------------------------------------------------------
if [[ "$(id -u)" -ne 0 ]]; then
  die "Bitte mit sudo ausführen:  sudo bash install.sh"
fi

# --- 2. Ubuntu/Debian-Check -------------------------------------------------
if ! command -v apt-get >/dev/null 2>&1; then
  die "apt-get wurde nicht gefunden – dieses Skript unterstützt nur Debian/Ubuntu."
fi

# --- 3. Systempakete ---------------------------------------------------------
log "System wird aktualisiert und benötigte Pakete werden installiert …"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip \
  openssl curl ca-certificates

# --- 4. Python-Virtualenv ----------------------------------------------------
log "Python-Umgebung (.venv) wird erstellt …"
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --upgrade pip --quiet
"$VENV_DIR/bin/pip" install -r "$INSTALL_DIR/requirements.txt" --quiet
info "Abhängigkeiten installiert."

# --- 5. Verzeichnisstruktur --------------------------------------------------
log "Verzeichnisstruktur wird angelegt …"
mkdir -p "$INSTALL_DIR/uploads/images" \
         "$INSTALL_DIR/uploads/videos" \
         "$INSTALL_DIR/uploads/audio" \
         "$INSTALL_DIR/database"
touch "$INSTALL_DIR/uploads/images/.gitkeep"
touch "$INSTALL_DIR/uploads/videos/.gitkeep"
touch "$INSTALL_DIR/uploads/audio/.gitkeep"

# --- 6. Konfiguration (.env) --------------------------------------------------
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  log "Sichere SECRET_KEY wird erzeugt …"
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  else
    SECRET="$(head -c 64 /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 64)"
  fi
  cat > "$INSTALL_DIR/.env" <<EOF
# Digital Signage – Umgebungskonfiguration
SECRET_KEY=$SECRET
HOST=0.0.0.0
PORT=5000
EOF
  chmod 600 "$INSTALL_DIR/.env"
  log ".env wurde mit sicherer SECRET_KEY erstellt."
else
  info ".env existiert bereits – sie wird nicht überschrieben."
fi

# --- 7. Administrator-Konto ---------------------------------------------------
log "Administrator-Konto wird angelegt bzw. aktualisiert …"
"$VENV_DIR/bin/python" "$INSTALL_DIR/scripts/create_admin.py"

# --- 8. optional: systemd-Dienst ------------------------------------------------
if command -v systemctl >/dev/null 2>&1; then
  read -r -p "Systemd-Dienst einrichten und automatisch starten? [J/n] " SETUP_SERVICE
  if [[ ! "$SETUP_SERVICE" =~ ^[Nn]$ ]]; then
    cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Digital Signage Web App
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$VENV_DIR/bin/python $INSTALL_DIR/run.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    log "Systemd-Dienst '$SERVICE_NAME' wurde eingerichtet und gestartet."
  fi
else
  info "systemd nicht verfügbar – Dienst übersprungen. Manueller Start:"
  info "  nohup $VENV_DIR/bin/python $INSTALL_DIR/run.py > /var/log/anzeige.log 2>&1 &"
fi

# --- 9. optional: Chromium (Kiosk-Anzeige) --------------------------------------
if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  read -r -p "Chromium für den Kiosk-Anzeigemodus installieren? [j/N] " SETUP_CHROMIUM
  if [[ "$SETUP_CHROMIUM" =~ ^[Jj]$ ]]; then
    apt-get install -y --no-install-recommends chromium-browser \
      || apt-get install -y --no-install-recommends chromium
  fi
fi

# --- 10. Berechtigungen ----------------------------------------------------------
chmod -R a+rX "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env"

# --- 11. Zusammenfassung ----------------------------------------------------------
PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" | head -1 | cut -d= -f2)"
PORT="${PORT:-5000}"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat <<EOF

=====================================================================
 Installation abgeschlossen
=====================================================================

  Dashboard (Login):   http://${IP}:${PORT}/login
  Anzeigebildschirm:   http://${IP}:${PORT}/

  Dienst verwalten:
    Status:  systemctl status $SERVICE_NAME
    Restart: systemctl restart $SERVICE_NAME
    Logs:    journalctl -u $SERVICE_NAME -f

  Kiosk-Modus am Monitor (optional):
    chromium --kiosk --noerrdialogs --disable-infobars \\
             --autoplay-policy=no-user-gesture-required \\
             --window-size=1920,1080 \\
             http://${IP}:${PORT}/

  Weitere Benutzer anlegen:
    $VENV_DIR/bin/python $INSTALL_DIR/scripts/create_admin.py

=====================================================================
EOF
