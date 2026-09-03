/**
 * Production seed — the bare minimum to start using the system for real:
 *   - 6 departments, 3 shifts, the 3 settings singletons, the biometric device
 *   - ONE admin user
 *   - NO employees / attendance / payroll / demo data
 *
 * Run once, right after `prisma migrate deploy`:
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npx tsx prisma/seed-prod.ts
 *
 * Safe to re-run: it upserts and never deletes existing data.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEPARTMENTS = [
  "الإنتاج",
  "المخازن",
  "الصيانة",
  "الأمن",
  "الموارد البشرية",
  "الحسابات",
];

const SHIFTS = [
  { id: "SHIFT-MORNING", name: "الوردية الصباحية", startTime: "08:00", endTime: "16:00", workDays: [0, 1, 2, 3, 4, 5], allowOvertime: true },
  { id: "SHIFT-EVENING", name: "الوردية المسائية", startTime: "16:00", endTime: "00:00", workDays: [0, 1, 2, 3, 4, 5], allowOvertime: true },
  { id: "SHIFT-NIGHT", name: "الوردية الليلية", startTime: "00:00", endTime: "08:00", workDays: [0, 1, 2, 3, 4, 5], allowOvertime: false },
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@afroegypt.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe!123";

  await prisma.companySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      companyName: "Afro Egypt",
      logoUrl: "/brand/afro-egypt-logo.jpg",
      address: "المنطقة الصناعية، القاهرة، مصر",
      phone: "+20 2 0000 0000",
    },
  });
  await prisma.attendanceSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
  await prisma.payrollSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });

  for (let i = 0; i < DEPARTMENTS.length; i++) {
    await prisma.department.upsert({
      where: { id: `DEP-${i + 1}` },
      update: {},
      create: { id: `DEP-${i + 1}`, name: DEPARTMENTS[i], managerName: "—" },
    });
  }

  for (const s of SHIFTS) {
    await prisma.shift.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, gracePeriodMinutes: 10 },
    });
  }

  await prisma.device.upsert({
    where: { id: "ZK-01" },
    update: {},
    create: { id: "ZK-01", name: "جهاز البصمة", location: "البوابة الرئيسية" },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: "System Administrator",
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "admin",
      },
    });
    console.log(`Created admin user: ${adminEmail}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`  password: ${adminPassword}  <-- CHANGE THIS after first login`);
    }
  } else {
    console.log(`Admin user ${adminEmail} already exists — left unchanged.`);
  }

  console.log("Production seed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
