"""
Dashboard-Übersicht: Statistiken für angemeldete Benutzer.
"""

import shutil

from flask import Blueprint, render_template
from sqlalchemy import func, select

from ..config import Config
from ..database import db
from ..models import Media, User
from ..security import roles_required
from ..services.settings import get_all_settings

bp = Blueprint("dashboard", __name__)


def _human_size(num_bytes: int) -> str:
    """Formatiert Bytes lesbar (B/KB/MB/GB/TB)."""
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{num_bytes} B"


@bp.get("/dashboard")
@roles_required("admin", "editor", "viewer")
def index():
    """Zeigt Statistiken: Medien, Benutzer, Speicherplatz, letzte Uploads."""
    rows = db.session.execute(
        select(Media.type, func.count()).group_by(Media.type)
    ).all()
    counts = {media_type: int(count) for media_type, count in rows}

    used_bytes = int(
        db.session.execute(select(func.coalesce(func.sum(Media.size_bytes), 0))).scalar()
    )
    usage = shutil.disk_usage(Config.UPLOAD_DIR)

    last_uploads = db.session.execute(
        select(Media).order_by(Media.created_at.desc()).limit(5)
    ).scalars().all()

    active_media = int(
        db.session.execute(
            select(func.count()).select_from(Media).where(Media.active.is_(True))
        ).scalar()
    )

    stats = {
        "images": counts.get("image", 0),
        "videos": counts.get("video", 0),
        "audio": counts.get("audio", 0),
        "users": User.query.count(),
        "used": _human_size(used_bytes),
        "used_bytes": used_bytes,
        "total": _human_size(usage.total),
        "free": _human_size(usage.free),
        "free_percent": round(usage.free / usage.total * 100),
        "last_uploads": last_uploads,
        "human_size": _human_size,
        # Zustand der aktuellen Anzeige
        "settings": get_all_settings(),
        "active_media": active_media,
    }
    return render_template("dashboard.html", stats=stats)
