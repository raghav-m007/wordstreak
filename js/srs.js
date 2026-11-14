// Scheduling rules. Pure functions, no DOM, so they are easy to test.
//
// The research this follows (see README):
//  * Active recall beats re-reading: you try to say the meaning BEFORE you flip.
//  * Spacing beats cramming: recalls on separate days stick far better than
//    the same number of recalls in one sitting (Rawson & Dunlosky's
//    "successive relearning": ~68% vs ~26% one-week retention).
//  * Expanding gaps (Leitner boxes / Anki): each success pushes the next
//    review further out; a miss sends the card back to the start.
//
// So "learnt = 5 correct in a row" counts ONE answer per word per day (the
// first one). A miss resets the streak, and the word comes back a few cards
// later in the same session until you recall it once (relearning), but that
// retry does not count toward the streak.

export const TARGET = 5;
export const STEPS = {
  standard: [1, 2, 3, 5], // days until the next check after the 1st, 2nd, 3rd, 4th correct
  crunch: [1, 1, 1, 1],   // exam week: every day, learnt in 5 days
};
export const MAINT = [14, 30, 60]; // learnt words still get the odd check-up

export function today(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return today(d);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);
}

export function blank() {
  return {
    streak: 0, best: 0, reviews: 0, correct: 0, lapses: 0,
    due: null, last: null, intro: null, learnt: false, learntOn: null,
    maint: 0, pending: false,
  };
}

export function status(p) {
  if (!p || !p.intro) return 'new';
  return p.learnt ? 'learnt' : 'learning';
}

/** What a "Got it" would do, for the hint under the buttons. */
export function preview(p, day, spacing) {
  p = { ...blank(), ...p };
  if (p.last === day) return { counted: false };
  const streak = p.streak + 1;
  if (p.learnt) return { counted: true, streak, learnt: true, days: MAINT[Math.min(p.maint + 1, MAINT.length - 1)] };
  if (streak >= TARGET) return { counted: true, streak, learnt: true, becomesLearnt: true, days: MAINT[0] };
  return { counted: true, streak, learnt: false, days: STEPS[spacing][streak - 1] };
}

/**
 * Grade one answer. Returns the new progress record and whether it counted.
 * Only the first answer of the day counts; later ones are relearning.
 */
export function grade(prev, correct, day, spacing = 'standard') {
  const p = { ...blank(), ...prev };
  if (p.last === day) {
    if (correct) p.pending = false;
    return { p, counted: false };
  }
  if (!p.intro) p.intro = day;
  p.reviews += 1;
  p.last = day;
  if (correct) {
    p.correct += 1;
    p.streak += 1;
    p.best = Math.max(p.best, p.streak);
    p.pending = false;
    if (p.learnt) {
      p.maint += 1;
      p.due = addDays(day, MAINT[Math.min(p.maint, MAINT.length - 1)]);
    } else if (p.streak >= TARGET) {
      p.learnt = true;
      p.learntOn = day;
      p.maint = 0;
      p.due = addDays(day, MAINT[0]);
    } else {
      p.due = addDays(day, STEPS[spacing][p.streak - 1]);
    }
  } else {
    p.streak = 0;
    p.lapses += 1;
    p.learnt = false;
    p.learntOn = null;
    p.maint = 0;
    p.pending = true;
    p.due = addDays(day, 1);
  }
  return { p, counted: true };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Today's queue: due reviews, then new words mixed in, then unfinished relearns. */
export function buildQueue(words, prog, day, newPerDay) {
  const due = [];
  const fresh = [];
  const relearn = [];
  let newToday = 0;
  for (const w of words) {
    const p = prog[w.id];
    if (!p || !p.intro) { fresh.push(w.id); continue; }
    if (p.intro === day) newToday += 1;
    if (p.last === day) { if (p.pending) relearn.push(w.id); continue; }
    if (p.due && p.due <= day) due.push(w.id);
  }
  shuffle(due);
  // Most overdue first, so a missed day does not bury old words.
  due.sort((a, b) => (prog[a].due < prog[b].due ? -1 : prog[a].due > prog[b].due ? 1 : 0));
  const room = newPerDay >= 999 ? fresh.length : Math.max(0, newPerDay - newToday);
  const newIds = fresh.slice(0, room); // sheet order: older words first
  // Interleave: a new word after every two reviews.
  const out = [];
  let n = 0;
  due.forEach((id, i) => {
    out.push(id);
    if (i % 2 === 1 && n < newIds.length) out.push(newIds[n++]);
  });
  while (n < newIds.length) out.push(newIds[n++]);
  return [...out, ...shuffle(relearn)];
}

/** Words that are not learnt yet, for extra practice that doesn't touch streaks. */
export function practiceQueue(words, prog, size = 20) {
  const pool = words.filter((w) => status(prog[w.id]) !== 'learnt').map((w) => w.id);
  return shuffle(pool).slice(0, size);
}

export function counts(words, prog, day) {
  const c = { total: words.length, new: 0, learning: 0, learnt: 0, dueToday: 0, dueTomorrow: 0 };
  const tomorrow = addDays(day, 1);
  for (const w of words) {
    const p = prog[w.id];
    c[status(p)] += 1;
    if (p && p.intro && p.due && p.last !== day && p.due <= day) c.dueToday += 1;
    if (p && p.intro && p.due === tomorrow) c.dueTomorrow += 1;
  }
  return c;
}
