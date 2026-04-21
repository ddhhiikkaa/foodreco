import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { searchRestaurant, findNearby, getReviews, getPlaceDetails } from "./serpapi.js";
import type { Location } from "./memory.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_AGENT_STEPS = 8;

const BASE_PROMPT = `You are a restaurant review analyst bot running in Telegram. You help users decide where and what to eat.

Tools at your disposal:
- search_restaurant(query, [near]) — Google Maps search. Use first. If results are weak, retry once with corrected spelling or a city hint.
- find_nearby(query, latitude, longitude) — ranked list of good restaurants near a coordinate. Use when the user shares a location pin or asks "near me".
- get_place_details(data_id) — photos, popular dishes, price level, hours, phone. Call this after picking a restaurant, to enrich your summary.
- get_reviews(data_id) — up to 20 recent Google Maps reviews with dates.

Response format for a full restaurant summary:

📝 *RESTAURANT SUMMARY*
Rating: [x]/5 stars  ·  Price: [$/$$/$$$ if known]  ·  Typical spend: [rough per-person estimate if reviews mention prices]
[2-3 sentence vibe — positives, negatives, standout points. Weight recent reviews more heavily than old ones; if quality has shifted, call it out.]

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
- Only mention dishes that actually appear in the reviews or popular_dishes you fetched. Never invent dishes.
- If a section has no data, write "- none mentioned".
- Prefer recent reviews (past ~12 months) when summarizing vibe. If older and newer reviews disagree, note the trend.
- If reviews mention prices (IDR, Rp, $, local currency), give a rough per-person estimate.
- For comparison requests ("A vs B"), call search_restaurant + get_reviews for BOTH, then give a head-to-head: vibe, price, best-ordered dishes at each, who should pick which.
- For follow-up questions about a restaurant already discussed, answer from context — don't re-fetch unless the user names a new place.
- For "near me" / location-based requests, use find_nearby, pick the 2-3 most promising, and give a short ranked list. The user can then ask for a deep-dive on any.
- Use Telegram Markdown (single *bold*, _italic_). Keep replies under 3500 characters.
`;

const tools: Tool[] = [
  {
    name: "search_restaurant",
    description:
      "Search Google Maps for a restaurant by name (optionally with city). Returns up to 5 candidate matches with data_id, address, rating, price, review count.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Restaurant name, optionally with location." },
      },
      required: ["query"],
    },
  },
  {
    name: "find_nearby",
    description:
      "Find the best-rated restaurants near a coordinate. Returns up to 8 candidates ranked by rating and review volume.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What the user wants (e.g. 'ramen', 'vegetarian', 'coffee'). Use 'restaurants' if unspecified.",
        },
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["query", "latitude", "longitude"],
    },
  },
  {
    name: "get_place_details",
    description:
      "Fetch photos, popular dishes, price, phone, hours for a specific place. Use the data_id from a search result.",
    input_schema: {
      type: "object",
      properties: {
        data_id: { type: "string" },
      },
      required: ["data_id"],
    },
  },
  {
    name: "get_reviews",
    description: "Fetch up to 20 recent Google Maps reviews for a specific place. Use the data_id from a search result.",
    input_schema: {
      type: "object",
      properties: {
        data_id: { type: "string" },
      },
      required: ["data_id"],
    },
  },
];

type ToolRunContext = { photos: Set<string> };

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolRunContext): Promise<string> {
  try {
    if (name === "search_restaurant") {
      const results = await searchRestaurant(String(input.query));
      if (!results.length)
        return JSON.stringify({ results: [], note: "No matches. Consider correcting the spelling or adding a city." });
      return JSON.stringify({ results });
    }
    if (name === "find_nearby") {
      const results = await findNearby(String(input.query), {
        latitude: Number(input.latitude),
        longitude: Number(input.longitude),
      });
      if (!results.length) return JSON.stringify({ results: [], note: "No results near that location." });
      return JSON.stringify({ results });
    }
    if (name === "get_place_details") {
      const details = await getPlaceDetails(String(input.data_id));
      for (const p of details.photos ?? []) ctx.photos.add(p);
      return JSON.stringify(details);
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

export type AgentContext = {
  location?: Location | null;
  prefs?: string | null;
};

export type AgentResult = {
  reply: string;
  photos: string[];
  updatedHistory: MessageParam[];
};

export async function runAgent(
  history: MessageParam[],
  userText: string,
  context: AgentContext = {}
): Promise<AgentResult> {
  const systemParts = [BASE_PROMPT];
  if (context.prefs) {
    systemParts.push(
      `User dietary preferences (always factor these in, warn if a dish violates them): ${context.prefs}`
    );
  }
  if (context.location) {
    systemParts.push(
      `User's current location: lat=${context.location.latitude}, lng=${context.location.longitude}. Use this for "near me" queries without asking.`
    );
  }
  const system = systemParts.join("\n\n");

  const messages: MessageParam[] = [...history, { role: "user", content: userText }];
  const ctx: ToolRunContext = { photos: new Set() };

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
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
      return {
        reply: reply || "(no reply)",
        photos: [...ctx.photos].slice(0, 3),
        updatedHistory: messages,
      };
    }

    if (res.stop_reason === "tool_use") {
      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const toolResults = await Promise.all(
        toolUses.map(async (b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: await runTool(b.name, b.input as Record<string, unknown>, ctx),
        }))
      );
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return {
    reply: "Sorry, I got stuck processing that. Try rephrasing or send /reset.",
    photos: [],
    updatedHistory: history,
  };
}
