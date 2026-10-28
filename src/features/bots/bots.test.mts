/*
 * Les bots jouent des parties entières entre eux, dans chaque jeu : aucune ne
 * doit se bloquer ni tenter un coup illégal, et un bot difficile doit battre
 * un bot facile nettement plus souvent qu'il ne perd.
 */
import type { BotLevel, BotSeat } from './bots.ts';
import * as scopa from '../scopa/engine/rules.ts';
import { scopaDecide } from '../scopa/engine/ai.ts';
import * as uno from '../uno/engine/rules.ts';
import { unoDecide } from '../uno/engine/ai.ts';
import * as p4 from '../puissance4/engine/rules.ts';
import { p4Decide } from '../puissance4/engine/ai.ts';
import { MODES, ORIGINAL_MODES } from '../puissance4/engine/modes.ts';
import type { P4Mode } from '../puissance4/engine/types.ts';
import * as president from '../president/engine/rules.ts';
import { presidentDecide } from '../president/engine/ai.ts';
import { presidentOutcome } from '../account/gameOutcomes.ts';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
}

const seats = (levels: BotLevel[]): BotSeat[] => levels.map((level, i) => ({ id: `bot-${i + 1}`, name: `B${i + 1}`, level }));
const MAX_STEPS = 5000;

// --- Scopa -------------------------------------------------------------------------

function playScopa(levels: BotLevel[]) {
  const bots = seats(levels);
  let s = scopa.createInitialState('SIM', bots[0].id);
  for (const b of bots) s = scopa.applyAction(s, { type: 'JOIN', playerId: b.id, name: b.name }).state;
  s = scopa.applyAction(s, { type: 'START' }).state;
  let errors = 0;
  for (let step = 0; step < MAX_STEPS && s.phase !== 'match-end'; step++) {
    if (s.phase === 'hand-end') {
      s = scopa.applyAction(s, { type: 'NEXT_HAND' }).state;
      continue;
    }
    const move = scopaDecide(s, bots);
    if (!move) return { stuck: true, errors, winner: -1 };
    const r = scopa.applyAction(s, move.action);
    if (r.error) errors++;
    s = r.state;
  }
  const best = Math.max(...s.matchScores);
  return { stuck: s.phase !== 'match-end', errors, winner: s.matchScores.filter((x) => x === best).length > 1 ? -1 : s.matchScores.indexOf(best) };
}

// --- UNO ---------------------------------------------------------------------------

function playUno(levels: BotLevel[], stacking: boolean) {
  const bots = seats(levels);
  let s = uno.createInitialState('SIM', bots[0].id, bots.length);
  s = uno.applyAction(s, { type: 'SET_OPTIONS', maxPlayers: bots.length, stackingEnabled: stacking }).state;
  for (const b of bots) s = uno.applyAction(s, { type: 'JOIN', playerId: b.id, name: b.name }).state;
  s = uno.applyAction(s, { type: 'START' }).state;
  let errors = 0;
  for (let step = 0; step < MAX_STEPS && s.phase === 'playing'; step++) {
    const move = unoDecide(s, bots);
    if (!move) return { stuck: true, errors, winner: -1 };
    const r = uno.applyAction(s, move.action);
    if (r.error) errors++;
    s = r.state;
  }
  return { stuck: s.phase !== 'won', errors, winner: s.winner ?? -1 };
}

// --- Puissance 4 -------------------------------------------------------------------

function playP4(levels: BotLevel[], mode: P4Mode, original: boolean) {
  const modes = original ? ORIGINAL_MODES : MODES;
  const bots = seats(levels);
  let s = p4.createInitialState('SIM', bots[0].id, mode, modes);
  for (const b of bots) s = p4.applyAction(s, { type: 'JOIN', playerId: b.id, name: b.name }, modes, !original).state;
  s = p4.applyAction(s, { type: 'START' }, modes, !original).state;
  let errors = 0;
  for (let step = 0; step < MAX_STEPS && s.phase === 'playing'; step++) {
    const move = p4Decide(s, bots);
    if (!move) return { stuck: true, errors, winner: -1 };
    const r = p4.applyAction(s, move.action, modes, !original);
    if (r.error) errors++;
    s = r.state;
  }
  return { stuck: s.phase === 'playing', errors, winner: s.winner?.team ?? -1 };
}

// --- Président ----------------------------------------------------------------------

// L'hôte lance lui-même chaque manche (les bots ne le font jamais) : la
// simulation le remplace. Les échanges de début de manche passent par l'IA.
function playPresident(levels: BotLevel[], xOuRien: boolean, manches = 3) {
  const bots = seats(levels);
  let s = president.createInitialState('SIM', bots[0].id, bots.length);
  s = president.applyAction(s, { type: 'SET_OPTIONS', maxPlayers: bots.length, xOuRien, manches }).state;
  for (const b of bots) s = president.applyAction(s, { type: 'JOIN', playerId: b.id, name: b.name }).state;
  s = president.applyAction(s, { type: 'START' }).state;
  let errors = 0;
  for (let step = 0; step < MAX_STEPS && s.phase !== 'over'; step++) {
    if (s.phase === 'manche-end') {
      s = president.applyAction(s, { type: 'NEXT_MANCHE' }).state;
      continue;
    }
    const move = presidentDecide(s, bots);
    if (!move) return { stuck: true, errors, winner: -1, state: s };
    const r = president.applyAction(s, move.action);
    if (r.error) errors++;
    s = r.state;
  }
  return { stuck: s.phase !== 'over', errors, winner: s.winner ?? -1, state: s };
}

// --- Parties ------------------------------------------------------------------------

type Result = { stuck: boolean; errors: number; winner: number };
function series(label: string, n: number, play: (i: number) => Result, strongSeat?: (i: number) => number) {
  let stuck = 0;
  let errors = 0;
  let strongWins = 0;
  let strongLosses = 0;
  for (let i = 0; i < n; i++) {
    const r = play(i);
    if (r.stuck) stuck++;
    errors += r.errors;
    if (strongSeat && r.winner >= 0) {
      if (r.winner === strongSeat(i)) strongWins++;
      else strongLosses++;
    }
  }
  check(`${label} : ${n} parties terminées`, stuck === 0, { stuck });
  check(`${label} : aucun coup illégal`, errors === 0, { errors });
  if (strongSeat) {
    console.log(`       difficile contre facile : ${strongWins} victoires, ${strongLosses} défaites`);
    check(`${label} : le difficile bat le facile`, strongWins > strongLosses * 1.5, { strongWins, strongLosses });
  }
}

console.log('Scopa');
for (const n of [2, 3, 4]) series(`Scopa à ${n}`, 15, () => playScopa(Array<BotLevel>(n).fill('normal')));
series('Scopa, niveaux mêlés', 10, () => playScopa(['easy', 'normal', 'hard']));
// Le difficile change de siège une partie sur deux : le premier à jouer n'est pas avantagé.
series('Scopa duel', 60, (i) => playScopa(i % 2 ? ['easy', 'hard'] : ['hard', 'easy']), (i) => (i % 2 ? 1 : 0));

console.log('UNO');
for (const n of [2, 3, 4]) for (const stacking of [false, true]) series(`UNO à ${n}${stacking ? ', surenchère' : ''}`, 15, () => playUno(Array<BotLevel>(n).fill('normal'), stacking));
series('UNO duel', 80, (i) => playUno(i % 2 ? ['easy', 'hard'] : ['hard', 'easy'], false), (i) => (i % 2 ? 1 : 0));

console.log('Président');
for (const n of [3, 4, 5, 6, 7]) for (const xOuRien of [true, false]) series(`Président à ${n}${xOuRien ? '' : ', sans X ou rien'}`, 6, () => playPresident(Array<BotLevel>(n).fill('normal'), xOuRien));
series('Président, niveaux mêlés, 7 manches', 6, () => playPresident(['easy', 'normal', 'hard', 'normal'], true, 7));
{
  // À trois, le hasard donne un tiers des parties à chacun : le difficile, qui
  // change de siège à chaque partie, doit faire nettement mieux face à deux faciles.
  const n = 60;
  let hardWins = 0;
  for (let i = 0; i < n; i++) {
    const levels: BotLevel[] = ['easy', 'easy', 'easy'];
    levels[i % 3] = 'hard';
    if (playPresident(levels, true).winner === i % 3) hardWins++;
  }
  console.log(`       difficile contre deux faciles : ${hardWins} victoires sur ${n}`);
  check('Président : le difficile bat les faciles', hardWins > n / 2, { hardWins, n });
}
{
  // Non-régression : des départs depuis l'écran de fin ne doivent pas changer
  // la signature. Sinon les pairs restés à table recalculeraient une autre clé
  // de session et enregistreraient la même partie une seconde fois (victoire,
  // FEES et trophées doublés). Elle doit tenir, et changer à la revanche.
  const over = playPresident(['normal', 'normal', 'normal', 'normal'], true).state;
  check('Président : la partie de référence va jusqu’au bout', over.phase === 'over', { phase: over.phase });
  const viewer = over.players[0].id;
  const before = presidentOutcome(over, viewer, 'SIM')?.signature;
  let left = president.applyAction(over, { type: 'LEAVE', playerId: over.players[3].id }).state;
  left = president.applyAction(left, { type: 'LEAVE', playerId: over.players[2].id }).state;
  const after = presidentOutcome(left, viewer, 'SIM')?.signature;
  check('Président : la signature tient après des départs en fin de partie', before !== undefined && before === after, { before, after });

  const replay = president.applyAction(over, { type: 'REMATCH' }).state;
  check('Président : pas de résultat pendant la revanche', presidentOutcome(replay, viewer, 'SIM') === null);
  let s = replay;
  for (let step = 0; step < MAX_STEPS && s.phase !== 'over'; step++) {
    if (s.phase === 'manche-end') {
      s = president.applyAction(s, { type: 'NEXT_MANCHE' }).state;
      continue;
    }
    const move = presidentDecide(s, seats(['normal', 'normal', 'normal', 'normal']));
    if (!move) break;
    s = president.applyAction(s, move.action).state;
  }
  const second = presidentOutcome(s, viewer, 'SIM')?.signature;
  check('Président : la revanche a sa propre signature', second !== undefined && second !== before, { before, second });
}

console.log('Puissance 4');
for (const original of [false, true]) {
  const v = original ? 'Classic' : 'Forge';
  series(`${v} duel`, 10, () => playP4(['normal', 'normal'], 'duel', original));
  series(`${v} trio`, 6, () => playP4(['normal', 'hard', 'easy'], 'trio', original));
  series(`${v} quatuor`, 4, () => playP4(['normal', 'normal', 'hard', 'easy'], 'quatuor', original));
  series(`${v} équipes`, 4, () => playP4(['hard', 'easy', 'normal', 'normal'], 'teams', original));
  series(`${v} duel`, 30, (i) => playP4(i % 2 ? ['easy', 'hard'] : ['hard', 'easy'], 'duel', original), (i) => (i % 2 ? 1 : 0));
}

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTout est vert.');
process.exit(failures ? 1 : 0);
