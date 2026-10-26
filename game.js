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
// 修复进度 p∈[0,1]：前半段旧港上淡入中景，后半段中景淡出、修复后淡入。底层旧港保持不透明。
function renoBgOpacity(p) {
  const t = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
  return {
    before: 1,
    mid: t <= 0.5 ? t * 2 : (1 - t) * 2,
    after: t <= 0.5 ? 0 : (t - 0.5) * 2
  };
}
function renderBg() {
  const total = allRenos().length || 1;
  const o = renoBgOpacity(S.renovations.length / total);
  $('bgBefore').style.opacity = o.before.toFixed(3);
  $('bgMid').style.opacity = o.mid.toFixed(3);
  $('bgAfter').style.opacity = o.after.toFixed(3);
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
  SFX.renovate(); bump('stars'); const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
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
// ---- sound (WebAudio, synthesized) ----
const MUTE_KEY = 'mergeHarbor.muted';
let actx = null, muted = localStorage.getItem(MUTE_KEY) === '1';
function tone(freq, dur = 0.12, type = 'sine', vol = 0.18, delay = 0, slide = 0) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
const SFX = {
  spawn: () => tone(520, 0.1, 'triangle', 0.15, 0, 1.5),
  merge: tier => { const f = 330 * Math.pow(2, (tier - 1) / 6); tone(f, 0.12, 'sine', 0.2); tone(f * 1.5, 0.16, 'sine', 0.14, 0.06); },
  deliver: () => [523, 659, 784].forEach((f, i) => tone(f, 0.14, 'triangle', 0.16, i * 0.07)),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.08, i * 0.09)),
  renovate: () => { tone(196, 0.3, 'sawtooth', 0.06, 0, 2); [784, 988, 1175].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, 0.15 + i * 0.08)); },
  deny: () => tone(160, 0.12, 'square', 0.06),
};
function setMuted(m) { muted = m; localStorage.setItem(MUTE_KEY, m ? '1' : '0'); $('muteBtn').textContent = m ? '🔇' : '🔊'; $('muteBtn').setAttribute('aria-pressed', m); }

// ---- animation helpers ----
const cellEl = i => $('board').children[i];
function fly(src, fromRect, toEl, dur = 420) {
  if (!fromRect || !toEl) return; const to = toEl.getBoundingClientRect();
  const g = document.createElement('img'); g.src = src; g.className = 'flyer';
  const sz = Math.min(fromRect.width, 64); Object.assign(g.style, { left: fromRect.left + (fromRect.width - sz) / 2 + 'px', top: fromRect.top + (fromRect.height - sz) / 2 + 'px', width: sz + 'px', height: sz + 'px' });
  document.body.appendChild(g);
  const dx = to.left + to.width / 2 - (fromRect.left + fromRect.width / 2), dy = to.top + to.height / 2 - (fromRect.top + fromRect.height / 2);
  const a = g.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.5)`, opacity: .6 }], { duration: dur, easing: 'cubic-bezier(.5,-.3,.6,1)' });
  a.onfinish = () => g.remove();
}
function sparkle(i) {
  const c = cellEl(i); if (!c) return;
  for (let k = 0; k < 8; k++) { const s = document.createElement('i'); s.className = 'spark'; const ang = k / 8 * Math.PI * 2;
    s.style.setProperty('--dx', Math.cos(ang) * 34 + 'px'); s.style.setProperty('--dy', Math.sin(ang) * 34 + 'px'); c.appendChild(s); setTimeout(() => s.remove(), 600); }
}
function bump(id) { const el = $(id).closest('.stat'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
function spawnIn(from, to) {
  const c = cellEl(to), it = c && c.querySelector('.item'); if (!it) return;
  const a = cellEl(from).getBoundingClientRect(), b = c.getBoundingClientRect();
  it.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(.4)`, opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.3,1.4,.6,1)' });
}
function hintTargets(i) {
  [...$('board').children].forEach(c => c.classList.remove('hint'));
  const v = S.board[i]; if (!v || ITEMS[v].gen || !ITEMS[v].next) return;
  S.board.forEach((w, j) => w === v && j !== i && cellEl(j).classList.add('hint'));
}

function pop(i) { const c = $('board').children[i]; c && c.querySelector('.item') && c.querySelector('.item').classList.add('pop'); }

// ---- actions ----
function tapGenerator(i) {
  const g = ITEMS[S.board[i]];
  if (S.energy < g.cost) { SFX.deny(); return toast('体力不足，稍等恢复'); }
  const empty = nearestEmpty(i); if (empty < 0) { SFX.deny(); return toast('棋盘已满'); }
  S.energy -= g.cost; if (S.energy < MAX_ENERGY && S.energy + g.cost >= MAX_ENERGY) S.lastRegen = Date.now();
  S.board[empty] = (Math.random() < 0.15 && g.second) ? g.second : g.first;
  save(); renderAll(); spawnIn(i, empty); SFX.spawn();
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
    sel = b; save(); renderAll(); pop(b); sparkle(b); SFX.merge(ITEMS[S.board[b]].tier); hintTargets(b); return 'merge';
  }
  S.board[a] = B; S.board[b] = A; sel = b; save(); renderAll(); return 'swap';
}
function addXp(n) {
  S.xp += n;
  while (S.xp >= xpNeed(S.level)) { S.xp -= xpNeed(S.level); S.level++; S.energy = Math.min(MAX_ENERGY, S.energy + 10); toast('升级！Lv ' + S.level + '，体力 +10'); SFX.level(); setTimeout(() => bump('level'), 0); emit('levelUp', S.level); }
}
function complete(slot) {
  const o = ORDERS[S.active[slot]]; if (!o || !canFulfill(o)) return;
  const need = reqsOf(o), card = $('orders').children[slot], flights = [];
  for (const k in need) for (let n = need[k], j = N - 1; j >= 0 && n > 0; j--) if (S.board[j] === k) { flights.push([ITEMS[k].asset, cellEl(j).getBoundingClientRect()]); S.board[j] = null; n--; }
  flights.forEach(([src, r], k) => setTimeout(() => fly(src, r, card), k * 60));
  SFX.deliver(); setTimeout(() => { bump('coins'); if (o.reward.stars) bump('stars'); }, 420);
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
  sel = d.i; renderBoard(); renderSel(); hintTargets(d.i);
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
  setMuted(muted); $('muteBtn').onclick = () => { setMuted(!muted); if (!muted) SFX.spawn(); };
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
window.MH = { hooks, get state() { return S; }, items: () => ITEMS, story: () => STORY, move, tapGenerator, sfx: SFX, isMuted: () => muted, complete, renovate, showDialogue, save, ready: init() };
})();
