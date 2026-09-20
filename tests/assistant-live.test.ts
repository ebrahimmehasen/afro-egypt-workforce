import { describe, expect, it } from "vitest";
import { HistoryTurn, runAssistant } from "@/lib/assistant/run";
import { ctx } from "./helpers/assistant-fixture";

// End-to-end against the real hosted model, on the fictional fixture data only. Skipped unless both a key and
// RUN_LIVE_ASSISTANT=1 are set, so it never runs in CI or costs anything by accident.
const live = Boolean(process.env.NVIDIA_API_KEY && process.env.RUN_LIVE_ASSISTANT);
const ask = (question: string, history: HistoryTurn[] = []) => runAssistant({ question, history, ctx, userName: "المدير" });

// vocabulary that belongs to the system's insides and should never be shown to the reader
const INSIDE_WORDS = /ثغرات|ثغرة|find_missing_items|search_employees|get_employee|company_overview|employeesWith|documentFilesOnFile|\b[A-Z]{2,6}-\d{2,4}\b|\bnull\b|\bundefined\b|\bactive\b|\bterminated\b/;

describe.skipIf(!live)("assistant against the live model", () => {
  it("answers short, in Egyptian Arabic, with no system vocabulary — then goes deeper and formal on request", async () => {
    const q1 = "مين أقل موظف عنده ملفات؟";
    const first = await ask(q1);
    console.log("\n[1 short] tools:", first.toolsUsed, "chars:", first.answer.length, "\n" + first.answer);
    expect(first.toolsUsed).toContain("find_missing_items");
    expect(first.answer.length).toBeLessThan(450);
    expect(first.answer).not.toMatch(/\|/); // no table
    expect(first.answer).not.toMatch(/^#/m); // no headings
    expect(first.answer).not.toMatch(INSIDE_WORDS);

    const history: HistoryTurn[] = [
      { role: "user", content: q1 },
      { role: "assistant", content: first.answer },
    ];

    const more = await ask("فصّل أكتر", history);
    console.log("\n[2 more] tools:", more.toolsUsed, "chars:", more.answer.length, "\n" + more.answer);
    expect(more.answer.length).toBeGreaterThan(first.answer.length);
    expect(more.answer).not.toMatch(INSIDE_WORDS);

    const formal = await ask("عايز كلام رسمي", [...history, { role: "user", content: "فصّل أكتر" }, { role: "assistant", content: more.answer }]);
    console.log("\n[3 formal] tools:", formal.toolsUsed, "chars:", formal.answer.length, "\n" + formal.answer);
    expect(formal.answer.length).toBeGreaterThan(0);
    expect(formal.answer).not.toMatch(INSIDE_WORDS);
  }, 400_000);

  it("gives the overview short too", async () => {
    const run = await ask("ادّيني نظرة عامة سريعة على المصنع");
    console.log("\n[overview] tools:", run.toolsUsed, "chars:", run.answer.length, "\n" + run.answer);
    expect(run.answer.length).toBeLessThan(700);
    expect(run.answer).not.toMatch(INSIDE_WORDS);
  }, 200_000);

  it("says so instead of inventing an employee who isn't there", async () => {
    const run = await ask("إيه رقم تليفون الموظف عبدالله المحمدي؟");
    console.log("\n[missing person] tools:", run.toolsUsed, "\n" + run.answer);
    expect(run.answer).not.toMatch(/0\d{10}/); // no phone number made up (or borrowed from someone else)
    expect(run.answer).not.toMatch(INSIDE_WORDS);
    expect(run.answer.length).toBeLessThan(300); // one line saying so, not a roster of everyone else
  }, 200_000);

  it("keeps outside knowledge separate and labelled when asked for it", async () => {
    const run = await ask("بشكل عام من خارج بياناتنا، إيه أهم الأوراق اللي المفروض تبقى في ملف أي عامل في مصنع؟");
    console.log("\n[outside] tools:", run.toolsUsed, "\n" + run.answer);
    expect(run.answer).toContain("معلومة عامة");
  }, 200_000);
});
