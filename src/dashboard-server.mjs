import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

export function createDashboardServer({ controller, port = 0 }) {
  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 404, { ok: false, error: 'Not found' });
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const status = await controller.getStatus();
        sendJson(res, 200, { ok: true, status });
        return;
      }

      if (url.pathname === '/api/login/start' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, result: await controller.startLogin() });
        return;
      }

      if (url.pathname === '/api/courses/discover' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, courses: await controller.discoverCourses() });
        return;
      }

      if (url.pathname === '/api/courses/save' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, courses: await controller.saveCourses(body.courses) });
        return;
      }

      if (url.pathname === '/api/watcher/start' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, result: await controller.startWatcher() });
        return;
      }

      if (url.pathname === '/api/watcher/stop' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, result: await controller.stopWatcher() });
        return;
      }

      if (url.pathname === '/api/alerts/acknowledge' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, result: await controller.acknowledgeAlert() });
        return;
      }

      if (url.pathname === '/api/alerts/test' && req.method === 'POST') {
        sendJson(res, 200, { ok: true, result: await controller.testAlert() });
        return;
      }

      if (req.method === 'GET') {
        await sendStatic(res, url.pathname);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  return {
    origin: null,
    async start() {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      const address = server.address();
      this.origin = `http://127.0.0.1:${address.port}`;
      return this.origin;
    },
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function sendStatic(res, pathname) {
  const filePath =
    pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname.replace(/^\//, ''));
  const content = await readFile(filePath);
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
  res.end(content);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
