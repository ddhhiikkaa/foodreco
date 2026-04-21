# foodreco

Telegram restaurant review bot. Send a restaurant name, get back a summary of Google Maps reviews (recommended dishes, things to avoid) from a Claude-powered agent. Follow-up questions supported.

Replaces an n8n workflow. Runs on Vercel Hobby (free) + Upstash Redis free tier.

## Stack

- Vercel serverless function (`api/telegram.ts`) as the Telegram webhook
- Claude Sonnet 4.6 via `@anthropic-ai/sdk` with tool use for the agent loop
- SerpAPI Google Maps engines for search + reviews
- Upstash Redis for per-chat conversation memory (24h TTL)

## Setup

### 1. Install

```bash
npm install
```

### 2. Create Upstash Redis

1. https://upstash.com → sign up → Create Database → Redis → free tier
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 3. Local env

```bash
cp .env.example .env.local
# fill in the values
```

Required:
- `TELEGRAM_BOT_TOKEN` — from BotFather (reuse your existing n8n bot token)
- `SERPAPI_KEY` — https://serpapi.com
- `ANTHROPIC_API_KEY` — https://console.anthropic.com
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional:
- `TELEGRAM_WEBHOOK_SECRET` — random string. If set, the webhook URL gains `?s=<secret>` and requests without it are rejected.

### 4. Deploy

```bash
npx vercel link      # first time only
npx vercel --prod
```

Then add the same env vars in the Vercel dashboard (Project → Settings → Environment Variables) so the deployed function can read them.

### 5. Register the webhook

Once deployed, tell Telegram where to send updates:

```bash
TELEGRAM_BOT_TOKEN=xxx \
WEBHOOK_URL=https://your-deployment.vercel.app \
TELEGRAM_WEBHOOK_SECRET=optional-secret \
npm run set-webhook
```

Verify in the output that `ok: true` and `url` points to your deployment.

### 6. Use it

Open Telegram, find your bot, try:

- `Taste Paradise Plaza Indonesia`
- `What about vegetarian options there?` (follow-up)
- `/reset` to clear the conversation
- `/start` for help

## Local development

```bash
npm run dev  # starts `vercel dev`
```

For Telegram to reach your local machine, expose it with something like `ngrok http 3000` and set the webhook to the ngrok URL. In practice it's easier to just deploy previews with `vercel` and test those.

## Notes

- `api/telegram.ts` acknowledges Telegram's webhook POST immediately and does the SerpAPI + Claude work in `waitUntil(...)`. This keeps the request fast (Telegram retries if it doesn't get a 200 within ~30s) and lets the background work run up to the function's `maxDuration` (60s on Fluid Compute, default on new Hobby projects).
- Conversation history is capped at 24 messages per chat with a 24h TTL. Send `/reset` to clear.
- The bot is public by default. Add a `ALLOWED_CHAT_IDS` check in `handleMessage` if you want to restrict it later.
