import { NextResponse } from "next/server";
import { db } from "../../../../lib/db.js";
import { setSessionCookie, verifyPassword } from "../../../../lib/auth.js";

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const pool = await db();
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "שם משתמש או סיסמה שגויים" }, { status: 401 });
  }
  await setSessionCookie(user);
  return NextResponse.json({ id: user.id, username: user.username, display_name: user.display_name });
}
