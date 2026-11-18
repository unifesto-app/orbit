// The Orbit API, which this site's server calls for the waitlist. On the box the web reaches it inside Docker's `edge`
// network (deploy/docker-compose.yml); locally, the API on 4000.
export const API_URL = process.env.ORBIT_API_URL ?? "http://localhost:4000";
