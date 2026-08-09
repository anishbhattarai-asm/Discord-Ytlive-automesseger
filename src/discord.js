const MAX_CONTENT = 2000;

// Discord's API requires a User-Agent, and Cloudflare, which sits in front of
// it, is far stricter with a datacenter address than with a home connection.
// A webhook that works from a laptop can be answered with 429 from a free
// host purely for arriving with no User-Agent at all.
const USER_AGENT =
  "DiscordBot (https://github.com/anishbhattarai-asm/Discord-Ytlive-automesseger, 1.0.0)";

// Total time to spend riding out a 429 before giving up. A block measured in
// minutes is worth waiting for, since the alternative is losing the
// announcement for a whole poll interval, and possibly for the whole stream.
const MAX_RETRY_WAIT_MS = 60_000;

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

// Cloudflare's block pages all begin with the same doctype and conditional
// comments, so printing the first part of the body says nothing. The two
// pieces that matter are the numbered error code, which says whether this
// expires, and the Ray ID, which is what Cloudflare support asks for.
const CLOUDFLARE_CODES = {
  1015: "rate limited by Cloudflare, temporary and clears on its own",
  1020: "access denied by a Cloudflare firewall rule, will not clear by waiting",
  1010: "browser signature refused",
  1006: "this IP address is banned",
};

// Codes that describe a decision about this address rather than a burst of
// traffic. Sitting through the backoff for these only delays the poll, since
// the answer is the same every time until the address itself changes.
const PERMANENT_CODES = new Set(["1020", "1010", "1006"]);

function classifyLimit(body, retryAfter, ray) {
  if (retryAfter != null) {
    return { text: `Discord's own limiter, retry_after=${retryAfter}s`, permanent: false };
  }

  // Cloudflare writes the number several ways depending on which page it
  // serves: "error code: 1015", "Error 1015", and a cf-error-code element.
  // Matching only the first of those found nothing and left the one useful
  // fact out of the log.
  const code =
    body.match(/error\s*(?:code)?[:\s]*?(1\d{3})\b/i)?.[1] ||
    body.match(/cf-error-code[^>]*>\s*(\d{4})/i)?.[1];
  const title = body.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1]?.trim();

  if (!code && !/cloudflare/i.test(body)) {
    return {
      text: `no retry_after, unrecognised body: ${body.slice(0, 120).replace(/\s+/g, " ")}`,
      permanent: false,
    };
  }

  // Falling back to the visible words costs one line and beats reporting
  // nothing at all, which is what happened when both patterns missed.
  const gist =
    title ||
    body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

  return {
    text:
      `Cloudflare${code ? ` error ${code}` : " (no code found)"}` +
      `${code && CLOUDFLARE_CODES[code] ? ` (${CLOUDFLARE_CODES[code]})` : ""}` +
      `${gist ? `, page says "${gist}"` : ""}` +
      `${ray ? `, ray ${ray}` : ""}` +
      ". This is about the address the request comes from, not the webhook.",
    permanent: PERMANENT_CODES.has(code),
  };
}

export async function sendToDiscord(webhookUrl, payload) {
  const url = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`;

  let waitedMs = 0;
  let lastLimit = "";
  let permanentlyBlocked = false;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) return await res.json().catch(() => ({}));

    if (res.status === 429) {
      // Read the body as text first. Discord's own limiter answers with JSON
      // carrying retry_after, while a Cloudflare block answers with an HTML
      // page, and only text survives both without throwing.
      const body = await res.text().catch(() => "");
      let retryAfter = null;
      try {
        retryAfter = JSON.parse(body).retry_after ?? null;
      } catch {
        // Not JSON, so this is not Discord's own rate limiter talking.
      }

      const limit = classifyLimit(body, retryAfter, res.headers.get("cf-ray"));
      lastLimit = limit.text;
      permanentlyBlocked = limit.permanent;

      // Say this out loud. Without it the only evidence is a generic failure
      // after the retries run out, which cannot distinguish a throttled
      // webhook from a host whose IP address is being refused outright.
      console.warn(`[discord] rate limited: ${lastLimit}`);

      // A refusal aimed at this address answers the same way however long the
      // wait, so stop now and let the next poll try. The announcement is not
      // lost by giving up here, since nothing is marked announced until a send
      // actually succeeds.
      if (permanentlyBlocked) break;

      // Cloudflare sends no retry_after, so widen the wait each time instead
      // of retrying into the same closed door three times in a row.
      const waitMs =
        retryAfter != null
          ? Math.ceil(retryAfter * 1000)
          : Math.min(2000 * 2 ** attempt, 20_000);

      if (waitedMs + waitMs > MAX_RETRY_WAIT_MS) break;
      waitedMs += waitMs;
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

    // 404 means the webhook no longer exists, usually because it was deleted
    // or the channel was. Retrying cannot fix that, so say what will.
    if (res.status === 404) {
      throw new Error(
        "Discord webhook no longer exists. It was probably deleted, or its channel was. " +
          "Create a new webhook and update DISCORD_WEBHOOK_URL.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Discord refused the webhook (${res.status}). Check DISCORD_WEBHOOK_URL was copied whole.`,
      );
    }

    throw new Error(`Discord webhook failed: ${res.status} ${text.slice(0, 300)}`);
  }

  if (permanentlyBlocked) {
    throw new Error(
      `Discord is refusing this host outright (${lastLimit}) Waiting will not help. The ` +
        "request has to come from a different address: move the service to another region " +
        "or another host. See section 13 of the readme.",
    );
  }

  throw new Error(
    `Discord kept rate limiting this host for over ${Math.round(MAX_RETRY_WAIT_MS / 1000)}s ` +
      `(${lastLimit}) The webhook itself is probably fine, since this is about where the ` +
      "request comes from. Free hosts share outgoing addresses, so this usually clears on " +
      "its own, and the next check will try again.",
  );
}
