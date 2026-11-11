import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { allowedNavPaths, canUseAssistant } from "@/lib/permissions";
import { AppShell } from "@/components/layout/app-shell";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { AssistantDraftProvider } from "@/components/assistant/draft-provider";

// Every page in this group reads per-request session + live DB data.
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const shell = (
    <AppShell user={user} allowedPaths={allowedNavPaths(user)}>
      {children}
    </AppShell>
  );
  // admin only, on every page; and only where the assistant service has been set up (not on the training site)
  const assistant = canUseAssistant(user) && Boolean(process.env.ASSISTANT_BRIDGE_SECRET);

  if (!assistant) return shell;
  return (
    <>
      {/* forms the assistant filled in arrive through a link; the provider hands each to the dialog it is for */}
      <Suspense fallback={shell}>
        <AssistantDraftProvider>{shell}</AssistantDraftProvider>
      </Suspense>
      <AssistantWidget />
    </>
  );
}
