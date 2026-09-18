import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isSelfService } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";

export interface GateMeta {
  /** Dispatch key an approval later uses to find the right apply function, e.g. "employees.create". */
  actionKey: string;
  /** Localized module label, e.g. t.nav.employees. */
  module: string;
  /** Localized action label, e.g. t.auditActions.addEmployee. */
  actionLabel: string;
  /** Human-readable "what this changes", shown to the admin on /change-requests. */
  summary: string;
  /** The record being updated/deleted, if any. */
  targetId?: string;
}

/**
 * The single choke point separating "true admin — apply now" from
 * "اداري — hold for approval". Every mutating server action that a
 * non-admin "اداري" account can reach calls this instead of writing
 * directly: an admin's write still runs immediately (unchanged behaviour —
 * an admin approving their own request would be meaningless); anyone else's
 * already-validated payload is stored as a pending ChangeRequest and NOT
 * applied. An admin reviews it from /change-requests: approving actually
 * runs `apply()` (attributed to the original requester in the audit log via
 * `applyAs`, kept for parity with `recordChangeAs`), rejecting never does.
 */
export async function gate(
  meta: GateMeta,
  payload: unknown,
  apply: () => Promise<ActionState>,
): Promise<ActionState> {
  const t = await getT();
  const actor = await getSession();
  if (!actor) return { error: t.validation.invalidData };

  if (actor.role === "admin") return apply();

  // Self-service accounts (employees, and staff with no grants) are read-only:
  // they can't even queue a change for approval.
  if (isSelfService(actor)) return { error: t.validation.notAllowed };

  // "All permissions" accounts skip the queue for everything except deletes:
  // the action runs now and is only logged on /change-requests for the admin.
  const isDelete = meta.actionKey.endsWith(".delete");
  if (!isDelete) {
    const account = await prisma.user.findUnique({ where: { id: actor.id }, select: { directEdit: true, active: true } });
    if (account?.active && account.directEdit) {
      const result = await apply();
      if (!result.error) {
        await prisma.changeRequest.create({
          data: {
            requestedById: actor.id,
            requestedBy: actor.name,
            module: meta.module,
            actionLabel: meta.actionLabel,
            actionKey: meta.actionKey,
            targetId: meta.targetId ?? null,
            summary: meta.summary,
            payload: payload as Prisma.InputJsonValue,
            status: "approved",
            direct: true,
            reviewedBy: actor.name,
            reviewedAt: new Date(),
          },
        });
        revalidatePath("/change-requests");
      }
      return result;
    }
  }

  await prisma.changeRequest.create({
    data: {
      requestedById: actor.id,
      requestedBy: actor.name,
      module: meta.module,
      actionLabel: meta.actionLabel,
      actionKey: meta.actionKey,
      targetId: meta.targetId ?? null,
      summary: meta.summary,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/change-requests");
  return { success: true, message: t.changeRequests.submitted };
}
