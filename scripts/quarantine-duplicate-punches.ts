// One-off: marks the copies of corrected punches as quarantined (see src/lib/punch-quarantine.ts).
//
//   npx tsx scripts/quarantine-duplicate-punches.ts                       dry run: reports what it would mark
//   npx tsx scripts/quarantine-duplicate-punches.ts --apply --expect 434  marks exactly that many, or nothing
//   ... --out <file>                                                      also writes the marked ids to <file>
//
// Nothing is deleted and no time is changed: each marked row gets `rawPayload.duplicateOfCorrection`. The rows to
// mark are found by the lineage rule in findDuplicateLineage (the corrected punch carries the stamp its copy
// holds, one hour later). `--apply` refuses to write unless the count equals --expect and nothing is ambiguous.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { findDuplicateLineage, markedPayload } from "../src/lib/punch-quarantine";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.attendanceLog.findMany({ select: { id: true, employeeId: true, timestamp: true, source: true, rawPayload: true } });
    const { pairs, ambiguous } = findDuplicateLineage(rows);
    console.log(JSON.stringify({ rows: rows.length, pairs: pairs.length, ambiguous: ambiguous.length }));
    if (ambiguous.length > 0) console.log("ambiguous twins:", JSON.stringify(ambiguous.slice(0, 10)));

    const out = value("--out");
    if (!flag("--apply")) {
      console.log("dry run: nothing written");
      return;
    }
    const expect = Number(value("--expect"));
    if (!Number.isInteger(expect)) throw new Error("--apply needs --expect <count>");
    if (ambiguous.length > 0) throw new Error(`stop: ${ambiguous.length} ambiguous twin(s)`);
    if (pairs.length !== expect) throw new Error(`stop: found ${pairs.length} rows to mark, expected ${expect}`);

    const markedAt = new Date();
    const byId = new Map(rows.map((r) => [r.id, r]));
    await prisma.$transaction(
      async (tx) => {
        for (const pair of pairs) {
          const row = byId.get(pair.duplicateId)!;
          await tx.attendanceLog.update({
            where: { id: pair.duplicateId },
            data: { rawPayload: markedPayload(row.rawPayload, pair, markedAt) },
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    console.log(`marked ${pairs.length} rows`);
    if (out) {
      fs.writeFileSync(
        out,
        ["duplicateId\ttwinId\tcorrectionStamp\tmarkedAt", ...pairs.map((p) => `${p.duplicateId}\t${p.twinId}\t${p.correctionStamp}\t${markedAt.toISOString()}`)].join("\n") + "\n",
      );
      console.log("ids written to", out);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
