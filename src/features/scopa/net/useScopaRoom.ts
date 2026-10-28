import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { applyAction, createInitialState } from '../engine/rules';
import type { GameState, ScopaAction } from '../engine/types';
import {
  createSpectatorDesk,
  isSeatMessage,
  isSpectatorsMessage,
  withSeatsFilled,
  type SeatMessage,
  type Spectator,
  type SpectatorsMessage,
} from '../../rooms/spectators';
import { getCurrentUserId } from '../../account/currentUser';
import { createBotRunner, LOCAL_SELF_ID, makeBots, type BotSetup } from '../../bots/bots';
import { scopaDecide } from '../engine/ai';

const PEER_PREFIX = 'la-cafeteria-scopa-';

type WireMessage =
  | { type: 'ACTION'; action: ScopaAction }
  | { type: 'STATE'; state: GameState }
  | { type: 'ERROR'; message: string }
  | SpectatorsMessage
  | SeatMessage;

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

interface UseScopaRoomResult {
  state: GameState | null;
  selfId: string | null;
  isHost: boolean;
  status: ConnectionStatus;
  error: string | null;
  sendAction: (action: ScopaAction) => void;
  spectators: Spectator[];
  requestSeat: (want: boolean) => void;
}

/**
 * Les mains des autres, et l'ordre de la pioche : seul son nombre de cartes
 * s'affiche, son contenu dirait à l'avance ce que chacun va recevoir.
 */
function maskState(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    deck: state.deck.map((_, i) => ({ id: `hidden-${i}`, suit: 'denari' as const, rank: 0 })),
    players: state.players.map((p) => (p.id === viewerId ? p : { ...p, hand: [] })),
  };
}

export function useScopaRoom(roomCode: string, playerName: string, isHost: boolean, bots: BotSetup | null = null): UseScopaRoomResult {
  const [state, setState] = useState<GameState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [spectators, setSpectators] = useState<Spectator[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const hostStateRef = useRef<GameState | null>(null);
  const connsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);
  const hostApplyRef = useRef<(action: ScopaAction) => string | undefined>(() => undefined);
  const nameRef = useRef(playerName);
  nameRef.current = playerName;

  useEffect(() => {
    let cancelled = false;
    const code = roomCode.trim().toUpperCase();

    // Contre des bots : pas de réseau, la table vit dans ce navigateur.
    if (bots) {
      const seats = makeBots(bots);
      const runner = createBotRunner<GameState, ScopaAction>({
        get: () => hostStateRef.current,
        apply: (action) => hostApplyRef.current(action),
        decide: (s) => scopaDecide(s, seats),
      });
      const commit = (next: GameState) => {
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
      let initial = applyAction(createInitialState(code, LOCAL_SELF_ID), { type: 'JOIN', playerId: LOCAL_SELF_ID, name: nameRef.current, userId: getCurrentUserId() }).state;
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

      const broadcast = (next: GameState) => {
        for (const [pid, conn] of connsRef.current) {
          if (conn.open) conn.send({ type: 'STATE', state: maskState(next, pid) } satisfies WireMessage);
        }
      };

      const desk = createSpectatorDesk((list) => {
        setSpectators(list);
        for (const conn of connsRef.current.values()) {
          if (conn.open) conn.send({ type: 'SPECTATORS', spectators: list } satisfies WireMessage);
        }
      });

      const commit = (next: GameState) => {
        hostStateRef.current = next;
        setState(maskState(next, hostId));
        broadcast(next);
      };

      // Une manche qui commence est le moment de rendre les sièges vides.
      const apply = (action: ScopaAction) => {
        const current = hostStateRef.current!;
        return action.type === 'NEXT_HAND' || action.type === 'START'
          ? withSeatsFilled(current, desk, (s) => applyAction(s, action))
          : applyAction(current, action);
      };

      hostApplyRef.current = (action) => {
        if (!hostStateRef.current) return undefined;
        const { state: next, error: err } = apply(action);
        commit(next);
        return err;
      };

      peer.on('open', (id) => {
        if (cancelled) return;
        setSelfId(id);
        const initial = applyAction(createInitialState(code, id), {
          type: 'JOIN',
          playerId: id,
          name: nameRef.current,
          userId: getCurrentUserId(),
        }).state;
        hostStateRef.current = initial;
        setState(maskState(initial, id));
        setStatus('connected');
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          connsRef.current.set(conn.peer, conn);
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
            const joined = applyAction(hostStateRef.current, { ...msg.action, playerId: conn.peer });
            if (joined.state.players.some((p) => p.id === conn.peer)) {
              commit(joined.state);
              return;
            }
            // Partie commencée ou table complète : on regarde.
            if (!desk.add(conn.peer, msg.action.name)) {
              conn.send({ type: 'ERROR', message: 'Table complète, même pour regarder.' } satisfies WireMessage);
              return;
            }
            conn.send({ type: 'STATE', state: maskState(hostStateRef.current, conn.peer) } satisfies WireMessage);
            conn.send({ type: 'SPECTATORS', spectators: desk.list() } satisfies WireMessage);
            return;
          }

          // Un observateur ne joue pas, et personne ne joue à la place d'un autre.
          if (desk.has(conn.peer)) return;
          const action = 'playerId' in msg.action ? { ...msg.action, playerId: conn.peer } : msg.action;
          const err = hostApplyRef.current(action as ScopaAction);
          if (err && conn.open) conn.send({ type: 'ERROR', message: err } satisfies WireMessage);
        });
        conn.on('close', () => {
          connsRef.current.delete(conn.peer);
          if (desk.has(conn.peer)) {
            desk.remove(conn.peer);
            return;
          }
          if (!hostStateRef.current) return;
          const next = applyAction(hostStateRef.current, { type: 'LEAVE', playerId: conn.peer }).state;
          commit(next);
        });
      });

      peer.on('error', (err) => {
        if (cancelled) return;
        if ((err as { type?: string }).type === 'unavailable-id') {
          setError('Ce code de room est déjà utilisé. Choisis-en un autre.');
        } else {
          setError('Erreur de connexion : ' + err.message);
        }
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
          conn.send({ type: 'ACTION', action: { type: 'JOIN', playerId: id, name: nameRef.current, userId: getCurrentUserId() } } satisfies WireMessage);
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
      connsRef.current.clear();
      hostApplyRef.current = () => undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, isHost]);

  const sendAction = useCallback(
    (action: ScopaAction) => {
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

  return { state, selfId, isHost, status, error, sendAction, spectators, requestSeat };
}
