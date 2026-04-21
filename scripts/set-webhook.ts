// Registers the Telegram webhook against your deployed Vercel URL.
// Usage:
//   TELEGRAM_BOT_TOKEN=... WEBHOOK_URL=https://foodreco.vercel.app npx tsx scripts/set-webhook.ts
//
// Optional: set TELEGRAM_WEBHOOK_SECRET to append `?s=...` to the URL.

const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.WEBHOOK_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!base) {
  console.error("WEBHOOK_URL is required (e.g. https://foodreco.vercel.app)");
  process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/api/telegram${secret ? `?s=${encodeURIComponent(secret)}` : ""}`;

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  });
  const body = await res.json();
  console.log("setWebhook:", body);

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());
  console.log("getWebhookInfo:", info);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
