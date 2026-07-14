import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth.js";
import { getHistory } from "../../../../../lib/store.js";

export async function GET(req, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json(await getHistory(Number(id)));
}
