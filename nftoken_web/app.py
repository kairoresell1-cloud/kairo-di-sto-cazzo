"""
app.py — Kairo Redeem · Flask backend
Netflix NFToken platform with key management, cookie pool, Google OAuth
"""
import os, re, json, logging, secrets, urllib.parse
from datetime import datetime
from functools import wraps

import requests
from flask import Flask, request, jsonify, send_from_directory, redirect, session
from flask_login import LoginManager, login_required, current_user
from werkzeug.middleware.proxy_fix import ProxyFix
from urllib3.exceptions import InsecureRequestWarning

from models import db, User, CookiePool, Key, generate_key_code, get_valid_cookie_for_key
from auth import auth_bp, init_oauth

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)

# ── App init ───────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static")
# ProxyFix: Railway usa un reverse proxy HTTPS
# senza questo Flask genera http:// nei redirect OAuth → Google lo rifiuta
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Fix Railway postgres:// → postgresql://
_db_url = os.getenv("DATABASE_URL", "sqlite:///kairo.db")
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)

app.config.update(
    SECRET_KEY           = os.getenv("SECRET_KEY", secrets.token_hex(32)),
    SQLALCHEMY_DATABASE_URI      = _db_url,
    SQLALCHEMY_TRACK_MODIFICATIONS = False,
    GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", ""),
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", ""),
)

db.init_app(app)

login_manager = LoginManager(app)
login_manager.login_view = "auth.login"

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Non autenticato."}), 401
    session["login_next"] = request.url
    return redirect("/auth/login")

app.register_blueprint(auth_bp)
init_oauth(app)

with app.app_context():
    db.create_all()

# ── Netflix iOS API constants ───────────────────────────────────────────────────
_TOKEN_NAMES = {"NetflixId", "SecureNetflixId", "nfvdid", "OptanonConsent"}
_REQUIRED    = {"NetflixId"}
_HTTPONLY    = re.compile(r"^#HttpOnly_", re.IGNORECASE)
_COMMENT     = re.compile(r"^\s*#")

_API_URL = "https://ios.prod.ftl.netflix.com/iosui/user/15.48"
_QUERY_PARAMS = {
    "appVersion": "15.48.1",
    "config": '{"gamesInTrailersEnabled":"false","cdsMyListSortEnabled":"true","kidsBillboardEnabled":"true","billboardEnabled":"true","useCDSGalleryEnabled":"true","sharksEnabled":"true"}',
    "device_type": "NFAPPL-02-",
    "esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
    "idiom": "phone", "iosVersion": "15.8.5", "isTablet": "false",
    "languages": "en-US", "locale": "en-US", "maxDeviceWidth": "375",
    "model": "saget", "modelType": "IPHONE8-1", "odpAware": "true",
    "path": '["account","token","default"]', "pathFormat": "graph",
    "pixelDensity": "2.0", "progressive": "false", "responseFormat": "json",
}
_IOS_HEADERS = {
    "User-Agent": "Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)",
    "x-netflix.request.attempt": "1",
    "x-netflix.request.client.user.guid": "A4CS633D7VCBPE2GPK2HL4EKOE",
    "x-netflix.context.profile-guid": "A4CS633D7VCBPE2GPK2HL4EKOE",
    "x-netflix.request.routing": '{"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}',
    "x-netflix.context.app-version": "15.48.1",
    "x-netflix.argo.translated": "true",
    "x-netflix.context.form-factor": "phone",
    "x-netflix.context.sdk-version": "2012.4",
    "x-netflix.client.appversion": "15.48.1",
    "x-netflix.context.max-device-width": "375",
    "x-netflix.context.ab-tests": "",
    "x-netflix.tracing.cl.useractionid": "4DC655F2-9C3C-4343-8229-CA1B003C3053",
    "x-netflix.client.type": "argo",
    "x-netflix.client.ftl.esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
    "x-netflix.context.locales": "en-US",
    "x-netflix.context.top-level-uuid": "90AFE39F-ADF1-4D8A-B33E-528730990FE3",
    "x-netflix.client.iosversion": "15.8.5",
    "accept-language": "en-US;q=1",
    "x-netflix.argo.abtests": "",
    "x-netflix.context.os-version": "15.8.5",
    "x-netflix.request.client.context": '{"appState":"foreground"}',
    "x-netflix.context.ui-flavor": "argo",
    "x-netflix.argo.nfnsm": "9",
    "x-netflix.context.pixel-density": "2.0",
    "x-netflix.request.toplevel.uuid": "90AFE39F-ADF1-4D8A-B33E-528730990FE3",
    "x-netflix.request.client.timezoneid": "Asia/Dhaka",
}
_WEB_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
_LOGGED_IN_PATHS = ("/browse", "/selectprofile", "/profiles", "/kids", "/home", "/latest")


# ── Cookie parsing ─────────────────────────────────────────────────────────────

def _decode(value):
    if isinstance(value, str) and "%" in value:
        try:
            return urllib.parse.unquote(value)
        except Exception:
            return value
    return value


def extract_all_cookie_sets(raw: str) -> list[dict]:
    sets = []

    # Try JSON first
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            cookies = {c["name"]: _decode(c["value"]) for c in data
                       if isinstance(c, dict) and c.get("name") in _TOKEN_NAMES}
            if "NetflixId" in cookies:
                sets.append(cookies)
        elif isinstance(data, dict):
            cookies = {k: _decode(v) for k, v in data.items() if k in _TOKEN_NAMES}
            if "NetflixId" in cookies:
                sets.append(cookies)
        if sets:
            return sets
    except Exception:
        pass

    lines   = raw.splitlines()
    current = {}

    for line in lines:
        stripped = line.strip()
        if _HTTPONLY.match(stripped):
            stripped = _HTTPONLY.sub("", stripped)
        if _COMMENT.match(stripped) and not stripped.startswith(".") and "\t" not in stripped:
            continue

        parts = stripped.split("\t")
        if len(parts) != 7:
            parts = re.split(r"  +", stripped)
        if len(parts) != 7:
            for pair in stripped.split(";"):
                pair = pair.strip()
                if "=" not in pair:
                    continue
                name, _, value = pair.partition("=")
                name = name.strip(); value = value.strip()
                if name == "NetflixId":
                    if "NetflixId" in current:
                        sets.append(current)
                    current = {"NetflixId": _decode(value)}
                elif name in _TOKEN_NAMES and len(value) > 5:
                    current[name] = _decode(value)
            continue

        _, _f, _p, _s, _e, name, value = parts
        name = name.strip(); value = value.strip()

        if name not in _TOKEN_NAMES or len(value) <= 5:
            continue
        if name == "NetflixId" and "NetflixId" in current:
            sets.append(current)
            current = {}

        current[name] = _decode(value)

    if "NetflixId" in current:
        sets.append(current)

    inline      = re.findall(r"NetflixId=([^\s;,\"']+)", raw)
    existing_ids = {s.get("NetflixId", "") for s in sets}
    for val in inline:
        decoded = _decode(val)
        if decoded not in existing_ids and len(decoded) > 20:
            sets.append({"NetflixId": decoded})
            existing_ids.add(decoded)

    return sets


# ── Cookie / token verification ────────────────────────────────────────────────

def verify_web_cookies(netflix_id: str) -> bool:
    """
    Whitelist approach: visit /browse with allow_redirects=False.
    Valid cookie  → 200 or redirect to known logged-in path.
    Expired cookie → redirect to login / locale homepage → NOT in whitelist → False.
    """
    try:
        r = requests.get(
            "https://www.netflix.com/browse",
            cookies={"NetflixId": netflix_id},
            headers=_WEB_HEADERS,
            timeout=15,
            verify=False,
            allow_redirects=False,
        )
        if r.status_code == 200:
            return True
        if r.status_code in (301, 302, 303, 307, 308):
            location = r.headers.get("Location", "").lower()
            return any(location.startswith(p) or p in location for p in _LOGGED_IN_PATHS)
        return False
    except Exception as exc:
        log.warning("verify_web_cookies error: %s", exc)
        return True   # network error → don't discard


def generate_nftoken(cookie_dict: dict) -> str:
    netflix_id = cookie_dict.get("NetflixId")
    if not netflix_id:
        raise RuntimeError("NetflixId mancante.")

    headers = dict(_IOS_HEADERS)
    # Include all available cookies
    cookies_list = [f"NetflixId={netflix_id}"]
    if cookie_dict.get("SecureNetflixId"):
        cookies_list.append(f"SecureNetflixId={cookie_dict['SecureNetflixId']}")
    if cookie_dict.get("nfvdid"):
        cookies_list.append(f"nfvdid={cookie_dict['nfvdid']}")
    if cookie_dict.get("OptanonConsent"):
        cookies_list.append(f"OptanonConsent={cookie_dict['OptanonConsent']}")
        
    headers["Cookie"] = "; ".join(cookies_list)
    import uuid
    top_uuid = str(uuid.uuid4()).upper()
    action_id = str(uuid.uuid4()).upper()
    headers["x-netflix.request.toplevel.uuid"] = top_uuid
    headers["x-netflix.context.top-level-uuid"] = top_uuid
    headers["x-netflix.tracing.cl.useractionid"] = action_id
    headers["x-netflix.request.client.timezoneid"] = "Europe/Rome"
    headers["x-netflix.context.locales"] = "it-IT,en-US"
    # Remove hardcoded bogus profile guid which causes profile-mismatch error on Netflix
    headers.pop("x-netflix.request.client.user.guid", None)
    headers.pop("x-netflix.context.profile-guid", None)

    r = requests.get(
        _API_URL, params=_QUERY_PARAMS, headers=headers,
        timeout=15, verify=False,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Netflix iOS API error (status {r.status_code})")

    data = r.json()
    token_data = (
        (((data.get("value") or {}).get("account") or {}).get("token") or {}).get("default")
        or {}
    )
    token = token_data.get("token")
    if not token:
        raise RuntimeError(f"Nessun token nella risposta")

    return token



# ── Decorators ─────────────────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            return jsonify({"error": "Accesso negato."}), 403
        return f(*args, **kwargs)
    return decorated

def owner_required(f):
    @wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_owner:
            return jsonify({"error": "Accesso negato. Solo l'owner può eseguire questa azione."}), 403
        return f(*args, **kwargs)
    return decorated


# ── Page routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/dashboard")
@login_required
def dashboard():
    return send_from_directory("static", "dashboard.html")


@app.route("/admin")
@admin_required
def admin():
    return send_from_directory("static", "admin.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


# ── User API ───────────────────────────────────────────────────────────────────

@app.route("/api/me")
@login_required
def api_me():
    return jsonify(current_user.to_dict())


@app.route("/api/redeem", methods=["POST"])
@login_required
def api_redeem():
    data     = request.get_json(silent=True) or {}
    key_code = (data.get("key") or "").strip().upper()

    if not key_code:
        return jsonify({"error": "Inserisci una key."}), 400

    key = Key.query.filter_by(key_code=key_code).first()

    if not key:
        return jsonify({"error": "Key non trovata."}), 404
    if key.is_revoked:
        return jsonify({"error": "Key revocata."}), 400
    if key.redeemed_by_id is not None:
        if key.redeemed_by_id == current_user.id:
            return jsonify({"error": "Hai già riscattato questa key.", "already_yours": True}), 400
        return jsonify({"error": "Key già utilizzata da un altro utente."}), 400

    # Assign a valid cookie from the pool
    used_ids = db.session.query(Key.cookie_id).filter(
        Key.cookie_id.isnot(None), Key.is_revoked == False
    ).subquery()
    cookie = CookiePool.query.filter(
        CookiePool.is_valid == True,
        ~CookiePool.id.in_(used_ids),
    ).first()

    if not cookie:
        return jsonify({"error": "Nessun cookie disponibile al momento. Riprova tra poco."}), 503

    key.redeemed_by_id = current_user.id
    key.redeemed_at    = datetime.utcnow()
    key.cookie_id      = cookie.id
    db.session.commit()

    return jsonify({"success": True})


@app.route("/api/my-keys")
@login_required
def api_my_keys():
    keys = Key.query.filter_by(redeemed_by_id=current_user.id, is_revoked=False).all()
    return jsonify([k.to_dict() for k in keys])


@app.route("/api/generate-link", methods=["POST"])
@login_required
def api_generate_link():
    data   = request.get_json(silent=True) or {}
    key_id = data.get("key_id")

    key = Key.query.get(key_id)
    if not key or key.redeemed_by_id != current_user.id:
        return jsonify({"error": "Key non valida."}), 404
    if key.is_revoked:
        return jsonify({"error": "Key revocata."}), 400

    token = None
    # Auto-rotate up to 3 cookies if one fails
    for attempt in range(3):
        cookie = get_valid_cookie_for_key(key)
        if not cookie:
            return jsonify({"error": "Nessun account Netflix disponibile al momento. Contatta l'admin."}), 503

        try:
            raw_token = generate_nftoken(cookie.to_cookie_dict())
            cookie.last_checked_at = datetime.utcnow()
            cookie.is_valid = True
            db.session.commit()
            token = raw_token
            break
        except Exception as e:
            log.warning("Tentativo %s: generate_nftoken fallito per cookie #%s: %s", attempt + 1, cookie.id, e)
            cookie.is_valid = False
            cookie.last_checked_at = datetime.utcnow()
            db.session.commit()

    if not token:
        return jsonify({"error": "I cookie collegati a questa key sono scaduti. Contatta l'assistenza per caricare nuovi cookie."}), 503

    # URL-encode the token to avoid '+' becoming spaces in query strings
    encoded_token = urllib.parse.quote(token, safe="")
    
    pc_url      = "https://www.netflix.com/youraccount?nftoken=" + encoded_token
    ios_url     = "https://www.netflix.com/browse?nftoken=" + encoded_token
    android_url = "https://www.netflix.com/unsupported?nftoken=" + encoded_token
    
    return jsonify({
        "url": pc_url,
        "ios_url": ios_url,
        "android_url": android_url,
        "token": token,
        "timestamp": datetime.utcnow().isoformat()
    })


# ── Admin API ──────────────────────────────────────────────────────────────────

@app.route("/api/admin/stats")
@admin_required
def api_admin_stats():
    total_keys    = Key.query.count()
    available     = Key.query.filter_by(is_revoked=False).filter(Key.redeemed_by_id.is_(None)).count()
    redeemed      = Key.query.filter(Key.redeemed_by_id.isnot(None), Key.is_revoked == False).count()
    total_cookies = CookiePool.query.count()
    valid_cookies = CookiePool.query.filter_by(is_valid=True).count()

    return jsonify({
        "total_keys":    total_keys,
        "available_keys": available,
        "redeemed_keys": redeemed,
        "revoked_keys":  total_keys - available - redeemed,
        "total_cookies": total_cookies,
        "valid_cookies": valid_cookies,
    })


@app.route("/api/admin/users")
@owner_required
def api_admin_users():
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify({"users": [u.to_dict() for u in users]})


@app.route("/api/admin/set-admin", methods=["POST"])
@owner_required
def api_admin_set_admin():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    is_admin = bool(data.get("is_admin"))

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Utente non trovato."}), 404
        
    if user.is_owner:
        return jsonify({"error": "Non puoi modificare i permessi dell'owner."}), 400

    user.is_admin = is_admin
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/admin/generate-keys", methods=["POST"])
@admin_required
def api_admin_generate_keys():
    data  = request.get_json(silent=True) or {}
    count = min(int(data.get("count", 1)), 500)  # max 500 per volta

    new_keys = []
    for _ in range(count):
        code = generate_key_code()
        # Ensure uniqueness
        while Key.query.filter_by(key_code=code).first():
            code = generate_key_code()
        k = Key(key_code=code)
        db.session.add(k)
        new_keys.append(code)

    db.session.commit()
    return jsonify({"keys": new_keys, "count": len(new_keys)})


@app.route("/api/admin/keys")
@admin_required
def api_admin_keys():
    q    = request.args.get("q", "").strip()
    page = int(request.args.get("page", 1))
    per_page = 50

    query = Key.query
    if q:
        query = query.filter(Key.key_code.ilike(f"%{q}%"))

    total = query.count()
    keys  = query.order_by(Key.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        "keys":  [k.to_dict(include_user=True) for k in keys],
        "total": total,
        "page":  page,
    })


@app.route("/api/admin/revoke-key", methods=["POST"])
@admin_required
def api_admin_revoke_key():
    data   = request.get_json(silent=True) or {}
    key_id = data.get("key_id")

    key = Key.query.get(key_id)
    if not key:
        return jsonify({"error": "Key non trovata."}), 404

    key.is_revoked = True
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/admin/parse-cookies", methods=["POST"])
@admin_required
def api_admin_parse_cookies():
    data = request.get_json(silent=True) or {}
    raw  = (data.get("cookie") or "").strip()

    if not raw:
        return jsonify({"error": "Nessun cookie fornito."}), 400

    cookie_sets = extract_all_cookie_sets(raw)
    return jsonify({"cookie_sets": cookie_sets})


@app.route("/api/admin/validate-cookie", methods=["POST"])
@admin_required
def api_admin_validate_cookie():
    cs = request.get_json(silent=True) or {}
    netflix_id = cs.get("NetflixId", "")

    if not netflix_id:
        return jsonify({"status": "invalid"})

    # Check for duplicate
    if CookiePool.query.filter_by(netflix_id=netflix_id).first():
        return jsonify({"status": "skipped"})

    # Verify the cookie is actually valid
    if not verify_web_cookies(netflix_id):
        return jsonify({"status": "invalid"})

    entry = CookiePool(
        netflix_id        = netflix_id,
        secure_netflix_id = cs.get("SecureNetflixId"),
        nfvdid            = cs.get("nfvdid"),
        optanon_consent   = cs.get("OptanonConsent"),
        is_valid          = True,
        last_checked_at   = datetime.utcnow(),
    )
    db.session.add(entry)
    db.session.commit()

    return jsonify({"status": "added"})


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
