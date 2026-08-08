import { buildPayload, sendToDiscord } from "./discord.js";
import { findLiveVideo, resolveChannelId } from "./youtube.js";

export class Announcer {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.running = false;
    this.resolvedChannelId = null;
    this.lastResult = null;
    this.lastError = null;
  }

  async channelId() {
    if (!this.resolvedChannelId) {
      this.resolvedChannelId = await resolveChannelId(this.config);
      console.log(`[youtube] watching channel ${this.resolvedChannelId}`);
    }
    return this.resolvedChannelId;
  }

  /**
   * One full poll. `force` bypasses both the already-announced check and the
   * first-run grace, for manual testing.
   */
  async check({ force = false, trigger = "manual" } = {}) {
    if (this.running) return { ok: true, skipped: "check-already-in-progress" };
    this.running = true;

    try {
      const channelId = await this.channelId();
      const video = await findLiveVideo({ channelId, apiKey: this.config.apiKey });

      // Capture before touch(), which flips `initialized` to true.
      const isFirstRun = !this.store.data.initialized;
      this.store.touch(video?.videoId);

      if (!video) {
        return this.finish({ ok: true, live: false, announced: false, trigger });
      }

      if (!force && this.store.hasAnnounced(video.videoId)) {
        return this.finish({
          ok: true,
          live: true,
          announced: false,
          reason: "already-announced",
          video,
          trigger,
        });
      }

      // A restart wipes state on ephemeral hosting. Without this, redeploying
      // mid-stream would fire a duplicate announcement.
      if (!force && isFirstRun && !this.config.announceOnFirstRun) {
        this.store.suppress(video.videoId, video.title);
        console.log(
          `[announcer] ${video.videoId} was already live at startup, recorded without announcing.`,
        );
        return this.finish({
          ok: true,
          live: true,
          announced: false,
          reason: "startup-grace",
          video,
          trigger,
        });
      }

      const payload = buildPayload(video, this.config);
      await sendToDiscord(this.config.discordWebhookUrl, payload);
      this.store.markAnnounced(video.videoId, video.title);

      console.log(`[announcer] announced "${video.title}" (${video.videoId})`);
      return this.finish({ ok: true, live: true, announced: true, video, trigger });
    } catch (err) {
      this.lastError = { message: err.message, at: new Date().toISOString() };
      console.error(`[announcer] check failed: ${err.message}`);
      return this.finish({ ok: false, error: err.message, trigger });
    } finally {
      this.running = false;
    }
  }

  finish(result) {
    // Clear a stale failure once a check succeeds, otherwise /status keeps
    // reporting an error that has already been fixed.
    if (result.ok) this.lastError = null;
    this.lastResult = { ...result, at: new Date().toISOString() };
    return this.lastResult;
  }

  status() {
    return {
      watching: this.resolvedChannelId || this.config.channelId || this.config.channelHandle,
      usingApiKey: Boolean(this.config.apiKey),
      pollIntervalSeconds: this.config.pollIntervalSeconds,
      lastCheckAt: this.store.data.lastCheckAt,
      lastLiveVideoId: this.store.data.lastLiveVideoId,
      announcedCount: this.store.data.announced.length,
      recentlyAnnounced: this.store.data.announced.slice(0, 5),
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }
}
