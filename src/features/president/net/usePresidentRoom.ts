import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { applyAction, createInitialState } from '../engine/rules';
import type { PresidentAction, PresidentOptions, PresidentState } from '../engine/types';
import {
  createSpectatorDesk,
  isSeatMessage,
  isSpectatorsMessage,
  type SeatMessage,
  type Spectator,
  type SpectatorsMessage,
} from '../../rooms/spectators';
import { getCurrentUserId } from '../../account/currentUser';
import { createBotRunner, LOCAL_SELF_ID, makeBots, type BotSetup } from '../../bots/bots';
import { presidentDecide } from '../engine/ai';
import { applyDeal, DEALS } from './seating';

const PEER_PREFIX = 'la-cafeteria-president-';

type WireMessage =
  | { type: 'ACTION'; action: PresidentAction }
  | { type: 'STATE'; state: PresidentState }
  | { type: 'ERROR'; message: string }
  | SpectatorsMessage
  | SeatMessage;

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

/**
 * Ce qu'un pair a le droit de voir. Les mains des autres partent vides
 * (`handCount` reste, pour l'éventail de dos), et le contenu d'un échange
 * n'est montré qu'à ses deux joueurs : les autres savent qu'il a eu lieu, pas
 * quelles cartes ont changé de main — sinon un Neutre connaîtrait les deux 2
 * que le Président vient de recevoir.
 */
function maskState(state: PresidentState, viewerId: string): PresidentState {
  const seat = state.players.findIndex((p) => p.id === viewerId);
  return {
    ...state,
    players: state.players.map((p) => (p.id === viewerId ? p : { ...p, hand: [] })),
    exchanges: state.exchanges.map((e) => (seat >= 0 && (e.from === seat || e.to === seat) ? e : { ...e, cards: [] })),
  };
}

interface UsePresidentRoomResult {
  state: PresidentState | null;
  selfId: string | null;
  isHost: boolean;
  status: ConnectionStatus;
  error: string | null;
  clearError: () => void;
  sendAction: (action: PresidentAction) => void;
  spectators: Spectator[];
  requestSeat: (want: boolean) => void;
}

/**
 * Même forme que les rooms d'UNO et de Scopa : l'hôte tient l'état qui fait
 * foi, passe chaque action dans le moteur pur et diffuse le résultat masqué
 * pour chaque destinataire. Les observateurs sont des connexions sans siège
 * (voir rooms/spectators.ts) ; contre des bots, aucune connexion du tout.
 */
export function usePresidentRoom(
  roomCode: string,
  playerName: string,
  isHost: boolean,
  maxPlayers: number,
  options: PresidentOptions,
  bots: BotSetup | null = null,
): UsePresidentRoomResult {
  const [state, setState] = useState<PresidentState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [spectators, setSpectators] = useState<Spectator[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const hostStateRef = useRef<PresidentState | null>(null);
  const connsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);
  const hostApplyRef = useRef<(action: PresidentAction) => string | undefined>(() => undefined);

  // Lus au moment de se connecter seulement : retaper son pseudo ou recréer
  // l'objet d'options à chaque rendu ne doit pas relancer le pair.
  const nameRef = useRef(playerName);
  nameRef.current = playerName;
  const optionsRef = useRef({ maxPlayers, ...options });
  optionsRef.current = { maxPlayers, ...options };

  useEffect(() => {
    let cancelled = false;
    const code = roomCode.trim().toUpperCase();
    const conns = connsRef.current;

    /** La table de départ : options, puis l'hôte assis au premier siège. */
    const openTable = (hostId: string, max: number) => {
      const { xOuRien, manches } = optionsRef.current;
      let initial = createInitialState(code, hostId, max);
      initial = applyAction(initial, { type: 'SET_OPTIONS', maxPlayers: max, xOuRien, manches }).state;
      return applyAction(initial, { type: 'JOIN', playerId: hostId, name: nameRef.current, userId: getCurrentUserId() }).state;
    };

    // Contre des bots : pas de réseau, la table vit dans ce navigateur.
    if (bots) {
      const seats = makeBots(bots);
      const runner = createBotRunner<PresidentState, PresidentAction>({
        get: () => hostStateRef.current,
        apply: (action) => hostApplyRef.current(action),
        decide: (s) => presidentDecide(s, seats),
      });
      const commit = (next: PresidentState) => {
        hostStateRef.current = next;
        setState(maskState(next, LOCAL_SELF_ID));
        runner.poke();
      };
      hostApplyRef.current = (action) => {
        if (!hostStateRef.current) return undefined;
        const { state: next, error: err } = applyAction(hostStateRef.current, action);
        commit(next);
        return err;
      };
      let initial = openTable(LOCAL_SELF_ID, seats.length + 1);
      for (const b of seats) initial = applyAction(initial, { type: 'JOIN', playerId: b.id, name: b.name }).state;
      setSelfId(LOCAL_SELF_ID);
      commit(applyAction(initial, { type: 'START' }).state);
      setStatus('connected');
      return () => {
        runner.stop();
        hostApplyRef.current = () => undefined;
      };
    }

    if (isHost) {
      const hostId = PEER_PREFIX + code;
      const peer = new Peer(hostId);
      peerRef.current = peer;

      const broadcast = (next: PresidentState) => {
        for (const [peerId, conn] of conns) {
          if (conn.open) conn.send({ type: 'STATE', state: maskState(next, peerId) } satisfies WireMessage);
        }
      };

      const commit = (next: PresidentState) => {
        // La référence garde la vérité ; toutes ses vues, celle de l'hôte comprise, sont masquées.
        hostStateRef.current = next;
        setState(maskState(next, hostId));
        broadcast(next);
      };

      const desk = createSpectatorDesk((list) => {
        setSpectators(list);
        for (const conn of conns.values()) {
          if (conn.open) conn.send({ type: 'SPECTATORS', spectators: list } satisfies WireMessage);
        }
      });

      // Le compte annoncé par chaque connexion à son arrivée, gardé même quand
      // elle ne fait que regarder : s'il s'assoit plus tard, c'est lui qui
      // prend le siège, pas le compte du partant (voir seating.ts).
      const userIds = new Map<string, string | null>();

      // Chaque nouvelle donne (lancement, manche suivante, revanche) redonne
      // les sièges laissés vides aux observateurs qui attendent. Le nouveau
      // venu hérite du score et du rôle du partant : l'échange se fait avec lui.
      hostApplyRef.current = (action) => {
        const current = hostStateRef.current;
        if (!current) return undefined;
        const { state: next, error: err } = DEALS.has(action.type)
          ? applyDeal(current, action, desk, userIds)
          : applyAction(current, action);
        commit(next);
        return err;
      };

      peer.on('open', (id) => {
        if (cancelled) return;
        setSelfId(id);
        const initial = openTable(id, optionsRef.current.maxPlayers);
        hostStateRef.current = initial;
        setState(maskState(initial, id));
        setStatus('connected');
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          conns.set(conn.peer, conn);
          if (hostStateRef.current) {
            conn.send({ type: 'STATE', state: maskState(hostStateRef.current, conn.peer) } satisfies WireMessage);
          }
        });

        conn.on('data', (data) => {
          if (!hostStateRef.current) return;
          if (isSeatMessage(data)) {
            desk.setWant(conn.peer, data.want);
            return;
          }
          const msg = data as WireMessage;
          if (msg.type !== 'ACTION') return;

          if (msg.action.type === 'JOIN') {
            userIds.set(conn.peer, msg.action.userId ?? null);
            const joined = applyAction(hostStateRef.current, { ...msg.action, playerId: conn.peer });
            if (joined.state.players.some((p) => p.id === conn.peer)) {
              commit(joined.state);
            } else if (desk.add(conn.peer, msg.action.name)) {
              // Partie lancée ou table pleine : il regarde.
              conn.send({ type: 'SPECTATORS', spectators: desk.list() } satisfies WireMessage);
            } else {
              conn.send({ type: 'ERROR', message: 'Table complète, même pour regarder.' } satisfies WireMessage);
            }
            return;
          }

          // Les observateurs ne jouent pas, et personne ne joue pour un autre.
          // Les actions réservées à l'hôte (options, lancement, manche
          // suivante, revanche) ne passent jamais par le réseau.
          if (desk.has(conn.peer)) return;
          const type = msg.action.type;
          if (type === 'SET_OPTIONS' || type === 'START' || type === 'NEXT_MANCHE' || type === 'REMATCH') return;
          const action = { ...msg.action, playerId: conn.peer } as PresidentAction;
          const err = hostApplyRef.current(action);
          if (err && conn.open) conn.send({ type: 'ERROR', message: err } satisfies WireMessage);
        });

        conn.on('close', () => {
          conns.delete(conn.peer);
          userIds.delete(conn.peer);
          if (desk.has(conn.peer)) {
            desk.remove(conn.peer);
            return;
          }
          if (!hostStateRef.current) return;
          commit(applyAction(hostStateRef.current, { type: 'LEAVE', playerId: conn.peer }).state);
        });
      });

      peer.on('error', (err) => {
        if (cancelled) return;
        setError(
          (err as { type?: string }).type === 'unavailable-id'
            ? 'Ce code de room est déjà utilisé. Reviens en arrière et recrée une partie.'
            : 'Erreur de connexion : ' + err.message,
        );
        setStatus('error');
      });
    } else {
      const peer = new Peer();
      peerRef.current = peer;

      peer.on('open', (id) => {
        if (cancelled) return;
        setSelfId(id);
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
        hostConnRef.current = conn;

        conn.on('open', () => {
          conn.send({
            type: 'ACTION',
            action: { type: 'JOIN', playerId: id, name: nameRef.current, userId: getCurrentUserId() },
          } satisfies WireMessage);
          setStatus('connected');
        });
        conn.on('data', (data) => {
          if (isSpectatorsMessage(data)) {
            setSpectators(data.spectators);
            return;
          }
          const msg = data as WireMessage;
          if (msg.type === 'STATE') setState(msg.state);
          if (msg.type === 'ERROR') setError(msg.message);
        });
        conn.on('close', () => {
          if (cancelled) return;
          setStatus('error');
          setError("La connexion avec l'hôte a été perdue.");
        });
        conn.on('error', (err) => {
          if (cancelled) return;
          setStatus('error');
          setError('Impossible de rejoindre la room : ' + err.message);
        });
      });

      peer.on('error', (err) => {
        if (cancelled) return;
        setStatus('error');
        setError('Room introuvable. Vérifie le code avec ton pote. (' + err.message + ')');
      });
    }

    return () => {
      cancelled = true;
      peerRef.current?.destroy();
      conns.clear();
      hostApplyRef.current = () => undefined;
    };
  }, [roomCode, isHost, bots]);

  const sendAction = useCallback(
    (action: PresidentAction) => {
      if (isHost) {
        const err = hostApplyRef.current(action);
        if (err) setError(err);
      } else {
        hostConnRef.current?.send({ type: 'ACTION', action } satisfies WireMessage);
      }
    },
    [isHost],
  );

  const requestSeat = useCallback((want: boolean) => {
    hostConnRef.current?.send({ type: 'SEAT', want } satisfies WireMessage);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { state, selfId, isHost, status, error, clearError, sendAction, spectators, requestSeat };
}
