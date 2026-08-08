# Discord YouTube Live Auto Messenger

Posts a message in your Discord server the moment you go live on YouTube.

It sends exactly one message per stream, so nobody gets spammed even when the
checker runs every few minutes. The message text is yours to edit.

You do not need to create a Discord bot, and you do not need a database.

## This is a one time setup

You set it up once, in about 15 minutes, and then you never touch it again.

After that you simply go live and the message posts itself. There is nothing to
start, nothing to click, and nothing to do per stream.

| Done once | Happens on its own, forever |
| --- | --- |
| Create the Discord webhook | Checking whether you are live |
| Find your YouTube channel ID | Sending the message |
| Get an API key, if you want one | Keeping itself awake so it never sleeps |
| Deploy it and paste in your values | Making sure only one message is sent |

There is no scheduler to register for and no cron account to create. The
service handles its own timing.

The only reasons you would ever open it again:

* You move the announcement to a different Discord channel, which means making
  a new webhook, since a webhook belongs to one channel.
* You change YouTube channel.
* You want to reword the message.

Each of those is a single value to update, and nothing else changes.

## The easy way

If you want the shortest path, this is the whole thing.

1. Make a Discord webhook and copy its URL. See section 3.
2. Find your YouTube channel ID. See section 4.
3. Deploy this project on Render. See section 7.
4. On Render, open Environment Variables and add these four:

   ```
   DISCORD_WEBHOOK_URL    the URL you copied from Discord
   YT_CHANNEL_ID          your channel ID, or use @yourhandle
   YT_API_KEY             optional, leave it out if you prefer
   CRON_SECRET            a long random string, see below
   ```

5. That is it. Go live and the message appears.

Generate the secret by running this on your computer, then paste the result
into Render and keep a copy for yourself:

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

You do not need any of the following, whatever you may have read elsewhere:

* No cron account. The service runs its own timer.
* No GitHub secrets. Those are only for the optional backup in section 8.
* No Discord bot, no bot token, no permissions to configure.
* No database.
* No API key, strictly speaking. It works without one and is steadier with one.

Everything after this point in the guide is optional detail. Read it when you
want to change the message, add a backup timer, or work out why something is
not behaving.

## Contents

1. What you need before you start
2. Which modules get installed
3. Step 1, create the Discord webhook
4. Step 2, find your YouTube channel ID
5. Step 3, get a YouTube API key (optional)
6. Step 4, run it on your own computer
7. Step 5, put it online with Render
8. Step 6, the cron ping, automatic plus optional schedulers
9. Editing the message
10. All settings
11. Endpoints
12. Keeping it private
13. Troubleshooting
14. How it decides to send only one message

## 1. What you need before you start

| Requirement | Notes |
| --- | --- |
| Node.js version 20 or newer | Free. Download from nodejs.org, pick the LTS button. Installing Node also installs npm. |
| A Discord server | You need the Manage Webhooks permission on it, which server owners already have. |
| A YouTube channel | The one you go live on. |
| A GitHub account | Only if you want to host it online. |
| A YouTube Data API key | Optional but recommended. Free. |

To check whether Node is already installed, open a terminal (Command Prompt or
PowerShell on Windows, Terminal on Mac) and run:

```
node --version
```

If it prints something like v20.11.0 or higher you are ready. If it says the
command is not found, install Node.js first.

## 2. Which modules get installed

You do not have to hunt for modules or write a requirements file. The file
package.json in this project already lists everything, and this one command
reads it and installs what is needed:

```
npm install
```

The project uses a single outside package:

| Package | Why |
| --- | --- |
| express | Serves the small web page and the cron endpoint |

Everything else uses features built into Node.js itself, which is why the
install is quick and there is nothing else to configure. The YouTube and
Discord calls use Node's built in fetch, so there is no API library to add.

If you are used to Python, package.json is the equivalent of requirements.txt,
and npm install is the equivalent of pip install.

## 3. Step 1, create the Discord webhook

A webhook is a private URL that lets anything post into one channel. This is
what the project uses to send your message.

1. Open Discord and go to your server.
2. Click the server name, then Server Settings.
3. Click Integrations, then Webhooks.
4. Click New Webhook.
5. Give it a name, for example Live Notifier, and choose the channel the
   announcement should appear in.
6. Click Copy Webhook URL.

Keep that URL private. Anyone who has it can post in that channel.

## 4. Step 2, find your YouTube channel ID

You can use either your channel ID or your handle.

The channel ID is the safer option. To find it:

1. Open your YouTube channel page.
2. Look at the address bar. If it looks like youtube.com/channel/UCxxxxxxxx
   then the part starting with UC is your channel ID.

If your address bar shows a handle such as youtube.com/@yourname instead, you
can simply use @yourname. The project will look up the ID for you.

## 5. Step 3, get a YouTube API key (optional)

The project works without a key by reading your public channel page. Adding a
key makes the live check more reliable, and it is free.

1. Go to console.cloud.google.com and sign in.
2. Create a new project, any name works.
3. In the search bar type YouTube Data API v3, open it, and click Enable.
4. Go to Credentials, click Create Credentials, then API key.
5. Copy the key.

Each check costs about 2 units out of a free daily allowance of 10000 units, so
checking every minute still stays well inside the free limit.

## 6. Step 4, run it on your own computer

Do this first to confirm everything works before putting it online.

1. Download this project. Either click the green Code button on GitHub and
   choose Download ZIP and unzip it, or run:

   ```
   git clone https://github.com/anishbhattarai-asm/Discord-Ytlive-automesseger.git
   ```

2. Open a terminal inside the project folder and install the modules:

   ```
   npm install
   ```

3. Create your settings file by copying the example.

   On Windows:

   ```
   copy .env.example .env
   ```

   On Mac or Linux:

   ```
   cp .env.example .env
   ```

4. Open the new .env file in any text editor and fill in your details:

   ```
   DISCORD_WEBHOOK_URL=the URL you copied from Discord
   YT_CHANNEL_ID=your channel ID, or use YT_CHANNEL_HANDLE=@yourname
   YT_API_KEY=your API key if you made one, otherwise leave it blank
   CRON_SECRET=any random text you invent
   ```

5. Start it:

   ```
   npm start
   ```

   You should see `[server] listening on :3000`.

6. To test without waiting for a real stream, run a single check:

   ```
   npm run check
   ```

   It prints what it found. If you are live at that moment it will report the
   stream. Press Ctrl and C together to stop the server when you are done.

## 7. Step 5, put it online with Render

Your computer cannot stay on all day, so host it for free on Render.

1. Push this project to your own GitHub repository, or fork this one.
2. Go to render.com and sign up, then connect your GitHub account.
3. Click New, then Web Service, and pick your repository.
4. Fill in the settings:

   | Field | Value |
   | --- | --- |
   | Runtime | Node |
   | Build Command | npm install |
   | Start Command | npm start |
   | Instance Type | Free |

5. Scroll to Environment Variables and add each of these:

   ```
   DISCORD_WEBHOOK_URL    your webhook URL
   YT_CHANNEL_ID          your channel ID
   YT_API_KEY             your API key, or leave it out
   CRON_SECRET            any random text you invent
   ```

   Do not upload your .env file. Render keeps these values for you, and .env is
   deliberately excluded from the repository so your secrets never go public.

6. Click Create Web Service and wait for the log to print `listening on`.
7. Copy your service address from the top of the page. It looks like
   https://yourname.onrender.com

This project also includes render.yaml, so you can instead choose Blueprint on
Render and it will fill in the build and start commands for you.

## 8. Step 6, the cron ping

**You can skip this whole step.** It is automatic now. Read on only if you want
a second scheduler as a backup.

### Which timer am I using?

The timer is inside the service itself, running on your host. It is switched on
by default and needs nothing from you.

GitHub Actions and cron-job.org are alternatives you may add on top. They do not
replace the internal timer, they only prod it from outside as insurance. Use at
most one of them, or none.

### Where each value goes

Two different places store values, and mixing them up is the usual cause of a
401. This table shows what goes where.

| Value | Render, Environment Variables | GitHub, repository secrets | cron-job.org |
| --- | --- | --- | --- |
| DISCORD_WEBHOOK_URL | yes, required | no | no |
| YT_CHANNEL_ID | yes, required | no | no |
| YT_API_KEY | yes, if you have one | no | no |
| CRON_SECRET | yes | only for Option A | goes in the URL |
| SERVICE_URL | no, Render knows it | only for Option A | goes in the URL |

The running service never reads your GitHub secrets. Render runs the app, and
GitHub only calls it from the outside, so CRON_SECRET has to be written
identically in both places or the call is refused.

cron-job.org has no secrets panel at all. The key simply forms part of the
address you paste into it.

### What already runs on its own

Once the service starts, two timers run inside it with no setup at all:

1. It checks whether you are live every POLL_INTERVAL_SECONDS, which is 5
   minutes by default.
2. It requests its own address every KEEPALIVE_SECONDS, which is 10 minutes by
   default, so that free hosting does not put it to sleep. Render supplies the
   address through RENDER_EXTERNAL_URL by itself, so there is nothing to fill
   in.

If your host does not supply a public address automatically, set SELF_URL to
your service address and the self ping starts working.

To make announcements arrive faster, lower POLL_INTERVAL_SECONDS. Setting it to
60 gives a check every minute, which is still well inside the free API quota.

### Why you might still add an outside scheduler

The self ping cannot help in one case. If the host stops the service completely,
rather than only letting it idle, then nothing inside it is running and it
cannot wake itself. An outside scheduler covers that, because the request
arrives from elsewhere.

It is belt and braces, not a requirement. Pick one of the three below if you
want it.

### Option A, GitHub Actions, no extra signup

This repository already contains the schedule at
.github/workflows/keepalive.yml, so there is no account to create.

1. Open your repository on GitHub.
2. Go to Settings, then Secrets and variables, then Actions.
3. Click New repository secret and add:

   ```
   Name: SERVICE_URL     Value: https://yourname.onrender.com
   Name: CRON_SECRET     Value: the same secret you set on your host
   ```

4. Go to the Actions tab and enable workflows if GitHub asks you to.
5. Open Keep awake and check, then click Run workflow to try it once.

Until you add SERVICE_URL the workflow exits quietly, so a fork that never
configures it does not send failure emails.

Two honest limits. GitHub does not run scheduled workflows more often than
every 5 minutes, and it delays them when its own queues are busy, so treat the
timing as approximate. GitHub also pauses scheduled workflows on a repository
with no activity for 60 days, and sends you an email offering to switch them
back on.

### Option B, cron-job.org

1. Go to cron-job.org and create a free account.
2. Confirm your email address and sign in.
3. Click Create cronjob.
4. Give it a title, for example Keep live announcer awake.
5. In the URL box put your address with your key on the end:

   ```
   https://yourname.onrender.com/cron?key=YOUR_CRON_SECRET
   ```

   Use the exact value you set for CRON_SECRET.

6. Under Schedule choose Every 5 minutes.
7. Leave the request method as GET.
8. Click Create, and make sure the job shows as enabled.

You can open the job later to see its history, which is a quick way to confirm
your service is answering.

To keep the secret out of the URL, some schedulers let you send a header
instead. If yours does, leave the plain address in the URL box and add a header
named x-cron-key with your secret as its value.

### Option C, UptimeRobot

UptimeRobot is a monitor rather than a scheduler, but visiting your address on a
timer is exactly what it does.

1. Go to uptimerobot.com and create a free account.
2. Click New monitor.
3. Set Monitor Type to HTTP(s).
4. Give it a friendly name.
5. In the URL box put your health address, which needs no key:

   ```
   https://yourname.onrender.com/health
   ```

6. Set Monitoring Interval to 5 minutes.
7. Click Create Monitor.

This wakes the service but does not itself run a check, which is fine, because
the service checks on its own once it is awake. Use /health here rather than
/cron so that your secret is not stored in a monitoring tool.

### Which one to pick

| Situation | Choice |
| --- | --- |
| You want the least work | Skip this step, the service handles itself |
| You want a backup and already use GitHub | Option A |
| You want a real scheduler with a run history | Option B |
| You also want to be told when your service goes down | Option C |

Adding any of these alongside the built in timers is safe. Running a check more
often than needed costs nothing, because a stream that was already announced is
simply skipped.

## 9. Editing the message

Change MESSAGE_TEMPLATE to any text you like. These placeholders are replaced
with the real values:

```
{channel}     your channel name
{title}       the stream title
{url}         the link to the stream
{videoId}     the YouTube video ID
{thumbnail}   the stream thumbnail image
{startedAt}   when the stream started
```

Examples:

```
MESSAGE_TEMPLATE=Hey everyone, {channel} just went live!\n{title}\n{url}
```

```
MESSAGE_TEMPLATE=Stream is up. Come watch {title} at {url}
```

Write \n where you want a line break, because settings files cannot hold real
line breaks. Discord formatting works too, so \*\*text\*\* makes it bold. You
can put emoji straight into the text if you want them.

To ping people, set MENTION:

```
MENTION=@everyone            pings everyone
MENTION=<@&123456789>        pings one role, using that role's ID
MENTION=                     no ping at all
```

Only the mention type you put here can ever fire, so a stream title that
contains the word everyone cannot ping your server by accident.

Set USE_EMBED to false if you want plain text with no thumbnail card.

## 10. All settings

Every setting goes in .env when running locally, or in Environment Variables on
Render. Only the first two are required.

| Setting | Default | What it does |
| --- | --- | --- |
| DISCORD_WEBHOOK_URL | none | Required. Where the message is sent. |
| YT_CHANNEL_ID | none | Required unless you set the handle. Your channel ID. |
| YT_CHANNEL_HANDLE | none | Use instead of the ID, for example @yourname. |
| YT_API_KEY | none | Optional. Makes the live check more reliable. |
| CRON_SECRET | none | Password for the protected endpoints. Without it they are switched off. |
| MESSAGE_TEMPLATE | see above | The message text. |
| MENTION | empty | Who gets pinged. |
| USE_EMBED | true | Show the thumbnail card. |
| EMBED_COLOR | 16711680 | Card colour as a number. 16711680 is red. |
| WEBHOOK_USERNAME | empty | Override the name the message is posted under. |
| WEBHOOK_AVATAR_URL | empty | Override the avatar image. |
| POLL_INTERVAL_SECONDS | 300 | How often it checks by itself. 0 turns it off. |
| SELF_URL | set by Render | Its own public address, used to stay awake. |
| KEEPALIVE_SECONDS | 600 | How often it pings itself. 0 turns it off. |
| ANNOUNCE_ON_FIRST_RUN | false | Announce a stream that was already running at startup. |
| STATE_FILE | ./data/state.json | Where announced streams are remembered. |
| PORT | 3000 | Port for the web server. Render sets this for you. |

## 11. Endpoints

```
GET  /          service name only, safe to be public
GET  /health    uptime check, safe to be public
GET  /status    what it is watching and what it announced recently
GET  /cron      run a live check now
GET  /test      post an announcement now, ignores the one per stream rule
GET  /state     the stored list of announced streams
GET  /reset     forget announced streams so they can be announced again
```

Everything except / and /health needs your key on the end:

```
https://yourname.onrender.com/test?key=YOUR_CRON_SECRET
```

You can also send the key as an x-cron-key header instead, which keeps it out
of browser history and server logs.

To confirm the whole thing works, go live for a minute and open the /test
address in your browser. It posts the message even if that stream was already
announced.

## 12. Keeping it private

The code being public is fine. Code is not a secret. What must stay private is
your webhook URL, your API key, and your CRON_SECRET, and none of those are
ever stored in the repository. They live in your .env file locally, which
.gitignore excludes, and in the Environment Variables panel on Render.

Protections already in place:

* Anyone who does not have your secret gets 401 on every endpoint that can
  post a message or reveal stored data.
* If CRON_SECRET is not set, those endpoints switch off completely rather than
  standing open.
* Ten wrong guesses from one address earns a 15 minute block, so the secret
  cannot be brute forced.
* The secret is compared in constant time, so an attacker cannot recover it by
  measuring how long the answer takes.
* The public pages show no channel name, no history, and no error details.

What you should do:

1. Use a long random CRON_SECRET. Generate one with this command:

   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. Never commit your real .env file. It is already excluded, so this happens
   only if you go out of your way to force it.
3. If you ever paste your webhook URL somewhere public, delete that webhook in
   Discord and make a new one. A leaked webhook URL lets anyone post in that
   channel, and it is the one value worth protecting most.
4. Restrict your YouTube API key in the Google console to the YouTube Data API
   so it cannot be used for anything else.

The worst case if someone did learn your secret is that they could trigger an
announcement or clear the announced list. They cannot read your Discord
messages, post anywhere except the one channel the webhook points at, or touch
your YouTube account.

## 13. Troubleshooting

**It says a configuration problem and stops immediately.**
DISCORD_WEBHOOK_URL or the channel setting is missing or misspelled. The error
message names the one it wants.

**Nothing is posted when I go live.**
Open /status with your key on the end. It shows lastCheckAt, lastResult and
lastError. If lastCheckAt is old the service is asleep or stopped. If live is
false while you are actually live, wait a minute, since YouTube can take a
short time to mark a stream public.

**It posted twice.**
This normally means the service redeployed between the two checks. Open /state
to see which streams it currently remembers.

**I get 401 unauthorized.**
The key on the end of the URL does not match CRON_SECRET. They must match
exactly.

**I get 503 and a message about CRON_SECRET.**
You have not set CRON_SECRET. Protected endpoints stay switched off until you
do, so that they are never left open to strangers.

**I get 429 too many attempts.**
Ten wrong keys came from your address, so it is blocked for 15 minutes. Wait it
out, then use the correct key.

**npm install fails.**
Check `node --version` prints v20 or higher. Older versions are missing
features this project relies on.

**The service is slow to respond the first time.**
Render free services sleep when idle and take a moment to wake. The cron ping
keeps it awake.

## 14. How it decides to send only one message

Every time it checks, it asks YouTube whether your channel is live. If it is,
it compares the video ID against a list of streams it has already announced. A
match means it stays quiet. No match means it posts and adds the ID to the
list.

Because that list is stored in a file, and free hosting wipes files when the
service redeploys, there is one extra rule. The first check after a restart
records a stream that is already running without posting about it. Without that
rule, redeploying in the middle of a stream would announce it a second time. If
you would rather it post in that situation, set ANNOUNCE_ON_FIRST_RUN to true.

Streams that are scheduled but have not started are ignored. Only a stream that
is actually live gets announced.

## License

MIT
