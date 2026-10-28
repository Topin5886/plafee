import type { GameTypeId } from '../account/types';

/*
 * Ouvrir une room depuis l'extérieur d'un jeu.
 *
 * Chaque salon génère son propre code, mais toutes les rooms savent démarrer
 * avec `{ isHost, name }` pour seul état de navigation — le reste (nombre de
 * joueurs, mode) a une valeur par défaut. C'est ce qui permet de défier un ami
 * en un clic depuis sa liste d'amis, sans passer par le salon du jeu. Seul le
 * nombre de places mérite d'être transmis, là où le défaut ne convient pas
 * (`fewestPlayers`).
 */

export const INVITABLE_GAMES: GameTypeId[] = ['scopa', 'uno', 'president', 'puissance4', 'puissance4-original', 'flip7', 'verite'];

/** Combien de joueurs chaque jeu accepte, tel que ses salons le proposent. */
export const PLAYER_COUNTS: Partial<Record<GameTypeId, number[]>> = {
  uno: [2, 3, 4],
  flip7: [2, 3, 4, 5],
  president: [3, 4, 5, 6, 7],
};

/**
 * Le nombre de places d'une table ouverte de l'extérieur : le plus petit que
 * le jeu accepte. Le défaut « à deux » des rooms ne vaut pas pour tous : le
 * Président ne se joue pas à deux. Sa room prend d'elle-même ce minimum quand
 * rien n'est transmis ; le dire ici évite de dépendre de ce défaut.
 */
export function fewestPlayers(game: GameTypeId): number {
  return PLAYER_COUNTS[game]?.[0] ?? 2;
}

// Alphabet sans 0/O ni 1/I, comme les salons. Flip 7 et la Roulette de Vérité
// attendent six caractères, les autres jeux cinq.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(game: GameTypeId): string {
  const length = game === 'flip7' || game === 'verite' ? 6 : 5;
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Les identifiants de jeu servent aussi de chemin : `/uno/ABCDE`. */
export function gameRoomPath(game: GameTypeId, code: string): string {
  return `/${game}/${code}`;
}
