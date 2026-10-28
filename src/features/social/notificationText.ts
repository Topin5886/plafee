import { GAME_LABELS } from '../account/types';
import { gameRoomPath } from './gameRooms';
import type { AppNotification } from './types';

export interface NotificationView {
  text: string;
  /** Où mène un clic sur la notification. */
  to: string | null;
}

/** Le texte et la destination d'une notification, partagés par la cloche et les toasts. */
export function describeNotification(
  n: Pick<AppNotification, 'kind' | 'payload' | 'group_id'>,
  actorName: string | null,
): NotificationView {
  const who = actorName ?? "Quelqu'un";
  const group = n.payload.group_name ?? 'un groupe';

  switch (n.kind) {
    case 'friend_request':
      return { text: `${who} t'a envoyé une demande d'ami.`, to: '/amis' };
    case 'friend_accepted':
      return { text: `${who} a accepté ta demande d'ami.`, to: '/amis' };
    case 'group_invite':
      return { text: `${who} t'invite dans le groupe « ${group} ».`, to: '/groupes' };
    case 'group_removed':
      return { text: `Tu as été retiré du groupe « ${group} ».`, to: '/groupes' };
    case 'group_deleted':
      return { text: `Le groupe « ${group} » a été supprimé.`, to: '/groupes' };
    case 'game_invite': {
      const game = n.payload.game_type;
      const label = game ? GAME_LABELS[game] : 'une partie';
      return {
        text: `${who} t'attend pour une partie de ${label}.`,
        to: game && n.payload.room_code ? gameRoomPath(game, n.payload.room_code) : null,
      };
    }
    case 'achievement':
      return { text: `Trophée débloqué : ${n.payload.title ?? 'nouveau trophée'}.`, to: '/compte#trophees' };
    case 'fees':
      return {
        text: `+${(n.payload.amount ?? 0).toLocaleString('fr-FR')} FEES${n.payload.description ? ` — ${n.payload.description}` : ''}.`,
        to: '/compte#fees',
      };
    case 'badge':
      return {
        text: `Nouveau badge : ${n.payload.name ?? 'badge'}${n.payload.note ? ` — ${n.payload.note}` : ''}.`,
        to: '/compte#badges',
      };
    case 'event_completed':
      return {
        text: `Événement complété : ${n.payload.name ?? ''} ! Trophée débloqué${n.payload.fees ? `, +${n.payload.fees} FEES` : ''}.`,
        to: '/compte#trophees',
      };
    case 'warning':
      return { text: `Avertissement de l'équipe PLAFEE : ${n.payload.message ?? ''}`, to: '/cgu#8-sanctions' };
    case 'ban':
      return { text: `Ton compte est suspendu. Motif : ${n.payload.reason ?? 'non précisé'}.`, to: '/cgu#8-sanctions' };
    case 'unban':
      return { text: 'Ton compte n’est plus suspendu. Bon retour à la table !', to: null };
    case 'victory_confirmed': {
      const label = n.payload.game_type ? GAME_LABELS[n.payload.game_type] : 'ta partie';
      const what = n.payload.claim === 'chef' ? `Ta Roulette menée en chef` : `Ta victoire à ${label}`;
      return {
        text: n.payload.paid === false
          ? `${what} est confirmée (plafond du jour atteint : sans points ni FEES).`
          : `${what} est confirmée.`,
        to: '/compte',
      };
    }
    case 'victory_contested': {
      const label = n.payload.game_type ? GAME_LABELS[n.payload.game_type] : 'ta partie';
      return { text: `Ta victoire à ${label} est contestée par un adversaire : un admin va trancher.`, to: null };
    }
    case 'victory_rejected': {
      const label = n.payload.game_type ? GAME_LABELS[n.payload.game_type] : 'ta partie';
      return {
        text: `Ta victoire à ${label} n'a pas été retenue${n.payload.reason ? ` : ${n.payload.reason}` : ''}.`,
        to: null,
      };
    }
    case 'stats_reset':
      return { text: `Tes statistiques ont été remises à zéro. Motif : ${n.payload.reason ?? 'non précisé'}.`, to: '/cgu#8-sanctions' };
    default:
      return { text: 'Nouvelle notification.', to: null };
  }
}
