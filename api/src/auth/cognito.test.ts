import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyIdToken, cognitoIssuer, type CognitoConfig } from "./cognito.ts";

const config: CognitoConfig = {
  region: "ap-south-1",
  userPoolId: "ap-south-1_qdwnkCyxz",
  clientIds: ["1be6dvtj05ds5c2dajsia5v7ub"],
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "test-kid";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };

const jwksFetch = (async () =>
  new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as typeof fetch;

function sign(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", kid });
  const body = b64({
    iss: cognitoIssuer(config),
    aud: config.clientIds[0],
    token_use: "id",
    sub: "user-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(privateKey, "base64url")}`;
}

test("accepts a valid ID token from an allowed app client", async () => {
  const claims = await verifyIdToken(sign({}), config, jwksFetch);
  assert.equal(claims.sub, "user-1");
});

test("rejects a token issued to another app client", async () => {
  await assert.rejects(
    verifyIdToken(sign({ aud: "someone-else" }), config, jwksFetch),
    /audience not allowed/,
  );
});

test("rejects an expired token", async () => {
  await assert.rejects(
    verifyIdToken(sign({ exp: Math.floor(Date.now() / 1000) - 10 }), config, jwksFetch),
    /token expired/,
  );
});
