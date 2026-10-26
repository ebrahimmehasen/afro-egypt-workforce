import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { allowedNavPaths, canUseAssistant } from "@/lib/permissions";
import { AppShell } from "@/components/layout/app-shell";
import { AssistantWidget } from "@/components/assistant/assistant-widget";

// Every page in this group reads per-request session + live DB data.
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <>
      <AppShell user={user} allowedPaths={allowedNavPaths(user)}>
        {children}
      </AppShell>
      {/* admin only, on every page; and only where the assistant service has been set up (not on the training site) */}
      {canUseAssistant(user) && Boolean(process.env.ASSISTANT_BRIDGE_SECRET) && <AssistantWidget />}
    </>
  );
}
