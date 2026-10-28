/*
 * Le moteur du Président, cas par cas : la donne, les poses, les plis, le
 * « X ou rien », les sorties, les échanges, les départs, les scores. Les mains
 * sont forcées dès que le test vise une situation précise : rien ne dépend du
 * mélange, sauf les tests de donne, qui tournent sur un aléa à graine.
 */
import {
  DEFAULT_MANCHES,
  MANCHE_CHOICES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OPENING_CARD_ID,
  activeSeats,
  applyAction,
  canPass,
  canPlayCards,
  createInitialState,
  legalPlays,
  pointsFor,
  requiredCount,
  roleOf,
  rolesFor,
  standings,
  topPlay,
} from './rules.ts';
import { RANK_LABEL, RANK_NAME, ROLE_LABEL, SUIT_COLOR, cardId, cardLabel, createDeck, describePlay, shuffle, sortHand } from './deck.ts';
import type { PresidentAction, PresidentCard, PresidentRole, PresidentState, PresidentSuit } from './types.ts';

let failures = 0;
let total = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  total++;
  if (!cond) {
    failures++;
    console.log('  FAIL ' + label, extra === undefined ? '' : JSON.stringify(extra));
  } else {
    console.log('  ok   ' + label);
  }
}

/** Un aléa à graine (mulberry32) : même graine, même donne. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(state: PresidentState, action: PresidentAction, random: () => number = seeded(1)): PresidentState {
  const r = applyAction(state, action, random);
  if (r.error) console.log('    (error: ' + r.error + ')');
  return r.state;
}

function errorOf(state: PresidentState, action: PresidentAction): string | undefined {
  const r = applyAction(state, action, seeded(1));
  if (r.error && r.state !== state) console.log('    (an error changed the state!)');
  return r.error;
}

const id = (state: PresidentState, seat: number) => state.players[seat].id;

function setup(players: number, opts: { xOuRien?: boolean; manches?: number; seed?: number } = {}): PresidentState {
  let s = createInitialState('TEST', 'p0', players);
  s = run(s, {
    type: 'SET_OPTIONS',
    maxPlayers: players,
    xOuRien: opts.xOuRien ?? true,
    manches: opts.manches ?? DEFAULT_MANCHES,
  });
  for (let i = 0; i < players; i++) s = run(s, { type: 'JOIN', playerId: 'p' + i, name: 'J' + i });
  return run(s, { type: 'START' }, seeded(opts.seed ?? 7));
}

const LETTER: Record<string, PresidentSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
/** `c(7)` : un 7 de trèfle ; `c(12, 'h')` : la Dame de cœur. */
const c = (rank: number, suit: keyof typeof LETTER = 'c'): PresidentCard => ({ id: cardId(rank, LETTER[suit]), rank, suit: LETTER[suit] });

/** Force les mains et repart d'un pli vide, au siège `turn`. */
function table(state: PresidentState, hands: PresidentCard[][], turn = 0): PresidentState {
  return {
    ...state,
    phase: 'playing',
    turn,
    trick: [],
    lastTrick: [],
    lastPlayer: -1,
    forcedRank: null,
    finishOrder: [],
    exchanges: [],
    players: state.players.map((p, i) => ({
      ...p,
      hand: sortHand(hands[i] ?? []),
      handCount: (hands[i] ?? []).length,
      finishedAt: null,
      passed: false,
    })),
  };
}

const play = (s: PresidentState, seat: number, cards: PresidentCard[]) =>
  run(s, { type: 'PLAY', playerId: id(s, seat), cardIds: cards.map((x) => x.id) });
const pass = (s: PresidentState, seat: number) => run(s, { type: 'PASS', playerId: id(s, seat) });
const leave = (s: PresidentState, seat: number) => run(s, { type: 'LEAVE', playerId: id(s, seat) });

/** Les mains n'ont jamais de carte en double, et `handCount` les suit. */
function handsConsistent(s: PresidentState): boolean {
  const ids = s.players.flatMap((p) => p.hand.map((x) => x.id));
  return new Set(ids).size === ids.length && s.players.every((p) => p.handCount === p.hand.length);
}

// --- Le jeu de cartes --------------------------------------------------------------

console.log('\n== le jeu de 52 cartes ==');
{
  const deck = createDeck();
  check('52 cartes', deck.length === 52, deck.length);
  check('ids uniques', new Set(deck.map((x) => x.id)).size === 52);
  check('13 valeurs de 3 à 15 par couleur', deck.filter((x) => x.suit === 'hearts').map((x) => x.rank).join() === '3,4,5,6,7,8,9,10,11,12,13,14,15');
  check('ids stables : p12h est la Dame de cœur', deck.some((x) => x.id === 'p12h' && x.rank === 12 && x.suit === 'hearts'));
  check('la carte d’ouverture est la Dame de cœur', OPENING_CARD_ID === 'p12h' && cardLabel(c(12, 'h')) === 'Dame de cœur');
  check('libellés : V D R A 2', [11, 12, 13, 14, 15].map((r) => RANK_LABEL[r]).join('') === 'VDRA2');
  check('cœur et carreau en rouge, trèfle et pique en noir', SUIT_COLOR.hearts === 'red' && SUIT_COLOR.diamonds === 'red' && SUIT_COLOR.clubs === 'black' && SUIT_COLOR.spades === 'black');
  check('le 2 se nomme « 2 », l’As « As »', RANK_NAME[15] === '2' && RANK_NAME[14] === 'As');
  check('rôles en toutes lettres', ROLE_LABEL.trou === 'Trou du cul' && ROLE_LABEL['vice-president'] === 'Vice-président');
  const sorted = sortHand([c(15), c(3, 's'), c(12, 'h'), c(3, 'c')]);
  check('tri par valeur puis couleur', sorted.map((x) => x.id).join() === 'p3c,p3s,p12h,p15c', sorted.map((x) => x.id));
  const same = shuffle(createDeck(), seeded(3)).map((x) => x.id).join();
  check('le mélange à graine est rejouable', same === shuffle(createDeck(), seeded(3)).map((x) => x.id).join());
  check('le mélange garde les 52 cartes', new Set(shuffle(createDeck(), seeded(4)).map((x) => x.id)).size === 52);
}

console.log('\n== les poses dites comme à table ==');
{
  const cases: [number, number, string][] = [
    [7, 1, 'un 7'],
    [12, 1, 'une Dame'],
    [11, 1, 'un Valet'],
    [14, 1, 'un As'],
    [15, 1, 'un 2'],
    [7, 2, 'une paire de 7'],
    [12, 2, 'une paire de Dames'],
    [14, 2, "une paire d'As"],
    [13, 3, 'un brelan de Rois'],
    [10, 3, 'un brelan de 10'],
    [14, 4, "un carré d'As"],
    [15, 2, 'deux 2'],
    [15, 3, 'trois 2'],
    [15, 4, 'un carré de 2'],
  ];
  for (const [rank, count, text] of cases) check(`« ${text} »`, describePlay(rank, count) === text, describePlay(rank, count));
}

// --- Le salon ----------------------------------------------------------------------

console.log('\n== réglages et lancement ==');
{
  check('3 à 7 joueurs', MIN_PLAYERS === 3 && MAX_PLAYERS === 7);
  check('3, 5 ou 7 manches, 3 par défaut', MANCHE_CHOICES.join() === '3,5,7' && DEFAULT_MANCHES === 3);
  const fresh = createInitialState('ROOM', 'h');
  check('4 places par défaut, X ou rien activé', fresh.maxPlayers === 4 && fresh.options.xOuRien && fresh.options.manches === 3);
  check('au salon, manche 0', fresh.phase === 'lobby' && fresh.manche === 0);
  check('2 joueurs refusés', Boolean(errorOf(fresh, { type: 'SET_OPTIONS', maxPlayers: 2, xOuRien: true, manches: 3 })));
  check('8 joueurs refusés', Boolean(errorOf(fresh, { type: 'SET_OPTIONS', maxPlayers: 8, xOuRien: true, manches: 3 })));
  check('4 manches refusées', Boolean(errorOf(fresh, { type: 'SET_OPTIONS', maxPlayers: 4, xOuRien: true, manches: 4 })));
  const set = run(fresh, { type: 'SET_OPTIONS', maxPlayers: 5, xOuRien: false, manches: 7 });
  check('options enregistrées', set.maxPlayers === 5 && !set.options.xOuRien && set.options.manches === 7);

  let s = createInitialState('ROOM', 'p0', 3);
  for (let i = 0; i < 2; i++) s = run(s, { type: 'JOIN', playerId: 'p' + i, name: 'J' + i });
  check('START refusé à 2 joueurs', Boolean(errorOf(s, { type: 'START' })));
  s = run(s, { type: 'JOIN', playerId: 'p0', name: 'Doublon' });
  check('pas de doublon au JOIN', s.players.length === 2);
  s = run(s, { type: 'SET_OPTIONS', maxPlayers: 4, xOuRien: true, manches: 3 });
  s = run(s, { type: 'JOIN', playerId: 'p2', name: 'J2' });
  check('START refusé à 3 sur 4 places', errorOf(s, { type: 'START' }) === 'Cette partie attend 4 joueurs.', errorOf(s, { type: 'START' }));
  check('trop de joueurs pour réduire', Boolean(errorOf(run(s, { type: 'JOIN', playerId: 'p3', name: 'J3' }), { type: 'SET_OPTIONS', maxPlayers: 3, xOuRien: true, manches: 3 })));
  s = run(s, { type: 'LEAVE', playerId: 'p1' });
  check('au salon, un départ libère la place', s.players.length === 2 && !s.players.some((p) => p.id === 'p1'));
  s = run(s, { type: 'JOIN', playerId: 'p4', name: '  ' });
  check('nom vide remplacé', s.players[2].name === 'Joueur');
  s = run(s, { type: 'JOIN', playerId: 'p5', name: 'J5' });
  s = run(s, { type: 'JOIN', playerId: 'p6', name: 'J6' });
  check('pas de JOIN au-delà des places', s.players.length === 4);
  const started = run(s, { type: 'START' });
  check('START lance la manche 1', started.manche === 1 && started.phase === 'playing', started.phase);
  check('SET_OPTIONS hors salon refusé', errorOf(started, { type: 'SET_OPTIONS', maxPlayers: 4, xOuRien: true, manches: 3 }) === 'La partie a déjà commencé.');
  check('START deux fois refusé', Boolean(errorOf(started, { type: 'START' })));
  check('pas de JOIN en partie', run(started, { type: 'JOIN', playerId: 'late', name: 'Tard' }).players.length === 4);
}

console.log('\n== la donne, de 3 à 7 joueurs ==');
for (let n = 3; n <= 7; n++) {
  const s = setup(n, { seed: 100 + n });
  const sizes = s.players.map((p) => p.hand.length);
  const base = Math.floor(52 / n);
  const extra = 52 % n;
  const expected = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  check(`${n} joueurs : ${expected.join('/')} cartes`, sizes.join() === expected.join(), sizes);
  check(`${n} joueurs : les 52 cartes, sans doublon`, new Set(s.players.flatMap((p) => p.hand.map((x) => x.id))).size === 52);
  check(`${n} joueurs : mains triées et comptées`, handsConsistent(s) && s.players.every((p) => p.hand.map((x) => x.id).join() === sortHand(p.hand).map((x) => x.id).join()));
  const queen = s.players.findIndex((p) => p.hand.some((x) => x.id === OPENING_CARD_ID));
  check(`${n} joueurs : la Dame de cœur ouvre`, s.turn === queen, { turn: s.turn, queen });
  check(`${n} joueurs : pas d’échange en première manche`, s.exchanges.length === 0 && s.phase === 'playing');
  check(`${n} joueurs : événement de donne`, s.lastEvent.kind === 'deal' && s.lastEvent.by === queen && s.lastEvent.seq > 0);
}
{
  const a = setup(4, { seed: 42 });
  const b = setup(4, { seed: 42 });
  check('même graine, même donne', JSON.stringify(a.players.map((p) => p.hand)) === JSON.stringify(b.players.map((p) => p.hand)));
  check('aucun rôle en première manche', a.players.every((p) => p.role === null && p.score === 0));
}

// --- Les poses ---------------------------------------------------------------------

console.log('\n== ouvrir un pli ==');
{
  let s = table(setup(3), [[c(5), c(5, 'd'), c(9)], [c(6), c(8)], [c(7), c(10)]]);
  check('on ne passe pas en ouvrant', errorOf(s, { type: 'PASS', playerId: id(s, 0) }) === 'Tu ouvres le pli : pose au moins une carte.');
  check('canPass faux à l’ouverture', !canPass(s, 0));
  check('requiredCount nul à l’ouverture', requiredCount(s) === null && topPlay(s) === null);
  const opens = legalPlays(s, 0).map((p) => p.map((x) => x.id).join('+'));
  check('ouvertures : un 5, la paire de 5, un 9', opens.join(' ') === 'p5c p5c+p5d p9c', opens);
  check('pas de pose hors de son tour', legalPlays(s, 1).length === 0);
  check('rien de vide', errorOf(s, { type: 'PLAY', playerId: id(s, 0), cardIds: [] }) === 'Choisis au moins une carte.');
  check('valeurs mélangées refusées', errorOf(s, { type: 'PLAY', playerId: id(s, 0), cardIds: ['p5c', 'p9c'] }) === 'Les cartes posées doivent être de même valeur.');
  check('carte absente refusée', errorOf(s, { type: 'PLAY', playerId: id(s, 0), cardIds: ['p14s'] }) === 'Ces cartes ne sont pas dans ta main.');
  check('la même carte deux fois refusée', errorOf(s, { type: 'PLAY', playerId: id(s, 0), cardIds: ['p5c', 'p5c'] }) === 'Ces cartes ne sont pas dans ta main.');
  check('pas son tour', errorOf(s, { type: 'PLAY', playerId: id(s, 1), cardIds: ['p6c'] }) === "Ce n'est pas ton tour.");
  check('joueur inconnu', errorOf(s, { type: 'PLAY', playerId: 'nobody', cardIds: ['p6c'] }) === 'Joueur inconnu.');
  check('canPlayCards hors tour', canPlayCards(s, 1, [c(6)]) === "Ce n'est pas ton tour.");
  const seq = s.lastEvent.seq;
  s = play(s, 0, [c(5), c(5, 'd')]);
  check('la paire est posée', topPlay(s)?.rank === 5 && requiredCount(s) === 2 && s.lastPlayer === 0);
  check('elle quitte la main', s.players[0].hand.length === 1 && s.players[0].handCount === 1);
  check('le tour passe', s.turn === 1);
  check('événement de pose', s.lastEvent.kind === 'play' && s.lastEvent.seq === seq + 1 && s.lastEvent.rank === 5 && s.lastEvent.count === 2);
  check('journal en français', s.log[s.log.length - 1] === 'J0 pose une paire de 5.', s.log[s.log.length - 1]);
}

console.log('\n== suivre : même nombre, valeur égale ou supérieure ==');
{
  let s = table(setup(4, { xOuRien: false }), [[c(7), c(3)], [c(5), c(8), c(8, 'd')], [c(7, 'd'), c(4)], [c(9), c(4, 'd')]]);
  s = play(s, 0, [c(7)]);
  check('trop faible refusé', errorOf(s, { type: 'PLAY', playerId: id(s, 1), cardIds: ['p5c'] }) === 'Trop faible : il faut au moins un 7.');
  check('mauvais nombre refusé', errorOf(s, { type: 'PLAY', playerId: id(s, 1), cardIds: ['p8c', 'p8d'] }) === 'Il faut poser 1 carte, comme la pose précédente.');
  check('poses légales : un 8 seulement', legalPlays(s, 1).map((p) => p.map((x) => x.id).join('+')).join(' ') === 'p8c');
  check('canPass vrai en suivant', canPass(s, 1));
  s = play(s, 1, [c(8)]);
  check('8 sur 7 accepté', topPlay(s)?.rank === 8 && s.turn === 2);
  s = pass(s, 2);
  s = play(s, 3, [c(9)]);
  check('X ou rien désactivé : jamais de contrainte', s.forcedRank === null);
}
{
  let s = table(setup(3, { xOuRien: false }), [[c(9), c(3)], [c(9, 'd'), c(4)], [c(9, 'h'), c(5)]]);
  s = play(s, 0, [c(9)]);
  s = play(s, 1, [c(9, 'd')]);
  check('valeur égale acceptée', topPlay(s)?.rank === 9 && s.forcedRank === null);
}

console.log('\n== passer, puis rejouer dans le même pli ==');
{
  let s = table(setup(3), [[c(5), c(10), c(3)], [c(9), c(12), c(4)], [c(7), c(11), c(6)]]);
  s = play(s, 0, [c(5)]);
  s = pass(s, 1);
  check('la passe est notée', s.players[1].passed && s.lastEvent.kind === 'pass' && s.lastEvent.by === 1);
  check('le tour avance', s.turn === 2);
  s = play(s, 2, [c(7)]);
  check('une pose efface les passes', s.players.every((p) => !p.passed));
  s = play(s, 0, [c(10)]);
  check('le passeur peut rejouer', canPlayCards(s, 1, [c(12)]) === null);
  s = play(s, 1, [c(12)]);
  check('il rejoue dans le même pli', topPlay(s)?.by === 1 && s.trick.length === 4);
}

console.log('\n== pli fermé quand tout le monde passe ==');
{
  let s = table(setup(3), [[c(5), c(10)], [c(4), c(3)], [c(3, 'd'), c(4, 'd')]]);
  s = play(s, 0, [c(5)]);
  s = pass(s, 1);
  s = pass(s, 2);
  check('le pli est fermé', s.trick.length === 0 && s.lastTrick.length === 1 && s.lastTrick[0].rank === 5);
  check('le dernier à avoir posé rouvre', s.turn === 0);
  check('événement trick (passes) au gagnant', s.lastEvent.kind === 'trick' && s.lastEvent.reason === 'passes' && s.lastEvent.by === 0);
  check('les passes sont remises à zéro', s.players.every((p) => !p.passed) && s.lastPlayer === -1);
  check('il doit ouvrir', !canPass(s, 0));
}

console.log('\n== un 2 ferme le pli ==');
{
  let s = table(setup(3), [[c(5), c(6)], [c(15), c(3)], [c(7), c(8)]]);
  s = play(s, 0, [c(5)]);
  s = play(s, 1, [c(15)]);
  check('le pli se ferme d’un coup', s.trick.length === 0 && s.lastTrick.length === 2);
  check('le poseur du 2 rouvre', s.turn === 1);
  check('événement trick (two)', s.lastEvent.kind === 'trick' && s.lastEvent.reason === 'two' && s.lastEvent.by === 1 && s.lastEvent.rank === 15);
  check('statistique : un pli fermé au 2', s.players[1].stats.twos === 1);
}
{
  let s = table(setup(3), [[c(15), c(15, 'd'), c(6)], [c(3), c(4)], [c(7), c(8)]]);
  s = play(s, 0, [c(15), c(15, 'd')]);
  check('ouvrir avec deux 2 ferme aussi le pli', s.trick.length === 0 && s.turn === 0 && s.players[0].stats.twos === 1);
  check('journal : « deux 2 »', s.log.some((l) => l === 'J0 pose deux 2.'));
}

console.log('\n== un carré ferme le pli ==');
{
  let s = table(setup(3), [[c(6), c(6, 'd'), c(6, 'h'), c(6, 's'), c(9)], [c(3), c(4)], [c(7), c(8)]]);
  s = play(s, 0, [c(6), c(6, 'd'), c(6, 'h'), c(6, 's')]);
  check('le carré ferme le pli', s.trick.length === 0 && s.turn === 0);
  check('événement trick (quad)', s.lastEvent.kind === 'trick' && s.lastEvent.reason === 'quad');
  check('statistique : un carré', s.players[0].stats.quads === 1 && s.players[0].stats.twos === 0);
}
{
  let s = table(setup(3), [[c(15), c(15, 'd'), c(15, 'h'), c(15, 's'), c(9)], [c(3), c(4)], [c(7), c(8)]]);
  s = play(s, 0, [c(15), c(15, 'd'), c(15, 'h'), c(15, 's')]);
  check('un carré de 2 compte comme carré et comme 2', s.players[0].stats.quads === 1 && s.players[0].stats.twos === 1 && s.lastEvent.reason === 'quad');
}

console.log('\n== X ou rien ==');
{
  let s = table(setup(4), [[c(7), c(9), c(10)], [c(7, 'd'), c(11)], [c(9, 'd'), c(7, 'h'), c(4)], [c(8), c(12)]]);
  s = play(s, 0, [c(7)]);
  check('pas de contrainte après une première pose', s.forcedRank === null);
  s = play(s, 1, [c(7, 'd')]);
  check('reposer la même valeur l’impose', s.forcedRank === 7);
  check('annoncé au journal', s.log[s.log.length - 1] === '7 ou rien pour J2 !', s.log[s.log.length - 1]);
  check('« 7 ou rien ! » refuse un 9', errorOf(s, { type: 'PLAY', playerId: id(s, 2), cardIds: ['p9d'] }) === '7 ou rien !');
  check('legalPlays ne propose que le 7', legalPlays(s, 2).map((p) => p[0].id).join() === 'p7h');
  check('trop faible reste trop faible', canPlayCards(s, 2, [c(4)])?.startsWith('Trop faible') === true);
  const reposted = play(s, 2, [c(7, 'h')]);
  check('la contrainte se reporte si on repose la valeur', reposted.forcedRank === 7 && reposted.turn === 3);
  check('elle tombe dès que le suivant a joué', pass(reposted, 3).forcedRank === null);
  s = pass(s, 2);
  check('passer la fait tomber', s.forcedRank === null && s.turn === 3);
  check('le suivant pose librement au-dessus', canPlayCards(s, 3, [c(8)]) === null);
}
{
  // 7, 7 : le joueur contraint pose un 7 ; ensuite il n'y a plus de 7 à poser.
  let s = table(setup(3), [[c(7), c(3)], [c(7, 'd'), c(4)], [c(7, 'h'), c(15)]]);
  s = play(s, 0, [c(7)]);
  s = play(s, 1, [c(7, 'd')]);
  check('le 2 ne passe pas sous « 7 ou rien »', canPlayCards(s, 2, [c(15)]) === '7 ou rien !');
  s = play(s, 2, [c(7, 'h')]);
  check('trois 7 de suite : toujours 7 ou rien', s.forcedRank === 7 && s.turn === 0);
  check('sans 7, il ne reste qu’à passer', legalPlays(s, 0).length === 0 && canPass(s, 0));
}
{
  let s = table(setup(3), [[c(7), c(3)], [c(7, 'd'), c(4)], [c(9), c(5)]]);
  s = play(s, 0, [c(7)]);
  s = play(s, 1, [c(7, 'd')]);
  s = pass(s, 2);
  s = pass(s, 0);
  check('la fermeture du pli efface aussi la contrainte', s.trick.length === 0 && s.forcedRank === null && s.turn === 1);
}

// --- Les sorties -------------------------------------------------------------------

console.log('\n== sortir ==');
{
  let s = table(setup(4), [[c(9)], [c(3), c(4)], [c(5), c(6)], [c(7), c(8)]]);
  s = play(s, 0, [c(9)]);
  check('sorti en 1re place', s.players[0].finishedAt === 0 && s.finishOrder.join() === '0');
  check('événement out', s.lastEvent.kind === 'out' && s.lastEvent.place === 0 && s.lastEvent.by === 0);
  check('il ne compte plus parmi les joueurs en jeu', activeSeats(s).join() === '1,2,3');
  check('journal : sa place et son rôle', s.log[s.log.length - 1].includes('1re place (Président)'), s.log[s.log.length - 1]);
  s = pass(s, 1);
  s = pass(s, 2);
  check('pas encore fermé', s.trick.length === 1 && s.turn === 3);
  s = pass(s, 3);
  check('fermé par les passes alors que le poseur est sorti', s.trick.length === 0);
  check('la main va au suivant encore en jeu', s.turn === 1, s.turn);
}
{
  let s = table(setup(4), [[c(6), c(3)], [c(15)], [c(5), c(6, 'd')], [c(7), c(8)]]);
  s = play(s, 0, [c(6)]);
  s = play(s, 1, [c(15)]);
  check('sortir sur un 2 : sorti', s.players[1].finishedAt === 0);
  check('le pli est fermé', s.trick.length === 0 && s.lastTrick.length === 2);
  check('la main va au suivant en jeu', s.turn === 2, s.turn);
  check('événement out, avec la raison du pli', s.lastEvent.kind === 'out' && s.lastEvent.reason === 'two');
  check('le 2 compte quand même', s.players[1].stats.twos === 1);
}
{
  let s = table(setup(4), [[c(3), c(4)], [c(5), c(6)], [c(9), c(9, 'd'), c(9, 'h'), c(9, 's')], [c(7), c(8)]], 2);
  s = play(s, 2, [c(9), c(9, 'd'), c(9, 'h'), c(9, 's')]);
  check('sortir sur un carré : la main va au suivant', s.players[2].finishedAt === 0 && s.turn === 3 && s.trick.length === 0);
}
{
  // Le dernier siège sort : la main repart du début de la table.
  let s = table(setup(3), [[c(3), c(4)], [c(5), c(6)], [c(15)]], 2);
  s = play(s, 2, [c(15)]);
  check('la main fait le tour de la table', s.turn === 0, s.turn);
}

console.log('\n== fin de manche ==');
{
  let s = table(setup(3), [[c(9)], [c(10)], [c(3), c(4)]]);
  const before = s.lastEvent.seq;
  s = play(s, 0, [c(9)]);
  s = play(s, 1, [c(10)]);
  check('il ne reste qu’un joueur : la manche finit', s.phase === 'manche-end', s.phase);
  check('ordre de sortie complet', s.finishOrder.join() === '0,1,2', s.finishOrder);
  check('le dernier est classé', s.players[2].finishedAt === 2);
  check('rôles à 3 : Président, Neutre, Trou du cul', s.players.map((p) => p.role).join() === 'president,neutre,trou');
  check('points : 2, 1, 0', s.players.map((p) => p.score).join() === '2,1,0');
  check('historique', s.history.length === 1 && s.history[0].manche === 1 && s.history[0].points.join() === '2,1,0' && s.history[0].roles[2] === 'trou');
  check('événement manche-end', s.lastEvent.kind === 'manche-end' && s.lastEvent.seq === before + 2);
  check('le dernier pli reste visible', s.trick.length === 0 && s.lastTrick.length > 0);
  check('la dernière main reste en main', s.players[2].hand.length === 2 && s.players[2].handCount === 2);
  check('PLAY refusé entre deux manches', errorOf(s, { type: 'PLAY', playerId: id(s, 2), cardIds: ['p3c'] }) === "La partie n'est pas en cours.");
  check('stats Président', s.players[0].stats.presidentRun === 1 && s.players[0].stats.bestPresidentRun === 1);
  check('journal de fin de manche', s.log.some((l) => l === 'Manche 1 terminée : J0 est Président, J2 est Trou du cul.'));
}
{
  // Le 2 qui fait sortir l'avant-dernier finit la manche : l'événement le plus important l'emporte.
  let s = table(setup(3), [[c(9)], [c(15)], [c(3), c(4)]]);
  s = play(s, 0, [c(9)]);
  s = play(s, 1, [c(15)]);
  check('événement final : manche-end', s.lastEvent.kind === 'manche-end' && s.lastEvent.reason === 'two');
  check('le journal raconte tout', ['J1 pose un 2.', "J1 n'a plus de cartes : sorti en 2e place (Neutre) !"].every((l) => s.log.includes(l)));
  check('le 2 est compté', s.players[1].stats.twos === 1);
}

console.log('\n== rôles et points ==');
{
  const expected: Record<number, PresidentRole[]> = {
    3: ['president', 'neutre', 'trou'],
    4: ['president', 'vice-president', 'vice-trou', 'trou'],
    5: ['president', 'vice-president', 'neutre', 'vice-trou', 'trou'],
    6: ['president', 'vice-president', 'neutre', 'neutre', 'vice-trou', 'trou'],
    7: ['president', 'vice-president', 'neutre', 'neutre', 'neutre', 'vice-trou', 'trou'],
  };
  for (let n = 3; n <= 7; n++) check(`rôles à ${n}`, rolesFor(n).join() === expected[n].join(), rolesFor(n));
  check('roleOf cohérent', roleOf(0, 5) === 'president' && roleOf(4, 5) === 'trou' && roleOf(2, 5) === 'neutre');
  check('points : n - 1 - place', pointsFor(0, 5) === 4 && pointsFor(4, 5) === 0 && pointsFor(2, 7) === 4);
}

// --- Les échanges ------------------------------------------------------------------

/** Joue une manche sur des mains forcées : le siège i sort en place order.indexOf(i). */
function finishWithOrder(state: PresidentState, order: number[]): PresidentState {
  const n = state.players.length;
  const hands: PresidentCard[][] = state.players.map(() => []);
  // Chacun a une carte, plus forte pour qui doit sortir tôt ; le dernier en a deux.
  order.forEach((seat, place) => {
    hands[seat] = place === n - 1 ? [c(3), c(3, 'd')] : [c(14 - place, (['c', 'd', 'h', 's'] as const)[place % 4])];
  });
  let s = table(state, hands, order[0]);
  for (let place = 0; place < n - 1; place++) {
    const seat = order[place];
    // Les autres passent jusqu'à la fermeture du pli, puis on donne la main
    // au prochain qui doit sortir : personne d'autre ne pose jamais.
    for (let guard = 0; guard < 50 && (s.trick.length > 0 || s.turn !== seat); guard++) {
      s = s.trick.length > 0 ? pass(s, s.turn) : { ...s, turn: seat };
    }
    s = play(s, seat, s.players[seat].hand);
  }
  return s;
}

console.log('\n== échanges à 3 joueurs ==');
{
  let s = finishWithOrder(setup(3), [1, 0, 2]);
  check('manche 1 jouée dans l’ordre voulu', s.phase === 'manche-end' && s.finishOrder.join() === '1,0,2', s.finishOrder);
  check('NEXT_MANCHE refusé en jeu', errorOf(setup(3), { type: 'NEXT_MANCHE' }) === "La manche n'est pas terminée.");
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(11));
  check('manche 2', s.manche === 2 && s.lastEvent.kind === 'deal');
  check('un seul échange à 3 : Trou du cul → Président', s.exchanges.length === 2);
  const best = s.exchanges[0];
  check('don d’office, fait', best.kind === 'best' && best.from === 2 && best.to === 1 && best.count === 2 && best.done);
  const trouMax = Math.max(...s.players[2].hand.map((x) => x.rank));
  check('ce sont ses 2 meilleures cartes', best.cards.every((x) => x.rank >= trouMax), { given: best.cards, trouMax });
  check('le Président les a reçues', best.cards.every((x) => s.players[1].hand.some((h) => h.id === x.id)));
  check('les tailles suivent : 19 et 15', s.players[1].hand.length === 19 && s.players[2].hand.length === 15, s.players.map((p) => p.hand.length));
  const choice = s.exchanges[1];
  check('don au choix attendu', choice.kind === 'choice' && choice.from === 1 && choice.to === 2 && !choice.done && choice.cards.length === 0);
  check('phase d’échange', s.phase === 'exchange');
  check('le Trou du cul ouvrira', s.turn === 2);
  check('pas de pose pendant l’échange', errorOf(s, { type: 'PLAY', playerId: id(s, 2), cardIds: [s.players[2].hand[0].id] }) === 'Attends la fin des échanges.');
  check('canPlayCards pendant l’échange', canPlayCards(s, 2, [s.players[2].hand[0]]) === 'Attends la fin des échanges.');
  check('le Neutre n’a rien à donner', errorOf(s, { type: 'GIVE', playerId: id(s, 0), cardIds: [s.players[0].hand[0].id] }) === "Tu n'as rien à donner.");
  check('le Trou du cul non plus', errorOf(s, { type: 'GIVE', playerId: id(s, 2), cardIds: [s.players[2].hand[0].id] }) === "Tu n'as rien à donner.");
  check('mauvais nombre refusé', errorOf(s, { type: 'GIVE', playerId: id(s, 1), cardIds: [s.players[1].hand[0].id] }) === 'Donne exactement 2 cartes.');
  check('carte absente refusée', errorOf(s, { type: 'GIVE', playerId: id(s, 1), cardIds: [s.players[2].hand[0].id, s.players[1].hand[0].id] }) === 'Ces cartes ne sont pas dans ta main.');
  // Il peut rendre une carte qu'il vient de recevoir.
  const back = [best.cards[0], s.players[1].hand[0]];
  const seq = s.lastEvent.seq;
  s = run(s, { type: 'GIVE', playerId: id(s, 1), cardIds: back.map((x) => x.id) });
  check('rendre une carte reçue est permis', back.every((x) => s.players[2].hand.some((h) => h.id === x.id)));
  check('17 et 17 après l’échange', s.players[1].hand.length === 17 && s.players[2].hand.length === 17);
  check('mains retriées', s.players.every((p) => p.hand.map((x) => x.id).join() === sortHand(p.hand).map((x) => x.id).join()));
  check('événement exchange', s.lastEvent.kind === 'exchange' && s.lastEvent.by === 1 && s.lastEvent.seq === seq + 1);
  check('tous les dons faits : on joue', s.phase === 'playing' && s.turn === 2 && s.exchanges.every((e) => e.done));
  check('GIVE hors phase refusé', errorOf(s, { type: 'GIVE', playerId: id(s, 1), cardIds: back.map((x) => x.id) }) === "Ce n'est pas le moment d'échanger.");
  check('toujours 52 cartes', s.players.reduce((a, p) => a + p.hand.length, 0) === 52 && handsConsistent(s));
}

console.log('\n== échanges à 5 joueurs ==');
{
  let s = finishWithOrder(setup(5), [3, 0, 4, 1, 2]);
  check('ordre voulu', s.finishOrder.join() === '3,0,4,1,2', s.finishOrder);
  check('rôles', s.players.map((p) => p.role).join() === 'vice-president,vice-trou,trou,president,neutre');
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(12));
  check('deux échanges', s.exchanges.length === 4);
  const vice = s.exchanges.find((e) => e.kind === 'best' && e.count === 1)!;
  check('le Vice-trou donne sa meilleure carte au Vice-président', vice.from === 1 && vice.to === 0 && vice.done);
  check('c’est bien sa meilleure', vice.cards[0].rank >= Math.max(...s.players[1].hand.map((x) => x.rank)));
  const president = s.players[3].hand;
  const vp = s.players[0].hand;
  check('le Trou du cul ouvrira', s.turn === 2);
  s = run(s, { type: 'GIVE', playerId: id(s, 0), cardIds: [vp[0].id] });
  check('un don fait, l’autre attendu : toujours en échange', s.phase === 'exchange');
  check('déjà donné', errorOf(s, { type: 'GIVE', playerId: id(s, 0), cardIds: [s.players[0].hand[0].id] }) === 'Tu as déjà donné tes cartes.');
  s = run(s, { type: 'GIVE', playerId: id(s, 3), cardIds: [president[0].id, president[1].id] });
  check('les deux dons faits : on joue', s.phase === 'playing' && s.turn === 2);
  check('mains égalisées', s.players.map((p) => p.hand.length).join() === '11,11,10,10,10', s.players.map((p) => p.hand.length));
}

console.log('\n== ouverture de la manche suivante par le Trou du cul ==');
{
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(13));
  check('le Trou du cul (siège 3) a la main', s.turn === 3);
  check('même s’il n’a pas la Dame de cœur', s.log.some((l) => l === 'J3, Trou du cul, ouvre la manche.'));
}

// --- Les départs -------------------------------------------------------------------

console.log('\n== départ au milieu d’un pli ==');
{
  let s = table(setup(3), [[c(5), c(6)], [c(3), c(4)], [c(7), c(8)]]);
  s = play(s, 0, [c(5)]);
  const seq = s.lastEvent.seq;
  s = leave(s, 2);
  check('déconnecté, sauté', !s.players[2].connected && activeSeats(s).join() === '0,1');
  check('un départ seul ne déclenche pas d’événement', s.lastEvent.seq === seq);
  check('le tour ne bouge pas', s.turn === 1);
  s = pass(s, 1);
  check('le pli se ferme sans lui', s.trick.length === 0 && s.turn === 0);
}
{
  let s = table(setup(4), [[c(5), c(6)], [c(3), c(4)], [c(7), c(8)], [c(9), c(10)]]);
  s = play(s, 0, [c(5)]);
  const seq = s.lastEvent.seq;
  s = leave(s, 1);
  check('départ pendant son tour : la main passe', s.turn === 2 && s.lastEvent.seq === seq);
  s = pass(s, 2);
  s = pass(s, 3);
  check('puis le pli se ferme normalement', s.trick.length === 0 && s.turn === 0);
}
{
  let s = table(setup(3), [[c(5), c(6)], [c(9), c(4)], [c(7), c(8)]]);
  s = play(s, 0, [c(5)]);
  s = pass(s, 1);
  s = leave(s, 2);
  check('le dernier à agir part : tout le monde a passé, le pli se ferme', s.trick.length === 0 && s.turn === 0 && s.lastEvent.kind === 'trick');
}
{
  let s = table(setup(4), [[c(7), c(6)], [c(7, 'd'), c(4)], [c(9), c(8)], [c(10), c(11)]]);
  s = play(s, 0, [c(7)]);
  s = play(s, 1, [c(7, 'd')]);
  s = leave(s, 2);
  check('départ du joueur contraint : la contrainte tombe', s.forcedRank === null && s.turn === 3);
}
{
  let s = table(setup(4), [[c(5)], [c(3), c(4)], [c(7), c(8)], [c(9), c(10)]]);
  s = play(s, 0, [c(5)]);
  s = pass(s, 1);
  s = leave(s, 0);
  check('le poseur sorti puis parti : le pli continue', s.trick.length === 1 && s.turn === 2);
  s = pass(s, 2);
  s = pass(s, 3);
  check('fermé, la main va au suivant en jeu', s.trick.length === 0 && s.turn === 1);
}
{
  // 4 joueurs, deux sortis, deux en jeu : l'un part, l'autre est le dernier.
  let s = table(setup(4), [[c(13)], [c(14)], [c(3), c(4)], [c(5), c(6)]]);
  s = play(s, 0, [c(13)]);
  s = play(s, 1, [c(14)]);
  s = leave(s, 3);
  check('plus qu’un joueur en jeu : la manche finit', s.phase === 'manche-end', s.phase);
  check('le partant est classé après le dernier', s.finishOrder.join() === '0,1,2,3', s.finishOrder);
  check('il est Trou du cul', s.players[3].role === 'trou' && s.lastEvent.kind === 'manche-end');
}

console.log('\n== départ pendant l’échange ==');
{
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(14));
  const lowest = s.players[0].hand.slice(0, 2).map((x) => x.id);
  s = leave(s, 0);
  check('le Président parti : ses plus basses cartes sont rendues', lowest.every((x) => s.players[3].hand.some((h) => h.id === x)));
  check('journal : au pluriel, avec le receveur', s.log.at(-1) === "Ses plus basses cartes sont rendues d'office à J3.", s.log.at(-1));
  check('son don est marqué fait', s.exchanges.filter((e) => e.from === 0).every((e) => e.done));
  check('événement exchange', s.lastEvent.kind === 'exchange' && s.lastEvent.by === 0);
  check('l’autre don reste attendu', s.phase === 'exchange');
  s = run(s, { type: 'GIVE', playerId: id(s, 1), cardIds: [s.players[1].hand[0].id] });
  check('puis on joue', s.phase === 'playing' && s.turn === 3);
  check('toujours 52 cartes', s.players.reduce((a, p) => a + p.hand.length, 0) === 52 && handsConsistent(s));
}
{
  // Le Vice-président part : une seule carte, rendue d'office au Vice-trou.
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(14));
  s = leave(s, 1);
  check('journal : au singulier, avec le receveur', s.log.at(-1) === "Sa plus basse carte est rendue d'office à J2.", s.log.at(-1));
}
{
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(15));
  s = leave(s, 3);
  check('l’ouvreur parti pendant l’échange', s.phase === 'exchange');
  s = run(s, { type: 'GIVE', playerId: id(s, 0), cardIds: s.players[0].hand.slice(0, 2).map((x) => x.id) });
  s = run(s, { type: 'GIVE', playerId: id(s, 1), cardIds: [s.players[1].hand[0].id] });
  check('la main va au suivant en jeu', s.phase === 'playing' && s.turn === 0, s.turn);
}

console.log('\n== moins de 2 joueurs connectés ==');
{
  let s = table(setup(3), [[c(5), c(6)], [c(3), c(4)], [c(7), c(8)]]);
  s = { ...s, players: s.players.map((p, i) => ({ ...p, score: [3, 5, 1][i] })) };
  s = leave(s, 1);
  check('à 2 connectés, la partie continue', s.phase === 'playing');
  s = leave(s, 2);
  check('à 1, elle s’arrête', s.phase === 'over' && s.lastEvent.kind === 'over');
  check('gagnant au score, même parti', s.winner === 1, s.winner);
  check('pas de points pour la manche interrompue', s.players.map((p) => p.score).join() === '3,5,1' && s.history.length === 0);
  check('rien ne bouge après la fin', errorOf(s, { type: 'PASS', playerId: id(s, 0) }) === "La partie n'est pas en cours.");
  check('revanche impossible à un joueur', errorOf(s, { type: 'REMATCH' }) === 'Il faut au moins 3 joueurs connectés pour rejouer.');
  check('partir après la fin ne change rien d’important', leave(s, 0).phase === 'over');
}
{
  // Non-régression : un départ après la fin ne doit pas toucher la signature
  // d'issue (winner|seq|log.length), sinon la partie est enregistrée deux fois.
  let s = finishWithOrder(setup(3, { manches: 3 }), [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(18)), [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(19)), [0, 1, 2]);
  check('partie finie, tout le monde encore là', s.phase === 'over' && s.winner === 0 && s.players.every((p) => p.connected), s.phase);
  const signature = (t: PresidentState) => `${t.winner}|${t.lastEvent.seq}|${t.log.length}`;
  const before = signature(s);
  const t = leave(s, 2);
  check('départ après la fin : marqué déconnecté', !t.players[2].connected && t.phase === 'over');
  check('départ après la fin : le journal ne bouge pas', t.log.length === s.log.length);
  check('départ après la fin : la signature ne bouge pas', signature(t) === before, [before, signature(t)]);
  check('deux départs de suite non plus', signature(leave(t, 1)) === before);
}
{
  let s = finishWithOrder(setup(3), [0, 1, 2]);
  s = leave(s, 1);
  check('entre deux manches, à 2 : on attend', s.phase === 'manche-end');
  s = leave(s, 2);
  check('entre deux manches, à 1 : fin', s.phase === 'over' && s.winner === 0);
}
{
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(16));
  s = leave(s, 1);
  s = leave(s, 2);
  s = leave(s, 3);
  check('pendant l’échange, sous 2 connectés : fin', s.phase === 'over' && s.winner === 0);
}
{
  // Un joueur part entre deux manches : il ne reçoit pas de cartes à la suivante.
  let s = finishWithOrder(setup(4), [0, 1, 2, 3]);
  s = leave(s, 3);
  s = run(s, { type: 'NEXT_MANCHE' }, seeded(17));
  // 18/17/17 à la donne, puis le Vice-trou (siège 2) donne d'office une carte au Vice-président.
  check('distribution aux seuls connectés : 18/18/16/0', s.players.map((p) => p.hand.length).join() === '18,18,16,0', s.players.map((p) => p.hand.length));
  check('pas d’échange avec le Trou du cul parti', s.exchanges.length === 2 && s.exchanges.every((e) => e.from !== 3 && e.to !== 3));
  check('la manche s’ouvre au suivant connecté', s.turn === 0 && s.log.some((l) => l === 'J3 est parti : J0 ouvre la manche.'));
  s = run(s, { type: 'GIVE', playerId: id(s, 1), cardIds: [s.players[1].hand[0].id] });
  check('on joue sans lui', s.phase === 'playing' && !activeSeats(s).includes(3));
}

// --- Scores, départage, statistiques -----------------------------------------------

console.log('\n== fin de partie et départage ==');
{
  let s = setup(3, { manches: 3 });
  s = finishWithOrder(s, [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(20)), [2, 1, 0]);
  check('après 2 manches sur 3 : entre-deux', s.phase === 'manche-end' && s.manche === 2);
  check('scores à égalité 2/2/2', s.players.map((p) => p.score).join() === '2,2,2');
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(21)), [1, 0, 2]);
  check('après la dernière manche : fin', s.phase === 'over' && s.lastEvent.kind === 'over');
  check('scores 3/4/2', s.players.map((p) => p.score).join() === '3,4,2');
  check('le meilleur score gagne', s.winner === 1 && standings(s)[0] === 1);
  check('journal de victoire', s.log[s.log.length - 1] === 'J1 remporte la partie avec 4 points !', s.log[s.log.length - 1]);
}
{
  let s = setup(3, { manches: 3 });
  s = finishWithOrder(s, [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(22)), [1, 0, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(23)), [2, 1, 0]);
  check('scores 3/4/2', s.players.map((p) => p.score).join() === '3,4,2');
  // On force l'égalité en tête pour éprouver le départage.
  const tied: PresidentState = { ...s, players: s.players.map((p, i) => ({ ...p, score: [4, 4, 2][i] })) };
  check('à égalité, la meilleure place de la dernière manche gagne', standings(tied).join() === '1,0,2', standings(tied));
  const tiedAll: PresidentState = { ...s, players: s.players.map((p) => ({ ...p, score: 3 })) };
  check('égalité totale : l’ordre de la dernière manche', standings(tiedAll).join() === '2,1,0', standings(tiedAll));
}

console.log('\n== statistiques ==');
{
  let s = setup(3, { manches: 5 });
  s = finishWithOrder(s, [2, 1, 0]);
  check('Trou du cul en manche 1', s.players[0].role === 'trou');
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(30)), [0, 1, 2]);
  check('du trou au trône', s.players[0].stats.ragsToRiches === 1);
  check('série en cours : 1', s.players[0].stats.presidentRun === 1 && s.players[2].stats.presidentRun === 0);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(31)), [0, 2, 1]);
  check('réélu : série de 2', s.players[0].stats.presidentRun === 2 && s.players[0].stats.bestPresidentRun === 2);
  check('pas de « trou au trône » sans passer par le trou', s.players[0].stats.ragsToRiches === 1);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(32)), [1, 0, 2]);
  check('la série retombe, le record reste', s.players[0].stats.presidentRun === 0 && s.players[0].stats.bestPresidentRun === 2);
  check('le siège 2 ne profite pas d’un passage de Neutre à Président', s.players[2].stats.ragsToRiches === 0);
}

console.log('\n== revanche ==');
{
  let s = setup(3, { manches: 3 });
  check('REMATCH refusé en cours de partie', errorOf(s, { type: 'REMATCH' }) === "La partie n'est pas terminée.");
  s = finishWithOrder(s, [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(40)), [0, 1, 2]);
  s = finishWithOrder(run(s, { type: 'NEXT_MANCHE' }, seeded(41)), [0, 1, 2]);
  check('partie finie', s.phase === 'over' && s.winner === 0);
  const seq = s.lastEvent.seq;
  const logLength = s.log.length;
  const signature = `${s.winner}|${s.lastEvent.seq}|${s.log.length}`;
  s = run(s, { type: 'REMATCH' }, seeded(42));
  check('nouvelle partie, manche 1', s.manche === 1 && s.phase === 'playing' && s.winner === null);
  check('mêmes joueurs', s.players.map((p) => p.id).join() === 'p0,p1,p2');
  check('scores, rôles, stats et historique remis à zéro', s.players.every((p) => p.score === 0 && p.role === null && p.stats.bestPresidentRun === 0) && s.history.length === 0);
  check('pas d’échange : c’est une première manche', s.exchanges.length === 0);
  check('seq et journal continuent', s.lastEvent.seq === seq + 1 && s.log.length > logLength && s.lastEvent.kind === 'deal');
  check('la signature de la partie suivante changera', `${s.winner}|${s.lastEvent.seq}|${s.log.length}` !== signature);
  check('52 cartes redistribuées', s.players.reduce((a, p) => a + p.hand.length, 0) === 52 && handsConsistent(s));
}

// --- Robustesse --------------------------------------------------------------------

console.log('\n== immuabilité ==');
{
  const s = table(setup(3), [[c(5), c(6)], [c(15), c(4)], [c(7), c(8)]]);
  const frozen = JSON.stringify(s);
  let t = play(s, 0, [c(5)]);
  t = play(t, 1, [c(15)]);
  leave(t, 2);
  run(s, { type: 'LEAVE', playerId: id(s, 1) });
  check('l’état d’origine n’est jamais modifié', JSON.stringify(s) === frozen);
  const r = applyAction(s, { type: 'PASS', playerId: id(s, 0) });
  check('une erreur rend le même état', r.state === s && Boolean(r.error));
  check('une action inconnue ne fait rien', applyAction(s, { type: 'NOPE' } as unknown as PresidentAction).state === s);
}

console.log('\n== aides sur un état masqué ==');
{
  const s = table(setup(3), [[c(5), c(6)], [c(3), c(4)], [c(7), c(8)]]);
  const masked: PresidentState = { ...s, players: s.players.map((p, i) => (i === 0 ? p : { ...p, hand: [] })) };
  check('activeSeats se fie à handCount', activeSeats(masked).join() === '0,1,2');
  check('legalPlays marche sur sa propre main', legalPlays(masked, 0).length === 2);
}

if (failures > 0) throw new Error(`${failures} FAILURE(S) sur ${total}`);
console.log(`\nALL PASS (${total} vérifications)\n`);
