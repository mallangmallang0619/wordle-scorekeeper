/**
 * Parse the Wordle app's daily summary:
 *
 *   Your group is on a 152 day streak! 🔥🔥🔥 Here are yesterday's results:
 *   👑 4/6: <@111> <@222>
 *   5/6: <@333> @Some Name
 *   X/6: <@666>
 *
 * Players are usually `<@id>` mentions; the app may fall back to plain `@Name`
 * text for users it can't mention. Both are parsed.
 */

/** Wordle #0 was published on 2021-06-19 (UTC). */
const EPOCH_MS = Date.UTC(2021, 5, 19);
const DAY_MS = 86_400_000;

const SUMMARY_HINT = /here are (?:yesterday|today)['’]?s results/i;
// Global regexes carry lastIndex state (even through matchAll), so build fresh ones per call.
const resultLine = () => /^[^\n]*?\b([1-6X])\/6\**\s*:\s*(.*)$/gim;
const mention = () => /<@!?(\d+)>/g;
const plainName = () => /@\s*([^@]+?)\s*(?=@|$)/g;

export type PlayerResult = { userId?: string; name?: string; attempts: number | null };

export function isSummaryMessage(text: string): boolean {
  return SUMMARY_HINT.test(text) && resultLine().test(text);
}

/** Players in message order. `attempts` null = X/6. Duplicates keep the first occurrence. */
export function parseResults(text: string): PlayerResult[] {
  const out: PlayerResult[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(resultLine())) {
    const attempts = m[1].toUpperCase() === "X" ? null : Number(m[1]);
    for (const mm of m[2].matchAll(mention())) {
      if (!seen.has(`id:${mm[1]}`)) {
        seen.add(`id:${mm[1]}`);
        out.push({ userId: mm[1], attempts });
      }
    }
    for (const mm of m[2].replace(mention(), " ").matchAll(plainName())) {
      const name = mm[1].trim();
      const key = `name:${name.toLowerCase()}`;
      if (name && !seen.has(key)) {
        seen.add(key);
        out.push({ name, attempts });
      }
    }
  }
  return out;
}

/** The app posts "yesterday's results" the next morning: puzzle = UTC day before the post. */
export function puzzleNumberFor(postedAt: Date): number {
  const day = Date.UTC(postedAt.getUTCFullYear(), postedAt.getUTCMonth(), postedAt.getUTCDate());
  return Math.round((day - EPOCH_MS) / DAY_MS) - 1;
}

export function formatPuzzleDate(puzzle: number): string {
  return new Date(EPOCH_MS + puzzle * DAY_MS).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
