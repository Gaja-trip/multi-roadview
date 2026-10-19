import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import search from '../api/search.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/search') { await search(req, res); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (relative !== 'index.html' && !/^src\/[a-zA-Z0-9._-]+\.(js|css|svg)$/.test(relative)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const data = await fs.readFile(path.join(root, relative));
    res.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('웹 로드뷰: http://127.0.0.1:4173'));
