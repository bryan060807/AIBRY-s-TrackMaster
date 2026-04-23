import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { clientKey } from './request.js';
import { jsonError } from './responses.js';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function sanitizeUser(row) {
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}

function isoNow() {
  return new Date().toISOString();
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(req, name) {
  const header = String(req.header('Cookie') || '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_err) {
      return '';
    }
  }
  return '';
}

export function createAuth({ config, repositories }) {
  function signToken(user) {
    return jwt.sign({ sub: user.id, email: user.email }, config.effectiveJwtSecret, {
      expiresIn: config.jwtExpiresIn,
      issuer: 'trackmaster-api',
      audience: 'trackmaster-web',
    });
  }

  function buildSessionCookie(value, options = {}) {
    const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : config.sessionExpiresSeconds;
    const parts = [
      `${config.sessionCookieName}=${encodeURIComponent(value)}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
    ];
    if (options.expires) parts.push(`Expires=${options.expires}`);
    if (config.production) parts.push('Secure');
    return parts.join('; ');
  }

  function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', buildSessionCookie(token));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', buildSessionCookie('', {
      maxAge: 0,
      expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
    }));
  }

  async function pruneExpiredSessions() {
    await repositories.sessions.deleteExpired(isoNow());
  }

  async function createSession(user, req) {
    await pruneExpiredSessions();

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionExpiresSeconds * 1000).toISOString();
    await repositories.sessions.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      userAgent: String(req.header('User-Agent') || '').slice(0, 300),
      clientKey: clientKey(req).slice(0, 120),
      expiresAt,
    });

    return { token, expiresAt };
  }

  async function sessionUserForToken(token) {
    if (!token) return null;
    return repositories.sessions.findActiveUserByTokenHash(hashSessionToken(token), isoNow());
  }

  async function revokeSessionToken(token) {
    if (!token) return;
    await repositories.sessions.revokeByTokenHash(hashSessionToken(token), isoNow());
  }

  function verifyBearerToken(token) {
    try {
      return jwt.verify(token, config.effectiveJwtSecret, {
        issuer: 'trackmaster-api',
        audience: 'trackmaster-web',
      });
    } catch (_err) {
      return null;
    }
  }

  async function authenticate(req, res, next) {
    try {
      const sessionToken = readCookie(req, config.sessionCookieName);
      const sessionUser = await sessionUserForToken(sessionToken);
      if (sessionUser) {
        req.user = sessionUser;
        req.sessionId = sessionUser.sessionId;
        req.authMode = 'cookie-session';
        next();
        return;
      }
      if (sessionToken) {
        clearSessionCookie(res);
      }

      const header = req.header('Authorization') || '';
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        jsonError(res, 401, 'Authentication required');
        return;
      }

      const payload = verifyBearerToken(match[1]);
      if (!payload) {
        jsonError(res, 401, 'Invalid or expired session');
        return;
      }

      const userId = typeof payload.sub === 'string' ? payload.sub : '';
      const user = userId ? await repositories.users.findPublicById(userId) : null;
      if (!user) {
        jsonError(res, 401, 'Invalid session');
        return;
      }
      req.user = user;
      req.authMode = 'jwt-bearer';
      next();
    } catch (err) {
      next(err);
    }
  }

  return {
    authenticate,
    clearSessionCookie,
    createSession,
    revokeSessionToken,
    setSessionCookie,
    signToken,
  };
}
