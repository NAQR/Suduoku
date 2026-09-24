'use strict';
/**
 * Sudoku duel — API de jeu (fonction serverless Vercel).
 * Une seule route : POST /api/game  { t: <action>, code?, token?, ... }
 * Le serveur fait autorité : grilles, solutions, chrono et gagnant. La solution n'est jamais renvoyée.
 */
const crypto = require('crypto');
const { DIFFS, generate } = require('../lib/sudoku');
const { getStore } = require('../lib/store');

const GAME_TTL = parseInt(process.env.GAME_TTL_HOURS || '6', 10) * 3600; // secondes, prolongé à chaque écriture
const SEEN_TTL = 8;                   // un joueur est « connecté » s'il a interrogé l'API depuis moins de 8 s
const CREATE_LIMIT = 20, CREATE_WINDOW = 600;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const gkey = c => `sdk:game:${c}`;
const skey = (c, r) => `sdk:seen:${c}:${r}`;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => { let c = ''; for (let i = 0; i < 5; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]; return c; };
const newToken = () => crypto.randomBytes(18).toString('base64url');
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
const roleOf = (g, token) => ['p1', 'p2'].find(r => g.players[r] && !g.players[r].left && sameToken(g.players[r].token, token)) || null;

class ApiError extends Error { constructor(msg, status = 400, extra) { super(msg); this.status = status; this.extra = extra; } }

function freshRound(g, { difficulty, puzzle, solution }) {
  Object.assign(g, { difficulty, puzzle, solution, ready: { p1: false, p2: false }, goAt: null, winner: null, winTime: null, progress: { p1: 0, p2: 0 }, rematch: null });
}

/* Lecture-modification-écriture atomique, avec nouvelles tentatives en cas d'écriture concurrente. */
async function mutate(store, code, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = await store.get(gkey(code));
    if (!raw) throw new ApiError('expired', 404, { expired: true });
    const g = JSON.parse(raw);
    const res = fn(g);
    if (res === false) return g;                       // rien à écrire
    let next = '';
    if (res !== 'delete') { g.v = (g.v || 0) + 1; next = JSON.stringify(g); }
    if (await store.cas(gkey(code), raw, next, GAME_TTL)) return res === 'delete' ? null : g;
    await new Promise(r => setTimeout(r, 20 + Math.random() * 60));
  }
  throw new ApiError('Serveur occupé, réessayez.', 503);
}

async function view(store, g) {
  const [s1, s2] = await store.mget([skey(g.code, 'p1'), skey(g.code, 'p2')]);
  const pl = (r, seen) => ({ joined: !!g.players[r], connected: !!(g.players[r] && seen), left: !!(g.players[r] && g.players[r].left) });
  return {
    code: g.code, v: g.v, round: g.round, difficulty: g.difficulty, puzzle: g.puzzle,
    players: { p1: pl('p1', s1), p2: pl('p2', s2) },
    ready: g.ready, goAt: g.goAt, winner: g.winner, winTime: g.winTime,
    progress: g.progress, score: g.score,
    rematch: g.rematch ? { difficulty: g.rematch.difficulty } : null
  };
}

function checkCode(code) {
  code = String(code || '').toUpperCase();
  if (!/^[A-Z]{5}$/.test(code)) throw new ApiError('Le code contient 5 lettres.');
  return code;
}
/* Actions réservées à un joueur de la partie : on vérifie le jeton dans la même transaction. */
function asPlayer(token, fn) {
  return g => { const role = roleOf(g, token); if (!role) throw new ApiError('expired', 404, { expired: true }); return fn(g, role); };
}

const actions = {
  async create(store, b, ip) {
    if (!DIFFS[b.diff]) throw new ApiError('Difficulté inconnue.');
    if (await store.incr(`sdk:rl:${ip}`, CREATE_WINDOW) > CREATE_LIMIT) throw new ApiError('Trop de parties créées récemment. Réessayez dans quelques minutes.', 429);
    const token = newToken();
    for (let t = 0; t < 20; t++) {
      const code = newCode();
      const g = { code, v: 1, round: 1, score: { p1: 0, p2: 0 }, players: { p1: { token }, p2: null }, createdAt: Date.now() };
      freshRound(g, { difficulty: b.diff, ...generate(b.diff) });
      if (await store.cas(gkey(code), '', JSON.stringify(g), GAME_TTL)) return { g, role: 'p1', token };
    }
    throw new ApiError('Impossible de créer la partie. Réessayez.', 503);
  },
  async join(store, b) {
    const code = checkCode(b.code);
    const token = newToken();
    let already = false;
    const g = await mutate(store, code, g => {
      if (g.players.p2) { already = true; return false; }
      g.players.p2 = { token }; return true;
    }).catch(e => { if (e.extra && e.extra.expired) throw new ApiError('Aucune partie ne correspond à ce code.', 404); throw e; });
    if (already) throw new ApiError('Cette partie a déjà deux joueurs.', 409);
    return { g, role: 'p2', token };
  },
  async state(store, b) {
    const raw = await store.get(gkey(checkCode(b.code)));
    if (!raw) throw new ApiError('expired', 404, { expired: true });
    const g = JSON.parse(raw);
    const role = roleOf(g, b.token);
    if (!role) throw new ApiError('expired', 404, { expired: true });
    return { g, role };
  },
  ready: (store, b) => mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
    if (!g.players.p2 || g.winner || g.ready[r]) return false;
    g.ready[r] = true;
    if (g.ready.p1 && g.ready.p2) g.goAt = Date.now();
    return true;
  })),
  progress: (store, b) => mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
    const n = b.filled | 0;
    if (!g.goAt || g.winner || n < 0 || n > 81 || g.progress[r] === n) return false;
    g.progress[r] = n; return true;
  })),
  async submit(store, b) {
    const grid = String(b.grid || '');
    if (!/^[1-9]{81}$/.test(grid)) throw new ApiError('Grille invalide.');
    let wrong = false;
    const g = await mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
      if (!g.goAt || g.winner) return false;
      if (grid !== g.solution) { wrong = true; return false; }
      g.winner = r; g.winTime = Date.now() - g.goAt; g.progress[r] = 81; g.score[r]++;
      return true;
    }));
    return wrong ? { g, wrong: true } : g;
  },
  async rematch(store, b) {
    if (!DIFFS[b.diff]) throw new ApiError('Difficulté inconnue.');
    const next = generate(b.diff); // généré hors transaction pour la garder courte
    return mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
      if (r !== 'p1' || !g.winner || g.rematch) return false;
      g.rematch = { difficulty: b.diff, ...next }; return true;
    }));
  },
  accept: (store, b) => mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
    if (r !== 'p2' || !g.rematch) return false;
    g.round++; freshRound(g, g.rematch); return true;
  })),
  async leave(store, b) {
    await mutate(store, checkCode(b.code), asPlayer(b.token, (g, r) => {
      g.players[r].left = true;
      return ['p1', 'p2'].every(x => !g.players[x] || g.players[x].left) ? 'delete' : true;
    })).catch(() => {});
    return { left: true };
  }
};

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'inconnue';
}
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // requêtes sans Origin (non navigateur) : sans effet de bord inter-sites possible
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  try { return new URL(origin).host === req.headers['x-forwarded-host'] || new URL(origin).host === req.headers.host; } catch (e) { return false; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 4096) throw new ApiError('Requête trop volumineuse.', 413); }
  return data ? JSON.parse(data) : {};
}
function reply(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Méthode non autorisée.' });
    if (!originOk(req)) return reply(res, 403, { error: 'Origine refusée.' });
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json')) return reply(res, 415, { error: 'JSON attendu.' });
    let b;
    try { b = await readBody(req); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError('JSON invalide.'); }
    if (!b || typeof b !== 'object' || typeof b.t !== 'string' || !Object.prototype.hasOwnProperty.call(actions, b.t)) throw new ApiError('Action inconnue.');
    if (b.token != null && typeof b.token !== 'string') throw new ApiError('Jeton invalide.');

    const store = getStore();
    const out = await actions[b.t](store, b, clientIp(req));
    if (out && out.left) return reply(res, 200, { left: true });

    const g = out.g || out;
    const role = out.role || roleOf(g, b.token);
    await store.setEx(skey(g.code, role), '1', SEEN_TTL); // présence
    const body = { state: await view(store, g), role, serverNow: Date.now() };
    if (out.token) { body.code = g.code; body.token = out.token; }
    if (out.wrong) { body.wrong = true; body.round = g.round; }
    return reply(res, 200, body);
  } catch (e) {
    if (e instanceof ApiError) return reply(res, e.status, e.extra || { error: e.message });
    console.error('Erreur API', e && e.message);
    return reply(res, 500, { error: 'Erreur interne. Réessayez.' });
  }
};
