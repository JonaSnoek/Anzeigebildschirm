"""
Datenbank-Setup.

Nutzt Flask-SQLAlchemy. Durch den Austausch der DATABASE_URL in der
Konfiguration kann später problemlos von SQLite auf MariaDB o. Ä.
umgestellt werden, ohne den restlichen Code ändern zu müssen.
"""

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
