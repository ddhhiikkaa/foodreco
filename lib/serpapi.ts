const SERPAPI = "https://serpapi.com/search.json";

function key() {
  const k = process.env.SERPAPI_KEY;
  if (!k) throw new Error("SERPAPI_KEY is not set");
  return k;
}

export type RestaurantMatch = {
  place_id: string;
  data_id?: string;
  title: string;
  address?: string;
  rating?: number;
  reviews?: number;
  type?: string;
  gps?: { latitude: number; longitude: number };
};

export async function searchRestaurant(query: string): Promise<RestaurantMatch[]> {
  const url = `${SERPAPI}?engine=google_maps&type=search&q=${encodeURIComponent(query)}&api_key=${key()}&hl=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI search failed: ${res.status}`);
  const data = (await res.json()) as any;

  const results: any[] = data.local_results ?? (data.place_results ? [data.place_results] : []);
  return results.slice(0, 5).map((r) => ({
    place_id: r.place_id,
    data_id: r.data_id,
    title: r.title,
    address: r.address,
    rating: r.rating,
    reviews: r.reviews,
    type: r.type,
    gps: r.gps_coordinates,
  }));
}

export type Review = {
  rating?: number;
  snippet?: string;
  date?: string;
  user?: string;
};

export async function getReviews(dataId: string, limit = 20): Promise<Review[]> {
  const url = `${SERPAPI}?engine=google_maps_reviews&data_id=${encodeURIComponent(dataId)}&api_key=${key()}&hl=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI reviews failed: ${res.status}`);
  const data = (await res.json()) as any;
  const reviews: any[] = data.reviews ?? [];
  return reviews.slice(0, limit).map((r) => ({
    rating: r.rating,
    snippet: r.snippet ?? r.extracted_snippet?.original,
    date: r.date,
    user: r.user?.name,
  }));
}
