# Discord YouTube Live Auto Messenger

Posts a message in your Discord server the moment you go live on YouTube.
It sends exactly one message per stream, so nobody gets spammed if the checker
runs every few minutes.

## How it works

1. A cron ping (or the built in timer) hits the service every few minutes.
2. The service asks YouTube whether the channel is live right now.
3. If it is live, and that video has not been announced before, it posts to a
   Discord webhook and records the video ID.
4. Every later check sees the recorded ID and stays quiet until the next stream.

## What you need

1. A Discord webhook URL.
   In Discord go to Server Settings, then Integrations, then Webhooks, then New
   Webhook. Pick the channel you want the message in and copy the URL.

2. Your YouTube channel ID or handle.
   The ID starts with UC and appears in your channel URL. A handle such as
   @yourname also works.

3. A YouTube Data API key (optional but recommended).
   Go to console.cloud.google.com, create a project, enable YouTube Data API v3,
   then create an API key. Without a key the service reads the public channel
   page instead, which works but is less reliable.

## Run it on your computer

```
npm install
copy .env.example .env
```

Open .env, fill in DISCORD_WEBHOOK_URL and YT_CHANNEL_ID, then:

```
npm start
```

To run a single check and exit, which is useful for testing:

```
npm run check
```

## Deploy on Render

1. Push this project to a GitHub repository.
2. On Render create a new Web Service and point it at that repository.
3. Set the build command to `npm install` and the start command to `npm start`.
4. Choose the free instance type.
5. Under Environment add these variables:

   ```
   DISCORD_WEBHOOK_URL   your webhook URL
   YT_CHANNEL_ID         your channel ID
   YT_API_KEY            your API key, optional
   CRON_SECRET           any random string you invent
   ```

6. Deploy. When the log prints `listening on` the service is up.

This repository also contains render.yaml, so you can instead use Render's
Blueprint option and it will fill in the settings for you.

## Set up the cron ping

Render's free tier puts a web service to sleep after about 15 minutes with no
traffic. An outside ping keeps it awake and triggers each live check.

Use any free scheduler, for example cron-job.org or UptimeRobot, and have it
request this URL every 5 minutes:

```
https://YOUR-SERVICE.onrender.com/cron?key=YOUR_CRON_SECRET
```

Use the same value you set for CRON_SECRET. That is the whole cron setup.

The service also checks on its own every POLL_INTERVAL_SECONDS while it is
awake, so the ping is really there to stop Render from sleeping.

## Change the message

Set MESSAGE_TEMPLATE to whatever you want. These placeholders get replaced:

```
{channel}     your channel name
{title}       the stream title
{url}         the link to the stream
{videoId}     the YouTube video ID
{thumbnail}   the stream thumbnail image
{startedAt}   when the stream started
```

Example:

```
MESSAGE_TEMPLATE=Hey everyone, {channel} just went live!\n{title}\n{url}
```

Write \n where you want a line break, because .env files cannot hold real line
breaks.

To ping people, set MENTION. Use `@everyone`, or `<@&ROLE_ID>` for one role.
Leave it blank for no ping. Only the mention types you put here can trigger a
ping, so a stream title can never ping your server by accident.

Set USE_EMBED to false if you want plain text with no thumbnail card.

## Endpoints

```
GET  /          current status and what was announced recently
GET  /health    uptime check, no key needed
GET  /cron      run a live check now, needs the key
GET  /test      post an announcement now, ignores the once per stream rule
GET  /state     the stored state, needs the key
GET  /reset     forget announced streams so they can be announced again
```

Every endpoint except /health and / expects `?key=YOUR_CRON_SECRET`.

To confirm everything works before your next stream, go live briefly and open
the /test URL. It posts the message even if that stream was already announced.

## Notes

Announced video IDs are stored in a file at STATE_FILE. On Render's free tier
that file disappears when the service redeploys. To make sure a redeploy in the
middle of a stream does not repeat the announcement, the first check after a
restart records a running stream without posting. Set ANNOUNCE_ON_FIRST_RUN to
true if you would rather it post in that case.

Scheduled streams that have not started yet are ignored. Only a stream that is
actually live gets announced.

With an API key each check costs about 2 units of the 10000 unit daily quota, so
checking every minute is well within the free limit.

## License

MIT
