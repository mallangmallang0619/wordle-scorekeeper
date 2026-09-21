# Wordle scorekeeper bot

Watches the official Wordle app's daily "Here are yesterday's results" post,
scores each player, keeps it in SQLite, and answers slash commands.

## How it works

- Only the daily summary counts: a message from the Wordle app containing
  "Here are yesterday's results" plus `N/6:` lines. "X was playing" posts are ignored.
- Attempts come from the text (`👑 4/6: @a @b`, `X/6: @c`). No image parsing.
- Puzzle number = the UTC day before the post, counted from Wordle #0
  (2021‑06‑19). Re-posts and edits update the same row rather than duplicating.
- Players are `<@id>` mentions. If the app posts a plain `@Name` instead, the
  result goes to whoever ran `/link name:<that name>`; otherwise it's skipped
  and named in the reply.
- On startup the bot re-scans the last `CATCH_UP_LIMIT` messages per channel,
  so days posted while it was offline still get recorded.

## Scoring (`src/scoring.ts`)

| 1/6 | 2/6 | 3/6 | 4/6 | 5/6 | 6/6 | X/6 |
|---|---|---|---|---|---|---|
| 50 | 20 | 10 | 6 | 4 | 2 | −3 |

## Commands

| Command | |
|---|---|
| `/leaderboard [sort] [min_days] [limit]` | Rank by total points (default), points per day, or average guesses |
| `/stats [member]` | Points, rank, days played, points/day, streaks, guess distribution |
| `/history [member] [limit]` | Recent results for one player |
| `/puzzle [number]` | Everyone's result for one day |
| `/scoring` | The table above |
| `/link name:<name>` / `/unlink` | Link the name the Wordle app shows for you |
| `/backfill [limit]` | *(Manage Server)* record past summaries from this channel |

## Run

1. Create a bot at <https://discord.com/developers/applications>, enable the
   **Message Content Intent**, invite it with `bot` + `applications.commands`.
2. ```bash
   npm install
   cp .env.example .env   # add DISCORD_TOKEN
   npm start
   ```
3. `/backfill` once in the Wordle channel.

`.env`: `DISCORD_TOKEN` (required), `WORDLE_BOT_ID`, `WORDLE_CHANNELS`,
`WORDLE_DB`, `ANNOUNCE`, `CATCH_UP_LIMIT` — see `.env.example`.

Always-on hosting: `docker compose up -d --build` on any box. The SQLite file
under `/data` is the only state.

## Code

| | |
|---|---|
| `src/parser.ts` | Detect the summary, parse result lines, puzzle-number math |
| `src/scoring.ts` | Point table |
| `src/db.ts` | SQLite: results, linked names, leaderboard/stats queries |
| `src/core.ts` | Scoring pipeline, history scan, slash-command handlers — no discord.js |
| `src/bot.ts` | discord.js events, command registration, startup catch-up |

`npm test` runs ~100 vitest cases against in-memory SQLite and plain-object messages.
