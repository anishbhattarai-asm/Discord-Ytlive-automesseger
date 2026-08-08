import crypto from "node:crypto";

const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const failures = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failures) {
    if (now > entry.resetAt) failures.delete(ip);
  }
}, 60_000).unref();

/**
 * Compares by hash so the work is constant time. A plain === leaks how much of
 * the secret was correct through response timing, which lets an attacker
 * recover it one character at a time.
 */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Guards the endpoints that trigger a post or expose stored state.
 * Returns true when the request may continue, otherwise it has already
 * answered and the caller must stop.
 */
export function authorize(req, res, config) {
  // Fail closed. An unset secret used to mean "open to everyone", which left
  // /test and /reset exposed to anyone who guessed the service address.
  if (!config.cronSecret) {
    res.status(503).json({
      ok: false,
      error: "CRON_SECRET is not set, so protected endpoints are disabled.",
    });
    return false;
  }

  const ip = clientIp(req);
  const entry = failures.get(ip);
  if (entry && entry.count >= MAX_FAILURES && Date.now() < entry.resetAt) {
    res.status(429).json({
      ok: false,
      error: "Too many failed attempts, try again later.",
    });
    return false;
  }

  const provided =
    req.query.key ||
    req.get("x-cron-key") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "");

  if (provided && safeEqual(provided, config.cronSecret)) {
    failures.delete(ip);
    return true;
  }

  // Rate limit guesses, otherwise the secret can simply be brute forced.
  const next = entry && Date.now() < entry.resetAt
    ? { count: entry.count + 1, resetAt: entry.resetAt }
    : { count: 1, resetAt: Date.now() + LOCKOUT_MS };
  failures.set(ip, next);

  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}
