import { getSession } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** The bell's feed for the signed-in user (session checked here — /api skips the middleware). */
export async function GET() {
  const user = await getSession();
  if (!user) return new Response("unauthorized", { status: 401 });
  return Response.json(await getNotifications(user), { headers: { "Cache-Control": "no-store" } });
}
