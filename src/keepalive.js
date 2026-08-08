/**
 * Free hosting sleeps a service after a stretch with no inbound traffic, and a
 * sleeping service cannot notice a stream starting. Requesting our own public
 * address counts as inbound traffic, which keeps us awake without the user
 * having to register anywhere.
 *
 * Render exposes RENDER_EXTERNAL_URL on its own, so this normally needs no
 * configuration at all.
 */
export function startKeepAlive(config) {
  if (!config.selfUrl || config.keepAliveSeconds <= 0) {
    console.log("[keepalive] disabled, set SELF_URL to enable it");
    return null;
  }

  const target = `${config.selfUrl.replace(/\/+$/, "")}/health`;
  console.log(`[keepalive] pinging ${target} every ${config.keepAliveSeconds}s`);

  const timer = setInterval(async () => {
    try {
      await fetch(target, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      console.error(`[keepalive] ping failed: ${err.message}`);
    }
  }, config.keepAliveSeconds * 1000);

  timer.unref();
  return timer;
}
