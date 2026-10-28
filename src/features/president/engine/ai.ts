import { TWO, shuffle, sortHand } from './deck';
import { activeSeats, canPass, legalPlays, topPlay } from './rules';
import type { PresidentAction, PresidentCard, PresidentState } from './types';
import { pick, thinkDelay, type BotLevel, type BotMove, type BotSeat } from '../../bots/bots';

/*
 * Le bot du Président : quoi poser, quand passer, quoi rendre à l'échange.
 *
 * - Facile : une pose légale au hasard, et il passe parfois sans raison.
 * - Normal : la plus petite pose qui ne casse pas un groupe, garde ses 2.
 * - Difficile : garde ses 2 et ses carrés pour reprendre la main, ouvre avec
 *   ses groupes les plus faibles, vide ses grosses combinaisons à l'approche
 *   de la sortie, coupe au 2 quand un adversaire va sortir, et rend ses
 *   cartes isolées les plus basses à l'échange.
 *
 * Il ne choisit jamais qu'entre les poses de `legalPlays` : il ne peut pas
 * tenter un coup illégal, et quand il ouvre il pose toujours.
 */

/** Les chances de passer sans raison, pour le facile. */
const EASY_IDLE_PASS = 0.25;

/** La main rangée par valeur, de la plus faible à la plus forte. */
function groupsOf(hand: PresidentCard[]): PresidentCard[][] {
  const byRank = new Map<number, PresidentCard[]>();
  for (const card of sortHand(hand)) {
    const group = byRank.get(card.rank);
    if (group) group.push(card);
    else byRank.set(card.rank, [card]);
  }
  return [...byRank.values()];
}

/** Un groupe qui ferme le pli dès qu'on le pose : des 2, ou un carré. */
const isCloser = (group: PresidentCard[]) => group[0].rank === TWO || group.length === 4;

const rankOf = (play: PresidentCard[]) => play[0].rank;

/** La pose légale de cette valeur et de ce nombre, si elle existe. */
function findPlay(plays: PresidentCard[][], rank: number, count: number): PresidentCard[] | null {
  return plays.find((p) => rankOf(p) === rank && p.length === count) ?? null;
}

/** Ouverture du normal : le groupe le plus faible, en entier, sans toucher aux 2. */
function normalOpening(plays: PresidentCard[][], hand: PresidentCard[]): PresidentCard[] {
  const groups = groupsOf(hand);
  const target = groups.find((g) => g[0].rank !== TWO) ?? groups[0];
  return findPlay(plays, target[0].rank, target.length) ?? plays[0];
}

/**
 * Ouverture du difficile.
 *
 * Les 2 et les carrés ferment le pli : ils ne servent pas à ouvrir, ils
 * rendent la main. Quand il ne reste plus qu'un groupe ordinaire à côté, on
 * les joue d'abord, puis on sort sur ce dernier groupe que personne n'a pu
 * couvrir. Sinon on ouvre avec le plus faible ; près de la sortie, on préfère
 * les groupes nombreux, plus durs à suivre.
 */
function hardOpening(plays: PresidentCard[][], hand: PresidentCard[]): PresidentCard[] {
  const groups = groupsOf(hand);
  const closers = groups.filter(isCloser);
  const ordinary = groups.filter((g) => !isCloser(g));
  if (closers.length > 0 && ordinary.length <= 1) {
    const closer = closers[0];
    return findPlay(plays, closer[0].rank, closer.length) ?? plays[0];
  }
  if (ordinary.length === 0) return plays[0];
  const nearExit = hand.length <= 6;
  const scored = ordinary
    .map((g) => ({ g, s: g[0].rank - (g.length - 1) * (nearExit ? 4 : 1.5) }))
    .sort((a, b) => a.s - b.s);
  // Près de la sortie, on garde pour la fin la carte la plus forte : c'est
  // celle qui a le plus de chances de passer sans être couverte.
  const best = nearExit && scored.length > 1 && scored[0].g === ordinary[ordinary.length - 1] ? scored[1] : scored[0];
  return findPlay(plays, best.g[0].rank, best.g.length) ?? plays[0];
}

/** Ce que coûte une pose en suivant : les cartes prises à un groupe plus grand le cassent. */
function groupSize(hand: PresidentCard[], rank: number): number {
  return hand.filter((c) => c.rank === rank).length;
}

function normalFollow(plays: PresidentCard[][], hand: PresidentCard[], random: () => number): PresidentCard[] | null {
  const count = plays[0].length;
  const ordinary = plays.filter((p) => rankOf(p) !== TWO);
  const exact = ordinary.filter((p) => groupSize(hand, rankOf(p)) === count);
  if (exact.length > 0) return exact[0];
  // Casser une paire ou un brelan ne vaut le coup que quand la main est presque vide.
  if (ordinary.length > 0 && hand.length <= 4) return ordinary[0];
  // Les 2 se gardent… sauf, de temps en temps, pour ne pas finir avec.
  const twos = plays.find((p) => rankOf(p) === TWO);
  if (twos && hand.length - count <= 2 && random() < 0.5) return twos;
  return null;
}

function hardFollow(state: PresidentState, seat: number, plays: PresidentCard[][], hand: PresidentCard[]): PresidentCard[] | null {
  const count = plays[0].length;
  const top = topPlay(state)!;
  const twos = plays.find((p) => rankOf(p) === TWO) ?? null;
  const ordinary = plays.filter((p) => rankOf(p) !== TWO);

  // Un adversaire est sur le point de sortir : on coupe au 2, le pli se ferme
  // et c'est nous qui rouvrons, avec une pose qu'il ne pourra peut-être pas suivre.
  const threat = activeSeats(state).some((i) => i !== seat && state.players[i].handCount <= Math.max(2, count));
  if (threat && twos) return twos;

  const exact = ordinary.filter((p) => groupSize(hand, rankOf(p)) === count);
  if (exact.length > 0) {
    const play = exact[0];
    // Un As ou un Roi sur un petit pli, en début de manche : du gâchis, sauf si
    // la menace presse. On le garde pour un pli qui compte.
    if (!threat && rankOf(play) >= 13 && top.rank <= 9 && hand.length > 7) return null;
    return play;
  }

  // Ne casse un groupe que près de la sortie, ou quand l'adversaire presse.
  if (ordinary.length > 0 && (hand.length <= 6 || threat)) {
    // Tant qu'à casser, éviter de laisser derrière une carte seule.
    const unbroken = ordinary.filter((p) => groupSize(hand, rankOf(p)) - count !== 1);
    return unbroken[0] ?? ordinary[0];
  }

  // Les 2 pour reprendre la main quand il ne reste presque plus rien à placer.
  if (twos) {
    const rest = hand.filter((c) => c.rank !== TWO);
    if (groupsOf(rest).length <= 2) return twos;
  }
  return null;
}

/** Ce que le bot pose (ou null : il passe). Jamais null quand il ouvre. */
function choosePlay(
  state: PresidentState,
  seat: number,
  level: BotLevel,
  random: () => number,
): PresidentCard[] | null {
  const plays = legalPlays(state, seat);
  if (plays.length === 0) return null;
  const hand = state.players[seat].hand;
  const opening = state.trick.length === 0;

  // Une pose qui vide la main se joue toujours, à tous les niveaux.
  const finishing = plays.find((p) => p.length === hand.length);
  if (finishing && level !== 'easy') return finishing;

  if (level === 'easy') {
    if (!opening && random() < EASY_IDLE_PASS) return null;
    return pick(plays, random);
  }
  if (opening) return level === 'hard' ? hardOpening(plays, hand) : normalOpening(plays, hand);
  return level === 'hard' ? hardFollow(state, seat, plays, hand) : normalFollow(plays, hand, random);
}

/** Le coup du bot au tour : PLAY ou PASS, ou null si ce n'est pas à lui. */
export function presidentTurnAction(
  state: PresidentState,
  seat: number,
  level: BotLevel,
  random: () => number = Math.random,
): PresidentAction | null {
  const player = state.players[seat];
  if (!player || state.phase !== 'playing' || state.turn !== seat) return null;
  const play = choosePlay(state, seat, level, random);
  if (play) return { type: 'PLAY', playerId: player.id, cardIds: play.map((c) => c.id) };
  if (canPass(state, seat)) return { type: 'PASS', playerId: player.id };
  // Ouvrir sans pose légale n'arrive pas (une main non vide a toujours une
  // carte à poser), mais ne jamais rendre une action refusée.
  return null;
}

/**
 * Les cartes que le bot rend à l'échange. Le facile rend au hasard, le normal
 * ses plus basses, le difficile ses plus basses cartes isolées : rendre un 3
 * seul ne lui coûte rien, casser une paire si.
 */
export function presidentGiveCards(
  hand: PresidentCard[],
  count: number,
  level: BotLevel,
  random: () => number = Math.random,
): PresidentCard[] {
  if (level === 'easy') return shuffle(hand, random).slice(0, count);
  const sorted = sortHand(hand);
  if (level === 'normal') return sorted.slice(0, count);
  const size = (rank: number) => groupSize(hand, rank);
  // Rangs de préférence : isolées d'abord, puis le reste ; As et 2 en dernier.
  const tier = (c: PresidentCard) => (c.rank >= 14 ? 2 : size(c.rank) === 1 ? 0 : 1);
  return [...sorted].sort((a, b) => tier(a) - tier(b) || a.rank - b.rank).slice(0, count);
}

export function presidentDecide(
  state: PresidentState,
  bots: BotSeat[],
  random: () => number = Math.random,
): BotMove<PresidentAction> | null {
  if (state.phase === 'exchange') {
    for (const bot of bots) {
      const seat = state.players.findIndex((p) => p.id === bot.id);
      if (seat === -1 || !state.players[seat].connected) continue;
      const exchange = state.exchanges.find((e) => e.from === seat && e.kind === 'choice' && !e.done);
      if (!exchange) continue;
      const cards = presidentGiveCards(state.players[seat].hand, exchange.count, bot.level, random);
      return {
        action: { type: 'GIVE', playerId: bot.id, cardIds: cards.map((c) => c.id) },
        delay: thinkDelay(bot.level, random),
      };
    }
    return null;
  }

  if (state.phase !== 'playing') return null;
  const current = state.players[state.turn];
  const bot = bots.find((b) => b.id === current?.id);
  if (!bot || !current.connected) return null;
  const action = presidentTurnAction(state, state.turn, bot.level, random);
  return action ? { action, delay: thinkDelay(bot.level, random) } : null;
}
