import { NextResponse } from "next/server";
import { db } from "../../../../lib/db.js";
import { hashPassword, setSessionCookie } from "../../../../lib/auth.js";
import { nowIso } from "../../../../lib/domain.js";

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

  const username = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.display_name || "").trim();
  const password = String(body.password || "");
  const joinCode = String(body.join_code || "");

  if (!process.env.JOIN_CODE) {
    return NextResponse.json({ error: "JOIN_CODE לא מוגדר בשרת — הרשמה חסומה" }, { status: 500 });
  }
  if (joinCode !== process.env.JOIN_CODE) {
    return NextResponse.json({ error: "קוד הצטרפות שגוי" }, { status: 403 });
  }
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    return NextResponse.json({ error: "שם משתמש: 2–32 תווים באנגלית/ספרות/נקודה/מקף" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "חסר שם תצוגה (השם שיופיע בהיסטוריה)" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "סיסמה: לפחות 6 תווים" }, { status: 400 });
  }

  const pool = await db();
  let user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, created_at)
       VALUES ($1,$2,$3,$4) RETURNING id, username, display_name`,
      [username, displayName, hashPassword(password), nowIso()],
    );
    user = rows[0];
  } catch (e) {
    if (e.code === "23505") {
      return NextResponse.json({ error: "שם המשתמש כבר תפוס" }, { status: 409 });
    }
    throw e;
  }
  await setSessionCookie(user);
  return NextResponse.json({ id: user.id, username: user.username, display_name: user.display_name }, { status: 201 });
}
