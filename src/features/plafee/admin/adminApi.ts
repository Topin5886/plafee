import { getSupabase } from '../../../lib/supabase';
import { translateAuthError } from '../../account/validation';
import type { BadgeRarity, BadgeType, ObjectiveType, ShopCategory, Tier } from '../api';

/*
 * Les appels du panneau d'admin. Chaque fonction `admin_*` vérifie en base que
 * l'appelant est admin : ce module n'est qu'un passe-plat, et masquer la page
 * aux autres n'est qu'une commodité, pas une protection.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await getSupabase()).rpc(fn, args);
  if (error) throw new Error(translateAuthError(error.message));
  return data as T;
}

// --- Statistiques ------------------------------------------------------------------

export interface AdminStats {
  visits_series: { day: string; visits: number; hits: number }[];
  visits_week: number;
  visits_prev_week: number;
  active_players: number;
  games_week: number;
  games_prev_week: number;
  win_rate: number | null;
  new_players: number;
  total_players: number;
  online_now: number;
  fees_in_circulation: number;
  per_game: { game: string; label: string; games: number }[];
  pending_reports: number;
}

export const getAdminStats = (days: number) => rpc<AdminStats>('admin_stats', { p_days: days });

export interface AdminPlayer {
  user_id: string;
  username: string;
  email: string | null;
  avatar: string | null;
  created_at: string;
  games: number;
  wins: number;
  losses: number;
  trophies: number;
  balance: number;
  banned: boolean;
  ban_reason: string | null;
  warnings: number;
  last_seen: string | null;
}

export const getAdminPlayers = (search: string, limit = 50, offset = 0) =>
  rpc<AdminPlayer[]>('admin_players', { p_search: search || null, p_limit: limit, p_offset: offset }).then((rows) =>
    rows.map((r) => ({
      ...r,
      games: Number(r.games),
      wins: Number(r.wins),
      losses: Number(r.losses),
      trophies: Number(r.trophies),
      balance: Number(r.balance),
      warnings: Number(r.warnings),
    })),
  );

// --- Modération ----------------------------------------------------------------------

export const banPlayer = (userId: string, reason: string) => rpc<void>('admin_ban', { p_user_id: userId, p_reason: reason });
export const unbanPlayer = (userId: string) => rpc<void>('admin_unban', { p_user_id: userId });
export const warnPlayer = (userId: string, message: string) => rpc<void>('admin_warn', { p_user_id: userId, p_message: message });
export const resetStats = (userId: string) => rpc<void>('admin_reset_stats', { p_user_id: userId });

export interface AdminReport {
  id: number;
  created_at: string;
  reporter: string | null;
  reported_id: string;
  reported: string | null;
  reason: string;
  details: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  resolution: string | null;
  resolved_at: string | null;
}

export const getReports = (status: string | null) => rpc<AdminReport[]>('admin_list_reports', { p_status: status });
export const resolveReport = (id: number, status: string, resolution: string) =>
  rpc<void>('admin_resolve_report', { p_id: id, p_status: status, p_resolution: resolution || null });

export interface FlaggedQuestion {
  id: string;
  content: string;
  theme: string;
  author: string | null;
  report_count: number;
  hidden: boolean;
  used_count: number;
  created_at: string;
}

export const getFlaggedQuestions = () => rpc<FlaggedQuestion[]>('admin_list_flagged_questions');
export const moderateQuestion = (id: string, action: 'hide' | 'restore' | 'delete') =>
  rpc<void>('admin_moderate_question', { p_id: id, p_action: action });

// --- Trophées ----------------------------------------------------------------------------

export interface TrophyInput {
  id: string | null;
  title: string;
  description: string;
  category: string;
  tier: Tier;
  goal: number;
  metric: 'builtin' | 'wins' | 'games' | 'manual';
  game: string | null;
  icon: string;
  image_url: string | null;
  active: boolean;
}

export const upsertTrophy = (t: TrophyInput) =>
  rpc<string>('admin_upsert_trophy', {
    p_id: t.id,
    p_title: t.title,
    p_description: t.description,
    p_category: t.category,
    p_tier: t.tier,
    p_goal: t.goal,
    p_metric: t.metric,
    p_game: t.game,
    p_icon: t.icon,
    p_image_url: t.image_url,
    p_active: t.active,
  });
export const deleteTrophy = (id: string) => rpc<void>('admin_delete_trophy', { p_id: id });
export const awardTrophy = (id: string, userId: string) => rpc<void>('admin_award_trophy', { p_id: id, p_user_id: userId });

// --- Badges ----------------------------------------------------------------------------

export interface BadgeRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  type: BadgeType;
  rarity: BadgeRarity;
  image_url: string | null;
  style: { color?: string; icon?: string; border?: string };
  is_active: boolean;
  expiry_date: string | null;
  created_at: string;
}

export async function getBadges(): Promise<BadgeRow[]> {
  const { data, error } = await (await getSupabase()).from('badges').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BadgeRow[];
}

export async function getBadgeHolders(badgeId: string): Promise<{ user_id: string; username: string; note: string | null; awarded_at: string }[]> {
  const client = await getSupabase();
  const { data, error } = await client.from('user_badges').select('user_id, note, awarded_at, profiles(username)').eq('badge_id', badgeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const p = r.profiles as unknown as { username: string } | { username: string }[] | null;
    return {
      user_id: r.user_id as string,
      note: r.note as string | null,
      awarded_at: r.awarded_at as string,
      username: (Array.isArray(p) ? p[0]?.username : p?.username) ?? '?',
    };
  });
}

export const upsertBadge = (b: {
  id: string | null;
  name: string;
  description: string;
  type: BadgeType;
  rarity: BadgeRarity;
  image_url: string | null;
  style: Record<string, string>;
  expiry: string | null;
  active: boolean;
}) =>
  rpc<string>('admin_upsert_badge', {
    p_id: b.id,
    p_name: b.name,
    p_description: b.description,
    p_type: b.type,
    p_rarity: b.rarity,
    p_image_url: b.image_url,
    p_style: b.style,
    p_expiry: b.expiry,
    p_active: b.active,
  });
export const deleteBadge = (id: string) => rpc<void>('admin_delete_badge', { p_id: id });
export const awardBadge = (badgeId: string, username: string, note: string) =>
  rpc<void>('admin_award_badge', { p_badge_id: badgeId, p_username: username, p_note: note || null });
export const revokeBadge = (badgeId: string, userId: string) => rpc<void>('admin_revoke_badge', { p_badge_id: badgeId, p_user_id: userId });

// --- Événements -------------------------------------------------------------------------

export interface EventInput {
  id: string | null;
  name: string;
  description: string;
  game: string | null;
  objective_type: ObjectiveType;
  objective_value: number;
  trophy_rarity: Tier;
  start: string;
  end: string;
  reward_fees: number;
  image_url: string | null;
  trophy_description: string;
}

export const upsertEvent = (e: EventInput) =>
  rpc<string>('admin_upsert_event', {
    p_id: e.id,
    p_name: e.name,
    p_description: e.description,
    p_game: e.game,
    p_objective_type: e.objective_type,
    p_objective_value: e.objective_value,
    p_trophy_rarity: e.trophy_rarity,
    p_start: e.start,
    p_end: e.end,
    p_reward_fees: e.reward_fees,
    p_image_url: e.image_url,
    p_trophy_description: e.trophy_description || null,
  });
export const endEvent = (id: string) => rpc<void>('admin_end_event', { p_id: id });
export const deleteEvent = (id: string) => rpc<void>('admin_delete_event', { p_id: id });

export interface EventParticipant {
  user_id: string;
  username: string;
  avatar: string | null;
  progress: number;
  completed_at: string | null;
  joined_at: string;
}

export const getEventParticipants = (id: string) => rpc<EventParticipant[]>('admin_event_participants', { p_id: id });

// --- FEES ----------------------------------------------------------------------------------

export const grantFees = (username: string, amount: number, reason: string) =>
  rpc<number>('admin_grant_fees', { p_username: username, p_amount: amount, p_reason: reason || null }).then(Number);
export const setFeesConfig = (action: string, amount: number) => rpc<void>('admin_set_fees_config', { p_action: action, p_amount: amount });
export const upsertShopItem = (i: {
  id: string | null;
  name: string;
  description: string;
  category: ShopCategory;
  price: number;
  icon_url: string | null;
  payload: Record<string, unknown>;
  active: boolean;
  /** '' retire la rareté ; absent, elle ne change pas. */
  rarity?: string;
  /** OG : exclu des offres du jour. Absent, la case ne change pas. */
  is_og?: boolean;
}) =>
  rpc<string>('admin_upsert_shop_item', {
    p_id: i.id,
    p_name: i.name,
    p_description: i.description,
    p_category: i.category,
    p_price: i.price,
    p_icon_url: i.icon_url,
    p_payload: i.payload,
    p_active: i.active,
    p_rarity: i.rarity ?? null,
    p_is_og: i.is_og ?? null,
  });

export interface AdminTransaction {
  id: number;
  created_at: string;
  username: string;
  amount: number;
  type: string;
  description: string | null;
}

export const getTransactions = (type: string, username: string, limit = 100) =>
  rpc<AdminTransaction[]>('admin_list_transactions', { p_type: type || null, p_username: username || null, p_limit: limit }).then((rows) =>
    rows.map((r) => ({ ...r, amount: Number(r.amount) })),
  );

export interface AdminLog {
  id: number;
  created_at: string;
  admin: string | null;
  action: string;
  target_id: string | null;
  details: Record<string, unknown>;
}

export const getAdminLogs = (limit = 80) => rpc<AdminLog[]>('admin_recent_logs', { p_limit: limit });

// --- Images ----------------------------------------------------------------------------------

const BUCKET = 'plafee-assets';
const MAX_BYTES = 1024 * 1024;

/**
 * Dépose une image dans le stockage public (admins seulement, voir la policy
 * de 0006) et renvoie son adresse publique.
 */
export async function uploadAsset(file: File, folder: 'trophies' | 'badges' | 'events' | 'shop'): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Image PNG, JPEG, WebP, GIF ou SVG uniquement.');
  if (file.size > MAX_BYTES) throw new Error('Image trop lourde (1 Mo maximum).');
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const storage = (await getSupabase()).storage.from(BUCKET);
  const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return storage.getPublicUrl(path).data.publicUrl;
}

// --- God mode (super admin) ------------------------------------------------------------

export interface GodStat {
  game: string;
  label: string;
  wins: number;
  losses: number;
  /** Lignes ajoutées par un admin (0 point, datées de l'inscription). */
  added: number;
}

export interface GodCatalogTrophy {
  id: string;
  title: string;
  tier: Tier;
  icon: string;
  category: string;
  image_url: string | null;
  active: boolean;
}

export interface GodCatalogItem {
  id: string;
  name: string;
  category: ShopCategory;
  price: number;
  is_default: boolean;
  is_active: boolean;
  payload: Record<string, unknown>;
}

export interface GodCatalogBadge {
  id: string;
  name: string;
  type: BadgeType;
  rarity: BadgeRarity;
  style: { color?: string; icon?: string };
  image_url: string | null;
  sku: string | null;
}

export interface GodState {
  profile: { id: string; username: string; email: string | null; avatar: string | null; bio: string | null; created_at: string; banned: boolean };
  fees: { balance: number; lifetime_earned: number; lifetime_spent: number };
  stats: GodStat[];
  trophies: { id: string; unlocked_at: string }[];
  items: { item_id: string; equipped: boolean; custom_text: string | null; purchased_at: string }[];
  badges: { badge_id: string; note: string | null; awarded_at: string }[];
  catalog: { trophies: GodCatalogTrophy[]; items: GodCatalogItem[]; badges: GodCatalogBadge[] };
}

/** Ce que « Sauvegarder » envoie : seulement ce qui change. */
export interface GodChanges {
  profile?: { username?: string; avatar?: string | null; bio?: string | null };
  fees_balance?: number;
  stats?: { game: string; wins: number; losses: number }[];
  trophies?: { add: string[]; remove: string[] };
  items?: { add: { item_id: string; custom_text?: string }[]; remove: string[]; equip: { category: ShopCategory; item_id: string | null }[] };
  badges?: { add: string[]; remove: string[] };
}

export const godLoad = (userId: string) => rpc<GodState>('admin_god_load', { p_user: userId });

export const godSave = (userId: string, changes: GodChanges) =>
  rpc<{ changes: number; state: GodState }>('admin_god_save', { p_user: userId, p_changes: changes });
