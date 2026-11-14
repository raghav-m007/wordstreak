import {
  TARGET, STEPS, today, addDays, daysBetween, blank, status, grade, preview,
  buildQueue, practiceQueue, counts,
} from './srs.js';

const KEY = 'wordstreak:v1';
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state
const DEFAULTS = {
  progress: {},           // id -> progress record (see srs.blank)
  settings: { newPerDay: 15, spacing: 'standard' },
  words: [],              // last word list we saw
  wordsUpdated: null,     // when the sheet last changed
  wordsChecked: null,     // when the sheet was last checked
  days: {},               // 'YYYY-MM-DD' -> { reviewed, correct }
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...s, settings: { ...DEFAULTS.settings, ...s.settings } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage full or blocked */ }
}

// Ask iOS/Chrome not to evict our storage.
navigator.storage?.persist?.().catch(() => {});

// ---------------------------------------------------------------- words sync
async function syncWords({ manual = false } = {}) {
  let data;
  try {
    const res = await fetch(`./words.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    if (manual) toast('Offline — using the words you already have');
    return;
  }
  if (!Array.isArray(data.words) || !data.words.length) return;
  const known = new Set(S.words.map((w) => w.id));
  const added = S.words.length ? data.words.filter((w) => !known.has(w.id)) : [];
  S.words = data.words;
  S.wordsUpdated = data.updated || S.wordsUpdated;
  S.wordsChecked = data.checked || data.updated || S.wordsChecked;
  save();
  if (added.length) {
    const names = added.slice(0, 3).map((w) => w.word).join(', ');
    showBanner(`${added.length} new word${added.length > 1 ? 's' : ''} from your sheet: ${names}${added.length > 3 ? '…' : ''}`);
  } else if (manual) {
    toast(`Up to date · ${data.words.length} words`);
  }
  renderAll();
}

// ---------------------------------------------------------------- helpers
const words = () => S.words;
const byId = (id) => S.words.find((w) => w.id === id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dots(streak) {
  const n = Math.min(streak || 0, TARGET);
  let html = `<span class="dots${n >= TARGET ? ' full' : ''}" aria-label="${n} of ${TARGET}">`;
  for (let i = 0; i < TARGET; i += 1) html += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `${html}</span>`;
}

// Find the word inside its example ("delineated" -> "delineate", "sets in").
function wordPattern(word) {
  const w = word.trim().toLowerCase().replace(/[^\p{L}\s'-]/gu, '').trim();
  if (!w) return null;
  if (/\s/.test(w)) {
    const parts = w.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(parts.join('\\s+'), 'gi');
  }
  let stem = w.replace(/(ies|ied|ing|ed|es|s|ly)$/i, '');
  if (stem.length < 4) stem = w.slice(0, Math.max(4, Math.min(w.length, 5)));
  stem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${stem}[\\p{L}]*`, 'giu');
}
function highlight(text, word) {
  const rx = wordPattern(word);
  const safe = esc(text);
  return rx ? safe.replace(rx, (m) => `<mark>${m}</mark>`) : safe;
}
function blankOut(text, word) {
  const rx = wordPattern(word);
  return rx ? esc(text).replace(rx, '_____') : esc(text);
}

function relDay(day) {
  const d = daysBetween(today(), day);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return `in ${d} days`;
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function fmtDate(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function studyStreak() {
  let n = 0;
  let d = today();
  if (!S.days[d]?.reviewed) d = addDays(d, -1); // today not started yet: count from yesterday
  while (S.days[d]?.reviewed) { n += 1; d = addDays(d, -1); }
  return n;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function showBanner(msg) {
  const b = $('banner');
  b.textContent = msg;
  b.hidden = false;
}

// ---------------------------------------------------------------- today
function renderToday() {
  const day = today();
  const c = counts(words(), S.progress, day);
  const queue = buildQueue(words(), S.progress, day, S.settings.newPerDay);
  const newInQueue = queue.filter((id) => status(S.progress[id]) === 'new').length;
  const reviewsInQueue = queue.length - newInQueue;
  const hero = $('hero');

  if (!words().length) {
    hero.innerHTML = '<p class="eyebrow">Today</p><h2>Loading words…</h2><p>Fetching your list from the sheet.</p>';
  } else if (queue.length) {
    const parts = [];
    if (reviewsInQueue) parts.push(`${reviewsInQueue} to review`);
    if (newInQueue) parts.push(`${newInQueue} new`);
    const mins = Math.max(1, Math.round(queue.length * 0.25));
    hero.innerHTML = `
      <p class="eyebrow">Today</p>
      <h2>${queue.length} card${queue.length > 1 ? 's' : ''}</h2>
      <p>${parts.join(' · ')} · about ${mins} min</p>
      <button class="btn primary" id="start">Start</button>`;
    $('start').onclick = () => startSession(queue, 'review');
  } else {
    const next = c.dueTomorrow ? `${c.dueTomorrow} word${c.dueTomorrow > 1 ? 's' : ''} due tomorrow.` : 'Nothing due tomorrow.';
    const canPractice = c.learning + c.new > 0;
    hero.innerHTML = `
      <p class="eyebrow">Today</p>
      <h2>All done</h2>
      <p>${c.learnt === c.total ? 'Every word is learnt. Add more in the sheet.' : next} Spacing is what makes it stick, so come back tomorrow.</p>
      ${canPractice ? '<button class="btn ghost" id="practice">Extra practice (doesn’t count)</button>' : ''}`;
    if (canPractice) $('practice').onclick = () => startSession(practiceQueue(words(), S.progress), 'practice');
  }

  $('tiles').innerHTML = `
    <div class="tile"><b>${c.learnt}</b><span><i style="background:var(--got)"></i>Learnt</span></div>
    <div class="tile"><b>${c.learning}</b><span><i style="background:var(--learn)"></i>Learning</span></div>
    <div class="tile"><b>${c.new}</b><span><i style="background:var(--dot-off)"></i>New</span></div>`;
  const pct = (n) => (c.total ? `${(n / c.total) * 100}%` : '0');
  $('bar-learnt').style.width = pct(c.learnt);
  $('bar-learning').style.width = pct(c.learning);
  $('bar-label').textContent = c.total ? `${c.learnt} of ${c.total} words learnt (${Math.round((c.learnt / c.total) * 100)}%)` : '';

  const st = studyStreak();
  $('daystreak').hidden = st < 1;
  $('daystreak').textContent = `${st} day${st > 1 ? 's' : ''} in a row`;
  $('sync-foot').textContent = S.wordsChecked ? `Word list from your sheet · checked ${fmtDate(S.wordsChecked)}` : '';
}

// ---------------------------------------------------------------- session
let session = null;

function startSession(queue, mode) {
  if (!queue.length) return;
  session = { queue: [...queue], i: 0, mode, total: queue.length, counted: 0, right: 0, learntNow: [], seen: new Set() };
  $('review').hidden = false;
  document.body.style.overflow = 'hidden';
  showCard();
}

function endSession() {
  $('review').hidden = true;
  document.body.style.overflow = '';
  speechSynthesis?.cancel?.();
  const s = session;
  session = null;
  if (s && s.seen.size) {
    const body = s.mode === 'practice'
      ? `You went through ${s.seen.size} word${s.seen.size > 1 ? 's' : ''}. Practice doesn’t change streaks.`
      : `${s.right} of ${s.counted} right on the first try.${s.learntNow.length ? ` Newly learnt: ${s.learntNow.join(', ')}.` : ''}`;
    $('done-title').textContent = s.learntNow.length ? `${s.learntNow.length} word${s.learntNow.length > 1 ? 's' : ''} learnt!` : 'Session done';
    $('done-body').textContent = body;
    $('done').hidden = false;
  }
  renderAll();
}

function currentWord() { return session && byId(session.queue[session.i]); }

function showCard() {
  // Skip ids whose word vanished from the sheet mid-session.
  while (session.i < session.queue.length && !byId(session.queue[session.i])) session.i += 1;
  if (session.i >= session.queue.length) { endSession(); return; }
  const w = currentWord();
  const p = S.progress[w.id];
  const day = today();
  const st = status(p);
  const relearn = p && p.last === day && session.mode === 'review';

  const chip = $('card-chip');
  if (session.mode === 'practice') { chip.textContent = 'Practice'; chip.className = 'chip practice'; }
  else if (relearn) { chip.textContent = 'Try again'; chip.className = 'chip relearn'; }
  else if (st === 'new') { chip.textContent = 'New word'; chip.className = 'chip new'; }
  else if (st === 'learnt') { chip.textContent = 'Check-up'; chip.className = 'chip'; }
  else { chip.textContent = `${Math.min(p.streak, TARGET)} of ${TARGET}`; chip.className = 'chip'; }
  $('card-dots').innerHTML = st === 'new' ? '' : dots(p.streak);

  $('card-word').textContent = w.word;
  $('card-pron').textContent = w.pron || '';
  $('card-hint').hidden = true;
  $('btn-hint').disabled = !w.example;
  $('btn-hint').style.opacity = w.example ? 1 : 0.4;

  $('b-meaning').textContent = w.meaning;
  $('b-hindi').textContent = w.hindi;
  $('b-hindi-row').hidden = !w.hindi;
  $('b-example').innerHTML = highlight(w.example, w.word);
  $('b-example-row').hidden = !w.example;
  $('b-notes').innerHTML = (w.notes || []).map(esc).join('<br>');
  $('b-notes-row').hidden = !(w.notes || []).length;

  $('card-back').hidden = true;
  $('card').classList.remove('is-back');
  $('front-actions').hidden = false;
  $('grade-actions').hidden = true;
  $('rv-note').textContent = session.mode === 'practice' ? 'Practice round — streaks are not affected' : 'Say the meaning in your head, then flip';

  // Restart the entry animation.
  const card = $('card');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  card.scrollTop = 0;

  const done = Math.min(session.i, session.total);
  $('rv-fill').style.width = `${(done / Math.max(session.queue.length, 1)) * 100}%`;
  $('rv-count').textContent = `${session.i + 1}/${session.queue.length}`;
}

function flip() {
  if (!session || !$('card-back').hidden) return;
  const w = currentWord();
  $('card-back').hidden = false;
  $('card-hint').hidden = true;
  $('card').classList.add('is-back');
  $('front-actions').hidden = true;
  $('grade-actions').hidden = false;
  if (session.mode === 'practice') { $('rv-note').textContent = 'Practice round — streaks are not affected'; return; }
  const pv = preview(S.progress[w.id], today(), S.settings.spacing);
  if (!pv.counted) $('rv-note').textContent = 'Retry — doesn’t change the streak';
  else if (pv.becomesLearnt) $('rv-note').textContent = `Got it → 5 of 5, learnt! · Missed → streak back to 0`;
  else if (pv.learnt) $('rv-note').textContent = `Got it → next check-up in ${pv.days} days · Missed → back to Learning`;
  else $('rv-note').textContent = `Got it → ${pv.streak} of ${TARGET}, back in ${pv.days} day${pv.days > 1 ? 's' : ''} · Missed → 0`;
}

function answer(correct) {
  if (!session || $('card-back').hidden) return;
  const w = currentWord();
  session.seen.add(w.id);
  if (session.mode === 'review') {
    const day = today();
    const before = S.progress[w.id];
    const { p, counted } = grade(before, correct, day, S.settings.spacing);
    S.progress[w.id] = p;
    if (counted) {
      session.counted += 1;
      if (correct) session.right += 1;
      const d = S.days[day] || (S.days[day] = { reviewed: 0, correct: 0 });
      d.reviewed += 1;
      if (correct) d.correct += 1;
      if (p.learnt && !(before && before.learnt)) session.learntNow.push(w.word);
    }
    save();
  }
  if (!correct) {
    // Bring it back a few cards later so you recall it once before moving on.
    const at = Math.min(session.queue.length, session.i + 4);
    session.queue.splice(at, 0, w.id);
  }
  session.i += 1;
  showCard();
}

$('card').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  flip();
});
$('btn-flip').onclick = flip;
$('btn-hint').onclick = () => {
  const w = currentWord();
  if (!w || !w.example) return;
  $('card-hint').innerHTML = `“${blankOut(w.example, w.word)}”`;
  $('card-hint').hidden = false;
};
$('card-speak').onclick = () => { const w = currentWord(); if (w) speak(w.word); };
$('btn-got').onclick = () => answer(true);
$('btn-miss').onclick = () => answer(false);
$('rv-close').onclick = endSession;
$('done-close').onclick = () => { $('done').hidden = true; };

document.addEventListener('keydown', (e) => {
  if (!session || e.target.tagName === 'INPUT') return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if ($('card-back').hidden) flip(); else answer(true); }
  else if (e.key === '1' || e.key === 'ArrowLeft') answer(false);
  else if (e.key === '2' || e.key === 'ArrowRight') answer(true);
  else if (e.key === 'h') $('btn-hint').click();
  else if (e.key === 'Escape') endSession();
});

// ---------------------------------------------------------------- words tab
let filter = 'all';
function renderWords() {
  const q = $('search').value.trim().toLowerCase();
  const c = counts(words(), S.progress, today());
  const labels = { all: ['All', c.total], learning: ['Learning', c.learning], learnt: ['Learnt', c.learnt], new: ['New', c.new] };
  for (const b of $('filter').children) {
    const [name, n] = labels[b.dataset.f];
    b.innerHTML = `${name}<small>${n}</small>`;
    b.classList.toggle('on', b.dataset.f === filter);
  }
  const order = { learning: 0, new: 1, learnt: 2 };
  const rows = words()
    .filter((w) => filter === 'all' || status(S.progress[w.id]) === filter)
    .filter((w) => !q || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q))
    .sort((a, b) => {
      if (filter !== 'all') return 0;
      return order[status(S.progress[a.id])] - order[status(S.progress[b.id])];
    });
  $('list').innerHTML = rows.length
    ? rows.map((w) => `<li data-id="${esc(w.id)}"><div class="lw"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></div>${status(S.progress[w.id]) === 'new' ? '' : dots(S.progress[w.id].streak)}</li>`).join('')
    : `<li class="empty">${q ? 'No match' : filter === 'learnt' ? 'No learnt words yet — 5 correct days in a row gets one here' : 'Nothing here'}</li>`;
}
$('search').addEventListener('input', renderWords);
$('filter').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.f;
  renderWords();
});
$('list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openSheet(li.dataset.id);
});

function openSheet(id) {
  const w = byId(id);
  if (!w) return;
  const p = { ...blank(), ...S.progress[id] };
  const st = status(S.progress[id]);
  const statusText = st === 'new' ? 'Not studied yet'
    : st === 'learnt' ? `Learnt ${p.learntOn ? fmtDate(`${p.learntOn}T12:00:00`) : ''} · next check-up ${relDay(p.due)}`
      : `Learning · ${Math.min(p.streak, TARGET)} of ${TARGET} · next ${relDay(p.due)}`;
  $('sheet-body').innerHTML = `
    <div class="sh-head"><h3>${esc(w.word)}</h3><button class="icon" id="sh-speak" aria-label="Pronounce"><svg><use href="#i-speak"/></svg></button></div>
    <p class="sh-status">${st === 'new' ? '' : dots(p.streak)}<span>${esc(statusText)}</span></p>
    <div class="card-back" style="border:0;padding:0;margin:0">
      <p class="meaning">${esc(w.meaning)}</p>
      <dl>
        ${w.hindi ? `<div><dt>Hindi</dt><dd>${esc(w.hindi)}</dd></div>` : ''}
        ${w.example ? `<div><dt>Example</dt><dd>${highlight(w.example, w.word)}</dd></div>` : ''}
        ${(w.notes || []).length ? `<div><dt>Your note</dt><dd>${w.notes.map(esc).join('<br>')}</dd></div>` : ''}
      </dl>
    </div>
    ${st === 'new' ? '' : `<div class="stats">
      <div><b>${p.reviews}</b><span>reviews</span></div>
      <div><b>${p.reviews ? Math.round((p.correct / p.reviews) * 100) : 0}%</b><span>right</span></div>
      <div><b>${p.best}</b><span>best streak</span></div>
    </div>`}
    <div class="sh-actions">
      ${st === 'new' ? '' : '<button class="btn ghost" id="sh-reset">Reset this word</button>'}
      <button class="btn ghost" id="sh-close">Close</button>
    </div>`;
  $('sheet').hidden = false;
  $('sheet-scrim').hidden = false;
  $('sh-speak').onclick = () => speak(w.word);
  $('sh-close').onclick = closeSheet;
  const r = $('sh-reset');
  if (r) r.onclick = () => {
    if (!confirm(`Reset progress for “${w.word}”? It goes back to New.`)) return;
    delete S.progress[id];
    save();
    closeSheet();
    renderAll();
  };
}
function closeSheet() { $('sheet').hidden = true; $('sheet-scrim').hidden = true; }
$('sheet-scrim').onclick = closeSheet;

// ---------------------------------------------------------------- settings
const NEW_STEPS = [5, 10, 15, 20, 30, 999];
function renderSettings() {
  const n = S.settings.newPerDay;
  $('newPerDay').textContent = n >= 999 ? 'All' : n;
  for (const b of $('spacing').children) b.classList.toggle('on', b.dataset.s === S.settings.spacing);
  $('spacing-note').textContent = S.settings.spacing === 'crunch'
    ? 'Every day until learnt — fastest route to 5 in a row, weaker long-term'
    : 'Gaps grow 1 → 2 → 3 → 5 days. Learnt in about 11 days, lasts longer';
  $('sync-info').textContent = `${words().length} words · sheet checked ${fmtDate(S.wordsChecked)} · changed ${fmtDate(S.wordsUpdated)}`;
}
document.querySelectorAll('.stepper button').forEach((b) => {
  b.onclick = () => {
    const i = NEW_STEPS.indexOf(S.settings.newPerDay);
    const j = Math.max(0, Math.min(NEW_STEPS.length - 1, (i < 0 ? 2 : i) + Number(b.dataset.step)));
    S.settings.newPerDay = NEW_STEPS[j];
    save();
    renderAll();
  };
});
$('spacing').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !STEPS[b.dataset.s]) return;
  S.settings.spacing = b.dataset.s;
  save();
  renderAll();
});
$('sync-now').onclick = () => syncWords({ manual: true });

$('export').onclick = async () => {
  const blob = JSON.stringify({ app: 'wordstreak', v: 1, at: new Date().toISOString(), progress: S.progress, settings: S.settings, days: S.days });
  try {
    await navigator.clipboard.writeText(blob);
    toast('Backup copied — paste it into Notes');
  } catch {
    prompt('Copy this backup:', blob);
  }
};
$('import').onclick = () => {
  const txt = prompt('Paste a Wordstreak backup:');
  if (!txt) return;
  try {
    const b = JSON.parse(txt);
    if (b.app !== 'wordstreak' || typeof b.progress !== 'object') throw new Error('bad');
    if (!confirm(`Replace progress on this phone with the backup from ${fmtDate(b.at)}?`)) return;
    S.progress = b.progress;
    S.settings = { ...S.settings, ...b.settings };
    S.days = b.days || {};
    save();
    renderAll();
    toast('Backup restored');
  } catch {
    toast('That doesn’t look like a Wordstreak backup');
  }
};
$('reset-all').onclick = () => {
  if (!confirm('Wipe every streak and start over? This can’t be undone (unless you copied a backup).')) return;
  S.progress = {};
  S.days = {};
  save();
  renderAll();
  toast('Progress reset');
};

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const t of ['today', 'words', 'settings']) $(`tab-${t}`).hidden = t !== name;
  for (const b of $('tabbar').children) b.classList.toggle('on', b.dataset.tab === name);
  window.scrollTo(0, 0);
}
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showTab(b.dataset.tab);
});

function renderAll() {
  renderToday();
  renderWords();
  renderSettings();
}

// ---------------------------------------------------------------- boot
renderAll();
syncWords();
// Coming back to the app the next day: refresh the queue and the list.
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (today() !== lastDay) { lastDay = today(); $('banner').hidden = true; }
  if (!session) renderAll();
  syncWords();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy when testing from the console.
window.__ws = { get state() { return S; }, save, renderAll, today, addDays };
