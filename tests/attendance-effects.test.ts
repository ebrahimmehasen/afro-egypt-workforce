import { beforeEach, describe, expect, it, vi } from "vitest";

// The queue's own behaviour, with the posting job and the payroll recalculation stubbed out.
const post = vi.fn();
const recalc = vi.fn();
vi.mock("@/lib/attendance-deductions", () => ({ postAttendanceDeductions: () => post() }));
vi.mock("@/lib/payroll-recalc", () => ({ recalculateOpenPayrollPeriods: () => recalc() }));

const { runAttendanceEffects } = await import("@/lib/attendance-effects");

beforeEach(() => {
  post.mockReset();
  recalc.mockReset();
  recalc.mockResolvedValue(1);
});

describe("posting deductions, then refreshing calculated payroll", () => {
  it("recalculates payroll when the posting changed something", async () => {
    post.mockResolvedValue({ created: 2, updated: 0, removed: 0 });
    expect(await runAttendanceEffects()).toEqual({ created: 2, updated: 0, removed: 0, periods: 1 });
    expect(recalc).toHaveBeenCalledTimes(1);
  });

  it("leaves payroll alone when nothing changed (the 10-minute run is usually a no-op)", async () => {
    post.mockResolvedValue({ created: 0, updated: 0, removed: 0 });
    expect(await runAttendanceEffects()).toMatchObject({ periods: 0 });
    expect(recalc).not.toHaveBeenCalled();
  });

  it("a deduction changed by hand forces the payroll refresh even if the posting changed nothing", async () => {
    post.mockResolvedValue({ created: 0, updated: 0, removed: 0 });
    await runAttendanceEffects({ payrollChanged: true });
    expect(recalc).toHaveBeenCalledTimes(1);
  });

  it("runs one at a time: a second call waits for the first to finish", async () => {
    const order: string[] = [];
    let release!: () => void;
    post
      .mockImplementationOnce(async () => {
        order.push("first:start");
        await new Promise<void>((r) => (release = r));
        order.push("first:end");
        return { created: 0, updated: 0, removed: 0 };
      })
      .mockImplementationOnce(async () => {
        order.push("second:start");
        return { created: 0, updated: 0, removed: 0 };
      });
    const a = runAttendanceEffects();
    const b = runAttendanceEffects();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("a failed run doesn't block the next one", async () => {
    post.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ created: 1, updated: 0, removed: 0 });
    await expect(runAttendanceEffects()).rejects.toThrow("db down");
    expect(await runAttendanceEffects()).toMatchObject({ created: 1, periods: 1 });
  });
});
