import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { sendMessage, sendChatAction, sendMediaGroup, type TelegramUpdate } from "../lib/telegram.js";
import {
  loadHistory,
  saveHistory,
  clearHistory,
  saveLocation,
  loadLocation,
  clearLocation,
  loadPrefs,
  savePrefs,
  clearPrefs,
} from "../lib/memory.js";
import { runAgent } from "../lib/agent.js";

const HELP_TEXT = `👋 *RestoReco* — Google Maps review summaries with taste.

*What you can send:*
- A restaurant name (add a city for accuracy): \`Komunal 88 Bali\`
- A follow-up question about a restaurant already discussed
- "A vs B" for a head-to-head comparison
- Your 📍 location pin, then ask "near me" or "ramen near me"

*Commands:*
/prefs [your preferences] — e.g. \`/prefs vegetarian, no seafood, medium spice\`
/prefs — show current preferences
/clearprefs — remove preferences
/reset — clear conversation memory
/help — this message`;

export default async function handler(
  req: IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> },
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = typeof req.query?.s === "string" ? req.query.s : undefined;
    if (provided !== secret) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
  }

  let update: TelegramUpdate;
  try {
    update = (req.body ?? (await readJson(req))) as TelegramUpdate;
  } catch {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }

  const msg = update.message;
  const chatId = msg?.chat.id;

  if (msg && chatId) {
    waitUntil(handleMessage(chatId, msg));
  }

  res.statusCode = 200;
  res.end("ok");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function handleMessage(
  chatId: number,
  msg: NonNullable<TelegramUpdate["message"]>
): Promise<void> {
  try {
    if (msg.location) {
      await saveLocation(chatId, msg.location);
      await sendMessage(
        chatId,
        "📍 Got your location. Tell me what you're looking for — e.g. `ramen`, `vegetarian`, or just `near me`."
      );
      return;
    }

    const text = msg.text?.trim();
    if (!text) return;

    if (text === "/start" || text === "/help") {
      await sendMessage(chatId, HELP_TEXT);
      return;
    }

    if (text === "/reset") {
      await clearHistory(chatId);
      await clearLocation(chatId);
      await sendMessage(chatId, "🧹 Cleared. Send a new restaurant name to start.");
      return;
    }

    if (text === "/clearprefs") {
      await clearPrefs(chatId);
      await sendMessage(chatId, "✅ Preferences cleared.");
      return;
    }

    if (text.startsWith("/prefs")) {
      const rest = text.slice("/prefs".length).trim();
      if (!rest) {
        const current = await loadPrefs(chatId);
        await sendMessage(
          chatId,
          current
            ? `Current preferences:\n${current}\n\nUpdate: \`/prefs your new prefs\`\nClear: /clearprefs`
            : "No preferences set. Example:\n`/prefs vegetarian, no seafood, medium spice`"
        );
      } else {
        await savePrefs(chatId, rest);
        await sendMessage(chatId, `✅ Saved preferences:\n${rest}`);
      }
      return;
    }

    await sendChatAction(chatId, "typing");

    const [history, prefs, location] = await Promise.all([
      loadHistory(chatId),
      loadPrefs(chatId),
      loadLocation(chatId),
    ]);

    const { reply, photos, updatedHistory } = await runAgent(history, text, { prefs, location });

    await saveHistory(chatId, updatedHistory);

    if (photos.length) {
      await sendMediaGroup(chatId, photos).catch((err) => console.error("sendMediaGroup failed", err));
    }
    await sendMessage(chatId, reply);
  } catch (err) {
    console.error("handleMessage error", err);
    const m = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `⚠️ Something went wrong: ${m}`).catch(() => {});
  }
}
