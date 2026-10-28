import { getSupabase } from '../../lib/supabase';
import { TIER_LABELS, TIER_RANK, type Tier } from '../plafee/api';

export { TIER_LABELS };
export type { Tier };

export type Category =
  | 'victoires'
  | 'flip7'
  | 'scopa'
  | 'uno'
  | 'puissance4'
  | 'verite'
  | 'president'
  | 'social'
  | 'defis'
  | 'evenement'
  | 'special';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: Category;
  icon: string;
  tier: Tier;
  goal: number;
  sort_order: number;
  /** builtin : calculé en base · wins/games : créé par un admin · manual : décerné à la main · event : événement. */
  metric: 'builtin' | 'wins' | 'games' | 'manual' | 'event';
  game: string | null;
  image_url: string | null;
  event_id: string | null;
  /** Édition limitée : trophée d'événement, OG. */
  is_limited: boolean;
  active: boolean;
}

/** Un trophée et où en est un joueur. */
export interface AchievementState extends Achievement {
  progress: number;
  unlocked_at: string | null;
  /** Détail d'une progression à plusieurs volets (ex. difficultés de la Roulette). */
  extra: Record<string, number>;
}

/** Ce que la base renvoie quand un trophée vient d'être débloqué. */
export interface UnlockedAchievement {
  id: string;
  title: string;
  icon: string;
  tier: Tier;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  victoires: 'Victoires',
  flip7: 'Flip 7',
  scopa: 'Scopa',
  uno: 'UNO',
  puissance4: 'Puissance 4',
  verite: 'Roulette de Vérité',
  president: 'Président',
  social: 'Sociabilité',
  defis: 'Défis',
  evenement: 'Événements',
  special: 'Spéciaux',
};

/**
 * Le catalogue, avec la progression du joueur (zéro s'il n'a rien commencé).
 *
 * Les trophées masqués par un admin disparaissent ; ceux des événements ne se
 * montrent qu'à ceux qui les ont gagnés — c'est ce qui en fait une édition
 * limitée.
 */
export async function getAchievements(userId: string): Promise<AchievementState[]> {
  const client = await getSupabase();
  const [catalog, mine] = await Promise.all([
    client.from('achievements').select('*').order('sort_order'),
    client.from('user_achievements').select('achievement_id, progress, unlocked_at, extra').eq('user_id', userId),
  ]);
  if (catalog.error) throw new Error(catalog.error.message);
  if (mine.error) throw new Error(mine.error.message);
  const byId = new Map((mine.data ?? []).map((r) => [r.achievement_id as string, r]));
  return ((catalog.data ?? []) as Achievement[])
    .map((a) => {
      const m = byId.get(a.id);
      return {
        ...a,
        progress: Math.min(m?.progress ?? 0, a.goal),
        unlocked_at: m?.unlocked_at ?? null,
        extra: (m?.extra as Record<string, number> | undefined) ?? {},
      };
    })
    .filter((a) => (a.unlocked_at ? true : a.active !== false && a.metric !== 'event'));
}

/** Les trois plus beaux trophées : prestige d'abord, puis les plus récents. */
export function bestAchievements(list: AchievementState[], n = 3): AchievementState[] {
  return list
    .filter((a) => a.unlocked_at)
    .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (b.unlocked_at ?? '').localeCompare(a.unlocked_at ?? ''))
    .slice(0, n);
}

/**
 * Recalcule les trophées qui ne dépendent pas d'une partie (groupes, podium
 * de la semaine passée, parrainage). Renvoie ceux qui viennent d'être débloqués.
 */
export async function refreshMyAchievements(): Promise<UnlockedAchievement[]> {
  const { data, error } = await (await getSupabase()).rpc('refresh_my_achievements');
  if (error) throw new Error(error.message);
  return (data ?? []) as UnlockedAchievement[];
}

/** Nombre de trophées débloqués, pour les joueurs d'un classement. */
export async function getAchievementCounts(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await (await getSupabase())
    .from('achievement_counts')
    .select('user_id, unlocked')
    .in('user_id', userIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.user_id as string, Number(r.unlocked)]));
}

export async function getTrendingGame(): Promise<string> {
  const { data, error } = await (await getSupabase()).rpc('trending_game');
  if (error) throw new Error(error.message);
  return (data as string) ?? 'flip7';
}
