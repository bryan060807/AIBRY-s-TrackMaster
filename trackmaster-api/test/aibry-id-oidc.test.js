import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAuthorizationUrl,
  buildExpiredStateCookie,
  buildStateCookie,
  createOidcState,
  decodeStateCookieValue,
  encodeStateCookieValue,
} from '../src/aibry-id-oidc.js';

const TEST_SECRET = 'trackmaster-test-secret-32-characters';

test('AIBRY ID state cookie uses the browser auth path and production-safe attributes', () => {
  const state = createOidcState();
  const encoded = encodeStateCookieValue(state, TEST_SECRET);
  const cookie = buildStateCookie(encoded, { secure: true });

  assert.match(cookie, /^trackmaster_aibry_oidc=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/auth\/aibry-id/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(decodeStateCookieValue(encoded, TEST_SECRET), state);
});

test('AIBRY ID expired state cookie clears the same browser auth path', () => {
  const cookie = buildExpiredStateCookie({ secure: true });

  assert.match(cookie, /^trackmaster_aibry_oidc=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Path=\/auth\/aibry-id/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test('AIBRY ID authorization URL uses PKCE and the configured app-origin callback', () => {
  const state = createOidcState();
  const authorizationUrl = buildAuthorizationUrl(
    {
      clientId: 'trackmaster-public-web',
      redirectUri: 'https://trackmaster.aibry.shop/auth/aibry-id/callback',
      scopes: 'openid profile email',
    },
    {
      authorization_endpoint: 'https://id.aibry.shop/oauth2/authorize',
    },
    state
  );

  assert.equal(authorizationUrl.origin, 'https://id.aibry.shop');
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'trackmaster-public-web');
  assert.equal(
    authorizationUrl.searchParams.get('redirect_uri'),
    'https://trackmaster.aibry.shop/auth/aibry-id/callback'
  );
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid profile email');
  assert.equal(authorizationUrl.searchParams.get('state'), state.state);
  assert.equal(authorizationUrl.searchParams.get('nonce'), state.nonce);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
});
