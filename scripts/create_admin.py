#!/usr/bin/env python3
"""
Erstellt einen Benutzer (Standard: Administrator) bzw. aktualisiert dessen
Passwort und Rolle, falls er bereits existiert.

Aufruf (interaktiv):
    .venv/bin/python scripts/create_admin.py

Aufruf (mit Argumenten):
    .venv/bin/python scripts/create_admin.py --username admin --password geheim

Alternativ über Umgebungsvariablen:
    ANZEIGE_ADMIN_USER=admin ANZEIGE_ADMIN_PASS=geheim .venv/bin/python scripts/create_admin.py
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

# Projekt-Root in den Import-Pfad aufnehmen
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import create_app  # noqa: E402
from backend.database import db  # noqa: E402
from backend.models import User  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Benutzer anlegen oder aktualisieren.")
    parser.add_argument("--username", help="Benutzername (Standard: admin)")
    parser.add_argument("--password", help="Passwort (sonst interaktive Abfrage)")
    parser.add_argument("--role", default="admin", choices=User.ROLES,
                        help="Rolle (admin/editor/viewer)")
    args = parser.parse_args()

    username = args.username or os.environ.get("ANZEIGE_ADMIN_USER")
    password = args.password or os.environ.get("ANZEIGE_ADMIN_PASS")

    if not username:
        username = input("Benutzername [admin]: ").strip() or "admin"
    if not password:
        password = getpass.getpass("Passwort: ")

    if len(password) < 6:
        print("Fehler: Das Passwort muss mindestens 6 Zeichen lang sein.", file=sys.stderr)
        sys.exit(1)

    app = create_app()
    with app.app_context():
        user = User.query.filter_by(username=username).first()
        if user is None:
            user = User(username=username, role=args.role, active=True)
            db.session.add(user)
            print(f"Benutzer „{username}“ angelegt (Rolle: {args.role}).")
        else:
            print(f"Benutzer „{username}“ existiert bereits – Passwort/Rolle werden aktualisiert.")
        user.set_password(password)
        user.role = args.role
        user.active = True
        db.session.commit()
        print("Fertig.")


if __name__ == "__main__":
    main()
