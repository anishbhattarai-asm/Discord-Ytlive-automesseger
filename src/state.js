import fs from "node:fs";
import path from "node:path";

const MAX_REMEMBERED = 50;

// A factory, not a shared constant: a spread of a constant would copy the
// `announced` array by reference and let one store mutate another's state.
function emptyState() {
  return {
    version: 1,
    // false until the first successful check, so a fresh boot can stay quiet.
    initialized: false,
    // [{ id, title, announcedAt }], most recent first.
    announced: [],
    lastCheckAt: null,
    lastLiveVideoId: null,
  };
}

/**
 * Tiny JSON-file store. Render's free tier has an ephemeral filesystem, so this
 * survives restarts of the process but not redeploys, which is why
 * `initialized` exists (see the startup grace branch in announcer.js).
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = emptyState();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = { ...emptyState(), ...parsed };
      if (!Array.isArray(this.data.announced)) this.data.announced = [];
    } catch {
      this.data = emptyState();
    }
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[state] failed to persist:", err.message);
    }
  }

  hasAnnounced(videoId) {
    return this.data.announced.some((entry) => entry.id === videoId);
  }

  markAnnounced(videoId, title) {
    if (this.hasAnnounced(videoId)) return;
    this.data.announced.unshift({
      id: videoId,
      title: title ?? null,
      announcedAt: new Date().toISOString(),
    });
    this.data.announced = this.data.announced.slice(0, MAX_REMEMBERED);
    this.save();
  }

  /** Record a stream we deliberately skipped, so we never revisit it. */
  suppress(videoId, title) {
    this.markAnnounced(videoId, title);
  }

  touch(liveVideoId) {
    this.data.lastCheckAt = new Date().toISOString();
    this.data.lastLiveVideoId = liveVideoId ?? null;
    this.data.initialized = true;
    this.save();
  }
}
