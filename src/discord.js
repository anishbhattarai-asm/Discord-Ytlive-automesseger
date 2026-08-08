const MAX_CONTENT = 2000;

/** Fill {placeholders} in the user's MESSAGE_TEMPLATE. */
export function renderTemplate(template, video) {
  const values = {
    title: video.title,
    url: video.url,
    videoId: video.videoId,
    channel: video.channelTitle,
    thumbnail: video.thumbnail,
    startedAt: video.startedAt,
  };
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : whole,
  );
}

/**
 * Only permit the ping types the operator actually put in MENTION, so a
 * stream title containing "@everyone" can never trigger a mass ping.
 */
function allowedMentions(mention) {
  const parse = [];
  if (/@everyone|@here/.test(mention)) parse.push("everyone");
  if (/<@&\d+>/.test(mention)) parse.push("roles");
  if (/<@!?\d+>/.test(mention)) parse.push("users");
  return { parse };
}

export function buildPayload(video, cfg) {
  const body = renderTemplate(cfg.messageTemplate, video);
  const content = [cfg.mention, body].filter(Boolean).join(" ").slice(0, MAX_CONTENT);

  const payload = {
    content,
    allowed_mentions: allowedMentions(cfg.mention),
  };

  if (cfg.webhookUsername) payload.username = cfg.webhookUsername;
  if (cfg.webhookAvatarUrl) payload.avatar_url = cfg.webhookAvatarUrl;

  if (cfg.useEmbed) {
    payload.embeds = [
      {
        title: video.title.slice(0, 256),
        url: video.url,
        color: cfg.embedColor,
        author: { name: video.channelTitle.slice(0, 256) },
        image: { url: video.thumbnail },
        footer: { text: "YouTube Live" },
        timestamp: video.startedAt,
      },
    ];
  }

  return payload;
}

export async function sendToDiscord(webhookUrl, payload) {
  const url = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) return await res.json().catch(() => ({}));

    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      const waitMs = Math.min(Math.ceil((info.retry_after ?? 1) * 1000), 10_000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${text.slice(0, 300)}`);
  }

  throw new Error("Discord webhook failed: rate limited after 3 attempts");
}
