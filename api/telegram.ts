import { waitUntil } from "@vercel/functions";
import { sendMessage, sendChatAction, type TelegramUpdate } from "../lib/telegram.js";
import { loadHistory, saveHistory, clearHistory } from "../lib/memory.js";
import { runAgent } from "../lib/agent.js";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const url = new URL(req.url);
    if (url.searchParams.get("s") !== secret) {
      return new Response("forbidden", { status: 403 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const msg = update.message;
  const text = msg?.text?.trim();
  const chatId = msg?.chat.id;

  if (!msg || !text || !chatId) {
    return new Response("ok", { status: 200 });
  }

  // Ack Telegram immediately so we never trigger webhook retries.
  // Actual work happens in the background.
  waitUntil(handleMessage(chatId, text));

  return new Response("ok", { status: 200 });
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  try {
    if (text === "/start") {
      await sendMessage(
        chatId,
        "👋 Send me a restaurant name and I'll summarize Google Maps reviews for you.\n\nExamples:\n- `Taste Paradise Plaza Indonesia`\n- `Komunal 88 Bali`\n\nYou can also ask follow-up questions. Send /reset to start a new conversation."
      );
      return;
    }

    if (text === "/reset") {
      await clearHistory(chatId);
      await sendMessage(chatId, "🧹 Cleared. Send a new restaurant name to start.");
      return;
    }

    await sendChatAction(chatId, "typing");

    const history = await loadHistory(chatId);
    const { reply, updatedHistory } = await runAgent(history, text);

    await saveHistory(chatId, updatedHistory);
    await sendMessage(chatId, reply);
  } catch (err) {
    console.error("handleMessage error", err);
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `⚠️ Something went wrong: ${msg}`).catch(() => {});
  }
}
