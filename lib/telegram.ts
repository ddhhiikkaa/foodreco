const TG_API = "https://api.telegram.org";

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars; split defensively.
  for (const chunk of splitForTelegram(text)) {
    const res = await fetch(`${TG_API}/bot${token()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("telegram sendMessage failed", res.status, body);
    }
  }
}

export async function sendChatAction(chatId: number, action: "typing"): Promise<void> {
  await fetch(`${TG_API}/bot${token()}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export async function sendPhoto(chatId: number, photoUrl: string, caption?: string): Promise<void> {
  const res = await fetch(`${TG_API}/bot${token()}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: caption ? "Markdown" : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("telegram sendPhoto failed", res.status, body);
  }
}

export async function sendMediaGroup(chatId: number, photoUrls: string[]): Promise<void> {
  if (!photoUrls.length) return;
  const media = photoUrls.slice(0, 10).map((url) => ({ type: "photo", media: url }));
  const res = await fetch(`${TG_API}/bot${token()}/sendMediaGroup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, media }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("telegram sendMediaGroup failed", res.status, body);
  }
}

function splitForTelegram(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) out.push(rest);
  return out;
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    text?: string;
    location?: { latitude: number; longitude: number };
  };
};
