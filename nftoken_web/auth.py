"""
auth.py — Google OAuth2 blueprint for Kairo Redeem
"""
import os
from flask import Blueprint, redirect, url_for, session, current_app
from flask_login import login_user, logout_user
from authlib.integrations.flask_client import OAuth
from models import db, User

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")
oauth    = OAuth()


def init_oauth(app):
    """Call once during app init."""
    oauth.init_app(app)
    oauth.register(
        name="google",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


@auth_bp.route("/login")
def login():
    redirect_uri = url_for("auth.callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/callback")
def callback():
    token    = oauth.google.authorize_access_token()
    userinfo = token["userinfo"]

    google_id  = userinfo["sub"]
    email      = userinfo["email"]
    name       = userinfo.get("name", "")
    avatar_url = userinfo.get("picture", "")

    # Determine admin status from env var
    admin_emails = [
        e.strip()
        for e in os.getenv("ADMIN_EMAILS", "").split(",")
        if e.strip()
    ]
    is_owner = email in admin_emails

    # Upsert user
    user = User.query.filter_by(google_id=google_id).first()
    if not user:
        user = User(
            google_id=google_id,
            email=email,
            name=name,
            avatar_url=avatar_url,
            is_admin=is_owner, # Owners are admins by default
        )
        db.session.add(user)
    else:
        user.name       = name
        user.avatar_url = avatar_url
        if is_owner:
            user.is_admin = True # Owner always gets admin rights


    db.session.commit()
    login_user(user, remember=True)

    next_url = session.pop("login_next", None)
    if next_url:
        return redirect(next_url)
    return redirect("/admin" if user.is_admin else "/dashboard")


@auth_bp.route("/logout")
def logout():
    logout_user()
    return redirect("/")
