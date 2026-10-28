import { applyAction, freshStats, type ActionResult } from '../engine/rules';
import type { PresidentAction, PresidentPlayer, PresidentState } from '../engine/types';
import { withSeatsFilled, type SpectatorDesk } from '../../rooms/spectators';

/*
 * Asseoir les observateurs au début d'une donne, version Président.
 *
 * Le registre partagé (rooms/spectators.ts) ne connaît que l'identifiant, le
 * nom et la connexion d'un siège. Au Président, le siège porte aussi un compte
 * et des compteurs de trophées : sans ce complément, l'observateur assis
 * hériterait du `userId` du partant — sa victoire serait enregistrée comme une
 * défaite (record_game_result compare le compte connecté aux gagnants), il
 * afficherait les cosmétiques de l'autre et ses trophées compteraient les
 * carrés et les 2 de l'autre. Le score et le rôle, eux, restent au siège :
 * c'est la règle (voir README, « Départs »), l'échange se fait avec lui.
 */

/** Les actions qui ouvrent une donne : le bon moment pour asseoir les observateurs. */
export const DEALS = new Set<PresidentAction['type']>(['START', 'NEXT_MANCHE', 'REMATCH']);

/**
 * Pour chaque siège qui a changé d'occupant entre `before` et `after`, le
 * compte annoncé par le nouveau venu à son arrivée et des compteurs à zéro.
 */
export function withNewcomers(
  before: PresidentState,
  after: PresidentState,
  userIds: ReadonlyMap<string, string | null>,
): PresidentState {
  let changed = false;
  const players = after.players.map((p: PresidentPlayer, i) => {
    if (p.id === before.players[i]?.id) return p;
    changed = true;
    return { ...p, userId: userIds.get(p.id) ?? null, stats: freshStats() };
  });
  return changed ? { ...after, players } : after;
}

/**
 * Applique une action de donne en asseyant d'abord les observateurs qui
 * attendent une place.
 *
 * `withSeatsFilled` essaie l'action sur la table telle quelle et abandonne si
 * elle échoue. Or une revanche à 3 avec un parti échoue justement *faute de
 * joueurs* (« Il faut au moins 3 joueurs connectés ») : l'observateur qui
 * attend la place la rendrait possible. Dans ce cas seulement, on retente avec
 * les sièges remplis ; si ça échoue encore, le registre revient comme avant,
 * demandes de place comprises.
 */
export function applyDeal(
  current: PresidentState,
  action: PresidentAction,
  desk: SpectatorDesk,
  userIds: ReadonlyMap<string, string | null>,
): ActionResult {
  const apply = (s: PresidentState) => applyAction(withNewcomers(current, s, userIds), action);
  const result = withSeatsFilled(current, desk, apply);
  if (!result.error) return result;

  const snapshot = desk.list();
  if (!snapshot.some((s) => s.wantsSeat)) return result;
  const players = desk.fillVacatedSeats(current.players);
  if (players === current.players) return result;
  const seated = apply({ ...current, players });
  if (!seated.error) return seated;
  desk.restore(snapshot);
  return result;
}
