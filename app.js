'use strict';
/* Sudoku duel — client. Le serveur fait autorité (grilles, chrono, gagnant) ;
   ce script gère l'affichage, la saisie et les échanges avec l'API. */

const DIFFS = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert' };
const $ = id => document.getElementById(id);
const R = [], C = [], B = [], PEERS = [];
for (let i = 0; i < 81; i++) { R[i] = i / 9 | 0; C[i] = i % 9; B[i] = (R[i] / 3 | 0) * 3 + (C[i] / 3 | 0); }
for (let i = 0; i < 81; i++) { const s = new Set(); for (let j = 0; j < 81; j++) if (j !== i && (R[j] === R[i] || C[j] === C[i] || B[j] === B[i])) s.add(j); PEERS[i] = [...s]; }

function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function fmt(ms) { if (ms == null || ms < 0) ms = 0; const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : p(m)) + ':' + p(x); }

/* ---------- État ---------- */
const S = { diff: 'moyen', code: null, role: null, token: null, game: null, skew: 0, local: null, sel: -1, noteMode: false, submitted: false, wrong: false, progressT: null };
const opp = () => (S.role === 'p1' ? 'p2' : 'p1');

/* ---------- Thème (clair par défaut) ---------- */
function applyTheme(t) {
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const dark = t === 'dark';
  $('icoMoon').toggleAttribute('hidden', dark); $('icoSun').toggleAttribute('hidden', !dark);
}
applyTheme(ls('sdk-theme'));
$('themeBtn').onclick = () => { const nx = ls('sdk-theme') === 'dark' ? 'light' : 'dark'; ls('sdk-theme', nx); applyTheme(nx); };

/* ---------- Échanges avec le serveur (HTTP + interrogation régulière) ---------- */
let pollT = null, failures = 0, polling = false;
function banner(t) { const b = $('banner'); b.textContent = t || ''; b.hidden = !t; }
async function api(body) {
  try {
    const r = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    let data = {}; try { data = await r.json(); } catch (e) {}
    failures = 0; banner('');
    return data;
  } catch (e) {
    failures++; if (failures > 1) banner('Connexion perdue. Nouvelle tentative…');
    return null;
  }
}
/* Action d'un joueur dans sa partie */
async function act(t, extra) {
  if (!S.code) return;
  handle(await api(Object.assign({ t, code: S.code, token: S.token }, extra || {})));
}
function handle(r) {
  if (!r) return;
  if (r.expired) { if (S.code) leaveLocal('Cette partie n\'existe plus ou a expiré.'); else $('homeMsg').textContent = 'Cette partie n\'existe plus.'; return; }
  if (r.error) { resetGenBtn(); $('homeMsg').textContent = r.error; return; }
  if (r.token) {
    S.code = r.code; S.role = r.role; S.token = r.token; S.v = 0;
    ss('sdk-current', JSON.stringify({ code: r.code, token: r.token }));
    resetGenBtn(); startPolling();
  }
  if (r.state && r.state.code === S.code) {
    if (r.state.v < (S.v || 0)) return;            // réponse plus ancienne que l'état affiché
    S.v = r.state.v; S.role = r.role || S.role;
    S.skew = Date.now() - r.serverNow;
    onGame(r.state);
  }
  if (r.wrong && S.game && r.round === S.game.round) { S.wrong = true; renderBoard(); }
}
function startPolling() { if (!polling) { polling = true; poll(); } }
async function poll() {
  clearTimeout(pollT);
  if (!S.code) { polling = false; return; }
  handle(await api({ t: 'state', code: S.code, token: S.token }));
  if (!S.code) { polling = false; return; }
  pollT = setTimeout(poll, document.hidden ? 4000 : (failures ? 3000 : 1000));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.code) poll(); });

/* ---------- Écrans ---------- */
function show(name) { for (const s of ['home', 'lobby', 'game']) $(s).hidden = s !== name; }

/* ---------- Accueil ---------- */
function renderDiffSeg() {
  const seg = $('diffSeg'); seg.innerHTML = '';
  for (const [k, label] of Object.entries(DIFFS)) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', k === S.diff); b.textContent = label;
    b.onclick = () => { S.diff = k; renderDiffSeg(); };
    seg.appendChild(b);
  }
}
renderDiffSeg();
function resetGenBtn() { const b = $('genBtn'); b.disabled = false; b.textContent = 'Générer la grille'; }
$('genBtn').onclick = () => {
  const b = $('genBtn'); b.disabled = true; b.textContent = 'Génération…'; $('homeMsg').textContent = '';
  api({ t: 'create', diff: S.diff }).then(r => { if (!r) { resetGenBtn(); $('homeMsg').textContent = 'Serveur injoignable. Réessayez.'; } else handle(r); });
};
$('codeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('joinBtn').onclick = () => {
  const c = $('codeIn').value.trim();
  if (c.length !== 5) { $('homeMsg').textContent = 'Le code contient 5 lettres.'; return; }
  $('homeMsg').textContent = '';
  api({ t: 'join', code: c }).then(r => { if (!r) $('homeMsg').textContent = 'Serveur injoignable. Réessayez.'; else handle(r); });
};

/* ---------- Quitter ---------- */
function leaveLocal(msg) {
  ss('sdk-current', null); clearTimeout(pollT); polling = false;
  Object.assign(S, { code: null, role: null, token: null, game: null, local: null, sel: -1, v: 0 });
  clearInterval(tick);
  $('game').classList.remove('lost'); $('overlay').hidden = true; $('endCard').dataset.sig = '';
  show('home'); $('homeMsg').textContent = msg || ''; resetGenBtn();
}
function leave() { if (S.code) api({ t: 'leave', code: S.code, token: S.token }); leaveLocal(); }
$('leaveLobby').onclick = leave;
$('leaveGame').onclick = leave;

/* ---------- Réception de l'état ---------- */
const serverNow = () => Date.now() - S.skew;
function bothReady(g) { return !!(g && g.ready.p1 && g.ready.p2 && g.goAt); }
function onGame(g) {
  S.game = g;
  if (!S.local || S.local.round !== g.round) initLocal(g);
  if (bothReady(g) || g.winner) { show('game'); renderGame(); }
  else { show('lobby'); renderLobby(); }
}

/* ---------- Salle d'attente ---------- */
function renderLobby() {
  const g = S.game, o = g.players[opp()];
  $('lobbyTitle').textContent = g.round > 1 ? `Revanche, manche ${g.round}` : 'Code de la partie';
  $('lobbyCode').textContent = g.code;
  $('lobbyDiff').textContent = `Difficulté : ${DIFFS[g.difficulty]}`;
  const waiting = !o.joined;
  $('shareBox').hidden = !(S.role === 'p1' && waiting);
  const meReady = g.ready[S.role], oppReady = g.ready[opp()];
  let st, wait = true;
  if (waiting) st = 'En attente de votre adversaire…';
  else if (o.left) st = 'Votre adversaire a quitté la partie.';
  else if (meReady) st = 'En attente de l\'autre joueur';
  else if (oppReady) { st = 'Votre adversaire est prêt.'; wait = false; }
  else { st = S.role === 'p2' && g.round === 1 ? 'Vous avez rejoint la partie. Les deux joueurs sont là.' : 'Les deux joueurs sont là.'; wait = false; }
  if (!waiting && !o.left && !o.connected) st += ' (adversaire momentanément déconnecté)';
  $('lobbyDot').className = 'dot ' + (wait ? 'wait' : 'ok');
  $('lobbyStatus').textContent = st;
  const sb = $('startBtn');
  sb.hidden = waiting || meReady || o.left; sb.disabled = false;
}
$('copyBtn').onclick = async () => {
  const t = S.code; let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch (e) {}
  if (!ok) { const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i); i.select(); try { ok = document.execCommand('copy'); } catch (e) {} i.remove(); }
  $('copyBtn').textContent = ok ? 'Code copié' : 'Copie impossible, notez le code';
  setTimeout(() => { $('copyBtn').textContent = 'Copier le code'; }, 1800);
};
$('startBtn').onclick = () => { $('startBtn').disabled = true; act('ready'); };

/* ---------- Grille locale ---------- */
function lkey() { return `sdk:${S.code}:${S.local ? S.local.round : 0}:${S.token}`; }
function initLocal(g) {
  const given = [...g.puzzle].map(Number);
  S.local = { round: g.round, given: given.map(v => v > 0), values: given.slice(), notes: new Array(81).fill(0), hist: [] };
  S.sel = -1; S.noteMode = false; S.submitted = false; S.wrong = false;
  const raw = ls(lkey());
  if (raw) { try { const o = JSON.parse(raw); if (o.values && o.values.length === 81) { S.local.values = o.values; S.local.notes = o.notes; } } catch (e) {} }
  buildBoard(); renderPad();
  $('game').classList.remove('lost'); $('overlay').hidden = true; $('endCard').dataset.sig = '';
}
function saveLocal() { ls(lkey(), JSON.stringify({ values: S.local.values, notes: S.local.notes })); }

/* ---------- Plateau ---------- */
let cellEls = [];
function buildBoard() {
  const bd = $('board'); bd.innerHTML = ''; cellEls = new Array(81);
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div'); box.className = 'box';
    for (let k = 0; k < 9; k++) {
      const r = (b / 3 | 0) * 3 + (k / 3 | 0), c = (b % 3) * 3 + k % 3, i = r * 9 + c;
      const el = document.createElement('div'); el.className = 'cell'; el.setAttribute('role', 'gridcell');
      el.addEventListener('pointerdown', e => { e.preventDefault(); S.sel = i; bd.focus({ preventScroll: true }); renderBoard(); });
      cellEls[i] = el; box.appendChild(el);
    }
    bd.appendChild(box);
  }
}
function conflicts() {
  const v = S.local.values, out = new Set();
  for (let i = 0; i < 81; i++) if (v[i]) for (const j of PEERS[i]) if (v[j] === v[i]) { out.add(i); break; }
  return out;
}
function renderBoard() {
  if (!S.local) return;
  const { values, notes, given } = S.local, sel = S.sel, sv = sel >= 0 ? values[sel] : 0, cf = conflicts();
  for (let i = 0; i < 81; i++) {
    const el = cellEls[i]; const cls = ['cell'];
    if (given[i]) cls.push('given');
    if (i === sel) cls.push('sel');
    else if (sv && values[i] === sv) cls.push('same');
    else if (sel >= 0 && (R[i] === R[sel] || C[i] === C[sel] || B[i] === B[sel])) cls.push('peer');
    if (cf.has(i)) cls.push('conflict');
    el.className = cls.join(' ');
    const pos = `Ligne ${R[i] + 1}, colonne ${C[i] + 1}`;
    if (values[i]) { el.textContent = values[i]; el.setAttribute('aria-label', `${pos} : ${values[i]}`); }
    else if (notes[i]) {
      const wrap = document.createElement('div'); wrap.className = 'notes';
      for (let n = 1; n <= 9; n++) { const sp = document.createElement('span'); if (sv === n) sp.className = 'hl'; if (notes[i] & (1 << (n - 1))) sp.textContent = n; wrap.appendChild(sp); }
      el.replaceChildren(wrap); el.setAttribute('aria-label', `${pos} : vide, annotations`);
    } else { el.textContent = ''; el.setAttribute('aria-label', `${pos} : vide`); }
  }
  const full = values.every(x => x);
  $('wrongMsg').hidden = !(full && (S.wrong || cf.size));
  renderPadCounts();
}
function renderPad() {
  const dg = $('digits'); dg.innerHTML = '';
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button'); b.className = 'digit'; b.dataset.n = n;
    b.append(String(n), document.createElement('small'));
    b.onclick = () => input(n); dg.appendChild(b);
  }
  $('noteBtn').setAttribute('aria-pressed', S.noteMode); $('pad').classList.toggle('noting', S.noteMode);
  renderPadCounts();
}
function renderPadCounts() {
  if (!S.local) return;
  const cnt = new Array(10).fill(0); for (const v of S.local.values) cnt[v]++;
  for (const b of $('digits').children) { const n = +b.dataset.n, left = 9 - cnt[n]; b.querySelector('small').textContent = left > 0 ? left : ''; b.classList.toggle('done', left <= 0); }
}

/* ---------- Saisie ---------- */
function locked() { const g = S.game; return !S.local || !g || !!g.winner || !bothReady(g); }
function pushHist() { const h = S.local.hist; h.push({ v: S.local.values.slice(), n: S.local.notes.slice() }); if (h.length > 300) h.shift(); }
function input(n) {
  const L = S.local, i = S.sel; if (locked() || i < 0 || L.given[i]) return;
  if (S.noteMode) { if (L.values[i]) return; pushHist(); L.notes[i] ^= 1 << (n - 1); }
  else {
    pushHist();
    if (L.values[i] === n) L.values[i] = 0;
    else { L.values[i] = n; L.notes[i] = 0; for (const j of PEERS[i]) L.notes[j] &= ~(1 << (n - 1)); }
  }
  after();
}
function erase() { const L = S.local, i = S.sel; if (locked() || i < 0 || L.given[i]) return; if (!L.values[i] && !L.notes[i]) return; pushHist(); L.values[i] = 0; L.notes[i] = 0; after(); }
function undo() { if (locked()) return; const h = S.local.hist.pop(); if (!h) return; S.local.values = h.v; S.local.notes = h.n; after(); }
function toggleNote() { S.noteMode = !S.noteMode; $('noteBtn').setAttribute('aria-pressed', S.noteMode); $('pad').classList.toggle('noting', S.noteMode); }
$('noteBtn').onclick = toggleNote; $('eraseBtn').onclick = erase; $('undoBtn').onclick = undo;

function after() {
  S.wrong = false;
  saveLocal(); renderBoard();
  clearTimeout(S.progressT);
  S.progressT = setTimeout(() => { if (S.local) act('progress', { filled: S.local.values.filter(x => x).length }); }, 1000);
  const v = S.local.values;
  if (v.every(x => x) && !conflicts().size) act('submit', { grid: v.join('') }); // le serveur vérifie
}

document.addEventListener('keydown', e => {
  if ($('game').hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) { if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } return; }
  const m = /^(Digit|Numpad)([1-9])$/.exec(e.code); // fonctionne en AZERTY sans Maj
  if (m) { e.preventDefault(); input(+m[2]); return; }
  const k = e.key;
  if (k === 'Backspace' || k === 'Delete' || e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); erase(); return; }
  if (k === 'n' || k === 'N') { toggleNote(); return; }
  const mv = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 3, ArrowRight: 4 }[k];
  if (mv) {
    e.preventDefault();
    if (S.sel < 0) S.sel = 40;
    else { let r = R[S.sel], c = C[S.sel]; if (mv === 1) r = (r + 8) % 9; if (mv === 2) r = (r + 1) % 9; if (mv === 3) c = (c + 8) % 9; if (mv === 4) c = (c + 1) % 9; S.sel = r * 9 + c; }
    renderBoard();
  }
});

/* ---------- Jeu ---------- */
let tick = null;
function updateTimer() {
  const g = S.game; if (!g || !g.goAt) { $('timer').textContent = '--:--'; return; }
  $('timer').textContent = fmt(g.winner ? g.winTime : serverNow() - g.goAt);
}
function renderGame() {
  const g = S.game, o = g.players[opp()];
  $('diffLabel').textContent = `${DIFFS[g.difficulty]}${g.round > 1 ? ', manche ' + g.round : ''}`;
  let st = `Adversaire : ${g.progress[opp()] || 0} / 81 cases`;
  if (o.left) st = 'Votre adversaire a quitté la partie';
  else if (!o.connected) st += ' (déconnecté)';
  $('oppStatus').textContent = st;
  renderBoard(); updateTimer();
  clearInterval(tick); tick = setInterval(updateTimer, 250);
  renderEnd();
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(t, cls, fn) { const b = el('button', 'btn ' + cls, t); b.onclick = fn; return b; }
function renderEnd() {
  const g = S.game, ov = $('overlay'), card = $('endCard');
  if (!g.winner) { ov.hidden = true; $('game').classList.remove('lost'); return; }
  const won = g.winner === S.role, o = opp();
  $('game').classList.toggle('lost', !won);
  const sig = [g.round, g.winner, JSON.stringify(g.rematch), S.role, g.players[o].left].join('|');
  if (card.dataset.sig === sig && !ov.hidden) return;
  card.dataset.sig = sig; ov.hidden = false;
  const t = fmt(g.winTime);
  const score = el('div', 'score');
  for (const [n, lab] of [[g.score[S.role], 'Vous'], [g.score[o], 'Adversaire']]) { const d = el('div'); d.append(el('b', null, n || 0), el('span', null, lab)); score.append(d); }
  const actions = el('div', 'end-actions');
  card.replaceChildren(
    el('p', 'verdict ' + (won ? 'win' : 'lose'), won ? 'GAGNÉ' : 'PERDU'),
    el('p', 'muted m0', won ? `Grille terminée en ${t}` : `Votre adversaire a terminé en ${t}`),
    score, actions
  );
  if (g.players[o].left) actions.append(el('div', 'notice', 'Votre adversaire a quitté la partie.'));
  else if (S.role === 'p1') {
    if (g.rematch) actions.append(el('div', 'notice', 'Revanche proposée. En attente de votre adversaire…'));
    else {
      const sel = el('select'); sel.setAttribute('aria-label', 'Difficulté de la revanche');
      for (const [k, v] of Object.entries(DIFFS)) { const op = el('option', null, v); op.value = k; if (k === g.difficulty) op.selected = true; sel.append(op); }
      const b = btn('Proposer une revanche', 'primary', () => { b.disabled = true; b.textContent = 'Génération…'; act('rematch', { diff: sel.value }); });
      actions.append(sel, b);
    }
  } else {
    if (g.rematch) {
      actions.append(el('div', 'notice', `Votre adversaire propose une revanche (${DIFFS[g.rematch.difficulty]}).`));
      const b = btn('Accepter la revanche', 'primary', () => { b.disabled = true; act('accept'); });
      actions.append(b);
    } else actions.append(el('div', 'notice', 'En attente d\'une proposition de revanche…'));
  }
  actions.append(btn('Quitter la partie', 'ghost', leave));
}

/* ---------- Démarrage ---------- */
show('home');
(() => {
  const cur = ss('sdk-current');
  if (cur) { try { const o = JSON.parse(cur); S.code = o.code; S.token = o.token; startPolling(); } catch (e) {} }
})();
