import { NextRequest, NextResponse } from "next/server";
import { HONEYPOT_FIELD, RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";
import { clientIp } from "@/lib/recruitment/rate-limit";
import { submitApplication, type SubmittedFile } from "@/lib/recruitment/submit";

// THE public submit endpoint (with the /apply page): no login, no session, nothing read from the HR system. It answers with a
// status and an error code only: no id, no echo of what was sent. Everything else under /api stays behind its own checks.

const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  // refuse an oversize body before reading any of it
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > L.maxRequestBytes) return reply({ error: "tooLarge" }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply({ error: "invalid" }, 400);
  }

  const values: Record<string, string> = {};
  const files: SubmittedFile[] = [];
  let total = 0;
  for (const [key, entry] of form.entries()) {
    if (typeof entry === "string") {
      if (key !== HONEYPOT_FIELD) values[key] = entry;
    } else {
      // a request without a Content-Length is still held to the same total
      total += entry.size;
      if (total > L.maxRequestBytes) return reply({ error: "tooLarge" }, 413);
      if (entry.size > 0 || entry.name) files.push({ fieldKey: key, name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) });
    }
  }

  const result = await submitApplication({ values, files, honeypot: String(form.get(HONEYPOT_FIELD) ?? ""), ip: clientIp(req.headers) });
  if (!result.ok) return reply({ error: result.error, fields: result.fields }, result.status);
  return reply({ ok: true }, 200);
}
