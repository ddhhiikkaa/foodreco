import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { sendMessage, sendChatAction, type TelegramUpdate } from "../lib/telegram.js";
import { loadHistory, saveHistory, clearHistory } from "../lib/memory.js";
import { runAgent } from "../lib/agent.js";

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
  const text = msg?.text?.trim();
  const chatId = msg?.chat.id;

  if (!msg || !text || !chatId) {
    res.statusCode = 200;
    res.end("ok");
    return;
  }

  // Ack Telegram immediately so we never trigger webhook retries.
  // Actual work runs in the background up to maxDuration.
  waitUntil(handleMessage(chatId, text));

  res.statusCode = 200;
  res.end("ok");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
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
