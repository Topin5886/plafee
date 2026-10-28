/** Les identifiants de jeu tels qu'ils vivent dans `game_types` en base. */
export type GameTypeId = 'flip7' | 'scopa' | 'uno' | 'puissance4' | 'puissance4-original' | 'verite' | 'president';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface ProfilePreferences {
  theme: ThemePreference;
  notifications: boolean;
  language: 'fr' | 'en';
}

/** Une ligne de `public.profiles`. L'e-mail n'y est pas : il reste dans auth.users. */
export interface Profile {
  id: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  preferences: ProfilePreferences;
  created_at: string;
  updated_at: string;
}

/** Une ligne de la vue `public.profile_stats`. */
export interface ProfileStats {
  user_id: string;
  username: string;
  avatar: string | null;
  created_at: string;
  games_played: number;
  wins: number;
  losses: number;
  points: number;
  favorite_game: GameTypeId | null;
}

/** Une ligne rendue par `public.get_leaderboard()`. */
export interface LeaderboardRow {
  position: number;
  user_id: string;
  username: string;
  avatar: string | null;
  points: number;
  wins: number;
  games: number;
}

/** Ce que `public.record_game_result()` renvoie. */
export interface RecordedGame {
  session_id: string;
  points: number;
  streak: number;
  streak_bonus: boolean;
  /** Vrai quand la partie était déjà enregistrée : rien n'a été ajouté. */
  already: boolean;
  /** Trophées débloqués par cette partie (le pop-up passe par les notifications). */
  unlocked?: { id: string; title: string }[];
  /** FEES gagnés par cette partie (victoire, chef, bonus de série). */
  fees?: number;
  /** Jours de suite avec au moins une victoire (0 : pas de victoire). */
  daily_streak?: number;
  /** Événements complétés par cette partie. */
  events_done?: { event_id: string; name: string }[];
  /**
   * Où en est ce que la partie réclame (0014) : `confirmed` (rien à confirmer,
   * ou confirmé), `pending` (un adversaire doit encore nommer le même
   * gagnant), `contested` (démentie : l'admin tranche), `bots` (partie contre
   * des bots, sans enjeu).
   */
  status?: 'confirmed' | 'pending' | 'contested' | 'rejected' | 'bots';
}

export const DEFAULT_PREFERENCES: ProfilePreferences = {
  theme: 'system',
  notifications: true,
  language: 'fr',
};

/** Libellés d'affichage, alignés sur la colonne `label` de `game_types`. */
export const GAME_LABELS: Record<GameTypeId, string> = {
  flip7: 'Flip 7',
  scopa: 'Scopa',
  uno: 'UNO',
  puissance4: 'P4 Forge',
  'puissance4-original': 'P4 Classic',
  verite: 'Roulette de Vérité',
  president: 'Président',
};
