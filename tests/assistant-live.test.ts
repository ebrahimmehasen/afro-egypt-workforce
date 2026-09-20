import { describe, expect, it } from "vitest";
import { runAssistant } from "@/lib/assistant/run";
import { ctx } from "./helpers/assistant-fixture";

// End-to-end against the real hosted model, on the fictional fixture data only. Skipped unless both a key and
// RUN_LIVE_ASSISTANT=1 are set, so it never runs in CI or costs anything by accident.
const live = Boolean(process.env.NVIDIA_API_KEY && process.env.RUN_LIVE_ASSISTANT);
const ask = (question: string) => runAssistant({ question, history: [], ctx, userName: "المدير" });

describe.skipIf(!live)("assistant against the live model", () => {
  it("looks up who is missing what, from the data, and recommends what to do", async () => {
    const run = await ask("مين الموظفين اللي ملفاتهم ناقصة؟ وأعمل إيه؟");
    console.log("\n[Q1 tools]", run.toolsUsed, "model:", run.model, "\n" + run.answer);
    expect(run.toolsUsed).toContain("find_data_gaps");
    expect(run.answer).toMatch(/PROD-002|TBD-001/);
  }, 200_000);

  it("answers an overview straight from the snapshot", async () => {
    const run = await ask("ادّيني نظرة عامة سريعة على المصنع");
    console.log("\n[Q2 tools]", run.toolsUsed, "model:", run.model, "\n" + run.answer);
    expect(run.answer.length).toBeGreaterThan(100);
  }, 200_000);

  it("says so instead of inventing an employee who isn't there", async () => {
    const run = await ask("إيه رقم تليفون الموظف عبدالله المحمدي؟");
    console.log("\n[Q3 tools]", run.toolsUsed, "model:", run.model, "\n" + run.answer);
    expect(run.answer).not.toMatch(/0\d{10}/); // no phone number made up (or borrowed from someone else)
  }, 200_000);

  it("keeps outside knowledge separate and labelled when asked for it", async () => {
    const run = await ask("بشكل عام من خارج قاعدة البيانات، إيه أهم الأوراق اللي المفروض تبقى في ملف أي عامل في مصنع؟");
    console.log("\n[Q4 tools]", run.toolsUsed, "model:", run.model, "\n" + run.answer);
    expect(run.answer).toContain("معلومة عامة");
  }, 200_000);
});
