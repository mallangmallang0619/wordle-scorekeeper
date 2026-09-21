import { describe, expect, it } from "vitest";
import { FAIL_PENALTY, POINTS, pointsFor } from "../src/scoring.js";

describe("scoring", () => {
  it("has a value for every attempt count", () => expect(Object.keys(POINTS).map(Number).sort()).toEqual([1, 2, 3, 4, 5, 6]));
  it("gives strictly more points for fewer attempts", () => {
    for (let n = 1; n < 6; n++) expect(pointsFor(n)).toBeGreaterThan(pointsFor(n + 1));
  });
  it("makes 1/6 a jackpot (at least double 2/6)", () => expect(pointsFor(1)).toBeGreaterThanOrEqual(2 * pointsFor(2)));
  it("every solve is positive", () => {
    for (let n = 1; n <= 6; n++) expect(pointsFor(n)).toBeGreaterThan(0);
  });
  it("penalises fails", () => {
    expect(pointsFor(null)).toBe(FAIL_PENALTY);
    expect(FAIL_PENALTY).toBeLessThan(0);
  });
});
