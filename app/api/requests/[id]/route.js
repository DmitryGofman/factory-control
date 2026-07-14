import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth.js";
import { toWhatsApp } from "../../../../lib/domain.js";
import { getRequest, updateRequest } from "../../../../lib/store.js";

export async function GET(req, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  const { id } = await params;
  const row = await getRequest(Number(id));
  if (!row) return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  row.whatsapp = toWhatsApp(row);
  return NextResponse.json(row);
}

export async function PATCH(req, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const row = await updateRequest(Number(id), body, session.name);
  if (!row) return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  return NextResponse.json(row);
}
