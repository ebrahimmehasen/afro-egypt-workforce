import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recalculateDailyAttendance } from "@/lib/attendance-service";

/**
 * Biometric punch ingestion (ZKTeco and similar).
 *
 *   POST /api/punch
 *   Header:  X-Punch-Key: <PUNCH_API_KEY>
 *   Body:    { "deviceUserId": "1001", "timestamp": "2026-08-21T08:03:00Z",
 *              "punchType": "in" | "out" (optional), "deviceId": "ZK-DEMO-01" (optional) }
 *
 * `deviceUserId` is matched to Employee.biometricDeviceUserId. When `punchType`
 * is omitted it is inferred (first punch of the working day = in, otherwise out).
 */
const punchSchema = z.object({
  deviceUserId: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  punchType: z.enum(["in", "out"]).optional(),
  deviceId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-punch-key");
  if (!process.env.PUNCH_API_KEY || key !== process.env.PUNCH_API_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = punchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { deviceUserId, timestamp, punchType, deviceId } = parsed.data;
  const at = timestamp ? new Date(timestamp) : new Date();

  const employee = await prisma.employee.findFirst({
    where: { biometricDeviceUserId: deviceUserId, deletedAt: null },
  });
  if (!employee) {
    return NextResponse.json({ error: "unknown deviceUserId", deviceUserId }, { status: 404 });
  }

  const device = deviceId ? await prisma.device.findUnique({ where: { id: deviceId } }) : null;

  const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const resolvedType =
    punchType ??
    ((await prisma.attendanceLog.count({
      where: { employeeId: employee.id, timestamp: { gte: dayStart, lt: dayEnd } },
    })) === 0
      ? "in"
      : "out");

  await prisma.attendanceLog.create({
    data: {
      employeeId: employee.id,
      deviceId: device ? device.id : null,
      deviceUserId,
      timestamp: at,
      punchType: resolvedType,
      source: "biometric",
      rawPayload: body as object,
    },
  });

  const dateStr = at.toISOString().slice(0, 10);
  const daily = await recalculateDailyAttendance(employee.id, dateStr);

  return NextResponse.json({
    ok: true,
    employeeId: employee.id,
    punchType: resolvedType,
    date: dateStr,
    status: daily?.status ?? null,
  });
}
