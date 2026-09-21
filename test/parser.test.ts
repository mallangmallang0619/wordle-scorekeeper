import { describe, expect, it } from "vitest";
import { formatPuzzleDate, isSummaryMessage, parseResults, puzzleNumberFor } from "../src/parser.js";
import { SUMMARY_TEXT } from "./helpers.js";

describe("isSummaryMessage", () => {
  it("accepts the real daily summary", () => expect(isSummaryMessage(SUMMARY_TEXT)).toBe(true));
  it.each([
    "Human Larper was playing",
    "Your group is on a 152 day streak!",
    "Here are yesterday's results:", // hint but no result lines
    "4/6: <@1>", // result line but no hint
    "",
  ])("rejects %j", (text) => expect(isSummaryMessage(text)).toBe(false));
  it("accepts today's results and curly/missing apostrophes", () => {
    expect(isSummaryMessage("Here are today’s results:\n3/6: <@1>")).toBe(true);
    expect(isSummaryMessage("here are yesterdays results\nX/6: <@1>")).toBe(true);
  });
  it("is stateless across repeated calls", () => {
    for (let k = 0; k < 5; k++) expect(isSummaryMessage(SUMMARY_TEXT)).toBe(true);
    expect(parseResults(SUMMARY_TEXT)).toHaveLength(8);
  });
});

describe("parseResults", () => {
  it("parses players in order with attempts", () => {
    expect(parseResults(SUMMARY_TEXT)).toEqual([
      { userId: "100", attempts: 4 }, { userId: "200", attempts: 4 },
      { userId: "300", attempts: 5 }, { userId: "400", attempts: 5 },
      { userId: "500", attempts: 6 }, { userId: "600", attempts: 6 }, { userId: "700", attempts: 6 },
      { userId: "800", attempts: null },
    ]);
  });
  it("handles every score line 1/6 … 6/6 and X/6", () => {
    const text = ["1/6: <@1>", "2/6: <@2>", "3/6: <@3>", "4/6: <@4>", "5/6: <@5>", "6/6: <@6>", "X/6: <@7>"].join("\n");
    expect(parseResults(text).map((r) => r.attempts)).toEqual([1, 2, 3, 4, 5, 6, null]);
  });
  it("ignores crown emoji and bold markup", () => expect(parseResults("👑 **2/6**: <@9>")).toEqual([{ userId: "9", attempts: 2 }]));
  it("tolerates odd spacing and lowercase x", () =>
    expect(parseResults("x/6 :   <@1>   <@2>")).toEqual([{ userId: "1", attempts: null }, { userId: "2", attempts: null }]));
  it("dedupes a user mentioned twice (first wins)", () => expect(parseResults("3/6: <@1> <@1>\n5/6: <@1>")).toEqual([{ userId: "1", attempts: 3 }]));
  it("parses plain @Name text for unmentionable users", () => {
    expect(parseResults("4/6: @the blueprint @Clarenz Betrayals: 18\n5/6: <@3> @ICBT")).toEqual([
      { name: "the blueprint", attempts: 4 },
      { name: "Clarenz Betrayals: 18", attempts: 4 },
      { userId: "3", attempts: 5 },
      { name: "ICBT", attempts: 5 },
    ]);
  });
  it("dedupes plain names case-insensitively", () => expect(parseResults("4/6: @Kyle @kyle")).toEqual([{ name: "Kyle", attempts: 4 }]));
  it("ignores empty lines and stray @", () => expect(parseResults("4/6:\n5/6: @  \n6/6: <@1>")).toEqual([{ userId: "1", attempts: 6 }]));
  it("returns nothing for non-result text", () => {
    expect(parseResults("hello 4/6 world")).toEqual([]);
    expect(parseResults("")).toEqual([]);
  });
  it("does not treat 7/6 or 0/6 as results", () => expect(parseResults("7/6: <@1>\n0/6: <@2>")).toEqual([]));
});

describe("puzzle numbers", () => {
  it("derives yesterday's puzzle from the post timestamp", () => expect(puzzleNumberFor(new Date(Date.UTC(2026, 8, 20, 9, 40)))).toBe(1918));
  it("is stable across the whole UTC day", () => {
    const a = puzzleNumberFor(new Date(Date.UTC(2026, 8, 20, 0, 0, 1)));
    expect(puzzleNumberFor(new Date(Date.UTC(2026, 8, 20, 23, 59, 59)))).toBe(a);
    expect(puzzleNumberFor(new Date(Date.UTC(2026, 8, 21)))).toBe(a + 1);
  });
  it("puzzle #0 is 2021-06-19", () => expect(puzzleNumberFor(new Date(Date.UTC(2021, 5, 20)))).toBe(0));
  it("formats dates in UTC", () => expect(formatPuzzleDate(1918)).toBe("Sep 19"));
});
