import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { applyAction, createInitialState, maskState, playableThemes, revealDuration, SPIN_MS } from '../engine/rules';
import type { VeriteAction, VeriteState, VeriteTheme } from '../engine/types';
import { fetchPublicQuestions, isQuestionUuid, markQuestionUsed, publicQuestionUuid } from '../api';
import { getCurrentUserId } from '../../account/currentUser';

const PEER_PREFIX = 'la-cafeteria-verite-';

type WireMessage =
  | { type: 'ACTION'; action: VeriteAction }
  | { type: 'STATE'; state: VeriteState }
  | { type: 'ERROR'; message: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

/** Ce que la création de partie ou le salon d'accueil transmet à la room. */
export interface RoomSetup {
  theme: VeriteTheme;
  rounds: number;
  hostIsChef: boolean;
  customs: { text: string; theme: VeriteTheme; publicId?: string }[];
}

interface UseVeriteRoomResult {
  state: VeriteState | null;
  selfId: string | null;
  status: ConnectionStatus;
  error: string | null;
  clearError: () => void;
  sendAction: (action: VeriteAction) => void;
  /** L'hôte lit le pool public avant de lancer : le bouton attend. */
  starting: boolean;
}

/** Le pool public ne doit pas retenir le lancement : au-delà, on joue sans. */
const POOL_TIMEOUT_MS = 2500;

/**
 * La room, sur le modèle des autres jeux : l'hôte tient l'état, applique
 * chaque action via le moteur pur et diffuse le résultat masqué à chacun.
 *
 * En plus, l'hôte *cadence* la manche : la bouteille tourne, puis la carte se
 * retourne, puis la saisie s'ouvre. Ces étapes partent de ses minuteries, pour
 * que tous les écrans les vivent au même moment — un joueur ne peut pas
 * répondre avant que la question ait fini de s'écrire chez les autres.
 */
export function useVeriteRoom(roomCode: string, playerName: string, isHost: boolean, setup: RoomSetup | null): UseVeriteRoomResult {
  const [state, setState] = useState<VeriteState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const hostStateRef = useRef<VeriteState | null>(null);
  const connsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);
  const hostApplyRef = useRef<(action: VeriteAction) => string | undefined>(() => undefined);
  const hostStartRef = useRef<() => void>(() => {});

  // Lus au moment de la connexion seulement : retaper son pseudo ne relance pas la room.
  const nameRef = useRef(playerName);
  nameRef.current = playerName;
  const setupRef = useRef(setup);

  useEffect(() => {
    let cancelled = false;
    const code = roomCode.trim().toUpperCase();
    const conns = connsRef.current;
    const timers = { key: '', id: 0 as ReturnType<typeof setTimeout> | 0 };
    const clearTimer = () => {
      if (timers.id) clearTimeout(timers.id);
      timers.id = 0;
      timers.key = '';
    };

    if (isHost) {
      const hostId = PEER_PREFIX + code;
      const peer = new Peer(hostId);
      peerRef.current = peer;
      let counted = '';

      const broadcast = (next: VeriteState) => {
        for (const [peerId, conn] of conns) {
          if (conn.open) conn.send({ type: 'STATE', state: maskState(next, peerId) } satisfies WireMessage);
        }
      };

      /** Programme l'étape suivante de la manche, une seule fois par étape. */
      const schedule = (next: VeriteState) => {
        const round = next.round;
        const stage = next.phase === 'playing' ? round?.stage : undefined;
        if (!round || (stage !== 'spinning' && stage !== 'reveal')) {
          clearTimer();
          return;
        }
        const key = `${round.seq}:${round.draw}:${stage}`;
        if (timers.key === key) return;
        clearTimer();
        timers.key = key;
        const to = stage === 'spinning' ? 'reveal' : 'answering';
        const delay = stage === 'spinning' ? SPIN_MS : revealDuration(round.question.text);
        timers.id = setTimeout(() => {
          timers.id = 0;
          hostApplyRef.current({ type: 'ADVANCE', seq: round.seq, draw: round.draw, to });
        }, delay);

        // Une question publique qui sort : on la compte, une fois.
        const uuid = stage === 'reveal' ? publicQuestionUuid(round.question) : null;
        if (uuid && counted !== key) {
          counted = key;
          markQuestionUsed(uuid);
        }
      };

      const commit = (next: VeriteState) => {
        hostStateRef.current = next;
        setState(maskState(next, hostId));
        broadcast(next);
        schedule(next);
      };

      hostApplyRef.current = (action) => {
        const current = hostStateRef.current;
        if (!current) return undefined;
        const { state: next, error: err } = applyAction(current, action);
        if (next !== current) commit(next);
        return err;
      };

      // Lancer : d'abord le pool public (s'il répond vite), puis la partie.
      let startBusy = false;
      hostStartRef.current = () => {
        const current = hostStateRef.current;
        if (!current || startBusy) return;
        // Les vérifications (chef, nombre de joueurs) sans attendre la base.
        const probe = applyAction(current, { type: 'START', playerId: hostId });
        if (probe.error) {
          setError(probe.error);
          return;
        }
        startBusy = true;
        setStarting(true);
        const timeout = new Promise<[]>((resolve) => setTimeout(() => resolve([]), POOL_TIMEOUT_MS));
        Promise.race([fetchPublicQuestions(playableThemes(current.theme)), timeout]).then((pool) => {
          startBusy = false;
          if (cancelled) return;
          setStarting(false);
          const err = hostApplyRef.current({ type: 'START', playerId: hostId, publicPool: pool });
          if (err) setError(err);
        });
      };

      peer.on('open', (id) => {
        if (cancelled) return;
        setSelfId(id);
        const opts = setupRef.current;
        let initial = createInitialState(code, id, crypto.getRandomValues(new Uint32Array(1))[0]);
        initial = applyAction(initial, { type: 'JOIN', playerId: id, name: nameRef.current, userId: getCurrentUserId() }).state;
        if (opts) {
          initial = applyAction(initial, { type: 'SET_OPTIONS', playerId: id, theme: opts.theme, rounds: opts.rounds }).state;
          if (opts.hostIsChef) initial = applyAction(initial, { type: 'SET_CHEF', playerId: id, chefId: id }).state;
          for (const q of opts.customs) {
            initial = applyAction(initial, { type: 'ADD_CUSTOM', playerId: id, ...q }).state;
          }
        }
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
          const msg = data as WireMessage;
          if (!hostStateRef.current || msg?.type !== 'ACTION' || !msg.action) return;
          const incoming = msg.action;
          // La cadence et le pool public sont l'affaire de l'hôte seul.
          if (incoming.type === 'ADVANCE' || incoming.type === 'START') return;
          // Personne n'agit au nom d'un autre.
          const action = { ...incoming, playerId: conn.peer } as VeriteAction;
          if (action.type === 'ADD_CUSTOM' && action.publicId && !isQuestionUuid(action.publicId)) {
            delete action.publicId;
          }
          const err = hostApplyRef.current(action);
          if (err && conn.open) conn.send({ type: 'ERROR', message: err } satisfies WireMessage);
        });

        conn.on('close', () => {
          conns.delete(conn.peer);
          hostApplyRef.current({ type: 'LEAVE', playerId: conn.peer });
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
        let customsSent = false;

        conn.on('open', () => {
          conn.send({ type: 'ACTION', action: { type: 'JOIN', playerId: id, name: nameRef.current, userId: getCurrentUserId() } } satisfies WireMessage);
          setStatus('connected');
        });
        conn.on('data', (data) => {
          const msg = data as WireMessage;
          if (msg?.type === 'STATE') {
            setState(msg.state);
            // Les questions préparées à l'accueil partent une fois assis.
            if (!customsSent && msg.state.players.some((p) => p.id === id)) {
              customsSent = true;
              for (const q of setupRef.current?.customs ?? []) {
                conn.send({ type: 'ACTION', action: { type: 'ADD_CUSTOM', playerId: id, ...q } } satisfies WireMessage);
              }
            }
          }
          if (msg?.type === 'ERROR') setError(msg.message);
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
      clearTimer();
      peerRef.current?.destroy();
      conns.clear();
      hostApplyRef.current = () => undefined;
      hostStartRef.current = () => {};
    };
  }, [roomCode, isHost]);

  const sendAction = useCallback(
    (action: VeriteAction) => {
      if (isHost) {
        if (action.type === 'START') {
          hostStartRef.current();
          return;
        }
        const err = hostApplyRef.current(action);
        if (err) setError(err);
      } else {
        hostConnRef.current?.send({ type: 'ACTION', action } satisfies WireMessage);
      }
    },
    [isHost],
  );

  const clearError = useCallback(() => setError(null), []);

  return { state, selfId, status, error, clearError, sendAction, starting };
}
