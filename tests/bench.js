// How strong the bots are: the current bot (js/bot.js) against a snapshot (tests/bench/),
// duplicate style — every deal is played three times with the new bot in each seat and
// the old one in the other two, so the cards even out. Prints one JSON line.
//   jsc tests/args.js -m tests/bench.js -- DEALS CHUNK KITTY(1|0) [BASE] [TUNE-JSON]
// Run ~14 at once with different CHUNKs and add them up with tests/bench-sum.py.
import * as G from '../js/game.js';
import { FULL_DECK, isCounter, suitOf, power } from '../js/cards.js';
import { Bot, TUNE } from '../js/bot.js';

const [deals = 20, chunk = 0, kitty = 1, base = 'bot_v1', tune = '{}'] = scriptArgs.map((a, i) => (i < 3 ? Number(a) : a));
Object.assign(TUNE, JSON.parse(tune));
const Old = (await import(`./bench/${base}.js`)).Bot;

// A small seeded generator for the deals, so every run sees the same cards.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function deck(seed) {
  const r = seeded(seed), d = FULL_DECK.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

const out = { deals: 0, hands: 0, newScore: 0, oldScore: 0, diffSq: 0, newBids: 0, newMade: 0, oldBids: 0, oldMade: 0, newSetPts: 0, thrown: 0, passedOut: 0, newFeeds: 0, oldFeeds: 0, ms: 0 };
const t0 = Date.now();
for (let i = 0; i < deals; i++) {
  const d = deck(1000003 * (chunk + 1) + i);
  let diff = 0;
  for (let seat = 0; seat < 3; seat++) {
    const g = G.newGame({ kitty: Boolean(kitty), dealer: 0, deck: d });
    g.humanSeats = [];
    const bots = [0, 1, 2].map((s) => (s === seat ? new Bot({ style: 'steady' }) : new Old({ style: 'steady' })));
    let guard = 0, feed = null;
    while (g.phase !== 'handOver' && g.phase !== 'gameOver' && guard++ < 400) {
      if (g.redeals) { out.passedOut++; break; }
      const s = g.turn, move = bots[s].move(g, s);
      // Feeding: a non-bidder throws a counter it didn't have to, and the bidder takes the trick.
      if (move.type === 'card' && s !== g.bidder && isCounter(move.card) && G.legalPlays(g, s).some((c) => !isCounter(c)) && g.trick.length
        && !G.legalPlays(g, s).some((c) => { const w = G.winningPlay(g.trick, g.trump).card; return suitOf(c) === suitOf(w) ? power(c) > power(w) : suitOf(c) === g.trump; })) feed = { s, at: g.played.length };
      G.apply(g, move, s);
      if (feed && g.phase === 'playing' || feed && g.result) {
        if (g.trick.length === 0 && g.played.length - feed.at <= 3 && g.played.length % 3 === 0) {
          if (g.lastTrickWinner === g.bidder) out[feed.s === seat ? 'newFeeds' : 'oldFeeds'] += 1;
          feed = null;
        }
      }
    }
    if (!g.result) continue;
    const r = g.result;
    const mine = r.score[seat], theirs = (r.score.reduce((a, b) => a + b, 0) - mine) / 2;
    out.newScore += mine; out.oldScore += theirs; diff += mine - theirs;
    out.hands++;
    if (r.bidder === seat) { out.newBids++; if (r.made) out.newMade++; } else { out.oldBids++; if (r.made) out.oldMade++; }
    if (r.conceded) out.thrown++;
  }
  out.deals++;
  out.diffSq += diff * diff;
}
out.ms = Date.now() - t0;
print(JSON.stringify(out));
