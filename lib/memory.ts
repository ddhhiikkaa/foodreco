import { Redis } from "@upstash/redis";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HISTORY_TTL_SECONDS = 60 * 60 * 24; // 24h
const MAX_MESSAGES = 24;
const LOCATION_TTL_SECONDS = 60 * 15; // 15min — remembered location is "I am here right now"
const PREFS_TTL_SECONDS = 60 * 60 * 24 * 180; // 180d

const historyKey = (chatId: number) => `chat:${chatId}:history`;
const locationKey = (chatId: number) => `chat:${chatId}:location`;
const prefsKey = (chatId: number) => `chat:${chatId}:prefs`;

export async function loadHistory(chatId: number): Promise<MessageParam[]> {
  const data = await redis.get<MessageParam[]>(historyKey(chatId));
  return data ?? [];
}

export async function saveHistory(chatId: number, messages: MessageParam[]): Promise<void> {
  const trimmed = messages.slice(-MAX_MESSAGES);
  await redis.set(historyKey(chatId), trimmed, { ex: HISTORY_TTL_SECONDS });
}

export async function clearHistory(chatId: number): Promise<void> {
  await redis.del(historyKey(chatId));
}

export type Location = { latitude: number; longitude: number };

export async function saveLocation(chatId: number, loc: Location): Promise<void> {
  await redis.set(locationKey(chatId), loc, { ex: LOCATION_TTL_SECONDS });
}

export async function loadLocation(chatId: number): Promise<Location | null> {
  return (await redis.get<Location>(locationKey(chatId))) ?? null;
}

export async function clearLocation(chatId: number): Promise<void> {
  await redis.del(locationKey(chatId));
}

export async function loadPrefs(chatId: number): Promise<string | null> {
  return (await redis.get<string>(prefsKey(chatId))) ?? null;
}

export async function savePrefs(chatId: number, prefs: string): Promise<void> {
  await redis.set(prefsKey(chatId), prefs, { ex: PREFS_TTL_SECONDS });
}

export async function clearPrefs(chatId: number): Promise<void> {
  await redis.del(prefsKey(chatId));
}
