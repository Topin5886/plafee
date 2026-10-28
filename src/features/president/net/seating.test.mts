/*
 * Asseoir un observateur au Président : il prend le siège (score et rôle
 * compris, c'est la règle), mais jamais le compte ni les trophées du partant,
 * et une revanche qu'il rend possible n'est pas refusée faute de joueurs.
 */
import { applyAction, createInitialState } from '../engine/rules.ts';
import { presidentDecide } from '../engine/ai.ts';
import type { PresidentState } from '../engine/types.ts';
import { createSpectatorDesk } from '../../rooms/spectators.ts';
import { applyDeal } from './seating.ts';

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

/** Une table de `ids`, chacun avec son compte, jouée par l'IA jusqu'à `until`. */
function playUntil(ids: string[], until: PresidentState['phase']): PresidentState {
  let s = createInitialState('TEST', ids[0], ids.length);
  for (const id of ids) s = applyAction(s, { type: 'JOIN', playerId: id, name: id, userId: 'u-' + id }).state;
  s = applyAction(s, { type: 'START' }).state;
  const bots = ids.map((id) => ({ id, name: id, level: 'normal' as const }));
  for (let guard = 0; s.phase !== until && guard < 5000; guard++) {
    if (s.phase === 'manche-end') {
      s = applyAction(s, { type: 'NEXT_MANCHE' }).state;
      continue;
    }
    const move = presidentDecide(s, bots);
    if (!move) break;
    s = applyAction(s, move.action).state;
  }
  return s;
}

console.log('Observateur assis à la manche suivante');
{
  let s = playUntil(['h', 'a', 'b', 'c'], 'manche-end');
  const leaver = s.players.findIndex((p) => p.id === 'c');
  // Des exploits au compteur du partant : l'observateur ne doit pas en hériter.
  s = {
    ...s,
    players: s.players.map((p, i) => (i === leaver ? { ...p, stats: { ...p.stats, twos: 2, quads: 1, presidentRun: 1 } } : p)),
  };
  s = applyAction(s, { type: 'LEAVE', playerId: 'c' }).state;
  const before = s.players[leaver];
  const desk = createSpectatorDesk(() => {});
  desk.add('spec', 'Sam');
  desk.setWant('spec', true);
  const userIds = new Map([['spec', 'u-sam']]);
  const r = applyDeal(s, { type: 'NEXT_MANCHE' }, desk, userIds);
  const sam = r.state.players[leaver];
  check('pas d’erreur', !r.error, r.error);
  check('Sam a pris le siège laissé vide', sam.id === 'spec' && sam.name === 'Sam' && sam.connected);
  check('Sam joue sous son propre compte', sam.userId === 'u-sam', sam.userId);
  check('Sam garde le score et le rôle du siège', sam.score === before.score && sam.role === before.role);
  check(
    'les trophées du partant ne le suivent pas',
    sam.stats.twos === 0 && sam.stats.quads === 0 && sam.stats.presidentRun === 0,
    sam.stats,
  );
  check('les autres sièges gardent leur compte', r.state.players.every((p, i) => i === leaver || p.userId === 'u-' + p.id));
  check('Sam a quitté le registre', !desk.has('spec'));
}

console.log('Observateur invité : pas de compte');
{
  let s = playUntil(['h', 'a', 'b', 'c'], 'manche-end');
  s = applyAction(s, { type: 'LEAVE', playerId: 'b' }).state;
  const desk = createSpectatorDesk(() => {});
  desk.add('guest', 'Invité');
  desk.setWant('guest', true);
  const r = applyDeal(s, { type: 'NEXT_MANCHE' }, desk, new Map());
  const seat = r.state.players.findIndex((p) => p.id === 'guest');
  check('assis', seat >= 0);
  check('sans le compte du partant', seat >= 0 && r.state.players[seat].userId === null, r.state.players[seat]?.userId);
}

console.log('Revanche à 3 rendue possible par l’observateur');
{
  let s = playUntil(['h', 'a', 'b'], 'over');
  s = applyAction(s, { type: 'LEAVE', playerId: 'b' }).state;
  check('seule, la revanche est refusée', Boolean(applyAction(s, { type: 'REMATCH' }).error));
  const desk = createSpectatorDesk(() => {});
  desk.add('spec', 'Sam');
  desk.setWant('spec', true);
  const r = applyDeal(s, { type: 'REMATCH' }, desk, new Map([['spec', 'u-sam']]));
  check('avec Sam, elle part', !r.error && r.state.phase !== 'over', { error: r.error, phase: r.state.phase });
  const sam = r.state.players.find((p) => p.id === 'spec');
  check('Sam est assis, sous son compte, scores à zéro', sam?.userId === 'u-sam' && sam.score === 0, sam);
  check('Sam a quitté le registre', !desk.has('spec'));
}

console.log('Revanche impossible même avec l’observateur : le registre reste intact');
{
  let s = playUntil(['h', 'a', 'b'], 'over');
  s = applyAction(s, { type: 'LEAVE', playerId: 'a' }).state;
  s = applyAction(s, { type: 'LEAVE', playerId: 'b' }).state;
  const desk = createSpectatorDesk(() => {});
  desk.add('spec', 'Sam');
  desk.setWant('spec', true);
  desk.add('zed', 'Zed');
  // L'hôte seul (la partie s'est arrêtée au deuxième départ) : un observateur ne suffit pas.
  const r = applyDeal(s, { type: 'REMATCH' }, desk, new Map());
  check('refusée', Boolean(r.error), r.error);
  check('personne n’a bougé', r.state.players.every((p) => p.id !== 'spec'));
  check('Sam attend toujours sa place', desk.list().some((x) => x.id === 'spec' && x.wantsSeat), desk.list());
  check('Sam garde son rang dans la file', desk.list().map((x) => x.id).join(',') === 'spec,zed', desk.list());
}

console.log(`\n${total - failures}/${total} vérifications`);
if (failures) process.exit(1);
