import { getSupabase } from '../../lib/supabase';
import type { GameTypeId, RecordedGame } from './types';

/*
 * Rattacher quatre joueurs à une même partie, sans serveur.
 *
 * Personne n'arbitre : chaque client connecté écrit sa propre ligne de
 * résultat. Pour que ces lignes se retrouvent groupées sur *une* partie, il
 * faut que tous les pairs calculent la même clé — et qu'ils la calculent
 * différemment pour la revanche jouée dans la même room, sinon la seconde
 * manche serait avalée par l'idempotence de la première.
 *
 * D'où `signature` : une empreinte de l'état final que le moteur de jeu
 * fournit, faite de valeurs que tous les pairs voient à l'identique. Le
 * masquage réseau ne cache que les mains des joueurs, jamais le déroulé ni le
 * score, donc l'issue d'une partie est bien une donnée partagée.
 */

export interface GameOutcome {
  gameType: GameTypeId;
  roomCode: string;
  playerCount: number;
  won: boolean;
  /** Score affiché dans le jeu. Informatif : il ne pèse sur aucun classement. */
  score: number;
  durationSeconds?: number;
  /**
   * Ce qui distingue cette manche de toutes les autres jouées dans la même
   * room. Doit être identique chez tous les pairs et changer à la revanche —
   * en pratique : les scores finaux, le nombre de coups joués, le numéro de
   * manche. Voir les appelants dans chaque jeu.
   */
  signature: string;
  /** Compteurs propres au jeu, pour les trophées (scopas, cartes spéciales…). */
  details?: Record<string, number>;
  /**
   * Les comptes gagnants, tels que ce joueur les voit — lui compris s'il a
   * gagné. C'est ce qui permet aux perdants de confirmer une victoire : la
   * base ne paie un gagnant que si un adversaire le nomme aussi. Les invités
   * et les bots n'ont pas de compte, ils n'y figurent pas.
   */
  winners: string[];
  /** Roulette de Vérité : le compte du chef, quand la partie a été menée au bout. */
  chef?: string | null;
  /** Une table locale contre des bots : personne ne peut la confirmer. */
  vsBots: boolean;
}

/**
 * FNV-1a 32 bits, appliqué deux fois avec des amorces différentes.
 *
 * Un hachage suffit ici : la clé sert à regrouper et à dédoublonner, pas à
 * protéger quoi que ce soit. Elle est calculée de façon synchrone et
 * identique partout, ce que `crypto.subtle` — asynchrone — compliquerait pour
 * rien. Deux passes portent la clé à 64 bits, de quoi rendre une collision
 * entre deux manches d'une même room négligeable.
 */
function fingerprint(input: string): string {
  const pass = (seed: number) => {
    let h = seed;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  };
  return `${pass(0x811c9dc5)}${pass(0x9dc5811c)}`;
}

/** La clé partagée d'une partie. Même entrée chez tous les pairs, même sortie. */
export function sessionKeyFor(outcome: GameOutcome): string {
  const room = outcome.roomCode.trim().toUpperCase() || 'SOLO';
  return `${outcome.gameType}:${room}:${fingerprint(`${outcome.gameType}|${room}|${outcome.signature}`)}`;
}

/**
 * Enregistre le résultat du joueur courant.
 *
 * Les points ne sont pas transmis : ils sont calculés en base, où un client
 * modifié ne peut pas les atteindre. Une victoire n'y est acquise qu'une fois
 * confirmée par un adversaire (migration 0014) : d'où `status`.
 */
export async function recordGame(outcome: GameOutcome): Promise<RecordedGame> {
  const { data, error } = await (await getSupabase())
    .rpc('record_game_result', {
      p_session_key: sessionKeyFor(outcome),
      p_game_type: outcome.gameType,
      p_room_code: outcome.roomCode.trim().toUpperCase() || null,
      p_player_count: outcome.playerCount,
      p_won: outcome.won,
      p_score: Math.trunc(outcome.score) || 0,
      p_duration_seconds: outcome.durationSeconds ? Math.trunc(outcome.durationSeconds) : null,
      p_details: outcome.details ?? {},
      p_winners: outcome.winners,
      p_chef: outcome.chef ?? null,
      p_vs_bots: outcome.vsBots,
    })
    .single<RecordedGame>();

  if (error) throw new Error(error.message);
  return data;
}
