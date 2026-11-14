import { createPublicKey, createVerify, type JsonWebKey as NodeJwk } from "node:crypto";

// Verifies Cognito ID tokens against the pool's public keys (RS256).
// The pool is shared with Unifesto, so clientIds lists every app client
// whose ID tokens this API accepts (Orbit and the existing ones).

export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientIds: string[];
};

export type IdTokenClaims = {
  sub: string;
  email?: string;
  iss: string;
  aud: string;
  exp: number;
  token_use: "id";
};

export function cognitoIssuer(c: CognitoConfig): string {
  return `https://cognito-idp.${c.region}.amazonaws.com/${c.userPoolId}`;
}

// ponytail: JWKS is fetched on every call, no cache. Add a TTL cache when token volume matters.
export async function verifyIdToken(
  token: string,
  c: CognitoConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<IdTokenClaims> {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) throw new Error("malformed token");

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString()) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256" || !header.kid) throw new Error("unsupported token header");

  const issuer = cognitoIssuer(c);
  const res = await fetchImpl(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new Error("jwks fetch failed");
  const { keys } = (await res.json()) as { keys: (NodeJwk & { kid: string })[] };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const ok = verifier.verify(
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(signatureB64, "base64url"),
  );
  if (!ok) throw new Error("bad signature");

  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as IdTokenClaims;
  if (claims.iss !== issuer) throw new Error("bad issuer");
  if (claims.token_use !== "id") throw new Error("not an id token");
  if (!c.clientIds.includes(claims.aud)) throw new Error("audience not allowed");
  if (claims.exp * 1000 <= Date.now()) throw new Error("token expired");
  return claims;
}
