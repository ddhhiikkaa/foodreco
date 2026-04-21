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
  price?: string;
  gps?: { latitude: number; longitude: number };
};

export type Location = { latitude: number; longitude: number };

async function mapsSearch(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ engine: "google_maps", hl: "en", api_key: key(), ...params });
  const res = await fetch(`${SERPAPI}?${qs.toString()}`);
  if (!res.ok) throw new Error(`SerpAPI request failed: ${res.status}`);
  return res.json();
}

function normalizeMatch(r: any): RestaurantMatch {
  return {
    place_id: r.place_id,
    data_id: r.data_id,
    title: r.title,
    address: r.address,
    rating: r.rating,
    reviews: r.reviews,
    type: r.type,
    price: r.price,
    gps: r.gps_coordinates,
  };
}

export async function searchRestaurant(query: string, near?: Location): Promise<RestaurantMatch[]> {
  const params: Record<string, string> = { q: query, type: "search" };
  if (near) params.ll = `@${near.latitude},${near.longitude},14z`;
  const data = await mapsSearch(params);
  const results: any[] = data.local_results ?? (data.place_results ? [data.place_results] : []);
  return results.slice(0, 5).map(normalizeMatch);
}

export async function findNearby(query: string, location: Location): Promise<RestaurantMatch[]> {
  const data = await mapsSearch({
    q: query || "restaurants",
    type: "search",
    ll: `@${location.latitude},${location.longitude},15z`,
  });
  const results: any[] = data.local_results ?? [];
  // Sort by rating desc, but prefer ones with >= 50 reviews to avoid noise.
  const scored = results
    .map(normalizeMatch)
    .filter((r) => r.rating !== undefined)
    .sort((a, b) => {
      const aScore = (a.rating ?? 0) - ((a.reviews ?? 0) < 50 ? 0.5 : 0);
      const bScore = (b.rating ?? 0) - ((b.reviews ?? 0) < 50 ? 0.5 : 0);
      return bScore - aScore;
    });
  return scored.slice(0, 8);
}

export type PlaceDetails = {
  title: string;
  rating?: number;
  reviews?: number;
  price?: string;
  address?: string;
  phone?: string;
  website?: string;
  popular_dishes?: string[];
  photos?: string[];
  hours?: string;
  service_options?: Record<string, boolean>;
};

export async function getPlaceDetails(dataId: string): Promise<PlaceDetails> {
  const data = await mapsSearch({ data_id: dataId });
  const p = data.place_results ?? data;
  const photos: string[] = [];
  for (const field of ["photos", "images", "user_uploaded_images", "featured_image"] as const) {
    const v = (p as any)[field];
    if (Array.isArray(v)) {
      for (const item of v) {
        const url = typeof item === "string" ? item : item.image ?? item.thumbnail ?? item.url;
        if (url && typeof url === "string") photos.push(url);
      }
    } else if (typeof v === "string") {
      photos.push(v);
    }
  }
  const popularDishes: string[] = [];
  const popular = (p as any).popular_dishes ?? (p as any).menu?.popular;
  if (Array.isArray(popular)) {
    for (const d of popular) {
      const name = typeof d === "string" ? d : d.name ?? d.title;
      if (name) popularDishes.push(name);
    }
  }
  return {
    title: p.title,
    rating: p.rating,
    reviews: p.reviews,
    price: p.price,
    address: p.address,
    phone: p.phone,
    website: p.website,
    popular_dishes: popularDishes.length ? popularDishes : undefined,
    photos: photos.slice(0, 5),
    hours: p.hours,
    service_options: p.service_options,
  };
}

export type Review = {
  rating?: number;
  snippet?: string;
  date?: string;
  iso_date?: string;
  user?: string;
};

export async function getReviews(dataId: string, limit = 20): Promise<Review[]> {
  const qs = new URLSearchParams({
    engine: "google_maps_reviews",
    data_id: dataId,
    api_key: key(),
    hl: "en",
    sort_by: "newestFirst",
  });
  const res = await fetch(`${SERPAPI}?${qs.toString()}`);
  if (!res.ok) throw new Error(`SerpAPI reviews failed: ${res.status}`);
  const data = (await res.json()) as any;
  const reviews: any[] = data.reviews ?? [];
  return reviews.slice(0, limit).map((r) => ({
    rating: r.rating,
    snippet: r.snippet ?? r.extracted_snippet?.original,
    date: r.date,
    iso_date: r.iso_date,
    user: r.user?.name,
  }));
}
