import { getSupabase } from '../../lib/supabase';
import { translateAuthError } from '../account/validation';
import type { GameTypeId, LeaderboardRow } from '../account/types';
import type {
  AppNotification,
  BlockedUser,
  FriendSession,
  Friendship,
  GameStatRow,
  Group,
  GroupInvitation,
  GroupMember,
  GroupMessage,
  GroupSummary,
  LeaderboardPeriod,
  LeaderboardRank,
} from './types';

/*
 * L'accès aux données des fonctions sociales.
 *
 * Chaque écriture est un appel RPC vers une fonction SECURITY DEFINER de
 * `0002_social.sql` : c'est là que vivent les règles (qui peut inviter, qui
 * peut supprimer quoi). Ce module ne fait que passer les paramètres et
 * remonter l'erreur — dont le message est déjà rédigé en français côté base.
 */

interface PgError {
  message: string;
  code?: string;
}

function fail(error: PgError): never {
  if (error.code === '42501' && /permission denied/i.test(error.message)) {
    throw new Error('Il faut être connecté.');
  }
  throw new Error(translateAuthError(error.message));
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await getSupabase()).rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

// --- Présence ---------------------------------------------------------------

export const touchLastSeen = () => rpc<void>('touch_last_seen');

// --- Amis -------------------------------------------------------------------

export const listFriendships = () => rpc<Friendship[]>('list_friendships');
export const listBlocked = () => rpc<BlockedUser[]>('list_blocked');

export const sendFriendRequest = (username: string) =>
  rpc<{ id: string; status: 'pending' | 'accepted'; user_id: string; username: string }>(
    'send_friend_request',
    { p_username: username },
  );

export const respondFriendRequest = (requestId: string, accept: boolean) =>
  rpc<{ accepted: boolean; user_id: string; username: string }>('respond_friend_request', {
    p_request_id: requestId,
    p_accept: accept,
  });

/** Retire un ami, ou annule une demande dans un sens comme dans l'autre. */
export const removeFriend = (userId: string) => rpc<void>('remove_friend', { p_user_id: userId });
export const blockUser = (userId: string) => rpc<void>('block_user', { p_user_id: userId });
export const unblockUser = (userId: string) => rpc<void>('unblock_user', { p_user_id: userId });

/**
 * Pseudos commençant par `query`, pour l'autocomplétion de l'ajout d'ami.
 *
 * `_` est un caractère légal dans un pseudo et un joker pour ILIKE : sans
 * échappement, chercher « a_b » trouverait aussi « axb ».
 */
export async function searchUsers(query: string, excludeId?: string) {
  const q = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (q.length < 2) return [];
  let req = (await getSupabase())
    .from('profiles')
    .select('id, username, avatar')
    .ilike('username', `${q}%`)
    .order('username')
    .limit(8);
  if (excludeId) req = req.neq('id', excludeId);
  const { data, error } = await req;
  if (error) fail(error);
  return (data ?? []) as { id: string; username: string; avatar: string | null }[];
}

// --- Groupes ----------------------------------------------------------------

export const getMyGroups = () => rpc<GroupSummary[]>('get_my_groups');
export const listGroupInvitations = () => rpc<GroupInvitation[]>('list_group_invitations');

export const createGroup = (name: string, description: string, isPrivate: boolean) =>
  rpc<Group>('create_group', { p_name: name, p_description: description, p_is_private: isPrivate });

export const updateGroup = (groupId: string, patch: { name?: string; description?: string; isPrivate?: boolean }) =>
  rpc<Group>('update_group', {
    p_group_id: groupId,
    p_name: patch.name ?? null,
    p_description: patch.description ?? null,
    p_is_private: patch.isPrivate ?? null,
  });

export const deleteGroup = (groupId: string) => rpc<void>('delete_group', { p_group_id: groupId });
export const leaveGroup = (groupId: string) => rpc<void>('leave_group', { p_group_id: groupId });
export const joinGroupByCode = (code: string) => rpc<string>('join_group_by_code', { p_code: code });
export const regenerateInviteCode = (groupId: string) =>
  rpc<string>('regenerate_group_invite_code', { p_group_id: groupId });

export const inviteToGroup = (groupId: string, username: string) =>
  rpc<{ id: string; group_name: string; username: string }>('invite_to_group', {
    p_group_id: groupId,
    p_username: username,
  });

export const respondGroupInvitation = (invitationId: string, accept: boolean) =>
  rpc<string | null>('respond_group_invitation', { p_invitation_id: invitationId, p_accept: accept });

export const removeGroupMember = (groupId: string, memberId: string) =>
  rpc<void>('remove_group_member', { p_group_id: groupId, p_member_id: memberId });

export const setGroupAdmin = (groupId: string, memberId: string, admin: boolean) =>
  rpc<void>('set_group_admin', { p_group_id: groupId, p_member_id: memberId, p_admin: admin });

/** Le groupe, lisible seulement par ses membres : `null` pour les autres. */
export async function getGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await (await getSupabase())
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  if (error) fail(error);
  return data as Group | null;
}

interface MemberRow {
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  profiles: { username: string; avatar: string | null } | null;
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await (await getSupabase())
    .from('group_members')
    .select('user_id, role, joined_at, profiles(username, avatar)')
    .eq('group_id', groupId);
  if (error) fail(error);
  return ((data ?? []) as unknown as MemberRow[])
    .map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      username: m.profiles?.username ?? 'Ancien joueur',
      avatar: m.profiles?.avatar ?? null,
    }))
    .sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1));
}

export const MESSAGE_PAGE = 50;

/**
 * Une page de messages, du plus récent au plus ancien, avant `beforeId`.
 *
 * Pagination par curseur plutôt que par skip : des messages arrivent pendant
 * qu'on remonte l'historique, et un décalage compté depuis le haut sauterait
 * ou doublerait des lignes à chaque arrivée.
 */
export async function getGroupMessages(groupId: string, beforeId?: number) {
  let req = (await getSupabase())
    .from('group_messages')
    .select('id, group_id, sender_id, kind, content, created_at, deleted_at')
    .eq('group_id', groupId)
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE + 1);
  if (beforeId !== undefined) req = req.lt('id', beforeId);
  const { data, error } = await req;
  if (error) fail(error);
  const rows = (data ?? []) as GroupMessage[];
  return { messages: rows.slice(0, MESSAGE_PAGE).reverse(), hasMore: rows.length > MESSAGE_PAGE };
}

export const sendGroupMessage = (groupId: string, content: string) =>
  rpc<GroupMessage>('send_group_message', { p_group_id: groupId, p_content: content });

export const deleteGroupMessage = (messageId: number) =>
  rpc<void>('delete_group_message', { p_message_id: messageId });

// --- Notifications ----------------------------------------------------------

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await (await getSupabase())
    .from('notifications')
    .select('id, kind, actor_id, group_id, payload, created_at, read_at, actor:profiles!notifications_actor_id_fkey(username, avatar)')
    .eq('silent', false)
    .order('id', { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data ?? []) as unknown as AppNotification[];
}

export const markNotificationsRead = (ids?: number[]) =>
  rpc<void>('mark_notifications_read', { p_ids: ids ?? null });

// --- Parties ----------------------------------------------------------------

export const inviteToGame = (userId: string, gameType: GameTypeId, roomCode: string) =>
  rpc<void>('invite_to_game', { p_user_id: userId, p_game_type: gameType, p_room_code: roomCode });

// --- Classements et statistiques ---------------------------------------------

export const getLeaderboard = (period: LeaderboardPeriod, gameType: GameTypeId | null, limit = 100) =>
  rpc<LeaderboardRow[]>('get_leaderboard', { p_period: period, p_game_type: gameType, p_limit: limit });

export async function getLeaderboardRank(
  period: LeaderboardPeriod,
  gameType: GameTypeId | null,
  userId: string,
): Promise<LeaderboardRank | null> {
  const rows = await rpc<LeaderboardRank[]>('get_leaderboard_rank', {
    p_period: period,
    p_game_type: gameType,
    p_user_id: userId,
  });
  return rows[0] ?? null;
}

export async function getProfileByUsername(username: string) {
  const { data, error } = await (await getSupabase())
    .from('profiles')
    .select('id, username, avatar, bio, created_at')
    .ilike('username', username.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (error) fail(error);
  return data as { id: string; username: string; avatar: string | null; bio: string | null; created_at: string } | null;
}

export async function getGameStats(userId: string): Promise<GameStatRow[]> {
  const { data, error } = await (await getSupabase())
    .from('profile_game_stats')
    .select('game_type, played, wins, points')
    .eq('user_id', userId);
  if (error) fail(error);
  return (data ?? []) as GameStatRow[];
}

export interface HistoryRow {
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
  player_count: number;
  duration_seconds: number | null;
}

interface RawHistoryRow extends Omit<HistoryRow, 'player_count' | 'duration_seconds'> {
  game_sessions: { player_count: number; duration_seconds: number | null } | null;
}

export async function getGameHistory(userId: string, offset: number, limit = 20) {
  const { data, error, count } = await (await getSupabase())
    .from('game_results')
    .select('id, game_type, won, claim, status, score, points, streak_bonus, created_at, game_sessions(player_count, duration_seconds)', {
      count: 'exact',
    })
    .eq('user_id', userId)
    // Sans les parties ajoutées par un admin (God mode) : rien n'a été joué.
    .is('details->>admin', null)
    .order('seq', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail(error);
  const games = ((data ?? []) as unknown as RawHistoryRow[]).map(({ game_sessions, ...row }) => ({
    ...row,
    player_count: game_sessions?.player_count ?? 2,
    duration_seconds: game_sessions?.duration_seconds ?? null,
  }));
  return { games, total: count ?? games.length, hasMore: offset + games.length < (count ?? 0) };
}

// --- Tables ouvertes -----------------------------------------------------------

export const publishRoom = (room: {
  game: GameTypeId;
  code: string;
  isPublic: boolean;
  status: 'waiting' | 'playing';
  players: number;
  maxPlayers: number;
  spectators: number;
}) =>
  rpc<void>('publish_room', {
    p_game_type: room.game,
    p_room_code: room.code,
    p_is_public: room.isPublic,
    p_status: room.status,
    p_player_count: room.players,
    p_max_players: room.maxPlayers,
    p_spectators: room.spectators,
  });

export const setCurrentRoom = (game: GameTypeId, code: string, role: 'player' | 'spectator') =>
  rpc<void>('set_current_room', { p_game_type: game, p_room_code: code, p_role: role });

export const leaveCurrentRoom = () => rpc<void>('leave_current_room');

export const listFriendSessions = () => rpc<FriendSession[]>('list_friend_sessions');
