export function jsonError(res, status, message) {
  res.status(status).json({ error: message });
}
