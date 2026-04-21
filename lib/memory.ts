import { Redis } from "@upstash/redis";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HISTORY_TTL_SECONDS = 60 * 60 * 24; // 24h
const MAX_MESSAGES = 24;

const key = (chatId: number) => `chat:${chatId}:history`;

export async function loadHistory(chatId: number): Promise<MessageParam[]> {
  const data = await redis.get<MessageParam[]>(key(chatId));
  return data ?? [];
}

export async function saveHistory(chatId: number, messages: MessageParam[]): Promise<void> {
  const trimmed = messages.slice(-MAX_MESSAGES);
  await redis.set(key(chatId), trimmed, { ex: HISTORY_TTL_SECONDS });
}

export async function clearHistory(chatId: number): Promise<void> {
  await redis.del(key(chatId));
}
