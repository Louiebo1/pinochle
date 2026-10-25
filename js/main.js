// The web app: the start screen, the table, and the overlays. It draws whatever table
// state it's given and turns taps into moves: the other two players on the left and
// right, the trick (or the kitty, or everyone's meld) in the middle, the bidding on your
// turn to bid, your hand at the bottom.

import * as G from './game.js';
import {
  SYMBOL, SUIT_NAME, SUITS, card, suitOf, rankLabel, label, isRedSuit, power, isCounter, meldOf, meldCardsOf,
  SPADES, HEARTS, DIAMONDS, ACE, TEN, KING, QUEEN, JACK,
} from './cards.js';
import { STYLES } from './bot.js';
import { newTableState, LocalHost, BOT_NAMES, PACE, trickLinger, widowReveal, shuffledList, rulesOf, RULES } from './table.js';
import { OnlineTable, onlineAvailable } from './online.js';
import { think } from './think.js';
import { play as playSound, sound, unlockSound } from './sounds.js';

const app = document.getElementById('app');
// The page's options as it was opened (the address changes to ?t=CODE once at a table).
// For checking the page: ?name=X, ?play, ?autoplay, ?fast, ?nokitty, ?nohouse (house rules off), ?newtable=CODE&startafter=N.
const params = new URLSearchParams(location.search);

// MARK: Remembered on this device

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const settings = Object.assign({ name: '', back: 'red', highFirst: true, largePrint: false, sounds: true, hints: false, kitty: true, rules: {} }, stored('pn.settings', {}));
settings.rules = rulesOf(settings.rules);
function saveSettings() {
  store('pn.settings', settings);
  document.body.classList.toggle('large-print', settings.largePrint);
  sound.on = settings.sounds;
}
saveSettings();

// The online table this browser last sat at, so the start screen can offer to go back.
const lastTable = {
  get: () => stored('pn.table', null),
  set: (code) => store('pn.table', code),
  clear: () => store('pn.table', null),
};

// A game against the computer, saved after every move so a reload doesn't lose it.
const savedGame = {
  get: () => { const s = stored('pn.local', null); return s && s.game && s.game.phase !== 'gameOver' ? s : null; },
  set: (s) => store('pn.local', s),
};

// Statistics, kept on this device.
const blankLine = () => ({ played: 0, won: 0, lost: 0, hands: 0, myBids: 0, myBidsMade: 0, thrownIn: 0, bestHand: 0, bestMeld: 0 });
const stats = stored('pn.stats', null) || { computer: blankLine(), online: blankLine() };
const saveStats = () => store('pn.stats', stats);

const myName = () => settings.name || 'Player';

// MARK: Helpers

/** Names come from other people's browsers: never let them be read as HTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function button(text, cls, onclick) {
  const b = el('button', cls);
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const suitHTML = (s) => `<span class="suit${isRedSuit(s) ? ' red' : ''}">${SYMBOL[s]}</span>`;
const cardText = (c) => `<b>${rankLabel(c)}</b>${suitHTML(suitOf(c))}`;

function cardEl(c) {
  const red = isRedSuit(suitOf(c));
  const e = el('div', 'card' + (red ? ' red' : ''));
  e.innerHTML = `<div class="corner"><span class="r">${rankLabel(c)}</span><span class="s">${SYMBOL[suitOf(c)]}</span></div><div class="pip">${SYMBOL[suitOf(c)]}</div>`;
  e.setAttribute('aria-label', label(c));
  return e;
}

function backEl() {
  const e = el('div', 'back');
  const inner = el('div');
  inner.style.backgroundImage = `url(img/back_${settings.back}.jpg)`;
  e.appendChild(inner);
  return e;
}

/** A bid on a card-colored chip, or a grey "Pass". */
const bidChip = (amount, large = false) => `<span class="bid-chip${amount === null ? ' pass' : ''}${large ? ' large' : ''}">${amount === null ? 'Pass' : amount}</span>`;
const trumpChip = (t) => `<span class="bid-chip${isRedSuit(t) ? ' red' : ''}">${SYMBOL[t]}</span>`;
const dealerChip = '<span class="dealer" aria-label="Dealer">D</span>';

/** A dialog over the page. `title` and a string `body` are HTML; Escape or a tap outside
 *  calls `dismiss`, when there is one. */
function dialog(title, body, buttons, dismiss) {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  if (title) p.appendChild(el('h2', '', title));
  if (typeof body === 'string') p.appendChild(el('p', '', body));
  else if (body) p.appendChild(body);
  if (buttons && buttons.length) { const row = el('div', 'buttons'); row.append(...buttons); p.appendChild(row); }
  o.appendChild(p);
  if (dismiss) {
    o.dataset.dismiss = '';
    o.dismiss = dismiss;
    o.onclick = (e) => { if (e.target === o) dismiss(); };
  }
  return o;
}

/** A dialog of its own (the menu, settings, a question) that stays on top while the table
 *  redraws under it. `buttons` are [text, class, action]; each one closes it. */
function popup(title, body, buttons, onDismiss) {
  const o = dialog(title, body, buttons.map(([text, cls, then]) => button(text, cls, () => { o.remove(); then?.(); })),
    () => { o.remove(); onDismiss?.(); });
  o.classList.add('popup');
  app.appendChild(o);
  return o;
}

const message = (html, then) => popup('', html, [['OK', 'primary', then]], then);
const confirmThen = (title, html, yes, onYes) => popup(title, html, [['Cancel', ''], [yes, 'primary', onYes]]);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') [...document.querySelectorAll('.overlay[data-dismiss]')].pop()?.dismiss();
});
// Browsers only allow sound after a tap.
document.addEventListener('pointerdown', unlockSound);

/** A two-way switch: [[value, text], [value, text]]. */
function twoWay(options, value, onChange, disabled = false) {
  const box = el('div', 'switch');
  for (const [v, text] of options) {
    const b = button(text, v === value ? 'on' : '', () => onChange(v));
    b.disabled = disabled;
    box.appendChild(b);
  }
  return box;
}
/** With a kitty / No kitty. */
const kittySwitch = (value, onChange, disabled) => twoWay([[true, 'With a Kitty'], [false, 'No Kitty']], value, onChange, disabled);
const kittyNote = (kitty) => (kitty ? '15 cards each and 3 in the kitty' : '16 cards each, no kitty');
/** The meld in a hand, by the house rules of the game being shown. */
const meldIn = (hand, t) => meldOf(hand, t, state?.game || {});

// MARK: House rules

const rulesOff = () => Object.fromEntries(RULES.map((k) => [k, false]));

/** Each house rule: key, title, then [switch label, summary, what it means] for on and off. */
const HOUSE = [
  ['doubleMarriage', 'Double marriage', ['30', 'Double marriage 30', 'Both K Q of a suit score 30, trump or not.'], ['4/8', 'Double marriage 4/8', 'Both K Q of a suit are just two marriages: 4, or 8 in trump.']],
  ['roundhouse', 'Roundhouse with a run', ['24', 'Roundhouse 24', 'K and Q of every suit count their full 24 beside a run.'], ['20', 'Roundhouse 20 with a run', 'The run’s K Q isn’t a royal marriage too: 20 beside a run.']],
  ['buriedToLast', 'Buried cards go to', ['Last Trick', 'Buried to the last trick', 'Whoever takes the last trick gets the buried cards’ points.'], ['Bidder', 'Buried to the bidder', 'The bidder always gets the buried cards’ points.']],
];
const houseSummary = (r) => HOUSE.map(([k, , on, off]) => (r[k] ? on : off)[1]).join(' · ');

/** The House Rules button and a one-line summary: opens the switches (or just shows them,
 *  if `onChange` is null). */
function houseButton(rules, onChange) {
  const box = el('div', 'house');
  box.appendChild(button(onChange ? 'House Rules ›' : 'House Rules', 'link', () => showHouse(rules, onChange)));
  box.appendChild(el('div', 'note', houseSummary(rules)));
  return box;
}
function showHouse(rules, onChange) {
  const r = { ...rules };
  const body = el('div', 'house-rules');
  const draw = () => {
    body.innerHTML = '';
    for (const [k, name, on, off] of HOUSE) {
      body.appendChild(el('div', 'house-name', name));
      body.appendChild(twoWay([[true, on[0]], [false, off[0]]], r[k], (v) => { r[k] = v; draw(); }, !onChange));
      body.appendChild(el('div', 'note', (r[k] ? on : off)[2]));
    }
  };
  draw();
  if (onChange) popup('House Rules', body, [['Cancel', ''], ['Done', 'primary', () => onChange(r)]]);
  else popup('House Rules', body, [['OK', 'primary']]);
}

// MARK: Start screen

let host = null;      // LocalHost or OnlineTable
let state = null;     // The table state being shown.
const ui = {
  me: 0,
  selected: new Set(),   // Cards picked to bury.
  trumpPick: null,       // The trump picked while burying.
  pending: null,         // The card picked to play: it waits for a second tap or the button.
  bid: null,             // The bid on the stepper.
  hint: null, hintCard: null, thinkingHint: false,
  banner: null,          // { title, detail, big, until, id }: a message over the table.
  bannerShown: null,     // The banner last drawn: it pops in only the first time.
  revealStart: 0,        // When the kitty started turning up (one card at a time).
  widowPopped: 0,        // Kitty cards already turned (each pops once).
  meldShown: null,       // The hand whose meld has been drawn (it pops in once).
  linger: null,          // { plays, winner, start }: a finished trick left up, then swept to its winner.
  shown: { key: '', count: 0 },   // Trick cards already drawn (new ones slide in).
  holdResultUntil: 0,    // The hand just ended: the result waits so "Set!" can be seen first.
  sentAt: null,          // Online guest: the state version when I sent a move (no double taps).
  prev: null,            // The last game drawn (a copy), to see what changed.
  recorded: false,       // This game's result is in the stats.
  showSheet: false, showFinal: false,
  overlayKey: null,      // The overlay drawn last time (it doesn't fade in again).
};
const later = [];        // Timers that redraw when something on the table expires.

function resetUI() {
  Object.assign(ui, {
    pending: null, bid: null, trumpPick: null, hint: null, hintCard: null, thinkingHint: false, banner: null, bannerShown: null,
    revealStart: 0, widowPopped: 0, meldShown: null, linger: null, shown: { key: '', count: 0 }, holdResultUntil: 0,
    sentAt: null, prev: null, recorded: false, showSheet: false, showFinal: false, overlayKey: null,
  });
  ui.selected.clear();
  later.splice(0).forEach(clearTimeout);
}

function redrawAt(time) {
  later.push(setTimeout(() => render(), Math.max(0, time - Date.now()) + 20));
}

const isOnline = () => host instanceof OnlineTable;

function leaveTable() {
  // Mid-game, keep the code: the others wait, and Back to Table brings me back.
  const midGame = isOnline() && host.started && state && state.game.phase !== 'gameOver';
  if (isOnline() && !midGame) lastTable.clear();
  showLobby();
}

function showLobby() {
  host?.stop(); host = null; state = null;
  resetUI();
  if (location.search) history.replaceState(null, '', location.pathname);
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Pinochle'));
  lobby.appendChild(el('div', 'tag', 'Three-handed · first to 150'));
  const fan = el('div', 'fan');
  [card(HEARTS, ACE), card(HEARTS, TEN), card(SPADES, QUEEN), card(DIAMONDS, JACK), card(HEARTS, KING)].forEach((c, i) => {
    const e = cardEl(c);
    e.style.transform = `translateX(-50%) rotate(${(i - 2) * 9}deg)`;
    fan.appendChild(e);
  });
  lobby.appendChild(fan);

  const name = el('div', 'name', 'Playing as ');
  name.appendChild(button(settings.name || 'You', 'link', () => askName(showLobby)));
  lobby.appendChild(name);

  const code = onlineAvailable() && lastTable.get();
  if (code) lobby.appendChild(button(`Back to Table ${code}`, 'big-button primary', () => joinTable(code)));

  const saved = savedGame.get();
  if (saved) lobby.appendChild(button(`Continue Game · ${saved.game.scores.join('–')}`, 'big-button primary', () => playComputer(saved)));
  lobby.appendChild(kittySwitch(settings.kitty, (v) => { settings.kitty = v; saveSettings(); showLobby(); }));
  lobby.appendChild(houseButton(settings.rules, (r) => { settings.rules = r; saveSettings(); showLobby(); }));
  lobby.appendChild(button(saved ? 'New Game vs the Computer' : 'Play the Computer', 'big-button', () => {
    if (saved) confirmThen('New Game?', 'The game you have going will be lost.', 'New Game', () => playComputer());
    else playComputer();
  }));

  const friends = button('Play with Friends', 'big-button', showFriends);
  friends.disabled = !onlineAvailable();
  lobby.appendChild(friends);

  const links = el('div', 'links');
  links.appendChild(button('Settings', 'link', () => showSettings(showLobby)));
  links.appendChild(button('Statistics', 'link', showStats));
  links.appendChild(button('How to Play', 'link', showRules));
  lobby.appendChild(links);
  app.appendChild(lobby);
  if (!settings.name) askName(showLobby);
}

function askName(then) {
  const input = el('input', 'text');
  input.maxLength = 16; input.value = settings.name; input.placeholder = 'Your name'; input.autocomplete = 'nickname';
  const save = () => {
    const name = input.value.trim().slice(0, 16);
    if (!name) { input.focus(); return; }
    settings.name = name; saveSettings(); o.remove(); then?.();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  const o = dialog('Your name?', input, [button('OK', 'primary', save)], settings.name ? () => o.remove() : null);
  o.classList.add('popup');
  app.appendChild(o);
  input.focus();
}

function playComputer(saved = null) {
  let s = saved;
  if (!s) {
    const names = shuffledList(BOT_NAMES.filter((n) => n !== settings.name));
    const seats = [{ kind: 'person', name: settings.name || 'You' }, ...[0, 1].map((i) => ({ kind: 'bot', name: names[i] }))];
    if (params.has('autoplay')) seats[0].kind = 'bot';     // Testing: bots in every seat.
    s = newTableState(seats, params.has('nokitty') ? false : settings.kitty, params.has('nohouse') ? rulesOff() : settings.rules);
  }
  ui.me = 0;
  resetUI();
  const keep = !params.has('autoplay');
  host = new LocalHost(s, (next) => {
    state = next;
    if (keep) savedGame.set(next.game.phase === 'gameOver' ? null : next);
    update();
    render();
  });
}

// MARK: Playing with friends

function showFriends() {
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Pinochle'));
  lobby.appendChild(el('div', 'tag', 'Play with friends'));
  lobby.appendChild(button('Start a Table', 'big-button primary', () => withTable(OnlineTable.create(myName(), onTableUpdate, null, settings.kitty, settings.rules))));
  lobby.appendChild(el('div', 'note', 'or join with a code'));
  const row = el('div', 'row');
  const input = el('input', 'code');
  input.maxLength = 4; input.placeholder = 'CODE'; input.autocapitalize = 'characters'; input.autocomplete = 'off'; input.spellcheck = false;
  const join = button('Join', 'primary', () => { if (input.value.trim().length === 4) joinTable(input.value.trim()); else input.focus(); });
  input.onkeydown = (e) => { if (e.key === 'Enter') join.onclick(); };
  row.append(input, join);
  lobby.appendChild(row);
  lobby.appendChild(el('div', 'note', 'Three seats; bots fill any empty ones when the game starts. If someone drops, the game waits until they’re back — they reopen the link, or tap Back to Table on the start screen.'));
  lobby.appendChild(button('Back', '', showLobby));
  app.appendChild(lobby);
}

const joinTable = (code) => withTable(OnlineTable.join(code, myName(), onTableUpdate));

async function withTable(promise) {
  app.innerHTML = '<div class="lobby"><div class="tag">Connecting…</div></div>';
  resetUI();
  try {
    host = await promise;
    lastTable.set(host.code);
    history.replaceState(null, '', `${location.pathname}?t=${host.code}`);
    onTableUpdate();
  } catch (e) {
    const text = (e && e.message) || String(e);
    if (/no table|already started|full/i.test(text)) lastTable.clear();
    showFriends();
    message(esc(text));
  }
}

function onTableUpdate() {
  if (!isOnline()) return;
  ui.me = Math.max(0, host.mySeat);
  if (host.started && host.state) {
    state = host.state;
    update();
    render();
    testAutoplay();
  } else waitingRoom();
}

// Testing online: ?autoplay makes this browser play its own seat with a bot, and
// ?startafter=N (host) starts the table once N people are seated.
let autoTimer = null, autoBusy = false;
function testAutoplay() {
  if (!params.has('autoplay') || !state) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    const g = state.game, me = ui.me;
    if (state.paused || autoBusy) return;
    if (isActive(g) && g.turn === me) {
      autoBusy = true;
      const version = state.version;
      const move = await think(g, me, 'steady');
      autoBusy = false;
      if (state.version === version) host.send({ ...move, seat: me });
    } else if (g.phase === 'handOver' && !(g.continued || []).includes(me)) host.send({ type: 'continue', seat: me });
    document.title = `Pinochle ${g.phase} hand ${g.handNumber + 1} scores ${g.scores.join(',')}`;
  }, 400);
}

function waitingRoom() {
  const t = host;
  const want = Number(params.get('startafter') || 0);
  if (want && t.isHost && t.seats.filter((x) => x.kind === 'person').length >= want) { t.start(); return; }
  state = null;
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('div', 'tag', 'Table code'));
  lobby.appendChild(el('h1', 'table-code', t.code));
  const link = `${location.origin}${location.pathname}?t=${t.code}`;
  const share = button('Send the Link', 'primary', async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Pinochle', text: `Join my Pinochle table: ${t.code}`, url: link }); } catch {} return; }
    try { await navigator.clipboard.writeText(link); share.textContent = 'Link Copied'; } catch { share.textContent = link; }
  });
  lobby.appendChild(share);
  const list = el('div', 'seats-list');
  t.seats.forEach((seat, i) => {
    const row = el('div', 'seat-row');
    if (seat.kind === 'open') row.innerHTML = `<span class="n">${i + 1}</span><i>Open — a bot sits here if nobody joins</i>`;
    else row.innerHTML = `<span class="n">${i + 1}</span><b>${esc(seat.name)}</b>${seat.uid === t.uid ? '<span class="you">you</span>' : ''}<span class="dot ${t.presence[seat.uid] ? 'on' : ''}"></span>`;
    list.appendChild(row);
  });
  lobby.appendChild(list);
  if (t.isHost) {
    lobby.appendChild(kittySwitch(t.kitty, (v) => t.setKitty(v)));
    lobby.appendChild(el('div', 'note', kittyNote(t.kitty)));
    lobby.appendChild(houseButton(t.rules, (r) => t.setRules(r)));
    const open = t.seats.filter((s) => s.kind === 'open').length;
    lobby.appendChild(button(open ? `Start — bots take ${open} seat${open === 1 ? '' : 's'}` : 'Start the Game', 'big-button primary', () => t.start()));
  } else {
    lobby.appendChild(el('div', 'note', `${t.kitty ? 'With a kitty' : 'No kitty'}: ${kittyNote(t.kitty)}.`));
    lobby.appendChild(houseButton(t.rules, null));
    const hostSeat = t.seats.find((s) => s.uid === t.meta?.hostUid);
    lobby.appendChild(el('div', 'note', `Waiting for ${hostSeat ? esc(hostSeat.name) : 'the host'} to start…`));
  }
  lobby.appendChild(button('Leave', '', leaveTable));
  app.appendChild(lobby);
}

// MARK: Who's who

const positionOf = (seat) => (seat - ui.me + 3) % 3;      // 0 me (bottom), 1 left, 2 right.
const seatAt = (position) => (ui.me + position) % 3;
const nameOf = (seat) => esc(state.seats[seat].name) + (state.seats[seat].standIn ? ' (bot)' : '');
/** "You" for me, else the name. */
const who = (seat) => (seat === ui.me ? 'You' : nameOf(seat));
const colorOf = (seat) => ['c0', 'c1', 'c2'][positionOf(seat)];
const isActive = (g) => ['bidding', 'widow', 'trump', 'meld', 'playing'].includes(g.phase);
const isMyTurn = (g) => isActive(g) && g.turn === ui.me && !state.paused;
const waitingOnHost = () => isOnline() && !host.isHost && ui.sentAt !== null && ui.sentAt === state.version;
const revealingWidow = (g, now = Date.now()) => g.phase === 'widow' && now < ui.revealStart + widowReveal();

// MARK: What changed: sounds, banners, the kitty, the last trick, the stats

function showBanner(b, ms = 2400) {
  ui.banner = { ...b, until: Date.now() + ms, id: Math.random() };
  redrawAt(ui.banner.until);
}

function update() {
  const g = state.game, old = ui.prev, now = Date.now();
  if (ui.sentAt !== null && state.version !== ui.sentAt) ui.sentAt = null;
  const newGame = !old || g.history.length < old.history.length || (old.phase === 'gameOver' && g.phase !== 'gameOver');
  const newDeal = newGame || old.handNumber !== g.handNumber || old.redeals !== g.redeals;
  if (newDeal) {
    if (old) playSound('deal');
    ui.holdResultUntil = 0; ui.linger = null; ui.revealStart = 0; ui.pending = null; ui.selected.clear(); ui.trumpPick = null;
    ui.hint = null; ui.hintCard = null; ui.showFinal = false; ui.bid = null;
    if (newGame) ui.recorded = false;
  } else if (g.played.length > old.played.length) playSound('snap');

  if (old && !newGame) {
    if (g.redeals > old.redeals) showBanner({ title: 'Everyone passed', detail: 'New deal' });
    if (old.phase === 'bidding' && g.phase !== 'bidding' && g.bidder !== null) {
      showBanner({ title: `${who(g.bidder)} ${g.bidder === ui.me ? 'take' : 'takes'} it`, detail: `at ${g.highBid}` }, g.phase === 'widow' ? 1400 : 2000);
    }
    // The bidding is over: turn the kitty up slowly, one card at a time, for everyone.
    if (old.phase === 'bidding' && g.phase === 'widow') {
      ui.revealStart = params.has('fast') ? now - 99999 : now;
      ui.widowPopped = 0;
      for (let i = 1; i <= G.WIDOW + 1; i++) redrawAt(now + PACE.widowCard * i);
      redrawAt(now + widowReveal());
      ui.selected.clear();
      ui.trumpPick = null;
    }
    if (old.phase !== 'meld' && g.phase === 'meld') showBanner({ title: `Trump: ${SYMBOL[g.trump]} ${SUIT_NAME[g.trump]}`, detail: `named by ${who(g.bidder)}`, suit: g.trump }, 1800);
    // A trick just finished: leave it on the table a moment, then slide it to the winner.
    if (g.played.length > old.played.length && !g.trick.length && g.lastTrick.length) {
      ui.linger = { plays: g.lastTrick, winner: g.lastTrickWinner, start: now, key: g.played.length };
      redrawAt(now + trickLinger());
    }
    if (g.trick.length && old.trick.length === 0) ui.linger = null;
    if (g.result && !old.result) handEnded(g);
    if (g.phase !== old.phase || g.turn !== old.turn) { ui.hint = null; ui.hintCard = null; ui.pending = null; }
  }
  if (g.phase === 'gameOver' && g.winner !== null && !ui.recorded && old) {
    ui.recorded = true;
    const won = g.winner === ui.me;
    if (!params.has('autoplay')) {
      const line = stats[isOnline() ? 'online' : 'computer'];
      line.played += 1; line[won ? 'won' : 'lost'] += 1;
      saveStats();
    }
    if (won) playSound('fanfare', PACE.resultHold / 1000);
  }
  ui.prev = JSON.parse(JSON.stringify(g));
}

function handEnded(g) {
  const r = g.result, now = Date.now(), me = ui.me;
  if (!params.has('autoplay')) {
    const line = stats[isOnline() ? 'online' : 'computer'];
    line.hands += 1;
    if (r.bidder === me) { line.myBids += 1; if (r.made) line.myBidsMade += 1; if (r.conceded) line.thrownIn += 1; }
    line.bestHand = Math.max(line.bestHand, r.score[me]);
    line.bestMeld = Math.max(line.bestMeld, r.meld[me]);
    saveStats();
  }
  const mine = r.bidder === me;
  const banner = r.conceded ? { title: 'Thrown in', detail: `${who(r.bidder)} ${signed(r.score[r.bidder])}` }
    : r.made ? { title: 'Made it!', detail: `${who(r.bidder)} ${signed(r.score[r.bidder])}`, big: true, good: mine }
      : { title: 'Set!', detail: `${who(r.bidder)} ${r.score[r.bidder]}`, big: true, good: !mine };
  if (!r.made && !r.conceded) playSound('knock');
  const fast = params.has('fast');
  const wait = r.conceded ? 0 : trickLinger();
  showBanner(banner, fast ? 100 : PACE.resultHold + 400);
  ui.holdResultUntil = fast ? now : now + PACE.resultHold + wait;
  redrawAt(ui.holdResultUntil);
}

// MARK: The table

/** Card sizes from the window, as CSS variables. My hand is as big as it can be while
 *  every card still shows its corner (`n` cards). */
function sizes(n = 15) {
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  const sideways = w > h && h < 500, big = w >= 700 && h >= 700;
  const across = Math.min(w - 24, 1000) / (1 + 0.4 * Math.max(0, n - 1));
  return {
    sideways,
    hand: Math.floor(Math.min(across, (w - 24) / 7.4 * (w < 700 ? 1.3 : 1), big ? 104 : 84, sideways ? h / 5.4 : h / 7.4)),
    trick: Math.floor(Math.min(w / 6, h / (sideways ? 6.5 : 8.5), big ? 116 : 84)),
  };
}

function render() {
  if (!state) return;
  const g = state.game, me = ui.me, now = Date.now();
  if (ui.pending !== null && !G.legalPlays(g, me).includes(ui.pending)) ui.pending = null;
  const size = sizes(handCards(g).length);
  // The table and its overlays are redrawn in one piece; dialogs opened on top of them
  // (the menu, settings) are left alone, so they don't flicker as the bots play.
  const screen = el('div', 'screen');
  const table = el('div', 'table' + (size.sideways ? ' sideways' : ''));
  table.style.setProperty('--hand-w', size.hand + 'px');
  table.style.setProperty('--trick-w', size.trick + 'px');
  if (isOnline() && !host.connected) table.appendChild(el('div', 'banner-line', 'Connection lost — reconnecting…'));

  table.appendChild(topBar(g));
  const middle = el('div', 'middle');
  for (const position of [1, 2]) middle.appendChild(seatBadge(g, seatAt(position), position));
  const center = el('div', 'center');
  const revealing = revealingWidow(g, now);
  if (g.phase === 'widow' && (revealing || g.bidder !== me)) center.appendChild(widowShow(g, now, revealing));
  else if (g.phase === 'meld') middle.appendChild(meldBoard(g));
  else center.appendChild(trickEl(g, now));
  if (ui.banner && now < ui.banner.until) middle.appendChild(bannerEl(ui.banner));
  middle.appendChild(center);
  table.appendChild(middle);

  table.appendChild(controls(g, revealing));
  table.appendChild(meLine(g));
  table.appendChild(handRow(g, revealing));
  screen.appendChild(table);
  const old = app.querySelector(':scope > .screen');
  if (old) old.replaceWith(screen);
  else { app.innerHTML = ''; app.appendChild(screen); }

  // Overlays. The same one as last time doesn't fade in again.
  let overlay = null, key = null;
  const over = g.phase === 'handOver' || g.phase === 'gameOver';
  if (state.paused && state.paused.seat !== me) { overlay = pausedPanel(); key = 'paused'; }
  else if (over && now >= ui.holdResultUntil) {
    overlay = ui.showFinal ? finalPanel(g) : resultPanel(g);
    key = `result:${g.handNumber}:${g.phase}:${ui.showFinal}`;
  } else if (ui.showSheet) { overlay = sheetPanel(g); key = 'sheet'; }
  if (overlay) {
    if (key === ui.overlayKey) overlay.classList.add('still');
    screen.appendChild(overlay);
  }
  ui.overlayKey = key;
}

/** Points taken in tricks so far, counting the last trick only once it has slid over. */
const lingering = (now = Date.now()) => ui.linger && now < ui.linger.start + trickLinger();
function shownPoints(g, seat) {
  if (!lingering() || ui.linger.winner !== seat) return g.points[seat];
  const plays = ui.linger.plays;
  const last = g.hands.every((h) => h.length === 0) && ui.linger.key === g.played.length ? 1 : 0;
  return g.points[seat] - plays.filter((p) => isCounter(p.card)).length - last;
}

function topBar(g) {
  const top = el('div', 'topbar');
  const scores = el('div', 'scores');
  for (const position of [0, 1, 2]) {
    const s = seatAt(position);
    scores.appendChild(el('div', `score ${colorOf(s)}`, `<i></i><b>${position === 0 ? 'You' : nameOf(s)}</b><span class="n">${g.scores[s]}</span>`));
  }
  top.appendChild(scores);
  if (g.bidder !== null && g.phase !== 'bidding' && g.highBid !== null) {
    const trump = g.trump !== null ? ` ${suitHTML(g.trump)}` : '';
    let detail = who(g.bidder);
    if (g.phase === 'playing' && g.melds) {
      const have = g.melds[g.bidder].total + shownPoints(g, g.bidder) + (g.bidder === ui.me && !g.buriedToLast ? g.buried.filter(isCounter).length : 0);
      detail += have >= g.highBid ? ' · made' : ` · needs ${g.highBid - have}`;
    }
    top.appendChild(el('div', `contract ${colorOf(g.bidder)}`, `<b>${g.highBid}${trump}</b><small>${detail}</small>`));
  } else top.appendChild(el('div', 'hand-no', `Hand ${g.handNumber + 1}`));
  const menu = button('•••', 'menu', showMenu);
  menu.setAttribute('aria-label', 'Game menu');
  top.appendChild(menu);
  return top;
}

/** Another player: name, dealer, a little fan of their cards, their bid or meld and
 *  points, and a gold outline when it's their turn. */
function seatBadge(g, seat, position) {
  const turn = isActive(g) && g.turn === seat;
  const b = el('div', `seat ${['', 'west', 'east'][position]}${turn ? ' turn' : ''}`);
  b.appendChild(el('div', 'who', `<i class="dot-color ${colorOf(seat)}"></i><b>${nameOf(seat)}</b>${g.dealer === seat ? dealerChip : ''}`));
  const fan = el('div', 'fan-backs');
  const n = g.hands[seat].length + (g.phase === 'widow' && seat === g.bidder && !revealingWidow(g) ? g.widow.length : 0);
  fan.style.setProperty('--n', Math.max(1, n));
  for (let i = 0; i < n; i++) { const back = backEl(); back.style.left = `calc(var(--bw) * 0.16 * ${i})`; fan.appendChild(back); }
  b.appendChild(fan);
  b.appendChild(el('div', 'status', seatStatus(g, seat)));
  const uid = isOnline() && state.seats[seat].kind === 'person' && host.seats[seat]?.uid;
  if (uid && !host.presence[uid]) b.appendChild(el('div', 'away', 'Away'));
  return b;
}

function seatStatus(g, seat) {
  const star = seat === g.bidder ? `★ ${g.highBid} · ` : '';
  switch (g.phase) {
    case 'bidding': {
      const call = g.calls.filter((c) => c.seat === seat).pop();
      if (!call) return g.turn === seat ? '<span class="dots"><i></i><i></i><i></i></span>' : '<span class="faint">…</span>';
      return bidChip(call.amount);
    }
    case 'widow': case 'trump': return seat === g.bidder ? `★ ${g.highBid}` : '&nbsp;';
    case 'meld': return `${star}meld ${g.melds[seat].total}`;
    case 'playing': return `${star}meld ${g.melds[seat].total} · ${shownPoints(g, seat)} pts`;
    default: return '&nbsp;';
  }
}

/** The cards in the middle. New ones slide in from whoever played them; a finished trick
 *  stays up a moment, then slides off to its winner. */
function trickEl(g, now) {
  const trick = el('div', 'trick');
  const linger = lingering(now) ? ui.linger : null;
  const plays = linger ? linger.plays : g.phase === 'playing' ? g.trick : [];
  const key = linger ? `l${linger.key}` : `${g.handNumber}:${g.played.length - g.trick.length}`;
  // The cards of a trick that just finished were already drawn while it was being played.
  const seen = ui.shown.key === key ? ui.shown.count : (linger && ui.shown.key === `${g.handNumber}:${linger.key - 3}` ? ui.shown.count : 0);
  const winner = linger ? linger.winner : G.currentWinner(g);
  plays.forEach((p, i) => {
    const c = cardEl(p.card);
    c.classList.add('p' + positionOf(p.seat));
    if (i >= seen) c.classList.add('enter');
    if (p.seat === winner) c.classList.add('winner');
    trick.appendChild(c);
  });
  ui.shown = { key, count: plays.length };
  if (linger && !params.has('fast')) {
    // The sweep runs on the clock, so a redraw part-way through picks up where it was.
    trick.classList.add('collect', 'to-' + positionOf(linger.winner));
    trick.style.setProperty('--sweep-delay', `${PACE.trickPause - (now - linger.start)}ms`);
  }
  return trick;
}

/** The kitty in the middle: turned up one card at a time for everyone after the bidding,
 *  then (if someone else won it) left showing while they bury and name trump. */
function widowShow(g, now, revealing) {
  const box = el('div', 'kitty-show');
  box.appendChild(el('div', 'caption', `Kitty for ${who(g.bidder)} · bid ${g.highBid}`));
  const row = el('div', 'cards');
  const shown = revealing ? Math.min(G.WIDOW, Math.floor((now - ui.revealStart) / PACE.widowCard)) : G.WIDOW;
  if (shown > ui.widowPopped && shown <= G.WIDOW) playSound('snap');
  g.revealedWidow.forEach((c, i) => {
    if (i < shown) {
      const e = cardEl(c);
      if (i >= ui.widowPopped && revealing) e.classList.add('turned');
      row.appendChild(e);
    } else row.appendChild(backEl());
  });
  ui.widowPopped = Math.max(ui.widowPopped, shown);
  box.appendChild(row);
  return box;
}

/** Everyone's meld, side by side: the cards shown, what they make, and the total. */
function meldBoard(g, still = false) {
  const fresh = !still && ui.meldShown !== `${g.handNumber}:${g.redeals}`;
  if (!still) ui.meldShown = `${g.handNumber}:${g.redeals}`;
  const box = el('div', 'meld-board' + (fresh ? ' fresh' : '') + (still ? ' in-popup' : ''));
  box.appendChild(el('div', 'caption', `Trump ${suitHTML(g.trump)} · ${who(g.bidder)} bid ${g.highBid}`));
  for (const position of [1, 2, 0]) {
    const s = seatAt(position), m = g.melds[s];
    const row = el('div', `meld-row ${colorOf(s)}`);
    row.appendChild(el('div', 'head', `<i class="dot-color ${colorOf(s)}"></i><b>${who(s)}</b>${s === g.bidder ? ' ★' : ''}<span class="total">${m.total}</span>`));
    if (m.parts.length) {
      const cards = el('div', 'cards');
      m.faces.forEach((f) => cards.appendChild(cardEl(f)));
      row.appendChild(cards);
      row.appendChild(el('div', 'parts', m.parts.map((p) => `${p.name} ${p.points}`).join(' · ')));
    } else row.appendChild(el('div', 'parts faint', 'No meld'));
    box.appendChild(row);
  }
  return box;
}

function bannerEl(b) {
  const fresh = ui.bannerShown !== b.id;
  ui.bannerShown = b.id;
  const tone = b.good === true ? ' good' : b.good === false ? ' bad' : '';
  return el('div', `banner${tone}${b.big ? ' big' : ''}${fresh ? ' fresh' : ''}`, `<b>${b.title}</b>${b.detail ? `<small>${b.detail}</small>` : ''}`);
}

function statusText(g, revealing) {
  const me = ui.me;
  const whose = g.turn === me ? null : nameOf(g.turn);
  switch (g.phase) {
    case 'bidding':
      if (whose) return `${whose} is bidding…`;
      return g.highBid === null ? 'Your bid — 15 or more, or pass' : `Bid over ${g.highBid}, or pass`;
    case 'widow':
      if (revealing) return 'Turning up the kitty…';
      if (whose) return `${whose} is burying 3 and naming trump…`;
      return `Bury 3 cards (${ui.selected.size}/3) and name trump`;
    case 'trump':
      return whose ? `${whose} is naming trump…` : 'Name trump';
    case 'meld': {
      if (g.bidder !== me) return (g.meldDone || []).includes(g.bidder) ? `${nameOf(g.bidder)} will play it — look over the meld, then tap Done` : `${nameOf(g.bidder)} is deciding: play it or throw it in…`;
      if ((g.meldDone || []).includes(me)) return 'Playing it — once everyone has seen the meld';
      const need = g.highBid - g.melds[me].total;
      return need <= 0 ? 'Your meld makes your bid!' : `You need ${need} more from the tricks (25 in the play)`;
    }
    case 'playing':
      if (whose) return `${whose}’s turn`;
      if (ui.pending !== null) return 'Tap it again to play it';
      return g.trick.length ? 'Your play — pick a card' : 'Your lead — pick a card';
    default: return '';
  }
}

function controls(g, revealing) {
  const box = el('div', 'controls');
  const row = el('div', 'row');
  row.appendChild(el('div', 'status-line', statusText(g, revealing)));
  const mine = isMyTurn(g) && !waitingOnHost();
  if (mine && g.phase === 'playing' && ui.pending !== null) row.appendChild(button(`Play ${label(ui.pending)}`, 'primary', confirmPlay));
  if (mine && settings.hints && !revealing) {
    const b = button(ui.thinkingHint ? 'Thinking…' : '💡 Suggest', 'ghost', suggest);
    b.disabled = ui.thinkingHint;
    row.appendChild(b);
  }
  box.appendChild(row);
  if (ui.hint) box.appendChild(el('div', 'hint', ui.hint));
  if (g.phase === 'bidding') {
    if (mine) box.appendChild(bidControls(g));
    box.appendChild(meldPreview(g.hands[ui.me], g.kitty ? 'Your meld before the kitty:' : 'Your meld:'));
  }
  if (mine && g.phase === 'widow' && !revealing) box.appendChild(buryControls(g));
  if (mine && g.phase === 'trump') box.appendChild(trumpButtons(g.hands[ui.me], (t) => perform({ type: 'trump', trump: t }), null));
  if (g.phase === 'meld' && !waitingOnHost()) {
    // Everyone confirms they've seen the meld: the bidder by Play It, the others by Done.
    const r = el('div', 'row'), done = (g.meldDone || []).includes(ui.me);
    if (mine && !done) {
      r.appendChild(button('Throw In', '', () => confirmThen('Throw the Hand In?', `You lose your bid (${g.highBid}); the others score their meld.`, 'Throw In', () => perform({ type: 'concede' }))));
      r.appendChild(button('Play It', 'primary', () => perform({ type: 'play' })));
    } else if (ui.me !== g.bidder && !done) {
      r.appendChild(button('Done', 'primary', () => host.send({ type: 'meldDone', seat: ui.me })));
    } else {
      const waiting = G.meldWaiting(g).filter((s) => s !== ui.me).map(nameOf);
      const left = g.meldDeadline ? Math.max(0, Math.ceil((g.meldDeadline - Date.now()) / 1000)) : null;
      r.appendChild(el('div', 'pill', `⏳ Waiting for ${waiting.join(', ') || 'the others'}…${left !== null ? ' ' + left : ''}`));
      if (left !== null) redrawAt(Date.now() + 1000);
    }
    box.appendChild(r);
  }
  return box;
}

/** What my cards meld in each suit as trump. */
function meldPreview(hand, title) {
  const best = Math.max(...SUITS.map((t) => meldIn(hand, t).total));
  return el('div', 'meld-preview', `<span class="faint">${title}</span> ${SUITS.map((t) => {
    const v = meldIn(hand, t).total;
    return `<span class="${v === best && v > 0 ? 'best' : ''}">${suitHTML(t)} ${v}</span>`;
  }).join(' ')}`);
}

/** The bid on a stepper (− 17 +), Bid and Pass. */
function bidControls(g) {
  const least = G.minimumBid(g);
  if (ui.bid === null || ui.bid < least) ui.bid = least;
  const box = el('div', 'bidder');
  const minus = button('−', 'step', () => { ui.bid = Math.max(least, ui.bid - 1); render(); });
  minus.disabled = ui.bid <= least;
  minus.setAttribute('aria-label', 'Lower');
  const plus = button('+', 'step', () => { ui.bid = Math.min(999, ui.bid + 1); render(); });
  plus.setAttribute('aria-label', 'Higher');
  box.append(minus, el('div', 'amount', String(ui.bid)), plus);
  box.appendChild(button(`Bid ${ui.bid}`, 'primary', () => perform({ type: 'bid', amount: ui.bid })));
  box.appendChild(button('Pass', 'pass', () => perform({ type: 'pass' })));
  return box;
}

/** Trump buttons, each with the meld it would make. */
function trumpButtons(hand, onPick, picked) {
  const row = el('div', 'trumps');
  for (const t of SUITS) {
    const v = meldIn(hand, t).total;
    const b = el('button', 'trump' + (isRedSuit(t) ? ' red' : '') + (picked === t ? ' on' : ''), `<b>${SYMBOL[t]}</b><small>meld ${v}</small>`);
    b.setAttribute('aria-label', `${SUIT_NAME[t]}, meld ${v}`);
    b.onclick = () => onPick(t);
    row.appendChild(b);
  }
  return row;
}

/** Burying: the trump picked (with the meld of the 15 I'd keep) and the Bury button. */
function buryControls(g) {
  const pool = g.hands[ui.me].concat(g.widow);
  const keep = ui.selected.size === G.WIDOW ? pool.filter((c) => !ui.selected.has(c)) : pool;
  const t = buryTrump(g);
  const box = el('div', 'bury');
  box.appendChild(trumpButtons(keep, (s) => { ui.trumpPick = s; render(); }, t));
  // Burying meld is allowed, but say what it costs.
  const before = meldIn(pool, t).total, after = meldIn(pool.filter((c) => !ui.selected.has(c)), t).total;
  if (after < before) {
    const lost = [...ui.selected].filter((c) => meldCards(pool, t).has(c));
    box.appendChild(el('div', 'meld-loss', `Burying ${lost.map(cardText).join(' ') || 'these'} drops your meld from ${before} to ${after}`));
  } else box.appendChild(el('div', 'meld-key', `The raised cards meld in ${suitHTML(t)} — bury the others to keep it all`));
  const go = button(`Bury 3 · Trump ${SYMBOL[ui.trumpPick]}`, 'primary', bury);
  go.disabled = ui.selected.size !== G.WIDOW;
  box.appendChild(go);
  return box;
}

/** The trump being picked while burying: the one with the most meld until I choose. */
function buryTrump(g) {
  const pool = g.hands[ui.me].concat(g.widow);
  if (ui.trumpPick === null) ui.trumpPick = SUITS.reduce((a, b) => (meldIn(pool, b).total > meldIn(pool, a).total ? b : a));
  return ui.trumpPick;
}

const meldCards = (pool, t) => meldCardsOf(pool, t, state?.game || {}, ui.selected);

function meLine(g) {
  const me = ui.me;
  const parts = [`<i class="dot-color ${colorOf(me)}"></i><b>${nameOf(me)}</b>${g.dealer === me ? dealerChip : ''}`];
  if (g.phase === 'bidding') {
    const call = g.calls.filter((c) => c.seat === me).pop();
    if (call) parts.push(`Your bid ${bidChip(call.amount)}`);
    else if (g.dealer === me) parts.push('You dealt — you bid last');
  } else if (g.phase === 'meld' || g.phase === 'playing') {
    const buried = me === g.bidder && g.buried.length ? (g.buriedToLast ? ` (${g.buried.filter(isCounter).length} buried go to the last trick)` : ` (+${g.buried.filter(isCounter).length} buried)`) : '';
    parts.push(`${me === g.bidder ? `★ ${g.highBid} · ` : ''}meld ${g.melds[me].total}${g.phase === 'playing' ? ` · ${shownPoints(g, me)} pts${buried}` : ''}`);
  } else if ((g.phase === 'widow' || g.phase === 'trump') && me === g.bidder) parts.push(`★ ${g.highBid}`);
  return el('div', 'me-line' + (isMyTurn(g) ? ' turn' : ''), `<span class="pill">${parts.join('<span class="sep"></span>')}</span>`);
}

/** Cards in order: suits alternate black and red; with `trump`, it sits on the right (my
 *  hand passes none: it's never reordered by trump — Louie, 2026-10-25). A 10 sits between
 *  the A and the K. */
export function defaultOrder(hand, trump, highFirst = true) {
  const groups = SUITS.filter((s) => hand.some((c) => suitOf(c) === s));
  const permutations = (list) => (list.length <= 1 ? [list] : list.flatMap((first) => permutations(list.filter((x) => x !== first)).map((rest) => [first, ...rest])));
  const score = (order) => {
    let clashes = 0;
    for (let i = 1; i < order.length; i++) if (isRedSuit(order[i]) === isRedSuit(order[i - 1])) clashes++;
    const trumpNotLast = trump !== null && order.includes(trump) && order[order.length - 1] !== trump ? 1 : 0;
    return [clashes, trumpNotLast, ...order];
  };
  const before = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  let suitOrder = groups, best = null;
  for (const order of permutations(groups)) { const s = score(order); if (!best || before(s, best)) { best = s; suitOrder = order; } }
  return hand.slice().sort((a, b) => {
    const sa = suitOrder.indexOf(suitOf(a)), sb = suitOrder.indexOf(suitOf(b));
    if (sa !== sb) return sa - sb;
    return (highFirst ? power(b) - power(a) : power(a) - power(b)) || a - b;
  });
}

/** The cards in my hand row: with the kitty while I'm burying. */
function handCards(g) {
  const burying = isMyTurn(g) && g.phase === 'widow' && !revealingWidow(g);
  return burying ? g.hands[ui.me].concat(g.widow) : g.hands[ui.me];
}

function handRow(g, revealing) {
  const me = ui.me;
  const row = el('div', 'handrow');
  const burying = isMyTurn(g) && g.phase === 'widow' && !revealing;
  const trumpShown = g.trump ?? (burying ? buryTrump(g) : null);
  const melders = burying ? meldCards(handCards(g), trumpShown) : new Set();
  const hand = defaultOrder(handCards(g), null, settings.highFirst);   // Never reordered by trump (Louie).
  const legal = new Set(G.legalPlays(g, me));
  const myTurn = isMyTurn(g) && g.phase === 'playing';
  // Overlap the cards just enough to fit the screen.
  const cardW = sizes(hand.length).hand;
  const width = Math.min(document.documentElement.clientWidth - 24, 1000);
  const natural = cardW + 4;
  const step = hand.length > 1 ? Math.min(natural, (width - cardW) / (hand.length - 1)) : natural;
  row.style.setProperty('--overlap', `${step - cardW}px`);
  for (const c of hand) {
    const e = cardEl(c);
    if (burying) e.classList.add('choosable');
    if (burying && ui.selected.has(c)) e.classList.add('bury-pick');
    if (melders.has(c)) e.classList.add('meld');
    if (myTurn && c === ui.pending) e.classList.add('picked');
    else if (myTurn && legal.has(c)) e.classList.add('playable');
    else if (myTurn) e.classList.add('dim');
    if (c === ui.hintCard) e.classList.add('hinted');
    e.onclick = () => tapCard(c);
    row.appendChild(e);
  }
  return row;
}

// MARK: Taps and moves

function perform(move) {
  const g = state.game;
  if (!isMyTurn(g) || waitingOnHost()) return;
  const full = { ...move, seat: ui.me };
  if (!G.canApply(g, full, ui.me)) return;
  ui.pending = null; ui.hint = null; ui.hintCard = null;
  if (g.phase === 'widow') ui.selected.clear();
  if (isOnline() && !host.isHost) { ui.sentAt = state.version; render(); }
  host.send(full);
}

/** A card in my hand: pick it to bury, or play it. */
function tapCard(c) {
  const g = state.game, me = ui.me;
  if (!isMyTurn(g) || waitingOnHost()) return;
  if (g.phase === 'widow') {
    if (revealingWidow(g)) return;
    if (ui.selected.has(c)) ui.selected.delete(c);
    else if (ui.selected.size < G.WIDOW) ui.selected.add(c);
    else ui.hint = 'That’s 3 already — tap a picked card to put it back first.';
    ui.hintCard = null;
    render();
    return;
  }
  if (g.phase !== 'playing') return;
  if (!G.legalPlays(g, me).includes(c)) {
    ui.hint = whyNot(g, c);
    ui.hintCard = null;
    render();
    return;
  }
  if (ui.pending === c) confirmPlay();
  else { ui.pending = c; ui.hint = null; render(); }
}

/** Why a card can't be played: follow suit, beat the winning card, or trump. */
function whyNot(g, c) {
  const hand = g.hands[ui.me], led = suitOf(g.trick[0].card), name = (s) => SUIT_NAME[s].toLowerCase();
  if (hand.some((x) => suitOf(x) === led)) {
    if (suitOf(c) !== led) return `You have to follow ${name(led)}.`;
    return 'You have to beat the winning card if you can.';
  }
  if (suitOf(c) !== g.trump) return `You’re out of ${name(led)} — you have to trump.`;
  return 'You have to beat the trump that’s there if you can.';
}

function confirmPlay() {
  if (ui.pending === null) return;
  perform({ type: 'card', card: ui.pending });
}

function bury() {
  if (ui.selected.size !== G.WIDOW || ui.trumpPick === null) return;
  perform({ type: 'bury', cards: [...ui.selected], trump: ui.trumpPick });
}

/** What a Steady bot would do here. */
async function suggest() {
  const g = state.game, me = ui.me;
  if (!isMyTurn(g) || ui.thinkingHint) return;
  ui.thinkingHint = true;
  render();
  const version = state.version;
  const move = await think(g, me, 'steady');
  ui.thinkingHint = false;
  if (state.version !== version) return render();
  ui.hintCard = null;
  if (move.type === 'bid') { ui.hint = `Bid ${move.amount}.`; ui.bid = move.amount; }
  else if (move.type === 'pass') ui.hint = 'Pass.';
  else if (move.type === 'bury') {
    ui.hint = `Bury ${defaultOrder(move.cards, move.trump, settings.highFirst).map(label).join(', ')} and name ${SUIT_NAME[move.trump].toLowerCase()}.`;
    ui.selected = new Set(move.cards);
    ui.trumpPick = move.trump;
  } else if (move.type === 'trump') ui.hint = `Name ${SUIT_NAME[move.trump].toLowerCase()}.`;
  else if (move.type === 'play') ui.hint = 'Play it.';
  else if (move.type === 'concede') ui.hint = 'Throw it in.';
  else if (move.type === 'card') { ui.hint = `Play the ${label(move.card)}.`; ui.hintCard = move.card; }
  render();
}

// MARK: Overlays drawn with the table

/** Every hand so far, like a score pad: who bid what and how it went, each player's
 *  points, and the running totals. */
function scoreSheet(g) {
  const order = [0, 1, 2].map(seatAt);
  const t = el('table', 'sheet');
  t.appendChild(el('tr', '', `<th>#</th><th class="bidcol">Bid</th>${order.map((s) => `<th class="${colorOf(s)}">${s === ui.me ? 'You' : nameOf(s)}</th>`).join('')}`));
  if (!g.history.length) t.appendChild(el('tr', '', '<td colspan="5" class="faint">No hands played yet</td>'));
  const total = [0, 0, 0];
  g.history.forEach((h, i) => {
    h.score.forEach((p, s) => { total[s] += p; });
    const mark = h.conceded ? '<em class="set">thrown in</em>' : h.made ? '<em class="made">made</em>' : '<em class="set">set</em>';
    t.appendChild(el('tr', '', `<td class="faint">${i + 1}</td><td class="bidcol"><i class="dot-color ${colorOf(h.bidder)}"></i>${h.bid} ${suitHTML(h.trump)} ${mark}</td>`
      + order.map((s) => `<td class="pts"><small>${signed(h.score[s])}</small><b>${total[s]}</b></td>`).join('')));
  });
  return t;
}

function scoreRow(g, delta = null) {
  return el('div', 'score-row', [0, 1, 2].map(seatAt).map((s) => `<div><small>${s === ui.me ? 'You' : nameOf(s)}</small>${delta ? `<span>${signed(delta[s])}</span>` : ''}<b class="${colorOf(s)}">${g.scores[s]}</b></div>`).join(''));
}

/** The end of a hand: the bid, everyone's meld and points, made or set and why, the score. */
function resultPanel(g) {
  const r = g.result, me = ui.me;
  const body = el('div', 'result');
  body.appendChild(el('div', 'contract-line', `${who(r.bidder)} bid ${bidChip(r.bid, true)} in ${suitHTML(r.trump)} ${SUIT_NAME[r.trump]}`));
  const t = el('table', 'hand-table');
  t.appendChild(el('tr', '', '<th></th><th>Meld</th><th>Tricks</th><th>Hand</th>'));
  for (const s of [0, 1, 2].map(seatAt)) {
    const buried = g.buried.filter(isCounter).length, to = r.buriedTo ?? r.bidder;
    const note = r.conceded ? '' : s === to && buried ? `<small>incl. ${buried} buried</small>` : s !== r.bidder && !r.tookCounter[s] ? '<small>no counter</small>' : '';
    t.appendChild(el('tr', s === r.bidder ? 'is-bidder' : '', `<td><i class="dot-color ${colorOf(s)}"></i>${who(s)}${s === r.bidder ? ' ★' : ''}</td><td>${r.meld[s]}</td><td>${r.conceded ? '–' : r.counters[s]}${note}</td><td><b>${signed(r.score[s])}</b></td>`));
  }
  body.appendChild(t);
  if (!r.conceded && g.buried.length) {
    const pts = g.buried.filter(isCounter).length;
    body.appendChild(el('p', 'buried-line', `Buried: ${g.buried.map((c) => cardText(c)).join(' ')} — ${pts} point${pts === 1 ? '' : 's'} to ${who(r.buriedTo ?? r.bidder)}${g.buriedToLast ? ' (last trick)' : ''}`));
  }
  body.appendChild(el('p', 'explain', explanation(g, r)));
  body.appendChild(scoreRow(g));
  const buttons = [button('Score Sheet', '', () => { ui.showSheet = true; render(); })];
  if (g.phase === 'gameOver') buttons.push(button('Final Score', 'primary', () => { ui.showFinal = true; render(); }));
  else if ((g.continued || []).includes(me)) {
    const waiting = g.humanSeats.filter((s) => !(g.continued || []).includes(s)).map(nameOf);
    const left = g.continueDeadline ? Math.max(0, Math.ceil((g.continueDeadline - Date.now()) / 1000)) : null;
    buttons.push(el('div', 'pill', `⏳ Waiting for ${waiting.join(', ') || 'the others'}…${left !== null ? ' ' + left : ''}`));
    redrawAt(Date.now() + 1000);
  } else buttons.push(button('Next Hand', 'primary', () => host.send({ type: 'continue', seat: me })));
  const title = r.conceded ? 'Thrown In' : r.made ? 'Made It!' : 'Set!';
  const panel = dialog(title, body, buttons);
  if (ui.showSheet) panel.appendChild(sheetPanel(g));
  return panel;
}

function explanation(g, r) {
  const b = r.bidder, name = who(b), you = b === ui.me;
  let text;
  if (r.conceded) text = `${name} threw the hand in and ${you ? 'lose' : 'loses'} the bid, ${r.bid}. The others score their meld.`;
  else {
    const total = r.meld[b] + r.counters[b];
    text = `${name} needed ${r.bid}: meld ${r.meld[b]} + ${r.counters[b]} from the tricks = ${total}. `
      + (r.made ? `Made it — ${you ? 'you score' : 'scores'} ${total}.` : `Short — ${you ? 'you lose' : 'loses'} ${r.bid}.`);
    const empty = [0, 1, 2].filter((s) => s !== b && !r.tookCounter[s]);
    for (const s of empty) text += ` ${who(s)} took no counters, so ${s === ui.me ? 'your' : 'their'} meld doesn’t count.`;
  }
  if (g.winner !== null) text += ` That takes ${who(g.winner)} to ${g.scores[g.winner]} — ${g.winner === ui.me ? 'you win' : 'the game'}!`;
  return text;
}

/** The end of the game: who won, the final score, the bots' secret styles, and every hand. */
function finalPanel(g) {
  const won = g.winner === ui.me;
  const body = el('div', 'final');
  body.appendChild(el('div', 'how', `${who(g.winner)} reached ${G.TARGET}.`));
  body.appendChild(scoreRow(g));
  const bots = [0, 1, 2].filter((s) => state.seats[s].kind === 'bot' && !state.seats[s].standIn && g.botStyles[s]);
  if (bots.length) {
    const reveal = el('div', 'reveal', '<h3>Turns out…</h3>');
    for (const s of bots) {
      const style = STYLES[g.botStyles[s]];
      reveal.appendChild(el('div', 'style', `<div><b>${nameOf(s)}</b> <span class="faint">was</span> <b class="gold">${style.title}</b></div><small>${style.blurb}</small>`));
    }
    body.appendChild(reveal);
  }
  const sheet = el('div', 'sheet-box');
  sheet.appendChild(scoreSheet(g));
  body.appendChild(sheet);
  const line = stats[isOnline() ? 'online' : 'computer'];
  if (line.played) body.appendChild(el('div', 'note', `${line.won} win${line.won === 1 ? '' : 's'} · ${line.lost} loss${line.lost === 1 ? '' : 'es'} ${isOnline() ? 'with friends' : 'vs the computer'}`));
  return dialog(won ? 'You Win!' : `${nameOf(g.winner)} Wins`, body, [button('Play Again', 'primary', () => host.send({ type: 'newGame' })), button('Leave', '', leaveTable)]);
}

function sheetPanel(g) {
  const close = () => { ui.showSheet = false; render(); };
  const body = el('div');
  body.appendChild(scoreRow(g));
  body.appendChild(el('div', 'note', `First to ${G.TARGET} wins · ${g.kitty ? 'with a kitty' : 'no kitty'} `));
  body.appendChild(houseButton(rulesOf(g), null));
  const box = el('div', 'sheet-box');
  box.appendChild(scoreSheet(g));
  body.appendChild(box);
  return dialog('Score Sheet', body, [button('Close', 'primary', close)], close);
}

function pausedPanel() {
  const away = state.paused;
  const body = el('div');
  body.appendChild(el('p', '', `Waiting for <b>${esc(away.name)}</b> to come back… They reopen the link, or tap Back to Table on the start screen.`));
  const buttons = [];
  if (isOnline() && host.isHost) {
    buttons.push(button(`Let a Bot Play for ${away.name}`, 'primary', () => host.send({ type: 'standIn', away: away.seat })));
    body.appendChild(el('div', 'note', 'They get their seat back as soon as they return.'));
  }
  buttons.push(button('Leave', '', leaveTable));
  return dialog('Paused', body, buttons);
}

// MARK: Dialogs on top of the table

function showMenu() {
  const online = isOnline(), g = state.game;
  const items = [['Score Sheet', '', () => { ui.showSheet = true; render(); }]];
  if (g.melds && (g.phase === 'playing' || g.phase === 'handOver' || g.phase === 'gameOver')) items.push(['Everyone’s Meld', '', () => popup('Meld', meldBoard(g, true), [['Close', 'primary']])]);
  items.push(
    ['Statistics', '', showStats],
    ['Settings', '', () => showSettings(render)],
    ['How to Play', '', showRules],
    ['New Game', '', () => {
      const body = el('div');
      let kitty = g.kitty, rules = rulesOf(g);
      const draw = () => {
        body.innerHTML = '';
        body.appendChild(el('p', '', online ? 'This starts the game over for everyone at the table.' : 'This game’s scores will be lost.'));
        body.appendChild(kittySwitch(kitty, (v) => { kitty = v; draw(); }));
        body.appendChild(houseButton(rules, (r) => { rules = r; draw(); }));
      };
      draw();
      popup('New Game?', body, [['Cancel', ''], ['New Game', 'primary', () => { if (!online) { Object.assign(settings, { kitty, rules }); saveSettings(); } host.send({ type: 'newGame', kitty, rules }); }]]);
    }],
    ['Leave', '', () => {
      if (online && state.game.phase !== 'gameOver') confirmThen('Leave the Table?', 'The game waits for you (or the host lets a bot play). Come back with Back to Table on the start screen.', 'Leave', leaveTable);
      else leaveTable();
    }],
    ['Close', 'primary'],
  );
  popup(online ? `Table ${host.code}` : 'Menu', null, items);
}

function showSettings(after) {
  const form = el('div', 'settings');
  form.innerHTML = `
    <label class="name-setting">Your name <input class="text" id="name" maxlength="16" autocomplete="nickname"></label>
    <label>Card back <select id="back">${['red', 'green', 'blue', 'black'].map((c) => `<option value="${c}" ${settings.back === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label>
    <label>Highest card on the left <input type="checkbox" id="high" ${settings.highFirst ? 'checked' : ''}></label>
    <label>Large card letters <input type="checkbox" id="large" ${settings.largePrint ? 'checked' : ''}></label>
    <label>Sounds <input type="checkbox" id="sounds" ${settings.sounds ? 'checked' : ''}></label>
    <label>Suggest button (hints) <input type="checkbox" id="hints" ${settings.hints ? 'checked' : ''}></label>`;
  form.querySelector('#name').value = settings.name;
  // Seated at a table, the name is already taken; change it from the start screen.
  if (state) form.querySelector('.name-setting').remove();
  const done = () => {
    const name = form.querySelector('#name')?.value.trim().slice(0, 16);
    if (name) settings.name = name;
    settings.back = form.querySelector('#back').value;
    settings.highFirst = form.querySelector('#high').checked;
    settings.largePrint = form.querySelector('#large').checked;
    settings.sounds = form.querySelector('#sounds').checked;
    settings.hints = form.querySelector('#hints').checked;
    if (!settings.hints) { ui.hint = null; ui.hintCard = null; }
    saveSettings();
    after?.();
  };
  popup('Settings', form, [['Done', 'primary', done]], done);     // Closing any way keeps the changes.
}

function showStats() {
  const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  const rows = [
    ['Games', (l) => l.played], ['Won', (l) => l.won], ['Lost', (l) => l.lost], ['Win rate', (l) => pct(l.won, l.played)],
    ['Hands', (l) => l.hands],
    ['My bids made', (l) => `${l.myBidsMade}/${l.myBids} (${pct(l.myBidsMade, l.myBids)})`],
    ['Thrown in', (l) => l.thrownIn], ['Best hand', (l) => l.bestHand], ['Best meld', (l) => l.bestMeld],
  ];
  const t = el('table', 'stats');
  t.appendChild(el('tr', '', '<th></th><th>vs the Computer</th><th>with Friends</th>'));
  for (const [name, f] of rows) t.appendChild(el('tr', '', `<td>${name}</td><td>${f(stats.computer)}</td><td>${f(stats.online)}</td>`));
  const body = el('div');
  body.appendChild(t);
  body.appendChild(el('div', 'note', 'Kept on this device.'));
  popup('Statistics', body, [
    ['Reset', '', () => confirmThen('Reset Statistics?', 'Every game and hand recorded on this device is forgotten.', 'Reset', () => {
      stats.computer = blankLine(); stats.online = blankLine(); saveStats();
    })],
    ['Done', 'primary'],
  ]);
}

function showRules() {
  const body = el('div', 'rules', `
    <p><b>Three players, each for themselves.</b> 48 cards: two each of A 10 K Q J 9 in every suit. The 10 ranks just below the ace. <b>With a kitty</b>, 15 cards each and 3 face down; <b>no kitty</b>, 16 each.</p>
    <p><b>Bidding</b> starts left of the dealer: 15 or more, raising by 1. Once you pass you're out. When two have passed, the third has the bid. If all three pass, the next dealer deals.</p>
    <p><b>The kitty</b> is turned up for everyone. The bid winner takes it, buries any 3 (their counters count for the bidder; they can't be melded) and names trump. With no kitty, the bid winner just names trump.</p>
    <p><b>Meld</b> — everyone shows theirs. Run (A 10 K Q J of trump) 15 · royal marriage (K Q of trump) 4 · marriage 2 · dix (9 of trump) 1 · pinochle (Q♠ J♦) 4 · aces around 10 · kings 8 · queens 6 · jacks 4. Doubles: run 150, pinochle 30, aces 100, kings 80, queens 60, jacks 40. A card can count once in each kind of meld (a king in a marriage and in kings around).</p>
    <p><b>House rules</b> (all on unless you turn them off): <b>double marriage 30</b> — both K Q of a suit score 30, trump or not, even beside a run (a double run is just 150); <b>roundhouse 24</b> — K and Q of every suit count their full 24 beside a run; <b>buried cards to the last trick</b> — whoever takes the last trick gets the buried cards' points (otherwise the bidder does).</p>
    <p><b>Throwing in.</b> After the meld the bidder may throw the hand in: they lose the bid, and the others score their meld.</p>
    <p><b>Play.</b> The bidder leads. Follow suit, and beat the winning card if you can. Out of the suit, you must trump — over a trump already played if you can. Of two identical cards, the first played wins. A, 10 and K are worth 1 each, and the last trick 1: 25 in all.</p>
    <p><b>Scoring.</b> The bidder needs meld + counters to reach the bid: then they score them all, or else they lose the bid. The others score their meld + counters — but only if they took a counter. First to 150 wins; if two get there on the same hand, the bidder wins if they're one of them.</p>`);
  popup('How to Play', body, [['Got It', 'primary']]);
}

// MARK: Start

let resizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });

if (params.get('name')) { settings.name = params.get('name').slice(0, 16); saveSettings(); }
if (params.has('fast')) Object.assign(PACE, { bot: 20, trickPause: 30, trickSweep: 20, widowCard: 10, widowHold: 20, meldHold: 40, resultHold: 30, autoNext: 60 });
const tableCode = params.get('t') || params.get('newtable');
if (tableCode && onlineAvailable()) {
  const go = () => (params.get('newtable') ? withTable(OnlineTable.create(myName(), onTableUpdate, tableCode, !params.has('nokitty'), params.has('nohouse') ? rulesOff() : {})) : joinTable(tableCode));
  // Someone opening a shared link for the first time: their name before their seat.
  if (settings.name) go(); else askName(go);
} else if (params.has('play') || params.has('autoplay')) playComputer();
else showLobby();
