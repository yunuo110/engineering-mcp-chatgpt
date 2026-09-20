import { createRemoteJWKSet, jwtVerify } from 'jose';

function challenge(auth) {
  const metadata = new URL('/.well-known/oauth-protected-resource', auth.resource).toString();
  return `Bearer resource_metadata="${metadata}", scope="${auth.scopes.join(' ')}"`;
}

function reject(res, auth, code = 'invalid_token') {
  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'www-authenticate': `${challenge(auth)}, error="${code}"`,
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function tokenFromRequest(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  return match?.[1] ?? null;
}

function tokenScopes(payload) {
  if (typeof payload.scope === 'string') return payload.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(payload.scp) && payload.scp.every((value) => typeof value === 'string')) return payload.scp;
  return [];
}

export function protectedResourceMetadata(auth) {
  return {
    resource: auth.resource,
    authorization_servers: [auth.issuer],
    scopes_supported: auth.scopes,
  };
}

export function createOAuthGuard(auth, options = {}) {
  if (auth.mode !== 'oauth') throw new Error('OAUTH_CONFIG_REQUIRED');
  const keys = options.keySet ?? createRemoteJWKSet(new URL(auth.jwksUri));

  return async function authenticate(req, res) {
    const token = tokenFromRequest(req);
    if (!token) {
      reject(res, auth);
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: auth.issuer,
        audience: auth.audience,
      });
      if (!Number.isInteger(payload.exp)) throw new Error('TOKEN_EXPIRY_REQUIRED');
      const actualScopes = new Set(tokenScopes(payload));
      if (auth.scopes.some((scope) => !actualScopes.has(scope))) {
        reject(res, auth, 'insufficient_scope');
        return null;
      }
      return payload;
    } catch {
      reject(res, auth);
      return null;
    }
  };
}

export function oauthChallenge(auth) {
  return challenge(auth);
}
