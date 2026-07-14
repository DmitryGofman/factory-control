"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    username: "", password: "", display_name: "", join_code: "",
  });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      router.push("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1><b>◤</b> בקרת ייצור — מדור</h1>
        <div className="login-tabs">
          <button type="button" className={mode === "login" ? "on" : ""}
            onClick={() => { setMode("login"); setError(""); }}>התחברות</button>
          <button type="button" className={mode === "register" ? "on" : ""}
            onClick={() => { setMode("register"); setError(""); }}>הרשמה</button>
        </div>

        <label>שם משתמש
          <input value={form.username} onChange={set("username")} autoComplete="username"
            dir="ltr" required />
        </label>
        {mode === "register" && (
          <label>שם תצוגה (יופיע בהיסטוריה, למשל: דימה גופמן)
            <input value={form.display_name} onChange={set("display_name")} required />
          </label>
        )}
        <label>סיסמה
          <input type="password" value={form.password} onChange={set("password")}
            autoComplete={mode === "login" ? "current-password" : "new-password"} required />
        </label>
        {mode === "register" && (
          <label>קוד הצטרפות (מקבלים מרכז המדור)
            <input value={form.join_code} onChange={set("join_code")} dir="ltr" required />
          </label>
        )}

        {error && <div className="login-error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>
          {busy ? "רגע..." : mode === "login" ? "כניסה" : "הרשמה וכניסה"}
        </button>
      </form>
    </div>
  );
}
