/** Bot logic with no discord.js dependency, so it can be tested with plain objects. */
import { NameTakenError, Sort, WordleDb } from "./db.js";
import { formatPuzzleDate, isSummaryMessage, parseResults, puzzleNumberFor } from "./parser.js";
import { FAIL_PENALTY, POINTS, pointsFor } from "./scoring.js";

export interface Message {
  id: string;
  content: string;
  embeds: { title?: string | null; description?: string | null }[];
  author: { id: string; bot: boolean; username: string };
  createdAt: Date;
  guildId: string | null;
  channelId: string;
}

export interface Config {
  wordleBotId: string | null; // null = accept any bot named "Wordle"
  channels: Set<string>; // env-level default; empty = all
}

/** Returns up to `limit` messages older than `before`, newest first. */
export type Fetcher = (limit: number, before?: string) => Promise<Message[]>;

export interface Scored {
  puzzle: number;
  results: { userId: string; attempts: number | null; points: number }[];
  unlinked: string[]; // plain-text names nobody has linked; not recorded
}

export function fromWordleApp(m: Message, config: Config): boolean {
  if (!m.author.bot) return false;
  return config.wordleBotId ? m.author.id === config.wordleBotId : m.author.username.trim().toLowerCase() === "wordle";
}

export class Core {
  constructor(public readonly db: WordleDb, public readonly config: Config) {}

  /** Score a message if it is a daily summary in a guild; null otherwise. Caller checks the author. */
  score(m: Message): Scored | null {
    if (!m.guildId) return null;
    const text = [m.content, ...m.embeds.flatMap((e) => [e.title, e.description])].filter(Boolean).join("\n");
    if (!isSummaryMessage(text)) return null;
    const parsed = parseResults(text);
    if (parsed.length === 0) return null;

    const puzzle = puzzleNumberFor(m.createdAt);
    const out: Scored = { puzzle, results: [], unlinked: [] };
    for (const p of parsed) {
      const userId = p.userId ?? this.db.userIdForName(m.guildId, p.name!);
      if (!userId) {
        out.unlinked.push(p.name!);
        continue;
      }
      const points = pointsFor(p.attempts);
      this.db.upsertResult(m.guildId, { puzzle, user_id: userId, attempts: p.attempts, points });
      out.results.push({ userId, attempts: p.attempts, points });
    }
    return out;
  }

  /** Is this channel one we should score? `/watch` (per server) wins over WORDLE_CHANNELS, which wins over "all". */
  watches(guildId: string, channelId: string): boolean {
    const chosen = this.db.channelFor(guildId);
    if (chosen) return chosen === channelId;
    return this.config.channels.size === 0 || this.config.channels.has(channelId);
  }

  /** Live-message gate: right author and channel. */
  handle(m: Message): Scored | null {
    if (!fromWordleApp(m, this.config) || !m.guildId || !this.watches(m.guildId, m.channelId)) return null;
    return this.score(m);
  }

  announcement(s: Scored, guildId: string): string {
    const lines = [`**Wordle #${s.puzzle} scored** (${formatPuzzleDate(s.puzzle)})`];
    for (const r of s.results) lines.push(`${this.name(guildId, r.userId)} ${attempts(r.attempts)} → **${pts(r.points)}**`);
    if (s.unlinked.length) lines.push(`_Not recorded (use \`/link\`): ${s.unlinked.join(", ")}_`);
    return lines.join("\n");
  }

  /** Walk history newest→oldest scoring Wordle summaries; returns how many were recorded. */
  async scan(fetch: Fetcher, limit: number): Promise<number> {
    let found = 0, before: string | undefined;
    for (let remaining = limit; remaining > 0; ) {
      const batch = await fetch(Math.min(100, remaining), before);
      if (batch.length === 0) break;
      for (const m of batch) if (fromWordleApp(m, this.config) && this.score(m)) found++;
      remaining -= batch.length;
      before = batch[batch.length - 1].id;
    }
    return found;
  }

  /** Linked name, else a mention (Discord renders `<@id>` as the member's name). */
  name(guildId: string, userId: string): string {
    return this.db.nameFor(guildId, userId) ?? `<@${userId}>`;
  }
}

const attempts = (a: number | null) => (a === null ? "X/6" : `${a}/6`);
const pts = (p: number) => (p >= 0 ? `+${p}` : `${p}`);

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
export interface Interaction {
  guildId: string;
  channelId: string;
  userId: string;
  int(name: string): number | null;
  str(name: string): string | null;
  user(name: string): string | null; // user id
  channel(name: string): string | null; // channel id
  /** History fetcher for a channel id (null if it isn't a readable text channel). */
  fetcherFor(channelId: string): Fetcher | null;
}

export interface Reply {
  content?: string;
  embed?: { title: string; description: string };
  ephemeral?: boolean;
}

export const SORTS: Record<Sort, string> = { points: "Total points", perday: "Points per day", attempts: "Average guesses" };
export const MAX_NAME_LENGTH = 32;
export const SLOW_COMMANDS = new Set(["backfill"]);
export const ADMIN_COMMANDS = new Set(["backfill", "watch", "unwatch"]);

type Handler = (core: Core, i: Interaction) => Promise<Reply>;

export const commands: Record<string, Handler> = {
  async leaderboard(core, i) {
    const sortOpt = i.str("sort");
    const sort: Sort = sortOpt && sortOpt in SORTS ? (sortOpt as Sort) : "points";
    const minDays = Math.max(1, i.int("min_days") ?? 1);
    const rows = core.db.leaderboard(i.guildId, i.int("limit") ?? 10, sort, minDays);
    if (rows.length === 0) return { content: minDays > 1 ? `Nobody has played ${minDays}+ days yet.` : "No results recorded yet." };
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, k) => {
      const avg = r.avg_attempts === null ? "—" : r.avg_attempts.toFixed(2);
      const lead =
        sort === "perday" ? `${r.points_per_day.toFixed(2)} pts/day (${r.total_points} pts)`
        : sort === "attempts" ? `avg ${avg} (${r.total_points} pts)`
        : `${r.total_points} pts (${r.points_per_day.toFixed(2)}/day)`;
      return `${medals[k] ?? `${k + 1}.`} **${core.name(i.guildId, r.user_id)}** — ${lead} · ${r.games} days · ${r.wins}/${r.games} solved · avg ${avg}`;
    });
    const title = `Wordle leaderboard · ${SORTS[sort]}${minDays > 1 ? ` · ${minDays}+ days` : ""}`;
    return { embed: { title, description: lines.join("\n") } };
  },

  async stats(core, i) {
    const userId = i.user("member") ?? i.userId;
    const name = core.name(i.guildId, userId);
    const s = core.db.userStats(i.guildId, userId);
    if (!s) return { content: `No results for ${name} yet.` };
    const dist = [1, 2, 3, 4, 5, 6].map((n) => `\`${n}/6\` ${"█".repeat(s.distribution[n])} ${s.distribution[n]}`);
    const description = [
      `**Points:** ${s.totalPoints} (rank #${s.rank}) · **Per day:** ${s.pointsPerDay.toFixed(2)}`,
      `**Days played:** ${s.games} (${s.wins} won, ${s.games - s.wins} failed)`,
      `**Avg guesses:** ${s.avgAttempts === null ? "—" : s.avgAttempts.toFixed(2)} · **Streak:** ${s.currentStreak} (best ${s.bestStreak})`,
      "",
      ...dist,
    ].join("\n");
    return { embed: { title: `${name}'s Wordle stats`, description } };
  },

  async history(core, i) {
    const userId = i.user("member") ?? i.userId;
    const name = core.name(i.guildId, userId);
    const rows = core.db.history(i.guildId, userId, i.int("limit") ?? 10);
    if (rows.length === 0) return { content: `No results for ${name} yet.` };
    const lines = rows.map((r) => `#${r.puzzle} (${formatPuzzleDate(r.puzzle)}) ${attempts(r.attempts)} → ${pts(r.points)}`);
    return { embed: { title: `${name} — last ${rows.length} results`, description: lines.join("\n") } };
  },

  async puzzle(core, i) {
    const n = i.int("number") ?? core.db.latestPuzzle(i.guildId);
    if (n === null) return { content: "No results recorded yet." };
    const rows = core.db.puzzleResults(i.guildId, n);
    if (rows.length === 0) return { content: `Nothing recorded for Wordle #${n}.` };
    const lines = rows.map((r) => `${attempts(r.attempts)} **${core.name(i.guildId, r.user_id)}** → ${pts(r.points)}`);
    return { embed: { title: `Wordle #${n} · ${formatPuzzleDate(n)}`, description: lines.join("\n") } };
  },

  async scoring() {
    const lines = Object.entries(POINTS).map(([n, p]) => `\`${n}/6\` → ${p} pts`);
    return { content: [...lines, `\`X/6\` → ${FAIL_PENALTY} pts`].join("\n") };
  },

  async link(core, i) {
    const name = (i.str("name") ?? "").replace(/^@/, "").trim();
    if (!name) return { content: "Give a name, e.g. `/link name:Just Kyle`.", ephemeral: true };
    if (name.length > MAX_NAME_LENGTH) return { content: `Names must be ${MAX_NAME_LENGTH} characters or fewer.`, ephemeral: true };
    if (/[<>@`]/.test(name)) return { content: "Names can't contain `<`, `>`, `@` or backticks.", ephemeral: true };
    try {
      core.db.linkName(i.guildId, i.userId, name);
    } catch (e) {
      if (e instanceof NameTakenError) return { content: `**${name}** is already linked to <@${e.ownerId}>.`, ephemeral: true };
      throw e;
    }
    return { content: `Linked **${name}** to your account.`, ephemeral: true };
  },

  async unlink(core, i) {
    return { content: core.db.unlinkName(i.guildId, i.userId) ? "Unlinked your name." : "You don't have a linked name.", ephemeral: true };
  },

  async watch(core, i) {
    const channelId = i.channel("channel") ?? i.channelId;
    if (!i.fetcherFor(channelId)) return { content: `<#${channelId}> isn't a text channel I can read.`, ephemeral: true };
    core.db.setChannel(i.guildId, channelId);
    return { content: `Watching <#${channelId}> for Wordle summaries. Other channels are ignored.` };
  },

  async unwatch(core, i) {
    const had = core.db.channelFor(i.guildId);
    core.db.setChannel(i.guildId, null);
    return { content: had ? `No longer pinned to <#${had}>; back to the default channel filter.` : "No channel was pinned." };
  },

  async backfill(core, i) {
    const channelId = i.channel("channel") ?? core.db.channelFor(i.guildId) ?? i.channelId;
    const fetch = i.fetcherFor(channelId);
    if (!fetch) return { content: `<#${channelId}> isn't a text channel I can read.`, ephemeral: true };
    const found = await core.scan(fetch, i.int("limit") ?? 500);
    return { content: `Backfill of <#${channelId}> done: recorded ${found} daily summaries.`, ephemeral: true };
  },
};
