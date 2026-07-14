"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
const CHIPS = [
  { key: "open", label: "פתוחות", stat: "open", cls: "" },
  { key: "overdue", label: 'חורגות תג"ב', stat: "overdue", cls: "alert" },
  { key: "מעוכבת", label: "מעוכבות", stat: "delayed", cls: "alert" },
  { key: "ממתינה לאישור", label: "ממתינות", stat: "awaiting", cls: "warn" },
  { key: "due_soon", label: 'תג"ב קרוב', stat: "due_soon", cls: "warn" },
  { key: "הושלמה", label: "הושלמו", stat: "completed_30d", cls: "ok" },
  { key: "all", label: "הכל", stat: null, cls: "" },
];
const FORM_FIELDS = ["project", "project_alias", "subject", "quantity", "requester",
  "approver", "approval_date", "location", "due_date", "system_name",
  "external_id", "notes", "priority"];
const REQUIRED = {
  project: "פרויקט", subject: "נושא הייצור", quantity: "כמות", requester: "מכניס עבודה",
  approver: "בקר מאשר", approval_date: "תאריך אישור", location: "מיקום ייצור",
  due_date: 'תג"ב נדרש', system_name: "שם ייצור במערכת",
};
const EMPTY_FORM = Object.fromEntries(FORM_FIELDS.map((k) => [k, k === "priority" ? "רגיל" : ""]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "שגיאת שרת");
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+d}.${+m}.${y.slice(2)}`;
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState(null);
  const [chip, setChip] = useState("open");
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [location, setLocation] = useState("");
  const [showSub, setShowSub] = useState(false);
  const [detail, setDetail] = useState(null); // {req, hist}
  const [form, setForm] = useState(null);     // {editId, serial, values}
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }, []);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (project) params.set("project", project);
    if (location) params.set("location", location);
    try {
      const [reqs, st] = await Promise.all([
        api("/api/requests?" + params.toString()),
        api("/api/stats"),
      ]);
      setRequests(reqs);
      setStats(st);
    } catch (err) {
      if (err.status === 401) router.push("/login");
      else say(err.message);
    }
  }, [q, project, location, router, say]);

  useEffect(() => {
    api("/api/auth/me")
      .then(setUser)
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(refresh, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [user, refresh, q]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function openDetail(id) {
    try {
      const [req, hist] = await Promise.all([
        api(`/api/requests/${id}`),
        api(`/api/requests/${id}/history`),
      ]);
      setDetail({ req, hist });
    } catch (err) { say(err.message); }
  }

  async function changeStatus(id, status) {
    try {
      await api(`/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      say(`הסטטוס עודכן ל"${status}"`);
      setDetail(null);
      refresh();
    } catch (err) { say(err.message); }
  }

  async function copyWhatsApp() {
    try {
      await navigator.clipboard.writeText(detail.req.whatsapp);
      say("הועתק — אפשר להדביק ב-WhatsApp");
    } catch {
      say("ההעתקה נחסמה ע\"י הדפדפן");
    }
  }

  function openForm(editReq) {
    if (editReq) {
      const values = { ...EMPTY_FORM };
      for (const k of FORM_FIELDS) if (editReq[k]) values[k] = editReq[k];
      setForm({ editId: editReq.id, serial: editReq.serial, values });
      setDetail(null);
    } else {
      setForm({ editId: null, serial: null, values: { ...EMPTY_FORM } });
    }
  }

  async function saveForm() {
    try {
      if (form.editId) {
        await api(`/api/requests/${form.editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form.values),
        });
        say("הבקשה עודכנה");
      } else {
        const created = await api("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form.values),
        });
        say(`נקלטה בקשה #${created.serial} (${created.status})`);
      }
      setForm(null);
      refresh();
    } catch (err) { say(err.message); }
  }

  const chipFilter = (r) => {
    switch (chip) {
      case "open": return OPEN_STATUSES.includes(r.status);
      case "overdue": return r.overdue;
      case "due_soon": return r.due_soon;
      case "all": return true;
      default: return r.status === chip;
    }
  };
  const urgency = (r) => !OPEN_STATUSES.includes(r.status) ? 1e9
    : r.days_to_due == null ? 1e8 : r.days_to_due;
  const rows = requests.filter(chipFilter).sort((a, b) => urgency(a) - urgency(b));
  const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const closedRows = rows.filter((r) => !OPEN_STATUSES.includes(r.status));
  const formMissing = form
    ? Object.entries(REQUIRED).filter(([k]) => !form.values[k]).map(([, v]) => v)
    : [];

  if (!user) return null;

  return (
    <>
      <div className="shell">
        <header className="appbar">
          <div className="row1">
            <h1><b>◤</b> בקרת ייצור — מדור</h1>
            <button className="userchip" onClick={logout} title="יציאה">{user.name} · יציאה</button>
          </div>
          <div className="chips">
            {CHIPS.map((c) => (
              <button key={c.key} className={`chip ${c.cls} ${chip === c.key ? "on" : ""}`}
                onClick={() => setChip(c.key)}>
                {c.label}{c.stat != null && stats ? <b>{stats[c.stat]}</b> : null}
              </button>
            ))}
          </div>
          <div className="searchrow">
            <input type="search" placeholder="חיפוש: פרויקט, מבקש, נושא, #מזהה..."
              value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={`iconbtn ${showSub ? "on" : ""}`} title="סינון לפי פרויקט ומיקום"
              onClick={() => setShowSub(!showSub)}>⚙</button>
          </div>
          <div className={`subfilters ${showSub ? "open" : ""}`}>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">כל הפרויקטים</option>
              {stats?.projects.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">כל מיקומי הייצור</option>
              {stats?.locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        </header>

        <main className="feed">
          {openRows.length > 0 && <div className="day-label">לפי דחיפות תג"ב</div>}
          {openRows.map((r) => <Card key={r.id} r={r} onClick={() => openDetail(r.id)} />)}
          {closedRows.length > 0 && <div className="day-label">סגורות</div>}
          {closedRows.map((r) => <Card key={r.id} r={r} onClick={() => openDetail(r.id)} />)}
          {rows.length === 0 && <div className="empty">אין בקשות להצגה</div>}
        </main>
      </div>

      <nav className="navbar">
        <div className="inner">
          <button className="nav-item on" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="ic">◉</span>תור עבודות
          </button>
          <button className="nav-item primary" onClick={() => openForm(null)}>
            <span className="ic">＋</span>בקשה חדשה
          </button>
        </div>
      </nav>

      {detail && (
        <DetailSheet detail={detail} onClose={() => setDetail(null)}
          onStatus={changeStatus} onCopy={copyWhatsApp} onEdit={() => openForm(detail.req)} />
      )}

      {form && (
        <div className="sheet-back" onClick={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="sheet">
            <div className="sheet-head">
              <h2>{form.editId ? `עריכת בקשה #${form.serial}` : "בקשה חדשה"}</h2>
              <button className="btn-close" onClick={() => setForm(null)}>×</button>
            </div>
            <div className="sheet-body">
              <FormFields values={form.values} locations={stats?.locations || []}
                onChange={(k, v) => setForm({ ...form, values: { ...form.values, [k]: v } })} />
              <div className="missing-note">
                {formMissing.length > 0 &&
                  `⚠ חסרים: ${formMissing.join(", ")} — הבקשה תיקלט כ"מעוכבת" עד השלמתם`}
              </div>
            </div>
            <div className="sheet-foot">
              <button className="btn primary wide" onClick={saveForm}>שמירה</button>
              <button className="btn wide" onClick={() => setForm(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Card({ r, onClick }) {
  const open = OPEN_STATUSES.includes(r.status);
  const rail = r.overdue ? "hot" : r.due_soon ? "warm" : "";
  return (
    <button className={`req ${rail} ${open ? "" : "closed"}`} onClick={onClick}>
      <div className="top">
        <span className="proj">
          {r.project || "ללא פרויקט"}
          {r.project_alias && <span className="alias"> ({r.project_alias})</span>}
        </span>
        <span className="id">#{r.serial}{r.external_id ? ` · #${r.external_id}` : ""}</span>
      </div>
      <div className="what">
        {r.subject || "—"}{r.quantity ? ` · ${r.quantity}` : ""}{r.location ? ` · ${r.location}` : ""}
      </div>
      <div className="foot">
        <DueBadge r={r} open={open} />
        <span className="pill"><span className={`lamp ${LAMP[r.status] || "grey"}`} />{r.status}</span>
        {r.requester && <span className="pill">{r.requester}</span>}
        {r.priority && r.priority !== "רגיל" &&
          <span className="pill" style={{ color: "var(--red)", borderColor: "var(--red)" }}>{r.priority}</span>}
      </div>
      {r.missing.length > 0 && <div className="miss">⚠ חסר: {r.missing.join(", ")}</div>}
    </button>
  );
}

function DueBadge({ r, open }) {
  if (r.overdue) return <span className="count red">⏰ חריגה {-r.days_to_due} ימים</span>;
  if (r.due_soon) {
    const when = r.days_to_due === 0 ? "היום" : r.days_to_due === 1 ? "מחר" : "בעוד יומיים";
    return <span className="count amber">תג"ב {when} · {fmtDate(r.due_date)}</span>;
  }
  if (open && r.days_to_due != null)
    return <span className="count ok">עוד {r.days_to_due} ימים · {fmtDate(r.due_date)}</span>;
  if (open) return <span className="count dim">ללא תג"ב</span>;
  const closedDate = fmtDate((r.completed_at || r.updated_at || "").slice(0, 10));
  return <span className={`count ${r.status === "הושלמה" ? "ok" : "dim"}`}>
    {r.status === "הושלמה" ? "✔ " : ""}{r.status} {closedDate}
  </span>;
}

function DetailSheet({ detail, onClose, onStatus, onCopy, onEdit }) {
  const r = detail.req;
  const kv = [
    ["סטטוס", <><span className={`lamp ${LAMP[r.status] || "grey"}`} />{r.status}</>],
    ["רשום תחת", r.project_alias || null],
    ["כמות", r.quantity],
    ["מכניס עבודה", r.requester],
    ["בקר מאשר", r.approver
      ? `${r.approver}${r.approval_date ? ` · ${fmtDate(r.approval_date)}` : " · טרם אושר"}` : null],
    ["מיקום ייצור", r.location],
    ['תג"ב נדרש', fmtDate(r.due_date)],
    ["שם ייצור במערכת", r.system_name],
    ["מזהה חיצוני", r.external_id ? `#${r.external_id}` : null],
    ["עדיפות", r.priority !== "רגיל" ? r.priority : null],
    ["הערות מיוחדות", r.notes || null],
    ["נקלטה", fmtDate((r.created_at || "").slice(0, 10))],
  ].filter(([, v]) => v);

  return (
    <div className="sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h2>#{r.serial} · {r.project || "ללא פרויקט"}
            <span className="sub2">{r.subject}</span>
          </h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        {r.overdue ? (
          <div className="banner red">⏰ חריגת תג"ב — {-r.days_to_due} ימים. תג"ב נדרש: {fmtDate(r.due_date)}</div>
        ) : r.missing.length > 0 ? (
          <div className="banner amber">⚠ חסרים: {r.missing.join(", ")} — מעוכבת עד השלמה (נוהל 16/06)</div>
        ) : null}
        <div className="sheet-body">
          <div className="kv">
            {kv.map(([k, v]) => (
              <div className="row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
            ))}
          </div>
          <div className="hist">
            <h3>היסטוריה</h3>
            {detail.hist.length === 0 && <div className="h-item">אין רשומות</div>}
            {detail.hist.map((h) => (
              <div className="h-item" key={h.id}>
                <span className="ts">{h.ts.slice(5, 16).replace("T", " ")}</span> · <b>{h.action}</b>
                {h.field && h.field !== "status" ? ` (${h.field})` : ""}
                {(h.old_value || h.new_value) ? `: ${h.old_value || "ריק"} ← ${h.new_value || "ריק"}` : ""}
                {h.actor && <span className="ts"> · {h.actor}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="sheet-foot">
          {(NEXT_ACTIONS[r.status] || []).map((s) => (
            <button key={s} className={`btn half ${s === "הושלמה" || s === "מאושרת" ? "primary" : ""}`}
              onClick={() => onStatus(r.id, s)}>
              {s === "הושלמה" ? "✔ סמן הושלמה" : s}
            </button>
          ))}
          <button className="btn half" onClick={onCopy}>📋 העתק כ-WhatsApp</button>
          <button className="btn half" onClick={onEdit}>✏️ עריכה</button>
        </div>
      </div>
    </div>
  );
}

function FormFields({ values, locations, onChange }) {
  const field = (key, label, props = {}) => (
    <label className={props.wide ? "wide" : ""}>{label}
      {props.textarea ? (
        <textarea rows={2} value={values[key]} onChange={(e) => onChange(key, e.target.value)} />
      ) : props.select ? (
        <select value={values[key]} onChange={(e) => onChange(key, e.target.value)}>
          {props.select.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={props.type || "text"} list={props.list} value={values[key]}
          onChange={(e) => onChange(key, e.target.value)} />
      )}
    </label>
  );
  return (
    <div className="fgrid">
      {field("project", "פרויקט *")}
      {field("project_alias", "רשום תחת (כינוי)")}
      {field("subject", "נושא הייצור *", { wide: true, textarea: true })}
      {field("quantity", "כמות *")}
      {field("requester", "מכניס עבודה *")}
      {field("approver", "בקר מאשר *")}
      {field("approval_date", "תאריך אישור *", { type: "date" })}
      {field("location", "מיקום ייצור *", { list: "loc-list" })}
      <datalist id="loc-list">{locations.map((l) => <option key={l} value={l} />)}</datalist>
      {field("due_date", 'תג"ב נדרש *', { type: "date" })}
      {field("system_name", "שם ייצור במערכת *", { wide: true })}
      {field("external_id", "מזהה חיצוני (#)")}
      {field("priority", "עדיפות", { select: ["רגיל", "דחוף", "מיידי"] })}
      {field("notes", "הערות מיוחדות", { wide: true, textarea: true })}
    </div>
  );
}
