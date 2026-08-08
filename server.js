import express from "express";

import { Announcer } from "./src/announcer.js";
import { config, validateConfig } from "./src/config.js";
import { Store } from "./src/state.js";

const problems = validateConfig(config);
if (problems.length) {
  console.error("Configuration problems:");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nCopy .env.example to .env (or set these in your host's dashboard).");
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
app.use(express.json({ limit: "16kb" }));

/** Guards the endpoints that can trigger a check or reveal state. */
function authorize(req, res) {
  if (!config.cronSecret) return true; // no secret configured, so leave it open
  const provided =
    req.query.key ||
    req.get("x-cron-key") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (provided === config.cronSecret) return true;
  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}

app.get("/", (req, res) => {
  res.json({
    service: "Discord YouTube-Live auto-messenger",
    ok: true,
    ...announcer.status(),
  });
});

// Kept open and cheap, since this is the uptime monitor target.
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/** The cron target: wakes the instance and runs a live check. */
app.all("/cron", async (req, res) => {
  if (!authorize(req, res)) return;
  const result = await announcer.check({ trigger: "cron" });
  res.status(result.ok ? 200 : 500).json(result);
});

/** Force an announcement for whatever is live right now, ignoring dedupe. */
app.all("/test", async (req, res) => {
  if (!authorize(req, res)) return;
  const result = await announcer.check({ force: true, trigger: "test" });
  res.status(result.ok ? 200 : 500).json(result);
});

app.get("/state", (req, res) => {
  if (!authorize(req, res)) return;
  res.json(store.data);
});

/** Forget a video id so the next check announces it again. */
app.all("/reset", (req, res) => {
  if (!authorize(req, res)) return;
  const id = req.query.videoId || req.body?.videoId;
  if (id) {
    store.data.announced = store.data.announced.filter((e) => e.id !== id);
  } else {
    store.data.announced = [];
  }
  store.save();
  res.json({ ok: true, announced: store.data.announced });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  console.log(
    `[server] YouTube API key ${config.apiKey ? "configured" : "not set, using page fallback"}`,
  );

  if (config.pollIntervalSeconds > 0) {
    console.log(`[server] self-polling every ${config.pollIntervalSeconds}s`);
    setInterval(
      () => announcer.check({ trigger: "interval" }),
      config.pollIntervalSeconds * 1000,
    ).unref();
  }

  // Seed state immediately so the startup grace applies right away rather than
  // waiting for the first cron ping.
  announcer.check({ trigger: "startup" });
});
