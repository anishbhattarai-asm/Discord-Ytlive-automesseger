import { buildPayload, sendToDiscord } from "./discord.js";
import { findLiveVideos, resolveChannelId, verifyChannel } from "./youtube.js";

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
    if (this.resolvedChannelId) return this.resolvedChannelId;

    const id = await resolveChannelId(this.config);

    // Name the channel in the log so a wrong but well formed ID is obvious
    // immediately, rather than looking like a channel that is never live.
    try {
      const channel = await verifyChannel(id, this.config.apiKey);
      if (channel) {
        this.channelTitle = channel.title;
        console.log(`[youtube] watching "${channel.title}" (${id})`);
      } else {
        console.warn(
          `[youtube] warning: no channel exists with ID ${id}. Check YT_CHANNEL_ID. ` +
            "Nothing will ever be announced until this is right.",
        );
      }
    } catch (err) {
      // A lookup failure here is not fatal, since the live check has its own
      // fallback and may still work.
      console.warn(`[youtube] could not confirm the channel: ${err.message}`);
    }

    this.resolvedChannelId = id;
    return id;
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
      const videos = await findLiveVideos({ channelId, apiKey: this.config.apiKey });

      // Capture before touch(), which flips `initialized` to true.
      const isFirstRun = !this.store.data.initialized;
      this.store.touch(videos[0]?.videoId);

      if (!videos.length) {
        return this.finish({ ok: true, live: false, announced: false, trigger });
      }

      // Pick the first broadcast still needing an announcement, so a second
      // concurrent stream is not hidden behind one that is already done.
      const video = force
        ? videos[0]
        : videos.find((v) => !this.store.hasAnnounced(v.videoId));

      if (!video) {
        return this.finish({
          ok: true,
          live: true,
          announced: false,
          reason: "already-announced",
          video: videos[0],
          liveCount: videos.length,
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
