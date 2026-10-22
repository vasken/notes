// Production server: serves the built app from ./dist and the /api/state endpoint.
// Usage: npm run build && npm start   (PORT / HOST / NOTES_DATA_DIR env vars are optional)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiMiddleware } from './api.mjs';

const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1'; // local only by default
const DIST = path.resolve('dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
const api = apiMiddleware();

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DIST, path.normalize(urlPath));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found — did you run `npm run build`?');
  }
}

http.createServer((req, res) => api(req, res, () => serveStatic(req, res)))
  .listen(PORT, HOST, () => console.log(`Notes running at http://${HOST}:${PORT}`));
