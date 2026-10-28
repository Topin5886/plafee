import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Crown, RotateCcw } from 'lucide-react';
import { standings } from '../engine/rules';
import type { PresidentState } from '../engine/types';
import { SeatAvatar } from '../../plafee/components/SeatFlair';
import { placeLabel } from './labels';

interface PresidentVictoryProps {
  state: PresidentState;
  seat: number;
  canRematch: boolean;
  onRematch: () => void;
  /** Glissé sous le podium : le bilan de l'enregistrement, en pratique. */
  children?: ReactNode;
}

/** L'ordre des marches à l'écran : le 2e à gauche, le 1er au centre, le 3e à droite. */
const PODIUM_ORDER = [1, 0, 2];

/**
 * La fin de partie : un podium, la feuille des scores et, pour le joueur,
 * ce qui comptera pour ses trophées. Même principe que la victoire d'UNO :
 * retiré d'un bloc plutôt qu'animé en sortie, pour ne jamais laisser un
 * voile au-dessus de la revanche.
 */
export function PresidentVictory({ state, seat, canRematch, onRematch, children }: PresidentVictoryProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const open = state.phase === 'over' && state.winner !== null;
  // Le focus entre dans le dialogue : sur « Revanche » pour l'hôte
  // (autoFocus), sur la carte elle-même pour les autres.
  useEffect(() => {
    if (open && !canRematch) cardRef.current?.focus();
  }, [open, canRematch]);

  if (!open || state.winner === null) return null;
  const ranking = standings(state);
  const winner = state.players[state.winner];
  const me = seat >= 0 ? state.players[seat] : undefined;
  const stopped = state.history.length < state.options.manches;

  return (
    <motion.div
      className="p4-victory pres-victory"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.4, delay: 0.6 } }}
    >
      <motion.span
        className="p4-victory-flash"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0] }}
        transition={{ duration: 0.7, delay: 0.6, times: [0, 0.12, 1], ease: 'easeOut' }}
      />

      <motion.div
        ref={cardRef}
        tabIndex={-1}
        className="p4-victory-card pres-victory-card"
        style={{ '--p4-win-color': 'var(--pres-gold)' } as CSSProperties}
        initial={{ opacity: 0, scale: 0.7, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 18, delay: 0.75 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pres-victory-title"
      >
        <h2 id="pres-victory-title">{state.winner === seat ? 'Président à vie !' : 'Fin du mandat'}</h2>
        <p className="p4-victory-who">
          <strong>{winner?.name ?? 'Quelqu’un'}</strong>
          <span>
            remporte la partie avec {winner?.score ?? 0} points
            {stopped ? ' (partie arrêtée : trop de départs)' : ''}
          </span>
        </p>

        <div className="pres-podium" aria-label="Podium">
          {PODIUM_ORDER.filter((r) => r < ranking.length).map((r) => {
            const s = ranking[r];
            const p = state.players[s];
            return (
              <motion.div
                key={s}
                className="pres-step"
                data-rank={r}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.9 + (2 - r) * 0.12 }}
              >
                {r === 0 && <Crown className="pres-step-crown" size={26} aria-hidden />}
                <SeatAvatar userId={p?.userId} name={p?.name ?? '?'} size={34} />
                <span className="pres-step-name">
                  {p?.name}
                  {s === seat && <em> (toi)</em>}
                  {p && !p.connected && <em> (parti)</em>}
                </span>
                <span className="pres-step-block">
                  <span className="pres-step-rank">{placeLabel(r)}</span>
                  <span className="pres-step-score">{p?.score ?? 0} pts</span>
                </span>
              </motion.div>
            );
          })}
        </div>

        {ranking.length > 3 && (
          <ol className="pres-rest" start={4}>
            {ranking.slice(3).map((s) => (
              <li key={s} data-self={s === seat || undefined}>
                <span>
                  {state.players[s]?.name}
                  {state.players[s] && !state.players[s].connected && <em> (parti)</em>}
                </span>
                <span>{state.players[s]?.score ?? 0} pts</span>
              </li>
            ))}
          </ol>
        )}

        {me && (
          <p className="pres-my-stats">
            <span>
              Carrés <strong>{me.stats.quads}</strong>
            </span>
            <span>
              Plis coupés au 2 <strong>{me.stats.twos}</strong>
            </span>
            <span>
              Présidences d'affilée <strong>{me.stats.bestPresidentRun}</strong>
            </span>
            {me.stats.ragsToRiches > 0 && (
              <span>
                Du trou au trône <strong>×{me.stats.ragsToRiches}</strong>
              </span>
            )}
          </p>
        )}

        {children}

        {canRematch ? (
          <button type="button" className="btn btn-primary p4-victory-again" onClick={onRematch} autoFocus>
            <RotateCcw size={16} /> Revanche
          </button>
        ) : (
          <p className="p4-victory-wait">L'hôte peut relancer une partie.</p>
        )}
      </motion.div>
    </motion.div>
  );
}
