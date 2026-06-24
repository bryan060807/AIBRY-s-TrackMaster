import crypto from 'node:crypto';

export const AIBRY_ID_STATE_COOKIE_NAME = 'trackmaster_aibry_oidc';
const DEFAULT_STATE_TTL_SECONDS = 10 * 60;

function randomBase64Url(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function createOidcState() {
  return {
    state: randomBase64Url(32),
    nonce: randomBase64Url(32),
    codeVerifier: randomBase64Url(64),
    createdAt: Date.now(),
  };
}

function createPkceChallenge(codeVerifier) {
  if (!codeVerifier || typeof codeVerifier !== 'string') {
    throw new Error('PKCE verifier is required');
  }

  return crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
}

export function normalizeIssuer(issuer) {
  return String(issuer || '').replace(/\/+$/, '');
}

function timingSafeEqualText(first, second) {
  const firstBuffer = Buffer.from(String(first || ''), 'utf8');
  const secondBuffer = Buffer.from(String(second || ''), 'utf8');
  if (firstBuffer.length !== secondBuffer.length) return false;
  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function encodeStateCookieValue(statePayload, secret) {
  if (!secret) {
    throw new Error('AIBRY ID state cookie secret is required');
  }

  const encodedPayload = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64url');
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function decodeStateCookieValue(value, secret, options = {}) {
  if (!value || typeof value !== 'string' || !secret) return null;

  const [encodedPayload, signature, extra] = value.split('.');
  if (!encodedPayload || !signature || extra != null) return null;

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqualText(signature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (_err) {
    return null;
  }

  const ttlSeconds = options.ttlSeconds || DEFAULT_STATE_TTL_SECONDS;
  const nowMs = options.nowMs || Date.now();
  if (!payload.createdAt || nowMs - Number(payload.createdAt) > ttlSeconds * 1000) return null;
  if (!payload.state || !payload.nonce || !payload.codeVerifier) return null;

  return payload;
}

export function buildStateCookie(value, options = {}) {
  const ttlSeconds = options.ttlSeconds || DEFAULT_STATE_TTL_SECONDS;
  const sameSite = options.sameSite || 'Lax';
  const parts = [
    `${AIBRY_ID_STATE_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    `Max-Age=${ttlSeconds}`,
    'Path=/auth/aibry-id',
    `SameSite=${sameSite}`,
  ];

  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildExpiredStateCookie(options = {}) {
  const sameSite = options.sameSite || 'Lax';
  const parts = [
    `${AIBRY_ID_STATE_COOKIE_NAME}=`,
    'HttpOnly',
    'Max-Age=0',
    'Path=/auth/aibry-id',
    `SameSite=${sameSite}`,
  ];

  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export async function fetchDiscovery(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required for OIDC discovery');
  }

  const issuer = normalizeIssuer(config.issuer);
  const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) throw new Error('OIDC discovery failed');

  const discovery = await response.json();
  if (normalizeIssuer(discovery.issuer) !== issuer) throw new Error('OIDC issuer mismatch');
  if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.jwks_uri) {
    throw new Error('OIDC discovery document is incomplete');
  }

  return discovery;
}

export function buildAuthorizationUrl(config, discovery, statePayload) {
  const authorizationUrl = new URL(discovery.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('scope', config.scopes);
  authorizationUrl.searchParams.set('state', statePayload.state);
  authorizationUrl.searchParams.set('nonce', statePayload.nonce);
  authorizationUrl.searchParams.set('code_challenge', createPkceChallenge(statePayload.codeVerifier));
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  return authorizationUrl;
}

export async function exchangeAuthorizationCode(config, discovery, input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', config.clientId);
  body.set('code', input.code);
  body.set('redirect_uri', config.redirectUri);
  body.set('code_verifier', input.codeVerifier);

  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('OIDC token exchange failed');
  if (!payload.id_token) throw new Error('OIDC token response missing id_token');

  return payload;
}

export async function verifyIdToken(config, discovery, tokenSet, expectedNonce, options = {}) {
  if (options.verifyIdTokenImpl) {
    return options.verifyIdTokenImpl(config, discovery, tokenSet, expectedNonce);
  }

  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const result = await jwtVerify(tokenSet.id_token, jwks, {
    issuer: normalizeIssuer(config.issuer),
    audience: config.clientId,
  });

  if (result.payload.nonce !== expectedNonce) {
    throw new Error('OIDC nonce mismatch');
  }

  return result.payload;
}

export function sanitizeProviderError(query) {
  return {
    error: 'aibry_id_provider_error',
    providerError: query.error ? String(query.error).slice(0, 80) : 'unknown',
  };
}

export function extractIdentityFromClaims(config, claims) {
  if (!claims || !claims.sub) throw new Error('OIDC subject missing');

  return {
    issuer: normalizeIssuer(claims.iss || config.issuer),
    subject: String(claims.sub),
    email: claims.email ? String(claims.email) : undefined,
    emailVerified: claims.email_verified === true,
  };
}
