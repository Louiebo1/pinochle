// Cards are small integers: copy * 1000 + suit * 100 + rank. The deck has two of each
// card (copy 0 and 1), A 10 K Q J 9 in every suit — 48 cards. A card's "face" (without
// the copy) is what matters for play and meld; the copy only tells the two apart.
// Suits in display order, alternating colors: spades, hearts, clubs, diamonds.

export const SPADES = 0, HEARTS = 1, CLUBS = 2, DIAMONDS = 3;
export const SUITS = [SPADES, HEARTS, CLUBS, DIAMONDS];
export const SYMBOL = ['♠', '♥', '♣', '♦'];
export const SUIT_NAME = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
export const ACE = 14, KING = 13, QUEEN = 12, JACK = 11, TEN = 10, NINE = 9;
/** Ranks high to low: the ten ranks just below the ace. */
export const RANKS = [ACE, TEN, KING, QUEEN, JACK, NINE];

export const face = (c) => c % 1000;
export const card = (suit, rank, copy = 0) => copy * 1000 + suit * 100 + rank;
export const suitOf = (c) => Math.floor((c % 1000) / 100);
export const rankOf = (c) => c % 100;
export const isRedSuit = (s) => s === HEARTS || s === DIAMONDS;

const POWER = { 9: 0, 11: 1, 12: 2, 13: 3, 10: 4, 14: 5 };
/** Strength within its suit: 9 J Q K 10 A. */
export const power = (c) => POWER[c % 100];
/** A, 10 and K are worth a point each in the tricks (the scores divided by 10). */
export const isCounter = (c) => { const r = c % 100; return r === ACE || r === TEN || r === KING; };

export const FULL_DECK = [0, 1].flatMap((copy) => SUITS.flatMap((s) => RANKS.map((r) => card(s, r, copy))));

export function rankLabel(c) {
  const r = rankOf(c);
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r);
}
export const label = (c) => rankLabel(c) + SYMBOL[suitOf(c)];

/** A shuffled copy of the deck (Fisher–Yates). */
export function shuffled(deck = FULL_DECK, random = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** The cards in `pool` that meld with `trump`: burying any one of them alone loses meld. */
export function meldCardsOf(pool, trump, rules = {}) {
  const full = meldOf(pool, trump, rules).total;
  return new Set(pool.filter((c) => meldOf(pool.filter((x) => x !== c), trump, rules).total < full));
}

// MARK: Meld (the scores divided by 10; doubles score the big bonuses — Louie, 2026-10-24)

const AROUND = [[ACE, 'Aces', 10], [KING, 'Kings', 8], [QUEEN, 'Queens', 6], [JACK, 'Jacks', 4]];

/** The meld in `hand` with `trump`: { total, parts: [{ name, points, faces }], faces }.
 *  A card may count once in each kind of meld (runs, marriages and the dix; pinochles;
 *  "around"), so a king can be in a marriage and in kings around. `faces` is every card
 *  shown, as faces, each as many times as it's needed. House rules (both on in a new game;
 *  Louie, 2026-10-25), from `rules` (the game):
 *  - `doubleMarriage`: both K Q of a suit score 30, trump or not, and count even when a
 *    run uses a K Q of them — but a double run is just 150.
 *  - `roundhouse`: with a K and Q of every suit, the run's K Q is a royal marriage too, so
 *    kings and queens around come to their full 24 beside a run (not beside a double run). */
export function meldOf(hand, trump, rules = {}) {
  const { doubleMarriage = false, roundhouse = false } = rules;
  const count = {};
  for (const c of hand) count[face(c)] = (count[face(c)] || 0) + 1;
  const n = (suit, rank) => count[suit * 100 + rank] || 0;
  const parts = [];
  const add = (name, points, faces) => parts.push({ name, points, faces });
  const times = (list, k) => Array.from({ length: k }, () => list).flat();

  // Runs, marriages and the dix.
  const runFaces = [ACE, TEN, KING, QUEEN, JACK].map((r) => trump * 100 + r);
  const runs = Math.min(...runFaces.map((f) => count[f] || 0));
  const roundhouseHeld = roundhouse && SUITS.every((s) => n(s, KING) && n(s, QUEEN));
  if (runs === 2) add('Double run', 150, times(runFaces, 2));
  else if (runs === 1) add('Run', 15, runFaces);
  for (const s of SUITS) {
    if (doubleMarriage && Math.min(n(s, KING), n(s, QUEEN)) === 2 && !(s === trump && runs === 2)) {
      add(`Double marriage ${SYMBOL[s]}`, 30, times([s * 100 + KING, s * 100 + QUEEN], 2));
      continue;
    }
    const k = Math.min(n(s, KING), n(s, QUEEN)) - (s === trump && !(runs === 1 && roundhouseHeld) ? runs : 0);
    if (k <= 0) continue;
    const royal = s === trump;
    const each = royal ? 4 : 2;
    add(`${k === 2 ? '2 ' : ''}${royal ? 'Royal marriage' : 'Marriage'}${k === 2 ? 's' : ''} ${SYMBOL[s]}`, each * k, times([s * 100 + KING, s * 100 + QUEEN], k));
  }
  const dix = n(trump, NINE);
  if (dix) add(dix === 2 ? '2 Dix' : 'Dix', dix, times([trump * 100 + NINE], dix));

  // Pinochles: Q♠ and J♦.
  const pinochles = Math.min(n(SPADES, QUEEN), n(DIAMONDS, JACK));
  const pinochle = [SPADES * 100 + QUEEN, DIAMONDS * 100 + JACK];
  if (pinochles === 2) add('Double pinochle', 30, times(pinochle, 2));
  else if (pinochles === 1) add('Pinochle', 4, pinochle);

  // One of a rank in every suit.
  for (const [rank, name, value] of AROUND) {
    const k = Math.min(...SUITS.map((s) => n(s, rank)));
    const faces = SUITS.map((s) => s * 100 + rank);
    if (k === 2) add(`Double ${name.toLowerCase()}`, value * 10, times(faces, 2));
    else if (k === 1) add(`${name} around`, value, faces);
  }

  // The cards to show: each face as many times as any one meld needs it.
  const need = {};
  for (const p of parts) {
    const here = {};
    for (const f of p.faces) here[f] = (here[f] || 0) + 1;
    for (const f in here) need[f] = Math.max(need[f] || 0, here[f]);
  }
  const faces = Object.keys(need).map(Number).sort(byDisplay).flatMap((f) => times([f], need[f]));
  return { total: parts.reduce((t, p) => t + p.points, 0), parts, faces };
}

/** Suits in display order, highest first. */
export const byDisplay = (a, b) => suitOf(a) - suitOf(b) || power(b) - power(a);
