// The Orbit API, which Coming Soon's server calls for the interest count and sign-ups. On the box the web reaches it
// inside Docker's `edge` network (deploy/docker-compose.yml), as Galaxy does; locally, the API on 4000.
export const API_URL = process.env.ORBIT_API_URL ?? "http://localhost:4000";
