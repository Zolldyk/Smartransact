import { describe, it, expect } from "vitest";
import { invertLeaderSchedule } from "./ws-adapter.js";

describe("invertLeaderSchedule", () => {
  it("(a) empty input → empty map", () => {
    expect(invertLeaderSchedule({}, 100n).size).toBe(0);
  });

  it("(b) single validator two indices → correct absolute slots", () => {
    const result = invertLeaderSchedule(
      { "ValidatorA": [0n, 4n] },
      200n,
    );
    expect(result.get(200n)).toBe("ValidatorA");
    expect(result.get(204n)).toBe("ValidatorA");
    expect(result.size).toBe(2);
  });

  it("(c) two validators → each slot maps to correct validator", () => {
    const result = invertLeaderSchedule(
      { "ValidatorA": [0n, 2n], "ValidatorB": [1n, 3n] },
      100n,
    );
    expect(result.get(100n)).toBe("ValidatorA");
    expect(result.get(101n)).toBe("ValidatorB");
    expect(result.get(102n)).toBe("ValidatorA");
    expect(result.get(103n)).toBe("ValidatorB");
    expect(result.size).toBe(4);
  });
});
