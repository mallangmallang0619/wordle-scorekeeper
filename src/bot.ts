/** discord.js wiring around core.ts. */
import "dotenv/config";
import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { ADMIN_COMMANDS, commands, Core, Fetcher, Reply, SLOW_COMMANDS, SORTS } from "./core.js";
import { WordleDb } from "./db.js";

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error("DISCORD_TOKEN is not set");
const ANNOUNCE = (process.env.ANNOUNCE ?? "1") === "1";
const CATCH_UP_LIMIT = Number(process.env.CATCH_UP_LIMIT ?? "300");

const core = new Core(new WordleDb(process.env.WORDLE_DB ?? "wordle.sqlite3"), {
  wordleBotId: process.env.WORDLE_BOT_ID || null,
  channels: new Set((process.env.WORDLE_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
});
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const fetcher = (ch: TextChannel): Fetcher => async (limit, before) => [...(await ch.messages.fetch({ limit, before })).values()];

async function onMessage(m: Message, announce: boolean) {
  const scored = core.handle(m);
  if (scored && announce && m.channel.isSendable()) {
    await m.channel.send({ content: core.announcement(scored, m.guildId!), allowedMentions: { parse: [] } });
  }
}

client.on(Events.MessageCreate, (m) => void onMessage(m, ANNOUNCE).catch(console.error));
client.on(Events.MessageUpdate, (_, m) => void (!m.partial && onMessage(m, false).catch(console.error)));

/** Re-scan recent history on boot so summaries posted while offline are still recorded. */
async function catchUp() {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildText) continue;
      if (!core.watches(guild.id, ch.id)) continue;
      if (!ch.permissionsFor(guild.members.me!)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
      total += await core.scan(fetcher(ch), CATCH_UP_LIMIT).catch((e) => (console.error(`catch-up #${ch.name}`, e), 0));
    }
  }
  console.log(`catch-up recorded ${total} summaries`);
}

const defs = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the leaderboard")
    .addStringOption((o) => o.setName("sort").setDescription("Rank by").addChoices(...Object.entries(SORTS).map(([value, name]) => ({ name, value }))))
    .addIntegerOption((o) => o.setName("min_days").setDescription("Only players with at least this many days").setMinValue(1))
    .addIntegerOption((o) => o.setName("limit").setDescription("Players to show (default 10)").setMinValue(1).setMaxValue(25)),
  new SlashCommandBuilder().setName("stats").setDescription("Show a player's stats").addUserOption((o) => o.setName("member").setDescription("Defaults to you")),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show a player's recent results")
    .addUserOption((o) => o.setName("member").setDescription("Defaults to you"))
    .addIntegerOption((o) => o.setName("limit").setDescription("Days to show (default 10)").setMinValue(1).setMaxValue(30)),
  new SlashCommandBuilder().setName("puzzle").setDescription("Everyone's result for one puzzle").addIntegerOption((o) => o.setName("number").setDescription("Wordle number (default: latest)")),
  new SlashCommandBuilder().setName("scoring").setDescription("How points are awarded"),
  new SlashCommandBuilder().setName("link").setDescription("Link the name the Wordle app shows for you").addStringOption((o) => o.setName("name").setDescription("Your name in the results").setRequired(true)),
  new SlashCommandBuilder().setName("unlink").setDescription("Remove your linked name"),
  new SlashCommandBuilder().setName("watch").setDescription("(Admin) Only score Wordle posts in this channel"),
  new SlashCommandBuilder().setName("unwatch").setDescription("(Admin) Stop pinning to one channel"),
  new SlashCommandBuilder()
    .setName("backfill")
    .setDescription("(Admin) Scan this channel's history for past summaries")
    .addIntegerOption((o) => o.setName("limit").setDescription("Messages to look back (default 500)").setMinValue(1).setMaxValue(5000)),
].map((c) => (ADMIN_COMMANDS.has(c.name) ? c.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) : c).toJSON());

function payload(r: Reply) {
  const embeds = r.embed ? [new EmbedBuilder().setTitle(r.embed.title).setDescription(r.embed.description).setColor(0x538d4e)] : [];
  return { content: r.content, embeds, ephemeral: r.ephemeral ?? false, allowedMentions: { parse: [] as never[] } };
}

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || !i.inGuild()) return;
  const handler = commands[i.commandName];
  if (!handler) return;
  const slow = SLOW_COMMANDS.has(i.commandName);
  try {
    if (slow) await i.deferReply({ ephemeral: true });
    const reply = await handler(core, {
      guildId: i.guildId,
      channelId: i.channelId,
      userId: i.user.id,
      int: (n) => i.options.getInteger(n),
      str: (n) => i.options.getString(n),
      user: (n) => i.options.getUser(n)?.id ?? null,
      fetch: i.channel?.type === ChannelType.GuildText ? fetcher(i.channel) : async () => [],
    });
    await (slow ? i.editReply(payload(reply)) : i.reply(payload(reply)));
  } catch (e) {
    console.error(`/${i.commandName} failed`, e);
    const msg = { content: "Something went wrong.", ephemeral: true };
    await (i.deferred || i.replied ? i.editReply(msg) : i.reply(msg)).catch(() => {});
  }
});

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set(defs);
  console.log(`logged in as ${c.user.tag}`);
  if (CATCH_UP_LIMIT > 0) await catchUp();
});

client.login(TOKEN);
