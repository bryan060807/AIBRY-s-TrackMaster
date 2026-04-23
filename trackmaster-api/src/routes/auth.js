import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { isValidEmail, normalizeEmail, readCookie, sanitizeUser } from '../auth.js';
import { asyncHandler } from '../request.js';
import { isDuplicateUserError } from '../repositories/errors.js';
import { jsonError } from '../responses.js';

export function createAuthRouter({ auth, config, repositories }) {
  const router = Router();

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
