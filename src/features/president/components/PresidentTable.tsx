import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, Hand, LogOut, Zap } from 'lucide-react';
import { RANK_NAME, ROLE_LABEL, describePlay } from '../engine/deck';
import { requiredCount, roleOf, topPlay } from '../engine/rules';
import type { PresidentPlay, PresidentPlayer, PresidentState } from '../engine/types';
import { SeatAvatar, SeatCards } from '../../plafee/components/SeatFlair';
import { PresidentCardBack, PresidentCardFace } from './PresidentCard';
import { PresidentFlash, type PresidentShot } from './PresidentFlash';
import { RoleBadge } from './RoleBadge';
import { cardCount, cardsLabel, placeLabel, placeName } from './labels';

interface PresidentTableProps {
  state: PresidentState;
  /** Le siège du joueur local (-1 pour un observateur) : les autres se placent autour de lui. */
  seat: number;
  /** L'annonce en cours (« PRÉSIDENT ! », « 7 ou rien ! »…), posée sur la table. */
  flash?: PresidentShot | null;
  /** Ce que la room met au centre à la place du pli : le panneau d'échange. */
  center?: ReactNode;
}

/** Le nom d'une pose selon son nombre de cartes. */
const COUNT_NAME: Record<number, string> = { 1: 'Simple', 2: 'Paire', 3: 'Brelan', 4: 'Carré' };

/**
 * Un petit angle stable par pose, tiré de l'identifiant de sa première carte :
 * le pli a l'air jeté sur la table, et il ne tremble pas d'un rendu à l'autre.
 */
function tilt(play: PresidentPlay): number {
  const id = play.cards[0]?.id ?? '';
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h % 9) - 4;
}

/** L'anneau des sièges est environ deux fois plus large que haut (voir `.pres-ring`). */
const RING_ASPECT = 2;

/*
 * La place des adversaires sur un arc qui passe au-dessus du pli : le
 * suivant dans le tour à gauche, le précédent à droite, comme autour d'une
 * vraie table où l'on joue dans le sens des aiguilles d'une montre. L'arc
 * s'ouvre avec le nombre de joueurs, jusqu'à descendre un peu sous l'horizon
 * à 7.
 *
 * Les sièges sont espacés régulièrement le long de l'arc *à l'écran*, pas
 * selon l'angle : l'anneau étant plus large que haut, des angles égaux
 * serreraient les sièges des côtés l'un sur l'autre (ils ne s'écartent que
 * de haut en bas) et étireraient ceux du haut. Sous 760 px (1024 px à 6 et 7
 * sièges), le CSS ignore ces coordonnées et range les sièges en grille
 * compacte au-dessus du pli.
 */
function arcPosition(i: number, k: number): { x: number; y: number } {
  if (k <= 1) return { x: 50, y: 0 };
  const span = (Math.min(220, 70 + 30 * k) * Math.PI) / 180;
  const from = Math.PI / 2 + span / 2;
  // Longueur d'arc cumulée, par petits pas, sur l'ellipse de l'anneau.
  const steps = 240;
  const lengths = [0];
  for (let n = 1; n <= steps; n++) {
    const a = from - (span * (n - 0.5)) / steps;
    lengths.push(lengths[n - 1] + Math.hypot(RING_ASPECT * Math.sin(a), Math.cos(a)) * (span / steps));
  }
  const target = (lengths[steps] * i) / (k - 1);
  let n = 0;
  while (n < steps && lengths[n + 1] < target) n++;
  const a = from - (span * n) / steps;
  return { x: 50 + 50 * Math.cos(a), y: 50 - 50 * Math.sin(a) };
}

function Seat({
  player,
  index,
  state,
  pos,
}: {
  player: PresidentPlayer;
  index: number;
  state: PresidentState;
  pos: { x: number; y: number };
}) {
  const n = state.players.length;
  const playing = state.phase === 'playing';
  const active = playing && state.turn === index && player.finishedAt === null;
  const out = player.finishedAt !== null;
  const gone = !player.connected;
  const passed = playing && player.passed && state.trick.length > 0 && !out && !gone;
  const lead = playing && state.trick.length > 0 && state.lastPlayer === index;
  const choosing = state.phase === 'exchange' && state.exchanges.some((e) => e.from === index && e.kind === 'choice' && !e.done);
  const shown = Math.min(player.handCount, 6);
  // Sorti, il a déjà gagné son rôle de la manche suivante : l'ancien, qui
  // contredirait le nouveau, s'efface.
  const nextRole = out ? roleOf(player.finishedAt ?? 0, n) : null;

  const status = nextRole
    ? `fini à la ${placeName(player.finishedAt ?? 0)}, sera ${ROLE_LABEL[nextRole]}`
    : gone
      ? 'parti'
      : active
        ? 'à son tour'
        : passed
          ? 'a passé'
          : '';
  const aria = [player.name, cardCount(player.handCount), player.role && !out ? ROLE_LABEL[player.role] : '', status]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className="pres-seat"
      role="group"
      aria-label={aria}
      data-active={active || undefined}
      data-out={nextRole ?? undefined}
      data-gone={gone || undefined}
      data-lead={lead || undefined}
      style={{ '--seat-x': `${pos.x}%`, '--seat-y': `${pos.y}%` } as CSSProperties}
    >
      <div className="pres-seat-head">
        <SeatAvatar userId={player.userId} name={player.name} size={24} />
        <span className="pres-seat-name">{player.name}</span>
        {player.role && !out && <RoleBadge role={player.role} compact />}
        {/* Le compteur des sièges compacts (téléphone), où l'éventail disparaît. */}
        {!out && (
          <span className="pres-seat-n" aria-hidden>
            {player.handCount}
          </span>
        )}
      </div>

      {nextRole ? (
        <div className="pres-seat-out">
          <span className="pres-seat-place">{placeLabel(player.finishedAt ?? 0)}</span>
          <span className="sr-only">sera</span>
          <RoleBadge role={nextRole} />
        </div>
      ) : (
        <SeatCards userId={player.userId} className="pres-seat-fan">
          {Array.from({ length: shown }, (_, i) => {
            const off = i - (shown - 1) / 2;
            return (
              <span
                key={i}
                className="pres-seat-back"
                style={{ transform: `translateX(${off * 9}px) rotate(${off * 6}deg)` }}
              >
                <PresidentCardBack />
              </span>
            );
          })}
          <span className="pres-seat-count" aria-hidden>
            {player.handCount}
          </span>
        </SeatCards>
      )}

      <div className="pres-seat-foot">
        <span className="pres-seat-score">{player.score} pts</span>
        {gone ? (
          <span className="pres-seat-tag" data-tone="gone">
            <LogOut size={11} aria-hidden /> parti
          </span>
        ) : active ? (
          <span className="pres-seat-tag" data-tone="turn">
            joue<span className="pres-dots" aria-hidden>...</span>
          </span>
        ) : choosing ? (
          <span className="pres-seat-tag" data-tone="turn">
            choisit<span className="pres-dots" aria-hidden>...</span>
          </span>
        ) : lead ? (
          <span className="pres-seat-tag" data-tone="lead">
            <Hand size={11} aria-hidden /> a la main
          </span>
        ) : passed ? (
          // Les sièges compacts (téléphone, écran bas) n'ont pas la place
          // d'une bulle : la passe s'y lit au pied du siège (voir le CSS).
          <span className="pres-seat-tag" data-tone="pass" aria-hidden>
            passe
          </span>
        ) : null}
      </div>

      {passed && (
        <motion.span
          key={`pass-${state.trick.length}`}
          className="pres-seat-pass"
          initial={{ opacity: 0, scale: 0.6, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          aria-hidden
        >
          Passe
        </motion.span>
      )}
    </div>
  );
}

/**
 * Une pose sur la table : ses cartes en éventail serré, au skin de celui qui
 * l'a posée. Deux étages : le CSS place la pose dans la pile (décalage et
 * angle, selon sa profondeur), framer-motion anime l'étage du dessous —
 * sinon la transformation animée écraserait celle du placement.
 */
function PlayCards({ play, state, depth, ghost }: { play: PresidentPlay; state: PresidentState; depth: number; ghost?: boolean }) {
  const poser = state.players[play.by];
  const style = {
    '--depth': depth,
    '--tilt': `${tilt(play)}deg`,
  } as CSSProperties;
  const inner = (
    <SeatCards userId={poser?.userId} className="pres-play-cards">
      {play.cards.map((c) => (
        <span key={c.id} className="pres-play-card">
          <PresidentCardFace card={c} />
        </span>
      ))}
    </SeatCards>
  );

  return (
    <div className={`pres-play${ghost ? ' is-ghost' : depth === 0 ? ' is-top' : ''}`} style={style}>
      {ghost ? (
        // Le pli qui vient de se fermer reste un instant sous les yeux, puis
        // s'efface : on voit le 2 ou le carré qui l'a coupé, sans encombrer la table.
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 1, 0], scale: [1, 1, 0.92] }}
          transition={{ duration: 2.2, times: [0, 0.6, 1], ease: 'easeIn' }}
        >
          {inner}
        </motion.div>
      ) : depth === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: -34, scale: 1.12 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 24 }}
        >
          {inner}
        </motion.div>
      ) : (
        inner
      )}
    </div>
  );
}

/** Pourquoi le dernier pli s'est fermé, en quelques mots, s'il vient de l'être. */
function closedWhy(state: PresidentState): string {
  const e = state.lastEvent;
  if (e.kind !== 'trick') return '';
  if (e.reason === 'two') return ' par un 2';
  if (e.reason === 'quad') return ' par un carré';
  return ' : tout le monde a passé';
}

/*
 * Le centre ne décrit que la table : ce qui est posé, ce qu'il faut battre.
 * À qui de jouer, c'est la consigne du dock qui le dit (une seule source,
 * sinon « à toi d'ouvrir » s'affichait trois fois). Le « X ou rien » tient
 * dans la puce de contrainte, l'unique indicateur durable ; l'annonce
 * « 7 ou rien ! » ne fait que passer.
 */
function TrickCenter({ state }: { state: PresidentState }) {
  const top = topPlay(state);
  const need = requiredCount(state);
  const forced = state.forcedRank;
  // Les quatre dernières poses suffisent : au-delà, le dessous du pli n'apprend plus rien.
  const shown = state.trick.slice(-4);
  const ghost = state.trick.length === 0 ? state.lastTrick[state.lastTrick.length - 1] : undefined;
  const ghostBy = ghost ? state.players[ghost.by]?.name : undefined;

  return (
    <>
      <div className="pres-center-chips">
        <span className="pres-chip">
          Manche <strong>{state.manche}</strong>/{state.options.manches}
        </span>
        {top && need !== null ? (
          <>
            <span className="pres-chip" data-tone="count">
              {COUNT_NAME[need] ?? cardCount(need)}
            </span>
            {forced !== null ? (
              <span className="pres-chip" data-tone="forced">
                <Zap size={12} aria-hidden /> {RANK_NAME[forced]} ou rien
              </span>
            ) : (
              <span className="pres-chip" data-tone="min">
                ≥ {RANK_NAME[top.rank]}
              </span>
            )}
          </>
        ) : (
          <span className="pres-chip" data-tone="open">
            Nouveau pli
          </span>
        )}
      </div>

      <div className="pres-trick" aria-hidden>
        {shown.map((play, i) => (
          <PlayCards key={`${play.by}-${play.cards[0]?.id}`} play={play} state={state} depth={shown.length - 1 - i} />
        ))}
        {ghost && <PlayCards key={`ghost-${ghost.cards[0]?.id}`} play={ghost} state={state} depth={0} ghost />}
        {!top && !ghost && <span className="pres-trick-empty" />}
      </div>

      {/* Pas de région live ici : le journal (texte masqué de la room) annonce déjà chaque coup. */}
      <p className="pres-trick-caption">
        {top ? (
          <>
            <strong>{state.players[top.by]?.name}</strong> : {describePlay(top.rank, top.cards.length)}
            <span className="sr-only"> ({cardsLabel(top.cards)})</span>
          </>
        ) : ghost ? (
          <>
            Pli fermé par <strong>{ghostBy}</strong>
            {closedWhy(state)}
          </>
        ) : null}
      </p>
    </>
  );
}

/**
 * La table : les adversaires autour, le pli au milieu. Le joueur local n'y
 * figure pas — sa place, c'est le dock et sa main, juste dessous. Un
 * observateur voit tous les sièges, cartes de dos.
 *
 * Les annonces se posent sur la table elle-même, au milieu : elles suivent
 * le pli quand on fait défiler, et passent sous les feuilles de fin de
 * manche (qui couvrent l'écran) au lieu de les traverser.
 */
export function PresidentTable({ state, seat, flash = null, center }: PresidentTableProps) {
  const n = state.players.length;
  const order =
    seat >= 0 ? Array.from({ length: n - 1 }, (_, k) => (seat + 1 + k) % n) : Array.from({ length: n }, (_, k) => k);

  return (
    <div className="pres-table" data-seats={order.length}>
      <div className="pres-ring">
        {order.map((i, k) => (
          <Seat key={state.players[i].id} player={state.players[i]} index={i} state={state} pos={arcPosition(k, order.length)} />
        ))}
      </div>

      <div className="pres-center" data-mode={center ? 'panel' : undefined}>
        {center ? (
          center
        ) : state.phase === 'exchange' ? (
          <div className="pres-center-exchange">
            <ArrowLeftRight size={30} aria-hidden />
            <span>Échange des cartes</span>
          </div>
        ) : state.phase === 'playing' ? (
          <TrickCenter state={state} />
        ) : (
          <div className="pres-center-exchange">
            <span>{state.phase === 'over' ? 'Partie terminée' : `Fin de la manche ${state.manche}`}</span>
          </div>
        )}
      </div>

      <PresidentFlash shot={flash} />
    </div>
  );
}
