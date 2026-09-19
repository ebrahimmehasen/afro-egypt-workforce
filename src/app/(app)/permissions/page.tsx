import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth";

/**
 * Permissions now live on each user's details page (/users/[id]). This route
 * only keeps old links and bookmarks working.
 */
export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  await requireAccess("/permissions");
  const { u } = await searchParams;
  redirect(u ? `/users/${encodeURIComponent(u)}` : "/users");
}
