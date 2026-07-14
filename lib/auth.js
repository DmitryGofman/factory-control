import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "fc_session";
const MAX_AGE = 30 * 24 * 3600; // 30 יום

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET לא מוגדר");
  return s;
}

/* --- סיסמאות: scrypt מהספרייה הסטנדרטית, בלי תלות חיצונית --- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

/* --- סשן: עוגייה חתומה HMAC --- */

function sign(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id,
    name: user.display_name,
    exp: Date.now() + MAX_AGE * 1000,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.uid || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export async function setSessionCookie(user) {
  const jar = await cookies();
  jar.set(COOKIE, makeToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
}

export async function getSession() {
  const jar = await cookies();
  return parseToken(jar.get(COOKIE)?.value);
}
