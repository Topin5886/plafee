import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { BookOpen, Check, Copy, Gift, Hand, Layers, LogOut, ScrollText, TriangleAlert, Zap } from 'lucide-react';
import { GameTitle } from '../../components/GameTitle';
import { usePresidentRoom } from './net/usePresidentRoom';
import { RANK_NAME, ROLE_LABEL, describePlay } from './engine/deck';
import {
  canPass,
  canPlayCards,
  DEFAULT_MANCHES,
  legalPlays,
  MANCHE_CHOICES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  requiredCount,
  roleOf,
  topPlay,
} from './engine/rules';
import type { PresidentCard, PresidentOptions, PresidentState } from './engine/types';
import { PresidentTable } from './components/PresidentTable';
import { PresidentHand } from './components/PresidentHand';
import { PresidentRulesModal } from './components/PresidentRulesModal';
import { FLASH_SECONDS, type PresidentShot } from './components/PresidentFlash';
import { PresidentMancheEnd } from './components/PresidentMancheEnd';
import { PresidentVictory } from './components/PresidentVictory';
import { ExchangePanel, ExchangeRecap } from './components/ExchangePanel';
import { RoleBadge } from './components/RoleBadge';
import { cardCount, placeLabel, placeName } from './components/labels';
import { useRecordGame } from '../account/useRecordGame';
import { presidentOutcome } from '../account/gameOutcomes';
import { GameRecordBadge } from '../account/components/GameRecordBadge';
import { InviteFriendsButton } from '../social/components/InviteFriendsButton';
import { ObserverBar } from '../rooms/ObserverBar';
import { useRoomSession } from '../rooms/useRoomSession';
import { vacatedSeats } from '../rooms/spectators';
import { useRoomIdentity } from '../rooms/playerName';
import { useOpponentVictory } from '../plafee/seatCosmetics';
import { SeatAvatar } from '../plafee/components/SeatFlair';
import { isBotRoomCode, type BotSetup } from '../bots/bots';
import './president.css';

interface LocationState {
  isHost?: boolean;
  name?: string;
  maxPlayers?: number;
  xOuRien?: boolean;
  manches?: number;
  /** Choisi à la création : une table publique est annoncée aux amis. */
  visibility?: 'public' | 'private';
  /** Contre des bots : aucune connexion, la table vit dans ce navigateur. */
  bots?: BotSetup;
}

/** Les tailles de table que l'hôte peut choisir en salle d'attente. */
const SEAT_CHOICES = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

export function PresidentRoom() {
  const { code = '' } = useParams();
  const location = useLocation();
  const navState = (location.state as LocationState | null) ?? null;

  // Connecté, on entre sous le pseudo du compte sans formulaire.
  const identity = useRoomIdentity(navState?.name);
  const isPublic = navState?.visibility === 'public';
  const isHost = Boolean(navState?.isHost);
  const bots = navState?.bots ?? null;
  // Sans taille choisie (un défi lancé depuis la liste d'amis, qui ne connaît
  // pas les règles de chaque jeu), la plus petite table : celle qui se remplit
  // le plus vite. L'hôte l'agrandit en salle d'attente.
  const maxPlayers = navState?.maxPlayers ?? MIN_PLAYERS;
  const xOuRien = navState?.xOuRien ?? true;
  const manches = navState?.manches ?? DEFAULT_MANCHES;

  // Une table de bots ne survit pas à un rechargement : retour au salon.
  if (isBotRoomCode(code) && !bots) return <Navigate to="/president" replace />;

  if (identity.pending) {
    return (
      <div className="container p4-lobby">
        <p role="status">Connexion à ton compte…</p>
      </div>
    );
  }

  if (!identity.joined) {
    return (
      <div className="container p4-lobby">
        <h1>Rejoindre la room {code}</h1>
        <form
          className="p4-lobby-card"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            identity.confirm();
          }}
        >
          <label htmlFor="pres-pseudo2">Ton pseudo</label>
          <input
            id="pres-pseudo2"
            type="text"
            maxLength={18}
            value={identity.typed}
            onChange={(e) => identity.setTyped(e.target.value)}
            placeholder="ex: Jules"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!identity.typed.trim()}>
            Rejoindre la partie
          </button>
        </form>
        <Link to="/president" className="p4-back-link">
          ← Retour au menu Président
        </Link>
      </div>
    );
  }

  return (
    <PresidentGameView
      code={code}
      name={identity.name}
      isHost={isHost}
      isPublic={isPublic}
      maxPlayers={maxPlayers}
      options={{ xOuRien, manches }}
      bots={bots}
    />
  );
}

/*
 * Les annonces, déduites du dernier événement du moteur. Le 2 et le carré
 * se lisent sur `trick` (le pli fermé dit pourquoi), le « X ou rien » sur la
 * pose qui vient de le déclencher.
 */
function shotFor(state: PresidentState): Omit<PresidentShot, 'key'> | null {
  const e = state.lastEvent;
  const who = e.by !== undefined ? (state.players[e.by]?.name ?? '') : '';
  const n = state.players.length;
  switch (e.kind) {
    case 'out': {
      const place = e.place ?? 0;
      if (place === 0) return { title: 'PRÉSIDENT !', sub: `${who} sort en premier`, tone: 'gold', icon: 'crown' };
      const role = roleOf(place, n);
      return {
        title: `${placeLabel(place)} : ${ROLE_LABEL[role]}`,
        sub: `${who} n'a plus de cartes`,
        tone: role === 'vice-president' ? 'cyan' : 'neon',
        icon: 'out',
      };
    }
    case 'trick':
      if (e.reason === 'quad') return { title: 'CARRÉ !', sub: `${who} coupe et rejoue`, tone: 'magenta', icon: 'quad' };
      if (e.reason === 'two') return { title: '2 — pli coupé', sub: `${who} rejoue`, tone: 'cyan', icon: 'two' };
      return null;
    case 'play':
      if (state.options.xOuRien && state.forcedRank !== null) {
        return {
          title: `${RANK_NAME[state.forcedRank]} ou rien !`,
          sub: `${state.players[state.turn]?.name ?? ''} doit suivre ou passer`,
          tone: 'magenta',
          icon: 'forced',
        };
      }
      return null;
    // Pas d'annonce en fin de manche : la feuille de score qui s'ouvre dit
    // déjà qui finit Trou du cul, et l'annonce la chevauchait.
    case 'deal':
      return {
        title: `Manche ${state.manche}`,
        sub: state.manche > 1 ? 'Place à l’échange' : 'Distribution',
        tone: 'neon',
        icon: 'deal',
      };
    default:
      return null;
  }
}

/**
 * La consigne du dock : ce qu'on attend de toi, ou de qui on attend. C'est
 * l'unique indicateur de tour (la table ne décrit que le pli) et une région
 * `status` : elle ne change qu'au changement de tour, donc « À toi » n'est
 * annoncé qu'une fois.
 */
function turnHint(state: PresidentState, seat: number, legalCount: number): ReactNode {
  const turnName = state.players[state.turn]?.name ?? '';
  if (state.phase === 'exchange') {
    const mine = state.exchanges.find((e) => e.from === seat && e.kind === 'choice' && !e.done);
    if (mine) {
      return (
        <>
          <strong>À toi</strong> : choisis {cardCount(mine.count)} à rendre à {state.players[mine.to]?.name}
        </>
      );
    }
    const waiting = state.exchanges.filter((e) => e.kind === 'choice' && !e.done).map((e) => state.players[e.from]?.name);
    return waiting.length ? <>En attente de {waiting.join(' et ')}…</> : <>Échange des cartes…</>;
  }
  if (state.phase !== 'playing') return null;

  const me = seat >= 0 ? state.players[seat] : undefined;
  if (me && me.finishedAt !== null) {
    return (
      <>
        Tu as fini à la <strong>{placeName(me.finishedAt)}</strong> : tu seras{' '}
        {ROLE_LABEL[roleOf(me.finishedAt, state.players.length)]}. La manche continue sans toi.
      </>
    );
  }
  // Le « X ou rien » se lit sur la puce du pli : la consigne ne le répète pas.
  if (!me || state.turn !== seat) return <>Au tour de {turnName}…</>;

  const top = topPlay(state);
  const need = requiredCount(state);
  if (!top || need === null) {
    return (
      <>
        <strong>À toi d'ouvrir</strong> : pose 1 à 4 cartes de même valeur
      </>
    );
  }
  const stuck = legalCount === 0 ? <> — rien ne passe, il faut passer</> : null;
  if (state.forcedRank !== null) {
    return (
      <>
        <strong>À toi</strong> : pose {describePlay(state.forcedRank, need)} ou passe{stuck}
      </>
    );
  }
  return (
    <>
      <strong>À toi</strong> : pose {describePlay(top.rank, need)} ou mieux, ou passe{stuck}
    </>
  );
}

function PresidentGameView({
  code,
  name,
  isHost,
  maxPlayers,
  options,
  isPublic,
  bots,
}: {
  code: string;
  name: string;
  isHost: boolean;
  isPublic: boolean;
  maxPlayers: number;
  options: PresidentOptions;
  bots: BotSetup | null;
}) {
  const { state, selfId, status, error, clearError, sendAction, spectators, requestSeat } = usePresidentRoom(
    code,
    name,
    isHost,
    maxPlayers,
    options,
    bots,
  );

  const [rulesOpen, setRulesOpen] = useState(false);
  const [flash, setFlash] = useState<PresidentShot | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // La sélection appartient à un moment précis du jeu (voir `selectionKey`) :
  // dès que le pli, le tour ou la phase change, elle est périmée d'elle-même.
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  // La manche dont le récapitulatif d'échange a été fermé.
  const [recapClosed, setRecapClosed] = useState(0);

  const seenSeqRef = useRef<number | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLockRef = useRef(false);
  // Appartient à l'*événement*, pas au rendu qui l'a remarqué : vidé au
  // démontage seulement, pour qu'une diffusion suivante n'annule pas une annonce.
  const fxTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => fxTimersRef.current.forEach(clearTimeout), []);

  const seat = state?.players.findIndex((p) => p.id === selfId) ?? -1;
  const me = seat >= 0 ? state?.players[seat] : undefined;
  const myTurn = Boolean(state && me && state.phase === 'playing' && state.turn === seat && me.finishedAt === null);
  // Connecté, servi par l'hôte, mais sans siège : il regarde.
  const isSpectator = Boolean(state && selfId && seat < 0 && spectators.some((s) => s.id === selfId));

  useRoomSession({
    game: 'president',
    code: code.toUpperCase(),
    isHost,
    isPublic,
    role: !state || bots ? null : isSpectator ? 'spectator' : seat >= 0 ? 'player' : null,
    status: state?.phase === 'lobby' ? 'waiting' : 'playing',
    players: state?.players.filter((p) => p.connected).length ?? 0,
    maxPlayers: state?.maxPlayers ?? maxPlayers,
    spectators: spectators.length,
  });

  // `null` tant que la dernière manche n'est pas jouée. Les compteurs des
  // trophées (carrés, 2, séries) sont tenus par le moteur, identiques chez tous.
  const record = useRecordGame(presidentOutcome(state, selfId, code));

  // Un autre joueur gagne : tout le monde voit son animation.
  const champion = state && state.phase === 'over' && state.winner !== null && state.winner !== seat ? state.players[state.winner] : null;
  useOpponentVictory(champion && state ? { userId: champion.userId, name: champion.name, key: String(state.lastEvent.seq) } : null);

  // Les annonces suivent `lastEvent.seq`, pas une comparaison d'états : deux
  // carrés de suite sont deux événements. Le premier état reçu n'annonce rien
  // — arriver en cours de partie ne doit pas rejouer le dernier coup.
  useEffect(() => {
    if (!state) return;
    const seq = state.lastEvent.seq;
    if (seenSeqRef.current === seq) return;
    const first = seenSeqRef.current === null;
    seenSeqRef.current = seq;
    if (first) return;
    const shot = shotFor(state);
    if (!shot) return;
    setFlash({ ...shot, key: seq });
    fxTimersRef.current.push(
      setTimeout(() => setFlash((cur) => (cur?.key === seq ? null : cur)), FLASH_SECONDS * 1000 + 150),
    );
  }, [state]);

  useEffect(() => {
    if (!error) return;
    setActionError(error);
    const t = setTimeout(() => {
      setActionError(null);
      clearError();
    }, 3800);
    return () => clearTimeout(t);
  }, [error, clearError]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  /** Anti double-tap : un clic impatient ne doit pas jouer deux tours. */
  const guardedSend = useCallback((fn: () => void) => {
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    setTimeout(() => {
      sendLockRef.current = false;
    }, 300);
    fn();
  }, []);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  if (status === 'connecting') {
    return (
      <div className="container p4-status">
        <p>Connexion à la room {code}...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="container p4-status">
        <p className="p4-form-error">{error ?? 'Une erreur est survenue.'}</p>
        <Link to="/president" className="btn btn-outline">
          ← Retour au menu Président
        </Link>
      </div>
    );
  }

  if (!state) return null;

  const inGame = state.phase !== 'lobby';
  const hand = me?.hand ?? [];

  // --- Sélection -----------------------------------------------------------
  const giving =
    state.phase === 'exchange' ? state.exchanges.find((e) => e.from === seat && e.kind === 'choice' && !e.done) : undefined;
  const selectionKey = `${state.phase}|${state.manche}|${state.turn}|${state.trick.length}|${giving ? 'don' : ''}`;
  const selected = selection.key === selectionKey ? selection.ids.filter((id) => hand.some((c) => c.id === id)) : [];
  const setSelected = (ids: string[]) => setSelection({ key: selectionKey, ids });
  const selectedCards = hand.filter((c) => selected.includes(c.id));

  const need = state.phase === 'playing' ? requiredCount(state) : null;
  const following = myTurn && need !== null;
  // Les valeurs qui passent sur ce pli : le moteur les connaît, l'écran s'y fie.
  const legalRanks = following ? new Set(legalPlays(state, seat).map((p) => p[0]?.rank)) : null;
  const rankOf = (id: string) => hand.find((c) => c.id === id)?.rank;

  /*
   * Un clic, selon le moment :
   *   - à l'échange : on coche ou décoche, jusqu'au nombre de cartes dû ;
   *   - en ouverture : on ajoute ou retire des cartes d'une même valeur (une
   *     autre valeur repart de zéro) ;
   *   - en suivant : un clic prend d'office autant de cartes de cette valeur
   *     que le pli en demande, un second clic sur une carte prise les repose.
   */
  const handleToggle = (card: PresidentCard) => {
    if (giving) {
      if (selected.includes(card.id)) setSelected(selected.filter((id) => id !== card.id));
      else setSelected([...selected, card.id].slice(-giving.count));
      return;
    }
    if (!myTurn) return;
    if (need === null) {
      if (selected.includes(card.id)) setSelected(selected.filter((id) => id !== card.id));
      else setSelected(selected.length && rankOf(selected[0]) === card.rank ? [...selected, card.id] : [card.id]);
      return;
    }
    if (legalRanks && !legalRanks.has(card.rank)) return;
    if (selected.includes(card.id)) {
      setSelected([]);
      return;
    }
    if (selected.length >= need && rankOf(selected[0]) === card.rank) {
      // Même valeur, déjà au complet : la carte cliquée prend la place d'une autre.
      setSelected([...selected.slice(0, need - 1), card.id]);
      return;
    }
    const others = hand.filter((c) => c.rank === card.rank && c.id !== card.id).map((c) => c.id);
    setSelected([card.id, ...others].slice(0, need));
  };

  const playError = myTurn && selectedCards.length > 0 ? canPlayCards(state, seat, selectedCards) : null;
  const canPlayNow = myTurn && selectedCards.length > 0 && playError === null;
  const canPassNow = myTurn && canPass(state, seat);

  const handlePlay = () =>
    guardedSend(() => {
      if (!selfId || !canPlayNow) return;
      sendAction({ type: 'PLAY', playerId: selfId, cardIds: selectedCards.map((c) => c.id) });
      setSelected([]);
    });
  const handlePass = () =>
    guardedSend(() => {
      if (!selfId || !canPassNow) return;
      sendAction({ type: 'PASS', playerId: selfId });
      setSelected([]);
    });
  const handleGive = () =>
    guardedSend(() => {
      if (!selfId || !giving || selected.length !== giving.count) return;
      sendAction({ type: 'GIVE', playerId: selfId, cardIds: selected });
      setSelected([]);
    });

  // Les cartes reçues à l'échange de cette manche gardent un repère dans la main.
  const received = new Set(
    state.phase === 'exchange' || state.phase === 'playing'
      ? state.exchanges.filter((e) => e.to === seat).flatMap((e) => e.cards.map((c) => c.id))
      : [],
  );
  const showRecap =
    state.phase === 'playing' &&
    seat >= 0 &&
    recapClosed !== state.manche &&
    state.exchanges.some((e) => e.from === seat || e.to === seat);

  const hint = turnHint(state, seat, legalRanks?.size ?? 1);
  const lastLog = state.log[state.log.length - 1];
  // Les feuilles de fin de manche et de partie sont des dialogues : dessous,
  // rien ne doit rester atteignable au clavier.
  const covered = state.phase === 'manche-end' || state.phase === 'over';
  const waitingForSeat = spectators.filter((s) => s.wantsSeat).length;

  const setOption = (patch: Partial<PresidentOptions & { maxPlayers: number }>) =>
    sendAction({ type: 'SET_OPTIONS', maxPlayers: state.maxPlayers, ...state.options, ...patch });

  return (
    <MotionConfig reducedMotion="user">
      <div className="container pres-room">
        <PresidentRulesModal
          open={rulesOpen}
          onClose={() => setRulesOpen(false)}
          xOuRien={state.options.xOuRien}
          manches={state.options.manches}
        />

        <div className="p4-room-topbar">
          <div>
            <GameTitle as="h1" game="president" suffix={bots ? 'contre les bots' : `room ${code}`} className="gt-room" />
            <div className="p4-topbar-actions">
              {!bots && (
                <>
                  <button
                    type="button"
                    className={`btn btn-outline p4-chip-btn${copied ? ' is-copied' : ''}`}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check size={14} aria-hidden /> Copié !
                      </>
                    ) : (
                      <>
                        <Copy size={14} aria-hidden /> Copier le code
                      </>
                    )}
                  </button>
                  <InviteFriendsButton game="president" code={code} className="btn btn-outline p4-chip-btn" />
                </>
              )}
              <button type="button" className="btn btn-outline p4-chip-btn" onClick={() => setRulesOpen(true)}>
                <BookOpen size={14} aria-hidden /> Règles
              </button>
            </div>
          </div>
          <Link to="/president" className="p4-back-link">
            <LogOut size={14} aria-hidden /> Quitter
          </Link>
        </div>

        {!bots && (
          <ObserverBar
            spectators={spectators}
            selfId={selfId}
            isSpectator={isSpectator}
            vacated={vacatedSeats(state.players)}
            onSeat={requestSeat}
            exitTo="/president"
          />
        )}

        {state.phase === 'lobby' && (
          <div className="p4-lobby-card p4-waiting pres-waiting">
            <h2>
              En attente de joueurs ({state.players.length}/{state.maxPlayers})
            </h2>

            <ul className="p4-player-list">
              {state.players.map((p, i) => (
                <li key={p.id}>
                  <SeatAvatar userId={p.userId} name={p.name} size={22} />
                  {p.name}
                  {p.id === selfId ? ' (toi)' : ''}
                  {i === 0 && <em>hôte</em>}
                </li>
              ))}
              {Array.from({ length: Math.max(0, state.maxPlayers - state.players.length) }, (_, i) => (
                <li key={`vide-${i}`} className="pres-empty-seat">
                  Place libre
                </li>
              ))}
            </ul>

            {isHost ? (
              <div className="pres-waiting-options">
                {/* Le nombre de places reste réglable ici : une table ouverte
                    par un défi entre amis part à 3, et l'hôte l'agrandit s'il
                    attend du monde. Jamais sous le nombre de joueurs assis. */}
                <div className="pres-seg" role="radiogroup" aria-label="Nombre de joueurs">
                  {SEAT_CHOICES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={state.maxPlayers === n}
                      aria-label={`${n} joueurs`}
                      className={`pres-seg-btn${state.maxPlayers === n ? ' is-active' : ''}`}
                      disabled={n < state.players.length}
                      onClick={() => setOption({ maxPlayers: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.options.xOuRien}
                  className={`pres-mini-toggle${state.options.xOuRien ? ' is-on' : ''}`}
                  onClick={() => setOption({ xOuRien: !state.options.xOuRien })}
                >
                  <Zap size={14} aria-hidden /> X ou rien : <strong>{state.options.xOuRien ? 'activé' : 'désactivé'}</strong>
                </button>
                <div className="pres-seg" role="radiogroup" aria-label="Nombre de manches">
                  {MANCHE_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={state.options.manches === m}
                      className={`pres-seg-btn${state.options.manches === m ? ' is-active' : ''}`}
                      onClick={() => setOption({ manches: m })}
                    >
                      {m} manches
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="uno-lobby-options">
                Table de <strong>{state.maxPlayers} joueurs</strong>, X ou rien :{' '}
                <strong>{state.options.xOuRien ? 'activé' : 'désactivé'}</strong> — partie en{' '}
                <strong>{state.options.manches} manches</strong>.
              </p>
            )}

            {isHost ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={state.players.length !== state.maxPlayers}
                onClick={() => sendAction({ type: 'START' })}
              >
                {state.players.length !== state.maxPlayers ? `Il faut être ${state.maxPlayers} joueurs` : 'Lancer la partie'}
              </button>
            ) : (
              <p>En attente que l'hôte lance la partie...</p>
            )}
          </div>
        )}

        {/* Une seule voix pour les lecteurs d'écran : la dernière ligne du
            journal, qui dit tout (poses, passes, sorties, plis fermés). */}
        {inGame && (seat >= 0 || isSpectator) && (
          <p className="sr-only" aria-live="polite">
            {lastLog}
          </p>
        )}

        {/* Joueur assis : une table, un dock, une main — dans cet ordre, sans
            rien entre eux, pour que l'action et les cartes tiennent à l'écran
            sans défiler. */}
        {inGame && seat >= 0 && me && (
          <>
            <div className="pres-stage" inert={covered}>
              <PresidentTable
                state={state}
                seat={seat}
                flash={flash}
                center={state.phase === 'exchange' ? <ExchangePanel state={state} seat={seat} /> : undefined}
              />

              <div className="pres-dock" data-active={myTurn || Boolean(giving) || undefined}>
                <div className="pres-dock-me">
                  <SeatAvatar userId={me.userId} name={me.name} size={32} />
                  <div className="pres-dock-id">
                    <span className="pres-dock-line">
                      <span className="pres-me-name">{me.name}</span>
                      {/* Sorti, seul le rôle à venir compte : l'ancien s'efface. */}
                      {me.finishedAt !== null ? (
                        <span className="pres-me-out">
                          {placeLabel(me.finishedAt)} <span className="sr-only">sera</span>
                          <RoleBadge role={roleOf(me.finishedAt, state.players.length)} />
                        </span>
                      ) : (
                        me.role && <RoleBadge role={me.role} />
                      )}
                    </span>
                    <span className="pres-dock-line pres-me-stat">
                      {me.score} pts{me.finishedAt === null && <> · {cardCount(me.handCount)}</>}
                    </span>
                  </div>
                </div>

                <p id="pres-hint" className="pres-hint" role="status" data-mine={myTurn || Boolean(giving) || undefined}>
                  {hint}
                  {playError && <span className="pres-hint-why"> — {playError}</span>}
                </p>

                <div className="pres-dock-actions">
                  {giving ? (
                    // L'action principale de l'échange prend la place de « Poser ».
                    <button
                      type="button"
                      className="btn btn-primary pres-action-btn"
                      disabled={selected.length !== giving.count}
                      onClick={handleGive}
                    >
                      <Gift size={15} aria-hidden /> Donner ({selected.length}/{giving.count})
                    </button>
                  ) : (
                    state.phase === 'playing' &&
                    me.finishedAt === null && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline pres-action-btn"
                          disabled={!canPassNow}
                          onClick={handlePass}
                        >
                          <Hand size={15} aria-hidden /> Passer
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary pres-action-btn"
                          disabled={!canPlayNow}
                          aria-describedby={playError ? 'pres-hint' : undefined}
                          title={playError ?? undefined}
                          onClick={handlePlay}
                        >
                          <Layers size={15} aria-hidden /> Poser{selectedCards.length > 0 ? ` (${selectedCards.length})` : ''}
                        </button>
                      </>
                    )
                  )}
                </div>

                {showRecap && <ExchangeRecap state={state} seat={seat} onDismiss={() => setRecapClosed(state.manche)} />}
              </div>

              <PresidentHand
                cards={hand}
                enabled={myTurn || Boolean(giving)}
                selected={selected}
                isDimmed={legalRanks ? (c) => !legalRanks.has(c.rank) : undefined}
                received={received}
                onToggle={handleToggle}
              />

              {actionError && (
                <p className="p4-error-banner" role="alert">
                  <TriangleAlert size={15} aria-hidden /> {actionError}
                </p>
              )}

              <details className="pres-log">
                <summary>
                  <ScrollText size={14} aria-hidden /> Journal de la partie
                </summary>
                <ol reversed>
                  {state.log
                    .slice(-60)
                    .reverse()
                    .map((line, i) => (
                      <li key={state.log.length - i}>{line}</li>
                    ))}
                </ol>
              </details>
            </div>

            <PresidentMancheEnd
              state={state}
              seat={seat}
              canNext={isHost}
              waiting={waitingForSeat}
              onNext={() => guardedSend(() => sendAction({ type: 'NEXT_MANCHE' }))}
            />

            <PresidentVictory state={state} seat={seat} canRematch={isHost} onRematch={() => sendAction({ type: 'REMATCH' })}>
              <GameRecordBadge state={record} />
            </PresidentVictory>
          </>
        )}

        {/* Les observateurs voient tous les sièges en adversaires — des dos de
            cartes, jamais les faces — et rien sur la table ne répond à leurs clics. */}
        {inGame && isSpectator && (
          <>
            <div className="obs-lock" inert>
              <PresidentTable
                state={state}
                seat={-1}
                flash={flash}
                center={state.phase === 'exchange' ? <ExchangePanel state={state} seat={-1} /> : undefined}
              />
            </div>
            <p className="pres-hint pres-hint-obs" role="status">
              {hint}
            </p>
            <PresidentMancheEnd state={state} seat={-1} canNext={false} waiting={waitingForSeat} onNext={() => {}} />
            <PresidentVictory state={state} seat={-1} canRematch={false} onRematch={() => {}} />
          </>
        )}

        {/* Servi par l'hôte mais pas encore inscrit, ni assis ni observateur :
            la liste des observateurs arrive juste après le premier état. */}
        {inGame && seat < 0 && !isSpectator && (
          <p className="p4-turn-hint" role="status">
            Arrivée à la table…
          </p>
        )}
      </div>
    </MotionConfig>
  );
}
