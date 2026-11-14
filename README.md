# Wordstreak

Flashcards for the CAT word list kept in the **Words** tab of a Google Sheet.
A word counts as **learnt after 5 correct answers in a row, on 5 different days**.

Live: https://raghav-m007.github.io/wordstreak/ — on iPhone open it in Safari → Share → **Add to Home Screen**.

## How the learning works

Built on the three findings with the strongest evidence behind them:

| Idea | What the app does |
|---|---|
| **Active recall** (testing effect) — pulling an answer out of memory strengthens it far more than re-reading it | The card shows only the word. You say the meaning in your head, *then* flip and grade yourself. |
| **Spacing** — recalls spread across days beat the same recalls crammed together | Only the first answer each day counts toward the 5-streak. Rawson & Dunlosky's *successive relearning* studies found ~68% one-week retention for recalls on separate days vs ~26% for the same number in one sitting. |
| **Expanding intervals** (Leitner boxes, Anki) | After each correct day the gap grows: 1 → 2 → 3 → 5 days. A miss resets the streak to 0 and the word returns tomorrow. |
| **Relearning to criterion** | A missed word comes back a few cards later in the same session until you recall it once (that retry doesn't count toward the streak). |
| **Maintenance** | Learnt words get check-ups after 14, 30 and 60 days. Miss one and it goes back to Learning. |

Other choices: new words are capped per day (default 15) so reviews don't pile up; new words are
mixed in among reviews (interleaving); the hint shows the example sentence with the word blanked
out (a context cue, still recall); "Exam crunch" spacing checks every day for the last stretch.

## Where the words come from

`words.json` is built from the sheet by `tools/build_words.py`. Column A = word, column B = the
AI-written "Meaning / Hindi Word / Daily Life Example" text, later columns = your own notes
(or a `/…/` pronunciation). Rows without a meaning yet are skipped until the next sync.

`.github/workflows/sync-words.yml` runs **every other day** (06:00 IST) and on demand. It reads the
Words tab's *published CSV* link from the repository variable `SHEET_CSV_URL`
(Sheet → File → Share → Publish to web → Words tab → CSV) and commits `words.json` when it changes.
The app fetches the latest `words.json` each time it opens and says how many new words arrived.

Progress is stored on the phone (localStorage). Settings → *Copy backup* puts it on the clipboard.

## Develop

```
python3 -m http.server 4190 --directory ~/wordstreak
python3 tools/build_words.py "<published csv url>"   # rebuild words.json by hand
python3 tools/make_icons.py                          # redraw icons (needs Pillow)
```

After changing any app file, bump `CACHE` in `sw.js` so installed copies update.
`window.__ws` exposes the state for poking at from the console.
