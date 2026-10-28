import { getSupabase } from '../../lib/supabase';
import { translateAuthError } from '../account/validation';
import type { GameTypeId } from '../account/types';

/*
 * PLAFEE V2 côté client : FEES, boutique, événements, cosmétiques, trophées.
 *
 * Toutes les règles vivent en base (migration 0006) : ce module ne fait que
 * passer les paramètres et remonter l'erreur, déjà rédigée en français.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await getSupabase()).rpc(fn, args);
  if (error) {
    if (error.code === '42501' && /permission denied/i.test(error.message)) throw new Error('Il faut être connecté.');
    throw new Error(translateAuthError(error.message));
  }
  return data as T;
}

// --- Raretés ------------------------------------------------------------------

export type Tier = 'bronze' | 'argent' | 'or' | 'platine' | 'divin' | 'og';
export const TIERS: Tier[] = ['bronze', 'argent', 'or', 'platine', 'divin', 'og'];
export const TIER_LABELS: Record<Tier, string> = {
  bronze: 'Bronze',
  argent: 'Argent',
  or: 'Or',
  platine: 'Platine',
  divin: 'Divin',
  og: 'OG',
};
/** Du plus prestigieux au plus courant. */
export const TIER_RANK: Record<Tier, number> = { og: 0, divin: 1, platine: 2, or: 3, argent: 4, bronze: 5 };

export type BadgeType = 'title' | 'visual' | 'border' | 'plate' | 'temporal';
export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';
export const BADGE_TYPE_LABELS: Record<BadgeType, string> = {
  title: 'Titre',
  visual: 'Icône',
  border: 'Contour',
  plate: 'Plaque',
  temporal: 'Temporaire',
};
export const BADGE_RARITY_LABELS: Record<BadgeRarity, string> = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
};

// --- Statut du compte ------------------------------------------------------------

export interface Standing {
  banned: boolean;
  ban_reason: string | null;
  is_admin: boolean;
  /** Rôle super_admin : accès au God mode. Absent avant la migration 0007. */
  is_super_admin?: boolean;
  warnings: { message: string; created_at: string }[];
  /** Version des CGU acceptée, null si jamais. Absent avant la migration 0013. */
  terms_version?: string | null;
}

export const getStanding = () => rpc<Standing>('my_standing');
export const acceptTerms = (version: string) => rpc<void>('accept_terms', { p_version: version });
export const deleteMyAccount = () => rpc<void>('delete_my_account');

export const reportPlayer = (userId: string, reason: string, details: string) =>
  rpc<void>('report_player', { p_user_id: userId, p_reason: reason, p_details: details || null });

// --- FEES ----------------------------------------------------------------------------

export type FeesTxType = 'victory' | 'chef' | 'event' | 'streak' | 'referral' | 'admin_grant' | 'admin_revoke' | 'shop_purchase';

export interface FeesTransaction {
  id: number;
  amount: number;
  type: FeesTxType;
  related_id: string | null;
  description: string | null;
  created_at: string;
}

export interface Wallet {
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
  current_streak: number;
  best_streak: number;
  played_today: boolean;
  transactions: FeesTransaction[];
  referrals: { total: number; rewarded: number };
}

export const TX_LABELS: Record<FeesTxType, string> = {
  victory: 'Victoire',
  chef: 'Chef',
  event: 'Événement',
  streak: 'Série',
  referral: 'Parrainage',
  admin_grant: 'Cadeau',
  admin_revoke: 'Retrait',
  shop_purchase: 'Achat',
};

export async function getWallet(): Promise<Wallet> {
  const w = await rpc<Wallet>('my_fees');
  return {
    ...w,
    balance: Number(w.balance),
    lifetime_earned: Number(w.lifetime_earned),
    lifetime_spent: Number(w.lifetime_spent),
    transactions: (w.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
  };
}

export interface FeesRow {
  position: number;
  user_id: string;
  username: string;
  avatar: string | null;
  balance: number;
  lifetime_earned: number;
}

export const getFeesLeaderboard = (limit = 100) =>
  rpc<FeesRow[]>('fees_leaderboard', { p_limit: limit }).then((rows) =>
    rows.map((r) => ({ ...r, balance: Number(r.balance), lifetime_earned: Number(r.lifetime_earned) })),
  );

export interface PriceConfig {
  action: string;
  label: string;
  amount: number;
}

export async function getPriceConfig(): Promise<PriceConfig[]> {
  const { data, error } = await (await getSupabase()).from('fees_price_config').select('action, label, amount').order('action');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as PriceConfig[];
}

export const setReferrer = (username: string) => rpc<void>('set_referrer', { p_username: username });

// --- Boutique -------------------------------------------------------------------------

export type ShopCategory =
  | 'card_theme'
  | 'site_theme'
  | 'badge'
  | 'profile_border'
  | 'avatar_accessory'
  | 'avatar_effect'
  | 'nameplate'
  | 'victory_animation';

export const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: 'card_theme', label: 'Cartes' },
  { id: 'site_theme', label: 'Site' },
  { id: 'badge', label: 'Badges' },
  { id: 'profile_border', label: 'Cadres' },
  { id: 'avatar_accessory', label: 'Accessoires' },
  { id: 'avatar_effect', label: 'Effets' },
  { id: 'nameplate', label: 'Plaques' },
  { id: 'victory_animation', label: 'Animations' },
];

/** La rareté d'un objet de boutique (mêmes couleurs que les trophées). */
export type Rarity = 'bronze' | 'argent' | 'or' | 'platine' | 'divin';
export const RARITIES: Rarity[] = ['bronze', 'argent', 'or', 'platine', 'divin'];
export const RARITY_LABELS: Record<Rarity, string> = {
  bronze: 'Bronze',
  argent: 'Argent',
  or: 'Or',
  platine: 'Platine',
  divin: 'Divin',
};

export interface ShopItem {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: ShopCategory;
  price: number;
  icon_url: string | null;
  payload: Record<string, unknown>;
  requirement: Record<string, number>;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  /** Absent avant la migration 0010, et pour les objets sans rareté (thèmes, plaques…). */
  rarity?: Rarity | null;
  /** Objet OG : jamais dans les offres du jour. Absent avant la migration 0011. */
  is_og?: boolean;
}

export interface Purchase {
  item_id: string;
  equipped: boolean;
  custom_text: string | null;
  purchased_at: string;
}

export async function getShopItems(includeInactive = false): Promise<ShopItem[]> {
  let q = (await getSupabase()).from('shop_items').select('*').order('sort_order').order('price');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({ ...i, price: Number(i.price) })) as ShopItem[];
}

export async function getMyPurchases(userId: string): Promise<Purchase[]> {
  const { data, error } = await (await getSupabase())
    .from('user_shop_purchases')
    .select('item_id, equipped, custom_text, purchased_at')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Purchase[];
}

/**
 * `maxPrice` : le prix affiché au joueur. La base calcule le vrai prix (remise
 * comprise) et refuse l'achat s'il dépasse ce plafond, par exemple quand
 * l'offre du jour se termine pendant que la fenêtre d'achat est ouverte.
 */
export const buyItem = (itemId: string, customText?: string, maxPrice?: number) =>
  rpc<{ balance: number; item_id: string; price: number; deal: boolean }>('shop_purchase', {
    p_item_id: itemId,
    p_custom_text: customText ?? null,
    p_max_price: maxPrice ?? null,
  });

/** Une offre du jour : 3 par jour, tirées en base, les mêmes pour tout le monde. */
export interface DailyDeal {
  day: string;
  slot: number;
  item_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: ShopCategory;
  rarity: Rarity;
  icon_url: string | null;
  payload: Record<string, unknown>;
  price: number;
  deal_price: number;
  discount_pct: number;
  /** Prochain minuit, heure de Paris. */
  ends_at: string;
}

export const getDailyDeals = () =>
  rpc<DailyDeal[]>('get_daily_deals').then((rows) =>
    (rows ?? []).map((r) => ({ ...r, price: Number(r.price), deal_price: Number(r.deal_price) })),
  );

export const equipItem = (itemId: string) => rpc<void>('shop_equip', { p_item_id: itemId });

// --- Cosmétiques ------------------------------------------------------------------------

export interface PlayerBadge {
  id: string;
  name: string;
  description: string | null;
  type: BadgeType;
  rarity: BadgeRarity;
  image_url: string | null;
  style: { color?: string; icon?: string; border?: string };
  note: string | null;
  awarded_at: string;
  expiry_date: string | null;
}

export interface Cosmetics {
  user_id: string;
  border: string | null;
  plate: string | null;
  title: string | null;
  site_skin: string | null;
  card_skin: string | null;
  victory_anim: string | null;
  /** Posé sur la photo (« bow » : le nœud papillon). Absent avant la migration 0008. */
  accessory?: string | null;
  /** L'animation par-dessus la photo. Absent avant la migration 0010. */
  effect?: string | null;
  /** Visuels envoyés depuis l'admin, qui remplacent le dessin d'origine (0010). */
  border_img?: string | null;
  accessory_img?: string | null;
  effect_img?: string | null;
  badges: PlayerBadge[];
  banned: boolean;
}

export const getCosmetics = (userIds: string[]) =>
  rpc<Cosmetics[]>('profile_cosmetics', { p_user_ids: userIds });

// --- Événements -----------------------------------------------------------------------

export type EventStatus = 'live' | 'upcoming' | 'ended';
export type ObjectiveType = 'victories' | 'games' | 'global_target';

export interface PlafeeEvent {
  id: string;
  name: string;
  description: string | null;
  game: GameTypeId | null;
  objective_type: ObjectiveType;
  objective_value: number;
  trophy_id: string | null;
  trophy_rarity: Tier;
  image_url: string | null;
  start_date: string;
  end_date: string;
  status: EventStatus;
  reward_fees: number;
  participants: number;
  completed: number;
  global_progress: number;
  my_progress: number | null;
  my_completed: boolean | null;
}

export const listEvents = (includePast = false) =>
  rpc<PlafeeEvent[]>('list_events', { p_include_past: includePast }).then((rows) =>
    rows.map((e) => ({
      ...e,
      participants: Number(e.participants),
      completed: Number(e.completed),
      global_progress: Number(e.global_progress),
    })),
  );

export const OBJECTIVE_LABELS: Record<ObjectiveType, string> = {
  victories: 'Victoires',
  games: 'Parties jouées',
  global_target: 'Objectif commun',
};

/** « 3 jours restants », « 5 h restantes », « commence dans 2 jours ». */
export function timeLeft(e: Pick<PlafeeEvent, 'start_date' | 'end_date' | 'status'>, now = Date.now()): string {
  const target = new Date(e.status === 'upcoming' ? e.start_date : e.end_date).getTime();
  const ms = Math.max(0, target - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const span = days >= 1 ? `${days} jour${days > 1 ? 's' : ''}` : hours >= 1 ? `${hours} h` : `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (e.status === 'upcoming') return `commence dans ${span}`;
  if (e.status === 'ended') return 'terminé';
  return days >= 1 ? `${span} restant${days > 1 ? 's' : ''}` : `${span} restantes`;
}

// --- Classements des trophées ------------------------------------------------------------

export interface TrophyLeader {
  position: number;
  user_id: string;
  username: string;
  avatar: string | null;
  total: number;
  divin: number;
  og: number;
  platine: number;
  orr: number;
}

export interface TrophyRarity {
  id: string;
  title: string;
  tier: Tier;
  icon: string;
  category: string;
  holders: number;
  pct: number;
  is_limited: boolean;
}

export interface RecentUnlock {
  user_id: string;
  username: string;
  avatar: string | null;
  achievement_id: string;
  title: string;
  tier: Tier;
  icon: string;
  unlocked_at: string;
}

export const getTrophyLeaderboard = (limit = 10) =>
  rpc<TrophyLeader[]>('trophy_leaderboard', { p_limit: limit }).then((rows) =>
    rows.map((r) => ({ ...r, position: Number(r.position), total: Number(r.total), divin: Number(r.divin), og: Number(r.og), platine: Number(r.platine), orr: Number(r.orr) })),
  );
export const getTrophyRarity = () =>
  rpc<TrophyRarity[]>('trophy_rarity').then((rows) => rows.map((r) => ({ ...r, holders: Number(r.holders), pct: Number(r.pct) })));
export const getRecentUnlocks = (days = 7, limit = 30) => rpc<RecentUnlock[]>('recent_unlocks', { p_days: days, p_limit: limit });

// --- Visites -----------------------------------------------------------------------------

const VISITOR_KEY = 'plafee-visitor';
const VISITOR_SINCE_KEY = 'plafee-visitor-since';
const VISIT_DAY_KEY = 'plafee-visit-day';
/** Durée de vie maximale d'un traceur d'audience exempté selon la CNIL. */
const VISITOR_MAX_AGE_MS = 395 * 86_400_000;

/**
 * Une visite par navigateur et par jour, sans cookie ni empreinte : un
 * identifiant tiré au hasard, gardé dans ce navigateur et renouvelé tous les
 * 13 mois. La base ne compte que des visiteurs, elle ne sait pas qui ils sont
 * — même connectés (voir /confidentialite).
 */
export async function trackVisit(): Promise<void> {
  let visitor: string | null = null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (sessionStorage.getItem(VISIT_DAY_KEY) === today) return;
    visitor = localStorage.getItem(VISITOR_KEY);
    const since = Number(localStorage.getItem(VISITOR_SINCE_KEY));
    if (!visitor || !/^[a-z0-9]{12,40}$/.test(visitor) || !since || Date.now() - since > VISITOR_MAX_AGE_MS) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      visitor = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      localStorage.setItem(VISITOR_KEY, visitor);
      localStorage.setItem(VISITOR_SINCE_KEY, String(Date.now()));
    }
    sessionStorage.setItem(VISIT_DAY_KEY, today);
  } catch {
    // Stockage indisponible : un identifiant pour cette page seulement.
    visitor ??= Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  }
  await rpc<void>('track_visit', { p_visitor: visitor });
}

// --- Parrainage ----------------------------------------------------------------------------

const REF_KEY = 'plafee-ref';

/** `?ref=pseudo` dans l'URL : on le garde jusqu'à l'inscription. */
export function captureReferral(search: string) {
  const ref = new URLSearchParams(search).get('ref');
  if (!ref || !/^[A-Za-z0-9_]{3,20}$/.test(ref)) return;
  try {
    localStorage.setItem(REF_KEY, ref);
  } catch {
    // Tant pis : le parrain pourra être déclaré depuis le profil.
  }
}

export function pendingReferral(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearReferral() {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    // Rien à effacer.
  }
}

export function referralLink(username: string): string {
  return new URL(`${import.meta.env.BASE_URL}inscription?ref=${encodeURIComponent(username)}`, window.location.origin).toString();
}
