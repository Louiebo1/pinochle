// The rules, the meld, and whole games of the bots through the table code.
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/engine.test.js
import * as G from '../js/game.js';
import { card, SPADES, HEARTS, CLUBS, DIAMONDS, ACE, TEN, KING, QUEEN, JACK, NINE, FULL_DECK, meldOf, isCounter } from '../js/cards.js';
import { Bot, losingPlay } from '../js/bot.js';
import { newTableState, applyMove } from '../js/table.js';

let checks = 0, failures = 0;
function check(ok, what) { checks++; if (!ok) { failures++; print('FAIL ' + what); } }
const throws = (f) => { try { f(); return false; } catch (e) { return e instanceof G.IllegalMove; } };
const S = (r, k = 0) => card(SPADES, r, k), H = (r, k = 0) => card(HEARTS, r, k), C = (r, k = 0) => card(CLUBS, r, k), D = (r, k = 0) => card(DIAMONDS, r, k);
const now = () => Date.now();

// The deck.
check(FULL_DECK.length === 48 && new Set(FULL_DECK).size === 48, '48 cards');
check(FULL_DECK.filter(isCounter).length === 24, '24 counters (+1 last trick = 25)');

// Meld.
const m = (hand, trump) => meldOf(hand, trump).total;
check(m([H(ACE), H(TEN), H(KING), H(QUEEN), H(JACK)], HEARTS) === 15, 'run 15');
check(m([H(ACE), H(TEN), H(KING), H(QUEEN), H(JACK), H(KING, 1), H(QUEEN, 1)], HEARTS) === 19, 'run + royal marriage 19');
check(m([H(ACE), H(TEN), H(KING), H(QUEEN), H(JACK), H(ACE, 1), H(TEN, 1), H(KING, 1), H(QUEEN, 1), H(JACK, 1)], HEARTS) === 150, 'double run 150');
check(m([H(KING), H(QUEEN)], HEARTS) === 4 && m([H(KING), H(QUEEN)], SPADES) === 2, 'royal 4, common 2');
check(m([C(KING), C(QUEEN), C(KING, 1), C(QUEEN, 1)], SPADES) === 4, 'two marriages count twice');
check(m([H(NINE), H(NINE, 1)], HEARTS) === 2 && m([H(NINE)], SPADES) === 0, 'dix 1 each, only in trump');
check(m([S(QUEEN), D(JACK)], HEARTS) === 4, 'pinochle 4');
check(m([S(QUEEN), D(JACK), S(QUEEN, 1), D(JACK, 1)], HEARTS) === 30, 'double pinochle 30');
check(m([S(ACE), H(ACE), C(ACE), D(ACE)], HEARTS) === 10, 'aces around 10');
check(m([S(ACE), H(ACE), C(ACE), D(ACE), S(ACE, 1), H(ACE, 1), C(ACE, 1), D(ACE, 1)], HEARTS) === 100, 'double aces 100');
check(m([S(KING), H(KING), C(KING), D(KING)], HEARTS) === 8 && m([S(JACK), H(JACK), C(JACK), D(JACK)], HEARTS) === 4, 'kings 8, jacks 4');
check(m([S(QUEEN), H(QUEEN), C(QUEEN), D(QUEEN, 1), S(QUEEN, 1), H(QUEEN, 1), C(QUEEN, 1), D(QUEEN)], CLUBS) === 60, 'double queens 60');
// Roundhouse: K-Q of every suit = 3 marriages + royal (10) + kings (8) + queens (6) = 24.
check(m([S(KING), S(QUEEN), H(KING), H(QUEEN), C(KING), C(QUEEN), D(KING), D(QUEEN)], CLUBS) === 24, 'roundhouse 24');
// Q♠ can be in the pinochle, a marriage, and queens around.
check(m([S(QUEEN), D(JACK), S(KING)], HEARTS) === 6, 'Q♠ in pinochle and marriage');
{
  const r = meldOf([S(QUEEN), D(JACK), S(KING), H(QUEEN), C(QUEEN), D(QUEEN)], HEARTS);
  check(r.total === 4 + 2 + 6 && r.faces.length === 6, 'shown cards counted once: ' + JSON.stringify(r));
}

// The deal.
for (const kitty of [true, false]) {
  for (let i = 0; i < 20; i++) {
    const g = G.newGame({ kitty });
    const size = kitty ? 15 : 16;
    check(g.hands.every((h) => h.length === size) && g.widow.length === (kitty ? 3 : 0), 'deal sizes');
    check(new Set(g.hands.flat().concat(g.widow)).size === 48, 'every card dealt once');
    check(g.turn === (g.dealer + 1) % 3, 'left of the dealer bids first');
  }
}

// Bidding.
{
  const g = G.newGame({ dealer: 2 });
  check(g.turn === 0, 'seat 0 starts');
  check(throws(() => G.apply(g, { type: 'bid', amount: 14 }, 0)), 'below 15 refused');
  check(throws(() => G.apply(g, { type: 'bid', amount: 15 }, 1)), 'out of turn refused');
  G.apply(g, { type: 'bid', amount: 15 }, 0);
  check(throws(() => G.apply(g, { type: 'bid', amount: 15 }, 1)), 'must raise');
  G.apply(g, { type: 'bid', amount: 16 }, 1);
  G.apply(g, { type: 'pass' }, 2);
  check(g.turn === 0, 'back to seat 0');
  G.apply(g, { type: 'bid', amount: 20 }, 0);
  check(g.turn === 1, 'seat 2 passed, skipped');
  G.apply(g, { type: 'pass' }, 1);
  check(g.phase === 'widow' && g.bidder === 0 && g.highBid === 20 && g.turn === 0, 'two passes: the bid is won');
  check(g.revealedWidow.length === 3, 'kitty turned up');
  const pool = g.hands[0].concat(g.widow);
  check(throws(() => G.apply(g, { type: 'bury', cards: pool.slice(0, 2), trump: HEARTS }, 0)), 'must bury 3');
  G.apply(g, { type: 'bury', cards: pool.slice(0, 3), trump: HEARTS }, 0);
  check(g.hands[0].length === 15 && g.buried.length === 3 && g.phase === 'meld' && g.trump === HEARTS, 'buried and named trump');
  check(g.melds.length === 3, 'everyone melds');
}
{
  const g = G.newGame({ dealer: 0 });
  G.apply(g, { type: 'pass' }, 1); G.apply(g, { type: 'pass' }, 2); G.apply(g, { type: 'pass' }, 0);
  check(g.dealer === 1 && g.redeals === 1 && g.phase === 'bidding' && g.turn === 2, 'three passes: next dealer deals');
}
{
  const g = G.newGame({ kitty: false, dealer: 0 });
  G.apply(g, { type: 'bid', amount: 15 }, 1); G.apply(g, { type: 'pass' }, 2); G.apply(g, { type: 'pass' }, 0);
  check(g.phase === 'trump' && g.bidder === 1, 'no kitty: name trump');
  G.apply(g, { type: 'trump', trump: SPADES }, 1);
  check(g.phase === 'meld' && g.hands[1].length === 16, 'no kitty: 16 cards');
}

/** A hand in play: `bidder` bid `bid` with `trump`; `turn` leads. */
function playing(hands, trump, bidder, turn, extra = {}) {
  const g = G.newGame({ dealer: 0 });
  Object.assign(g, { hands, widow: [], trump, bidder, highBid: 15, phase: 'playing', turn, melds: hands.map((h) => meldOf(h, trump)) }, extra);
  return g;
}
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Following: beat the winning card if you can.
{
  const g = playing([[S(KING)], [S(ACE), S(NINE), H(ACE)], [S(TEN), S(JACK), C(ACE)]], HEARTS, 0, 0);
  G.apply(g, { type: 'card', card: S(KING) }, 0);
  check(same(G.legalPlays(g, 1), [S(ACE)]), 'must beat the K with the A');
  G.apply(g, { type: 'card', card: S(ACE) }, 1);
  check(same(G.legalPlays(g, 2), [S(TEN), S(JACK)]), "can't beat the A: any spade");
}
{
  // Out of the suit: must trump; over a trump already there if you can.
  const g = playing([[S(KING)], [H(NINE), C(ACE)], [H(TEN), H(JACK), C(TEN)]], HEARTS, 0, 0);
  G.apply(g, { type: 'card', card: S(KING) }, 0);
  check(same(G.legalPlays(g, 1), [H(NINE)]), 'must trump');
  G.apply(g, { type: 'card', card: H(NINE) }, 1);
  check(same(G.legalPlays(g, 2), [H(TEN), H(JACK)]), 'must over-trump (both beat the 9)');
  check(g.voids[1].includes(SPADES), 'void noted');
}
{
  // Following under a trump: any card of the suit.
  const g = playing([[S(KING)], [H(NINE)], [S(ACE), S(NINE)]], HEARTS, 0, 0);
  G.apply(g, { type: 'card', card: S(KING) }, 0);
  G.apply(g, { type: 'card', card: H(NINE) }, 1);
  check(same(G.legalPlays(g, 2), [S(ACE), S(NINE)]), 'trumped: any spade');
}
{
  // No suit, no trump: anything. The first of two the same wins.
  const g = playing([[S(ACE)], [S(ACE, 1)], [C(ACE), D(NINE)]], HEARTS, 0, 0);
  G.apply(g, { type: 'card', card: S(ACE) }, 0);
  check(same(G.legalPlays(g, 1), [S(ACE, 1)]), "can't beat an equal ace: play it");
  G.apply(g, { type: 'card', card: S(ACE, 1) }, 1);
  check(same(G.legalPlays(g, 2), [C(ACE), D(NINE)]), 'slough anything');
  G.apply(g, { type: 'card', card: C(ACE) }, 2);
  check(g.lastTrickWinner === 0, 'first ace wins');
  check(g.points[0] === 3 && g.turn === 0 && g.phase === 'playing', '3 counters to the winner, who leads');
}

// Scoring.
{
  // Bidder makes it: meld + counters (buried counters count).
  const g = playing([[H(ACE)], [S(NINE)], [C(NINE)]], HEARTS, 0, 0, { highBid: 15, buried: [S(TEN), S(KING), C(NINE)] });
  g.melds = [{ total: 12, parts: [], faces: [] }, { total: 6, parts: [], faces: [] }, { total: 4, parts: [], faces: [] }];
  G.apply(g, { type: 'card', card: H(ACE) }, 0); G.apply(g, { type: 'card', card: S(NINE) }, 1); G.apply(g, { type: 'card', card: C(NINE) }, 2);
  const r = g.result;
  check(r.made && r.score[0] === 12 + 1 + 1 + 2, 'made: meld + counters + last trick + buried: ' + JSON.stringify(r));
  check(r.score[1] === 0 && r.score[2] === 0, 'no counter taken: meld lost');
}
{
  // Set: lose the bid; an opponent with a counter scores meld + counters.
  const g = playing([[H(NINE)], [H(ACE)], [C(NINE)]], HEARTS, 0, 0, { highBid: 20 });
  g.melds = [{ total: 12, parts: [], faces: [] }, { total: 6, parts: [], faces: [] }, { total: 4, parts: [], faces: [] }];
  G.apply(g, { type: 'card', card: H(NINE) }, 0); G.apply(g, { type: 'card', card: H(ACE) }, 1); G.apply(g, { type: 'card', card: C(NINE) }, 2);
  check(!g.result.made && g.result.score[0] === -20 && g.result.score[1] === 6 + 1 + 1 && g.scores[0] === -20, 'set');
}
{
  // Throwing in: lose the bid; the others score their meld.
  const g = G.newGame({ dealer: 2 });
  G.apply(g, { type: 'bid', amount: 22 }, 0); G.apply(g, { type: 'pass' }, 1); G.apply(g, { type: 'pass' }, 2);
  G.apply(g, { type: 'bury', cards: g.widow.slice(), trump: CLUBS }, 0);
  check(throws(() => G.apply(g, { type: 'concede' }, 1)), 'only the bidder throws in');
  G.apply(g, { type: 'concede' }, 0);
  check(g.result.conceded && g.scores[0] === -22 && g.scores[1] === g.melds[1].total, 'thrown in');
}
{
  // Winning: the bidder wins if they're one of those over 150.
  const g = playing([[H(ACE)], [S(NINE)], [C(NINE)]], HEARTS, 0, 0, { highBid: 15, scores: [140, 149, 0] });
  g.melds = [{ total: 15, parts: [], faces: [] }, { total: 4, parts: [], faces: [] }, { total: 0, parts: [], faces: [] }];
  g.tookCounter[1] = true; g.points[1] = 2;
  G.apply(g, { type: 'card', card: H(ACE) }, 0); G.apply(g, { type: 'card', card: S(NINE) }, 1); G.apply(g, { type: 'card', card: C(NINE) }, 2);
  check(g.phase === 'gameOver' && g.winner === 0 && g.scores[1] >= 150, 'bidder wins the race');
}
{
  // Next hand only once everyone taps.
  const g = playing([[H(ACE)], [S(NINE)], [C(NINE)]], HEARTS, 0, 0, { humanSeats: [0, 2] });
  G.apply(g, { type: 'card', card: H(ACE) }, 0); G.apply(g, { type: 'card', card: S(NINE) }, 1); G.apply(g, { type: 'card', card: C(NINE) }, 2);
  G.markContinued(g, 0);
  check(g.phase === 'handOver' && g.continueDeadline > 0, 'waits for seat 2');
  G.markContinued(g, 2);
  check(g.phase === 'bidding' && g.handNumber === 1 && g.dealer === 1, 'next hand, deal passes left');
}

// The bots against the bidder (Louie, 2026-10-24): seat 2 bid; 0 and 1 are partners.
{
  const meld0 = { total: 0, parts: [], faces: [] };
  const hand = (cards) => cards;
  const at = (hands, plays, extra = {}) => {
    const g = playing(hands, HEARTS, 2, 0, extra);
    g.melds = [meld0, meld0, meld0];
    for (const [seat, c] of plays) G.apply(g, { type: 'card', card: c }, seat);
    return g;
  };
  const pick = (g, seat) => losingPlay(g, seat, G.legalPlays(g, seat));
  // Partner leads the best spade left; the bidder still has spades: points go on it, the K first.
  let g = at([[S(ACE), C(NINE)], hand([S(KING), S(TEN), S(NINE), C(TEN)]), [S(NINE, 1), H(ACE), C(KING), D(NINE)]], [[0, S(ACE)]]);
  check(pick(g, 1) === S(KING), 'points to a partner safely winning: the K, not the 10 or the 9');
  // Same, but the bidder has shown out of spades (and still has trumps): keep the points.
  g = at([[S(ACE), C(NINE)], hand([S(KING), S(TEN), S(NINE), C(TEN)]), [H(ACE), C(KING), D(NINE), D(TEN)]], [[0, S(ACE)]]);
  g.voids[2] = [SPADES];
  check(pick(g, 1) === S(NINE), 'the bidder can trump it: the cheapest card');
  // The partner's card isn't the best left (the other ace is out): keep the points.
  g = at([[S(TEN), C(NINE)], hand([S(KING), S(NINE), C(TEN), C(NINE, 1)]), [S(NINE, 1), H(ACE), C(KING), D(NINE)]], [[0, S(TEN)]]);
  check(pick(g, 1) === S(NINE), 'partner not safe: the cheapest card');
  // The bidder is winning and I'm last: never a counter the rules don't force; the K before the A.
  for (const [mine, want, what] of [[[S(KING), S(ACE), S(NINE)], S(NINE), 'bidder winning: the 9, not a counter'],
    [[S(KING), S(ACE)], S(KING), 'forced to give a counter: the K, not the A']]) {
    g = playing([mine, [H(TEN), C(NINE)], [H(NINE), D(NINE)]], HEARTS, 1, 1);
    g.melds = [meld0, meld0, meld0];
    G.apply(g, { type: 'card', card: H(TEN) }, 1);
    G.apply(g, { type: 'card', card: H(NINE) }, 2);
    check(pick(g, 0) === want, what);
  }
  // My partner could go out: no help — the cheapest card.
  g = at([[S(ACE), C(NINE)], hand([S(KING), S(TEN), S(NINE), C(TEN)]), [S(NINE, 1), H(ACE), C(KING), D(NINE)]], [[0, S(ACE)]], { scores: [130, 0, 0] });
  check(pick(g, 1) === S(NINE), 'partner could go out: play for myself');
  // I could go out myself: play for myself.
  g = at([[S(ACE), C(NINE)], hand([S(KING), S(TEN), S(NINE), C(TEN)]), [S(NINE, 1), H(ACE), C(KING), D(NINE)]], [[0, S(ACE)]], { scores: [0, 130, 0] });
  check(pick(g, 1) === S(NINE), 'I could go out: play for myself');
}

// The bots: whole games through the table code, with and without the kitty.
for (const kitty of [true, false]) {
  const t0 = now();
  const state = newTableState([{ kind: 'bot', name: 'A' }, { kind: 'bot', name: 'B' }, { kind: 'bot', name: 'C' }], kitty);
  let moves = 0, slowest = 0, hands = 0;
  while (state.game.phase !== 'gameOver' && moves < 5000) {
    const g = state.game;
    if (g.phase === 'handOver') { applyMove(state, { type: 'deal', hand: g.handNumber }); hands++; continue; }
    const s = g.turn, t = now();
    const move = new Bot({ style: g.botStyles[s] }).move(g, s);
    slowest = Math.max(slowest, now() - t);
    const ok = applyMove(state, { ...move, seat: s });
    check(ok, `bot move applies (${g.phase} ${JSON.stringify(move)})`);
    if (!ok) break;
    moves++;
  }
  const g = state.game;
  check(g.phase === 'gameOver' && g.winner !== null && g.scores[g.winner] >= 150, 'a bot game ends');
  const made = g.history.filter((h) => h.made).length, conceded = g.history.filter((h) => h.conceded).length;
  print(`${kitty ? 'kitty' : 'no kitty'}: ${g.history.length} hands, bids ${g.history.map((h) => h.bid + (h.made ? '' : h.conceded ? 't' : 'x')).join(' ')}; made ${made}, thrown in ${conceded}; scores ${g.scores.join('/')}; ${moves} moves in ${((now() - t0) / 1000).toFixed(1)} s, slowest ${slowest} ms`);
}

print(`${checks} checks, ${failures} failed`);
