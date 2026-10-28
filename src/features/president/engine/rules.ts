import { RANK_NAME, ROLE_LABEL, TWO, createDeck, describePlay, shuffle, sortHand } from './deck';
import type {
  PresidentAction,
  PresidentCard,
  PresidentEvent,
  PresidentExchange,
  PresidentPlay,
  PresidentPlayer,
  PresidentRole,
  PresidentState,
  PresidentStats,
} from './types';

/*
 * Le moteur du Président : pur, sans React ni navigateur, comme celui d'UNO.
 * Chaque action rend un nouvel état ; l'hôte l'applique, les autres le
 * reçoivent. Le seul aléa est le mélange, injectable pour les tests.
 */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const MANCHE_CHOICES = [3, 5, 7];
export const DEFAULT_MANCHES = 3;

/** La Dame de cœur : qui la reçoit ouvre la première manche. */
export const OPENING_CARD_ID = 'p12h';

export interface ActionResult {
  state: PresidentState;
  error?: string;
}

type Random = () => number;

/** Compteurs de trophées vierges : un joueur qui s'assoit, ou un observateur qui reprend un siège. */
export const freshStats = (): PresidentStats => ({
  quads: 0,
  twos: 0,
  presidentRun: 0,
  bestPresidentRun: 0,
  ragsToRiches: 0,
});

export function createInitialState(roomCode: string, hostId: string, maxPlayers = 4): PresidentState {
  return {
    roomCode,
    hostId,
    maxPlayers,
    options: { xOuRien: true, manches: DEFAULT_MANCHES },
    players: [],
    phase: 'lobby',
    manche: 0,
    turn: 0,
    trick: [],
    lastPlayer: -1,
    forcedRank: null,
    lastTrick: [],
    finishOrder: [],
    exchanges: [],
    history: [],
    winner: null,
    lastEvent: { seq: 0, kind: 'none' },
    log: ['Room créée. En attente de joueurs...'],
  };
}

// --- Aides partagées avec l'IA et l'écran -----------------------------------------

/**
 * Les sièges encore en jeu dans la manche : connectés, pas sortis, des cartes
 * en main. Lu sur `handCount` et pas sur `hand` : l'écran appelle ces aides
 * sur un état masqué, où la main des autres est vide.
 */
export function activeSeats(state: PresidentState): number[] {
  const seats: number[] = [];
  state.players.forEach((p, i) => {
    if (p.connected && p.finishedAt === null && p.handCount > 0) seats.push(i);
  });
  return seats;
}

export function topPlay(state: PresidentState): PresidentPlay | null {
  return state.trick[state.trick.length - 1] ?? null;
}

/** Combien de cartes il faut poser. Null quand le pli est vide : on ouvre avec 1 à 4 cartes. */
export function requiredCount(state: PresidentState): number | null {
  return topPlay(state)?.cards.length ?? null;
}

/**
 * Pourquoi ces cartes ne peuvent pas être posées par ce siège maintenant, ou
 * null si la pose est légale. Le message est montré tel quel au joueur.
 */
export function canPlayCards(state: PresidentState, seat: number, cards: PresidentCard[]): string | null {
  if (state.phase === 'exchange') return 'Attends la fin des échanges.';
  if (state.phase !== 'playing') return "La partie n'est pas en cours.";
  const player = state.players[seat];
  if (!player) return 'Joueur inconnu.';
  if (state.turn !== seat) return "Ce n'est pas ton tour.";
  if (cards.length === 0) return 'Choisis au moins une carte.';
  if (cards.length > 4) return 'Pas plus de quatre cartes à la fois.';

  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length || cards.some((c) => !player.hand.some((h) => h.id === c.id))) {
    return 'Ces cartes ne sont pas dans ta main.';
  }
  const rank = cards[0].rank;
  if (cards.some((c) => c.rank !== rank)) return 'Les cartes posées doivent être de même valeur.';

  const top = topPlay(state);
  if (!top) return null;
  const count = top.cards.length;
  if (cards.length !== count) return `Il faut poser ${count} carte${count > 1 ? 's' : ''}, comme la pose précédente.`;
  if (rank < top.rank) return `Trop faible : il faut au moins ${describePlay(top.rank, count)}.`;
  // Après la force : un 5 sur un 7 est « trop faible », un 9 sous « 7 ou rien » ne l'est pas.
  if (state.forcedRank !== null && rank !== state.forcedRank) return `${RANK_NAME[state.forcedRank]} ou rien !`;
  return null;
}

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

/**
 * Toutes les poses légales du siège, de la plus faible à la plus forte. Une
 * seule combinaison par valeur et par nombre : les couleurs ne comptent pas,
 * donc deux paires de 7 différentes se valent.
 */
export function legalPlays(state: PresidentState, seat: number): PresidentCard[][] {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const player = state.players[seat];
  if (!player) return [];
  const top = topPlay(state);
  const plays: PresidentCard[][] = [];
  for (const group of groupsOf(player.hand)) {
    const rank = group[0].rank;
    if (!top) {
      for (let count = 1; count <= group.length; count++) plays.push(group.slice(0, count));
      continue;
    }
    if (rank < top.rank || group.length < top.cards.length) continue;
    if (state.forcedRank !== null && rank !== state.forcedRank) continue;
    plays.push(group.slice(0, top.cards.length));
  }
  return plays;
}

/** On peut toujours passer, sauf quand on ouvre le pli. */
export function canPass(state: PresidentState, seat: number): boolean {
  return state.phase === 'playing' && state.turn === seat && state.trick.length > 0;
}

/** Le rôle d'une place de sortie. Vice-président et Vice-trou n'existent qu'à partir de 4. */
export function roleOf(place: number, n: number): PresidentRole {
  if (place === 0) return 'president';
  if (place === n - 1) return 'trou';
  if (n >= 4 && place === 1) return 'vice-president';
  if (n >= 4 && place === n - 2) return 'vice-trou';
  return 'neutre';
}

export function rolesFor(n: number): PresidentRole[] {
  return Array.from({ length: n }, (_, place) => roleOf(place, n));
}

/** Le Président marque n - 1, le Trou du cul 0. */
export function pointsFor(place: number, n: number): number {
  return Math.max(0, n - 1 - place);
}

/**
 * Les sièges du meilleur au moins bon score. À égalité, la meilleure place de
 * la dernière manche jouée départage : il y a donc toujours un seul premier.
 * Une partie arrêtée avant la fin de la première manche (tout le monde est
 * parti) se départage sur les sorties de la manche en cours, puis au profit de
 * ceux qui sont restés.
 */
export function standings(state: PresidentState): number[] {
  const order = state.history[state.history.length - 1]?.order ?? state.finishOrder;
  const placeOf = (seat: number) => {
    const place = order.indexOf(seat);
    return place === -1 ? Number.MAX_SAFE_INTEGER : place;
  };
  return state.players
    .map((_, seat) => seat)
    .sort((a, b) => {
      const pa = state.players[a];
      const pb = state.players[b];
      return (
        pb.score - pa.score ||
        placeOf(a) - placeOf(b) ||
        Number(pb.connected) - Number(pa.connected) ||
        a - b
      );
    });
}

// --- Petites mécaniques internes ---------------------------------------------------

function bumpEvent(state: PresidentState, event: Omit<PresidentEvent, 'seq'>): PresidentState {
  return { ...state, lastEvent: { ...event, seq: state.lastEvent.seq + 1 } };
}

function withLog(state: PresidentState, ...lines: string[]): PresidentState {
  return { ...state, log: [...state.log, ...lines] };
}

function updatePlayer(
  state: PresidentState,
  seat: number,
  change: (p: PresidentPlayer) => PresidentPlayer,
): PresidentState {
  return { ...state, players: state.players.map((p, i) => (i === seat ? change(p) : p)) };
}

/** Change une main en gardant `handCount` collé à elle : le réseau masque l'une, jamais l'autre. */
function setHand(p: PresidentPlayer, hand: PresidentCard[]): PresidentPlayer {
  return { ...p, hand: sortHand(hand), handCount: hand.length };
}

function connectedCount(state: PresidentState): number {
  return state.players.filter((p) => p.connected).length;
}

/** Le prochain siège encore en jeu après `from`, dans l'ordre des sièges. -1 s'il n'y en a pas. */
function nextActive(state: PresidentState, from: number): number {
  const seats = activeSeats(state);
  const total = state.players.length;
  for (let step = 1; step <= total; step++) {
    const seat = (from + step) % total;
    if (seats.includes(seat)) return seat;
  }
  return -1;
}

/**
 * Le premier siège connecté à partir de `from` inclus : qui ouvre la donne quand
 * le Trou du cul est parti. `from` s'il n'y en a aucun.
 */
export function nextConnected(state: PresidentState, from: number): number {
  const total = state.players.length;
  for (let step = 0; step < total; step++) {
    const seat = (from + step) % total;
    if (state.players[seat]?.connected) return seat;
  }
  return from;
}

/** Qui rouvre après la fermeture : le dernier à avoir posé, ou le suivant en jeu s'il est sorti. */
function trickOpener(state: PresidentState): number {
  const winner = state.lastPlayer;
  if (activeSeats(state).includes(winner)) return winner;
  return nextActive(state, winner);
}

function placeLabel(place: number): string {
  return place === 0 ? '1re' : `${place + 1}e`;
}

/** Ferme le pli en cours et donne la main à `opener`. */
function closeTrick(state: PresidentState, reason: 'two' | 'quad' | 'passes', opener: number): PresidentState {
  const why =
    reason === 'two' ? 'Le 2 ferme le pli.' : reason === 'quad' ? 'Le carré ferme le pli.' : 'Tout le monde passe.';
  const name = state.players[opener]?.name ?? 'Personne';
  return withLog(
    {
      ...state,
      lastTrick: state.trick,
      trick: [],
      lastPlayer: -1,
      forcedRank: null,
      turn: opener,
      players: state.players.map((p) => (p.passed ? { ...p, passed: false } : p)),
    },
    `${why} ${name} ouvre le pli suivant.`,
  );
}

/**
 * Passe la main après une passe (ou le départ du joueur au tour) : soit tous
 * les autres ont passé depuis la dernière pose et le pli se ferme, soit le
 * prochain siège en jeu agit.
 */
function advance(state: PresidentState, from: number): PresidentState {
  const seats = activeSeats(state);
  if (seats.length <= 1) return finishManche(state);
  if (state.trick.length > 0) {
    const others = seats.filter((seat) => seat !== state.lastPlayer);
    if (others.every((seat) => state.players[seat].passed)) return closeTrick(state, 'passes', trickOpener(state));
  }
  return { ...state, turn: nextActive(state, from) };
}

/**
 * Termine la manche : le dernier joueur en jeu prend la place suivante, puis
 * ceux partis en cours de route, dans l'ordre des sièges. Rôles, points et
 * statistiques tombent ici, puis on enchaîne sur la manche suivante ou la fin.
 */
function finishManche(state: PresidentState): PresidentState {
  const total = state.players.length;
  const order = [...state.finishOrder];
  for (const seat of activeSeats(state)) if (!order.includes(seat)) order.push(seat);
  for (let seat = 0; seat < total; seat++) if (!order.includes(seat)) order.push(seat);

  const roles: PresidentRole[] = [];
  const points: number[] = [];
  const players = state.players.map((p, seat) => {
    const place = order.indexOf(seat);
    const role = roleOf(place, total);
    const gained = pointsFor(place, total);
    roles[seat] = role;
    points[seat] = gained;
    const isPresident = role === 'president';
    const presidentRun = isPresident ? p.stats.presidentRun + 1 : 0;
    return {
      ...p,
      finishedAt: place,
      passed: false,
      role,
      score: p.score + gained,
      stats: {
        ...p.stats,
        presidentRun,
        bestPresidentRun: Math.max(p.stats.bestPresidentRun, presidentRun),
        ragsToRiches: p.stats.ragsToRiches + (isPresident && p.role === 'trou' ? 1 : 0),
      },
    };
  });

  const president = players[order[0]];
  const trou = players[order[total - 1]];
  let next: PresidentState = {
    ...state,
    players,
    finishOrder: order,
    lastTrick: state.trick.length > 0 ? state.trick : state.lastTrick,
    trick: [],
    lastPlayer: -1,
    forcedRank: null,
    history: [...state.history, { manche: state.manche, order, roles, points }],
  };
  next = withLog(
    next,
    `Manche ${state.manche} terminée : ${president.name} est ${ROLE_LABEL.president}, ${trou.name} est ${ROLE_LABEL.trou}.`,
  );

  if (state.manche >= state.options.manches) return endGame(next);
  return { ...next, phase: 'manche-end' };
}

const NOT_ENOUGH = "Plus assez de joueurs : la partie s'arrête.";

/** Fin de partie : le meilleur score l'emporte, la dernière manche départage. */
function endGame(state: PresidentState, reason?: string): PresidentState {
  const winner = standings(state)[0] ?? null;
  const champion = winner === null ? null : state.players[winner];
  return withLog(
    {
      ...state,
      phase: 'over',
      winner,
      lastTrick: state.trick.length > 0 ? state.trick : state.lastTrick,
      trick: [],
      lastPlayer: -1,
      forcedRank: null,
    },
    ...(reason ? [reason] : []),
    champion ? `${champion.name} remporte la partie avec ${champion.score} point${champion.score > 1 ? 's' : ''} !` : 'Partie terminée.',
  );
}

/**
 * Bat, distribue et prépare les échanges d'une nouvelle manche.
 *
 * On ne distribue qu'aux joueurs connectés : un joueur parti ne jouera plus
 * ses cartes, les lui donner retirerait autant de cartes du jeu. À table
 * complète, c'est la donne classique, une à une à partir du siège 0.
 */
function dealManche(state: PresidentState, random: Random): PresidentState {
  const manche = state.manche + 1;
  const dealSeats = state.players.flatMap((p, seat) => (p.connected ? [seat] : []));
  const hands: PresidentCard[][] = state.players.map(() => []);
  shuffle(createDeck(), random).forEach((card, i) => hands[dealSeats[i % dealSeats.length]].push(card));

  let next: PresidentState = {
    ...state,
    manche,
    players: state.players.map((p, seat) => ({ ...setHand(p, hands[seat]), finishedAt: null, passed: false })),
    trick: [],
    lastPlayer: -1,
    forcedRank: null,
    lastTrick: [],
    finishOrder: [],
    exchanges: [],
    winner: null,
  };
  next = withLog(next, `Manche ${manche} sur ${state.options.manches} : les cartes sont distribuées.`);

  // Les échanges suivent les rôles de la manche précédente. Le moins bien
  // classé donne d'office ses meilleures cartes ; l'autre rend celles de son
  // choix pendant la phase d'échange.
  const total = state.players.length;
  const pairs: [PresidentRole, PresidentRole, number][] = [['trou', 'president', 2]];
  if (total >= 4) pairs.push(['vice-trou', 'vice-president', 1]);
  const exchanges: PresidentExchange[] = [];
  for (const [low, high, count] of pairs) {
    const from = next.players.findIndex((p) => p.role === low);
    const to = next.players.findIndex((p) => p.role === high);
    if (from === -1 || to === -1) continue;
    const giver = next.players[from];
    const taker = next.players[to];
    if (!giver.connected || !taker.connected) {
      // L'un des deux est parti : il n'a pas de cartes, l'échange n'a pas lieu.
      next = withLog(next, `Pas d'échange entre ${giver.name} et ${taker.name} : l'un des deux est parti.`);
      continue;
    }
    const best = giver.hand.slice(-count);
    next = moveCards(next, from, to, best);
    exchanges.push({ from, to, count, kind: 'best', cards: best, done: true });
    exchanges.push({ from: to, to: from, count, kind: 'choice', cards: [], done: false });
    next = withLog(
      next,
      count === 1
        ? `${giver.name} (${ROLE_LABEL[low]}) donne sa meilleure carte à ${taker.name} (${ROLE_LABEL[high]}).`
        : `${giver.name} (${ROLE_LABEL[low]}) donne ses ${count} meilleures cartes à ${taker.name} (${ROLE_LABEL[high]}).`,
    );
  }

  // Qui ouvre : la Dame de cœur en première manche, ensuite le Trou du cul.
  let opener: number;
  const trouSeat = next.players.findIndex((p) => p.role === 'trou');
  if (trouSeat === -1) {
    opener = next.players.findIndex((p) => p.hand.some((c) => c.id === OPENING_CARD_ID));
    next = withLog(next, `${next.players[opener].name} a la Dame de cœur et ouvre la manche.`);
  } else {
    opener = nextConnected(next, trouSeat);
    next = withLog(
      next,
      opener === trouSeat
        ? `${next.players[opener].name}, ${ROLE_LABEL.trou}, ouvre la manche.`
        : `${next.players[trouSeat].name} est parti : ${next.players[opener].name} ouvre la manche.`,
    );
  }

  const pending = exchanges.some((e) => !e.done);
  next = { ...next, exchanges, turn: opener, phase: pending ? 'exchange' : 'playing' };
  if (pending) next = withLog(next, 'Échange des cartes : chacun rend celles de son choix.');
  return bumpEvent(next, { kind: 'deal', by: opener });
}

function moveCards(state: PresidentState, from: number, to: number, cards: PresidentCard[]): PresidentState {
  const ids = new Set(cards.map((c) => c.id));
  return {
    ...state,
    players: state.players.map((p, seat) => {
      if (seat === from) return setHand(p, p.hand.filter((c) => !ids.has(c.id)));
      if (seat === to) return setHand(p, [...p.hand, ...cards]);
      return p;
    }),
  };
}

/** Rend les cartes d'un don au choix, et lance le jeu quand tous les dons sont faits. */
function completeGive(state: PresidentState, index: number, cards: PresidentCard[]): PresidentState {
  const exchange = state.exchanges[index];
  let next = moveCards(state, exchange.from, exchange.to, cards);
  next = {
    ...next,
    exchanges: next.exchanges.map((e, i) => (i === index ? { ...e, cards, done: true } : e)),
  };
  if (next.exchanges.every((e) => e.done)) {
    // L'ouvreur a pu partir pendant l'échange : la main va au suivant en jeu.
    const turn = activeSeats(next).includes(next.turn) ? next.turn : nextActive(next, next.turn);
    next = withLog({ ...next, phase: 'playing', turn }, `Les échanges sont faits : ${next.players[turn].name} ouvre.`);
  }
  return next;
}

function resetForGame(state: PresidentState): PresidentState {
  return {
    ...state,
    manche: 0,
    history: [],
    winner: null,
    players: state.players.map((p) => ({
      ...p,
      score: 0,
      role: null,
      finishedAt: null,
      passed: false,
      stats: freshStats(),
    })),
  };
}

// --- Actions -----------------------------------------------------------------------

export function addPlayer(state: PresidentState, id: string, name: string, userId: string | null = null): PresidentState {
  if (state.players.some((p) => p.id === id)) return state;
  if (state.phase !== 'lobby') return state;
  if (state.players.length >= state.maxPlayers) return state;

  const player: PresidentPlayer = {
    id,
    name: name.trim() || 'Joueur',
    userId,
    hand: [],
    handCount: 0,
    connected: true,
    score: 0,
    role: null,
    finishedAt: null,
    passed: false,
    stats: freshStats(),
  };
  return withLog({ ...state, players: [...state.players, player] }, `${player.name} a rejoint la partie.`);
}

export function setOptions(state: PresidentState, maxPlayers: number, xOuRien: boolean, manches: number): ActionResult {
  if (state.phase !== 'lobby') return { state, error: 'La partie a déjà commencé.' };
  if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return { state, error: `Le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}.` };
  }
  if (!MANCHE_CHOICES.includes(manches)) return { state, error: 'Choisis une partie en 3, 5 ou 7 manches.' };
  if (state.players.length > maxPlayers) {
    return { state, error: `Il y a déjà ${state.players.length} joueurs dans la room.` };
  }
  return { state: { ...state, maxPlayers, options: { xOuRien, manches } } };
}

export function startGame(state: PresidentState, random: Random = Math.random): ActionResult {
  if (state.phase !== 'lobby') return { state, error: 'La partie a déjà commencé.' };
  if (state.players.length < MIN_PLAYERS) return { state, error: `Il faut au moins ${MIN_PLAYERS} joueurs.` };
  if (state.players.length !== state.maxPlayers) {
    return { state, error: `Cette partie attend ${state.maxPlayers} joueurs.` };
  }
  const { manches } = state.options;
  const next = withLog(resetForGame(state), `Partie lancée à ${state.players.length} joueurs, en ${manches} manches.`);
  return { state: dealManche(next, random) };
}

/**
 * Une pose. Tout ce qu'elle déclenche se règle ici, dans l'ordre : fermeture
 * du pli (2 ou carré), sortie du joueur, fin de manche, fin de partie. Un seul
 * événement est émis, le plus important, mais le journal raconte tout.
 */
export function playCards(state: PresidentState, playerId: string, cardIds: string[]): ActionResult {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat === -1) return { state, error: 'Joueur inconnu.' };
  if (state.phase === 'exchange') return { state, error: 'Attends la fin des échanges.' };
  if (state.phase !== 'playing') return { state, error: "La partie n'est pas en cours." };
  if (state.turn !== seat) return { state, error: "Ce n'est pas ton tour." };

  const player = state.players[seat];
  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));
  if (cards.some((c) => !c) || new Set(cardIds).size !== cardIds.length) {
    return { state, error: 'Ces cartes ne sont pas dans ta main.' };
  }
  const chosen = cards as PresidentCard[];
  const error = canPlayCards(state, seat, chosen);
  if (error) return { state, error };

  const rank = chosen[0].rank;
  const count = chosen.length;
  const previous = topPlay(state);
  const closes = rank === TWO || count === 4;
  const ids = new Set(cardIds);
  const remaining = player.hand.filter((c) => !ids.has(c.id));

  let next: PresidentState = {
    ...state,
    trick: [...state.trick, { by: seat, cards: sortHand(chosen), rank }],
    lastPlayer: seat,
    forcedRank: null,
    // Une pose relance le pli : ceux qui avaient passé peuvent rejouer.
    players: state.players.map((p, i) => {
      const base = p.passed ? { ...p, passed: false } : p;
      if (i !== seat) return base;
      return {
        ...setHand(base, remaining),
        stats: {
          ...base.stats,
          quads: base.stats.quads + (count === 4 ? 1 : 0),
          twos: base.stats.twos + (rank === TWO ? 1 : 0),
        },
      };
    }),
  };
  next = withLog(next, `${player.name} pose ${describePlay(rank, count)}.`);
  const event: Omit<PresidentEvent, 'seq'> = { kind: 'play', by: seat, rank, count };

  if (remaining.length === 0) {
    const place = next.finishOrder.length;
    next = updatePlayer(next, seat, (p) => ({ ...p, finishedAt: place }));
    next = { ...next, finishOrder: [...next.finishOrder, seat] };
    const role = ROLE_LABEL[roleOf(place, next.players.length)];
    next = withLog(next, `${player.name} n'a plus de cartes : sorti en ${placeLabel(place)} place (${role}) !`);
    event.kind = 'out';
    event.place = place;
  }
  if (closes) {
    event.reason = count === 4 ? 'quad' : 'two';
    if (event.kind === 'play') event.kind = 'trick';
  }

  if (activeSeats(next).length <= 1) {
    next = finishManche(next);
    event.kind = next.phase === 'over' ? 'over' : 'manche-end';
    return { state: bumpEvent(next, event) };
  }

  if (closes) {
    next = closeTrick(next, count === 4 ? 'quad' : 'two', trickOpener(next));
    return { state: bumpEvent(next, event) };
  }

  // « X ou rien » : reposer la même valeur l'impose au joueur suivant.
  const turn = nextActive(next, seat);
  next = { ...next, turn };
  if (state.options.xOuRien && previous && previous.rank === rank) {
    next = withLog({ ...next, forcedRank: rank }, `${RANK_NAME[rank]} ou rien pour ${next.players[turn].name} !`);
  }
  return { state: bumpEvent(next, event) };
}

export function pass(state: PresidentState, playerId: string): ActionResult {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat === -1) return { state, error: 'Joueur inconnu.' };
  if (state.phase === 'exchange') return { state, error: 'Attends la fin des échanges.' };
  if (state.phase !== 'playing') return { state, error: "La partie n'est pas en cours." };
  if (state.turn !== seat) return { state, error: "Ce n'est pas ton tour." };
  if (state.trick.length === 0) return { state, error: 'Tu ouvres le pli : pose au moins une carte.' };

  const top = topPlay(state)!;
  let next = updatePlayer({ ...state, forcedRank: null }, seat, (p) => ({ ...p, passed: true }));
  next = withLog(next, `${state.players[seat].name} passe.`);
  next = advance(next, seat);
  if (next.trick.length === 0) {
    // Le pli s'est fermé sur cette passe : on annonce qui le remporte.
    return { state: bumpEvent(next, { kind: 'trick', by: top.by, rank: top.rank, count: top.cards.length, reason: 'passes' }) };
  }
  return { state: bumpEvent(next, { kind: 'pass', by: seat }) };
}

export function give(state: PresidentState, playerId: string, cardIds: string[]): ActionResult {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat === -1) return { state, error: 'Joueur inconnu.' };
  if (state.phase !== 'exchange') return { state, error: "Ce n'est pas le moment d'échanger." };
  const index = state.exchanges.findIndex((e) => e.from === seat && e.kind === 'choice');
  if (index === -1) return { state, error: "Tu n'as rien à donner." };
  const exchange = state.exchanges[index];
  if (exchange.done) return { state, error: 'Tu as déjà donné tes cartes.' };
  if (cardIds.length !== exchange.count || new Set(cardIds).size !== cardIds.length) {
    return { state, error: `Donne exactement ${exchange.count} carte${exchange.count > 1 ? 's' : ''}.` };
  }
  const hand = state.players[seat].hand;
  const cards = cardIds.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return { state, error: 'Ces cartes ne sont pas dans ta main.' };

  let next = withLog(
    state,
    `${state.players[seat].name} rend ${exchange.count === 1 ? 'une carte' : `${exchange.count} cartes`} à ${state.players[exchange.to].name}.`,
  );
  next = completeGive(next, index, cards as PresidentCard[]);
  return { state: bumpEvent(next, { kind: 'exchange', by: seat, count: exchange.count }) };
}

export function nextManche(state: PresidentState, random: Random = Math.random): ActionResult {
  if (state.phase !== 'manche-end') return { state, error: "La manche n'est pas terminée." };
  if (connectedCount(state) < 2) {
    return { state: bumpEvent(endGame(state, NOT_ENOUGH), { kind: 'over' }) };
  }
  return { state: dealManche(state, random) };
}

/** Repart à zéro avec les mêmes joueurs. `seq` et le journal continuent : la signature de partie change. */
export function rematch(state: PresidentState, random: Random = Math.random): ActionResult {
  if (state.phase !== 'over') return { state, error: "La partie n'est pas terminée." };
  if (connectedCount(state) < MIN_PLAYERS) {
    return { state, error: `Il faut au moins ${MIN_PLAYERS} joueurs connectés pour rejouer.` };
  }
  const next = withLog(resetForGame(state), 'Revanche ! Les scores repartent de zéro.');
  return { state: dealManche(next, random) };
}

/**
 * Un départ. Au salon, la place se libère. En partie, le joueur est sauté et
 * ne compte plus parmi ceux en jeu : la table ne l'attend jamais. Sous deux
 * joueurs connectés, il n'y a plus de partie possible : elle s'arrête au score.
 */
export function leave(state: PresidentState, playerId: string): ActionResult {
  if (state.phase === 'lobby') {
    if (!state.players.some((p) => p.id === playerId)) return { state };
    const name = state.players.find((p) => p.id === playerId)!.name;
    return { state: withLog({ ...state, players: state.players.filter((p) => p.id !== playerId) }, `${name} est parti.`) };
  }
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat === -1 || !state.players[seat].connected) return { state };

  let next = updatePlayer(state, seat, (p) => ({ ...p, connected: false, passed: false }));
  // Partie finie : on marque seulement le départ, sans ligne au journal ni
  // événement. La signature d'issue (presidentOutcome) est tirée de cet état :
  // si elle bougeait, ceux restés sur l'écran de fin calculeraient une
  // nouvelle clé de session et enregistreraient la même partie une deuxième
  // fois (victoire et FEES doublés). UNO ne journalise pas non plus ses départs.
  if (state.phase === 'over') return { state: next };
  next = withLog(next, `${state.players[seat].name} a quitté la partie.`);

  if (connectedCount(next) < 2) {
    return { state: bumpEvent(endGame(next, NOT_ENOUGH), { kind: 'over' }) };
  }
  if (state.phase === 'manche-end') return { state: next };

  if (state.phase === 'exchange') {
    // Un don au choix en attente ne doit pas bloquer la table : on rend
    // d'office les plus basses cartes du partant.
    const index = next.exchanges.findIndex((e) => e.from === seat && e.kind === 'choice' && !e.done);
    if (index !== -1) {
      const exchange = next.exchanges[index];
      const lowest = next.players[seat].hand.slice(0, exchange.count);
      // On nomme le receveur : une autre ligne peut s'intercaler avant celle-ci.
      const what = exchange.count === 1 ? 'Sa plus basse carte est rendue' : 'Ses plus basses cartes sont rendues';
      next = withLog(next, `${what} d'office à ${next.players[exchange.to].name}.`);
      next = completeGive(next, index, lowest);
      return { state: bumpEvent(next, { kind: 'exchange', by: seat, count: exchange.count }) };
    }
    if (next.turn === seat) next = { ...next, turn: nextActive(next, seat) };
    return { state: next };
  }

  // En jeu.
  if (activeSeats(next).length <= 1) {
    next = finishManche(next);
    return { state: bumpEvent(next, { kind: next.phase === 'over' ? 'over' : 'manche-end' }) };
  }
  if (state.turn !== seat) return { state: next };
  const top = topPlay(next);
  next = advance({ ...next, forcedRank: null }, seat);
  if (top && next.trick.length === 0) {
    return { state: bumpEvent(next, { kind: 'trick', by: top.by, rank: top.rank, count: top.cards.length, reason: 'passes' }) };
  }
  return { state: next };
}

export function applyAction(state: PresidentState, action: PresidentAction, random: Random = Math.random): ActionResult {
  switch (action.type) {
    case 'JOIN':
      return { state: addPlayer(state, action.playerId, action.name, action.userId ?? null) };
    case 'SET_OPTIONS':
      return setOptions(state, action.maxPlayers, action.xOuRien, action.manches);
    case 'START':
      return startGame(state, random);
    case 'PLAY':
      return playCards(state, action.playerId, action.cardIds);
    case 'PASS':
      return pass(state, action.playerId);
    case 'GIVE':
      return give(state, action.playerId, action.cardIds);
    case 'NEXT_MANCHE':
      return nextManche(state, random);
    case 'REMATCH':
      return rematch(state, random);
    case 'LEAVE':
      return leave(state, action.playerId);
    default:
      return { state };
  }
}
