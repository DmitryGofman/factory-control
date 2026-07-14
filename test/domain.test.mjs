import test from "node:test";
import assert from "node:assert/strict";
import {
  enrich, intakeStatus, missingFields, toWhatsApp,
} from "../lib/domain.js";

const FULL = {
  project: "MBaz", project_alias: "שועל מעופף",
  subject: "חיתוך וכיפוף פלטות אלומיניום", quantity: "2",
  requester: "גיא דהאן", approver: "רונן פירמן", approval_date: "2026-07-06",
  location: "מסגריה / דגמים", due_date: "2026-07-08",
  system_name: "מסיט תרמילים MBaz", external_id: "1114", notes: "אין",
};

test("בקשה מלאה — אין חוסרים, סטטוס קליטה מאושרת", () => {
  assert.deepEqual(missingFields(FULL), []);
  assert.equal(intakeStatus(FULL), "מאושרת");
});

test("חסר שם ייצור במערכת — מעוכבת", () => {
  const f = { ...FULL, system_name: "" };
  assert.deepEqual(missingFields(f), ["שם ייצור במערכת"]);
  assert.equal(intakeStatus(f), "מעוכבת");
});

test("חסר רק אישור בקר — ממתינה לאישור", () => {
  const f = { ...FULL, approval_date: "" };
  assert.equal(intakeStatus(f), "ממתינה לאישור");
  assert.equal(intakeStatus({ ...FULL, approver: "", approval_date: "" }), "ממתינה לאישור");
});

test("enrich — חריגה ותג\"ב קרוב", () => {
  const overdue = enrich({ ...FULL, status: "בייצור" }, "2026-07-14");
  assert.equal(overdue.days_to_due, -6);
  assert.equal(overdue.overdue, true);

  const soon = enrich({ ...FULL, status: "מאושרת", due_date: "2026-07-15" }, "2026-07-14");
  assert.equal(soon.due_soon, true);
  assert.equal(soon.overdue, false);

  const closed = enrich({ ...FULL, status: "הושלמה" }, "2026-07-14");
  assert.equal(closed.overdue, false);
  assert.equal(closed.days_to_due, null);
});

test("ייצוא WhatsApp — כולל כינוי, מזהה חיצוני ותאריכים בפורמט המדור", () => {
  const out = toWhatsApp(FULL);
  assert.match(out, /\*בקשת ייצור\*/);
  assert.match(out, /MBaz \(רשום תחת שועל מעופף\)/);
  assert.match(out, /# ?1114/);
  assert.match(out, /תאריך אישור: 6\.7\.26/);
  assert.match(out, /8\.7\.26/);
});

test("ייצוא WhatsApp — שדות ריקים מקבלים מקף, הערות ריקות = אין", () => {
  const out = toWhatsApp({ project: "צרצר" });
  assert.match(out, /כמות:\n\* —/);
  assert.match(out, /הערות מיוחדות:\n\* אין/);
});
