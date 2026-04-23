import { startServer } from '../trackmaster-api/src/server.js';

startServer().catch((err) => {
  console.error('Failed to start trackmaster-api', err);
  process.exit(1);
});
