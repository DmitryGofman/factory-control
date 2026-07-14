# -*- coding: utf-8 -*-
"""שרת מערכת בקרת בקשות ייצור — Python stdlib בלבד.

הרצה: python3 server.py [port]   (ברירת מחדל 8342)
"""
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import parser as req_parser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("FACTORY_DB", os.path.join(BASE_DIR, "factory.db"))
STATIC_DIR = os.path.join(BASE_DIR, "static")
FIRST_SERIAL = 1001

STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור", "הושלמה", "נדחתה", "בוטלה"]
OPEN_STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור"]
PRIORITIES = ["רגיל", "דחוף", "מיידי"]

EDITABLE_FIELDS = [
    "project", "project_alias", "subject", "quantity", "requester",
    "approver", "approval_date", "location", "due_date", "system_name",
    "external_id", "notes", "priority", "status",
]

FIELD_LABELS = dict(req_parser.REQUIRED_FIELDS)
FIELD_LABELS.update({
    "project_alias": "רשום תחת", "external_id": "מזהה חיצוני",
    "notes": "הערות מיוחדות", "priority": "עדיפות", "status": "סטטוס",
})

SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial INTEGER UNIQUE NOT NULL,
    project TEXT DEFAULT '', project_alias TEXT DEFAULT '',
    subject TEXT DEFAULT '', quantity TEXT DEFAULT '',
    requester TEXT DEFAULT '', approver TEXT DEFAULT '',
    approval_date TEXT DEFAULT '', location TEXT DEFAULT '',
    due_date TEXT DEFAULT '', system_name TEXT DEFAULT '',
    external_id TEXT DEFAULT '', notes TEXT DEFAULT '',
    priority TEXT DEFAULT 'רגיל', status TEXT DEFAULT 'מעוכבת',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    completed_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    ts TEXT NOT NULL, actor TEXT DEFAULT '',
    action TEXT NOT NULL, field TEXT DEFAULT '',
    old_value TEXT DEFAULT '', new_value TEXT DEFAULT ''
);
"""


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db():
    with get_db() as db:
        db.executescript(SCHEMA)


def now():
    return datetime.now().isoformat(timespec="seconds")


def log_history(db, request_id, actor, action, field="", old="", new=""):
    db.execute(
        "INSERT INTO history (request_id, ts, actor, action, field, old_value, new_value)"
        " VALUES (?,?,?,?,?,?,?)",
        (request_id, now(), actor or "", action, field, str(old or ""), str(new or "")),
    )


def enrich(row):
    """שדות נגזרים לתצוגה: חוסרים, ימים לתג\"ב, חריגה."""
    r = dict(row)
    r["missing"] = req_parser.missing_fields(r)
    r["overdue"] = False
    r["due_soon"] = False
    r["days_to_due"] = None
    if r.get("due_date") and r["status"] in OPEN_STATUSES:
        try:
            days = (date.fromisoformat(r["due_date"]) - date.today()).days
            r["days_to_due"] = days
            r["overdue"] = days < 0
            r["due_soon"] = 0 <= days <= 2
        except ValueError:
            pass
    return r


def create_request(db, data, actor):
    fields = {k: (data.get(k) or "").strip() for k in EDITABLE_FIELDS}
    if fields.get("priority") not in PRIORITIES:
        fields["priority"] = "רגיל"
    if fields.get("status") not in STATUSES:
        fields["status"] = req_parser.intake_status(fields)
    serial = db.execute("SELECT COALESCE(MAX(serial), ?) + 1 FROM requests",
                        (FIRST_SERIAL - 1,)).fetchone()[0]
    ts = now()
    cur = db.execute(
        """INSERT INTO requests (serial, project, project_alias, subject, quantity,
           requester, approver, approval_date, location, due_date, system_name,
           external_id, notes, priority, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (serial, fields["project"], fields["project_alias"], fields["subject"],
         fields["quantity"], fields["requester"], fields["approver"],
         fields["approval_date"], fields["location"], fields["due_date"],
         fields["system_name"], fields["external_id"], fields["notes"],
         fields["priority"], fields["status"], ts, ts),
    )
    rid = cur.lastrowid
    log_history(db, rid, actor, "נוצרה", new=fields["status"])
    missing = req_parser.missing_fields(fields)
    if missing:
        log_history(db, rid, actor, "חוסרים בקליטה", new=", ".join(missing))
    return rid


def update_request(db, rid, data, actor):
    row = db.execute("SELECT * FROM requests WHERE id=?", (rid,)).fetchone()
    if not row:
        return None
    current = dict(row)
    changes = []
    for key in EDITABLE_FIELDS:
        if key not in data:
            continue
        new_val = (data.get(key) or "").strip()
        if key == "status" and new_val and new_val not in STATUSES:
            continue
        if new_val != (current.get(key) or ""):
            changes.append((key, current.get(key) or "", new_val))
            current[key] = new_val

    # בקשה בשלב קליטה: קידום אוטומטי כשהחוסרים הושלמו
    if "status" not in data and current["status"] in ("מעוכבת", "ממתינה לאישור"):
        auto = req_parser.intake_status(current)
        if auto != current["status"]:
            changes.append(("status", current["status"], auto))
            current["status"] = auto

    if not changes:
        return current
    current["updated_at"] = now()
    current["completed_at"] = current.get("completed_at") or ""
    for key, old, new in changes:
        if key == "status":
            log_history(db, rid, actor, "שינוי סטטוס", key, old, new)
            if new == "הושלמה":
                current["completed_at"] = now()
        else:
            log_history(db, rid, actor, "עדכון", FIELD_LABELS.get(key, key), old, new)
            # שינוי מהותי אחרי אישור — מסומן בהיסטוריה (ר' architecture.md §7.5)
            if key in ("quantity", "due_date", "subject") and current.get("approval_date") \
                    and current["status"] not in ("מעוכבת", "ממתינה לאישור"):
                log_history(db, rid, actor, "שינוי אחרי אישור", FIELD_LABELS.get(key, key), old, new)
    sets = ", ".join("%s=?" % k for k in EDITABLE_FIELDS) + ", updated_at=?, completed_at=?"
    db.execute("UPDATE requests SET %s WHERE id=?" % sets,
               [current[k] for k in EDITABLE_FIELDS] + [current["updated_at"], current["completed_at"], rid])
    return current


def list_requests(db, params):
    query = "SELECT * FROM requests WHERE 1=1"
    args = []
    for col in ("status", "project", "location"):
        val = params.get(col, [""])[0]
        if val:
            query += " AND %s = ?" % col
            args.append(val)
    q = params.get("q", [""])[0].strip()
    if q:
        like = "%" + q + "%"
        query += """ AND (project LIKE ? OR project_alias LIKE ? OR subject LIKE ?
                     OR requester LIKE ? OR approver LIKE ? OR system_name LIKE ?
                     OR external_id LIKE ? OR notes LIKE ? OR CAST(serial AS TEXT) LIKE ?)"""
        args += [like] * 9
    query += " ORDER BY CASE WHEN due_date='' THEN 1 ELSE 0 END, due_date ASC, serial DESC"
    return [enrich(r) for r in db.execute(query, args).fetchall()]


def stats(db):
    rows = [dict(r) for r in db.execute("SELECT * FROM requests").fetchall()]
    month_ago = (date.today() - timedelta(days=30)).isoformat()
    enriched = [enrich(r) for r in rows]
    return {
        "open": sum(1 for r in enriched if r["status"] in OPEN_STATUSES),
        "awaiting": sum(1 for r in enriched if r["status"] == "ממתינה לאישור"),
        "delayed": sum(1 for r in enriched if r["status"] == "מעוכבת"),
        "overdue": sum(1 for r in enriched if r["overdue"]),
        "due_soon": sum(1 for r in enriched if r["due_soon"]),
        "completed_30d": sum(1 for r in enriched
                             if r["status"] == "הושלמה" and (r.get("completed_at") or "") >= month_ago),
        "projects": sorted({r["project"] for r in rows if r["project"]}),
        "locations": sorted({r["location"] for r in rows if r["location"]}),
        "statuses": STATUSES,
        "priorities": PRIORITIES,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "FactoryControl/1.0"

    # --- עזרים ---
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        if path.startswith("/static/"):
            path = path[len("/static"):]
        safe = os.path.normpath(path.lstrip("/"))
        full = os.path.join(STATIC_DIR, safe)
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self.send_json({"error": "לא נמצא"}, 404)
            return
        ctypes = {".html": "text/html", ".js": "application/javascript",
                  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png"}
        ctype = ctypes.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # שקט בקונסול
        pass

    # --- ניתוב ---
    def do_GET(self):
        url = urlparse(self.path)
        params = parse_qs(url.query)
        m = re.match(r"^/api/requests/(\d+)(/history)?$", url.path)
        with get_db() as db:
            if url.path == "/api/requests":
                return self.send_json(list_requests(db, params))
            if url.path == "/api/stats":
                return self.send_json(stats(db))
            if m and m.group(2):
                rows = db.execute(
                    "SELECT * FROM history WHERE request_id=? ORDER BY id DESC",
                    (int(m.group(1)),)).fetchall()
                return self.send_json([dict(r) for r in rows])
            if m:
                row = db.execute("SELECT * FROM requests WHERE id=?",
                                 (int(m.group(1)),)).fetchone()
                if not row:
                    return self.send_json({"error": "בקשה לא נמצאה"}, 404)
                r = enrich(row)
                r["whatsapp"] = req_parser.to_whatsapp(r)
                return self.send_json(r)
        self.serve_static(url.path)

    def do_POST(self):
        url = urlparse(self.path)
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "JSON לא תקין"}, 400)
        if url.path == "/api/parse":
            fields = req_parser.parse_request(data.get("text") or "")
            fields["suggested_status"] = req_parser.intake_status(fields)
            return self.send_json(fields)
        if url.path == "/api/requests":
            with get_db() as db:
                rid = create_request(db, data, data.get("actor"))
                row = db.execute("SELECT * FROM requests WHERE id=?", (rid,)).fetchone()
            return self.send_json(enrich(row), 201)
        self.send_json({"error": "לא נמצא"}, 404)

    def do_PATCH(self):
        url = urlparse(self.path)
        m = re.match(r"^/api/requests/(\d+)$", url.path)
        if not m:
            return self.send_json({"error": "לא נמצא"}, 404)
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "JSON לא תקין"}, 400)
        with get_db() as db:
            result = update_request(db, int(m.group(1)), data, data.get("actor"))
            if result is None:
                return self.send_json({"error": "בקשה לא נמצאה"}, 404)
        return self.send_json(enrich(result))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8342
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("מערכת בקרת בקשות ייצור — http://localhost:%d  (DB: %s)" % (port, DB_PATH))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
