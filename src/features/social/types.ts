import type { GameTypeId } from '../account/types';

/** Une ligne de `list_friendships()` : un ami, ou une demande dans un sens ou dans l'autre. */
export interface Friendship {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  status: 'pending' | 'accepted';
  direction: 'friend' | 'incoming' | 'outgoing';
  created_at: string;
  accepted_at: string | null;
  last_seen_at: string | null;
}

export interface BlockedUser {
  user_id: string;
  username: string;
  avatar: string | null;
  blocked_at: string;
}

/** Une ligne de `public.groups`. */
export interface Group {
  id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  invite_code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Une ligne de `get_my_groups()`. */
export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  role: 'admin' | 'member';
  is_creator: boolean;
  member_count: number;
  last_message: string | null;
  last_message_kind: 'text' | 'system' | null;
  last_message_deleted: boolean | null;
  last_sender: string | null;
  last_activity_at: string;
}

export interface GroupMember {
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  username: string;
  avatar: string | null;
}

export interface GroupInvitation {
  invitation_id: string;
  group_id: string;
  group_name: string;
  invited_by_username: string | null;
  created_at: string;
}

export interface GroupMessage {
  id: number;
  group_id: string;
  sender_id: string | null;
  kind: 'text' | 'system';
  /** Nul une fois le message supprimé. */
  content: string | null;
  created_at: string;
  deleted_at: string | null;
}

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'group_invite'
  | 'group_removed'
  | 'group_deleted'
  | 'game_invite'
  | 'achievement'
  | 'fees'
  | 'badge'
  | 'event_completed'
  | 'warning'
  | 'ban'
  | 'unban'
  | 'stats_reset'
  | 'victory_confirmed'
  | 'victory_contested'
  | 'victory_rejected';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  actor_id: string | null;
  group_id: string | null;
  payload: {
    friendship_id?: string;
    invitation_id?: string;
    group_id?: string;
    group_name?: string;
    game_type?: GameTypeId;
    room_code?: string;
    achievement_id?: string;
    title?: string;
    icon?: string;
    tier?: string;
    /** FEES, badges, événements, avertissements (PLAFEE V2). */
    amount?: number;
    type?: string;
    description?: string | null;
    badge_id?: string;
    name?: string;
    event_id?: string;
    fees?: number;
    message?: string;
    /** Motif d'une sanction (ban, remise à zéro). */
    reason?: string;
    /** Note jointe à un badge décerné par un admin. */
    note?: string | null;
    /** Victoire confirmée, contestée ou refusée (0014) : la partie, et ce qu'elle réclamait. */
    session_id?: string;
    claim?: 'win' | 'chef' | null;
    paid?: boolean;
    points?: number;
  };
  created_at: string;
  read_at: string | null;
  actor: { username: string; avatar: string | null } | null;
}

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';

export interface LeaderboardRank {
  position: number;
  user_id: string;
  username: string;
  points: number;
  wins: number;
  games: number;
  /** Nombre de joueurs classés sur la période. */
  total: number;
}

export interface GameStatRow {
  game_type: GameTypeId;
  played: number;
  wins: number;
  points: number;
}

export const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  daily: 'Jour',
  weekly: 'Semaine',
  monthly: 'Mois',
  alltime: 'Depuis toujours',
};

export const PERIODS: LeaderboardPeriod[] = ['daily', 'weekly', 'monthly', 'alltime'];

/** `null` : tous les jeux confondus. */
export const LEADERBOARD_GAMES: (GameTypeId | null)[] = [null, 'scopa', 'uno', 'president', 'puissance4', 'puissance4-original', 'flip7'];

/** Une ligne de `list_friend_sessions()`. */
export interface FriendSession {
  game_type: GameTypeId;
  room_code: string;
  host_id: string;
  host_username: string;
  host_avatar: string | null;
  status: 'waiting' | 'playing';
  player_count: number;
  max_players: number;
  spectator_count: number;
  created_at: string;
  is_mine: boolean;
  friends_inside: { user_id: string; username: string; avatar: string | null; role: 'player' | 'spectator' }[];
}
