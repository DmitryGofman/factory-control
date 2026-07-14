// לוגיקת הדומיין של בקשות ייצור — לפי הפורמט המחייב (נוהל יוסי 16/06/26).

export const REQUIRED_FIELDS = {
  project: "פרויקט",
  subject: "נושא הייצור",
  quantity: "כמות",
  requester: "מכניס עבודה",
  approver: "בקר מאשר",
  approval_date: "תאריך אישור",
  location: "מיקום ייצור",
  due_date: 'תג"ב נדרש',
  system_name: "שם ייצור במערכת",
};

export const STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור", "הושלמה", "נדחתה", "בוטלה"];
export const OPEN_STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור"];
export const PRIORITIES = ["רגיל", "דחוף", "מיידי"];

export const EDITABLE_FIELDS = [
  "project", "project_alias", "subject", "quantity", "requester",
  "approver", "approval_date", "location", "due_date", "system_name",
  "external_id", "notes", "priority", "status",
];

export const FIELD_LABELS = {
  ...REQUIRED_FIELDS,
  project_alias: "רשום תחת",
  external_id: "מזהה חיצוני",
  notes: "הערות מיוחדות",
  priority: "עדיפות",
  status: "סטטוס",
};

export function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function missingFields(fields) {
  return Object.entries(REQUIRED_FIELDS)
    .filter(([key]) => !String(fields[key] || "").trim())
    .map(([, heb]) => heb);
}

// סטטוס קליטה נגזר: מעוכבת (חוסרים) / ממתינה לאישור / מאושרת
export function intakeStatus(fields) {
  const missing = missingFields(fields);
  const approvalOnly = new Set(["בקר מאשר", "תאריך אישור"]);
  if (missing.some((m) => !approvalOnly.has(m))) return "מעוכבת";
  if (missing.length) return "ממתינה לאישור";
  return "מאושרת";
}

// שדות נגזרים לתצוגה: חוסרים, ימים לתג"ב, חריגה
export function enrich(row, today = todayIso()) {
  const r = { ...row };
  r.missing = missingFields(r);
  r.overdue = false;
  r.due_soon = false;
  r.days_to_due = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.due_date || "") && OPEN_STATUSES.includes(r.status)) {
    const days = Math.round((Date.parse(r.due_date) - Date.parse(today)) / 86400000);
    r.days_to_due = days;
    r.overdue = days < 0;
    r.due_soon = days >= 0 && days <= 2;
  }
  return r;
}

function waDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "—";
  const [y, m, d] = iso.split("-");
  return `${+d}.${+m}.${y.slice(2)}`;
}

// ייצוא בקשה לפורמט ההודעה המחייב — לכפתור "העתק כ-WhatsApp"
export function toWhatsApp(f) {
  const v = (key, dflt = "—") => f[key] || dflt;
  let project = v("project");
  if (f.project_alias) project += ` (רשום תחת ${f.project_alias})`;
  let systemName = v("system_name");
  if (f.external_id) systemName += `\n* #${f.external_id}`;
  return [
    "*בקשת ייצור*", "",
    "פרויקט:", `* ${project}`,
    "נושא הייצור:", `* ${v("subject")}`, "",
    "כמות:", `* ${v("quantity")}`,
    "מכניס עבודה:", `* ${v("requester")}`, "",
    "בקר מאשר:", `* ${v("approver")}`, `* תאריך אישור: ${waDate(f.approval_date)}`, "",
    "מיקום ייצור:", `* ${v("location")}`, "",
    'תג"ב נדרש:', `* ${waDate(f.due_date)}`, "",
    "שם ייצור במערכת:", `* ${systemName}`, "",
    "הערות מיוחדות:", `* ${v("notes", "אין")}`,
  ].join("\n");
}
