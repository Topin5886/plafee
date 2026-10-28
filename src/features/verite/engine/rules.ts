import { BASE_QUESTIONS } from './questions';
import {
  THEMES,
  type ActionResult,
  type RoundRecord,
  type VeriteAction,
  type VeritePlayer,
  type VeriteQuestion,
  type VeriteRound,
  type VeriteState,
  type VeriteTheme,
} from './types';

/*
 * Le moteur de la Roulette de Vérité : du code pur, sans React ni réseau.
 *
 * Le hasard passe par une graine gardée dans l'état (mulberry32) plutôt que
 * par Math.random : à état égal, même bouteille et même question — ce qui
 * rend le moteur testable, et le hasard reste du côté de l'hôte, qui seul
 * connaît la graine.
 */

/** Participants au total, chef compris : 6 joueurs + 1 chef. */
export const MAX_PARTICIPANTS = 7;
/** Joueurs (hors chef) nécessaires pour lancer ou relancer la bouteille. */
export const MIN_PLAYERS = 2;
export const NAME_MAX = 18;
export const QUESTION_MIN = 5;
export const QUESTION_MAX = 200;
export const ANSWER_MAX = 500;
export const MAX_CUSTOMS = 40;
export const MAX_CUSTOMS_PER_PLAYER = 10;
/** Nombre de manches proposé à la création ; 0 = libre. */
export const ROUND_OPTIONS = [10, 20, 0] as const;

/** La bouteille tourne (~2,6 s), vacille, puis s'arrête. */
export const SPIN_MS = 3200;
/** La carte se retourne. */
export const FLIP_MS = 800;
/** Le temps de lire avant de pouvoir répondre. */
export const ANSWER_PAUSE_MS = 1500;

/**
 * Délai entre deux lettres de la machine à écrire : ~100 ms, accéléré pour
 * les longues questions afin que la frappe ne dépasse pas 4,5 s.
 */
export function typeDelay(text: string): number {
  const len = Math.max(1, [...text].length);
  return Math.max(35, Math.min(100, Math.round(4500 / len)));
}

/** De la carte face cachée à la saisie possible : retournement, frappe, pause. */
export function revealDuration(text: string): number {
  return FLIP_MS + [...text].length * typeDelay(text) + ANSWER_PAUSE_MS;
}

/** Les thèmes que la pioche peut sortir, selon le thème de la partie. */
export function playableThemes(theme: VeriteTheme): VeriteTheme[] {
  if (theme === 'clean') return ['clean'];
  if (theme === 'normal') return ['clean', 'normal'];
  return ['hard'];
}

// --- Hasard ------------------------------------------------------------------

function makeRng(seed: number) {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get seed() {
      return s;
    },
  };
}

type Rng = ReturnType<typeof makeRng>;

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Applique `fn` avec un tirage issu de la graine, et range la graine avancée. */
function withRng(state: VeriteState, fn: (rng: Rng) => VeriteState): VeriteState {
  const rng = makeRng(state.seed);
  const next = fn(rng);
  return { ...next, seed: rng.seed };
}

// --- État initial ------------------------------------------------------------

const emptyDecks = (): Record<VeriteTheme, VeriteQuestion[]> => ({ clean: [], normal: [], hard: [] });

export function createInitialState(roomCode: string, hostId: string, seed = 1): VeriteState {
  return {
    roomCode,
    hostId,
    maxPlayers: MAX_PARTICIPANTS,
    phase: 'lobby',
    theme: 'clean',
    rounds: 10,
    chefId: null,
    players: [],
    customs: [],
    publicPool: [],
    decks: emptyDecks(),
    seed: seed >>> 0 || 1,
    round: null,
    history: [],
    gameNo: 0,
    completed: false,
  };
}

// --- Lectures ----------------------------------------------------------------

export function findPlayer(state: VeriteState, id: string | null | undefined): VeritePlayer | undefined {
  return id ? state.players.find((p) => p.id === id) : undefined;
}

/** Ceux que la bouteille peut désigner : présents, et pas le chef. */
export function eligiblePlayers(state: VeriteState): VeritePlayer[] {
  return state.players.filter((p) => p.connected && p.id !== state.chefId);
}

export function chefPresent(state: VeriteState): boolean {
  return Boolean(findPlayer(state, state.chefId)?.connected);
}

/** Peut arbitrer : le chef — ou l'hôte, le temps que le chef revienne ou soit remplacé. */
export function canReferee(state: VeriteState, playerId: string): boolean {
  if (playerId === state.chefId) return true;
  return playerId === state.hostId && !chefPresent(state);
}

export function isLastRound(state: VeriteState): boolean {
  return state.rounds > 0 && (state.round?.seq ?? 0) >= state.rounds;
}

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

// --- Pioche ------------------------------------------------------------------

/**
 * Une pioche neuve pour un thème. Les questions perso de la partie sont
 * glissées dans les premières cartes : on les a ajoutées pour qu'elles sortent.
 */
function buildDeck(state: VeriteState, theme: VeriteTheme, rng: Rng, avoidId?: string): VeriteQuestion[] {
  const own = state.customs.filter((q) => q.theme === theme && q.id !== avoidId);
  const pool = [...BASE_QUESTIONS[theme], ...state.publicPool.filter((q) => q.theme === theme)].filter(
    (q) => q.id !== avoidId && !own.some((o) => o.id === q.id),
  );
  const deck = shuffle(pool, rng);
  const horizon = Math.max(state.rounds || 12, 8);
  for (const q of shuffle(own, rng)) {
    deck.splice(Math.floor(rng.next() * Math.min(deck.length + 1, horizon)), 0, q);
  }
  return deck;
}

function drawQuestion(
  state: VeriteState,
  theme: VeriteTheme,
  rng: Rng,
  avoidId?: string,
): { question: VeriteQuestion; decks: VeriteState['decks'] } {
  let deck = state.decks[theme].filter((q) => q.id !== avoidId);
  if (!deck.length) deck = buildDeck(state, theme, rng, avoidId);
  const [question, ...rest] = deck;
  return { question, decks: { ...state.decks, [theme]: rest } };
}

/**
 * Le thème de la manche `seq`.
 *
 * En NORMAL, la partie reste légère avec « 2-3 questions qui piquent » : une
 * par tranche de quatre manches, placée au hasard dans la tranche. Chaque
 * manche de la tranche a une chance sur (manches restantes) d'être la bonne,
 * ce qui garantit exactement une question piquante par tranche.
 */
function themeForRound(state: VeriteState, seq: number, rng: Rng): VeriteTheme {
  if (state.theme !== 'normal') return state.theme;
  const block = Math.floor((seq - 1) / 4);
  const pos = (seq - 1) % 4;
  const done = state.history.some((h) => Math.floor((h.seq - 1) / 4) === block && h.theme === 'normal');
  if (done) return 'clean';
  return rng.next() < 1 / (4 - pos) ? 'normal' : 'clean';
}

// --- La bouteille ------------------------------------------------------------

/**
 * Qui la bouteille désigne. Pour que chacun y passe, elle s'arrête sur l'un
 * de ceux qui ont le moins répondu — jamais deux fois de suite sur le même
 * quand quelqu'un d'autre est possible.
 */
function pickTarget(state: VeriteState, rng: Rng): VeritePlayer {
  const eligible = eligiblePlayers(state);
  const least = Math.min(...eligible.map((p) => p.turns));
  let candidates = eligible.filter((p) => p.turns === least);
  const last = state.round?.targetId;
  if (candidates.length > 1) candidates = candidates.filter((p) => p.id !== last);
  if (!candidates.length) candidates = eligible.filter((p) => p.id !== last);
  if (!candidates.length) candidates = eligible;
  return candidates[Math.floor(rng.next() * candidates.length)];
}

/**
 * L'angle d'arrivée de la bouteille : 3 ou 4 tours complets depuis sa
 * position actuelle, puis la place du joueur sur le cercle (le premier en
 * haut, dans le sens des aiguilles d'une montre), à un léger écart près.
 */
function spinAngle(previous: number, index: number, count: number, rng: Rng): number {
  const step = 360 / count;
  // Un léger écart, pour le naturel, mais la bouteille doit viser franchement.
  const jitter = (rng.next() - 0.5) * Math.min(step * 0.25, 24);
  const current = ((previous % 360) + 360) % 360;
  const delta = (((index * step + jitter - current) % 360) + 360) % 360;
  const turns = 3 + Math.floor(rng.next() * 2);
  return Math.round((previous + turns * 360 + delta) * 10) / 10;
}

function spin(state: VeriteState, rng: Rng): VeriteState {
  const target = pickTarget(state, rng);
  const ring = eligiblePlayers(state).map((p) => p.id);
  const seq = (state.round?.seq ?? 0) + 1;
  const { question, decks } = drawQuestion(state, themeForRound(state, seq, rng), rng);
  const round: VeriteRound = {
    seq,
    draw: 0,
    targetId: target.id,
    ring,
    angle: spinAngle(state.round?.angle ?? 0, ring.indexOf(target.id), ring.length, rng),
    question,
    stage: 'spinning',
    answer: null,
    verdict: null,
    voided: false,
    skipped: false,
  };
  return {
    ...state,
    decks,
    round,
    players: state.players.map((p) => (p.id === target.id ? { ...p, turns: p.turns + 1 } : p)),
  };
}

function record(state: VeriteState, round: VeriteRound): RoundRecord {
  return {
    seq: round.seq,
    targetId: round.targetId,
    targetName: findPlayer(state, round.targetId)?.name ?? '?',
    question: round.question.text,
    theme: round.question.theme,
    answer: round.answer,
    verdict: round.verdict,
    skipped: round.skipped,
    questionBy: round.question.byId ?? null,
  };
}

/** La manche s'arrête sans verdict : le joueur désigné est parti. */
function voidRound(state: VeriteState): VeriteState {
  const round = state.round;
  if (!round || round.stage === 'verdict') return state;
  const voided: VeriteRound = { ...round, stage: 'verdict', verdict: null, voided: true };
  return { ...state, round: voided, history: [...state.history, record(state, voided)] };
}

// --- Actions -----------------------------------------------------------------

const fail = (state: VeriteState, error: string): ActionResult => ({ state, error });

function join(state: VeriteState, playerId: string, rawName: string, userId: string | null): ActionResult {
  const name = cleanText(rawName, NAME_MAX) || 'Joueur';
  const existing = findPlayer(state, playerId);
  if (existing) {
    return {
      state: { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, name, userId, connected: true } : p)) },
    };
  }

  // Revenu après une coupure : même pseudo, même siège, même score.
  const back = state.players.find((p) => !p.connected && p.name.toLowerCase() === name.toLowerCase());
  if (back) {
    const swap = (id: string) => (id === back.id ? playerId : id);
    return {
      state: {
        ...state,
        chefId: state.chefId && swap(state.chefId),
        players: state.players.map((p) => (p.id === back.id ? { ...p, id: playerId, userId, connected: true } : p)),
        round: state.round && { ...state.round, targetId: swap(state.round.targetId), ring: state.round.ring.map(swap) },
      },
    };
  }

  if (state.players.length >= state.maxPlayers) {
    return fail(state, `La table est complète (${state.maxPlayers} personnes maximum).`);
  }

  // Arrivé en cours de partie : il entre dans la rotation sans être désigné
  // à toutes les manches suivantes pour rattraper son retard.
  const eligible = eligiblePlayers(state);
  const turns = state.phase === 'lobby' || !eligible.length ? 0 : Math.min(...eligible.map((p) => p.turns));
  return {
    state: { ...state, players: [...state.players, { id: playerId, name, userId, connected: true, score: 0, turns }] },
  };
}

function leave(state: VeriteState, playerId: string): ActionResult {
  if (!findPlayer(state, playerId)) return { state };
  if (state.phase === 'lobby') {
    return {
      state: {
        ...state,
        chefId: state.chefId === playerId ? null : state.chefId,
        players: state.players.filter((p) => p.id !== playerId),
        customs: state.customs.filter((q) => q.byId !== playerId || q.source === 'public'),
      },
    };
  }
  let next: VeriteState = {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p)),
  };
  if (state.round?.targetId === playerId) next = voidRound(next);
  return { state: next };
}

function setChef(state: VeriteState, actorId: string, chefId: string): ActionResult {
  const target = findPlayer(state, chefId);
  if (!target?.connected) return fail(state, 'Ce joueur n’est plus à la table.');
  const vacant = !chefPresent(state);
  const allowed = actorId === state.hostId || actorId === state.chefId || (vacant && actorId === chefId);
  if (!allowed) return fail(state, 'Seul l’hôte ou le chef peut désigner le chef du jeu.');
  const round = state.round;
  if (state.phase === 'playing' && round && round.stage !== 'verdict' && round.targetId === chefId) {
    return fail(state, 'Pas pendant sa propre manche : attends le verdict.');
  }
  return { state: { ...state, chefId } };
}

function addCustom(
  state: VeriteState,
  actorId: string,
  rawText: string,
  theme: VeriteTheme,
  publicId: string | undefined,
): ActionResult {
  const author = findPlayer(state, actorId);
  if (!author) return fail(state, 'Rejoins la table pour ajouter une question.');
  if (!THEMES.includes(theme)) return fail(state, 'Thème inconnu.');
  const text = cleanText(rawText, QUESTION_MAX + 1);
  if (text.length < QUESTION_MIN) return fail(state, `Une question fait au moins ${QUESTION_MIN} caractères.`);
  if (text.length > QUESTION_MAX) return fail(state, `Une question fait au plus ${QUESTION_MAX} caractères.`);
  if (state.phase === 'ended') return fail(state, 'La partie est terminée.');
  if (state.customs.length >= MAX_CUSTOMS) return fail(state, 'La partie a déjà assez de questions perso.');
  if (state.customs.filter((q) => q.byId === actorId).length >= MAX_CUSTOMS_PER_PLAYER) {
    return fail(state, `${MAX_CUSTOMS_PER_PLAYER} questions perso par joueur, maximum.`);
  }
  if (state.customs.some((q) => q.text.toLowerCase() === text.toLowerCase())) {
    return fail(state, 'Cette question est déjà dans la partie.');
  }

  return {
    state: withRng(state, (rng) => {
      const question: VeriteQuestion = {
        id: publicId ? `pub-${publicId}` : `c-${Math.floor(rng.next() * 2 ** 32).toString(36)}`,
        text,
        theme,
        source: publicId ? 'public' : 'private',
        byId: actorId,
        byName: author.name,
      };
      let decks = state.decks;
      // En cours de partie, elle sort dans les toutes prochaines manches de son thème.
      if (state.phase === 'playing' && playableThemes(state.theme).includes(theme)) {
        const deck = [...decks[theme]];
        deck.splice(Math.floor(rng.next() * Math.min(deck.length + 1, 3)), 0, question);
        decks = { ...decks, [theme]: deck };
      }
      return { ...state, customs: [...state.customs, question], decks };
    }),
  };
}

function start(state: VeriteState, actorId: string, publicPool: VeriteQuestion[]): ActionResult {
  if (actorId !== state.hostId) return fail(state, 'Seul l’hôte lance la partie.');
  if (state.phase !== 'lobby') return fail(state, 'La partie a déjà commencé.');
  if (!chefPresent(state)) return fail(state, 'Désigne d’abord le chef du jeu.');
  if (eligiblePlayers(state).length < MIN_PLAYERS) {
    return fail(state, `Il faut au moins ${MIN_PLAYERS} joueurs en plus du chef.`);
  }
  const pool = publicPool
    .filter((q) => THEMES.includes(q.theme) && q.text.trim().length >= QUESTION_MIN)
    .map((q) => ({ ...q, source: 'public' as const, text: cleanText(q.text, QUESTION_MAX) }));
  const ready: VeriteState = {
    ...state,
    phase: 'playing',
    publicPool: pool,
    decks: emptyDecks(),
    round: null,
    history: [],
    gameNo: state.gameNo + 1,
    completed: false,
    players: state.players.map((p) => ({ ...p, score: 0, turns: 0 })),
  };
  return { state: withRng(ready, (rng) => spin(ready, rng)) };
}

export function applyAction(state: VeriteState, action: VeriteAction): ActionResult {
  switch (action.type) {
    case 'JOIN':
      return join(state, action.playerId, action.name, action.userId ?? null);

    case 'LEAVE':
      return leave(state, action.playerId);

    case 'SET_OPTIONS': {
      if (action.playerId !== state.hostId) return fail(state, 'Seul l’hôte choisit les options.');
      if (state.phase !== 'lobby') return fail(state, 'Les options se choisissent avant la partie.');
      if (!THEMES.includes(action.theme)) return fail(state, 'Thème inconnu.');
      const rounds = Math.max(0, Math.min(50, Math.floor(action.rounds) || 0));
      return { state: { ...state, theme: action.theme, rounds } };
    }

    case 'SET_CHEF':
      return setChef(state, action.playerId, action.chefId);

    case 'RANDOM_CHEF': {
      if (action.playerId !== state.hostId) return fail(state, 'Seul l’hôte tire le chef au sort.');
      if (state.phase !== 'lobby') return fail(state, 'Le tirage du chef se fait avant la partie.');
      const present = state.players.filter((p) => p.connected);
      if (!present.length) return { state };
      return {
        state: withRng(state, (rng) => ({ ...state, chefId: present[Math.floor(rng.next() * present.length)].id })),
      };
    }

    case 'ADD_CUSTOM':
      return addCustom(state, action.playerId, action.text, action.theme, action.publicId);

    case 'REMOVE_CUSTOM': {
      if (state.phase !== 'lobby') return fail(state, 'Les questions se retirent avant la partie.');
      const q = state.customs.find((c) => c.id === action.questionId);
      if (!q) return { state };
      if (q.byId !== action.playerId && action.playerId !== state.hostId) {
        return fail(state, 'Tu ne peux retirer que tes propres questions.');
      }
      return { state: { ...state, customs: state.customs.filter((c) => c.id !== q.id) } };
    }

    case 'START':
      return start(state, action.playerId, action.publicPool ?? []);

    case 'ADVANCE': {
      const round = state.round;
      // Une minuterie en retard (question changée, manche suivante) ne fait rien.
      if (state.phase !== 'playing' || !round || round.seq !== action.seq || round.draw !== action.draw) {
        return { state };
      }
      const from = action.to === 'reveal' ? 'spinning' : 'reveal';
      if (round.stage !== from) return { state };
      return { state: { ...state, round: { ...round, stage: action.to } } };
    }

    case 'ANSWER': {
      const round = state.round;
      if (state.phase !== 'playing' || !round) return fail(state, 'Aucune question en cours.');
      if (round.targetId !== action.playerId) return fail(state, 'Ce n’est pas à toi de répondre.');
      if (round.stage !== 'answering') return fail(state, 'Attends la fin de la question.');
      const text = cleanText(action.text, ANSWER_MAX);
      if (!text) return fail(state, 'Ta réponse est vide.');
      return { state: { ...state, round: { ...round, answer: text, stage: 'judging' } } };
    }

    case 'SKIP': {
      const round = state.round;
      if (state.phase !== 'playing' || !round) return fail(state, 'Aucune question en cours.');
      if (round.targetId !== action.playerId) return fail(state, 'Ce n’est pas ta question.');
      if (round.stage !== 'answering') return fail(state, 'Attends la fin de la question.');
      const skipped: VeriteRound = { ...round, stage: 'verdict', answer: null, verdict: false, skipped: true };
      return { state: { ...state, round: skipped, history: [...state.history, record(state, skipped)] } };
    }

    case 'VERDICT': {
      const round = state.round;
      if (!canReferee(state, action.playerId)) return fail(state, 'Seul le chef du jeu valide les réponses.');
      if (state.phase !== 'playing' || !round || round.stage !== 'judging') return fail(state, 'Rien à valider.');
      const judged: VeriteRound = { ...round, verdict: action.valid, stage: 'verdict' };
      const next: VeriteState = {
        ...state,
        round: judged,
        players: state.players.map((p) =>
          p.id === round.targetId && action.valid ? { ...p, score: p.score + 1 } : p,
        ),
      };
      return { state: { ...next, history: [...state.history, record(next, judged)] } };
    }

    case 'REDRAW': {
      const round = state.round;
      if (!canReferee(state, action.playerId)) return fail(state, 'Seul le chef du jeu change la question.');
      if (state.phase !== 'playing' || !round || (round.stage !== 'reveal' && round.stage !== 'answering')) {
        return fail(state, 'On ne peut plus changer cette question.');
      }
      return {
        state: withRng(state, (rng) => {
          const { question, decks } = drawQuestion(state, round.question.theme, rng, round.question.id);
          return { ...state, decks, round: { ...round, question, draw: round.draw + 1, stage: 'reveal', answer: null } };
        }),
      };
    }

    case 'SPIN': {
      if (!canReferee(state, action.playerId)) return fail(state, 'C’est le chef du jeu qui lance la bouteille.');
      if (state.phase !== 'playing') return fail(state, 'La partie n’est pas en cours.');
      if (state.round && state.round.stage !== 'verdict') return fail(state, 'La manche n’est pas terminée.');
      if (isLastRound(state)) return { state: { ...state, phase: 'ended', completed: true } };
      if (eligiblePlayers(state).length < MIN_PLAYERS) {
        return fail(state, `Il faut au moins ${MIN_PLAYERS} joueurs en plus du chef.`);
      }
      return { state: withRng(state, (rng) => spin(state, rng)) };
    }

    case 'END': {
      if (!canReferee(state, action.playerId) && action.playerId !== state.hostId) {
        return fail(state, 'Seul le chef ou l’hôte peut arrêter la partie.');
      }
      if (state.phase !== 'playing') return fail(state, 'La partie n’est pas en cours.');
      return { state: { ...state, phase: 'ended' } };
    }

    case 'REMATCH': {
      if (action.playerId !== state.hostId) return fail(state, 'Seul l’hôte relance une partie.');
      if (state.phase !== 'ended') return fail(state, 'La partie n’est pas terminée.');
      const players = state.players.filter((p) => p.connected).map((p) => ({ ...p, score: 0, turns: 0 }));
      return {
        state: {
          ...state,
          phase: 'lobby',
          chefId: players.some((p) => p.id === state.chefId) ? state.chefId : null,
          players,
          decks: emptyDecks(),
          publicPool: [],
          round: null,
          history: [],
          completed: false,
        },
      };
    }

    default:
      return { state };
  }
}

/**
 * Ce qu'un participant reçoit : ni la pioche, ni la graine (qui la
 * prédirait), ni le texte des questions perso des autres — et la question de
 * la manche seulement une fois la bouteille arrêtée.
 */
export function maskState(state: VeriteState, viewerId: string): VeriteState {
  const round = state.round;
  return {
    ...state,
    seed: 0,
    decks: emptyDecks(),
    publicPool: [],
    customs: state.customs.map((q) => (q.byId === viewerId ? q : { ...q, text: '' })),
    round:
      round && round.stage === 'spinning' ? { ...round, question: { ...round.question, text: '' } } : round,
  };
}

/** Classement final : score décroissant, puis ordre d'arrivée. */
export function standings(state: VeriteState): VeritePlayer[] {
  return state.players
    .filter((p) => p.id !== state.chefId)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
    .map(({ p }) => p);
}
