import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { isValidEmail, normalizeEmail, readCookie, sanitizeUser } from '../auth.js';
import { asyncHandler } from '../request.js';
import { isDuplicateUserError } from '../repositories/errors.js';
import {
  AIBRY_ID_STATE_COOKIE_NAME,
  buildAuthorizationUrl,
  buildExpiredStateCookie,
  buildStateCookie,
  createOidcState,
  decodeStateCookieValue,
  encodeStateCookieValue,
  exchangeAuthorizationCode,
  extractIdentityFromClaims,
  fetchDiscovery,
  sanitizeProviderError,
  verifyIdToken,
} from '../aibry-id-oidc.js';
import { jsonError } from '../responses.js';

export function createAuthRouter({ auth, config, repositories }) {
  const router = Router();
  const oidcConfig = config.aibryId || { enabled: false };
  const stateCookieSecure = !oidcConfig.devOnly;

  function aibryIdDisabled(_req, res) {
    jsonError(res, 404, 'aibry_id_disabled');
  }

  function wantsJson(req) {
    return req.query?.response_mode === 'json';
  }

  function setTransientStateCookie(res, statePayload) {
    const cookieValue = encodeStateCookieValue(statePayload, oidcConfig.stateCookieSecret);
    res.setHeader('Set-Cookie', buildStateCookie(cookieValue, { secure: stateCookieSecure }));
  }

  function clearTransientStateCookie(res, extraCookies = []) {
    const cookies = [buildExpiredStateCookie({ secure: stateCookieSecure }), ...extraCookies];
    res.setHeader('Set-Cookie', cookies);
  }

  function redirectOrJson(req, res, payload, redirectUrl) {
    if (wantsJson(req) || !redirectUrl) {
      res.json(payload);
      return;
    }
    res.redirect(redirectUrl);
  }

  function readStateCookie(req) {
    const raw = readCookie(req, AIBRY_ID_STATE_COOKIE_NAME);
    try {
      return raw ? decodeURIComponent(raw) : '';
    } catch (_err) {
      return raw;
    }
  }

  async function resolveLinkedAibryIdUser(identity) {
    let linkedIdentity = await repositories.externalIdentities?.findActive?.({
      providerIssuer: identity.issuer,
      providerSubject: identity.subject,
    });

    if (linkedIdentity || !oidcConfig.selfProvisioning || !identity.email || !identity.emailVerified) {
      return linkedIdentity;
    }

    const email = normalizeEmail(identity.email);
    if (!isValidEmail(email)) {
      return undefined;
    }

    let user = await repositories.users.findPublicByEmail?.(email);
    if (!user) {
      const passwordHash = await bcrypt.hash(randomUUID(), 12);
      user = await repositories.users.create({ id: randomUUID(), email, passwordHash });
    }

    linkedIdentity = await repositories.externalIdentities?.createLink?.({
      userId: user.id,
      providerIssuer: identity.issuer,
      providerSubject: identity.subject,
      emailAtLinkTime: email,
      emailVerifiedAtLinkTime: identity.emailVerified,
    });

    return linkedIdentity;
  }

  router.post('/register', asyncHandler(async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      if (!isValidEmail(email)) {
        jsonError(res, 400, 'A valid email is required');
        return;
      }
      if (password.length < 12 || password.length > 200) {
        jsonError(res, 400, 'Password must be at least 12 characters');
        return;
      }

      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      const row = await repositories.users.create({ id, email, passwordHash });
      const session = await auth.createSession(row, req);
      auth.setSessionCookie(res, session.token);
      res.status(201).json({
        user: sanitizeUser(row),
        token: auth.signToken(row),
        session: { expiresAt: session.expiresAt },
      });
    } catch (err) {
      if (isDuplicateUserError(err)) {
        jsonError(res, 409, 'An account already exists for that email');
        return;
      }
      throw err;
    }
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const row = isValidEmail(email)
      ? await repositories.users.findByEmailWithPassword(email)
      : null;
    const passwordOk = row ? await bcrypt.compare(password, row.passwordHash) : false;
    if (!row || !passwordOk) {
      jsonError(res, 401, 'Invalid email or password');
      return;
    }
    const session = await auth.createSession(row, req);
    auth.setSessionCookie(res, session.token);
    res.json({
      user: sanitizeUser(row),
      token: auth.signToken(row),
      session: { expiresAt: session.expiresAt },
    });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    await auth.revokeSessionToken(readCookie(req, config.sessionCookieName));
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  }));

  router.get('/aibry-id/login', asyncHandler(async (req, res) => {
    if (!oidcConfig.enabled) {
      aibryIdDisabled(req, res);
      return;
    }

    try {
      const discovery = await fetchDiscovery(oidcConfig);
      const statePayload = createOidcState();
      setTransientStateCookie(res, statePayload);

      const authorizationUrl = buildAuthorizationUrl(oidcConfig, discovery, statePayload);
      res.redirect(authorizationUrl.toString());
    } catch (err) {
      console.error('AIBRY ID login failed:', err.message);
      jsonError(res, 502, 'aibry_id_login_failed');
    }
  }));

  router.get('/aibry-id/callback', asyncHandler(async (req, res) => {
    if (!oidcConfig.enabled) {
      aibryIdDisabled(req, res);
      return;
    }

    if (req.query?.error) {
      clearTransientStateCookie(res);
      res.status(400).json(sanitizeProviderError(req.query));
      return;
    }

    const statePayload = decodeStateCookieValue(readStateCookie(req), oidcConfig.stateCookieSecret);
    const returnedState = typeof req.query?.state === 'string' ? req.query.state : '';
    const code = typeof req.query?.code === 'string' ? req.query.code : '';

    if (!statePayload || !returnedState || statePayload.state !== returnedState) {
      clearTransientStateCookie(res);
      res.status(400).json({ error: 'aibry_id_invalid_state' });
      return;
    }

    if (!code) {
      clearTransientStateCookie(res);
      res.status(400).json({ error: 'aibry_id_missing_code' });
      return;
    }

    try {
      const discovery = await fetchDiscovery(oidcConfig);
      const tokenSet = await exchangeAuthorizationCode(oidcConfig, discovery, {
        code,
        codeVerifier: statePayload.codeVerifier,
      });
      const claims = await verifyIdToken(oidcConfig, discovery, tokenSet, statePayload.nonce);
      const identity = extractIdentityFromClaims(oidcConfig, claims);
      const linkedIdentity = await resolveLinkedAibryIdUser(identity);

      if (!linkedIdentity) {
        const body = {
          error: 'aibry_id_link_required',
          code: 'aibry_id_link_required',
        };

        if (oidcConfig.devOnly) {
          body.issuer = identity.issuer;
          body.subject = identity.subject;
          if (identity.email) body.email = identity.email;
        }

        clearTransientStateCookie(res);
        if (oidcConfig.linkRequiredRedirect && !wantsJson(req)) {
          res.redirect(oidcConfig.linkRequiredRedirect);
          return;
        }
        res.status(403).json(body);
        return;
      }

      await repositories.externalIdentities.markLogin({
        providerIssuer: identity.issuer,
        providerSubject: identity.subject,
        lastLoginAt: new Date().toISOString(),
      });

      const user = await repositories.users.findPublicById(linkedIdentity.userId);
      if (!user) {
        clearTransientStateCookie(res);
        res.status(401).json({ error: 'aibry_id_user_not_found' });
        return;
      }

      const session = await auth.createSession(user, req);
      const sessionCookie = auth.buildSessionCookie
        ? auth.buildSessionCookie(session.token)
        : `${config.sessionCookieName}=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionExpiresSeconds}${config.production ? '; Secure' : ''}`;
      clearTransientStateCookie(res, [sessionCookie]);

      redirectOrJson(req, res, {
        ok: true,
        user: sanitizeUser(user),
        session: { expiresAt: session.expiresAt },
        redirect: oidcConfig.successRedirect,
      }, oidcConfig.successRedirect);
    } catch (err) {
      console.error('AIBRY ID callback failed:', err.message);
      clearTransientStateCookie(res);
      res.status(400).json({ error: 'aibry_id_callback_failed' });
    }
  }));

  router.get('/session', auth.authenticate, (req, res) => {
    res.json({
      user: sanitizeUser(req.user),
      authMode: req.authMode || 'unknown',
    });
  });

  router.get('/me', auth.authenticate, (req, res) => {
    res.json({
      user: sanitizeUser(req.user),
      authMode: req.authMode || 'unknown',
    });
  });

  return router;
}
