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
  let content = [cfg.mention, body].filter(Boolean).join(" ").slice(0, MAX_CONTENT);

  // Discord rejects a message with neither text nor an embed, and that
  // rejection would repeat on every check forever. An emptied out template is
  // a plausible mistake, so fall back to something rather than never posting.
  if (!content.trim() && !cfg.useEmbed) {
    content = `${video.channelTitle} is live now!\n${video.url}`;
  }

  const payload = {
    content,
    allowed_mentions: allowedMentions(cfg.mention),
  };

  if (cfg.webhookUsername) payload.username = cfg.webhookUsername;
  if (cfg.webhookAvatarUrl) payload.avatar_url = cfg.webhookAvatarUrl;

  if (cfg.useEmbed) {
    const embed = {
      title: video.title.slice(0, 256),
      url: video.url,
      color: cfg.embedColor,
      description: `${video.channelTitle} is now live on YouTube!`.slice(0, 4096),
      author: { name: video.channelTitle.slice(0, 256) },
      image: { url: video.thumbnail },
      footer: { text: "YouTube Live" },
      timestamp: video.startedAt,
    };

    // Only present when an API key is configured, since the public page does
    // not expose the channel picture.
    if (video.channelAvatar) embed.author.icon_url = video.channelAvatar;

    const description = (video.description || "").trim();
    if (cfg.showDescription && description) {
      embed.fields = [
        {
          name: "Description",
          // Discord rejects a field value over 1024 characters, and a wall of
          // text reads badly anyway, so keep the opening few lines.
          value: truncate(description, 300),
        },
      ];
    }

    payload.embeds = [embed];
  }

  return payload;
}

function truncate(text, limit) {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit - 3);
  // Break on the last space so the text does not stop mid word. Ignored when
  // the tail has no space to break on, such as one very long URL.
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;

  return `${body.trimEnd()}...`;
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

    // Discord has brief outages. Retrying costs seconds, while giving up
    // costs a whole poll interval before the announcement is tried again.
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${text.slice(0, 300)}`);
  }

  throw new Error("Discord webhook failed: still failing after 3 attempts");
}
