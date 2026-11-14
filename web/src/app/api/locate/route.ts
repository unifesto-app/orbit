// GET /api/locate?lat=17.562&lng=78.454 -> { area, sub, city } from Google's Geocoding API.
// Google names Indian neighbourhoods (Maisammaguda) where free services stop at the mandal (Medchal).
// Needs GOOGLE_MAPS_API_KEY (server only, in web.env): Geocoding API enabled, a daily quota cap set,
// and the key restricted to the calling machine's IP (website-restricted keys are refused for this API).
// Without it this answers 501 and the browser falls back.
// No server-side cache: Google's terms don't allow storing their place names.
import { placeFromGoogle } from "../../google-place";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Blank counts as missing: Number("") is 0, a real point in the ocean.
  const num = (v: string | null) => (v?.trim() ? Number(v) : NaN);
  const lat = num(params.get("lat"));
  const lng = num(params.get("lng"));
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return Response.json({ error: "bad coordinates" }, { status: 400 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return Response.json({ error: "not configured" }, { status: 501 });

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat.toFixed(3)},${lng.toFixed(3)}`); // about 100 m: enough to name the area
  url.searchParams.set("language", "en");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  const data: { status: string; error_message?: string; results?: Parameters<typeof placeFromGoogle>[0] } = res.ok
    ? await res.json()
    : { status: `HTTP ${res.status}` };
  if (data.status !== "OK" || !data.results) {
    // Google's reason (key restrictions, API not enabled, billing) goes to the server log, not the visitor.
    if (data.status !== "ZERO_RESULTS") console.warn(`/api/locate: Google ${data.status}: ${data.error_message ?? ""}`);
    return Response.json({ error: data.status }, { status: 502 });
  }

  const place = placeFromGoogle(data.results);
  return place ? Response.json(place) : Response.json({ error: "no place name" }, { status: 404 });
}
