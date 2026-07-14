import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth.js";
import { createRequest, listRequests } from "../../../lib/store.js";

export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const rows = await listRequests({
    status: p.get("status") || "",
    project: p.get("project") || "",
    location: p.get("location") || "",
    q: p.get("q") || "",
  });
  return NextResponse.json(rows);
}

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const row = await createRequest(body, session.name);
  return NextResponse.json(row, { status: 201 });
}
