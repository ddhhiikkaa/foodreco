import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { searchRestaurant, getReviews } from "./serpapi.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_AGENT_STEPS = 6;

const SYSTEM_PROMPT = `You are a restaurant review analyst bot running in Telegram.

When the user names a restaurant:
1. Call search_restaurant with a clean query. If results look weak (empty, or a clearly wrong match), retry once with a corrected spelling or add a city hint.
2. If multiple plausible matches, list the top 2-3 and ask the user to clarify before fetching reviews.
3. Once you have a confident match, call get_reviews with its data_id.
4. Summarize using this exact format:

📝 *RESTAURANT SUMMARY*
Rating: [x]/5 stars
[Brief summary based on the reviews — call out positives and negatives]

🌟 *5-STAR RECOMMENDATIONS*
_Dishes highly praised in 5-star reviews:_
- [dish names pulled from reviews]

⭐ *4-STAR RECOMMENDATIONS*
_Dishes mentioned positively in 4-star reviews:_
- [dish names pulled from reviews]

🌟 *3-STAR MENTIONS*
_Dishes with mixed opinions:_
- [dish names pulled from reviews]

⚠️ *DISHES TO AVOID*
_Items with negative feedback:_
- [dish names pulled from reviews]

Rules:
- Only mention dishes that actually appear in the reviews you fetched. Never invent dishes.
- If a section has no data, write "- none mentioned".
- For follow-up questions about a restaurant already in this conversation, answer from context — do not re-fetch unless the user names a new place.
- Use Telegram Markdown (single *bold*, _italic_). Keep replies under 3500 characters.`;

const tools: Tool[] = [
  {
    name: "search_restaurant",
    description:
      "Search Google Maps for a restaurant by name (optionally with a city or neighborhood). Returns up to 5 candidate matches with their data_id, address, rating, and review count. Call this first. If the user's spelling looks wrong or results are empty, retry once with a corrected query.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Restaurant name, optionally with location (e.g. 'Taste Paradise Plaza Indonesia Jakarta').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_reviews",
    description:
      "Fetch up to 20 Google Maps reviews for a specific place. Use the data_id returned by search_restaurant.",
    input_schema: {
      type: "object",
      properties: {
        data_id: {
          type: "string",
          description: "The data_id field from a search_restaurant result.",
        },
      },
      required: ["data_id"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === "search_restaurant") {
      const results = await searchRestaurant(String(input.query));
      if (!results.length) return JSON.stringify({ results: [], note: "No matches. Consider correcting the spelling or adding a city." });
      return JSON.stringify({ results });
    }
    if (name === "get_reviews") {
      const reviews = await getReviews(String(input.data_id));
      return JSON.stringify({ reviews, count: reviews.length });
    }
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runAgent(history: MessageParam[], userText: string): Promise<{
  reply: string;
  updatedHistory: MessageParam[];
}> {
  const messages: MessageParam[] = [...history, { role: "user", content: userText }];

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "end_turn" || res.stop_reason === "stop_sequence") {
      const reply = res.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: reply || "(no reply)", updatedHistory: messages };
    }

    if (res.stop_reason === "tool_use") {
      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const toolResults = await Promise.all(
        toolUses.map(async (b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: await runTool(b.name, b.input as Record<string, unknown>),
        }))
      );
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return {
    reply: "Sorry, I got stuck processing that. Try rephrasing or send /reset.",
    updatedHistory: history,
  };
}
