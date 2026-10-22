import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function reply(response, status, message) {
  if (response.writableEnded || response.destroyed) return;

  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  response.end(message);
}

export async function startLocalServer({
  appDirectory,
  port,
  token,
}) {
  const distDirectory = path.join(appDirectory, 'dist');
  const indexFile = path.join(distDirectory, 'index.html');

  try {
    await fs.access(indexFile);
  } catch {
    throw new Error(
      'The frontend build is missing. Run npm run build first.',
    );
  }

  // main.cjs sets NOTES_DATA_DIR before this module is imported.
  const { apiMiddleware } = await import(
    new URL('../api.mjs', import.meta.url).href
  );

  const api = apiMiddleware();
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(error => {
      console.error('Local server request failed:', error);
      reply(response, 500, 'Internal server error');
    });
  });

  async function handle(request, response) {
    // Reject requests addressed to another hostname.
    if (request.headers.host !== host) {
      reply(response, 403, 'Invalid host');
      return;
    }

    // Only this Electron session receives the access cookie.
    const authorized = (request.headers.cookie || '')
      .split(';')
      .some(value =>
        value.trim() === `local_notes_session=${token}`,
      );

    if (!authorized) {
      reply(response, 403, 'Unauthorized');
      return;
    }

    if (
      request.headers.origin &&
      request.headers.origin !== origin
    ) {
      reply(response, 403, 'Invalid origin');
      return;
    }

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https: http:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );

    const url = new URL(request.url || '/', origin);

    if (url.pathname === '/api/state') {
      await api(request, response, () => {
        reply(response, 404, 'API route not found');
      });
      return;
    }

    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD'
    ) {
      reply(response, 405, 'Method not allowed');
      return;
    }

    let pathname;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      reply(response, 400, 'Invalid URL');
      return;
    }

    if (pathname.includes('\0')) {
      reply(response, 400, 'Invalid path');
      return;
    }

    let filename = path.resolve(
      distDirectory,
      `.${pathname}`,
    );

    const relative = path.relative(distDirectory, filename);

    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      reply(response, 403, 'Forbidden');
      return;
    }

    try {
      const stat = await fs.stat(filename);

      if (stat.isDirectory()) {
        filename = path.join(filename, 'index.html');
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        throw error;
      }

      // Support frontend routes, but do not return HTML for
      // missing JS/CSS/image files.
      if (!path.extname(pathname)) {
        filename = indexFile;
      } else {
        reply(response, 404, 'File not found');
        return;
      }
    }

    let content;

    try {
      content = await fs.readFile(filename);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        reply(response, 404, 'File not found');
        return;
      }

      throw error;
    }

    response.writeHead(200, {
      'Content-Type':
        MIME_TYPES[path.extname(filename).toLowerCase()] ||
        'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
    });

    response.end(
      request.method === 'HEAD' ? undefined : content,
    );
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);

    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  server.on('error', error => {
    console.error('Local server error:', error);
  });

  return {
    origin,

    close: () => new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });

      server.closeIdleConnections?.();
    }),
  };
}
