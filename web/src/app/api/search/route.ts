// Search suggestions for the navbar dropdown: GET /api/search?q=jam -> up to 5 events.
// Stands in for the Orbit API's search until it exists; same shape the dropdown will read from there.
import { searchEvents } from "../../discover";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return Response.json([]);

  const hits = searchEvents(q)
    .slice(0, 5)
    .map(({ slug, title, date, time, host, media }) => ({ slug, title, date, time, host, poster: media?.src ?? null }));
  return Response.json(hits);
}
