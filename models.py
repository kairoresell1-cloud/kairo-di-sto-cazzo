"""
models.py — Kairo Redeem database models
"""
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
import secrets
import string
import os

db = SQLAlchemy()


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id          = db.Column(db.Integer, primary_key=True)
    google_id   = db.Column(db.String(100), unique=True, nullable=False)
    email       = db.Column(db.String(200), unique=True, nullable=False)
    name        = db.Column(db.String(200))
    avatar_url  = db.Column(db.String(500))
    is_admin    = db.Column(db.Boolean, default=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    keys = db.relationship("Key", backref="user", foreign_keys="Key.redeemed_by_id", lazy=True)

    @property
    def is_owner(self):
        owner_emails = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]
        return self.email in owner_emails

    def to_dict(self):
        return {
            "id":         self.id,
            "email":      self.email,
            "name":       self.name,
            "avatar_url": self.avatar_url,
            "is_admin":   self.is_admin,
            "is_owner":   self.is_owner,
        }


class CookiePool(db.Model):
    __tablename__ = "cookies_pool"

    id                = db.Column(db.Integer, primary_key=True)
    service           = db.Column(db.String(20), default="netflix")
    
    # Netflix columns
    netflix_id        = db.Column(db.String(1000), unique=True, nullable=True)
    secure_netflix_id = db.Column(db.String(1000))
    nfvdid            = db.Column(db.String(1000))
    optanon_consent   = db.Column(db.Text)
    
    # Spotify columns
    sp_dc             = db.Column(db.String(1000), unique=True, nullable=True)
    sp_t              = db.Column(db.String(1000))
    sp_key            = db.Column(db.String(1000))
    
    is_valid          = db.Column(db.Boolean, default=True)
    added_at          = db.Column(db.DateTime, default=datetime.utcnow)
    last_checked_at   = db.Column(db.DateTime)

    keys = db.relationship("Key", backref="cookie", lazy=True)

    def to_cookie_dict(self):
        """Return as dict compatible with generate_nftoken or generate_spotify_link."""
        svc = self.service or "netflix"
        if svc == "spotify":
            d = {"sp_dc": self.sp_dc}
            if self.sp_t: d["sp_t"] = self.sp_t
            if self.sp_key: d["sp_key"] = self.sp_key
            return d
            
        d = {"NetflixId": self.netflix_id}
        if self.secure_netflix_id:
            d["SecureNetflixId"] = self.secure_netflix_id
        if self.nfvdid:
            d["nfvdid"] = self.nfvdid
        if self.optanon_consent:
            d["OptanonConsent"] = self.optanon_consent
        return d


class Key(db.Model):
    __tablename__ = "keys"

    id              = db.Column(db.Integer, primary_key=True)
    key_code        = db.Column(db.String(50), unique=True, nullable=False)
    service         = db.Column(db.String(20), default="netflix")
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)
    redeemed_at     = db.Column(db.DateTime)
    redeemed_by_id  = db.Column(db.Integer, db.ForeignKey("users.id"))
    cookie_id       = db.Column(db.Integer, db.ForeignKey("cookies_pool.id"))
    is_revoked      = db.Column(db.Boolean, default=False)

    @property
    def is_available(self):
        return not self.is_revoked and self.redeemed_by_id is None

    @property
    def is_redeemed(self):
        return self.redeemed_by_id is not None and not self.is_revoked

    def to_dict(self, include_user=False):
        d = {
            "id":           self.id,
            "key_code":     self.key_code,
            "service":      self.service or "netflix",
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "redeemed_at":  self.redeemed_at.isoformat() if self.redeemed_at else None,
            "is_revoked":   self.is_revoked,
            "is_available": self.is_available,
            "cookie_valid": self.cookie.is_valid if self.cookie else False,
        }
        if include_user and self.user:
            d["user_email"] = self.user.email
            d["user_name"]  = self.user.name
        return d


# ── Helpers ────────────────────────────────────────────────────────────────────

def generate_key_code() -> str:
    """Generate a key in format KAIRO-XXXX-XXXX-XXXX (no ambiguous chars)."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
    parts = ["".join(secrets.choice(chars) for _ in range(4)) for _ in range(3)]
    return f"KAIRO-{'-'.join(parts)}"


def get_valid_cookie_for_key(key: Key):
    """
    Return a valid cookie for this key.
    If the current cookie is invalid/missing, rotate to a fresh one from the pool.
    """
    if key.cookie and key.cookie.is_valid:
        return key.cookie

    old_cookie = key.cookie
    if old_cookie:
        old_cookie.is_valid = False

    from sqlalchemy import or_
    svc = key.service or "netflix"
    if svc == "netflix":
        svc_filter = or_(CookiePool.service == "netflix", CookiePool.service.is_(None))
    else:
        svc_filter = (CookiePool.service == svc)

    # 1. Try to find a valid cookie that isn't assigned to another active key
    used_ids = db.session.query(Key.cookie_id).filter(
        Key.cookie_id.isnot(None),
        Key.id != key.id,
        Key.is_revoked == False,
    ).subquery()

    fresh = CookiePool.query.filter(
        CookiePool.is_valid == True,
        svc_filter,
        ~CookiePool.id.in_(used_ids),
    ).first()

    # 2. If none unused, fallback to any valid cookie in the pool
    if not fresh:
        fresh = CookiePool.query.filter(
            CookiePool.is_valid == True,
            svc_filter
        ).first()

    # 3. Auto-recovery: If all cookies in pool were marked invalid by previous bug, resurrect to re-test
    if not fresh:
        fresh = CookiePool.query.filter(svc_filter).first()
        if fresh:
            fresh.is_valid = True

    if fresh:
        key.cookie_id = fresh.id
        fresh.is_valid = True
        db.session.commit()
        return fresh

    return None

