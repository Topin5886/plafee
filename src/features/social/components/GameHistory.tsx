import { useCallback, useEffect, useState } from 'react';
import { Flame, History } from 'lucide-react';
import { NeonButton } from '../../account/components/NeonButton';
import { GAME_LABELS } from '../../account/types';
import { getGameHistory, type HistoryRow } from '../api';
import { outcomeLabel, timeAgo } from '../format';

function duration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  return m > 0 ? `${m} min` : `${seconds} s`;
}

/** L'historique complet d'un joueur, vingt parties à la fois. */
export function GameHistory({ userId }: { userId: string }) {
  const [games, setGames] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const page = await getGameHistory(userId, offset);
        setGames((list) => (offset === 0 ? page.games : [...list, ...page.games]));
        setTotal(page.total);
        setHasMore(page.hasMore);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <section className="acc-card acc-card-wide">
      <h2 className="acc-section-title">
        <History size={18} aria-hidden /> Historique
        {total > 0 && <span className="soc-count">{total}</span>}
      </h2>
      {!loading && games.length === 0 ? (
        <p className="soc-empty">Aucune partie enregistrée.</p>
      ) : (
        <div className="acc-table-scroll">
          <table className="acc-table">
            <thead>
              <tr>
                <th scope="col">Jeu</th>
                <th scope="col">Résultat</th>
                <th scope="col" className="acc-col-opt">Joueurs</th>
                <th scope="col" className="acc-col-opt">Durée</th>
                <th scope="col">Points</th>
                <th scope="col">Quand</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td>{GAME_LABELS[g.game_type] ?? g.game_type}</td>
                  <td>
                    <span className="acc-outcome" data-won={g.won}>
                      {outcomeLabel(g)}
                    </span>
                  </td>
                  <td className="acc-col-opt">{g.player_count}</td>
                  <td className="acc-col-opt">{duration(g.duration_seconds)}</td>
                  <td>
                    {g.points > 0 ? `+${g.points}` : '—'}
                    {g.streak_bonus && (
                      <span className="acc-streak" title="Prime de série">
                        <Flame size={13} aria-hidden /> série
                      </span>
                    )}
                  </td>
                  <td>{timeAgo(g.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <div className="soc-more">
          <NeonButton variant="ghost" loading={loading} onClick={() => void load(games.length)}>
            Voir plus
          </NeonButton>
        </div>
      )}
    </section>
  );
}
