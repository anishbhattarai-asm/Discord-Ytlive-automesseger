import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader so local dev works without a dependency.
 * On Render, or any host, real environment variables win and this only fills gaps.
 */
function loadDotEnv(file = ".env") {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const rawLine of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const bool = (v, fallback = false) => {
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

const int = (v, fallback) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

// `.env` files can't hold real newlines, so allow the two-character "\n" escape.
const unescape = (v) => (v ?? "").replace(/\\n/g, "\n").replace(/\\t/g, "\t");

export const config = {
  port: int(process.env.PORT, 3000),

  discordWebhookUrl: (process.env.DISCORD_WEBHOOK_URL || "").trim(),

  channelId: (process.env.YT_CHANNEL_ID || "").trim(),
  channelHandle: (process.env.YT_CHANNEL_HANDLE || "").trim(),
  apiKey: (process.env.YT_API_KEY || "").trim(),

  cronSecret: (process.env.CRON_SECRET || "").trim(),

  messageTemplate: unescape(
    process.env.MESSAGE_TEMPLATE || "{channel} is live now!\n{title}\n{url}",
  ),
  mention: unescape(process.env.MENTION || "").trim(),
  useEmbed: bool(process.env.USE_EMBED, true),
  showDescription: bool(process.env.SHOW_DESCRIPTION, true),
  // Discord rejects anything outside a 24 bit colour, so clamp rather than
  // let a stray value fail every announcement.
  embedColor: Math.min(Math.max(int(process.env.EMBED_COLOR, 0xff0000), 0), 0xffffff),
  webhookUsername: (process.env.WEBHOOK_USERNAME || "").trim(),
  webhookAvatarUrl: (process.env.WEBHOOK_AVATAR_URL || "").trim(),

  // Render sets RENDER_EXTERNAL_URL by itself, so self pinging needs no setup.
  selfUrl: (process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || "").trim(),
  // Must stay below the host's idle timeout, which is 15 minutes on Render.
  keepAliveSeconds: int(process.env.KEEPALIVE_SECONDS, 600),

  pollIntervalSeconds: int(process.env.POLL_INTERVAL_SECONDS, 300),
  announceOnFirstRun: bool(process.env.ANNOUNCE_ON_FIRST_RUN, false),
  stateFile: path.resolve(
    process.cwd(),
    process.env.STATE_FILE || "./data/state.json",
  ),
};

/**
 * The example file has to contain something on each line, and those examples
 * are shaped like real values, so they pass a format check. Left in place they
 * would start the service, look healthy, and never announce anything. Catch
 * them by name instead.
 */
const PLACEHOLDERS = new Set([
  "https://discord.com/api/webhooks/000000000/xxxxxxxx",
  "ucxxxxxxxxxxxxxxxxxxxxxx",
  "@yourhandle",
  "yourhandle",
  "change-me-to-something-random",
  "your-api-key",
]);

const isPlaceholder = (value) => PLACEHOLDERS.has(String(value).trim().toLowerCase());

/** Returns a list of readable problems, empty when the config is usable. */
export function validateConfig(cfg = config) {
  const problems = [];

  if (!cfg.discordWebhookUrl) {
    problems.push("DISCORD_WEBHOOK_URL is not set.");
  } else if (isPlaceholder(cfg.discordWebhookUrl)) {
    problems.push(
      "DISCORD_WEBHOOK_URL is still the example value from .env.example. Replace it with the " +
        "webhook URL copied from your own Discord channel.",
    );
  } else if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(cfg.discordWebhookUrl)) {
    problems.push(
      "DISCORD_WEBHOOK_URL does not look like a Discord webhook URL. It should end with an id " +
        "and a long token, and be copied whole.",
    );
  }

  if (!cfg.channelId && !cfg.channelHandle) {
    problems.push("Set either YT_CHANNEL_ID or YT_CHANNEL_HANDLE.");
  } else if (isPlaceholder(cfg.channelId) || isPlaceholder(cfg.channelHandle)) {
    problems.push(
      "The YouTube channel is still the example value from .env.example. Put your own channel " +
        "ID or @handle there. See section 4 of the readme.",
    );
  }

  if (!cfg.apiKey) {
    problems.push(
      "YT_API_KEY is not set. Create a free key by enabling YouTube Data API v3 at " +
        "console.cloud.google.com, then add it. See section 5 of the readme.",
    );
  } else if (isPlaceholder(cfg.apiKey)) {
    problems.push("YT_API_KEY is still an example value. Put your own key there.");
  }

  if (cfg.cronSecret && isPlaceholder(cfg.cronSecret)) {
    problems.push(
      "CRON_SECRET is still the example value, which is public in this repository. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"',
    );
  }

  return problems;
}

/** Non fatal advice, printed at startup. */
export function configWarnings(cfg = config) {
  const warnings = [];

  if (!cfg.cronSecret) {
    warnings.push(
      "CRON_SECRET is not set. /cron, /test, /state and /reset are disabled until you set one.",
    );
  } else if (cfg.cronSecret.length < 16 || cfg.cronSecret === "change-me-to-something-random") {
    warnings.push(
      "CRON_SECRET is short or still the example value. Use at least 16 random characters.",
    );
  }

  if (!cfg.selfUrl) {
    warnings.push(
      "SELF_URL is not set and no host provided one, so the service may sleep when idle.",
    );
  } else if (cfg.keepAliveSeconds >= 900) {
    warnings.push(
      `KEEPALIVE_SECONDS is ${cfg.keepAliveSeconds}, which is longer than the 15 minute idle ` +
        "timeout on free hosting, so the service can still fall asleep. Use 600 or less.",
    );
  }

  // A ping put in the message body instead of MENTION silently does nothing,
  // because allowed_mentions is built from MENTION alone so that a stream
  // title can never ping a server by accident.
  if (/@everyone|@here/.test(cfg.messageTemplate) && !/@everyone|@here/.test(cfg.mention)) {
    warnings.push(
      "MESSAGE_TEMPLATE contains @everyone or @here, but MENTION does not, so no ping will " +
        "be sent. Move the ping into MENTION.",
    );
  }

  // Roughly one quota unit per check, against a free daily allowance of 10000.
  if (cfg.pollIntervalSeconds > 0) {
    const dailyUnits = Math.round(86400 / cfg.pollIntervalSeconds);
    if (dailyUnits > 8000) {
      warnings.push(
        `POLL_INTERVAL_SECONDS is ${cfg.pollIntervalSeconds}, which is about ${dailyUnits} API ` +
          "units a day against a free allowance of 10000. Use 60 or more.",
      );
    }
  }

  if (process.env.EMBED_COLOR && !Number.isFinite(Number.parseInt(process.env.EMBED_COLOR, 10))) {
    warnings.push(
      `EMBED_COLOR is "${process.env.EMBED_COLOR}", which is not a number, so the default red ` +
        "is being used. Give it a decimal number, for example 16711680.",
    );
  }

  return warnings;
}
