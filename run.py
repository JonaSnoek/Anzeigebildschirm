#!/usr/bin/env python3
"""
Startet den Produktionsserver (Waitress).

Die Werte für HOST und PORT werden aus der Umgebung bzw. der .env-Datei
gelesen (Standard: 0.0.0.0:5000).
"""

import os

from backend import create_app
from waitress import serve

app = create_app()

if __name__ == "__main__":
    serve(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5000")),
        threads=8,
    )
