import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canUseAssistant } from "@/lib/permissions";
import { readDraft } from "@/lib/assistant/drafts";

// The filled-in form behind a link the assistant gave the admin. Admin only, and only the draft that was made for
// this very user; an unknown, someone else's or expired id is simply "gone".
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !canUseAssistant(user)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const draft = id.length > 0 && id.length <= 64 ? readDraft(user.id, id) : null;
  if (!draft) return NextResponse.json({ error: "gone" }, { status: 404, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ draft }, { headers: { "cache-control": "no-store" } });
}
