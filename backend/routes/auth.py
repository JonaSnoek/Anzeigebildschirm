"""
Login und Logout.

Die Anmeldung erfolgt über eine serverseitige Session (HttpOnly-Cookie).
Passwörter werden mit bcrypt geprüft und niemals im Klartext gespeichert.
"""

from flask import Blueprint, flash, redirect, render_template, request, url_for

from ..models import User
from ..security import get_current_user, login_required, login_user, logout_user

bp = Blueprint("auth", __name__)


@bp.route("/login", methods=["GET", "POST"])
def login():
    """Anmeldeseite für Administratoren und berechtigte Benutzer."""
    if get_current_user():
        return redirect(url_for("dashboard.index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        user = User.query.filter_by(username=username).first()
        if user is not None and user.active and user.check_password(password):
            login_user(user)
            next_url = request.args.get("next")
            if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                return redirect(next_url)
            return redirect(url_for("dashboard.index"))

        flash("Benutzername oder Passwort ist falsch.", "error")

    return render_template("login.html")


@bp.post("/logout")
@login_required
def logout():
    """Beendet die Sitzung."""
    logout_user()
    return redirect(url_for("auth.login"))
