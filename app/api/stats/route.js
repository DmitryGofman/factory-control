import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth.js";
import { stats } from "../../../lib/store.js";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  return NextResponse.json(await stats());
}
