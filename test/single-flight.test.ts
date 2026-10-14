import { describe, expect, it } from "vitest";
import { SingleFlight } from "../src/sessions/single-flight";

describe("SingleFlight", () => {
  it("coalesces concurrent duplicate requests but never caches completed results", async () => {
    const flight = new SingleFlight<number>();
    let calls = 0;
    let finish!: (value: number) => void;
    const first = flight.run("same-query", async () => {
      calls += 1;
      return await new Promise<number>((resolve) => { finish = resolve; });
    });
    const second = flight.run("same-query", async () => {
      calls += 1;
      return 99;
    });

    await Promise.resolve();
    expect(calls).toBe(1);
    expect(flight.pendingCount).toBe(1);
    finish(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
    expect(flight.pendingCount).toBe(0);

    await expect(flight.run("same-query", async () => {
      calls += 1;
      return 8;
    })).resolves.toBe(8);
    expect(calls).toBe(2);
  });

  it("clears a rejected in-flight promise so a later attempt can recover", async () => {
    const flight = new SingleFlight<string>();
    await expect(flight.run("retry", async () => { throw new Error("temporary"); }))
      .rejects.toThrow("temporary");
    await expect(flight.run("retry", async () => "recovered")).resolves.toBe("recovered");
  });
});
