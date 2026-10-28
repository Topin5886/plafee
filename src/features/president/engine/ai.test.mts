/*
 * Le bot du Président : des choix ciblés par niveau, puis des centaines de
 * parties complètes bot contre bot, de 3 à 7 joueurs. Aucune ne doit se
 * bloquer, tenter un coup illégal ou perdre une carte en route ; et le
 * difficile doit battre le facile nettement plus souvent que le hasard.
 */
import { applyAction, createInitialState, legalPlays, standings } from './rules.ts';
import { presidentDecide, presidentGiveCards, presidentTurnAction } from './ai.ts';
import { cardId, sortHand } from './deck.ts';
import type { BotLevel, BotSeat } from '../../bots/bots.ts';
import type { PresidentAction, PresidentCard, PresidentState, PresidentSuit } from './types.ts';

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

const LETTER: Record<string, PresidentSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const c = (rank: number, suit: keyof typeof LETTER = 'c'): PresidentCard => ({ id: cardId(rank, LETTER[suit]), rank, suit: LETTER[suit] });

const seats = (levels: BotLevel[]): BotSeat[] => levels.map((level, i) => ({ id: `bot-${i + 1}`, name: `B${i + 1}`, level }));

function lobby(bots: BotSeat[], manches = 3): PresidentState {
  let s = createInitialState('SIM', bots[0].id, bots.length);
  s = applyAction(s, { type: 'SET_OPTIONS', maxPlayers: bots.length, xOuRien: true, manches }).state;
  for (const b of bots) s = applyAction(s, { type: 'JOIN', playerId: b.id, name: b.name }).state;
  return s;
}

/** Une table de bots aux mains forcées, pli vide, au siège `turn`. */
function table(levels: BotLevel[], hands: PresidentCard[][], turn = 0): PresidentState {
  const s = applyAction(lobby(seats(levels)), { type: 'START' }, seeded(1)).state;
  return {
    ...s,
    turn,
    phase: 'playing',
    trick: [],
    lastPlayer: -1,
    forcedRank: null,
    players: s.players.map((p, i) => ({ ...p, hand: sortHand(hands[i]), handCount: hands[i].length, finishedAt: null, passed: false })),
  };
}

function act(s: PresidentState, action: PresidentAction | null): PresidentState {
  if (!action) throw new Error('aucune action');
  const r = applyAction(s, action);
  if (r.error) throw new Error(r.error);
  return r.state;
}

const ids = (action: PresidentAction | null) => (action && 'cardIds' in action ? action.cardIds.join('+') : action?.type ?? 'null');

// --- Choix ciblés ------------------------------------------------------------------

console.log('\n== ouvrir ==');
{
  const hand = [c(4), c(4, 'd'), c(6), c(9), c(15)];
  const s = table(['normal', 'normal', 'normal'], [hand, [c(3), c(5)], [c(7), c(8)]]);
  check('normal : ouvre avec son groupe le plus faible, en entier', ids(presidentTurnAction(s, 0, 'normal')) === 'p4c+p4d');
  check('difficile : idem en début de main', ids(presidentTurnAction(s, 0, 'hard')) === 'p4c+p4d');
  for (let i = 0; i < 30; i++) {
    const a = presidentTurnAction(s, 0, 'easy', seeded(i));
    if (!a || a.type !== 'PLAY') {
      check('facile : ouvre toujours', false, a);
      break;
    }
  }
  check('facile : ouvre toujours (30 tirages)', true);
  const only2 = table(['normal', 'normal', 'normal'], [[c(15), c(15, 'd')], [c(3)], [c(7)]]);
  check('une main de 2 seulement : il pose quand même', presidentTurnAction(only2, 0, 'normal')?.type === 'PLAY');
}
{
  // Un seul groupe ordinaire à côté d'un 2 : le 2 d'abord, puis la sortie.
  const s = table(['hard', 'hard', 'hard'], [[c(5), c(15)], [c(3), c(4)], [c(7), c(8)]]);
  check('difficile : le 2 d’abord pour garder la main', ids(presidentTurnAction(s, 0, 'hard')) === 'p15c');
  const after = act(s, presidentTurnAction(s, 0, 'hard'));
  check('il rouvre aussitôt', after.turn === 0 && after.trick.length === 0);
  const out = act(after, presidentTurnAction(after, 0, 'hard'));
  check('et sort sur son dernier groupe', out.players[0].finishedAt === 0);
}
{
  const s = table(['hard', 'hard', 'hard'], [[c(6), c(6, 'd'), c(6, 'h'), c(6, 's'), c(9)], [c(3), c(4)], [c(7), c(8)]]);
  check('difficile : un carré à côté d’un dernier groupe se joue d’abord', ids(presidentTurnAction(s, 0, 'hard')) === 'p6c+p6d+p6h+p6s');
}
{
  const s = table(['hard', 'hard', 'hard'], [[c(9), c(9, 'd'), c(9, 'h')], [c(3), c(4)], [c(7), c(8)]]);
  check('une pose qui vide la main se joue toujours', ids(presidentTurnAction(s, 0, 'hard')) === 'p9c+p9d+p9h' && ids(presidentTurnAction(s, 0, 'normal')) === 'p9c+p9d+p9h');
}
{
  // Près de la sortie : le difficile pose son groupe nombreux et garde sa grosse carte.
  const s = table(['hard', 'hard', 'hard'], [[c(4), c(8), c(8, 'd'), c(8, 'h'), c(13)], [c(3), c(5)], [c(7), c(9)]]);
  check('difficile près de la sortie : le brelan d’abord', ids(presidentTurnAction(s, 0, 'hard')) === 'p8c+p8d+p8h');
  check('normal : le plus faible', ids(presidentTurnAction(s, 0, 'normal')) === 'p4c');
}

console.log('\n== suivre ==');
{
  let s = table(['normal', 'normal', 'normal'], [[c(5), c(3, 'd'), c(4, 'd'), c(6, 'd')], [c(7), c(7, 'd'), c(9), c(15), c(3), c(4)], [c(10), c(11), c(12), c(13)]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p5c'] });
  check('normal : le 9 isolé plutôt que casser la paire de 7', ids(presidentTurnAction(s, 1, 'normal')) === 'p9c');
  check('difficile : idem', ids(presidentTurnAction(s, 1, 'hard')) === 'p9c');
}
{
  let s = table(['normal', 'normal', 'normal'], [[c(5), c(3, 'd'), c(5, 'h'), c(9, 'h')], [c(7), c(7, 'd'), c(15), c(3), c(4), c(4, 'd'), c(6), c(6, 'd')], [c(10), c(11), c(12), c(13)]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p5c'] });
  check('normal : ne casse pas sa paire et garde son 2 → passe', presidentTurnAction(s, 1, 'normal')?.type === 'PASS');
  check('difficile : idem', presidentTurnAction(s, 1, 'hard')?.type === 'PASS');
}
{
  // Un adversaire n'a plus qu'une carte : le difficile coupe au 2.
  let s = table(['hard', 'hard', 'hard'], [[c(9), c(3, 'd'), c(4)], [c(10), c(15), c(5), c(6), c(6, 'd'), c(8), c(8, 'd'), c(12)], [c(14)]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p9c'] });
  check('difficile : coupe au 2 quand un adversaire va sortir', ids(presidentTurnAction(s, 1, 'hard')) === 'p15c');
  check('normal : pose son 10, sans voir la menace', ids(presidentTurnAction(s, 1, 'normal')) === 'p10c');
}
{
  // Début de manche, petit pli : le difficile garde son As.
  let s = table(['hard', 'hard', 'hard'], [[c(5), c(3, 'd'), c(4), c(7), c(10, 'd')], [c(14), c(3), c(4, 'd'), c(6), c(6, 'd'), c(8), c(8, 'd'), c(9), c(9, 'd')], [c(10), c(11), c(12), c(3, 'h')]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p5c'] });
  check('difficile : ne gâche pas un As sur un 5', presidentTurnAction(s, 1, 'hard')?.type === 'PASS');
}
{
  // « 7 ou rien » : il n'a pas de 7, il passe ; avec un 7, il le pose.
  let s = table(['hard', 'hard', 'hard', 'hard'], [[c(7), c(3)], [c(7, 'd'), c(4)], [c(9), c(12), c(5)], [c(7, 'h'), c(13), c(6)]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p7c'] });
  s = act(s, { type: 'PLAY', playerId: s.players[1].id, cardIds: ['p7d'] });
  for (const level of ['easy', 'normal', 'hard'] as BotLevel[]) {
    check(`${level} : 7 ou rien sans 7 → passe`, presidentTurnAction(s, 2, level, seeded(3))?.type === 'PASS');
  }
  s = act(s, { type: 'PASS', playerId: s.players[2].id });
  check('le suivant est libre à nouveau', legalPlays(s, 3).length === 2);
}
{
  // Le facile passe parfois sans raison.
  let s = table(['easy', 'easy', 'easy'], [[c(5), c(3, 'd')], [c(9), c(10), c(11)], [c(10, 'd'), c(12)]]);
  s = act(s, { type: 'PLAY', playerId: s.players[0].id, cardIds: ['p5c'] });
  let passes = 0;
  for (let i = 0; i < 200; i++) if (presidentTurnAction(s, 1, 'easy', seeded(i))?.type === 'PASS') passes++;
  check('facile : passe parfois alors qu’il pourrait poser', passes > 20 && passes < 100, passes);
  let normalPasses = 0;
  for (let i = 0; i < 50; i++) if (presidentTurnAction(s, 1, 'normal', seeded(i))?.type === 'PASS') normalPasses++;
  check('normal : jamais sans raison', normalPasses === 0, normalPasses);
}
{
  const s = table(['hard', 'hard', 'hard'], [[c(5), c(3, 'd')], [c(9), c(10)], [c(10, 'd'), c(12)]]);
  check('pas son tour : aucune action', presidentTurnAction(s, 1, 'hard') === null);
  check('pas de NEXT_MANCHE par un bot', presidentDecide({ ...s, phase: 'manche-end' }, seats(['hard', 'hard', 'hard'])) === null);
  check('un humain au tour : le bot attend', presidentDecide(s, seats(['hard', 'hard', 'hard']).slice(1)) === null);
}

console.log('\n== l’échange ==');
{
  const hand = sortHand([c(3), c(4), c(4, 'd'), c(5), c(9), c(14), c(15)]);
  check('normal : ses deux plus basses', presidentGiveCards(hand, 2, 'normal').map((x) => x.id).join() === 'p3c,p4c');
  check('difficile : ses plus basses isolées, sans casser la paire', presidentGiveCards(hand, 2, 'hard').map((x) => x.id).join() === 'p3c,p5c');
  check('difficile : une carte', presidentGiveCards(hand, 1, 'hard').map((x) => x.id).join() === 'p3c');
  const strong = sortHand([c(14), c(15), c(8), c(8, 'd')]);
  check('difficile : garde As et 2 tant qu’il peut', presidentGiveCards(strong, 2, 'hard').every((x) => x.rank === 8));
  const easy = presidentGiveCards(hand, 2, 'easy', seeded(5));
  check('facile : deux cartes de sa main', easy.length === 2 && easy.every((x) => hand.includes(x)) && easy[0].id !== easy[1].id);
}

// --- Parties complètes -------------------------------------------------------------

interface Outcome {
  winner: number;
  steps: number;
  error?: string;
  /** Le départ demandé a bien eu lieu avant la fin. */
  left?: boolean;
}

/**
 * Joue une partie complète en appliquant les décisions des bots, l'hôte
 * lançant les manches suivantes. Vérifie à chaque coup que les 52 cartes
 * sont toutes là : en main, dans le pli en cours, ou déjà posées dans la manche.
 */
function playGame(levels: BotLevel[], seed: number, opts: { manches?: number; leaveAt?: number } = {}): Outcome {
  const random = seeded(seed);
  const bots = seats(levels);
  let s = applyAction(lobby(bots, opts.manches ?? 3), { type: 'START' }, random).state;
  let posted = new Set<string>();
  let left = false;
  const fail = (steps: number, error: string): Outcome => ({ winner: -1, steps, error });

  for (let step = 0; step < 20000; step++) {
    // Les invariants, après chaque coup.
    for (const p of s.players) if (p.handCount !== p.hand.length) return fail(step, `handCount faux pour ${p.name}`);
    for (const play of [...s.trick, ...s.lastTrick]) for (const card of play.cards) posted.add(card.id);
    const inHands = s.players.flatMap((p) => p.hand.map((x) => x.id));
    const handSet = new Set(inHands);
    if (handSet.size !== inHands.length) return fail(step, 'carte en double dans les mains');
    if (inHands.some((x) => posted.has(x))) return fail(step, 'carte à la fois posée et en main');
    if (handSet.size + posted.size !== 52) return fail(step, `${handSet.size + posted.size} cartes au lieu de 52`);
    if (s.phase === 'playing' && !s.players[s.turn]?.connected) return fail(step, 'le tour est à un absent');
    if (s.phase === 'playing' && s.players[s.turn].handCount === 0) return fail(step, 'le tour est à un joueur sans cartes');

    if (s.phase === 'over') {
      if (s.winner === null || standings(s)[0] !== s.winner) return fail(step, 'gagnant incohérent');
      if (opts.leaveAt === undefined) {
        // Partie complète : chaque manche distribue n(n-1)/2 points, toutes les manches ont eu lieu.
        const n = s.players.length;
        const sum = s.players.reduce((a, p) => a + p.score, 0);
        if (s.history.length !== s.options.manches) return fail(step, `${s.history.length} manches jouées`);
        if (sum !== (s.options.manches * n * (n - 1)) / 2) return fail(step, `total des points faux : ${sum}`);
      }
      return { winner: s.winner, steps: step, left };
    }

    let action: PresidentAction;
    if (opts.leaveAt !== undefined && step >= opts.leaveAt && !left) {
      // Un joueur s'en va en cours de partie (le dernier siège encore là),
      // quelle que soit la phase : en plein pli, pendant l'échange, entre deux manches.
      const seat = s.players.map((p, i) => (p.connected ? i : -1)).filter((i) => i >= 0).pop()!;
      action = { type: 'LEAVE', playerId: s.players[seat].id };
      left = true;
    } else if (s.phase === 'manche-end') {
      action = { type: 'NEXT_MANCHE' };
    } else {
      const move = presidentDecide(s, bots, random);
      if (!move) return fail(step, `bloqué en phase ${s.phase}`);
      action = move.action;
    }
    const r = applyAction(s, action, random);
    if (r.error) return fail(step, `${action.type} refusé : ${r.error}`);
    if (r.state.lastEvent.seq <= s.lastEvent.seq && action.type !== 'LEAVE') return fail(step, 'seq n’a pas avancé');
    if (r.state.lastEvent.kind === 'deal') posted = new Set();
    s = r.state;
  }
  return fail(20000, 'partie sans fin');
}

console.log('\n== parties complètes bot contre bot ==');
const MIX: BotLevel[] = ['easy', 'normal', 'hard'];
for (let n = 3; n <= 7; n++) {
  let errors: string[] = [];
  let games = 0;
  let maxSteps = 0;
  const winners = new Set<number>();
  for (let g = 0; g < 40; g++) {
    const levels = Array.from({ length: n }, (_, i) => MIX[(i + g) % 3]);
    const out = playGame(levels, 1000 * n + g, { manches: [3, 5, 7][g % 3] });
    games++;
    maxSteps = Math.max(maxSteps, out.steps);
    if (out.error) errors.push(`partie ${g} : ${out.error}`);
    else winners.add(out.winner);
  }
  check(`${n} joueurs : ${games} parties sans erreur ni blocage (max ${maxSteps} coups)`, errors.length === 0, errors.slice(0, 3));
  check(`${n} joueurs : des gagnants variés`, winners.size > 1, [...winners]);
  errors = [];
  let departures = 0;
  for (let g = 0; g < 15; g++) {
    const levels = Array.from({ length: n }, (_, i) => MIX[(i + g) % 3]);
    // Le départ tombe à des moments variés : premier pli, échange, entre deux manches…
    const out = playGame(levels, 5000 * n + g, { leaveAt: 3 + g * 7 });
    if (out.error) errors.push(`partie ${g} : ${out.error}`);
    if (out.left) departures++;
  }
  check(`${n} joueurs : 15 parties avec un départ en cours de route`, errors.length === 0 && departures === 15, { errors: errors.slice(0, 3), departures });
}

console.log('\n== les niveaux se distinguent ==');
{
  /** Part des victoires du siège tenu par `strong`, contre des `weak`, à 4, en tournant les places. */
  const rate = (strong: BotLevel, weak: BotLevel, games: number) => {
    let wins = 0;
    for (let g = 0; g < games; g++) {
      const seat = g % 4;
      const levels = Array.from({ length: 4 }, (_, i) => (i === seat ? strong : weak));
      const out = playGame(levels, 90000 + g, { manches: 5 });
      if (out.winner === seat) wins++;
    }
    return wins / games;
  };
  const hardVsEasy = rate('hard', 'easy', 200);
  const normalVsEasy = rate('normal', 'easy', 200);
  const hardVsNormal = rate('hard', 'normal', 200);
  console.log(`    difficile contre 3 faciles : ${(hardVsEasy * 100).toFixed(0)} % (hasard : 25 %)`);
  console.log(`    normal contre 3 faciles : ${(normalVsEasy * 100).toFixed(0)} %`);
  console.log(`    difficile contre 3 normaux : ${(hardVsNormal * 100).toFixed(0)} %`);
  check('le difficile écrase le facile', hardVsEasy > 0.5, hardVsEasy);
  check('le normal bat le facile', normalVsEasy > 0.4, normalVsEasy);
  check('le difficile bat le normal', hardVsNormal > 0.3, hardVsNormal);
}

if (failures > 0) throw new Error(`${failures} FAILURE(S) sur ${total}`);
console.log(`\nALL PASS (${total} vérifications)\n`);
