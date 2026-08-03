"""
WSGI-Entrypoint für Produktionsserver (waitress, gunicorn, …).
"""

from backend import create_app

app = create_app()
