/* בקרת בקשות ייצור — mobile-first, ערכת "חמ"ל" */
"use strict";

const $ = (sel) => document.querySelector(sel);
const OPEN_STATUSES = ["מעוכבת", "ממתינה לאישור", "מאושרת", "בייצור"];
const LAMP = {
  "מעוכבת": "red", "ממתינה לאישור": "amber", "מאושרת": "blue",
  "בייצור": "purple", "הושלמה": "green", "נדחתה": "grey", "בוטלה": "grey",
};
const NEXT_ACTIONS = {
  "מעוכבת": ["ממתינה לאישור", "בוטלה"],
  "ממתינה לאישור": ["מאושרת", "נדחתה"],
  "מאושרת": ["בייצור", "בוטלה"],
  "בייצור": ["הושלמה", "בוטלה"],
  "הושלמה": [], "נדחתה": ["ממתינה לאישור"], "בוטלה": ["ממתינה לאישור"],
};

let state = { requests: [], stats: null, current: null, editId: null, chip: "open" };

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

/* ---------- טעינה ---------- */

async function refresh() {
  const params = new URLSearchParams();
  const q = $("#f-search").value.trim();
  if (q) params.set("q", q);
  for (const [id, key] of [["#f-project", "project"], ["#f-location", "location"]]) {
    const v = $(id).value;
    if (v) params.set(key, v);
  }
  const [reqs, st] = await Promise.all([
    api("/api/requests?" + params.toString()),
    api("/api/stats"),
  ]);
  state.requests = reqs;
  state.stats = st;
  renderChips();
  renderFilters();
  renderFeed();
}

/* ---------- צ'יפים: מדדים + מסנן במחווה אחת ---------- */

const CHIPS = [
  { key: "open", label: "פתוחות", stat: "open", cls: "" },
  { key: "overdue", label: "חורגות תג\"ב", stat: "overdue", cls: "alert" },
  { key: "מעוכבת", label: "מעוכבות", stat: "delayed", cls: "alert" },
  { key: "ממתינה לאישור", label: "ממתינות", stat: "awaiting", cls: "warn" },
  { key: "due_soon", label: "תג\"ב קרוב", stat: "due_soon", cls: "warn" },
  { key: "הושלמה", label: "הושלמו", stat: "completed_30d", cls: "ok" },
  { key: "all", label: "הכל", stat: null, cls: "" },
];

function renderChips() {
  const s = state.stats;
  $("#chips").innerHTML = CHIPS.map((c) =>
    `<button class="chip ${c.cls} ${state.chip === c.key ? "on" : ""}" data-chip="${c.key}">
      ${c.label}${c.stat != null ? `<b>${s[c.stat]}</b>` : ""}
    </button>`).join("");
  document.querySelectorAll(".chip").forEach((el) =>
    el.addEventListener("click", () => { state.chip = el.dataset.chip; renderChips(); renderFeed(); }));
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
  fillSelect($("#f-project"), s.projects, $("#f-project").value);
  fillSelect($("#f-location"), s.locations, $("#f-location").value);
  $("#loc-list").innerHTML = s.locations.map((l) => `<option value="${esc(l)}">`).join("");
}

/* ---------- הפיד ---------- */

function chipFilter(r) {
  switch (state.chip) {
    case "open": return OPEN_STATUSES.includes(r.status);
    case "overdue": return r.overdue;
    case "due_soon": return r.due_soon;
    case "all": return true;
    default: return r.status === state.chip;
  }
}

function urgency(r) {
  if (!OPEN_STATUSES.includes(r.status)) return 1e9; // סגורות בסוף
  return r.days_to_due == null ? 1e8 : r.days_to_due;
}

function cardHTML(r) {
  const open = OPEN_STATUSES.includes(r.status);
  const rail = r.overdue ? "hot" : r.due_soon ? "warm" : "";
  const count = r.overdue
    ? `<span class="count red">⏰ חריגה ${-r.days_to_due} ימים</span>`
    : r.due_soon
      ? `<span class="count amber">תג"ב ${r.days_to_due === 0 ? "היום" : r.days_to_due === 1 ? "מחר" : "בעוד יומיים"} · ${fmtDate(r.due_date)}</span>`
      : open && r.days_to_due != null
        ? `<span class="count ok">עוד ${r.days_to_due} ימים · ${fmtDate(r.due_date)}</span>`
        : open
          ? `<span class="count dim">ללא תג"ב</span>`
          : `<span class="count ${r.status === "הושלמה" ? "ok" : "dim"}">${r.status === "הושלמה" ? "✔" : ""} ${esc(r.status)} ${fmtDate(r.completed_at?.slice(0, 10) || r.updated_at?.slice(0, 10))}</span>`;
  const qty = r.quantity ? ` · ${esc(r.quantity)}` : "";
  const alias = r.project_alias ? ` <span class="alias">(${esc(r.project_alias)})</span>` : "";
  const prio = r.priority && r.priority !== "רגיל" ? `<span class="pill" style="color:var(--red);border-color:var(--red)">${esc(r.priority)}</span>` : "";
  return `<button class="req ${rail} ${open ? "" : "closed"}" data-id="${r.id}">
    <div class="top"><span class="proj">${esc(r.project) || "ללא פרויקט"}${alias}</span><span class="id">#${r.serial}${r.external_id ? " · #" + esc(r.external_id) : ""}</span></div>
    <div class="what">${esc(r.subject) || "—"}${qty}${r.location ? " · " + esc(r.location) : ""}</div>
    <div class="foot">
      ${count}
      <span class="pill"><span class="lamp ${LAMP[r.status] || "grey"}"></span>${esc(r.status)}</span>
      ${r.requester ? `<span class="pill">${esc(r.requester)}</span>` : ""}
      ${prio}
    </div>
    ${r.missing.length ? `<div class="miss">⚠ חסר: ${esc(r.missing.join(", "))}</div>` : ""}
  </button>`;
}

function renderFeed() {
  const rows = state.requests.filter(chipFilter).sort((a, b) => urgency(a) - urgency(b));
  $("#empty").hidden = rows.length > 0;
  const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const closedRows = rows.filter((r) => !OPEN_STATUSES.includes(r.status));
  let html = "";
  if (openRows.length) html += `<div class="day-label">לפי דחיפות תג"ב</div>` + openRows.map(cardHTML).join("");
  if (closedRows.length) html += `<div class="day-label">סגורות</div>` + closedRows.map(cardHTML).join("");
  $("#feed").innerHTML = html;
  document.querySelectorAll(".req").forEach((el) =>
    el.addEventListener("click", () => openDetail(+el.dataset.id)));
}

/* ---------- פרטי בקשה ---------- */

async function openDetail(id) {
  const r = await api(`/api/requests/${id}`);
  const hist = await api(`/api/requests/${id}/history`);
  state.current = r;
  $("#d-title").innerHTML = `#${r.serial} · ${esc(r.project) || "ללא פרויקט"}
    <span class="sub2">${esc(r.subject) || ""}</span>`;
  $("#d-banner").innerHTML = r.overdue
    ? `<div class="banner red">⏰ חריגת תג"ב — ${-r.days_to_due} ימים. תג"ב נדרש: ${fmtDate(r.due_date)}</div>`
    : r.missing.length
      ? `<div class="banner amber">⚠ חסרים: ${esc(r.missing.join(", "))} — מעוכבת עד השלמה (נוהל 16/06)</div>`
      : "";
  const rows = [
    ["סטטוס", `<span class="lamp ${LAMP[r.status] || "grey"}"></span>${esc(r.status)}`],
    ["רשום תחת", r.project_alias ? esc(r.project_alias) : null],
    ["כמות", esc(r.quantity)],
    ["מכניס עבודה", esc(r.requester)],
    ["בקר מאשר", r.approver ? `${esc(r.approver)}${r.approval_date ? ` · <span class="num">${fmtDate(r.approval_date)}</span>` : " · טרם אושר"}` : null],
    ["מיקום ייצור", esc(r.location)],
    ['תג"ב נדרש', `<span class="num">${fmtDate(r.due_date)}</span>`],
    ["שם ייצור במערכת", esc(r.system_name)],
    ["מזהה חיצוני", r.external_id ? `<span class="num">#${esc(r.external_id)}</span>` : null],
    ["עדיפות", r.priority !== "רגיל" ? esc(r.priority) : null],
    ["הערות מיוחדות", esc(r.notes) || null],
    ["נקלטה", `<span class="num">${fmtDate(r.created_at?.slice(0, 10))}</span>`],
  ];
  $("#d-body").innerHTML = `
    <div class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v || "—"}</span></div>`).join("")}</div>
    <div class="hist"><h3>היסטוריה</h3>${hist.map((h) => `
      <div class="h-item"><span class="ts">${esc(h.ts.slice(5, 16).replace("T", " "))}</span> ·
        <b>${esc(h.action)}</b>${h.field && h.field !== "status" ? " (" + esc(h.field) + ")" : ""}
        ${h.old_value || h.new_value ? `: ${esc(h.old_value) || "ריק"} ← ${esc(h.new_value) || "ריק"}` : ""}
        ${h.actor ? `<span class="ts"> · ${esc(h.actor)}</span>` : ""}
      </div>`).join("") || '<div class="h-item">אין רשומות</div>'}</div>`;
  $("#d-foot").innerHTML = `
    ${(NEXT_ACTIONS[r.status] || []).map((s) =>
      `<button class="btn ${s === "הושלמה" || s === "מאושרת" ? "primary" : ""} half" data-status="${esc(s)}">${s === "הושלמה" ? "✔ סמן הושלמה" : s}</button>`).join("")}
    <button class="btn half" id="d-copy">📋 העתק כ-WhatsApp</button>
    <button class="btn half" id="d-edit">✏️ עריכה</button>`;
  document.querySelectorAll("#d-foot [data-status]").forEach((b) =>
    b.addEventListener("click", () => changeStatus(r.id, b.dataset.status)));
  $("#d-copy").addEventListener("click", copyWhatsApp);
  $("#d-edit").addEventListener("click", () => { $("#modal-detail").hidden = true; openForm("edit", state.current); });
  $("#modal-detail").hidden = false;
}

async function copyWhatsApp() {
  try {
    await navigator.clipboard.writeText(state.current.whatsapp);
    toast("הועתק — אפשר להדביק ב-WhatsApp");
  } catch {
    toast("ההעתקה נחסמה ע\"י הדפדפן");
  }
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
  $("#form-title").textContent = { new: "בקשה חדשה", edit: `עריכת בקשה #${data?.serial ?? ""}` }[mode];
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
$("#btn-queue").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("#btn-save").addEventListener("click", (e) => { e.preventDefault(); saveForm().catch((err) => toast(err.message)); });
$("#btn-subfilters").addEventListener("click", () => {
  $("#subfilters").classList.toggle("open");
  $("#btn-subfilters").classList.toggle("on");
});
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => (b.closest(".sheet-back").hidden = true)));
document.querySelectorAll(".sheet-back").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
$("#req-form").addEventListener("input", updateMissingNote);
for (const id of ["#f-project", "#f-location"]) $(id).addEventListener("change", refresh);
let searchT;
$("#f-search").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(refresh, 250); });

const now = new Date();
$("#clock-date").textContent = `${now.getDate()}.${now.getMonth() + 1}.${String(now.getFullYear()).slice(2)}`;

refresh().catch((err) => toast(err.message));
