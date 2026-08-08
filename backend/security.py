"""
Sicherheitsbausteine: Sitzungen, Rollen und CSRF-Schutz.

- Login über serverseitige Session (HttpOnly-Cookie)
- CSRF-Token für alle schreibenden Anfragen (Formular + Header)
- Rollen: admin (voll), editor (Medien), viewer (nur Dashboard)
"""

import secrets
from functools import wraps

from flask import abort, redirect, request, session, url_for

from .database import db
from .models import User
from .permissions import has_any_permission

# --------------------------------------------------------------------------
# CSRF-Schutz
# --------------------------------------------------------------------------

def get_csrf_token() -> str:
    """Liefert das CSRF-Token der Session (erzeugt es bei Bedarf)."""
    if "_csrf" not in session:
        session["_csrf"] = secrets.token_hex(32)
    return session["_csrf"]


def validate_csrf() -> None:
    """Globaler before_request-Hook: prüft CSRF bei allen Schreiboperationen."""
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        # Öffentliche Anzeige-Geräte melden die Videodauer ohne Login/CSRF.
        if request.endpoint == "public.report_video_duration":
            return
        token = request.form.get("_csrf_token") or request.headers.get("X-CSRF-Token")
        if not token or not secrets.compare_digest(token, session.get("_csrf", "")):
            abort(400, description="Ungültiges oder fehlendes CSRF-Token.")


# --------------------------------------------------------------------------
# Session / Authentifizierung
# --------------------------------------------------------------------------

def get_current_user() -> User | None:
    """Liefert den eingeloggten Benutzer oder None (deaktivierte ausloggen)."""
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = db.session.get(User, user_id)
    if user is None or not user.active:
        session.pop("user_id", None)
        return None
    return user


def login_user(user: User) -> None:
    """Startet eine Sitzung für den Benutzer."""
    session.permanent = True
    session["user_id"] = user.id


def logout_user() -> None:
    """Beendet die Sitzung vollständig."""
    session.clear()


# --------------------------------------------------------------------------
# Decorators
# --------------------------------------------------------------------------

def login_required(fn):
    """Erfordert einen aktiven Login."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if get_current_user() is None:
            if request.path.startswith("/api/"):
                abort(401)
            return redirect(url_for("auth.login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


def roles_required(*roles: str):
    """Erfordert einen Login mit einer der angegebenen Rollen."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if user is None:
                if request.path.startswith("/api/"):
                    abort(401)
                return redirect(url_for("auth.login", next=request.path))
            if user.role not in roles:
                abort(403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def permission_required(*perms: str):
    """Erfordert einen Login mit mindestens einem der angegebenen Rechte.

    Prüft die individuellen Berechtigungen des Benutzers (Rolle + Overrides).
    Administratoren besitzen automatisch alle Rechte.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if user is None:
                if request.path.startswith("/api/"):
                    abort(401)
                return redirect(url_for("auth.login", next=request.path))
            if not has_any_permission(user, *perms):
                abort(403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator
