import { useCallback, useEffect, useState } from 'react';
import { accountsEnabled, getSupabase } from '../../lib/supabase';
import type { GameTypeId, ProfileStats } from './types';

export interface RecentGame {
  id: string;
  game_type: GameTypeId;
  won: boolean;
  /** Ce que la ligne réclamait, et où elle en est (0014). */
  claim: 'win' | 'chef' | null;
  status: string;
  score: number;
  points: number;
  streak_bonus: boolean;
  created_at: string;
  room_code: string | null;
  player_count: number;
}

interface State {
  loading: boolean;
  stats: ProfileStats | null;
  recent: RecentGame[];
  error: string | null;
  reload: () => void;
}

/** Ce que PostgREST renvoie pour la jointure vers la session. */
interface ResultRow {
  id: string;
  game_type: GameTypeId;
  won: boolean;
  /** Ce que la ligne réclamait, et où elle en est (0014). */
  claim: 'win' | 'chef' | null;
  status: string;
  score: number;
  points: number;
  streak_bonus: boolean;
  created_at: string;
  game_sessions: { room_code: string | null; player_count: number } | null;
}

/**
 * Les statistiques d'un joueur et ses dix dernières parties.
 *
 * Deux requêtes plutôt qu'une : les totaux viennent d'une vue agrégée sur tout
 * l'historique, la liste d'un simple tri. Les fusionner obligerait à ramener
 * toutes les parties pour n'en afficher que dix.
 */
export function useProfileStats(userId: string | null): State {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!userId || !accountsEnabled) {
      setStats(null);
      setRecent([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getSupabase()
      .then((client) =>
        Promise.all([
          client.from('profile_stats').select('*').eq('user_id', userId).maybeSingle(),
          client
            .from('game_results')
            .select(
              'id, game_type, won, claim, status, score, points, streak_bonus, created_at, game_sessions(room_code, player_count)',
            )
            .eq('user_id', userId)
            // Les parties ajoutées par un admin (God mode) comptent dans les
            // totaux, pas dans l'historique : ce ne sont pas des parties jouées.
            .is('details->>admin', null)
            // `seq` porte l'ordre d'arrivée réel ; `created_at` peut être
            // identique pour deux parties enregistrées dans la même seconde.
            .order('seq', { ascending: false })
            .limit(10),
        ]),
      )
      .then(([statsRes, recentRes]) => {
        if (cancelled) return;
        if (statsRes.error) throw new Error(statsRes.error.message);
        if (recentRes.error) throw new Error(recentRes.error.message);

        setStats((statsRes.data as ProfileStats | null) ?? null);
        setRecent(
          ((recentRes.data ?? []) as unknown as ResultRow[]).map((row) => ({
            id: row.id,
            game_type: row.game_type,
            won: row.won,
            claim: row.claim,
            status: row.status,
            score: row.score,
            points: row.points,
            streak_bonus: row.streak_bonus,
            created_at: row.created_at,
            room_code: row.game_sessions?.room_code ?? null,
            player_count: row.game_sessions?.player_count ?? 2,
          })),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chargement impossible.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  return { loading, stats, recent, error, reload };
}
