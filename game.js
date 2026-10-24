// Merge Harbor core prototype. No build step.
(() => {
'use strict';
const COLS = 7, ROWS = 9, N = COLS * ROWS;
const MAX_ENERGY = 50, REGEN_SEC = 60, SAVE_KEY = 'mergeHarbor.save.v1';
const ORDER_SLOTS = 3;
const asset = p => p.replace(/^art\//, 'assets/');
let ITEMS = {}, CHARS = {}, ORDERS = [], STORY = null, S = null;

// ---- hooks for later story/renovation task ----
const hooks = { orderCompleted: [], levelUp: [], merged: [], renovate: [], chapterUnlocked: [] };
const emit = (k, d) => hooks[k].forEach(f => { try { f(d, S); } catch (e) { console.error(e); } });

const $ = id => document.getElementById(id);
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1400); }

async function load() {
  const [m, o, c, s] = await Promise.all(['merge_chains', 'orders', 'characters', 'story'].map(n => fetch('data/' + n + '.json').then(r => r.json())));
  for (const ch of m.chains) {
    const g = ch.generator;
    ITEMS[g.id] = { id: g.id, zh: g.zh, en: g.en, asset: asset(g.asset), chain: ch.id, gen: true, cost: g.energy_cost || 1, first: ch.tiers[0].id, second: ch.tiers[1] && ch.tiers[1].id };
    ch.tiers.forEach((t, i) => ITEMS[t.id] = { id: t.id, zh: t.zh, en: t.en, tier: t.tier, sell: t.sell_coins || 1, asset: asset(t.asset), chain: ch.id, next: ch.tiers[i + 1] ? ch.tiers[i + 1].id : null });
  }
  c.characters.forEach(x => CHARS[x.id] = { ...x, portrait: asset(x.portrait || ('art/characters/' + x.id + '.svg')) });
  ORDERS = o.orders; STORY = s;
  m.chains.forEach(ch => { const im = new Image(); im.src = ITEMS[ch.generator.id].asset; });
}

function newState() {
  const board = Array(N).fill(null);
  const gens = Object.values(ITEMS).filter(i => i.gen);
  gens.forEach((g, i) => board[i] = g.id);           // generators along the top row
  const st = { board, energy: MAX_ENERGY, lastRegen: Date.now(), coins: 0, xp: 0, level: 1, stars: 0, done: [], renovations: [], chapter: 1, orderPtr: {}, active: [], introSeen: [] };
  fillOrders(st); return st;
}
// ---- chapters & orders ----
const chapterOrders = ch => ORDERS.map((o, i) => o.chapter === ch ? i : -1).filter(i => i >= 0);
function fillOrders(st) {
  const pool = chapterOrders(st.chapter); if (!pool.length) return;
  st.active = st.active.filter(i => ORDERS[i] && ORDERS[i].chapter === st.chapter);
  let guard = 0;
  while (st.active.length < Math.min(ORDER_SLOTS, pool.length) && guard++ < 100) {
    const p = st.orderPtr[st.chapter] || 0; const oi = pool[p % pool.length]; st.orderPtr[st.chapter] = p + 1;  // cycles when the chapter's pool runs out
    if (!st.active.includes(oi)) st.active.push(oi);
  }
}
function migrate(st) {   // upgrade v1 prototype saves
  st.chapter = st.chapter ?? 1; st.renovations = st.renovations || []; st.orderPtr = st.orderPtr || {}; st.introSeen = st.introSeen || [];
  st.active = (st.active || []).filter(x => x !== null); delete st.nextOrder; fillOrders(st); return st;
}
const chapterOf = id => STORY.chapters.find(c => c.id === id);
const allRenos = () => STORY.chapters.flatMap(c => c.renovations.map(r => ({ ...r, chapter: c.id })));

// ---- dialogue popups ----
let dlgQueue = [];
function showDialogue(lines) { dlgQueue.push(...lines); if (!$('dialog').classList.contains('show')) nextLine(); }
function nextLine() {
  const d = $('dialog'); const l = dlgQueue.shift();
  if (!l) { d.classList.remove('show'); return; }
  const ch = CHARS[l.speaker];
  $('dlgPortrait').style.display = ch ? '' : 'none'; if (ch) $('dlgPortrait').src = ch.portrait;
  $('dlgName').textContent = ch ? ch.zh : (l.name || '旁白'); $('dlgText').textContent = l.zh;
  d.classList.add('show');
}
function chapterIntro(id) {
  if (S.introSeen.includes(id)) return; const c = chapterOf(id); if (!c) return;
  S.introSeen.push(id); save();
  showDialogue([{ speaker: null, name: c.zh, zh: c.summary_zh }]);
}

// ---- renovation ----
function renderBg() {
  const total = allRenos().length || 1;
  $('bgAfter').style.opacity = (S.renovations.length / total).toFixed(3);
}
function renderReno() {
  const c = chapterOf(S.chapter); const list = $('renoList'); list.innerHTML = '';
  $('renoTitle').textContent = c ? c.zh : '港口已全部修复';
  const total = allRenos().length;
  $('renoProg').textContent = `修复进度 ${S.renovations.length}/${total} · 当前 ⭐${S.stars}`;
  if (!c) return;
  c.renovations.forEach(r => {
    const done = S.renovations.includes(r.id);
    const el = document.createElement('div'); el.className = 'renoRow' + (done ? ' done' : '');
    el.innerHTML = `<span>${r.zh}</span><button data-id="${r.id}" ${done || S.stars < r.cost_stars ? 'disabled' : ''}>${done ? '已完成' : '⭐' + r.cost_stars + ' 修复'}</button>`;
    el.querySelector('button').onclick = () => renovate(r.id);
    list.appendChild(el);
  });
}
function renovate(id) {
  const r = allRenos().find(x => x.id === id);
  if (!r || S.renovations.includes(id) || r.chapter !== S.chapter || S.stars < r.cost_stars) return false;
  S.stars -= r.cost_stars; S.renovations.push(id);
  emit('renovate', r);
  showDialogue(r.dialogue);
  const c = chapterOf(S.chapter);
  if (c.renovations.every(x => S.renovations.includes(x.id))) {
    const nx = chapterOf(S.chapter + 1);
    if (nx) { S.chapter++; fillOrders(S); emit('chapterUnlocked', S.chapter); chapterIntro(S.chapter); toast('新章节解锁：' + nx.zh); }
    else { S.chapter = 0; toast('海风港修复完成！'); }
  }
  save(); renderAll(); renderReno(); return true;
}

function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
function restore() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.board && s.board.length === N) return s; } catch (e) {} return null; }

function regen() {
  const now = Date.now();
  if (S.energy >= MAX_ENERGY) { S.lastRegen = now; return; }
  if (!S) return;
  const n = Math.floor((now - S.lastRegen) / (REGEN_SEC * 1000));
  if (n > 0) { S.energy = Math.min(MAX_ENERGY, S.energy + n); S.lastRegen += n * REGEN_SEC * 1000; save(); }
}
const xpNeed = lv => 10 + lv * 10;

// ---- rendering ----
let sel = -1;
function renderHUD() {
  $('energy').textContent = S.energy + '/' + MAX_ENERGY;
  const left = S.energy >= MAX_ENERGY ? '' : Math.ceil((REGEN_SEC * 1000 - (Date.now() - S.lastRegen)) / 1000) + 's';
  $('regen').textContent = left && '+1 ' + left;
  $('coins').textContent = S.coins; $('stars').textContent = S.stars; $('level').textContent = S.level;
  $('xpfill').style.width = Math.min(100, 100 * S.xp / xpNeed(S.level)) + '%';
}
function renderBoard() {
  const b = $('board'); b.innerHTML = '';
  S.board.forEach((id, i) => {
    const c = document.createElement('div'); c.className = 'cell'; c.dataset.i = i;
    if (id) { const it = ITEMS[id]; if (it.gen) c.classList.add('gen');
      const im = document.createElement('img'); im.className = 'item'; im.src = it.asset; im.alt = it.zh; im.draggable = false; c.appendChild(im);
      const t = document.createElement('span'); t.className = 'tier'; t.textContent = it.gen ? '⚡' + it.cost : it.tier; c.appendChild(t);
    }
    if (i === sel) c.classList.add('sel');
    b.appendChild(c);
  });
}
function reqsOf(o) { const m = {}; o.required.forEach(r => m[r.item] = (m[r.item] || 0) + r.count); return m; }
function countOnBoard() { const m = {}; S.board.forEach(id => id && (m[id] = (m[id] || 0) + 1)); return m; }
function canFulfill(o) { const have = countOnBoard(), need = reqsOf(o); return Object.keys(need).every(k => (have[k] || 0) >= need[k]); }
function renderOrders() {
  const box = $('orders'); box.innerHTML = ''; const have = countOnBoard();
  S.active.forEach((oi, slot) => {
    const o = ORDERS[oi]; if (!o) return;
    const ch = CHARS[o.character] || {}; const el = document.createElement('div'); el.className = 'order';
    const used = {};
    const reqs = o.required.flatMap(r => Array(r.count).fill(r.item)).map(id => { used[id] = (used[id] || 0) + 1; const ok = (have[id] || 0) >= used[id];
      return `<div class="req${ok ? ' ok' : ''}" title="${ITEMS[id] ? ITEMS[id].zh : id}"><img src="${ITEMS[id] ? ITEMS[id].asset : ''}" alt=""></div>`; }).join('');
    const ready = canFulfill(o);
    el.innerHTML = `<div class="top"><img src="${ch.portrait}" alt=""><div class="who">${ch.zh || o.character}</div></div>
      <div class="txt">${o.text_zh}</div><div class="reqs">${reqs}</div>
      <div class="rew">🪙${o.reward.coins} ✨${o.reward.xp}${o.reward.stars ? ' ⭐' + o.reward.stars : ''}</div>
      <button class="${ready ? 'ready' : ''}" ${ready ? '' : 'disabled'}>交付</button>`;
    el.querySelector('button').onclick = () => complete(slot);
    box.appendChild(el);
  });
}
function renderAll() { renderBg(); renderHUD(); renderBoard(); renderOrders(); renderSel(); }
function renderSel() {
  const id = S.board[sel], it = id && ITEMS[id];
  $('selname').textContent = it ? (it.gen ? `${it.zh}（生成器，点击消耗 ${it.cost} 体力）` : `${it.zh} ${it.en} · ${it.tier} 级${it.next ? '' : '（满级）'}`) : '点击生成器产出物品，拖动两个相同物品合成升级';
  $('sellBtn').disabled = !it || it.gen; $('sellBtn').textContent = it && !it.gen ? `出售 +${it.sell}` : '出售';
}
function pop(i) { const c = $('board').children[i]; c && c.querySelector('.item') && c.querySelector('.item').classList.add('pop'); }

// ---- actions ----
function tapGenerator(i) {
  const g = ITEMS[S.board[i]];
  if (S.energy < g.cost) return toast('体力不足，稍等恢复');
  const empty = nearestEmpty(i); if (empty < 0) return toast('棋盘已满');
  S.energy -= g.cost; if (S.energy < MAX_ENERGY && S.energy + g.cost >= MAX_ENERGY) S.lastRegen = Date.now();
  S.board[empty] = (Math.random() < 0.15 && g.second) ? g.second : g.first;
  save(); renderAll(); pop(empty);
}
function nearestEmpty(from) {
  const fx = from % COLS, fy = (from / COLS) | 0; let best = -1, bd = 1e9;
  S.board.forEach((v, j) => { if (v) return; const d = Math.abs(j % COLS - fx) + Math.abs(((j / COLS) | 0) - fy); if (d < bd) { bd = d; best = j; } });
  return best;
}
function move(a, b) {
  if (a === b) return false;
  const A = S.board[a], B = S.board[b];
  if (!A) return false;
  if (A === B && !ITEMS[A].gen && ITEMS[A].next) {
    S.board[a] = null; S.board[b] = ITEMS[A].next; addXp(1);
    emit('merged', { from: A, to: ITEMS[A].next, cell: b });
    sel = b; save(); renderAll(); pop(b); return 'merge';
  }
  S.board[a] = B; S.board[b] = A; sel = b; save(); renderAll(); return 'swap';
}
function addXp(n) {
  S.xp += n;
  while (S.xp >= xpNeed(S.level)) { S.xp -= xpNeed(S.level); S.level++; S.energy = Math.min(MAX_ENERGY, S.energy + 10); toast('升级！Lv ' + S.level + '，体力 +10'); emit('levelUp', S.level); }
}
function complete(slot) {
  const o = ORDERS[S.active[slot]]; if (!o || !canFulfill(o)) return;
  const need = reqsOf(o);
  for (const k in need) for (let n = need[k], j = N - 1; j >= 0 && n > 0; j--) if (S.board[j] === k) { S.board[j] = null; n--; }
  S.coins += o.reward.coins; S.stars += o.reward.stars || 0; addXp(o.reward.xp);
  S.done.push(o.id);
  S.active.splice(slot, 1); fillOrders(S);
  toast(`订单完成！🪙+${o.reward.coins}`); emit('orderCompleted', o);
  sel = -1; save(); renderAll();
}
function sell() { const id = S.board[sel]; if (!id || ITEMS[id].gen) return; S.coins += ITEMS[id].sell; S.board[sel] = null; sel = -1; save(); renderAll(); }

// ---- input: pointer-based drag & drop, tap ----
let drag = null;
function cellAt(x, y) { const el = document.elementFromPoint(x, y); const c = el && el.closest && el.closest('.cell'); return c ? +c.dataset.i : -1; }
function onDown(e) {
  const c = e.target.closest('.cell'); if (!c) return; const i = +c.dataset.i;
  drag = { i, x: e.clientX, y: e.clientY, moved: false, ghost: null };
}
function onMove(e) {
  if (!drag || !S.board[drag.i]) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
  if (!drag.moved) { drag.moved = true; const g = document.createElement('img'); g.id = 'ghost'; g.src = ITEMS[S.board[drag.i]].asset; document.body.appendChild(g); drag.ghost = g;
    const it = $('board').children[drag.i].querySelector('.item'); if (it) it.style.opacity = .3;
    S.board.forEach((v, j) => v === S.board[drag.i] && j !== drag.i && !ITEMS[v].gen && $('board').children[j].classList.add('hint')); }
  drag.ghost.style.left = e.clientX - 28 + 'px'; drag.ghost.style.top = e.clientY - 28 + 'px';
}
function onUp(e) {
  if (!drag) return; const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  if (d.moved) { const t = cellAt(e.clientX, e.clientY); if (t >= 0 && move(d.i, t)) return; renderAll(); return; }
  const id = S.board[d.i];
  if (id && ITEMS[id].gen) { if (sel === d.i) tapGenerator(d.i); else { sel = d.i; tapGenerator(d.i); } return; }
  sel = d.i; renderBoard(); renderSel();
}

async function init() {
  await load();
  S = restore(); S = S ? migrate(S) : newState();
  regen(); renderAll();
  const b = $('board');
  b.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  $('sellBtn').onclick = sell;
  $('resetBtn').onclick = () => { if (confirm('确定重置存档？')) { localStorage.removeItem(SAVE_KEY); S = newState(); sel = -1; renderAll(); save(); chapterIntro(1); } };
  $('renoBtn').onclick = () => { renderReno(); $('renoPanel').classList.add('show'); };
  $('renoClose').onclick = () => $('renoPanel').classList.remove('show');
  $('dialog').onclick = nextLine;
  // story hooks
  hooks.orderCompleted.push(o => { if (o.reward.stars) showDialogue([{ speaker: o.character, zh: '太感谢了！这颗星星送你，拿去修港口吧。（⭐+' + o.reward.stars + '）' }]); });
  hooks.levelUp.push(lv => showDialogue([{ speaker: 'lan', zh: `等级 ${lv}！港口的大家越来越信任我了。（⭐+1，可以去装修了）` }]));
  chapterIntro(S.chapter || 1);
  setInterval(() => { regen(); renderHUD(); }, 1000);
  save();
}
// public API for tests and the future story/renovation module
window.MH = { hooks, get state() { return S; }, items: () => ITEMS, story: () => STORY, move, tapGenerator, complete, renovate, showDialogue, save, ready: init() };
})();
