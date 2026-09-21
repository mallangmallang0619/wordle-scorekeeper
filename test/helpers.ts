import { Config, Core, Interaction, Message } from "../src/core.js";
import { WordleDb } from "../src/db.js";

export const WORDLE_APP = { id: "999", bot: true, username: "Wordle" };
export const HUMAN = { id: "42", bot: false, username: "damian" };
export const OTHER_BOT = { id: "555", bot: true, username: "MEE6" };

/** Sep 20 2026 09:40 UTC → "yesterday" is Sep 19 2026 = Wordle #1918 */
export const POSTED_AT = new Date(Date.UTC(2026, 8, 20, 9, 40));
export const PUZZLE = 1918;
export const DAY = 86_400_000;

export const HINT = "Here are yesterday's results:";
export const SUMMARY_TEXT = [
  `**Your group is on a 152 day streak!** 🔥🔥🔥 ${HINT}`,
  "👑 4/6: <@100> <@200>",
  "5/6: <@300> <@!400>",
  "6/6: <@500> <@600> <@700>",
  "X/6: <@800>",
].join("\n");

export const msg = (o: Partial<Message> = {}): Message => ({
  id: "1", content: SUMMARY_TEXT, embeds: [], author: WORDLE_APP, createdAt: POSTED_AT, guildId: "g1", channelId: "c1", ...o,
});

export const makeCore = (config: Partial<Config> = {}) =>
  new Core(new WordleDb(":memory:"), { wordleBotId: null, channels: new Set(), ...config });

type Opts = Partial<Interaction> & { ints?: Record<string, number>; strs?: Record<string, string>; users?: Record<string, string> };
export const interaction = ({ ints = {}, strs = {}, users = {}, ...rest }: Opts = {}): Interaction => ({
  guildId: "g1",
  channelId: "c1",
  userId: "42",
  int: (n) => ints[n] ?? null,
  str: (n) => strs[n] ?? null,
  user: (n) => users[n] ?? null,
  fetch: async () => [],
  ...rest,
});

/** Fetcher over a fixed newest→oldest list, mimicking Discord's `before` paging. */
export function fetcherOver(messages: Message[]) {
  const calls: { limit: number; before?: string }[] = [];
  const fetch = async (limit: number, before?: string) => {
    calls.push({ limit, before });
    const start = before ? messages.findIndex((m) => m.id === before) + 1 : 0;
    return messages.slice(start, start + limit);
  };
  return { fetch, calls };
}
