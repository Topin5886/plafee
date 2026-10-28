import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Hourglass, ListOrdered, SkipForward } from 'lucide-react';
import { nextConnected, standings } from '../engine/rules';
import type { PresidentState } from '../engine/types';
import { RoleBadge } from './RoleBadge';
import { placeLabel } from './labels';

interface PresidentMancheEndProps {
  state: PresidentState;
  seat: number;
  canNext: boolean;
  onNext: () => void;
  /** Observateurs qui attendent une place : ils reprendront les sièges laissés vides à la donne. */
  waiting?: number;
}

/**
 * Entre deux manches : l'ordre de sortie, les rôles gagnés, les points de la
 * manche et le cumul, puis ce que ces rôles vont coûter à la donne suivante.
 * L'hôte relance ; les autres attendent, la feuille de score sous les yeux.
 *
 * Retiré d'un bloc plutôt qu'animé en sortie, comme les écrans de fin d'UNO :
 * une sortie bloquée laisserait un voile qui avale les clics de la manche suivante.
 */
export function PresidentMancheEnd({ state, seat, canNext, onNext, waiting = 0 }: PresidentMancheEndProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const open = state.phase === 'manche-end';
  // Un vrai dialogue : le focus y entre. L'hôte le reçoit sur « Manche
  // suivante » (autoFocus) ; les autres, sur la feuille elle-même.
  useEffect(() => {
    if (open && !canNext) sheetRef.current?.focus();
  }, [open, canNext]);

  if (!open) return null;
  const result = state.history[state.history.length - 1];
  if (!result) return null;

  const n = state.players.length;
  const ranking = standings(state);
  const left = state.options.manches - state.manche;
  const name = (s: number | undefined) => (s === undefined ? '' : state.players[s]?.name ?? '');
  const president = result.order[0];
  const trou = result.order[n - 1];
  const gone = (s: number) => !state.players[s]?.connected;
  // Un siège vide peut encore être repris par un observateur avant la donne.
  const unlessTaken = waiting > 0 ? ', sauf si un observateur reprend sa place' : '';
  const opener = waiting > 0 ? trou : nextConnected(state, trou);

  /** Une ligne d'échange, ou pourquoi il n'aura pas lieu (le moteur saute l'échange d'un parti). */
  const exchangeLine = (low: number, high: number, count: number) => {
    const away = gone(low) ? low : gone(high) ? high : null;
    if (away !== null) {
      return (
        <li key={low}>
          Pas d'échange entre <strong>{name(low)}</strong> et <strong>{name(high)}</strong> : {name(away)} est parti
          {unlessTaken}.
        </li>
      );
    }
    return (
      <li key={low}>
        <strong>{name(low)}</strong> donne {count === 1 ? 'sa meilleure carte' : `ses ${count} meilleures cartes`}{' '}
        <ArrowRight size={12} aria-hidden />
        <span className="sr-only"> à </span> <strong>{name(high)}</strong>, qui lui en rend{' '}
        {count === 1 ? 'une' : `${count} de son choix`}.
      </li>
    );
  };

  return (
    <motion.div
      className="pres-overlay"
      initial={{ opacity: 0 }}
      // Un temps pour voir la dernière carte tomber avant que la feuille de score ne la couvre.
      animate={{ opacity: 1, transition: { duration: 0.35, delay: 0.9 } }}
    >
      <motion.section
        ref={sheetRef}
        tabIndex={-1}
        className="pres-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pres-manche-title"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26, delay: 0.95 }}
      >
        <header className="pres-sheet-head">
          <ListOrdered size={20} aria-hidden />
          <h2 id="pres-manche-title">
            Fin de la manche {result.manche}
            <small> / {state.options.manches}</small>
          </h2>
        </header>

        <div className="pres-score-wrap">
          <table className="pres-score">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Joueur</th>
                <th scope="col">Rôle</th>
                <th scope="col" className="is-num">
                  Manche
                </th>
                <th scope="col" className="is-num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {result.order.map((s, place) => (
                <tr key={s} data-self={s === seat || undefined}>
                  <td className="pres-score-place">{placeLabel(place)}</td>
                  <th scope="row">
                    {name(s)}
                    {s === seat && <em> (toi)</em>}
                    {gone(s) && <em> (parti)</em>}
                  </th>
                  <td>
                    <RoleBadge role={result.roles[s]} />
                  </td>
                  <td className="is-num">+{result.points[s]}</td>
                  <td className="is-num">
                    <strong>{state.players[s]?.score ?? 0}</strong>
                    <span className="pres-score-rank" title="Classement général">
                      {placeLabel(ranking.indexOf(s))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {left > 0 && (
          <div className="pres-sheet-next">
            <p className="pres-sheet-next-title">À la prochaine donne</p>
            <ul>
              {exchangeLine(trou, president, 2)}
              {n >= 4 && exchangeLine(result.order[n - 2], result.order[1], 1)}
              <li>
                <strong>{name(opener)}</strong> ouvre la manche
                {opener !== trou && <> ({name(trou)} est parti)</>}. Encore {left} manche{left > 1 ? 's' : ''}.
              </li>
            </ul>
          </div>
        )}

        {canNext ? (
          <button type="button" className="btn btn-primary pres-sheet-btn" onClick={onNext} autoFocus>
            <SkipForward size={16} aria-hidden /> Manche suivante
          </button>
        ) : (
          <p className="pres-sheet-wait">
            <Hourglass size={14} aria-hidden /> En attente de l'hôte pour la manche suivante…
          </p>
        )}
      </motion.section>
    </motion.div>
  );
}
