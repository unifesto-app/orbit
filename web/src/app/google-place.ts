// Turns Google Geocoding results into the navbar's place name, most specific first:
// "Maisammaguda, Bahadurpally, Hyderabad" -> { area: Maisammaguda, sub: Bahadurpally, city: Hyderabad }.
export type Place = { area: string; sub: string; city: string };

type GoogleResult = { address_components: { long_name: string; types: string[] }[] };

// Results come most specific first, so the first component of a type is the closest one.
function pick(results: GoogleResult[], type: string): string {
  for (const r of results) for (const c of r.address_components) if (c.types.includes(type)) return c.long_name;
  return "";
}

export function placeFromGoogle(results: GoogleResult[]): Place | null {
  const city = pick(results, "locality") || pick(results, "administrative_area_level_2");
  const area = pick(results, "sublocality_level_2") || pick(results, "neighborhood") || pick(results, "sublocality_level_1") || city;
  if (!area) return null;
  const sub = pick(results, "sublocality_level_1");
  // Never repeat a name: "Hyderabad, Hyderabad" reads as a bug.
  return { area, sub: sub !== area && sub !== city ? sub : "", city: city !== area ? city : "" };
}
