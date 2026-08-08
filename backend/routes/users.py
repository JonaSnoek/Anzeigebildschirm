"""
Benutzerverwaltung: Erstellen, Löschen, Rollen, Aktiv/Inaktiv, Passwort
ändern und individuelle Berechtigungen. Zugriff je nach einzelnem Recht
(users.view / users.create / …).

Schutzregeln:
- Das eigene Konto kann weder gelöscht, deaktiviert noch umbenannt werden;
  auch die eigenen Berechtigungen können nicht selbst geändert werden.
- Der letzte verbleibende Administrator kann nicht gelöscht oder
  degradiert werden.
"""

import json

from flask import Blueprint, jsonify, render_template, request
from sqlalchemy import select

from ..database import db
from ..models import User
from ..permissions import PERMISSION_CATALOG, ROLE_TEMPLATES
from ..security import get_current_user, permission_required

bp = Blueprint("users", __name__)


@bp.get("/admin/users")
@permission_required("users.view")
def page():
    """Benutzerverwaltungsseite (inkl. Berechtigungs-Katalog fürs UI)."""
    return render_template(
        "users.html",
        catalog_json=json.dumps(PERMISSION_CATALOG, ensure_ascii=False),
        role_templates_json=json.dumps(
            {role: sorted(perms) for role, perms in ROLE_TEMPLATES.items()},
            ensure_ascii=False,
        ),
    )


@bp.get("/api/users")
@permission_required("users.view")
def list_users():
    """Liefert alle Benutzer (ohne Passwort-Hashes)."""
    users = db.session.execute(
        select(User).order_by(User.username.asc())
    ).scalars().all()
    return jsonify({"items": [u.to_dict() for u in users]})


def _admin_count() -> int:
    return User.query.filter_by(role="admin").count()


def _validate_role(role) -> bool:
    return role in User.ROLES


@bp.post("/api/users")
@permission_required("users.create")
def create_user():
    """Legt einen neuen Benutzer an."""
    data = request.get_json(silent=True) or request.form.to_dict()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role") or "viewer"

    if not (3 <= len(username) <= 64):
        return jsonify({"error": "Der Benutzername muss 3–64 Zeichen lang sein."}), 400
    if not _validate_role(role):
        return jsonify({"error": "Ungültige Rolle."}), 400
    if len(password) < 6:
        return jsonify({"error": "Das Passwort muss mindestens 6 Zeichen lang sein."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Dieser Benutzername existiert bereits."}), 400

    user = User(username=username, role=role, active=True)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify({"ok": True, "item": user.to_dict()})


@bp.post("/api/users/<int:user_id>/delete")
@permission_required("users.delete")
def delete_user(user_id):
    """Löscht einen Benutzer."""
    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "Benutzer nicht gefunden."}), 404

    current = get_current_user()
    if user.id == current.id:
        return jsonify({"error": "Du kannst dein eigenes Konto nicht löschen."}), 400
    if user.role == "admin" and _admin_count() <= 1:
        return jsonify({"error": "Der letzte Administrator kann nicht gelöscht werden."}), 400

    db.session.delete(user)
    db.session.commit()
    return jsonify({"ok": True})


@bp.post("/api/users/<int:user_id>/role")
@permission_required("users.edit")
def change_role(user_id):
    """Ändert die Rolle eines Benutzers."""
    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "Benutzer nicht gefunden."}), 404

    data = request.get_json(silent=True) or {}
    new_role = data.get("role")
    if not _validate_role(new_role):
        return jsonify({"error": "Ungültige Rolle."}), 400

    current = get_current_user()
    if user.id == current.id:
        return jsonify({"error": "Du kannst deine eigene Rolle nicht ändern."}), 400
    if user.role == "admin" and new_role != "admin" and _admin_count() <= 1:
        return jsonify({"error": "Der letzte Administrator kann seine Rolle nicht ändern."}), 400

    user.role = new_role
    db.session.commit()
    return jsonify({"ok": True, "item": user.to_dict()})


@bp.post("/api/users/<int:user_id>/active")
@permission_required("users.deactivate")
def toggle_active(user_id):
    """Aktiviert/deaktiviert einen Benutzer."""
    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "Benutzer nicht gefunden."}), 404

    current = get_current_user()
    if user.id == current.id:
        return jsonify({"error": "Du kannst dein eigenes Konto nicht deaktivieren."}), 400
    if user.role == "admin" and user.active and _admin_count() <= 1:
        return jsonify({"error": "Der letzte Administrator kann nicht deaktiviert werden."}), 400

    user.active = not user.active
    db.session.commit()
    return jsonify({"ok": True, "item": user.to_dict()})


@bp.post("/api/users/<int:user_id>/password")
@permission_required("users.edit")
def change_password(user_id):
    """Setzt ein neues Passwort für einen Benutzer."""
    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "Benutzer nicht gefunden."}), 404

    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if len(password) < 6:
        return jsonify({"error": "Das Passwort muss mindestens 6 Zeichen lang sein."}), 400

    user.set_password(password)
    db.session.commit()
    return jsonify({"ok": True})


@bp.post("/api/users/<int:user_id>/permissions")
@permission_required("users.permissions")
def change_permissions(user_id):
    """Ändert die individuellen Berechtigungen eines Benutzers.

    Body: {"permissions": {"rechts.key": true|false, …}} – Overrides zur
    Rollen-Vorlage. Administratoren behalten unabhängig davon vollen Zugriff.
    """
    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "Benutzer nicht gefunden."}), 404

    current = get_current_user()
    if user.id == current.id:
        return jsonify({"error": "Du kannst deine eigenen Berechtigungen nicht ändern."}), 400

    data = request.get_json(silent=True) or {}
    overrides = data.get("permissions")
    if not isinstance(overrides, dict):
        return jsonify({"error": "Ungültige Berechtigungsdaten."}), 400

    user.set_permissions(overrides)
    db.session.commit()
    return jsonify({"ok": True, "item": user.to_dict()})
