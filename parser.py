# -*- coding: utf-8 -*-
"""פרסר לפורמט בקשת ייצור של WhatsApp (הפורמט המחייב של יוסי, 16/06/26).

סולח בכוונה: שורד גרשיים בכל הווריאציות, תבליטים שונים, שורות כותרת של
וואטסאפ, הודעות חתוכות ותאריכים בפורמטים מעורבים.
"""
import re
from datetime import date

# שדות חובה לפי הפורמט המחייב
REQUIRED_FIELDS = {
    "project": "פרויקט",
    "subject": "נושא הייצור",
    "quantity": "כמות",
    "requester": "מכניס עבודה",
    "approver": "בקר מאשר",
    "approval_date": "תאריך אישור",
    "location": "מיקום ייצור",
    "due_date": 'תג"ב נדרש',
    "system_name": "שם ייצור במערכת",
}

# מיפוי תווית מנורמלת (ללא גרשיים/רווחים) -> שם שדה
_LABELS = {
    "פרויקט": "project",
    "נושאהייצור": "subject",
    "כמות": "quantity",
    "מכניסעבודה": "requester",
    "בקרמאשר": "approver",
    "תאריךאישור": "approval_date",
    "מיקוםייצור": "location",
    "תגבנדרש": "due_date",
    "תגב": "due_date",
    "שםייצורבמערכת": "system_name",
    "הערותמיוחדות": "notes",
    "הערות": "notes",
}

# תחיליות שוואטסאפ מדביק: ‎[16/06/2026, 15:47:15] יוסי:‎
_WA_HEADER = re.compile(r"^\[\d{1,2}/\d{1,2}/\d{2,4},? [\d:]+\]\s*[^:]{1,40}:\s*")
_BULLET = re.compile(r"^[\s]*[*•\-–▪◦]+\s*")
_QUOTES = re.compile(r"[\"'”“„׳״’‘`]")
_EXTERNAL_ID = re.compile(r"#\s*([\w\-]+)")
_ALIAS = re.compile(r"\(\s*רשום(?:ה)?\s+תחת\s+(.+?)\s*\)")
_DATE = re.compile(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?")


def _norm_label(text):
    """נרמול טקסט תווית להשוואה: הסרת גרשיים, רווחים וניקוד."""
    return _QUOTES.sub("", text).replace(" ", "").replace("״", "").replace("׳", "").strip()


def normalize_date(text, ref=None):
    """המרת תאריך חופשי ('22.6', '15.07.26', '8/7/2026') ל-ISO. מחזיר None אם לא זוהה."""
    if not text:
        return None
    m = _DATE.search(text)
    if not m:
        return None
    day, month = int(m.group(1)), int(m.group(2))
    ref = ref or date.today()
    year_part = m.group(3)
    if year_part:
        year = int(year_part)
        if year < 100:
            year += 2000
    else:
        year = ref.year
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def parse_request(text, ref=None):
    """מפרק הודעת בקשת ייצור לשדות.

    מחזיר dict עם השדות שזוהו + 'missing' (רשימת שדות חובה חסרים בעברית).
    """
    fields = {}
    current = None
    values = {}

    for raw_line in text.splitlines():
        line = _WA_HEADER.sub("", raw_line).strip()
        line = _BULLET.sub("", line).strip()
        if not line:
            continue
        # כותרת ההודעה עצמה
        if _norm_label(line) in ("בקשתייצור", "בקשתייצור?"):
            continue

        # שורת תווית? ("פרויקט:" או "תאריך אישור: 16.6.26")
        matched = False
        if ":" in line:
            label_part, _, rest = line.partition(":")
            key = _LABELS.get(_norm_label(label_part))
            if key:
                current = key
                values.setdefault(key, [])
                rest = rest.strip()
                if rest:
                    values[key].append(rest)
                matched = True
        if not matched and current:
            values[current].append(line)

    for key, parts in values.items():
        fields[key] = "\n".join(p for p in parts if p).strip()

    # --- העשרות ---
    # מזהה חיצוני (#1114) מתוך "שם ייצור במערכת"
    if fields.get("system_name"):
        m = _EXTERNAL_ID.search(fields["system_name"])
        if m:
            fields["external_id"] = m.group(1)
            fields["system_name"] = _EXTERNAL_ID.sub("", fields["system_name"]).strip(" \n*•-")

    # "MBaz (רשום תחת שועל מעופף)" -> פרויקט + כינוי רישום
    if fields.get("project"):
        m = _ALIAS.search(fields["project"])
        if m:
            fields["project_alias"] = m.group(1)
            fields["project"] = _ALIAS.sub("", fields["project"]).strip()

    # נרמול תאריכים
    for key in ("approval_date", "due_date"):
        if fields.get(key):
            iso = normalize_date(fields[key], ref=ref)
            if iso:
                fields[key] = iso

    # "אין" בהערות זה ערך לגיטימי; בשדות חובה אחרים "אין" נחשב ריק
    for key in list(fields):
        if key != "notes" and fields[key] in ("אין", "-", "—"):
            fields[key] = ""

    fields["missing"] = missing_fields(fields)
    return fields


def missing_fields(fields):
    """רשימת שדות חובה חסרים, בשמות העבריים מהפורמט של יוסי."""
    return [heb for key, heb in REQUIRED_FIELDS.items() if not (fields.get(key) or "").strip()]


def intake_status(fields):
    """סטטוס קליטה נגזר: מעוכבת (חוסרים) / ממתינה לאישור / מאושרת."""
    missing = missing_fields(fields)
    approval_missing = {"בקר מאשר", "תאריך אישור"} & set(missing)
    if set(missing) - {"בקר מאשר", "תאריך אישור"}:
        return "מעוכבת"
    if approval_missing:
        return "ממתינה לאישור"
    return "מאושרת"


def to_whatsapp(fields):
    """ייצוא בקשה חזרה לפורמט המחייב של יוסי."""
    def v(key, default="—"):
        return fields.get(key) or default

    def d(key):
        iso = fields.get(key)
        if iso and re.match(r"^\d{4}-\d{2}-\d{2}$", iso):
            y, m, day = iso.split("-")
            return "%d.%d.%s" % (int(day), int(m), y[2:])
        return iso or "—"

    project = v("project")
    if fields.get("project_alias"):
        project += " (רשום תחת %s)" % fields["project_alias"]
    system_name = v("system_name")
    if fields.get("external_id"):
        system_name += "\n* #%s" % fields["external_id"]
    return (
        "*בקשת ייצור*\n\n"
        "פרויקט:\n* %s\n"
        "נושא הייצור:\n* %s\n\n"
        "כמות:\n* %s\n"
        "מכניס עבודה:\n* %s\n\n"
        "בקר מאשר:\n* %s\n* תאריך אישור: %s\n\n"
        "מיקום ייצור:\n* %s\n\n"
        "תג\"ב נדרש:\n* %s\n\n"
        "שם ייצור במערכת:\n* %s\n\n"
        "הערות מיוחדות:\n* %s"
    ) % (
        project, v("subject"), v("quantity"), v("requester"),
        v("approver"), d("approval_date"), v("location"), d("due_date"),
        system_name, v("notes", "אין"),
    )
