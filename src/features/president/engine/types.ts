/*
 * Le Président : les types partagés par le moteur, le réseau, l'IA et l'écran.
 *
 * Les valeurs vont de 3 à 15 pour se comparer directement : 11 = Valet,
 * 12 = Dame, 13 = Roi, 14 = As, 15 = le 2, la plus forte carte.
 */

export type PresidentSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export interface PresidentCard {
  id: string;
  /** 3 à 15. Les couleurs ne départagent jamais rien. */
  rank: number;
  suit: PresidentSuit;
}

/** Du sommet à la base. Le Vice-président et le Vice-trou n'existent qu'à partir de 4 joueurs. */
export type PresidentRole = 'president' | 'vice-president' | 'neutre' | 'vice-trou' | 'trou';

export interface PresidentStats {
  /** Carrés posés d'un coup (quatre cartes de même valeur). */
  quads: number;
  /** Plis fermés en posant un ou plusieurs 2. */
  twos: number;
  /** Manches d'affilée terminées Président, en cours. */
  presidentRun: number;
  /** La plus longue série de manches Président de la partie. */
  bestPresidentRun: number;
  /** Manches finies Président juste après une manche finie Trou du cul. */
  ragsToRiches: number;
}

export interface PresidentPlayer {
  id: string;
  name: string;
  /** Le compte du joueur, pour ses cosmétiques (absent : invité ou bot). */
  userId?: string | null;
  hand: PresidentCard[];
  /** Tenu à jour avec `hand.length`, même quand `hand` est masquée pour les autres. */
  handCount: number;
  connected: boolean;
  /** Points cumulés sur la partie. */
  score: number;
  /** Rôle gagné à la manche précédente : il décide des échanges. Null en première manche. */
  role: PresidentRole | null;
  /** Place de sortie dans la manche en cours (0 = premier sorti), null tant qu'il joue. */
  finishedAt: number | null;
  /** A passé depuis la dernière pose du pli en cours (remis à faux à chaque pose). */
  passed: boolean;
  stats: PresidentStats;
}

/** Une pose : 1 à 4 cartes de même valeur. */
export interface PresidentPlay {
  by: number;
  cards: PresidentCard[];
  rank: number;
}

/**
 * Un échange de début de manche. Les cartes ne sont montrées qu'aux deux
 * joueurs concernés : le réseau les vide pour tous les autres.
 *
 * `best` : le Trou du cul (ou le Vice-trou) donne d'office ses meilleures
 * cartes — fait dès la donne. `choice` : le Président (ou le Vice-président)
 * rend des cartes de son choix — attendu pendant la phase `exchange`.
 */
export interface PresidentExchange {
  from: number;
  to: number;
  count: number;
  kind: 'best' | 'choice';
  cards: PresidentCard[];
  done: boolean;
}

export interface PresidentMancheResult {
  manche: number;
  /** Sièges dans l'ordre de sortie, du Président au Trou du cul. */
  order: number[];
  /** Rôle obtenu, par siège. */
  roles: PresidentRole[];
  /** Points marqués dans la manche, par siège. */
  points: number[];
}

export interface PresidentOptions {
  /** « X ou rien » : rejouer la même valeur impose cette valeur au suivant. */
  xOuRien: boolean;
  /** Nombre de manches de la partie. */
  manches: number;
}

export type PresidentPhase = 'lobby' | 'exchange' | 'playing' | 'manche-end' | 'over';

/**
 * Ce qui vient de se passer, pour animer et annoncer. Numéroté parce que le
 * même événement peut se répéter (deux passes de suite).
 */
export interface PresidentEvent {
  seq: number;
  kind: 'none' | 'deal' | 'play' | 'pass' | 'trick' | 'out' | 'exchange' | 'manche-end' | 'over';
  by?: number;
  rank?: number;
  count?: number;
  /** Pour `trick` : pourquoi le pli s'est fermé. */
  reason?: 'two' | 'quad' | 'passes';
  /** Pour `out` : la place de sortie (0 = Président). */
  place?: number;
}

export interface PresidentState {
  roomCode: string;
  hostId: string;
  maxPlayers: number;
  options: PresidentOptions;
  players: PresidentPlayer[];
  phase: PresidentPhase;
  /** Numéro de la manche en cours, à partir de 1 (0 au salon). */
  manche: number;
  /** Le siège qui doit agir. */
  turn: number;
  /** Les poses du pli en cours, la dernière en fin de tableau. Vide : le joueur au tour ouvre. */
  trick: PresidentPlay[];
  /** Le siège qui a posé en dernier dans le pli en cours (-1 si le pli est vide). Peut être sorti. */
  lastPlayer: number;
  /** « X ou rien » : la seule valeur que le joueur au tour peut poser, sinon null. */
  forcedRank: number | null;
  /** Le dernier pli fermé, pour que l'écran le laisse voir un instant. */
  lastTrick: PresidentPlay[];
  /** Sièges sortis dans la manche en cours, dans l'ordre. */
  finishOrder: number[];
  exchanges: PresidentExchange[];
  history: PresidentMancheResult[];
  winner: number | null;
  lastEvent: PresidentEvent;
  log: string[];
}

export type PresidentAction =
  | { type: 'JOIN'; playerId: string; name: string; userId?: string | null }
  | { type: 'SET_OPTIONS'; maxPlayers: number; xOuRien: boolean; manches: number }
  | { type: 'START' }
  | { type: 'PLAY'; playerId: string; cardIds: string[] }
  | { type: 'PASS'; playerId: string }
  | { type: 'GIVE'; playerId: string; cardIds: string[] }
  | { type: 'NEXT_MANCHE' }
  | { type: 'REMATCH' }
  | { type: 'LEAVE'; playerId: string };
