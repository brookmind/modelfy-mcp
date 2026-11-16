import { describe, expect, it } from "vitest";
import { createQueue } from "../src/serial.ts";

describe("createQueue", () => {
  it("runs tasks one at a time, in order, even when started together", async () => {
    const run = createQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => async (): Promise<string> => {
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([run(task("a", 20)), run(task("b", 1))]);

    expect(results).toEqual(["a", "b"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("keeps going after a task fails", async () => {
    const run = createQueue();

    const failed = run(() => Promise.reject(new Error("refresh failed")));
    const next = run(() => Promise.resolve("ok"));

    await expect(failed).rejects.toThrow("refresh failed");
    await expect(next).resolves.toBe("ok");
  });
});
