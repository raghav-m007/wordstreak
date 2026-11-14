import {
  TARGET, STEPS, today, addDays, daysBetween, blank, status, grade, preview,
  buildQueue, practiceQueue, counts,
} from './srs.js';

const KEY = 'wordstreak:v1';
const LEVEL_SIZE = 10;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state
const DEFAULTS = {
  progress: {},           // id -> progress record (see srs.blank)
  settings: { newPerDay: 15, spacing: 'standard', qstyle: 'choice' },
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
  if (!session) renderAll();
}

// ---------------------------------------------------------------- helpers
const words = () => S.words;
const byId = (id) => S.words.find((w) => w.id === id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dots(streak, big = false) {
  const n = Math.min(streak || 0, TARGET);
  let html = `<span class="dots${n >= TARGET ? ' full' : ''}${big ? ' big' : ''}" aria-label="${n} of ${TARGET}">`;
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
function emphasise(text, word) {
  const rx = wordPattern(word);
  const safe = esc(text);
  return rx ? safe.replace(rx, (m) => `<b>${m}</b>`) : safe;
}
function blankOut(text, word) {
  const rx = wordPattern(word);
  return rx ? esc(text).replace(rx, '_____') : esc(text);
}

// Short definition for the answer choices: first clause of the meaning.
function gloss(meaning) {
  let s = String(meaning || '').split(/;|\s[-–—]\s|\.\s/)[0].trim().replace(/[.,]$/, '');
  if (s.length > 95) {
    s = s.slice(0, 95);
    s = `${s.slice(0, s.lastIndexOf(' '))}…`;
  }
  return s;
}
function kind(meaning) {
  const m = String(meaning || '').trim();
  if (/^to\s/i.test(m)) return 'verb';
  if (/^(a|an|the)\s/i.test(m)) return 'noun';
  return 'other';
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// One right answer and three believable wrong ones (same part of speech when possible).
function choicesFor(w) {
  const right = gloss(w.meaning);
  const k = kind(w.meaning);
  const others = shuffle(words().filter((o) => o.id !== w.id && gloss(o.meaning) !== right));
  const same = others.filter((o) => kind(o.meaning) === k);
  const picked = [...same.slice(0, 3)];
  for (const o of others) { if (picked.length >= 3) break; if (!picked.includes(o)) picked.push(o); }
  return shuffle([{ text: right, correct: true }, ...picked.map((o) => ({ text: gloss(o.meaning), correct: false }))]);
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
  if (!S.days[d]?.reviewed) d = addDays(d, -1);
  while (S.days[d]?.reviewed) { n += 1; d = addDays(d, -1); }
  return n;
}

// ---------------------------------------------------------------- voice
// The default web voice on iOS can be the robotic "compact" one. Pick the
// best English voice the phone has (Siri / Premium / Enhanced first).
let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const prefs = [/siri/i, /premium/i, /enhanced/i, /^samantha/i, /^ava/i, /^daniel/i, /^karen/i, /^serena/i, /google us english/i, /google uk english female/i];
  for (const rx of prefs) {
    const v = vs.find((x) => rx.test(x.name) && /en[-_](us|gb|in|au)/i.test(x.lang)) || vs.find((x) => rx.test(x.name));
    if (v) return v;
  }
  return vs.find((v) => v.lang.replace('_', '-') === 'en-US' && v.localService) || vs.find((v) => v.lang.replace('_', '-') === 'en-US') || vs[0] || null;
}
if ('speechSynthesis' in window) {
  voice = pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); renderSettings(); });
}
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim());
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
  u.rate = 0.92;
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

// ---------------------------------------------------------------- study (home)
function levels() {
  const out = [];
  for (let i = 0; i < words().length; i += LEVEL_SIZE) out.push(words().slice(i, i + LEVEL_SIZE));
  return out;
}

function renderToday() {
  const day = today();
  const c = counts(words(), S.progress, day);
  const queue = buildQueue(words(), S.progress, day, S.settings.newPerDay);
  const newInQueue = queue.filter((id) => status(S.progress[id]) === 'new').length;
  const reviewsInQueue = queue.length - newInQueue;
  const hero = $('hero');

  if (!words().length) {
    hero.innerHTML = '<div class="h-body"><h2>Loading words…</h2><p>Fetching your list from the sheet.</p></div>';
  } else if (queue.length) {
    const parts = [];
    if (reviewsInQueue) parts.push(plural(reviewsInQueue, 'review'));
    if (newInQueue) parts.push(`${newInQueue} new`);
    hero.innerHTML = `
      <div class="h-body"><h2>Today’s words: ${queue.length}</h2><p>${parts.join(' · ')} · about ${Math.max(1, Math.round(queue.length * 0.2))} min</p></div>
      <button class="cta go" id="start">Start studying ›</button>`;
    $('start').onclick = () => startSession(queue, 'Today');
  } else {
    const next = c.dueTomorrow ? `${plural(c.dueTomorrow, 'word')} due tomorrow.` : 'Nothing due tomorrow.';
    const canPractice = c.learning + c.new > 0;
    hero.innerHTML = `
      <div class="h-body"><h2>All done for today ✓</h2><p>${c.learnt === c.total ? 'Every word is learnt. Add more in the sheet.' : next} Coming back tomorrow is what makes words stick.</p></div>
      ${canPractice ? '<button class="cta" id="practice">Extra practice (doesn’t count) ›</button>' : ''}`;
    if (canPractice) $('practice').onclick = () => startSession(practiceQueue(words(), S.progress), 'Practice');
  }

  $('ov-count').textContent = c.total ? `${c.learnt} of ${c.total} learnt` : '';
  const pct = (n) => (c.total ? `${(n / c.total) * 100}%` : '0');
  $('bar-learnt').style.width = pct(c.learnt);
  $('bar-learning').style.width = pct(c.learning);
  $('legend').innerHTML = `
    <span><i style="background:var(--got-bar)"></i>${c.learnt} learnt</span>
    <span><i style="background:var(--learn)"></i>${c.learning} learning</span>
    <span><i style="background:var(--dot-off)"></i>${c.new} new</span>`;

  $('levels').innerHTML = levels().map((lv, i) => {
    const learnt = lv.filter((w) => status(S.progress[w.id]) === 'learnt').length;
    const learning = lv.filter((w) => status(S.progress[w.id]) === 'learning').length;
    const complete = learnt === lv.length;
    const w = (n) => `${(n / lv.length) * 100}%`;
    return `<article class="panel lv${complete ? ' complete' : ''}">
      <div class="lv-body"><strong>Level ${i + 1}</strong><small>${learnt} of ${lv.length} words learnt</small>
        <div class="bar"><span class="b-learnt" style="width:${w(learnt)}"></span><span class="b-learning" style="width:${w(learning)}"></span></div></div>
      <button class="cta" data-level="${i}">${complete ? 'Level complete ✓ · Replay' : 'Study this level'} ›</button>
    </article>`;
  }).join('');

  const st = studyStreak();
  $('daystreak').hidden = st < 1;
  $('daystreak').textContent = `${plural(st, 'day')} in a row`;
  $('sync-foot').textContent = S.wordsChecked ? `Words from your sheet · checked ${fmtDate(S.wordsChecked)}` : '';
}
$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const i = Number(b.dataset.level);
  const lv = levels()[i] || [];
  const notLearnt = lv.filter((w) => status(S.progress[w.id]) !== 'learnt');
  startSession(shuffle((notLearnt.length ? notLearnt : lv).map((w) => w.id)), `Level ${i + 1}`);
});

// ---------------------------------------------------------------- quiz session
let session = null;

function startSession(queue, title) {
  if (!queue.length) return;
  session = { queue: [...queue], i: 0, title, counted: 0, right: 0, learntNow: [], seen: new Set(), card: null };
  $('rv-title').textContent = title;
  $('review').hidden = false;
  $('review').scrollTop = 0;
  showCard();
}

function endSession() {
  $('review').hidden = true;
  speechSynthesis?.cancel?.();
  const s = session;
  session = null;
  if (s && s.seen.size) {
    const body = s.counted
      ? `${s.right} of ${s.counted} right.${s.learntNow.length ? ` Newly learnt: ${s.learntNow.join(', ')}.` : ''}`
      : `You went through ${plural(s.seen.size, 'word')}. None were due yet, so streaks didn’t move.`;
    $('done-title').textContent = s.learntNow.length ? `${plural(s.learntNow.length, 'word')} learnt!` : 'Nice work';
    $('done-body').textContent = body;
    $('done').hidden = false;
  }
  renderAll();
}

const currentWord = () => session && byId(session.queue[session.i]);

function setHead(cls, title, sub) {
  $('q-head').className = `q-head${cls ? ` ${cls}` : ''}`;
  $('q-head-title').textContent = title;
  $('q-head-sub').textContent = sub;
}

function showCard() {
  while (session.i < session.queue.length && !byId(session.queue[session.i])) session.i += 1;
  if (session.i >= session.queue.length) { endSession(); return; }
  const w = currentWord();
  const p = S.progress[w.id];
  const day = today();
  const st = status(p);
  const choice = S.settings.qstyle !== 'flip';
  session.card = { id: w.id, answered: false, retry: session.seen.has(w.id) };

  const sub = choice ? 'Choose the best definition' : 'Say the meaning in your head, then tap';
  let title;
  if (session.card.retry) title = 'Try again';
  else if (st === 'new') title = 'New word';
  else if (st === 'learnt') title = 'Check-up';
  else if (p.last === day || (p.due && p.due > day)) title = 'Practice';
  else title = `Review · ${Math.min(p.streak, TARGET)} of ${TARGET}`;
  setHead('', title, sub);

  $('q-word').textContent = w.word;
  $('q-pron').textContent = w.pron || '';
  $('q-pron').hidden = !w.pron;

  const opts = $('options');
  opts.className = 'options';
  if (choice) {
    session.card.choices = choicesFor(w);
    opts.innerHTML = session.card.choices
      .map((c, i) => `<li><button data-i="${i}"><span class="mk"></span><span>${esc(c.text)}</span></button></li>`)
      .join('') + '<li class="unsure"><button data-i="-1"><span class="mk"></span><span>I’m not sure</span></button></li>';
    opts.hidden = false;
    $('flip-front').hidden = true;
  } else {
    opts.hidden = true;
    $('flip-front').hidden = false;
    $('hint').hidden = true;
    $('btn-hint').disabled = !w.example;
    $('btn-hint').style.opacity = w.example ? 1 : 0.4;
  }

  $('a-meaning').textContent = w.meaning;
  $('a-example').innerHTML = w.example ? emphasise(w.example, w.word) : '';
  $('a-example').hidden = !w.example;
  $('a-hindi').textContent = w.hindi;
  $('a-hindi-row').hidden = !w.hindi;
  $('a-notes').innerHTML = (w.notes || []).map(esc).join('<br>');
  $('a-notes-row').hidden = !(w.notes || []).length;
  $('answer').hidden = true;
  $('a-wrong').hidden = true;
  $('a-progress-text').parentElement.hidden = false;
  $('grade').hidden = true;
  $('btn-next').hidden = true;

  const card = $('qcard');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  $('review').scrollTop = 0;

  $('rv-fill').style.width = `${(session.i / Math.max(session.queue.length, 1)) * 100}%`;
  $('rv-count').textContent = `${session.i + 1} of ${session.queue.length}`;
}

// Record the answer; returns the text for the result header.
function record(correct) {
  const w = currentWord();
  const day = today();
  const before = S.progress[w.id];
  const pv = preview(before, day, S.settings.spacing);
  const { p, counted } = grade(before, correct, day, S.settings.spacing);
  S.progress[w.id] = p;
  session.seen.add(w.id);
  if (counted) {
    session.counted += 1;
    if (correct) session.right += 1;
    const d = S.days[day] || (S.days[day] = { reviewed: 0, correct: 0 });
    d.reviewed += 1;
    if (correct) d.correct += 1;
    if (p.learnt && !(before && before.learnt)) session.learntNow.push(w.word);
  }
  save();
  if (!correct) {
    // Bring it back a few words later so you get it right once before moving on.
    session.queue.splice(Math.min(session.queue.length, session.i + 4), 0, w.id);
  }

  let sub;
  if (!correct) sub = counted ? 'Streak back to 0 · you’ll see this word again soon' : 'You’ll see this word again soon';
  else if (!counted) sub = 'Practice · doesn’t change the streak';
  else if (pv.becomesLearnt) sub = `Learnt! Next check-up in ${pv.days} days`;
  else if (pv.learnt) sub = `Still learnt · next check-up in ${pv.days} days`;
  else sub = pv.days === 1 ? 'You’ll see this word again tomorrow' : `You won’t see this word for ${pv.days} days`;
  setHead(correct ? 'ok' : 'bad', correct ? (pv.becomesLearnt ? 'Correct! Word learnt' : 'Correct!') : 'Not quite', sub);

  const n = Math.min(p.streak, TARGET);
  $('a-progress-text').innerHTML = p.learnt
    ? `<b>Learnt</b> · next check-up ${relDay(p.due)}`
    : `<b>${n} of ${TARGET}</b> correct days in a row`;
  $('a-dots').innerHTML = dots(p.streak, true);
  return { counted };
}

$('options').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b || !session || session.card.answered) return;
  session.card.answered = true;
  const i = Number(b.dataset.i);
  const choices = session.card.choices;
  const correct = i >= 0 && choices[i].correct;
  // Like Magoosh: the choices fold away and the card shows the answer.
  b.closest('li').classList.add(correct ? 'right' : 'wrong');
  const card = session.card;
  setTimeout(() => {
    if (!session || session.card !== card) return;
    $('options').hidden = true;
    $('a-wrong').textContent = i >= 0 && !correct ? choices[i].text : '';
    $('a-wrong').hidden = !(i >= 0 && !correct);
    $('answer').hidden = false;
    $('btn-next').hidden = false;
  }, 260);
  record(correct);
});

$('btn-flip').onclick = () => {
  if (!session || session.card.answered) return;
  $('flip-front').hidden = true;
  $('answer').hidden = false;
  $('a-progress-text').parentElement.hidden = true;
  $('grade').hidden = false;
};
$('btn-hint').onclick = () => {
  const w = currentWord();
  if (!w || !w.example) return;
  $('hint').innerHTML = `“${blankOut(w.example, w.word)}”`;
  $('hint').hidden = false;
};
function flipGrade(correct) {
  if (!session || session.card.answered) return;
  session.card.answered = true;
  record(correct);
  $('a-progress-text').parentElement.hidden = false;
  $('grade').hidden = true;
  $('btn-next').hidden = false;
}
$('btn-got').onclick = () => flipGrade(true);
$('btn-miss').onclick = () => flipGrade(false);
$('btn-next').onclick = () => { if (!session) return; session.i += 1; showCard(); };
$('q-speak').onclick = () => { const w = currentWord(); if (w) speak(w.word); };
$('rv-close').onclick = endSession;
$('done-close').onclick = () => { $('done').hidden = true; };

document.addEventListener('keydown', (e) => {
  if (!session || e.target.tagName === 'INPUT') return;
  const answered = session.card?.answered;
  if (answered && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); $('btn-next').click(); return; }
  if (!answered && S.settings.qstyle !== 'flip' && /^[1-5]$/.test(e.key)) {
    const btn = $('options').querySelectorAll('button')[Number(e.key) - 1];
    btn?.click();
  }
  if (e.key === 'Escape') endSession();
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
    .sort((a, b) => (filter !== 'all' ? 0 : order[status(S.progress[a.id])] - order[status(S.progress[b.id])]));
  $('list').innerHTML = rows.length
    ? rows.map((w) => `<li data-id="${esc(w.id)}"><div class="lw"><b>${esc(w.word)}</b><span>${esc(gloss(w.meaning))}</span></div>${status(S.progress[w.id]) === 'new' ? '' : dots(S.progress[w.id].streak)}</li>`).join('')
    : `<li class="empty">${q ? 'No match' : filter === 'learnt' ? 'No learnt words yet — 5 correct days in a row puts a word here' : 'Nothing here'}</li>`;
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
    : st === 'learnt' ? `Learnt · next check-up ${relDay(p.due)}`
      : `Learning · ${Math.min(p.streak, TARGET)} of ${TARGET} · next ${relDay(p.due)}`;
  $('sheet-body').innerHTML = `
    <div class="sh-head"><h3>${esc(w.word)}</h3><button class="speak" id="sh-speak" aria-label="Pronounce"><svg><use href="#i-speak"/></svg></button></div>
    <p class="sh-status">${st === 'new' ? '' : dots(p.streak)}<span>${esc(statusText)}</span></p>
    <div class="answer">
      <p class="a-meaning">${esc(w.meaning)}</p>
      ${w.example ? `<p class="a-example">${emphasise(w.example, w.word)}</p>` : ''}
      <dl>
        ${w.hindi ? `<div><dt>Hindi</dt><dd>${esc(w.hindi)}</dd></div>` : ''}
        ${(w.notes || []).length ? `<div><dt>Your note</dt><dd>${w.notes.map(esc).join('<br>')}</dd></div>` : ''}
      </dl>
    </div>
    ${st === 'new' ? '' : `<div class="stats">
      <div><b>${p.reviews}</b><span>reviews</span></div>
      <div><b>${p.reviews ? Math.round((p.correct / p.reviews) * 100) : 0}%</b><span>right</span></div>
      <div><b>${p.best}</b><span>best streak</span></div>
    </div>`}
    <div class="sh-actions">
      ${st === 'new' ? '' : '<button class="btn ghost" id="sh-reset">Reset word</button>'}
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
  for (const b of $('qstyle').children) b.classList.toggle('on', b.dataset.q === S.settings.qstyle);
  $('style-note').textContent = S.settings.qstyle === 'flip'
    ? 'Harder: you recall the meaning yourself, then mark if you knew it'
    : 'Like Magoosh: one word, four definitions, plus “I’m not sure”';
  $('spacing-note').textContent = S.settings.spacing === 'crunch'
    ? 'Every day until learnt — fastest route to 5 in a row, weaker long-term'
    : 'Gaps grow 1 → 2 → 3 → 5 days. Learnt in about 11 days, lasts longer';
  $('voice-note').textContent = voice ? `Voice: ${voice.name}. For a better one, iPhone Settings → Accessibility → Spoken Content → Voices → English → download an Enhanced voice.` : 'Tap the speaker on any card';
  $('sync-info').textContent = `${words().length} words · checked ${fmtDate(S.wordsChecked)} · changed ${fmtDate(S.wordsUpdated)}`;
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
$('qstyle').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.settings.qstyle = b.dataset.q;
  save();
  renderAll();
});
$('voice-test').onclick = () => speak('apotheosis');
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

window.__ws = { get state() { return S; }, save, renderAll, today, addDays, gloss };
