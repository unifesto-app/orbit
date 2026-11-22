// The Orbit network on the map of India (owner, 22 Nov 2026: "mention the launch network or availablity network on
// india map"): cities at their real places, the city list's popular ones (contract popularCities) as hubs joined by
// brighter arcs, the rest joined to their nearest neighbours. No outline of India is drawn: a map of India published here
// must show the Survey of India's boundary, and the common free outlines don't, so the cities alone trace the country
// until that outline is added.

// [name, latitude, longitude, hub]
const CITIES: [string, number, number, boolean?][] = [
  ["Delhi", 28.61, 77.21, true],
  ["Mumbai", 19.08, 72.88, true],
  ["Bengaluru", 12.97, 77.59, true],
  ["Hyderabad", 17.39, 78.49, true],
  ["Chennai", 13.08, 80.27, true],
  ["Kolkata", 22.57, 88.36, true],
  ["Ahmedabad", 23.02, 72.57, true],
  ["Pune", 18.52, 73.86, true],
  ["Surat", 21.17, 72.83, true],
  ["Jaipur", 26.91, 75.79, true],
  ["Lucknow", 26.85, 80.95, true],
  ["Kanpur", 26.45, 80.33, true],
  ["Leh", 34.15, 77.58],
  ["Srinagar", 34.08, 74.8],
  ["Amritsar", 31.63, 74.87],
  ["Chandigarh", 30.73, 76.78],
  ["Dehradun", 30.32, 78.03],
  ["Jodhpur", 26.24, 73.02],
  ["Udaipur", 24.59, 73.71],
  ["Indore", 22.72, 75.86],
  ["Bhopal", 23.26, 77.41],
  ["Varanasi", 25.32, 82.97],
  ["Patna", 25.59, 85.14],
  ["Ranchi", 23.34, 85.31],
  ["Gangtok", 27.33, 88.61],
  ["Guwahati", 26.14, 91.74],
  ["Shillong", 25.58, 91.89],
  ["Imphal", 24.82, 93.94],
  ["Agartala", 23.83, 91.29],
  ["Bhubaneswar", 20.3, 85.82],
  ["Raipur", 21.25, 81.63],
  ["Nagpur", 21.15, 79.09],
  ["Visakhapatnam", 17.69, 83.22],
  ["Vijayawada", 16.51, 80.65],
  ["Panaji", 15.49, 73.83],
  ["Mangaluru", 12.91, 74.86],
  ["Coimbatore", 11.02, 76.96],
  ["Madurai", 9.93, 78.12],
  ["Kochi", 9.93, 76.27],
  ["Thiruvananthapuram", 8.52, 76.94],
];

// Where each hub's name sits: beside its dot on the side with room. Kanpur and Surat stay unnamed, too near Lucknow and
// Mumbai to fit.
const LABEL: Record<string, "left" | "right" | "none"> = {
  Mumbai: "left",
  Ahmedabad: "left",
  Pune: "right",
  Surat: "none",
  Kanpur: "none",
  Jaipur: "left",
  Bengaluru: "left",
};

// Longitude and latitude to the drawing: equirectangular, widths shrunk by the cosine of India's middle latitude.
const K = 20;
const place = (lat: number, lon: number) => ({ x: 40 + (lon - 68) * K * Math.cos((22 * Math.PI) / 180), y: 10 + (37.5 - lat) * K });

const points = CITIES.map(([name, lat, lon, hub]) => ({ name, hub: !!hub, ...place(lat, lon) }));
const far = (a: (typeof points)[number], b: (typeof points)[number]) => Math.hypot(a.x - b.x, a.y - b.y);

// Each point joined to its `n` nearest among `pool`, each pair once.
function joins(from: typeof points, pool: typeof points, n: number) {
  const seen = new Set<string>();
  const out: [(typeof points)[number], (typeof points)[number]][] = [];
  for (const a of from) {
    for (const b of pool.filter((p) => p !== a).sort((p, q) => far(a, p) - far(a, q)).slice(0, n)) {
      const key = [a.name, b.name].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

const hubs = points.filter((p) => p.hub);
const backbone = joins(hubs, hubs, 2);
const local = joins(points, points, 2);

// A gentle arc between two points, bowed to one side by a sixth of its length, so the joins read as orbits.
const arc = ([a, b]: [(typeof points)[number], (typeof points)[number]]) => {
  const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx - dy / 6).toFixed(1)} ${(my + dx / 6).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

export function Network({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 610" className={className} role="img" aria-label={`The Orbit network across India: ${hubs.map((h) => h.name).join(", ")} and more cities`}>
      <g fill="none" stroke="var(--orbit-text)" strokeOpacity={0.14} strokeWidth={1}>
        {local.map((j) => (
          <path key={j.map((p) => p.name).join()} d={arc(j)} />
        ))}
      </g>
      <g fill="none" stroke="var(--orbit-accent)" strokeOpacity={0.6} strokeWidth={1.5}>
        {backbone.map((j) => (
          <path key={j.map((p) => p.name).join()} d={arc(j)} />
        ))}
      </g>
      {points
        .filter((p) => !p.hub)
        .map((p) => (
          <circle key={p.name} cx={p.x} cy={p.y} r={2.5} fill="var(--orbit-text)" fillOpacity={0.5} />
        ))}
      {hubs.map((p) => {
        const side = LABEL[p.name] ?? "right";
        return (
          <g key={p.name}>
            <circle cx={p.x} cy={p.y} r={11} fill="var(--orbit-accent)" fillOpacity={0.16} />
            <circle cx={p.x} cy={p.y} r={4.5} fill="var(--orbit-accent)" />
            {side !== "none" && (
              <text x={p.x + (side === "left" ? -15 : 15)} y={p.y + 4} textAnchor={side === "left" ? "end" : "start"} fill="var(--orbit-text)" fillOpacity={0.85} fontSize={16}>
                {p.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
