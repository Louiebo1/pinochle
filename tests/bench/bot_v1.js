// The bots. A bot sees only its own hand, the bidding, the kitty that was turned up, the
// meld everyone showed, the cards played, and which suits players have shown out of (and
// whether they're out of trumps). Every bot looks ahead: it imagines many deals of the
// cards it can't see, consistent with all of that, plays each one out with quick
// rule-of-thumb play, and chooses the bid, the burial and trump, or the card that does
// best. Each bot has a secret style, revealed at the end of the game: how sure it must be
// of making a bid before it bids it.

import { FULL_DECK, SUITS, face, suitOf, rankOf, power, isCounter, meldOf, ACE, TEN, KING } from '../../js/cards.js';
import * as G from '../../js/game.js';

export const STYLES = {
  steady: { title: 'Steady', blurb: 'Bids what its hand is worth and plays by the book.', confidence: 0.55, noise: 0 },
  cautious: { title: 'Cautious', blurb: 'Bids low and rarely goes set.', confidence: 0.7, noise: 0 },
  aggressive: { title: 'Aggressive', blurb: 'Bids high and counts on the kitty.', confidence: 0.4, noise: 0 },
  gambler: { title: 'Gambler', blurb: 'Bids on hunches. Unpredictable.', confidence: 0.45, noise: 3 },
};
export const STYLE_NAMES = Object.keys(STYLES);

export const BID_SAMPLES = 48, BURY_SAMPLES = 24, PLAY_SAMPLES = 60, CONCEDE_SAMPLES = 40;

const below = (n, random) => Math.floor(random() * n);
function shuffle(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = below(i + 1, random); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class Bot {
  constructor({ style = 'steady', random = Math.random } = {}) {
    this.style = STYLES[style] ? style : 'steady';
    this.random = random;
  }

  move(g, seat) {
    switch (g.phase) {
      case 'bidding': return this.bid(g, seat);
      case 'widow': return { type: 'bury', ...this.bury(g, seat) };
      case 'trump': return { type: 'trump', trump: this.chooseTrump(g, seat) };
      case 'meld': return { type: this.concedes(g, seat) ? 'concede' : 'play' };
      case 'playing': return { type: 'card', card: this.play(g, seat) };
      default: return { type: 'pass' };
    }
  }

  // MARK: Bidding

  /** What the hand is worth: imagine the unseen cards dealt many ways (the kitty to me),
   *  pick trump (and what to bury) the quick way, play it out, and take the bid this
   *  style is sure enough of. */
  bidLimit(g, seat) {
    const style = STYLES[this.style];
    const mine = g.hands[seat], others = [0, 1, 2].filter((s) => s !== seat);
    const pool = FULL_DECK.filter((c) => !mine.includes(c));
    const totals = [];
    for (let i = 0; i < BID_SAMPLES; i++) {
      const deck = shuffle(pool, this.random);
      const hands = [[], [], []];
      hands[seat] = mine.slice();
      let k = 0;
      for (const o of others) { hands[o] = deck.slice(k, k + g.hands[o].length); k += g.hands[o].length; }
      const widow = g.kitty ? deck.slice(k, k + G.WIDOW) : [];
      const choice = quickChoice(mine.concat(widow), g.kitty);
      hands[seat] = choice.hand;
      const trial = practiceHand(g, seat, choice.trump, hands, choice.buried, 0);
      playOut(trial);
      totals.push(trial.melds[seat].total + trial.points[seat] + choice.buried.filter(isCounter).length);
    }
    totals.sort((a, b) => b - a);
    let limit = totals[Math.max(0, Math.ceil(style.confidence * totals.length) - 1)];
    if (style.noise) limit += below(2 * style.noise + 1, this.random) - style.noise;
    return limit;
  }

  bid(g, seat) {
    const need = G.minimumBid(g);
    return this.bidLimit(g, seat) >= need ? { type: 'bid', amount: need } : { type: 'pass' };
  }

  // MARK: The kitty and trump

  /** With the kitty in hand: try the likely trumps and burials against many deals of the
   *  others' cards, and keep the one that scores best. */
  bury(g, seat) {
    const pool18 = g.hands[seat].concat(g.widow);
    const unseen = FULL_DECK.filter((c) => !pool18.includes(c));
    const others = [0, 1, 2].filter((s) => s !== seat);
    const options = [];
    for (const trump of likelyTrumps(pool18, 2)) for (const buried of buryOptions(pool18, trump, 8)) options.push({ trump, buried });
    const deals = Array.from({ length: BURY_SAMPLES }, () => shuffle(unseen, this.random));
    let best = null, top = -Infinity;
    for (const option of options) {
      const hand = pool18.filter((c) => !option.buried.includes(c));
      let sum = 0;
      for (const deck of deals) {
        const hands = [[], [], []];
        hands[seat] = hand;
        hands[others[0]] = deck.slice(0, 15); hands[others[1]] = deck.slice(15, 30);
        const trial = practiceHand(g, seat, option.trump, hands, option.buried, g.highBid);
        playOut(trial);
        sum += utility(trial, seat);
      }
      if (sum > top) { top = sum; best = option; }
    }
    return { cards: best.buried, trump: best.trump };
  }

  chooseTrump(g, seat) {
    const hand = g.hands[seat];
    const unseen = FULL_DECK.filter((c) => !hand.includes(c));
    const others = [0, 1, 2].filter((s) => s !== seat);
    const deals = Array.from({ length: BURY_SAMPLES }, () => shuffle(unseen, this.random));
    let best = null, top = -Infinity;
    for (const trump of likelyTrumps(hand, 3)) {
      let sum = 0;
      for (const deck of deals) {
        const hands = [[], [], []];
        hands[seat] = hand;
        hands[others[0]] = deck.slice(0, 16); hands[others[1]] = deck.slice(16, 32);
        const trial = practiceHand(g, seat, trump, hands, [], g.highBid);
        playOut(trial);
        sum += utility(trial, seat);
      }
      if (sum > top) { top = sum; best = trump; }
    }
    return best;
  }

  /** Throw the hand in when playing it out would most likely only give the others more. */
  concedes(g, seat) {
    let play = 0;
    for (let i = 0; i < CONCEDE_SAMPLES; i++) {
      const trial = sample(g, seat, this.random);
      trial.phase = 'playing'; trial.turn = trial.bidder;
      playOut(trial);
      play += utility(trial, seat);
    }
    const others = [0, 1, 2].filter((s) => s !== seat);
    const conceding = -g.highBid - (g.melds[others[0]].total + g.melds[others[1]].total) / 2;
    return conceding > play / CONCEDE_SAMPLES + 1;
  }

  // MARK: Play

  play(g, seat) {
    const legal = G.legalPlays(g, seat);
    const choices = distinctFaces(legal);
    if (choices.length === 1) return choices[0];
    const totals = choices.map(() => 0);
    for (let i = 0; i < PLAY_SAMPLES; i++) {
      const world = sample(g, seat, this.random);
      choices.forEach((c, k) => {
        const trial = G.copyGame(world);
        quickApply(trial, c, seat);
        playOut(trial);
        totals[k] += utility(trial, seat);
      });
    }
    let best = 0;
    for (let k = 1; k < choices.length; k++) {
      if (totals[k] > totals[best] + 1e-9 || (Math.abs(totals[k] - totals[best]) < 1e-9 && power(choices[k]) < power(choices[best]))) best = k;
    }
    return choices[best];
  }
}

/** One card of each face (the two copies play the same). */
function distinctFaces(cards) {
  const seen = new Set(), out = [];
  for (const c of cards) if (!seen.has(face(c))) { seen.add(face(c)); out.push(c); }
  return out;
}

/** How a hand came out for `seat`: the bidder wants their score; the others want their own
 *  score over the bidder's. */
function utility(g, seat) {
  const r = g.result;
  if (!r) return 0;
  if (seat === r.bidder) return r.score[seat];
  return r.score[seat] - r.score[r.bidder];
}

/** A hand in play for the look-ahead: `seat` won the bid at `bid` and named `trump`. */
function practiceHand(g, seat, trump, hands, buried, bid) {
  const trial = {
    kitty: g.kitty, scores: [0, 0, 0], dealer: g.dealer, handNumber: 0, phase: 'playing', turn: seat,
    hands, widow: [], revealedWidow: [], buried: buried.slice(), calls: [], passed: [], highBid: bid, bidder: seat, trump,
    redeals: 0, melds: hands.map((h) => meldOf(h, trump)), trick: [], played: [], lastTrick: [], lastTrickWinner: null,
    points: [0, 0, 0], tookCounter: [false, false, false], voids: [[], [], []], result: null, history: [], winner: null,
    humanSeats: [], botStyles: {}, continued: null, continueDeadline: null,
  };
  return trial;
}

/** Suits worth trying as trump: the most meld, then the most cards and power. */
function likelyTrumps(hand, k) {
  const rate = (t) => meldOf(hand, t).total + trumpStrength(hand, t);
  return SUITS.slice().sort((a, b) => rate(b) - rate(a)).slice(0, k);
}
function trumpStrength(hand, t) {
  const mine = hand.filter((c) => suitOf(c) === t);
  return mine.length * 1.5 + mine.filter((c) => rankOf(c) === ACE).length * 1.5 + mine.filter((c) => rankOf(c) === TEN).length * 0.7;
}

/** How much I'd rather keep a card (low: bury it). Meld and trumps stay; aces stay (they
 *  take tricks); a 10 or K without its ace is safest buried (its point is mine then);
 *  short suits go, to trump in. */
function keepValue(c, hand, trump, meldFaces) {
  if (meldFaces.has(face(c))) return 100;
  const s = suitOf(c), r = rankOf(c);
  if (s === trump) return 60 + power(c);
  const suit = hand.filter((x) => suitOf(x) === s);
  const aces = suit.filter((x) => rankOf(x) === ACE).length;
  if (r === ACE) return 40;
  let v = power(c) + suit.length * 2;
  if ((r === TEN || r === KING) && aces === 0) v -= 4;
  return v;
}

/** A few good burials for this trump: the lowest-keep cards, and mixes of the next ones. */
function buryOptions(hand, trump, k) {
  const meld = meldOf(hand, trump);
  const meldFaces = new Set(meld.faces);
  const ranked = hand.map((c) => [keepValue(c, hand, trump, meldFaces), c]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const pool = ranked.slice(0, 6), out = [], seen = new Set();
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let c = b + 1; c < pool.length; c++) {
    const pick = [pool[a], pool[b], pool[c]];
    const key = pick.map(face).sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
    if (out.length >= k) return out;
  }
  return out;
}

/** The quick way to take the kitty (for bidding): the trump with the most meld and
 *  strength, and the three cards least worth keeping. */
function quickChoice(hand, kitty) {
  const trump = likelyTrumps(hand, 1)[0];
  if (!kitty) return { trump, hand, buried: [] };
  const buried = buryOptions(hand, trump, 1)[0];
  return { trump, hand: hand.filter((c) => !buried.includes(c)), buried };
}

// MARK: Imagining the hidden cards

/** The same hand with the cards `seat` can't see dealt at random, consistent with what
 *  it knows: the meld everyone showed, the kitty turned up (the bidder has it, or buried
 *  it), and suits players have shown out of. */
export function sample(g, seat, random = Math.random) {
  const world = G.copyGame(g);
  const known = new Set(g.hands[seat]);
  for (const p of g.played) known.add(p.card);
  if (seat === g.bidder) for (const c of g.buried) known.add(c);
  const pool = FULL_DECK.filter((c) => !known.has(c));
  const others = [0, 1, 2].filter((s) => s !== seat);
  const buriedHidden = g.kitty && seat !== g.bidder && g.bidder !== null && g.phase !== 'bidding';
  // What each one must hold: the meld they showed and haven't played yet.
  const must = { 0: [], 1: [], 2: [] };
  const take = (f) => { const i = pool.findIndex((c) => face(c) === f); return i < 0 ? null : pool.splice(i, 1)[0]; };
  if (g.melds) {
    for (const o of others) {
      const left = {};
      for (const f of g.melds[o].faces) left[f] = (left[f] || 0) + 1;
      for (const p of g.played) if (p.seat === o && left[face(p.card)]) left[face(p.card)] -= 1;
      for (const f in left) for (let k = 0; k < left[f]; k++) { const c = take(Number(f)); if (c !== null) must[o].push(c); }
    }
  }
  // The kitty that was turned up: still with the bidder, or buried.
  let bidderGroup = [];
  if (buriedHidden) {
    for (const c of g.revealedWidow) {
      const i = pool.indexOf(c);
      if (i >= 0) { pool.splice(i, 1); bidderGroup.push(c); }
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const deck = shuffle(pool, random);
    const hands = { [seat]: g.hands[seat].slice() };
    let buried = seat === g.bidder ? g.buried.slice() : [];
    let ok = true;
    const slots = others.map((o) => ({ o, need: g.hands[o].length - must[o].length, cards: must[o].slice(), voids: attempt < 25 ? g.voids[o] : [] }));
    // The bidder's share of the kitty first: some still in hand, the rest buried.
    if (buriedHidden) {
      const slot = slots.find((x) => x.o === g.bidder), toHand = [], toBury = [];
      for (const c of shuffle(bidderGroup, random)) {
        const canHand = slot && slot.need - toHand.length > 0 && !slot.voids.includes(suitOf(c));
        const canBury = toBury.length < G.WIDOW;
        if (canHand && (!canBury || random() < 0.5)) toHand.push(c);
        else if (canBury) toBury.push(c);
        else ok = false;
      }
      if (slot) { slot.cards.push(...toHand); slot.need -= toHand.length; }
      buried = toBury;
    }
    // Most constrained first.
    slots.sort((a, b) => b.voids.length - a.voids.length);
    let rest = deck;
    for (const slot of slots) {
      const fits = [], others2 = [];
      for (const c of rest) (fits.length < slot.need && !slot.voids.includes(suitOf(c)) ? fits : others2).push(c);
      if (fits.length < slot.need) { ok = false; break; }
      slot.cards.push(...fits);
      rest = others2;
    }
    if (!ok) continue;
    for (const slot of slots) hands[slot.o] = slot.cards;
    const widowNeed = g.widow.length;
    const buryNeed = buriedHidden ? G.WIDOW - buried.length : 0;
    if (rest.length !== widowNeed + buryNeed) { ok = false; continue; }
    buried = buried.concat(rest.slice(0, buryNeed));
    world.widow = rest.slice(buryNeed);
    world.hands = [0, 1, 2].map((s) => hands[s]);
    world.buried = buried;
    return world;
  }
  // Couldn't fit everything (shouldn't happen): deal the hidden cards without the clues.
  const deck = shuffle(FULL_DECK.filter((c) => !known.has(c)), random);
  let k = 0;
  for (const o of others) { world.hands[o] = deck.slice(k, k + g.hands[o].length); k += g.hands[o].length; }
  if (buriedHidden) { world.buried = deck.slice(k, k + G.WIDOW); k += G.WIDOW; }
  world.widow = deck.slice(k);
  return world;
}

// MARK: Quick rule-of-thumb play (for the look-ahead)

function quickApply(g, c, seat) {
  G.apply(g, { type: 'card', card: c }, seat);
}

/** Plays the rest of the hand out with rule-of-thumb play. */
export function playOut(g) {
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 60) quickApply(g, quickCard(g, g.turn), g.turn);
}

/** No unplayed card of its suit outranks it, outside this hand. */
function isBoss(g, c, hand) {
  const s = suitOf(c), p = power(c);
  const higher = FULL_DECK.filter((x) => suitOf(x) === s && power(x) > p);
  const gone = new Set(g.played.map((x) => x.card).concat(hand));
  return higher.every((x) => gone.has(x));
}

export function quickCard(g, seat) {
  const legal = G.legalPlays(g, seat);
  if (legal.length === 1) return legal[0];
  const hand = g.hands[seat], trump = g.trump;
  const friend = (o) => o !== seat && seat !== g.bidder && o !== g.bidder;
  const lowest = (list) => list.reduce((a, b) => (low(b) < low(a) ? b : a));
  const low = (c) => (isCounter(c) ? 10 : 0) + power(c) + (suitOf(c) === trump ? 20 : 0);
  if (!g.trick.length) {
    const bosses = legal.filter((c) => isBoss(g, c, hand));
    const offBoss = bosses.filter((c) => suitOf(c) !== trump);
    if (offBoss.length) return offBoss.reduce((a, b) => (power(b) > power(a) ? b : a));
    if (seat === g.bidder) {
      const trumpBoss = bosses.filter((c) => suitOf(c) === trump);
      if (trumpBoss.length && hand.filter((c) => suitOf(c) === trump).length >= 3) return trumpBoss[0];
    }
    const off = legal.filter((c) => suitOf(c) !== trump && !isCounter(c));
    return lowest(off.length ? off : legal);
  }
  const win = G.winningPlay(g.trick, trump);
  const last = g.trick.length === PLAYERS_MINUS_ONE;
  const beating = legal.filter((c) => (suitOf(c) === suitOf(win.card) ? power(c) > power(win.card) : suitOf(c) === trump));
  if (beating.length) {
    const nextSeat = (seat + 1) % 3;
    // Last, or the one after me is on my side: take it with the most points.
    if (last || friend(nextSeat)) return beating.reduce((a, b) => ((isCounter(b) ? 1 : 0) - power(b) / 10 > (isCounter(a) ? 1 : 0) - power(a) / 10 ? b : a));
    const sure = beating.filter((c) => isBoss(g, c, hand));
    if (sure.length) return sure.reduce((a, b) => (isCounter(b) && !isCounter(a) ? b : a));
    return lowest(beating);
  }
  // Can't win it: give points to a friend who's winning, else throw the least.
  if (friend(win.seat)) {
    const counters = legal.filter(isCounter);
    if (counters.length) return counters.reduce((a, b) => (power(b) < power(a) ? b : a));
  }
  return lowest(legal);
}
const PLAYERS_MINUS_ONE = G.PLAYERS - 1;
