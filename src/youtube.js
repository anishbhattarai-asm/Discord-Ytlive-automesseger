const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIMEOUT_MS = 12_000;

async function httpGet(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      // Without this YouTube localises by server IP, so a host in another
      // country returns non English titles and view counts.
      "accept-language": "en-US,en;q=0.9",
      cookie: "PREF=hl=en&gl=US",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url.split("?")[0]} returned ${res.status} ${body.slice(0, 200)}`);
  }
  return json ? res.json() : res.text();
}

const withEnglish = (url) => `${url}${url.includes("?") ? "&" : "?"}hl=en&gl=US`;

/** Accepts a UC id, an @handle, or a bare handle, and returns a UC id. */
export async function resolveChannelId({ channelId, channelHandle }) {
  if (/^UC[\w-]{22}$/.test(channelId)) return channelId;

  const handle = (channelHandle || channelId || "").trim();
  if (!handle) throw new Error("No YouTube channel configured.");

  // Only ever fetch youtube.com. A handle is meant to be a name, and letting
  // it be any address would turn a config mistake, or a copied line from
  // somewhere else, into this server fetching a URL of someone else's
  // choosing.
  let url;
  if (handle.startsWith("http")) {
    const parsed = new URL(handle);
    if (!/(^|\.)youtube\.com$/.test(parsed.hostname)) {
      throw new Error(
        `YT_CHANNEL_HANDLE must be a handle such as @yourname, or a youtube.com address. Got ${parsed.hostname}.`,
      );
    }
    url = parsed.toString();
  } else {
    const name = handle.startsWith("@") ? handle : `@${handle}`;
    // Check the shape rather than escaping it. YouTube handles are limited to
    // these characters, so anything else is a mistake, and this keeps slashes
    // and dots out of the path instead of relying on the far end to decode
    // percent escapes.
    if (!/^@[A-Za-z0-9._-]{1,100}$/.test(name)) {
      throw new Error(
        `"${handle}" is not a valid YouTube handle. It should look like @yourname, using ` +
          "letters, numbers, dots, dashes or underscores.",
      );
    }
    url = `https://www.youtube.com/${name}`;
  }

  const html = await httpGet(withEnglish(url));

  // Each pattern is tried separately and in priority order. One regex with
  // alternation would return whichever token appears first in the document,
  // and pages list recommended channels' ids before the page owner's.
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`Could not resolve a channel ID from ${url}`);
}

/**
 * The /live page redirects to the current broadcast when one exists. This is
 * the fastest signal, since the RSS feed can lag by a minute or two.
 */
async function probeLivePage(channelId) {
  let html;
  try {
    html = await httpGet(withEnglish(`https://www.youtube.com/channel/${channelId}/live`));
  } catch {
    return null;
  }

  // Only the canonical watch link is trustworthy. When the channel is not
  // live, /live falls back to the channel page, which has no canonical watch
  // URL but is full of recommended videos that a looser match would catch.
  const canonical = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})">/,
  );
  if (!canonical) return null;
  const videoId = canonical[1];

  // Read the flags from the player's videoDetails object, which describes this
  // video only. Reading them from the whole document would pick up sidebar
  // recommendations that happen to be live.
  const start = html.indexOf('"videoDetails":{');
  const details = start === -1 ? "" : html.slice(start, start + 6000);
  if (!details.includes(`"videoId":"${videoId}"`)) return null;

  const field = (name) => {
    const m = details.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? decodeJsonEscapes(m[1]) : null;
  };

  // Scheduled broadcasts also sit behind /live and must not be announced.
  const isLive = /"isLive":\s*true/.test(details);
  const isUpcoming = /"isUpcoming":\s*true/.test(details);

  return {
    videoId,
    live: isLive && !isUpcoming,
    title: field("title"),
    channelTitle: field("author"),
  };
}

/** The 15 most recent uploads. Livestreams appear here too. No API quota. */
async function readFeed(channelId) {
  try {
    const xml = await httpGet(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    );

    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
      .map((m) => ({
        id: m[1].match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1] || null,
        title: m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || null,
      }))
      .filter((e) => e.id)
      .map((e) => ({ id: e.id, title: e.title ? decodeHtml(e.title.trim()) : null }));

    // The feed level <title> precedes the first <entry>. A channel with no
    // uploads has no <entry> at all, and indexOf would return -1 and cut the
    // document to nothing, so fall back to searching the whole feed.
    const firstEntry = xml.indexOf("<entry>");
    const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
    const channelTitle = head.match(/<title>([\s\S]*?)<\/title>/)?.[1] || null;

    return {
      channelTitle: channelTitle ? decodeHtml(channelTitle.trim()) : null,
      entries,
    };
  } catch {
    return { channelTitle: null, entries: [] };
  }
}

/**
 * Authoritative check via the Data API. Costs 1 quota unit no matter how many
 * ids are passed (up to 50), which keeps daily usage far under the 10,000 cap.
 */
async function confirmViaApi(ids, apiKey) {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: ids.slice(0, 50).join(","),
    hl: "en",
    key: apiKey,
  });
  const data = await httpGet(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
    json: true,
  });

  // Every live broadcast, not just the first. A channel can run more than one
  // at a time, and returning only one would mean the others could never be
  // announced, because each later check would keep finding the same one.
  return (data.items || [])
    .filter((v) => v.snippet?.liveBroadcastContent === "live")
    .map((item) =>
      normalize({
        videoId: item.id,
        title: item.snippet?.title,
        channelTitle: item.snippet?.channelTitle,
        description: item.snippet?.description,
        ownerChannelId: item.snippet?.channelId,
        thumbnail:
          item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.high?.url || null,
        startedAt: item.liveStreamingDetails?.actualStartTime || null,
        concurrentViewers: item.liveStreamingDetails?.concurrentViewers || null,
      }),
    );
}

/**
 * Confirms the configured channel actually exists, and returns its name.
 * A mistyped but correctly shaped ID is otherwise indistinguishable from a
 * channel that simply is not live, so without this the service would look
 * healthy and never announce anything.
 */
export async function verifyChannel(channelId, apiKey) {
  if (!apiKey) return null;
  const params = new URLSearchParams({ part: "snippet", id: channelId, key: apiKey });
  const data = await httpGet(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
    json: true,
  });
  const snippet = data.items?.[0]?.snippet;
  return snippet ? { id: channelId, title: snippet.title } : null;
}

/**
 * The channel's picture, used as the small icon beside the name on the embed.
 * Fetched only once a stream has been found, so it costs a quota unit when
 * announcing rather than on every check.
 */
async function fetchChannelAvatar(channelId, apiKey) {
  if (!channelId || !apiKey) return null;
  try {
    const params = new URLSearchParams({
      part: "snippet",
      id: channelId,
      key: apiKey,
    });
    const data = await httpGet(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
      json: true,
    });
    const thumbs = data.items?.[0]?.snippet?.thumbnails;
    return thumbs?.medium?.url || thumbs?.default?.url || null;
  } catch {
    return null;
  }
}

function normalize(v) {
  return {
    videoId: v.videoId,
    title: v.title || "Live now",
    channelTitle: v.channelTitle || "The channel",
    description: v.description || "",
    ownerChannelId: v.ownerChannelId || null,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    // hqdefault rather than maxresdefault, which does not exist for every
    // video and would leave the card with no image at all.
    thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    channelAvatar: v.channelAvatar || null,
    startedAt: v.startedAt || new Date().toISOString(),
    concurrentViewers: v.concurrentViewers ?? null,
  };
}

function decodeJsonEscapes(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Every broadcast the channel has live right now, newest first, or an empty
 * array. The caller decides which of them still needs announcing.
 */
export async function findLiveVideos({ channelId, apiKey }) {
  const [livePage, feed] = await Promise.all([
    probeLivePage(channelId),
    readFeed(channelId),
  ]);

  if (apiKey) {
    const candidates = [
      ...new Set([livePage?.videoId, ...feed.entries.map((e) => e.id)].filter(Boolean)),
    ];
    try {
      const videos = await confirmViaApi(candidates, apiKey);
      // The API is authoritative, so when it answers, trust it either way.
      if (!videos.length) return [];

      // One lookup covers them all, since they share a channel.
      const avatar = await fetchChannelAvatar(
        videos[0].ownerChannelId || channelId,
        apiKey,
      );
      for (const video of videos) video.channelAvatar = avatar;
      return videos;
    } catch (err) {
      // A key can stop working mid stream by running out of quota or being
      // revoked. Announcing a plainer card beats announcing nothing, so drop
      // to the public page rather than failing the whole check.
      console.error(
        `[youtube] API check failed, falling back to the public page: ${err.message}`,
      );
    }
  }

  // The public page only ever reveals one broadcast, so this path cannot see a
  // second concurrent stream. That is a limitation of the fallback, not a
  // reason to fail.
  if (livePage?.live) {
    return [
      normalize({
        videoId: livePage.videoId,
        title: livePage.title || feed.entries.find((e) => e.id === livePage.videoId)?.title,
        channelTitle: livePage.channelTitle || feed.channelTitle,
      }),
    ];
  }
  return [];
}
