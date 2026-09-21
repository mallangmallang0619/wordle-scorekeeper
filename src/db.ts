import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS results (
    guild_id TEXT    NOT NULL,
    puzzle   INTEGER NOT NULL,
    user_id  TEXT    NOT NULL,
    attempts INTEGER,            -- NULL = X/6
    points   INTEGER NOT NULL,
    PRIMARY KEY (guild_id, puzzle, user_id)
);
CREATE TABLE IF NOT EXISTS players (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    name     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (guild_id, user_id),
    UNIQUE (guild_id, name)
);`;

export interface Result {
  puzzle: number;
  user_id: string;
  attempts: number | null;
  points: number;
}

export interface LeaderboardRow {
  user_id: string;
  total_points: number;
  games: number; // days played
  wins: number;
  avg_attempts: number | null;
  points_per_day: number;
}

export type Sort = "points" | "perday" | "attempts";
const ORDER: Record<Sort, string> = {
  points: "total_points DESC, points_per_day DESC, avg_attempts ASC",
  perday: "points_per_day DESC, total_points DESC, avg_attempts ASC",
  attempts: "avg_attempts IS NULL, avg_attempts ASC, total_points DESC", // never-solved last
};

export interface UserStats {
  games: number;
  wins: number;
  totalPoints: number;
  pointsPerDay: number;
  avgAttempts: number | null;
  distribution: number[]; // index 1..6
  currentStreak: number;
  bestStreak: number;
  rank: number;
}

export class NameTakenError extends Error {
  constructor(public readonly ownerId: string) {
    super("name already linked");
  }
}

export class WordleDb {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  upsertResult(guildId: string, r: Result): void {
    this.db
      .prepare(
        `INSERT INTO results (guild_id, puzzle, user_id, attempts, points) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, puzzle, user_id) DO UPDATE SET attempts = excluded.attempts, points = excluded.points`,
      )
      .run(guildId, r.puzzle, r.user_id, r.attempts, r.points);
  }

  leaderboard(guildId: string, limit: number, sort: Sort = "points", minGames = 1): LeaderboardRow[] {
    return this.db
      .prepare(
        `SELECT user_id, SUM(points) AS total_points, COUNT(*) AS games, SUM(attempts IS NOT NULL) AS wins,
                AVG(attempts) AS avg_attempts, SUM(points) * 1.0 / COUNT(*) AS points_per_day
         FROM results WHERE guild_id = ? GROUP BY user_id HAVING games >= ? ORDER BY ${ORDER[sort]} LIMIT ?`,
      )
      .all(guildId, minGames, limit) as LeaderboardRow[];
  }

  userStats(guildId: string, userId: string): UserStats | null {
    const rows = this.db
      .prepare(`SELECT puzzle, attempts, points FROM results WHERE guild_id = ? AND user_id = ? ORDER BY puzzle`)
      .all(guildId, userId) as Result[];
    if (rows.length === 0) return null;

    const wins = rows.filter((r) => r.attempts !== null);
    const distribution = [0, 0, 0, 0, 0, 0, 0];
    for (const r of wins) distribution[r.attempts!]++;

    let cur = 0, best = 0, prev: number | null = null;
    for (const r of rows) {
      cur = r.attempts === null ? 0 : prev !== null && r.puzzle === prev + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
      prev = r.puzzle;
    }

    const totalPoints = rows.reduce((s, r) => s + r.points, 0);
    const { rank } = this.db
      .prepare(
        `SELECT COUNT(*) + 1 AS rank FROM (SELECT SUM(points) AS tp FROM results WHERE guild_id = ? GROUP BY user_id) WHERE tp > ?`,
      )
      .get(guildId, totalPoints) as { rank: number };

    return {
      games: rows.length,
      wins: wins.length,
      totalPoints,
      pointsPerDay: totalPoints / rows.length,
      avgAttempts: wins.length ? wins.reduce((s, r) => s + r.attempts!, 0) / wins.length : null,
      distribution,
      currentStreak: cur,
      bestStreak: best,
      rank,
    };
  }

  history(guildId: string, userId: string, limit: number): Result[] {
    return this.db
      .prepare(`SELECT puzzle, user_id, attempts, points FROM results WHERE guild_id = ? AND user_id = ? ORDER BY puzzle DESC LIMIT ?`)
      .all(guildId, userId, limit) as Result[];
  }

  puzzleResults(guildId: string, puzzle: number): Result[] {
    return this.db
      .prepare(
        `SELECT puzzle, user_id, attempts, points FROM results WHERE guild_id = ? AND puzzle = ?
         ORDER BY attempts IS NULL, attempts, points DESC`,
      )
      .all(guildId, puzzle) as Result[];
  }

  latestPuzzle(guildId: string): number | null {
    return (this.db.prepare(`SELECT MAX(puzzle) AS p FROM results WHERE guild_id = ?`).get(guildId) as { p: number | null }).p;
  }

  // -- linked names ----------------------------------------------------------
  linkName(guildId: string, userId: string, name: string): void {
    name = name.trim();
    const owner = this.userIdForName(guildId, name);
    if (owner && owner !== userId) throw new NameTakenError(owner);
    this.db
      .prepare(
        `INSERT INTO players (guild_id, user_id, name) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET name = excluded.name`,
      )
      .run(guildId, userId, name);
  }

  unlinkName(guildId: string, userId: string): boolean {
    return this.db.prepare(`DELETE FROM players WHERE guild_id = ? AND user_id = ?`).run(guildId, userId).changes > 0;
  }

  nameFor(guildId: string, userId: string): string | null {
    const row = this.db.prepare(`SELECT name FROM players WHERE guild_id = ? AND user_id = ?`).get(guildId, userId) as { name: string } | undefined;
    return row?.name ?? null;
  }

  /** Case-insensitive. */
  userIdForName(guildId: string, name: string): string | null {
    const row = this.db.prepare(`SELECT user_id FROM players WHERE guild_id = ? AND name = ?`).get(guildId, name.trim()) as
      | { user_id: string }
      | undefined;
    return row?.user_id ?? null;
  }
}
