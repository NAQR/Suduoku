'use strict';
/**
 * Stockage des parties.
 * - En production : Upstash Redis (intégration Vercel Marketplace), via son API REST.
 * - En local sans Redis configuré : mémoire du processus (pour `npm run dev`).
 * Toutes les écritures de partie passent par un « compare-and-set » atomique (script Lua),
 * indispensable en serverless où plusieurs fonctions peuvent traiter la même partie en même temps.
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const CAS_LUA = `
local cur = redis.call('GET', KEYS[1])
if (cur or '') ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL', KEYS[1])
else redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3])) end
return 1`;
const INCR_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n`;

function redisStore() {
  const { Redis } = require('@upstash/redis');
  const r = new Redis({ url: URL_, token: TOKEN, automaticDeserialization: false });
  return {
    kind: 'redis',
    get: k => r.get(k),
    mget: ks => r.mget(...ks),
    setEx: (k, v, ttl) => r.set(k, v, { ex: ttl }),
    cas: async (k, oldVal, newVal, ttl) => Number(await r.eval(CAS_LUA, [k], [oldVal || '', newVal || '', String(ttl)])) === 1,
    incr: async (k, ttl) => Number(await r.eval(INCR_LUA, [k], [String(ttl)]))
  };
}

function memoryStore() {
  const m = new Map();
  const live = k => { const e = m.get(k); if (!e) return null; if (e.exp < Date.now()) { m.delete(k); return null; } return e.v; };
  const put = (k, v, ttl) => m.set(k, { v, exp: Date.now() + ttl * 1000 });
  return {
    kind: 'memory',
    get: async k => live(k),
    mget: async ks => ks.map(live),
    setEx: async (k, v, ttl) => { put(k, v, ttl); },
    cas: async (k, oldVal, newVal, ttl) => {
      if ((live(k) || '') !== (oldVal || '')) return false;
      if (!newVal) m.delete(k); else put(k, newVal, ttl);
      return true;
    },
    incr: async (k, ttl) => { const n = (Number(live(k)) || 0) + 1; const e = m.get(k); if (e && e.exp >= Date.now()) e.v = String(n); else put(k, String(n), ttl); return n; }
  };
}

let store = null;
function getStore() {
  if (store) return store;
  if (URL_ && TOKEN) store = redisStore();
  else if (process.env.VERCEL) throw new Error('Base Redis non configurée : ajoutez Upstash Redis au projet Vercel (voir README).');
  else store = memoryStore();
  return store;
}

module.exports = { getStore };
