import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { createOAuthGuard, protectedResourceMetadata } from '../src/auth/oauth.mjs';

const auth = {
  mode: 'oauth',
  issuer: 'https://id.example.com',
  audience: 'https://mcp.example.com',
  resource: 'https://mcp.example.com',
  jwksUri: 'https://id.example.com/oauth/v2/keys',
  scopes: ['engineering-mcp:execute'],
};

function responseCapture() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

async function signingFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'example-key';
  jwk.alg = 'RS256';
  return {
    privateKey,
    keySet: createLocalJWKSet({ keys: [jwk] }),
  };
}

async function sign(privateKey, claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'example-key' })
    .setIssuer(auth.issuer)
    .setAudience(auth.audience)
    .sign(privateKey);
}

test('protected resource metadata uses the generic configured values', () => {
  assert.deepEqual(protectedResourceMetadata(auth), {
    resource: 'https://mcp.example.com',
    authorization_servers: ['https://id.example.com'],
    scopes_supported: ['engineering-mcp:execute'],
  });
});

test('OAuth guard accepts a signed, unexpired token with every required scope', async () => {
  const { privateKey, keySet } = await signingFixture();
  const token = await sign(privateKey, {
    scope: 'engineering-mcp:execute',
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const res = responseCapture();
  const payload = await createOAuthGuard(auth, { keySet })(
    { headers: { authorization: `Bearer ${token}` } },
    res,
  );
  assert.equal(payload.iss, auth.issuer);
  assert.equal(res.status, null);
});

test('OAuth guard rejects missing expiry and missing required scope', async () => {
  const { privateKey, keySet } = await signingFixture();
  const guard = createOAuthGuard(auth, { keySet });

  const noExpiry = await sign(privateKey, { scope: 'engineering-mcp:execute' });
  const noExpiryResponse = responseCapture();
  assert.equal(await guard({ headers: { authorization: `Bearer ${noExpiry}` } }, noExpiryResponse), null);
  assert.equal(noExpiryResponse.status, 401);

  const noScope = await sign(privateKey, { exp: Math.floor(Date.now() / 1000) + 300 });
  const noScopeResponse = responseCapture();
  assert.equal(await guard({ headers: { authorization: `Bearer ${noScope}` } }, noScopeResponse), null);
  assert.equal(noScopeResponse.status, 401);
  assert.match(noScopeResponse.headers['www-authenticate'], /insufficient_scope/);
});
