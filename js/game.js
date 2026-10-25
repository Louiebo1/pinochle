// Three-handed auction Pinochle with one 48-card deck, Louie's way (2026-10-24): the
// points game from pagat.com with every score divided by 10. Seats 0–2 clockwise; each
// player scores for themselves. The state is plain JSON; moves that break the rules
// throw `IllegalMove`.
//
// With a kitty: 15 cards each and 3 face down. Without: 16 each. Bidding starts left of
// the dealer, at 15 or more, raising by 1; a pass is final; once two have passed the
// third has the bid (three passes: thrown in, the next dealer deals). The bid winner turns
// the kitty up for everyone, takes it, buries any 3 face down (their counters count for
// the bidder; they can't be melded) and names trump — without a kitty they just name
// trump. Everyone shows their meld (doubles score the big bonuses). The bidder may then
// throw the hand in: they lose the bid, the others score their meld. Otherwise the bidder
// leads. Follow suit and beat the winning card if you can ("always kill"); if you can't
// follow, trump, beating any trump already there if you can; else play anything. Of two
// identical cards the first played wins. A, 10 and K are worth 1 each and the last trick
// 1: 25 in the play.
//
// Scoring: the bidder makes it if meld + counters reach the bid and scores them all; if
// not, they lose the bid. The others score their meld + counters, but only if they took
// a counter. First to 150 wins; if more than one gets there on the same hand, the bidder
// wins if they're one of them, else the higher score (a tie plays another hand).

import { FULL_DECK, SUITS, shuffled, suitOf, power, isCounter, meldOf } from './cards.js';

export const TARGET = 150, MIN_BID = 15, WIDOW = 3, PLAYERS = 3;
export const CONTINUE_WAIT = 30000;
export const handSize = (g) => (g.kitty ? 15 : 16);

export class IllegalMove extends Error {}
const illegal = () => { throw new IllegalMove('illegal move'); };
const next = (seat) => (seat + 1) % PLAYERS;

/** A new game, with or without a kitty, and the house rules (see `meldOf`; `buriedToLast`:
 *  the buried cards' points go to whoever takes the last trick). `deck` is the first deal's order. */
export function newGame({ kitty = true, doubleMarriage = true, roundhouse = true, buriedToLast = true, dealer = Math.floor(Math.random() * PLAYERS), deck = shuffled() } = {}) {
  const g = {
    kitty, doubleMarriage, roundhouse, buriedToLast, scores: [0, 0, 0], dealer, handNumber: 0, phase: 'bidding', turn: 0,
    hands: [[], [], []], widow: [], revealedWidow: [], buried: [],
    calls: [], passed: [], highBid: null, bidder: null, trump: null, redeals: 0,
    melds: null, trick: [], played: [], lastTrick: [], lastTrickWinner: null,
    points: [0, 0, 0], tookCounter: [false, false, false], voids: [[], [], []],
    result: null, history: [], winner: null,
    humanSeats: [0], botStyles: {}, continued: null, continueDeadline: null,
  };
  deal(g, deck);
  return g;
}

/** A copy to try things on (the bots' look-ahead copies a lot, so this is by hand). */
export function copyGame(g) {
  return {
    ...g,
    scores: g.scores.slice(), hands: g.hands.map((h) => h.slice()), widow: g.widow.slice(),
    revealedWidow: g.revealedWidow.slice(), buried: g.buried.slice(), calls: g.calls.slice(), passed: g.passed.slice(),
    trick: g.trick.slice(), played: g.played.slice(), lastTrick: g.lastTrick.slice(),
    points: g.points.slice(), tookCounter: g.tookCounter.slice(), voids: g.voids.map((v) => v.slice()),
    history: g.history.slice(), humanSeats: g.humanSeats.slice(), botStyles: { ...g.botStyles },
    continued: g.continued && g.continued.slice(),
  };
}

function deal(g, deck) {
  const size = handSize(g);
  g.hands = [[], [], []];
  for (let i = 0; i < size * PLAYERS; i++) g.hands[(g.dealer + 1 + i) % PLAYERS].push(deck[i]);
  g.widow = deck.slice(size * PLAYERS);
  Object.assign(g, {
    revealedWidow: [], buried: [], calls: [], passed: [], highBid: null, bidder: null, trump: null,
    melds: null, trick: [], played: [], lastTrick: [], lastTrickWinner: null,
    points: [0, 0, 0], tookCounter: [false, false, false], voids: [[], [], []],
    result: null, continued: null, continueDeadline: null,
    phase: 'bidding', turn: next(g.dealer),
  });
}

/** The lowest bid allowed now. */
export const minimumBid = (g) => (g.highBid === null ? MIN_BID : g.highBid + 1);

// MARK: Moves — { type: 'bid', amount } | { type: 'pass' } | { type: 'bury', cards, trump }
//   | { type: 'trump', trump } | { type: 'play' } | { type: 'concede' } | { type: 'card', card }

export function canApply(g, move, seat) {
  try { apply(copyGame(g), move, seat); return true; } catch { return false; }
}

export function apply(g, move, seat, random = Math.random) {
  if (seat !== g.turn) illegal();
  if (g.phase === 'bidding' && move.type === 'bid') {
    const amount = move.amount;
    if (g.passed.includes(seat) || !Number.isInteger(amount) || amount < minimumBid(g) || amount > 999) illegal();
    g.highBid = amount;
    g.bidder = seat;
    g.calls.push({ seat, amount });
    advanceBidding(g, seat, random);
  } else if (g.phase === 'bidding' && move.type === 'pass') {
    if (g.passed.includes(seat)) illegal();
    g.passed.push(seat);
    g.calls.push({ seat, amount: null });
    advanceBidding(g, seat, random);
  } else if (g.phase === 'widow' && move.type === 'bury') {
    const pool = g.hands[seat].concat(g.widow), cards = move.cards || [];
    if (seat !== g.bidder || cards.length !== WIDOW || new Set(cards).size !== WIDOW || !cards.every((c) => pool.includes(c))
      || !SUITS.includes(move.trump)) illegal();
    g.hands[seat] = pool.filter((c) => !cards.includes(c));
    g.widow = [];
    g.buried = cards.slice();
    nameTrump(g, move.trump);
  } else if (g.phase === 'trump' && move.type === 'trump') {
    if (seat !== g.bidder || !SUITS.includes(move.trump)) illegal();
    nameTrump(g, move.trump);
  } else if (g.phase === 'meld' && move.type === 'play') {
    g.phase = 'playing';
    g.turn = g.bidder;
  } else if (g.phase === 'meld' && move.type === 'concede') {
    concede(g);
  } else if (g.phase === 'playing' && move.type === 'card') {
    play(g, move.card, seat);
  } else illegal();
}

function advanceBidding(g, seat) {
  if (g.passed.length === PLAYERS) {
    // Nobody bid: throw the cards in; the next dealer deals.
    g.redeals += 1;
    g.dealer = next(g.dealer);
    deal(g, shuffled());
    return;
  }
  if (g.bidder !== null && g.passed.length === PLAYERS - 1) {
    g.redeals = 0;
    g.turn = g.bidder;
    if (g.kitty) { g.revealedWidow = g.widow.slice(); g.phase = 'widow'; } else g.phase = 'trump';
    return;
  }
  let s = next(seat);
  while (g.passed.includes(s)) s = next(s);
  g.turn = s;
}

function nameTrump(g, trump) {
  g.trump = trump;
  g.melds = g.hands.map((h) => meldOf(h, trump, g));
  g.phase = 'meld';
  g.turn = g.bidder;
}

// MARK: Tricks

/** The play winning `plays` so far: the best trump, else the best of the suit led; of two
 *  the same, the first. */
export function winningPlay(plays, trump) {
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) if (beats(plays[i].card, best.card, trump)) best = plays[i];
  return best;
}
const beats = (c, over, trump) => (suitOf(c) === suitOf(over) ? power(c) > power(over) : suitOf(c) === trump);

/** The cards `seat` may play now: follow suit and beat the winning card if you can; if
 *  you can't follow, trump (over any trump already there, if you can); else anything. */
export function legalPlays(g, seat) {
  if (g.phase !== 'playing' || seat !== g.turn) return [];
  const hand = g.hands[seat];
  if (!g.trick.length) return hand.slice();
  const led = suitOf(g.trick[0].card), win = winningPlay(g.trick, g.trump).card;
  const following = hand.filter((c) => suitOf(c) === led);
  const pool = following.length ? following : hand.filter((c) => suitOf(c) === g.trump);
  if (!pool.length) return hand.slice();
  const higher = pool.filter((c) => beats(c, win, g.trump));
  return higher.length ? higher : pool;
}

function play(g, c, seat) {
  if (!legalPlays(g, seat).includes(c)) illegal();
  if (g.trick.length) {
    const led = suitOf(g.trick[0].card), s = suitOf(c), v = g.voids[seat];
    if (s !== led && !v.includes(led)) v.push(led);
    if (s !== led && s !== g.trump && !v.includes(g.trump)) v.push(g.trump);
  }
  g.hands[seat] = g.hands[seat].filter((x) => x !== c);
  g.trick.push({ seat, card: c });
  g.played.push({ seat, card: c });
  if (g.trick.length < PLAYERS) { g.turn = next(seat); return; }
  const winner = winningPlay(g.trick, g.trump).seat;
  const counters = g.trick.filter((p) => isCounter(p.card)).length;
  g.points[winner] += counters;
  if (counters) g.tookCounter[winner] = true;
  g.lastTrick = g.trick;
  g.lastTrickWinner = winner;
  g.trick = [];
  g.turn = winner;
  if (g.hands.every((h) => h.length === 0)) {
    g.points[winner] += 1;                              // The last trick.
    scoreHand(g);
  }
}

/** Who is winning the trick so far. */
export const currentWinner = (g) => (g.trick.length ? winningPlay(g.trick, g.trump).seat : null);

// MARK: Scoring

const buriedPoints = (g) => g.buried.filter(isCounter).length;
/** Who gets the buried cards' points: the bidder, or (house rule) whoever took the last trick. */
export const buriedTo = (g) => (g.buriedToLast && g.lastTrickWinner !== null ? g.lastTrickWinner : g.bidder);

function scoreHand(g) {
  const b = g.bidder, meld = g.melds.map((m) => m.total);
  const counters = g.points.slice(), tookCounter = g.tookCounter.slice();
  const to = buriedTo(g);
  counters[to] += buriedPoints(g);
  if (buriedPoints(g)) tookCounter[to] = true;
  const total = meld[b] + counters[b];
  const made = total >= g.highBid;
  const score = [0, 1, 2].map((s) => {
    if (s === b) return made ? total : -g.highBid;
    return tookCounter[s] ? meld[s] + counters[s] : 0;
  });
  finish(g, { bidder: b, bid: g.highBid, trump: g.trump, made, conceded: false, meld, counters, tookCounter, score, buriedTo: g.buried.length ? to : null });
}

function concede(g) {
  const b = g.bidder, meld = g.melds.map((m) => m.total);
  const score = [0, 1, 2].map((s) => (s === b ? -g.highBid : meld[s]));
  finish(g, { bidder: b, bid: g.highBid, trump: g.trump, made: false, conceded: true, meld, counters: [0, 0, 0], tookCounter: [false, false, false], score });
}

function finish(g, result) {
  result.score.forEach((p, s) => { g.scores[s] += p; });
  g.result = result;
  g.history.push(result);
  g.phase = 'handOver';
  const over = [0, 1, 2].filter((s) => g.scores[s] >= TARGET);
  if (!over.length) return;
  if (over.includes(result.bidder) && result.made) g.winner = result.bidder;
  else {
    const top = Math.max(...over.map((s) => g.scores[s]));
    const best = over.filter((s) => g.scores[s] === top);
    if (best.length === 1) g.winner = best[0];             // A tie plays another hand.
  }
  if (g.winner !== null) g.phase = 'gameOver';
}

/** A person taps Next Hand: the next hand is dealt once everyone has (bots don't need to).
 *  The first tap starts the others' 30 seconds. */
export function markContinued(g, seat, now = Date.now()) {
  if (g.phase !== 'handOver') illegal();
  const ready = (g.continued || []).slice();
  if (!ready.includes(seat)) ready.push(seat);
  if (g.humanSeats.every((s) => ready.includes(s))) { nextHand(g); return; }
  g.continued = ready;
  if (g.continueDeadline === null) g.continueDeadline = now + CONTINUE_WAIT;
}

/** Deals the next hand; the deal passes to the left. */
export function nextHand(g, deck = shuffled()) {
  if (g.phase !== 'handOver') illegal();
  g.dealer = next(g.dealer);
  g.handNumber += 1;
  deal(g, deck);
}

export { FULL_DECK };
