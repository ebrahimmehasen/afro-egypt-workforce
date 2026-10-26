import { TOOL_DEFINITIONS, ToolContext, executeTool } from "@/lib/assistant/employee-tools";
import { SYSTEM_TOOL_DEFINITIONS, executeSystemTool } from "@/lib/assistant/system-tools";
import { ADMIN_TOOL_DEFINITIONS, executeAdminTool } from "@/lib/assistant/admin-tools";

// The one list of what the assistant can do. Every tool is read-only; the assistant is for the admin, who sees
// the whole system, so these tools read all of it. Nothing here can write to the database.

export const ALL_TOOL_DEFINITIONS = [...TOOL_DEFINITIONS, ...SYSTEM_TOOL_DEFINITIONS, ...ADMIN_TOOL_DEFINITIONS] as const;

/** The shape an MCP server lists its tools in. */
export function listTools(): { name: string; description: string; inputSchema: unknown }[] {
  return ALL_TOOL_DEFINITIONS.map((d) => ({ name: d.function.name, description: d.function.description, inputSchema: d.function.parameters }));
}

/** Runs one tool by name. Unknown names and bad arguments come back as an { error } the model can read. */
export function runTool(name: string, args: unknown, ctx: ToolContext): unknown {
  const fromAdmin = executeAdminTool(name, args, ctx);
  if (fromAdmin !== undefined) return fromAdmin;
  const fromSystem = executeSystemTool(name, args, ctx);
  return fromSystem !== undefined ? fromSystem : executeTool(name, args, ctx);
}
