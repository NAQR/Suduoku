'use strict';
/* Serveur de développement local : sert public/ et /api/game comme sur Vercel.
   Sans variables Redis, les parties sont stockées en mémoire. Usage : npm run dev */
const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('./api/game');
const vercel = require('./vercel.json');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const baseHeaders = vercel.headers[0].headers;

http.createServer((req, res) => {
  for (const h of baseHeaders) res.setHeader(h.key, h.value);
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/game') return handler(req, res);
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p) p = 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Introuvable'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`Sudoku duel (dev) sur http://localhost:${PORT}`));
