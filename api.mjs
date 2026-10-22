import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(
  process.env.NOTES_DATA_DIR || 'data',
);

const FILE = path.join(DATA_DIR, 'notes.json');
const MAX_BODY = 50 * 1024 * 1024;

async function readState() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        version: 1,
        notes: [],
        groups: [],
        sketches: {},
        snippets: {},
        empty: true,
      };
    }

    throw error;
  }
}

let queue = Promise.resolve();

function writeState(state) {
  const operation = queue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporary = `${FILE}.tmp`;

    await fs.writeFile(
      temporary,
      JSON.stringify(state, null, 2),
    );

    try {
      await fs.copyFile(FILE, `${FILE}.bak`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await fs.rename(temporary, FILE);
  });

  // A failed write must not permanently break subsequent writes.
  queue = operation.catch(() => {});

  return operation;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];

    request.on('data', chunk => {
      if (exceeded) return;

      size += chunk.length;

      if (size > MAX_BODY) {
        exceeded = true;

        const error = new Error('Payload too large');
        error.status = 413;

        reject(error);
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      if (!exceeded) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });

    request.on('error', reject);

    request.on('aborted', () => {
      reject(new Error('Request aborted'));
    });
  });
}

function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;

  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function validState(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.groups) ||
    !isRecord(data.sketches) ||
    (data.snippets !== undefined && !isRecord(data.snippets))
  ) {
    return false;
  }

  if (
    !data.notes.every(note =>
      isRecord(note) &&
      typeof note.id === 'string' &&
      typeof note.title === 'string' &&
      typeof note.body === 'string',
    )
  ) {
    return false;
  }

  return Object.entries(data.snippets ?? {}).every(
    ([id, item]) =>
      isRecord(item) &&
      item.id === id &&
      typeof item.title === 'string' &&
      typeof item.summary === 'string' &&
      typeof item.content === 'string' &&
      ['text', 'code', 'png', 'sketch'].includes(item.kind),
  );
}

export function apiMiddleware() {
  return async (request, response, next) => {
    const pathname = (request.url || '').split('?')[0];

    if (pathname !== '/api/state') {
      if (next) return next();
      return send(response, 404, { error: 'Not found' });
    }

    // Reject cross-origin browser writes to the local server.
    const origin = request.headers.origin;

    if (origin) {
      try {
        if (new URL(origin).host !== request.headers.host) {
          return send(response, 403, {
            error: 'Cross-origin requests are not allowed',
          });
        }
      } catch {
        return send(response, 403, { error: 'Invalid origin' });
      }
    }

    try {
      if (request.method === 'GET') {
        return send(response, 200, await readState());
      }

      if (
        request.method === 'PUT' ||
        request.method === 'POST'
      ) {
        let data;

        try {
          data = JSON.parse(await readBody(request));
        } catch (error) {
          return send(response, error.status || 400, {
            error: error.message || 'Invalid JSON',
          });
        }

        if (!validState(data)) {
          return send(response, 400, { error: 'Invalid state' });
        }

        await writeState({
          version: 1,
          notes: data.notes,
          groups: data.groups,
          sketches: data.sketches,
          snippets: data.snippets ?? {},
        });

        return send(response, 200, { ok: true });
      }

      return send(response, 405, {
        error: 'Method not allowed',
      });
    } catch (error) {
      return send(response, 500, {
        error: String(error.message || error),
      });
    }
  };
}
