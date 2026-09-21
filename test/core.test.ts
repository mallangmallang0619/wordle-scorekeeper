import { describe, expect, it } from "vitest";
import { fromWordleApp } from "../src/core.js";
import { FAIL_PENALTY, pointsFor } from "../src/scoring.js";
import { DAY, fetcherOver, HINT, HUMAN, makeCore, msg, OTHER_BOT, POSTED_AT, PUZZLE, SUMMARY_TEXT, WORDLE_APP } from "./helpers.js";

const cfg = (o = {}) => ({ wordleBotId: null, channels: new Set<string>(), ...o });
const day = (n: number) => new Date(POSTED_AT.getTime() + n * DAY);

describe("fromWordleApp", () => {
  it("accepts a bot named Wordle when no id is pinned", () => {
    expect(fromWordleApp(msg(), cfg())).toBe(true);
    expect(fromWordleApp(msg({ author: { ...WORDLE_APP, username: " wordle " } }), cfg())).toBe(true);
  });
  it("rejects humans named Wordle and other bots", () => {
    expect(fromWordleApp(msg({ author: { ...HUMAN, username: "Wordle" } }), cfg())).toBe(false);
    expect(fromWordleApp(msg({ author: OTHER_BOT }), cfg())).toBe(false);
  });
  it("pinned id wins over the name", () => {
    expect(fromWordleApp(msg(), cfg({ wordleBotId: "999" }))).toBe(true);
    expect(fromWordleApp(msg(), cfg({ wordleBotId: "1" }))).toBe(false);
    expect(fromWordleApp(msg({ author: { id: "1", bot: true, username: "Impostor" } }), cfg({ wordleBotId: "1" }))).toBe(true);
  });
});

describe("Core.score", () => {
  it("records every player with the right puzzle and points", () => {
    const core = makeCore();
    const out = core.score(msg())!;
    expect(out.puzzle).toBe(PUZZLE);
    expect(out.unlinked).toEqual([]);
    expect(out.results).toEqual([
      { userId: "100", attempts: 4, points: pointsFor(4) }, { userId: "200", attempts: 4, points: pointsFor(4) },
      { userId: "300", attempts: 5, points: pointsFor(5) }, { userId: "400", attempts: 5, points: pointsFor(5) },
      { userId: "500", attempts: 6, points: pointsFor(6) }, { userId: "600", attempts: 6, points: pointsFor(6) }, { userId: "700", attempts: 6, points: pointsFor(6) },
      { userId: "800", attempts: null, points: FAIL_PENALTY },
    ]);
    expect(core.db.puzzleResults("g1", PUZZLE)).toHaveLength(8);
  });
  it("returns null for non-summaries, DMs, and empty embeds", () => {
    const core = makeCore();
    expect(core.score(msg({ content: "Human Larper was playing" }))).toBeNull();
    expect(core.score(msg({ content: "" }))).toBeNull();
    expect(core.score(msg({ guildId: null }))).toBeNull();
    expect(core.score(msg({ content: "", embeds: [{ title: null, description: undefined }] }))).toBeNull();
    expect(core.db.latestPuzzle("g1")).toBeNull();
  });
  it("reads the summary from an embed", () => {
    expect(makeCore().score(msg({ content: "", embeds: [{ description: SUMMARY_TEXT }] }))!.results).toHaveLength(8);
  });
  it("is idempotent across reposts and applies edits", () => {
    const core = makeCore();
    core.score(msg());
    core.score(msg({ id: "2" }));
    expect(core.db.puzzleResults("g1", PUZZLE)).toHaveLength(8);
    core.score(msg({ content: SUMMARY_TEXT.replace("👑 4/6: <@100> <@200>", "👑 1/6: <@100>\n4/6: <@200>") }));
    expect(core.db.history("g1", "100", 5)).toEqual([{ puzzle: PUZZLE, user_id: "100", attempts: 1, points: pointsFor(1) }]);
  });
  it("maps consecutive days to consecutive puzzles", () => {
    const core = makeCore();
    core.score(msg({ id: "1", createdAt: day(0) }));
    core.score(msg({ id: "2", createdAt: day(1) }));
    expect(core.db.history("g1", "100", 5).map((r) => r.puzzle)).toEqual([PUZZLE + 1, PUZZLE]);
    expect(core.db.userStats("g1", "100")!.currentStreak).toBe(2);
  });
  it("credits plain @Name results to linked accounts and reports the rest", () => {
    const core = makeCore();
    core.db.linkName("g1", "77", "the blueprint");
    const out = core.score(msg({ content: `${HINT}\n3/6: @the blueprint @Unknown Guy\nX/6: <@5>` }))!;
    expect(out.results).toEqual([{ userId: "77", attempts: 3, points: pointsFor(3) }, { userId: "5", attempts: null, points: FAIL_PENALTY }]);
    expect(out.unlinked).toEqual(["Unknown Guy"]);
  });
  it("linking after the fact and re-scanning picks the name up", () => {
    const core = makeCore();
    const m = msg({ content: `${HINT}\n2/6: @Late Linker` });
    expect(core.score(m)!.unlinked).toEqual(["Late Linker"]);
    core.db.linkName("g1", "9", "late linker");
    expect(core.score(m)!.results).toEqual([{ userId: "9", attempts: 2, points: pointsFor(2) }]);
  });
});

describe("Core.handle", () => {
  it("scores only Wordle-app messages in watched channels", () => {
    const core = makeCore({ channels: new Set(["c1"]) });
    expect(core.handle(msg({ author: HUMAN }))).toBeNull();
    expect(core.handle(msg({ channelId: "c2" }))).toBeNull();
    expect(core.handle(msg())).not.toBeNull();
  });
  it("watches all channels when none configured", () => expect(makeCore().handle(msg({ channelId: "anything" }))).not.toBeNull());
});

describe("Core.announcement", () => {
  it("lists players with points, linked names, and unlinked names", () => {
    const core = makeCore();
    core.db.linkName("g1", "100", "Blue");
    const text = core.announcement(core.score(msg({ content: `${HINT}\n1/6: <@100>\nX/6: <@800> @Ghost` }))!, "g1");
    expect(text.split("\n")).toEqual([
      `**Wordle #${PUZZLE} scored** (Sep 19)`,
      `Blue 1/6 → **+${pointsFor(1)}**`,
      `<@800> X/6 → **${FAIL_PENALTY}**`,
      "_Not recorded (use `/link`): Ghost_",
    ]);
  });
  it("omits the unlinked line when everyone resolved", () => {
    const core = makeCore();
    expect(core.announcement(core.score(msg())!, "g1")).not.toContain("Not recorded");
  });
});

describe("Core.scan (backfill / startup catch-up)", () => {
  it("pages newest→oldest and scores only Wordle summaries", async () => {
    const core = makeCore();
    const history = [
      msg({ id: "10", createdAt: day(2) }),
      msg({ id: "9", author: HUMAN, content: "gg", createdAt: day(2) }),
      msg({ id: "8", content: "Kyle was playing", createdAt: day(1) }),
      msg({ id: "7", createdAt: day(1) }),
      msg({ id: "6", author: OTHER_BOT, createdAt: day(1) }),
      msg({ id: "5", author: { ...HUMAN, username: "Wordle" }, createdAt: day(1) }),
      msg({ id: "4", createdAt: day(0) }),
    ];
    const { fetch, calls } = fetcherOver(history);
    expect(await core.scan(fetch, 1000)).toBe(3);
    expect(core.db.history("g1", "100", 10).map((r) => r.puzzle)).toEqual([PUZZLE + 2, PUZZLE + 1, PUZZLE]);
    expect(calls[0]).toEqual({ limit: 100, before: undefined });
  });
  it("requests pages of at most 100 with a cursor and stops at the limit", async () => {
    const history = Array.from({ length: 250 }, (_, k) => msg({ id: String(1000 - k), author: HUMAN, content: "chat" }));
    const { fetch, calls } = fetcherOver(history);
    await makeCore().scan(fetch, 150);
    expect(calls).toEqual([{ limit: 100, before: undefined }, { limit: 50, before: "901" }]);
  });
  it("stops when the channel runs out", async () => {
    const { fetch, calls } = fetcherOver([msg({ id: "1" })]);
    expect(await makeCore().scan(fetch, 5000)).toBe(1);
    expect(calls).toHaveLength(2);
  });
  it("is safe to run repeatedly", async () => {
    const core = makeCore();
    const history = [msg({ id: "2", createdAt: day(1) }), msg({ id: "1", createdAt: day(0) })];
    await core.scan(fetcherOver(history).fetch, 300);
    await core.scan(fetcherOver(history).fetch, 300);
    expect(core.db.userStats("g1", "100")!.games).toBe(2);
  });
  it("does nothing with a zero limit", async () => {
    const { fetch, calls } = fetcherOver([msg()]);
    expect(await makeCore().scan(fetch, 0)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("Core.name", () => {
  it("prefers the linked name, else a mention", () => {
    const core = makeCore();
    expect(core.name("g1", "1")).toBe("<@1>");
    core.db.linkName("g1", "1", "Linked");
    expect(core.name("g1", "1")).toBe("Linked");
  });
});
