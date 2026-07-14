import { db } from "./db.js";
import {
  EDITABLE_FIELDS, FIELD_LABELS, OPEN_STATUSES, PRIORITIES, STATUSES,
  enrich, intakeStatus, missingFields, nowIso,
} from "./domain.js";

async function logHistory(pool, requestId, actor, action, field = "", oldVal = "", newVal = "") {
  await pool.query(
    `INSERT INTO history (request_id, ts, actor, action, field, old_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [requestId, nowIso(), actor || "", action, field, String(oldVal || ""), String(newVal || "")],
  );
}

export async function listRequests({ status, project, location, q } = {}) {
  const pool = await db();
  const where = [];
  const args = [];
  for (const [col, val] of [["status", status], ["project", project], ["location", location]]) {
    if (val) {
      args.push(val);
      where.push(`${col} = $${args.length}`);
    }
  }
  if (q?.trim()) {
    args.push(`%${q.trim()}%`);
    const p = `$${args.length}`;
    where.push(`(project ILIKE ${p} OR project_alias ILIKE ${p} OR subject ILIKE ${p}
      OR requester ILIKE ${p} OR approver ILIKE ${p} OR system_name ILIKE ${p}
      OR external_id ILIKE ${p} OR notes ILIKE ${p} OR CAST(serial AS TEXT) ILIKE ${p})`);
  }
  const { rows } = await pool.query(
    `SELECT * FROM requests ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY (due_date = '') ASC, due_date ASC, serial DESC`,
    args,
  );
  return rows.map((r) => enrich(r));
}

export async function getRequest(id) {
  const pool = await db();
  const { rows } = await pool.query("SELECT * FROM requests WHERE id = $1", [id]);
  return rows[0] ? enrich(rows[0]) : null;
}

export async function getHistory(id) {
  const pool = await db();
  const { rows } = await pool.query(
    "SELECT * FROM history WHERE request_id = $1 ORDER BY id DESC", [id]);
  return rows;
}

export async function createRequest(data, actor) {
  const pool = await db();
  const fields = {};
  for (const key of EDITABLE_FIELDS) fields[key] = String(data[key] || "").trim();
  if (!PRIORITIES.includes(fields.priority)) fields.priority = "רגיל";
  if (!STATUSES.includes(fields.status)) fields.status = intakeStatus(fields);
  const ts = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO requests (serial, project, project_alias, subject, quantity, requester,
       approver, approval_date, location, due_date, system_name, external_id, notes,
       priority, status, created_at, updated_at)
     VALUES ((SELECT COALESCE(MAX(serial), 1000) + 1 FROM requests),
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [fields.project, fields.project_alias, fields.subject, fields.quantity,
     fields.requester, fields.approver, fields.approval_date, fields.location,
     fields.due_date, fields.system_name, fields.external_id, fields.notes,
     fields.priority, fields.status, ts],
  );
  const row = rows[0];
  await logHistory(pool, row.id, actor, "נוצרה", "", "", fields.status);
  const missing = missingFields(fields);
  if (missing.length) {
    await logHistory(pool, row.id, actor, "חוסרים בקליטה", "", "", missing.join(", "));
  }
  return enrich(row);
}

export async function updateRequest(id, data, actor) {
  const pool = await db();
  const { rows } = await pool.query("SELECT * FROM requests WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const current = { ...rows[0] };
  const changes = [];
  for (const key of EDITABLE_FIELDS) {
    if (!(key in data)) continue;
    const newVal = String(data[key] || "").trim();
    if (key === "status" && newVal && !STATUSES.includes(newVal)) continue;
    if (newVal !== (current[key] || "")) {
      changes.push([key, current[key] || "", newVal]);
      current[key] = newVal;
    }
  }
  // בקשה בשלב קליטה: קידום אוטומטי כשהחוסרים הושלמו
  if (!("status" in data) && ["מעוכבת", "ממתינה לאישור"].includes(current.status)) {
    const auto = intakeStatus(current);
    if (auto !== current.status) {
      changes.push(["status", current.status, auto]);
      current.status = auto;
    }
  }
  if (!changes.length) return enrich(current);

  current.updated_at = nowIso();
  for (const [key, oldVal, newVal] of changes) {
    if (key === "status") {
      await logHistory(pool, id, actor, "שינוי סטטוס", key, oldVal, newVal);
      if (newVal === "הושלמה") current.completed_at = nowIso();
    } else {
      await logHistory(pool, id, actor, "עדכון", FIELD_LABELS[key] || key, oldVal, newVal);
      // שינוי מהותי אחרי אישור בקר — מסומן בנתיב הביקורת (architecture.md §7.5)
      if (["quantity", "due_date", "subject"].includes(key) && current.approval_date &&
          !["מעוכבת", "ממתינה לאישור"].includes(current.status)) {
        await logHistory(pool, id, actor, "שינוי אחרי אישור", FIELD_LABELS[key] || key, oldVal, newVal);
      }
    }
  }
  const sets = EDITABLE_FIELDS.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const n = EDITABLE_FIELDS.length;
  await pool.query(
    `UPDATE requests SET ${sets}, updated_at = $${n + 1}, completed_at = $${n + 2} WHERE id = $${n + 3}`,
    [...EDITABLE_FIELDS.map((k) => current[k]), current.updated_at, current.completed_at || "", id],
  );
  return enrich(current);
}

export async function stats() {
  const pool = await db();
  const { rows } = await pool.query("SELECT * FROM requests");
  const enriched = rows.map((r) => enrich(r));
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return {
    open: enriched.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    awaiting: enriched.filter((r) => r.status === "ממתינה לאישור").length,
    delayed: enriched.filter((r) => r.status === "מעוכבת").length,
    overdue: enriched.filter((r) => r.overdue).length,
    due_soon: enriched.filter((r) => r.due_soon).length,
    completed_30d: enriched.filter((r) => r.status === "הושלמה" && (r.completed_at || "") >= monthAgo).length,
    projects: [...new Set(rows.map((r) => r.project).filter(Boolean))].sort(),
    locations: [...new Set(rows.map((r) => r.location).filter(Boolean))].sort(),
    statuses: STATUSES,
    priorities: PRIORITIES,
  };
}
