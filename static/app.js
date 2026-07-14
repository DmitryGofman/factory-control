/* בקרת בקשות ייצור — לוגיקת צד לקוח */
"use strict";

const $ = (sel) => document.querySelector(sel);
const OPEN_STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור"];
const NEXT_ACTIONS = {
  "מעוכבת": ["ממתינה לאישור", "בוטלה"],
  "ממתינה לאישור": ["מאושרת", "נדחתה"],
  "מאושרת": ["בייצור", "בוטלה"],
  "בייצור": ["הושלמה", "בוטלה"],
  "הושלמה": [], "נדחתה": ["ממתינה לאישור"], "בוטלה": ["ממתינה לאישור"],
};

let state = { requests: [], stats: null, current: null, editId: null };

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "שגיאת שרת");
  return data;
}

function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "—";
  const [y, m, d] = iso.split("-");
  return `${+d}.${+m}.${y.slice(2)}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 2500);
}

/* ---------- טעינה ורינדור ---------- */

async function refresh() {
  const params = new URLSearchParams();
  const q = $("#f-search").value.trim();
  if (q) params.set("q", q);
  for (const [id, key] of [["#f-status", "status"], ["#f-project", "project"], ["#f-location", "location"]]) {
    const v = $(id).value;
    if (v) params.set(key, v);
  }
  const [reqs, st] = await Promise.all([
    api("/api/requests?" + params.toString()),
    api("/api/stats"),
  ]);
  state.requests = reqs;
  state.stats = st;
  renderStats();
  renderFilters();
  renderTable();
}

function renderStats() {
  const s = state.stats;
  $("#stats").innerHTML = `
    <div class="stat" data-filter=""><b>${s.open}</b><span>בקשות פתוחות</span></div>
    <div class="stat warn" data-filter="ממתינה לאישור"><b>${s.awaiting}</b><span>ממתינות לאישור בקר</span></div>
    <div class="stat alert" data-filter="מעוכבת"><b>${s.delayed}</b><span>מעוכבות — חוסרים</span></div>
    <div class="stat alert" data-overdue="1"><b>${s.overdue}</b><span>חורגות מתג"ב</span></div>
    <div class="stat warn"><b>${s.due_soon}</b><span>תג"ב ביומיים הקרובים</span></div>
    <div class="stat ok" data-filter="הושלמה"><b>${s.completed_30d}</b><span>הושלמו ב-30 יום</span></div>`;
  document.querySelectorAll(".stat[data-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      $("#f-status").value = el.dataset.filter;
      $("#f-open").checked = el.dataset.filter !== "הושלמה";
      refresh();
    }));
}

function fillSelect(sel, values, current) {
  const first = sel.querySelector("option");
  sel.innerHTML = "";
  sel.appendChild(first);
  for (const v of values) {
    const o = document.createElement("option");
    o.value = o.textContent = v;
    sel.appendChild(o);
  }
  sel.value = current;
}

function renderFilters() {
  const s = state.stats;
  fillSelect($("#f-status"), s.statuses, $("#f-status").value);
  fillSelect($("#f-project"), s.projects, $("#f-project").value);
  fillSelect($("#f-location"), s.locations, $("#f-location").value);
  $("#loc-list").innerHTML = s.locations.map((l) => `<option value="${esc(l)}">`).join("");
}

function renderTable() {
  let rows = state.requests;
  if ($("#f-open").checked && !$("#f-status").value) {
    rows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  }
  $("#empty").hidden = rows.length > 0;
  $("#tbl-body").innerHTML = rows.map((r) => {
    const dueBadge = r.overdue
      ? `<span class="due-badge overdue">חריגה ${-r.days_to_due} ימים</span>`
      : r.due_soon ? `<span class="due-badge soon">עוד ${r.days_to_due} ימים</span>` : "";
    const missing = r.missing.length
      ? `<div class="sub">⚠ חסרים: ${esc(r.missing.join(", "))}</div>` : "";
    const alias = r.project_alias ? `<div class="sub">רשום תחת ${esc(r.project_alias)}</div>` : "";
    const prio = r.priority !== "רגיל" ? ` <span class="prio-${esc(r.priority)}">(${esc(r.priority)})</span>` : "";
    return `<tr class="${r.overdue ? "row-overdue" : ""}" data-id="${r.id}">
      <td>#${r.serial}${r.external_id ? `<div class="sub">#${esc(r.external_id)}</div>` : ""}</td>
      <td>${esc(r.project) || "—"}${alias}</td>
      <td>${esc(r.subject) || "—"}${prio}${missing}</td>
      <td>${esc(r.quantity) || "—"}</td>
      <td>${esc(r.requester) || "—"}</td>
      <td>${esc(r.approver) || "—"}<div class="sub">${r.approval_date ? "אושר " + fmtDate(r.approval_date) : "טרם אושר"}</div></td>
      <td>${esc(r.location) || "—"}</td>
      <td>${fmtDate(r.due_date)}${dueBadge ? "<br>" + dueBadge : ""}</td>
      <td><span class="chip s-${esc(r.status.split(" ")[0])}">${esc(r.status)}</span></td>
    </tr>`;
  }).join("");
  document.querySelectorAll("#tbl-body tr").forEach((tr) =>
    tr.addEventListener("click", () => openDetail(+tr.dataset.id)));
}

/* ---------- פרטי בקשה ---------- */

async function openDetail(id) {
  const r = await api(`/api/requests/${id}`);
  const hist = await api(`/api/requests/${id}/history`);
  state.current = r;
  $("#d-title").textContent = `בקשה #${r.serial} — ${r.project || "ללא פרויקט"}`;
  const rows = [
    ["סטטוס", `<span class="chip s-${esc(r.status.split(" ")[0])}">${esc(r.status)}</span>`],
    ["פרויקט", esc(r.project) + (r.project_alias ? ` <span class="sub">(רשום תחת ${esc(r.project_alias)})</span>` : "")],
    ["נושא הייצור", esc(r.subject)],
    ["כמות", esc(r.quantity)],
    ["מכניס עבודה", esc(r.requester)],
    ["בקר מאשר", esc(r.approver)],
    ["תאריך אישור", fmtDate(r.approval_date)],
    ["מיקום ייצור", esc(r.location)],
    ['תג"ב נדרש', fmtDate(r.due_date)],
    ["שם ייצור במערכת", esc(r.system_name)],
    ["מזהה חיצוני", r.external_id ? "#" + esc(r.external_id) : "—"],
    ["עדיפות", esc(r.priority)],
    ["הערות מיוחדות", esc(r.notes) || "—"],
    ["נקלטה", fmtDate(r.created_at?.slice(0, 10))],
  ];
  const missingBanner = r.missing.length
    ? `<div class="missing-banner">⚠ שדות חובה חסרים: ${esc(r.missing.join(", "))} — הבקשה מעוכבת עד השלמתם (נוהל יוסי 16/06)</div>` : "";
  $("#d-body").innerHTML = `${missingBanner}
    <dl class="detail-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v || "—"}</dd>`).join("")}</dl>
    <div class="hist"><h3>היסטוריה</h3>${hist.map((h) => `
      <div class="hist-item">
        <span class="ts">${esc(h.ts.replace("T", " "))}</span> —
        <b>${esc(h.action)}</b>${h.field ? " (" + esc(h.field) + ")" : ""}
        ${h.old_value || h.new_value ? `: ${esc(h.old_value) || "ריק"} ← ${esc(h.new_value) || "ריק"}` : ""}
        ${h.actor ? `<span class="ts"> · ${esc(h.actor)}</span>` : ""}
      </div>`).join("") || '<div class="sub">אין רשומות</div>'}</div>`;
  $("#d-status-btns").innerHTML = (NEXT_ACTIONS[r.status] || []).map((s) =>
    `<button class="btn btn-primary btn-status" data-status="${esc(s)}">${esc(s === "הושלמה" ? "✔ הושלמה" : s)}</button>`).join("");
  document.querySelectorAll("#d-status-btns button").forEach((b) =>
    b.addEventListener("click", () => changeStatus(r.id, b.dataset.status)));
  $("#modal-detail").hidden = false;
}

async function changeStatus(id, status) {
  const actor = localStorage.getItem("actor") || prompt("שם המעדכן:") || "";
  if (actor) localStorage.setItem("actor", actor);
  await api(`/api/requests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, actor }),
  });
  toast(`הסטטוס עודכן ל"${status}"`);
  $("#modal-detail").hidden = true;
  refresh();
}

/* ---------- טופס ---------- */

const FORM_FIELDS = ["project", "project_alias", "subject", "quantity", "requester",
  "approver", "approval_date", "location", "due_date", "system_name",
  "external_id", "notes", "priority"];

function openForm(mode, data) {
  state.editId = mode === "edit" ? data.id : null;
  $("#form-title").textContent = { new: "בקשה חדשה", edit: `עריכת בקשה #${data?.serial ?? ""}`, import: "ייבוא מ-WhatsApp" }[mode];
  $("#import-zone").hidden = mode !== "import";
  $("#import-text").value = "";
  $("#parse-result").textContent = "";
  const f = $("#req-form");
  f.reset();
  if (data) for (const k of FORM_FIELDS) if (f[k] && data[k]) f[k].value = data[k];
  f.actor.value = localStorage.getItem("actor") || "";
  updateMissingNote();
  $("#modal-form").hidden = false;
}

function formData() {
  const f = $("#req-form");
  const out = {};
  for (const k of FORM_FIELDS) out[k] = f[k].value.trim();
  out.actor = f.actor.value.trim();
  return out;
}

function updateMissingNote() {
  const d = formData();
  const req = { project: "פרויקט", subject: "נושא הייצור", quantity: "כמות", requester: "מכניס עבודה", approver: "בקר מאשר", approval_date: "תאריך אישור", location: "מיקום ייצור", due_date: 'תג"ב נדרש', system_name: "שם ייצור במערכת" };
  const missing = Object.entries(req).filter(([k]) => !d[k]).map(([, v]) => v);
  $("#form-missing").textContent = missing.length
    ? `⚠ חסרים: ${missing.join(", ")} — הבקשה תיקלט כ"מעוכבת" עד השלמתם` : "";
}

async function parseImport() {
  const text = $("#import-text").value.trim();
  if (!text) return;
  const parsed = await api("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const f = $("#req-form");
  for (const k of FORM_FIELDS) if (f[k] && parsed[k]) f[k].value = parsed[k];
  const note = $("#parse-result");
  if (parsed.missing.length) {
    note.className = "parse-note warn";
    note.textContent = `זוהו השדות. חסרים: ${parsed.missing.join(", ")} — השלם ידנית או שמור כ"מעוכבת".`;
  } else {
    note.className = "parse-note ok";
    note.textContent = `✔ כל שדות החובה זוהו. סטטוס צפוי: ${parsed.suggested_status}. בדוק את התאריכים לפני שמירה.`;
  }
  updateMissingNote();
}

async function saveForm() {
  const data = formData();
  if (data.actor) localStorage.setItem("actor", data.actor);
  if (state.editId) {
    await api(`/api/requests/${state.editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    toast("הבקשה עודכנה");
  } else {
    const created = await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    toast(`נקלטה בקשה #${created.serial} (${created.status})`);
  }
  $("#modal-form").hidden = true;
  $("#modal-detail").hidden = true;
  refresh();
}

/* ---------- חיבורים ---------- */

$("#btn-new").addEventListener("click", () => openForm("new"));
$("#btn-import").addEventListener("click", () => openForm("import"));
$("#btn-parse").addEventListener("click", parseImport);
$("#btn-save").addEventListener("click", (e) => { e.preventDefault(); saveForm().catch((err) => toast(err.message)); });
$("#d-edit").addEventListener("click", () => { $("#modal-detail").hidden = true; openForm("edit", state.current); });
$("#d-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.current.whatsapp);
  toast("הועתק ללוח — אפשר להדביק ב-WhatsApp");
});
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => (b.closest(".modal-back").hidden = true)));
document.querySelectorAll(".modal-back").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
$("#req-form").addEventListener("input", updateMissingNote);
for (const id of ["#f-status", "#f-project", "#f-location", "#f-open"]) {
  $(id).addEventListener("change", refresh);
}
let searchT;
$("#f-search").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(refresh, 250); });

refresh().catch((err) => toast(err.message));
