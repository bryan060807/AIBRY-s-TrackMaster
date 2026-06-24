import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid boolean flag value "${value}". Expected "true" or "false".`);
}

function normalizeString(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).trim();
}

function parseSessionSeconds(value) {
  const parsed = Number.parseInt(value || '43200', 10);
  return Number.isFinite(parsed) ? Math.max(300, parsed) : 43200;
}

function parseSessionCookieName(value) {
  const name = value || 'tm_session';
  return /^[a-zA-Z0-9_-]+$/.test(name) ? name : 'tm_session';
}

function parseRepositoryBackend(value) {
  const backend = (value || 'sqlite').trim().toLowerCase();
  if (backend !== 'sqlite' && backend !== 'postgres') {
    throw new Error(`Unsupported TRACKMASTER_REPOSITORY_BACKEND "${backend}". Expected "sqlite" or "postgres".`);
  }
  return backend;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function parseUrl(value, fieldName) {
  try {
    return new URL(value);
  } catch (_err) {
    throw new Error(`${fieldName} must be a valid URL.`);
  }
}

function validatePublicUrl(value, fieldName, { allowRelativeSameOrigin = false } = {}) {
  if (allowRelativeSameOrigin && String(value).startsWith('/')) return;

  const parsed = parseUrl(value, fieldName);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${fieldName} must use HTTPS when TRACKMASTER_AIBRY_ID_DEV_ONLY=false.`);
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error(`${fieldName} must not use a loopback host when TRACKMASTER_AIBRY_ID_DEV_ONLY=false.`);
  }
}

function hasExplicitValue(env, key) {
  return env[key] != null && String(env[key]).trim() !== '';
}

function requireExplicitPublicValue(env, key) {
  if (!hasExplicitValue(env, key)) {
    throw new Error(`${key} is required when TRACKMASTER_AIBRY_ID_DEV_ONLY=false.`);
  }
}

function resolveAibryIdConfig(env, { jwtSecret }) {
  const enabled = parseBooleanFlag(env.TRACKMASTER_AIBRY_ID_ENABLED, false);
  const devOnly = parseBooleanFlag(env.TRACKMASTER_AIBRY_ID_DEV_ONLY, true);
  const config = {
    enabled,
    devOnly,
    issuer: normalizeString(env.TRACKMASTER_AIBRY_ID_ISSUER, 'http://127.0.0.1:4010'),
    clientId: normalizeString(env.TRACKMASTER_AIBRY_ID_CLIENT_ID, 'trackmaster-private-loopback'),
    redirectUri: normalizeString(
      env.TRACKMASTER_AIBRY_ID_REDIRECT_URI,
      'http://127.0.0.1:3000/auth/aibry-id/callback',
    ),
    scopes: normalizeString(env.TRACKMASTER_AIBRY_ID_SCOPES, 'openid profile email'),
    successRedirect: normalizeString(env.TRACKMASTER_AIBRY_ID_SUCCESS_REDIRECT, '/'),
    linkRequiredRedirect: normalizeString(env.TRACKMASTER_AIBRY_ID_LINK_REQUIRED_REDIRECT, ''),
    selfProvisioning: parseBooleanFlag(env.TRACKMASTER_AIBRY_ID_SELF_PROVISIONING, false),
    stateCookieSecret: normalizeString(env.TRACKMASTER_AIBRY_ID_STATE_COOKIE_SECRET, jwtSecret || ''),
  };

  if (!enabled) return config;

  if (!config.stateCookieSecret) {
    throw new Error('TRACKMASTER_AIBRY_ID_STATE_COOKIE_SECRET is required when TRACKMASTER_AIBRY_ID_ENABLED=true unless TRACKMASTER_JWT_SECRET is set.');
  }

  if (!devOnly) {
    requireExplicitPublicValue(env, 'TRACKMASTER_AIBRY_ID_ISSUER');
    requireExplicitPublicValue(env, 'TRACKMASTER_AIBRY_ID_CLIENT_ID');
    requireExplicitPublicValue(env, 'TRACKMASTER_AIBRY_ID_REDIRECT_URI');
    requireExplicitPublicValue(env, 'TRACKMASTER_AIBRY_ID_SUCCESS_REDIRECT');
    validatePublicUrl(config.issuer, 'TRACKMASTER_AIBRY_ID_ISSUER');
    validatePublicUrl(config.redirectUri, 'TRACKMASTER_AIBRY_ID_REDIRECT_URI');
    validatePublicUrl(config.successRedirect, 'TRACKMASTER_AIBRY_ID_SUCCESS_REDIRECT', {
      allowRelativeSameOrigin: true,
    });
  }

  return config;
}

export function loadConfig(env = process.env) {
  const port = parsePort(env.PORT, 3004);
  const host = env.TRACKMASTER_HOST || '127.0.0.1';
  const dataDir = path.resolve(projectRoot, env.TRACKMASTER_DATA_DIR || './data');
  const uploadsDir = path.join(dataDir, 'uploads');
  const dbPath = path.join(dataDir, 'trackmaster.sqlite');
  const repositoryBackend = parseRepositoryBackend(env.TRACKMASTER_REPOSITORY_BACKEND);
  const postgresUrl = env.TRACKMASTER_POSTGRES_URL || '';
  const jwtSecret = env.TRACKMASTER_JWT_SECRET || '';
  const production = env.NODE_ENV === 'production';
  const aibryId = resolveAibryIdConfig(env, { jwtSecret });

  if (repositoryBackend === 'postgres' && !postgresUrl) {
    throw new Error('TRACKMASTER_POSTGRES_URL is required when TRACKMASTER_REPOSITORY_BACKEND=postgres.');
  }
  if (!jwtSecret && production) {
    throw new Error('TRACKMASTER_JWT_SECRET is required in production.');
  }
  if (jwtSecret && production && jwtSecret.length < 32) {
    throw new Error('TRACKMASTER_JWT_SECRET must be at least 32 characters in production.');
  }
  if (!jwtSecret) {
    console.warn('TRACKMASTER_JWT_SECRET is not set; using development-only local fallback.');
  }

  return {
    projectRoot,
    port,
    host,
    dataDir,
    uploadsDir,
    dbPath,
    uploadLimit: env.TRACKMASTER_UPLOAD_LIMIT || '120mb',
    repositoryBackend,
    postgresUrl,
    postgresPoolMax: parsePositiveInteger(env.TRACKMASTER_POSTGRES_POOL_MAX, 5),
    corsOrigin: env.CORS_ORIGIN || '',
    jwtSecret,
    jwtExpiresIn: env.TRACKMASTER_JWT_EXPIRES_IN || '12h',
    effectiveJwtSecret: jwtSecret || 'trackmaster-local-dev-secret-change-me',
    sessionCookieName: parseSessionCookieName(env.TRACKMASTER_SESSION_COOKIE),
    sessionExpiresSeconds: parseSessionSeconds(env.TRACKMASTER_SESSION_EXPIRES_IN_SECONDS),
    apiRateWindowMs: parsePort(env.TRACKMASTER_API_RATE_WINDOW_MS, 60000),
    apiRateLimit: parsePort(env.TRACKMASTER_API_RATE_LIMIT, 240),
    authRateWindowMs: parsePort(env.TRACKMASTER_AUTH_RATE_WINDOW_MS, 900000),
    authRateLimit: parsePort(env.TRACKMASTER_AUTH_RATE_LIMIT, 20),
    aibryId,
    production,
    legacyUserId: 'legacy-local-user',
  };
}

export const config = loadConfig();
