import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

export function clientKey(req) {
  const cloudflareIp = String(req.header('CF-Connecting-IP') || '').trim();
  if (cloudflareIp && isIP(cloudflareIp)) return `cf:${ipKeyGenerator(cloudflareIp)}`;

  const forwardedFor = String(req.header('X-Forwarded-For') || '').split(',')[0].trim();
  if (forwardedFor && isIP(forwardedFor)) return `xff:${ipKeyGenerator(forwardedFor)}`;

  const fallbackIp = req.ip || req.socket.remoteAddress || '';
  return isIP(fallbackIp) ? `ip:${ipKeyGenerator(fallbackIp)}` : 'ip:unknown';
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
