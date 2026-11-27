import type { User } from "@/lib/types";

// Employee evaluation ("تقييم الموظفين") is admin-only, exactly like /users and /permissions: never a grantable
// permission (see PERMISSION_DEFS / ADMIN_NAV in src/lib/permissions.ts), so HR, a supervisor and an employee never
// see it — not the page, not an action, not a document link, not the nav item, under any permission grant.
export const canUseEvaluation = (user: Pick<User, "role">): boolean => user.role === "admin";
