import express from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const port = Number.parseInt(process.env.PORT || '3004', 10);
const host = process.env.TRACKMASTER_HOST || '127.0.0.1';
const dataDir = path.resolve(projectRoot, process.env.TRACKMASTER_DATA_DIR || './data');
const uploadLimit = process.env.TRACKMASTER_UPLOAD_LIMIT || '120mb';
const corsOrigin = process.env.CORS_ORIGIN || '';
const jwtSecret = process.env.TRACKMASTER_JWT_SECRET || '';
const jwtExpiresIn = process.env.TRACKMASTER_JWT_EXPIRES_IN || '12h';
const production = process.env.NODE_ENV === 'production';
const legacyUserId = 'legacy-local-user';
const dbPath = path.join(dataDir, 'trackmaster.sqlite');
const uploadsDir = path.join(dataDir, 'uploads');

if (!jwtSecret && production) {
  throw new Error('TRACKMASTER_JWT_SECRET is required in production.');
}
if (jwtSecret && production && jwtSecret.length < 32) {
  throw new Error('TRACKMASTER_JWT_SECRET must be at least 32 characters in production.');
}

const effectiveJwtSecret = jwtSecret || 'trackmaster-local-dev-secret-change-me';
if (!jwtSecret) {
  console.warn('TRACKMASTER_JWT_SECRET is not set; using development-only local fallback.');
}

fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'mastered',
    duration_seconds REAL,
    size_bytes INTEGER,
    format TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    eq_low REAL NOT NULL,
    eq_mid REAL NOT NULL,
    eq_high REAL NOT NULL,
    comp_threshold REAL NOT NULL,
    comp_ratio REAL NOT NULL,
    makeup_gain REAL NOT NULL,
    delay_time REAL NOT NULL,
    delay_feedback REAL NOT NULL,
    delay_mix REAL NOT NULL,
    reverb_decay REAL NOT NULL,
    reverb_mix REAL NOT NULL,
    saturation_drive REAL NOT NULL,
    saturation_mix REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('tracks', 'user_id', 'TEXT');
ensureColumn('presets', 'user_id', 'TEXT');
db.prepare('UPDATE tracks SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
db.prepare('UPDATE presets SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
  legacyUserId,
  'legacy@trackmaster.local',
  bcrypt.hashSync(randomUUID(), 12)
);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

function clientKey(req) {
  const cloudflareIp = String(req.header('CF-Connecting-IP') || '').trim();
  if (cloudflareIp && isIP(cloudflareIp)) return `cf:${ipKeyGenerator(cloudflareIp)}`;

  const forwardedFor = String(req.header('X-Forwarded-For') || '').split(',')[0].trim();
  if (forwardedFor && isIP(forwardedFor)) return `xff:${ipKeyGenerator(forwardedFor)}`;

  const fallbackIp = req.ip || req.socket.remoteAddress || '';
  return isIP(fallbackIp) ? `ip:${ipKeyGenerator(fallbackIp)}` : 'ip:unknown';
}

const apiLimiter = rateLimit({
  windowMs: Number.parseInt(process.env.TRACKMASTER_API_RATE_WINDOW_MS || '60000', 10),
  limit: Number.parseInt(process.env.TRACKMASTER_API_RATE_LIMIT || '240', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
});

const authLimiter = rateLimit({
  windowMs: Number.parseInt(process.env.TRACKMASTER_AUTH_RATE_WINDOW_MS || '900000', 10),
  limit: Number.parseInt(process.env.TRACKMASTER_AUTH_RATE_LIMIT || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
});

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (production) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

if (corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name, X-Format, X-Duration-Seconds');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth', express.json({ limit: '16kb' }));
app.use('/api/presets', authenticate, express.json({ limit: '128kb' }));
app.use('/api/tracks', authenticate, express.raw({
  type: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3'],
  limit: uploadLimit,
}));

function jsonError(res, status, message) {
  res.status(status).json({ error: message });
}

function safeBaseName(value) {
  const base = path.basename(String(value || 'track')).replace(/\.[^/.]+$/, '');
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
  return safe || 'track';
}

function safeFormat(value) {
  const format = String(value || '').toLowerCase();
  if (format === 'wav' || format === 'mp3') return format;
  return '';
}

function storagePathFor(userId, id, fileName, format) {
  const date = new Date();
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const basename = safeBaseName(fileName);
  const userFolder = safeBaseName(userId);
  const relative = path.join(userFolder, yyyy, mm, `${id}_${basename}.${format}`);
  const absolute = path.join(uploadsDir, relative);
  const normalizedUploads = `${path.resolve(uploadsDir)}${path.sep}`;
  const normalizedAbsolute = path.resolve(absolute);
  if (!normalizedAbsolute.startsWith(normalizedUploads)) {
    throw new Error('Unsafe storage path');
  }
  return { relative, absolute };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function sanitizeUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, effectiveJwtSecret, {
    expiresIn: jwtExpiresIn,
    issuer: 'trackmaster-api',
    audience: 'trackmaster-web',
  });
}

function authenticate(req, res, next) {
  const header = req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    jsonError(res, 401, 'Authentication required');
    return;
  }

  try {
    const payload = jwt.verify(match[1], effectiveJwtSecret, {
      issuer: 'trackmaster-api',
      audience: 'trackmaster-web',
    });
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const user = userId ? db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(userId) : null;
    if (!user) {
      jsonError(res, 401, 'Invalid session');
      return;
    }
    req.user = user;
    next();
  } catch (_err) {
    jsonError(res, 401, 'Invalid or expired session');
  }
}

function mapTrack(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    createdAt: row.created_at,
    storagePath: row.storage_path,
    status: row.status,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    format: row.format,
    downloadUrl: `/api/tracks/${encodeURIComponent(row.id)}/download`,
  };
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, readNumber(value, fallback)));
}

function normalizeParams(body) {
  const params = body?.params;
  if (!params || typeof params !== 'object') {
    throw new Error('Preset params are required');
  }

  return {
    eqLow: boundedNumber(params.eqLow, 0, -12, 12),
    eqMid: boundedNumber(params.eqMid, 0, -12, 12),
    eqHigh: boundedNumber(params.eqHigh, 0, -12, 12),
    compThreshold: boundedNumber(params.compThreshold, -14, -60, 0),
    compRatio: boundedNumber(params.compRatio, 1.5, 1, 20),
    makeupGain: boundedNumber(params.makeupGain, 0, 0, 24),
    delayTime: boundedNumber(params.delayTime, 0.3, 0.01, 2),
    delayFeedback: boundedNumber(params.delayFeedback, 0.2, 0, 0.9),
    delayMix: boundedNumber(params.delayMix, 0, 0, 1),
    reverbDecay: boundedNumber(params.reverbDecay, 1.5, 0.1, 5),
    reverbMix: boundedNumber(params.reverbMix, 0, 0, 1),
    saturationDrive: boundedNumber(params.saturationDrive, 1, 1, 50),
    saturationMix: boundedNumber(params.saturationMix, 0, 0, 1),
  };
}

function mapPreset(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    params: {
      eqLow: row.eq_low,
      eqMid: row.eq_mid,
      eqHigh: row.eq_high,
      compThreshold: row.comp_threshold,
      compRatio: row.comp_ratio,
      makeupGain: row.makeup_gain,
      delayTime: row.delay_time,
      delayFeedback: row.delay_feedback,
      delayMix: row.delay_mix,
      reverbDecay: row.reverb_decay,
      reverbMix: row.reverb_mix,
      saturationDrive: row.saturation_drive,
      saturationMix: row.saturation_mix,
    },
  };
}

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, service: 'trackmaster-api' });
  } catch (err) {
    console.error('Health check failed', err);
    res.status(503).json({ ok: false, service: 'trackmaster-api' });
  }
});

app.post('/api/auth/register', async (req, res, next) => {
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
    const row = db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?) RETURNING id, email, created_at')
      .get(id, email, passwordHash);
    res.status(201).json({ user: sanitizeUser(row), token: signToken(row) });
  } catch (err) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      jsonError(res, 409, 'An account already exists for that email');
      return;
    }
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const row = isValidEmail(email)
      ? db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(email)
      : null;
    const passwordOk = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!row || !passwordOk) {
      jsonError(res, 401, 'Invalid email or password');
      return;
    }
    res.json({ user: sanitizeUser(row), token: signToken(row) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/tracks', (req, res) => {
  const rows = db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ tracks: rows.map(mapTrack) });
});

app.post('/api/tracks', (req, res) => {
  const id = randomUUID();
  const format = safeFormat(req.header('X-Format'));
  if (!format) {
    jsonError(res, 400, 'Unsupported audio export format');
    return;
  }

  const contentType = String(req.header('Content-Type') || '').split(';')[0].toLowerCase();
  const expectedTypes = format === 'wav'
    ? new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])
    : new Set(['audio/mpeg', 'audio/mp3']);
  if (!expectedTypes.has(contentType)) {
    jsonError(res, 415, 'Audio content type does not match the export format');
    return;
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    jsonError(res, 400, 'Audio payload is required');
    return;
  }

  const displayName = `${safeBaseName(req.header('X-File-Name'))}_mastered.${format}`;
  const durationSeconds = Number.parseFloat(req.header('X-Duration-Seconds') || '');
  const { relative, absolute } = storagePathFor(req.user.id, id, displayName, format);

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, req.body, { flag: 'wx', mode: 0o640 });

  try {
    db.prepare(`
      INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format)
      VALUES (@id, @userId, @fileName, @storagePath, @status, @durationSeconds, @sizeBytes, @format)
    `).run({
      id,
      userId: req.user.id,
      fileName: displayName,
      storagePath: relative,
      status: 'mastered',
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 86400 ? durationSeconds : null,
      sizeBytes: req.body.length,
      format,
    });
  } catch (err) {
    fs.rmSync(absolute, { force: true });
    throw err;
  }

  const row = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(id, req.user.id);
  res.status(201).json({ track: mapTrack(row) });
});

app.get('/api/tracks/:id/download', (req, res) => {
  const row = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) {
    jsonError(res, 404, 'Track not found');
    return;
  }

  const absolute = path.resolve(uploadsDir, row.storage_path);
  const normalizedUploads = `${path.resolve(uploadsDir)}${path.sep}`;
  if (!absolute.startsWith(normalizedUploads) || !fs.existsSync(absolute)) {
    jsonError(res, 404, 'Track file not found');
    return;
  }

  res.download(absolute, row.file_name);
});

app.delete('/api/tracks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) {
    jsonError(res, 404, 'Track not found');
    return;
  }

  const absolute = path.resolve(uploadsDir, row.storage_path);
  const normalizedUploads = `${path.resolve(uploadsDir)}${path.sep}`;
  if (absolute.startsWith(normalizedUploads) && fs.existsSync(absolute)) {
    fs.unlinkSync(absolute);
  }

  db.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/presets', (req, res) => {
  const rows = db.prepare('SELECT * FROM presets WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ presets: rows.map(mapPreset) });
});

app.post('/api/presets', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    jsonError(res, 400, 'Preset name is required');
    return;
  }

  const params = normalizeParams(req.body);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO presets (
      id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
      delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix
    )
    VALUES (
      @id, @userId, @name, @eqLow, @eqMid, @eqHigh, @compThreshold, @compRatio, @makeupGain,
      @delayTime, @delayFeedback, @delayMix, @reverbDecay, @reverbMix, @saturationDrive, @saturationMix
    )
  `).run({ id, userId: req.user.id, name: name.slice(0, 120), ...params });

  const row = db.prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?').get(id, req.user.id);
  res.status(201).json({ preset: mapPreset(row) });
});

app.put('/api/presets/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) {
    jsonError(res, 404, 'Preset not found');
    return;
  }

  const name = String(req.body?.name || existing.name).trim();
  const params = normalizeParams(req.body);
  db.prepare(`
    UPDATE presets
    SET name = @name,
        eq_low = @eqLow,
        eq_mid = @eqMid,
        eq_high = @eqHigh,
        comp_threshold = @compThreshold,
        comp_ratio = @compRatio,
        makeup_gain = @makeupGain,
        delay_time = @delayTime,
        delay_feedback = @delayFeedback,
        delay_mix = @delayMix,
        reverb_decay = @reverbDecay,
        reverb_mix = @reverbMix,
        saturation_drive = @saturationDrive,
        saturation_mix = @saturationMix,
        updated_at = datetime('now')
    WHERE id = @id
      AND user_id = @userId
  `).run({ id: req.params.id, userId: req.user.id, name: name.slice(0, 120), ...params });

  const row = db.prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  res.json({ preset: mapPreset(row) });
});

app.delete('/api/presets/:id', (req, res) => {
  const result = db.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) {
    jsonError(res, 404, 'Preset not found');
    return;
  }
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    jsonError(res, 400, 'Malformed JSON body');
    return;
  }
  if (err?.type === 'entity.too.large') {
    jsonError(res, 413, 'Request body is too large');
    return;
  }
  if (err?.message === 'Preset params are required') {
    jsonError(res, 400, err.message);
    return;
  }
  console.error(err);
  jsonError(res, 500, 'Internal server error');
});

const server = app.listen(port, host, () => {
  console.log(`trackmaster-api listening on http://${host}:${port}`);
  console.log(`trackmaster-api data dir: ${dataDir}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
