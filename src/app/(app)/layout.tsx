import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { allowedNavPaths } from "@/lib/permissions";
import { AppShell } from "@/components/layout/app-shell";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = getSession();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} allowedPaths={allowedNavPaths(user.role)}>
      {children}
    </AppShell>
  );
}
