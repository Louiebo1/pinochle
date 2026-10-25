# Pinochle for the web

Three-handed, single-deck auction Pinochle. Plain JavaScript (ES modules, no build step, no
Node) so it runs from any static host. Started 2026-10-24 for Louie: play the computer, or
family and friends anywhere with a 4-letter code; bots fill empty seats. Built like
`~/code/fivehundred-web` (same table/online/worker scheme, same Firebase project). There is
no iPhone app (yet); the rules are Louie's.

## Louie's rules (2026-10-24)
pagat.com's three-player points game with every score divided by 10:
- 48 cards (two of each A 10 K Q J 9). Two games, chosen on the start screen (or by the
  host in the waiting room): **with a kitty** (15 each + 3) or **no kitty** (16 each).
- Bidding from left of the dealer: minimum 15, raise by 1, a pass is final; two passes win
  it for the third; three passes = next dealer deals.
- Kitty turned up for everyone; bidder takes it, buries 3 (counters count for them, can't
  meld), names trump. No kitty: just names trump.
- Meld (a card counts once per class: runs/marriages/dix, pinochles, arounds): run 15,
  royal marriage 4, marriage 2, dix 1, pinochle 4, aces 10, kings 8, queens 6, jacks 4.
  Doubles get the big bonuses: run 150, pinochle 30, aces 100, kings 80, queens 60,
  jacks 40 (Louie). Roundhouse comes out at 24 naturally.
- Double marriage 30 (setting, on by default; Louie 2026-10-25): both K Q of a suit score
  30, trump or not, and count beside a run (run + double marriage 45), but a double run is
  just 150. Off: two marriages, 4 or 8. `g.doubleMarriage` (old saves: off), online
  `meta.doubleMarriage`, `?nodouble`; `meldOf(hand, trump, doubleMarriage)`.
- Bidder may throw in after the meld: −bid, others score their meld.
- Play: follow suit and ALWAYS beat the winning card if you can ("always kill" — Louie);
  can't follow → must trump, over a trump if you can; else anything. First of two
  identical cards wins. A/10/K = 1, last trick 1: 25.
- Bidder: meld + counters ≥ bid → scores them; else −bid. Others: meld + counters only if
  they took a counter. First to 150; bidder wins ties of reaching it, else higher score
  (equal → another hand).

## Layout
- `js/cards.js` — cards as ints `copy*1000 + suit*100 + rank` (♠0 ♥1 ♣2 ♦3; A14 10 K13
  Q12 J11 9); `face()` drops the copy; `power` (9 J Q K 10 A); `meldOf(hand, trump)` →
  `{ total, parts, faces }`.
- `js/game.js` — the rules above. Phases: bidding → widow (kitty) | trump → meld →
  playing → handOver/gameOver. Moves: bid{amount}, pass, bury{cards,trump}, trump{trump},
  play (start play after the meld), concede, card{card}. Plain JSON; illegal throws.
- `js/bot.js` — look-ahead bots: bid limit from 48 imagined deals (quick trump/bury +
  rollout), the style's confidence quantile; bury/trump by trying 3 trumps × 20 burials
  against 32 deals; card play by 100 imagined deals × each distinct card, rule-of-thumb
  rollouts (`quickCard`); the bidder minds the others' scores too; throw in when it beats
  playing. Sampling respects shown meld, the turned-up kitty, voids, and what "always
  kill" gives away (`ceilings`: someone who followed or trumped low holds nothing higher).
  `TUNE` holds knobs for tests/bench.js only.
  Against the bidder (Louie, 2026-10-24): the two non-bidders are partners (utility: both
  their scores over the bidder's) unless either could go out (score + meld + 25 ≥ 150), then
  each plays for themselves. Firm rules when a bot can't win the trick (`losingPlay`):
  points (K, then 10, then A) onto a partner's trick only if the bidder has played, or the
  partner's card is the best left and the bidder can't trump it (hasn't shown out of the
  suit — or every card of it is accounted for — or is out of trumps too) and the imagined
  deals give the bidder < 1 in 4 of trumping it; otherwise the cheapest card (9 J Q K 10 A,
  never a counter the rules don't force). Non-bidders lead into a partner who's out of a
  suit the bidder must follow. bench.js counts "points fed to the bidder" (a counter thrown
  on a trick the bot couldn't win, with a non-counter allowed): new 22 vs old 142 a seat in
  840 hands. Styles (secret, revealed at the end):
  Steady, Cautious, Aggressive, Gambler. A stand-in for a dropped person plays Steady.
- `js/think.js` + `js/worker.js` — bots think in a module Web Worker; `?noworker` forces the page.
- `js/table.js` — table state, `applyMove`, `nextHostStep` + `Pacer` (bot 0.75 s, trick
  1 s + 0.55 s sweep, kitty 0.7 s a card + 2.5 s, meld on show 4.5 s before a bot bidder
  plays), `LocalHost`.
- `js/online.js` — Firebase `/tables/pin-CODE` (meta has `kitty`), 3 seats; same scheme as
  500/Hearts (pause on drop, host takeover with the epoch guard).
- `js/main.js` — lobby (kitty switch), friends, waiting room, table (two players top left
  and right, trick in the middle, the kitty turned up, everyone's meld board, bid stepper
  with your meld per suit, bury with trump buttons showing the meld, Play It / Throw In),
  result (meld · tricks · hand per player, and why), score sheet, final with styles, menu
  (Everyone's Meld), settings, stats, rules. localStorage `pn.settings`, `pn.stats`,
  `pn.local`, `pn.table`. Names through `esc()`.
- `img/icon.png` — rendered from the page's own card CSS (Q♠ J♦) in headless Chrome.

## Test
- Rules + 2 whole bot games (kitty, no kitty):
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/engine.test.js`
  (~10 s; slowest bot move ~0.1 s).
- Strength: `tests/bench.sh DEALS-EACH KITTY(1|0) [BASE] [TUNE-JSON]` — the current bot
  vs a snapshot in `tests/bench/` (bot_v1 = the first version), duplicate deals, 14 runs
  at once; prints the edge per hand ±2 SE (70 each ≈ 4 min, ±0.36). 2026-10-24: v1 vs
  itself −0.06; random play −6.2, rule-of-thumb only −2.1 (the look-ahead matters); none
  of these moved it beyond noise: bidding bolder, the "kill" deductions, 150 samples,
  peeking play-outs (worse, −0.6), wider bury, bidder minding others; together +0.10
  ±0.25 (kitty), +0.27 ±0.30 (no kitty). Kept the sound ones. Next ideas: read the
  bidding when imagining hands, score-aware play near 150, better `quickCard`.
- Page: serve with `Cache-Control: no-store`, headless Chrome with its own
  `--user-data-dir` and `?noworker`; drive a 402×874 / 874×402 iframe from a scratch page.
  URL options: `?name=X`, `?play`, `?autoplay`, `?fast`, `?noworker`, `?nokitty`,
  `?newtable=CODE&startafter=N`, `?t=CODE`.
- Verified 2026-10-24: 4 fast bot games through the page, 0 errors; phone upright/sideways,
  iPad, Mac window; online with 3 simulators (iPhone host, 2 iPads): play, guest drop →
  pause → rejoin, host drop → takeover + Paused panel → rejoin. Test table deleted.

## Deploy
GitHub Pages from `main` (repo Louiebo1/pinochle, public) → https://louiebo1.github.io/pinochle/
(2026-10-24). `git push`; Pages rebuilds in about a minute. Lauren (lboczek7) is a
collaborator here and on the other card game repos.
