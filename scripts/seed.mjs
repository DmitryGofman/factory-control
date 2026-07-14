// טעינת נתוני דוגמה — ארבע הבקשות האמיתיות מצ'אט ה-WhatsApp של המדור.
// הרצה: npm run db:seed
try { process.loadEnvFile(".env.local"); } catch { /* אין קובץ — נשתמש בסביבה */ }

const { db } = await import("../lib/db.js");
const { createRequest, updateRequest } = await import("../lib/store.js");

const SAMPLES = [
  {
    project: "MD", subject: "ייצור גיגים להתקן הטלה MD", quantity: "4",
    requester: "אלון", approver: "דימה", approval_date: "2026-06-16",
    location: "בית מלאכה תלת־ממד", due_date: "2026-06-22",
    system_name: "ייצור פלציב וגיגים להתקן", notes: "אין", status: "הושלמה",
  },
  {
    project: "פולו - MD",
    subject: "קדיחת פלטת תיאום מאלומיניום וריתוכה עם חלקי אלומיניום שאספק.",
    quantity: "1", requester: "אלון בן דוד", approver: "דימה גופמן",
    approval_date: "2026-06-18", location: "מסגריה, עבודת מסגרות ודיגום מכאני",
    due_date: "2026-06-21",
    system_name: "קדיחת פלטת תיאום וריתוך אלומיניום להתקן הטלה ראשונית לבדיקת SBRU.",
    notes: "אספק שבלונה לקדחים ואת חלקי האלומיניום האחרים אליהם צריך לרתך את הפלטה הקדוחה שאמיתי יעשה.",
    status: "הושלמה",
  },
  {
    project: "MBaz", project_alias: "שועל מעופף",
    subject: "חיתוך וכיפוף פלטות אלומיניום לייצור מסיט תרמילים לMBaz",
    quantity: "2", requester: "גיא דהאן", approver: "רונן פירמן",
    approval_date: "2026-07-06", location: "מסגריה / דגמים", due_date: "2026-07-08",
    system_name: "מסיט תרמילים MBaz", external_id: "1114", notes: "אין", status: "בייצור",
  },
  // ההודעה של צרצר הגיעה חתוכה — בלי "שם ייצור במערכת". נקלטת "מעוכבת" לפי הנוהל.
  {
    project: "צרצר", subject: "ג'יג חתיכה לריטיינר 2", quantity: "חלק בודד",
    requester: "עידו מרון", approver: "רונן פירמן", approval_date: "2026-07-12",
    location: "במדפסת fortus", due_date: "2026-07-15",
  },
];

const pool = await db();
const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM requests");
if (rows[0].n > 0) {
  console.log("ה-DB כבר מכיל בקשות — מדלג על seed.");
} else {
  for (const sample of SAMPLES) {
    await createRequest(sample, "seed");
  }
  console.log(`נטענו ${SAMPLES.length} בקשות דוגמה.`);
}
await pool.end();
