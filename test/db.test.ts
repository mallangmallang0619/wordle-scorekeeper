import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NameTakenError, WordleDb } from "../src/db.js";

let db: WordleDb;
beforeEach(() => (db = new WordleDb(":memory:")));
afterEach(() => db.close());

const put = (user_id: string, puzzle: number, attempts: number | null, points: number, guild = "g1") =>
  db.upsertResult(guild, { user_id, puzzle, attempts, points });
const ids = (rows: { user_id: string }[]) => rows.map((r) => r.user_id);

describe("results", () => {
  it("upserts: re-recording the same puzzle/user replaces, not duplicates", () => {
    put("u1", 10, 4, 6);
    put("u1", 10, 2, 20);
    expect(db.history("g1", "u1", 10)).toEqual([{ puzzle: 10, user_id: "u1", attempts: 2, points: 20 }]);
  });
  it("keeps guilds separate", () => {
    put("u1", 10, 4, 6, "g1");
    put("u1", 10, 1, 50, "g2");
    expect(db.leaderboard("g1", 10)[0].total_points).toBe(6);
    expect(db.leaderboard("g2", 10)[0].total_points).toBe(50);
    expect(db.latestPuzzle("g3")).toBeNull();
  });
  it("stores X/6 as NULL attempts", () => {
    put("u1", 10, null, -3);
    expect(db.history("g1", "u1", 10)[0]).toMatchObject({ attempts: null, points: -3 });
  });
});

describe("leaderboard", () => {
  it("sums points, counts wins, averages attempts, sorts by points", () => {
    put("a", 1, 4, 6); put("a", 2, 2, 20);
    put("b", 1, 3, 10); put("b", 2, null, -3);
    put("c", 1, 6, 2);
    const rows = db.leaderboard("g1", 10);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ total_points: 26, games: 2, wins: 2, avg_attempts: 3, points_per_day: 13 });
    expect(rows[1]).toMatchObject({ total_points: 7, games: 2, wins: 1, avg_attempts: 3, points_per_day: 3.5 }); // AVG ignores NULL
  });
  it("breaks point ties by per-day then average attempts", () => {
    put("slow", 1, 4, 6); put("slow", 2, 4, 6);
    put("fast", 1, 2, 12);
    expect(ids(db.leaderboard("g1", 10))).toEqual(["fast", "slow"]);
  });
  it("respects the limit and returns [] when empty", () => {
    expect(db.leaderboard("g1", 10)).toEqual([]);
    for (let i = 0; i < 5; i++) put(`u${i}`, 1, 4, 6);
    expect(db.leaderboard("g1", 3)).toHaveLength(3);
  });
  it("avg_attempts is null for a player who has only failed", () => {
    put("x", 1, null, -3);
    expect(db.leaderboard("g1", 10)[0].avg_attempts).toBeNull();
  });

  describe("sorts and min-days filter", () => {
    beforeEach(() => {
      put("grinder", 1, 4, 6); put("grinder", 2, 4, 6); put("grinder", 3, 4, 6); put("grinder", 4, 4, 6); // 24 / 4 = 6
      put("lucky", 1, 1, 50);                                                                            // 50 / 1 = 50
      put("steady", 1, 3, 10); put("steady", 2, 3, 10);                                                  // 20 / 2 = 10
      put("fail", 1, null, -3); put("fail", 2, null, -3);                                                // -6 / 2 = -3
    });
    it("computes days played and points per day", () => {
      const by = Object.fromEntries(db.leaderboard("g1", 10).map((r) => [r.user_id, r]));
      expect(by.grinder).toMatchObject({ games: 4, points_per_day: 6 });
      expect(by.lucky).toMatchObject({ games: 1, points_per_day: 50 });
      expect(by.fail).toMatchObject({ games: 2, points_per_day: -3 });
    });
    it("points (default)", () => expect(ids(db.leaderboard("g1", 10))).toEqual(["lucky", "grinder", "steady", "fail"]));
    it("perday", () => expect(ids(db.leaderboard("g1", 10, "perday"))).toEqual(["lucky", "steady", "grinder", "fail"]));
    it("attempts, never-solved last", () => {
      put("sixes", 1, 6, 2);
      expect(ids(db.leaderboard("g1", 10, "attempts"))).toEqual(["lucky", "steady", "grinder", "sixes", "fail"]);
    });
    it("min games drops short histories", () => {
      expect(ids(db.leaderboard("g1", 10, "perday", 2))).toEqual(["steady", "grinder", "fail"]);
      expect(ids(db.leaderboard("g1", 10, "points", 4))).toEqual(["grinder"]);
      expect(db.leaderboard("g1", 10, "points", 5)).toEqual([]);
    });
    it("per-day ties fall back to total points", () => {
      put("a", 10, 4, 6); put("b", 10, 4, 6); put("b", 11, 4, 6);
      const order = ids(db.leaderboard("g1", 10, "perday"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    });
  });
});

describe("userStats", () => {
  it("returns null for unknown users", () => expect(db.userStats("g1", "nobody")).toBeNull());
  it("computes totals, distribution, averages, per-day and rank", () => {
    put("a", 1, 4, 6); put("a", 2, 4, 6); put("a", 3, 1, 50); put("a", 4, null, -3);
    put("b", 1, 1, 50); put("b", 2, 1, 50);
    const s = db.userStats("g1", "a")!;
    expect(s).toMatchObject({ games: 4, wins: 3, totalPoints: 59, pointsPerDay: 14.75, rank: 2 });
    expect(s.avgAttempts).toBeCloseTo(3);
    expect(s.distribution.slice(1)).toEqual([1, 0, 0, 2, 0, 0]);
    expect(db.userStats("g1", "b")!.rank).toBe(1);
  });
  it("tied players share a rank", () => {
    put("a", 1, 4, 6); put("b", 1, 4, 6);
    expect(db.userStats("g1", "a")!.rank).toBe(1);
    expect(db.userStats("g1", "b")!.rank).toBe(1);
  });
  it("tracks current and best streaks; a fail resets", () => {
    put("a", 1, 3, 10); put("a", 2, 3, 10); put("a", 3, 3, 10);
    put("a", 4, null, -3);
    put("a", 5, 3, 10); put("a", 6, 3, 10);
    expect(db.userStats("g1", "a")!).toMatchObject({ bestStreak: 3, currentStreak: 2 });
  });
  it("a missed day breaks the streak", () => {
    put("a", 1, 3, 10); put("a", 2, 3, 10); put("a", 4, 3, 10);
    expect(db.userStats("g1", "a")!).toMatchObject({ bestStreak: 2, currentStreak: 1 });
  });
  it("avgAttempts is null with only fails", () => {
    put("a", 1, null, -3);
    expect(db.userStats("g1", "a")!.avgAttempts).toBeNull();
  });
});

describe("history / puzzleResults / latestPuzzle", () => {
  it("history is newest first and limited", () => {
    for (let p = 1; p <= 5; p++) put("a", p, 4, 6);
    expect(db.history("g1", "a", 3).map((r) => r.puzzle)).toEqual([5, 4, 3]);
  });
  it("puzzleResults orders solves by attempts, fails last", () => {
    put("fail", 7, null, -3); put("six", 7, 6, 2); put("one", 7, 1, 50); put("three", 7, 3, 10);
    expect(ids(db.puzzleResults("g1", 7))).toEqual(["one", "three", "six", "fail"]);
  });
  it("latestPuzzle is the max recorded", () => {
    put("a", 3, 4, 6); put("a", 9, 4, 6); put("a", 5, 4, 6);
    expect(db.latestPuzzle("g1")).toBe(9);
  });
});

describe("linked names", () => {
  it("links, looks up both ways, unlinks", () => {
    db.linkName("g1", "u1", "Just Kyle");
    expect(db.nameFor("g1", "u1")).toBe("Just Kyle");
    expect(db.userIdForName("g1", "Just Kyle")).toBe("u1");
    expect(db.unlinkName("g1", "u1")).toBe(true);
    expect(db.unlinkName("g1", "u1")).toBe(false);
    expect(db.nameFor("g1", "u1")).toBeNull();
  });
  it("lookup is case-insensitive and trims", () => {
    db.linkName("g1", "u1", "  Just Kyle ");
    expect(db.userIdForName("g1", " JUST kyle ")).toBe("u1");
    expect(db.nameFor("g1", "u1")).toBe("Just Kyle");
  });
  it("re-linking replaces the old name", () => {
    db.linkName("g1", "u1", "Old");
    db.linkName("g1", "u1", "New");
    expect(db.userIdForName("g1", "Old")).toBeNull();
    expect(db.userIdForName("g1", "New")).toBe("u1");
  });
  it("refuses a name owned by someone else, case-insensitively", () => {
    db.linkName("g1", "u1", "Kyle");
    expect(() => db.linkName("g1", "u2", "kyle")).toThrow(NameTakenError);
    try { db.linkName("g1", "u2", "KYLE"); } catch (e) { expect((e as NameTakenError).ownerId).toBe("u1"); }
  });
  it("re-linking your own name is fine", () => {
    db.linkName("g1", "u1", "Kyle");
    expect(() => db.linkName("g1", "u1", "kyle")).not.toThrow();
  });
  it("names are scoped per guild", () => {
    db.linkName("g1", "u1", "Kyle");
    db.linkName("g2", "u2", "Kyle");
    expect(db.userIdForName("g2", "Kyle")).toBe("u2");
  });
});
