const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function resolveRuntimeEnvPath({ projectRoot, env = process.env, fileName } = {}) {
  const root = projectRoot || path.resolve(__dirname, '..');
  const configuredPath = env.TRACKMASTER_ENV_FILE?.trim();

  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(root, configuredPath);
  }

  const defaultFileName = fileName || (env.NODE_ENV === 'production'
    ? '.env.production.local'
    : '.env.local');
  return path.join(root, defaultFileName);
}

function loadRuntimeEnv({ projectRoot, env = process.env, fileName } = {}) {
  const envPath = resolveRuntimeEnvPath({ projectRoot, env, fileName });

  if (!fs.existsSync(envPath)) {
    if (env.NODE_ENV === 'production') {
      throw new Error(`TrackMaster production environment file is missing: ${envPath}`);
    }
    return { loaded: false, path: envPath };
  }

  Object.assign(env, parseEnv(fs.readFileSync(envPath, 'utf8')));
  return { loaded: true, path: envPath };
}

module.exports = {
  loadRuntimeEnv,
  resolveRuntimeEnvPath,
};
