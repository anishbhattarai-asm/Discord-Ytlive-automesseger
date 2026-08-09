// First, so the version check runs before express or anything else is
// evaluated. Its message is useless if a dependency throws first.
import "./src/node-version.js";

import express from "express";

import { Announcer } from "./src/announcer.js";
import { authorize } from "./src/auth.js";
import { config, configWarnings, validateConfig } from "./src/config.js";
import { sendToDiscord } from "./src/discord.js";
import { startKeepAlive } from "./src/keepalive.js";
import { Store } from "./src/state.js";

const problems = validateConfig(config);
if (problems.length) {
  console.error("Configuration problems:");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nCopy .env.example to .env, or set these in your host's dashboard.");
  process.exit(1);
}

const store = new Store(config.stateFile);
const announcer = new Announcer(config, store);

// `npm run check` runs a single poll and exits, for use from a real cron job.
if (process.argv.includes("--once")) {
  const result = await announcer.check({ trigger: "cli" });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const app = express();
app.disable("x-powered-by");
// Hosts put the service behind a proxy, so req.ip has to come from the
// forwarded header for the rate limiter to see real client addresses.
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));

const guard = (req, res) => authorize(req, res, config);

// Public, and deliberately says nothing about the channel, the stored history,
// or internal errors. Anything revealing sits behind /status.
app.get("/", (req, res) => {
  res.json({
    service: "Discord YouTube Live Auto Messenger",
    ok: true,
    lastCheckAt: store.data.lastCheckAt,
  });
});

// Kept open and cheap, since this is the keep awake and uptime target.
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get("/status", (req, res) => {
  if (!guard(req, res)) return;
  res.json(announcer.status());
});

/** Runs a live check. Safe to call as often as you like. */
app.all("/cron", async (req, res) => {
  if (!guard(req, res)) return;
  const result = await announcer.check({ trigger: "cron" });
  res.status(result.ok ? 200 : 500).json(result);
});

/** Forces an announcement for whatever is live now, ignoring the dedupe. */
app.all("/test", async (req, res) => {
  if (!guard(req, res)) return;
  const result = await announcer.check({ force: true, trigger: "test" });
  res.status(result.ok ? 200 : 500).json(result);
});

/**
 * Posts one fixed message, with no YouTube lookup at all.
 *
 * Every other route needs a live stream before Discord is ever contacted, so a
 * silent service leaves you guessing whether nothing is live or the host
 * cannot reach Discord. Those two have completely different fixes. This
 * answers that question on its own, at any hour, with nobody streaming.
 */
app.all("/selftest", async (req, res) => {
  if (!guard(req, res)) return;

  const payload = {
    content:
      "Self test from the live announcer. Delivery works, and you can delete " +
      "this message.",
    allowed_mentions: { parse: [] },
  };
  if (config.webhookUsername) payload.username = config.webhookUsername;
  if (config.webhookAvatarUrl) payload.avatar_url = config.webhookAvatarUrl;

  try {
    const sent = await sendToDiscord(config.discordWebhookUrl, payload);
    console.log("[selftest] Discord accepted the message");
    res.json({ ok: true, delivered: true, messageId: sent?.id ?? null });
  } catch (err) {
    console.error(`[selftest] Discord refused the message: ${err.message}`);
    // 502 rather than 500. The failure is upstream, and saying so keeps this
    // distinguishable from the service itself being broken.
    res.status(502).json({ ok: false, delivered: false, error: err.message });
  }
});

app.get("/state", (req, res) => {
  if (!guard(req, res)) return;
  res.json(store.data);
});

/** Forgets a video id so the next check can announce it again. */
app.all("/reset", (req, res) => {
  if (!guard(req, res)) return;
  const id = req.query.videoId || req.body?.videoId;
  store.data.announced = id
    ? store.data.announced.filter((e) => e.id !== id)
    : [];
  store.save();
  res.json({ ok: true, announced: store.data.announced });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

// Without this, a malformed JSON body falls through to Express's default
// handler, which answers with an HTML error page from a service that is
// otherwise entirely JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[server] request failed: ${err.message}`);
  res.status(status).json({
    ok: false,
    error: status === 400 ? "bad request" : "internal error",
  });
});

const server = app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  console.log(
    `[server] YouTube API key ${config.apiKey ? "configured" : "not set, using page fallback"}`,
  );

  for (const warning of configWarnings(config)) {
    console.warn(`[server] warning: ${warning}`);
  }

  if (config.pollIntervalSeconds > 0) {
    console.log(`[server] checking every ${config.pollIntervalSeconds}s`);
    setInterval(
      () => announcer.check({ trigger: "interval" }),
      config.pollIntervalSeconds * 1000,
    ).unref();
  }

  startKeepAlive(config);

  // Seed the state now so the startup grace applies immediately rather than
  // waiting for the first scheduled check.
  announcer.check({ trigger: "startup" });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${config.port} is already in use. Another copy is probably still running. ` +
        "Stop it, or set PORT to something else.",
    );
  } else {
    console.error(`Server failed to start: ${err.message}`);
  }
  process.exit(1);
});
