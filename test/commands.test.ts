import { describe, expect, it } from "vitest";
import { commands, MAX_NAME_LENGTH, SORTS } from "../src/core.js";
import { FAIL_PENALTY, pointsFor } from "../src/scoring.js";
import { DAY, fetcherOver, HINT, interaction, makeCore, msg, POSTED_AT, PUZZLE } from "./helpers.js";

const run = (core: ReturnType<typeof makeCore>, name: string, i = interaction()) => commands[name](core, i);
const seeded = () => {
  const core = makeCore();
  core.score(msg()); // 100,200 → 4/6; 300,400 → 5/6; 500-700 → 6/6; 800 → X
  core.score(msg({ id: "2", createdAt: new Date(POSTED_AT.getTime() + DAY), content: `${HINT}\n1/6: <@100>\n3/6: <@800>` }));
  return core;
};
const P100 = pointsFor(4) + pointsFor(1); // 56
const P800 = FAIL_PENALTY + pointsFor(3); // 7

describe("/leaderboard", () => {
  it("says so when empty", async () => expect(await run(makeCore(), "leaderboard")).toEqual({ content: "No results recorded yet." }));
  it("ranks with medals, linked names, days and per-day", async () => {
    const core = seeded();
    core.db.linkName("g1", "100", "Blue");
    const r = await run(core, "leaderboard");
    const lines = r.embed!.description.split("\n");
    expect(r.embed!.title).toBe("Wordle leaderboard · Total points");
    expect(lines[0]).toBe(`🥇 **Blue** — ${P100} pts (${(P100 / 2).toFixed(2)}/day) · 2 days · 2/2 solved · avg 2.50`);
    expect(lines[1]).toBe(`🥈 **<@800>** — ${P800} pts (${(P800 / 2).toFixed(2)}/day) · 2 days · 1/2 solved · avg 3.00`);
    expect(lines[2]).toMatch(/^🥉 \*\*<@200>\*\*/);
    expect(lines[3]).toMatch(/^4\. /);
    expect(lines).toHaveLength(8);
  });
  it("honours limit", async () => expect((await run(seeded(), "leaderboard", interaction({ ints: { limit: 2 } }))).embed!.description.split("\n")).toHaveLength(2));
  it("sorts by points per day", async () => {
    const r = await run(seeded(), "leaderboard", interaction({ strs: { sort: "perday" } }));
    expect(r.embed!.title).toBe("Wordle leaderboard · Points per day");
    expect(r.embed!.description.split("\n")[0]).toMatch(/^🥇 \*\*<@100>\*\* — 28\.00 pts\/day \(56 pts\) · 2 days/);
  });
  it("sorts by average guesses", async () => {
    const r = await run(seeded(), "leaderboard", interaction({ strs: { sort: "attempts" } }));
    expect(r.embed!.title).toBe("Wordle leaderboard · Average guesses");
    expect(r.embed!.description.split("\n")[0]).toMatch(/^🥇 \*\*<@100>\*\* — avg 2\.50 \(56 pts\)/);
  });
  it("filters by min_days and says so", async () => {
    const r = await run(seeded(), "leaderboard", interaction({ strs: { sort: "perday" }, ints: { min_days: 2 } }));
    expect(r.embed!.title).toBe("Wordle leaderboard · Points per day · 2+ days");
    expect(r.embed!.description.match(/<@\d+>/g)).toEqual(["<@100>", "<@800>"]);
  });
  it("explains an empty filtered board", async () =>
    expect((await run(seeded(), "leaderboard", interaction({ ints: { min_days: 10 } }))).content).toBe("Nobody has played 10+ days yet."));
  it("falls back to total points for an unknown sort", async () =>
    expect((await run(seeded(), "leaderboard", interaction({ strs: { sort: "bogus" } }))).embed!.title).toBe("Wordle leaderboard · Total points"));
  it("exposes every sort as a choice", () => expect(Object.keys(SORTS).sort()).toEqual(["attempts", "perday", "points"]));
});

describe("/stats", () => {
  it("defaults to the caller and reports no results", async () =>
    expect((await run(makeCore(), "stats", interaction({ userId: "42" }))).content).toBe("No results for <@42> yet."));
  it("shows a chosen member's stats", async () => {
    const r = await run(seeded(), "stats", interaction({ users: { member: "800" } }));
    expect(r.embed!.title).toBe("<@800>'s Wordle stats");
    expect(r.embed!.description.split("\n")).toEqual([
      `**Points:** ${P800} (rank #2) · **Per day:** ${(P800 / 2).toFixed(2)}`,
      "**Days played:** 2 (1 won, 1 failed)",
      "**Avg guesses:** 3.00 · **Streak:** 1 (best 1)",
      "",
      "`1/6`  0", "`2/6`  0", "`3/6` █ 1", "`4/6`  0", "`5/6`  0", "`6/6`  0",
    ]);
  });
});

describe("/history", () => {
  it("lists newest first with dates and points", async () => {
    const r = await run(seeded(), "history", interaction({ users: { member: "100" } }));
    expect(r.embed!.title).toBe("<@100> — last 2 results");
    expect(r.embed!.description.split("\n")).toEqual([
      `#${PUZZLE + 1} (Sep 20) 1/6 → +${pointsFor(1)}`,
      `#${PUZZLE} (Sep 19) 4/6 → +${pointsFor(4)}`,
    ]);
  });
  it("respects limit and handles empty", async () => {
    expect((await run(seeded(), "history", interaction({ users: { member: "100" }, ints: { limit: 1 } }))).embed!.description.split("\n")).toHaveLength(1);
    expect((await run(seeded(), "history", interaction({ userId: "nobody" }))).content).toMatch(/No results/);
  });
});

describe("/puzzle", () => {
  it("defaults to the latest puzzle", async () => {
    const r = await run(seeded(), "puzzle");
    expect(r.embed!.title).toBe(`Wordle #${PUZZLE + 1} · Sep 20`);
    expect(r.embed!.description).toBe(`1/6 **<@100>** → +${pointsFor(1)}\n3/6 **<@800>** → +${pointsFor(3)}`);
  });
  it("shows a specific puzzle with fails last", async () => {
    const lines = (await run(seeded(), "puzzle", interaction({ ints: { number: PUZZLE } }))).embed!.description.split("\n");
    expect(lines[0]).toMatch(/^4\/6/);
    expect(lines.at(-1)).toBe(`X/6 **<@800>** → ${FAIL_PENALTY}`);
  });
  it("handles unknown puzzles and empty db", async () => {
    expect((await run(seeded(), "puzzle", interaction({ ints: { number: 1 } }))).content).toBe("Nothing recorded for Wordle #1.");
    expect((await run(makeCore(), "puzzle")).content).toBe("No results recorded yet.");
  });
});

describe("/scoring", () => {
  it("prints the whole table", async () => {
    const r = await run(makeCore(), "scoring");
    for (let n = 1; n <= 6; n++) expect(r.content).toContain(`\`${n}/6\` → ${pointsFor(n)} pts`);
    expect(r.content).toContain(`\`X/6\` → ${FAIL_PENALTY} pts`);
  });
});

describe("/link and /unlink", () => {
  it("links a name to the caller (ephemeral), stripping a leading @", async () => {
    const core = makeCore();
    const r = await run(core, "link", interaction({ userId: "42", strs: { name: "@Just Kyle" } }));
    expect(r).toEqual({ content: "Linked **Just Kyle** to your account.", ephemeral: true });
    expect(core.db.userIdForName("g1", "just kyle")).toBe("42");
  });
  it("rejects empty, too long, and markup-y names", async () => {
    const core = makeCore();
    expect((await run(core, "link", interaction({ strs: { name: "  " } }))).content).toMatch(/Give a name/);
    expect((await run(core, "link")).content).toMatch(/Give a name/);
    expect((await run(core, "link", interaction({ strs: { name: "x".repeat(MAX_NAME_LENGTH + 1) } }))).content).toMatch(/or fewer/);
    expect((await run(core, "link", interaction({ strs: { name: "<@123>" } }))).content).toMatch(/can't contain/);
    expect(core.db.nameFor("g1", "42")).toBeNull();
  });
  it("refuses a name someone else owns and names the owner", async () => {
    const core = makeCore();
    await run(core, "link", interaction({ userId: "1", strs: { name: "Kyle" } }));
    const r = await run(core, "link", interaction({ userId: "2", strs: { name: "kyle" } }));
    expect(r.content).toBe("**kyle** is already linked to <@1>.");
    expect(core.db.nameFor("g1", "2")).toBeNull();
  });
  it("re-linking changes your name", async () => {
    const core = makeCore();
    await run(core, "link", interaction({ strs: { name: "One" } }));
    await run(core, "link", interaction({ strs: { name: "Two" } }));
    expect(core.db.nameFor("g1", "42")).toBe("Two");
    expect(core.db.userIdForName("g1", "One")).toBeNull();
  });
  it("unlinks and reports when nothing to unlink", async () => {
    const core = makeCore();
    expect((await run(core, "unlink")).content).toBe("You don't have a linked name.");
    await run(core, "link", interaction({ strs: { name: "Me" } }));
    expect((await run(core, "unlink")).content).toBe("Unlinked your name.");
    expect(core.db.nameFor("g1", "42")).toBeNull();
  });
  it("linked names show in stats and credit text-name results", async () => {
    const core = makeCore();
    await run(core, "link", interaction({ userId: "42", strs: { name: "Damian" } }));
    core.score(msg({ content: `${HINT}\n2/6: @Damian` }));
    const r = await run(core, "stats", interaction({ userId: "42" }));
    expect(r.embed!.title).toBe("Damian's Wordle stats");
    expect(r.embed!.description).toContain(`**Points:** ${pointsFor(2)} (rank #1)`);
  });
});

describe("/watch and /unwatch", () => {
  it("pins the current channel for the server", async () => {
    const core = makeCore();
    const r = await run(core, "watch", interaction({ channelId: "c7" }));
    expect(r.content).toBe("Watching <#c7> for Wordle summaries. Other channels are ignored.");
    expect(core.db.channelFor("g1")).toBe("c7");
    expect(core.handle(msg({ channelId: "c7" }))).not.toBeNull();
    expect(core.handle(msg({ channelId: "c1" }))).toBeNull();
  });
  it("unwatch clears it and reports either way", async () => {
    const core = makeCore();
    expect((await run(core, "unwatch")).content).toBe("No channel was pinned.");
    await run(core, "watch", interaction({ channelId: "c7" }));
    expect((await run(core, "unwatch")).content).toBe("No longer pinned to <#c7>; back to the default channel filter.");
    expect(core.db.channelFor("g1")).toBeNull();
  });
});

describe("/backfill", () => {
  it("scans the channel via the interaction's fetcher", async () => {
    const core = makeCore();
    const history = [msg({ id: "3" }), msg({ id: "2", content: "Kyle was playing" }), msg({ id: "1", createdAt: new Date(POSTED_AT.getTime() - DAY) })];
    const r = await run(core, "backfill", interaction({ fetch: fetcherOver(history).fetch, ints: { limit: 50 } }));
    expect(r).toEqual({ content: "Backfill done: recorded 2 daily summaries.", ephemeral: true });
    expect(core.db.history("g1", "100", 10).map((x) => x.puzzle)).toEqual([PUZZLE, PUZZLE - 1]);
  });
});
