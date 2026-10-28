import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { getDisputes, resolveDispute, type AdminDispute } from './adminApi';
import { Flash } from './ui';
import { fmtDateTime, useFlash } from './helpers';

const FILTERS = [
  { id: 'contested', label: 'À trancher' },
  { id: 'confirmed', label: 'Accordées' },
  { id: 'rejected', label: 'Refusées' },
  { id: 'all', label: 'Toutes' },
];

const STATUS: Record<AdminDispute['status'], string> = {
  pending: 'En attente',
  contested: 'Contestée',
  confirmed: 'Accordée',
  rejected: 'Refusée',
};

/**
 * Les victoires démenties (migration 0014).
 *
 * Une victoire n'est payée que si un adversaire nomme le même gagnant ; à
 * égalité de voix — un contre un, typiquement — elle arrive ici. À côté de
 * chaque adversaire, le nombre de victoires qu'il a déjà démenties : un
 * mauvais perdant se repère à ce chiffre.
 */
export function DisputesPanel() {
  const [filter, setFilter] = useState('contested');
  const [rows, setRows] = useState<AdminDispute[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, flash] = useFlash();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    getDisputes(filter === 'all' ? null : filter)
      .then((r) => !cancelled && setRows(r))
      .catch((e: unknown) => flash('error', e instanceof Error ? e.message : 'Chargement impossible.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, nonce]);

  const decide = async (d: AdminDispute, accept: boolean) => {
    try {
      await resolveDispute(d.result_id, accept, notes[d.result_id] ?? '');
      flash('ok', accept ? 'Victoire accordée : points et FEES versés.' : 'Victoire refusée.');
      setNonce((n) => n + 1);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Action impossible.');
    }
  };

  return (
    <section className="acc-card acc-card-wide">
      <div className="adm-row-between">
        <h2 className="acc-section-title">Victoires contestées</h2>
        <div className="soc-tabs" role="group" aria-label="Filtrer">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="soc-tab" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <Flash msg={msg} />
      {!rows ? (
        <p className="neon-hint">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="soc-empty">Aucune victoire contestée.</p>
      ) : (
        <div className="acc-table-scroll">
          <table className="acc-table adm-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Réclamée par</th>
                <th scope="col">Adversaires</th>
                <th scope="col">Statut</th>
                <th scope="col">Décision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.result_id}>
                  <td>
                    {fmtDateTime(d.created_at)}
                    <small className="adm-sub">
                      {d.game_label}
                      {d.room_code ? ` · room ${d.room_code}` : ''}
                    </small>
                  </td>
                  <td>
                    <Link to={`/admin?onglet=joueurs&q=${encodeURIComponent(d.claimant ?? '')}`} className="adm-link">
                      {d.claimant ?? '?'}
                    </Link>
                    <small className="adm-sub">{d.claim === 'chef' ? 'chef de la Roulette' : 'victoire'}</small>
                  </td>
                  <td>
                    {d.reporters.length === 0 ? (
                      <em>aucun</em>
                    ) : (
                      d.reporters.map((r) => (
                        <small key={r.user_id} className="adm-sub">
                          {r.username ?? 'compte supprimé'} : {r.agrees ? 'confirme' : 'dément'}
                          {r.disputes > 0 && ` (${r.disputes} démenti${r.disputes > 1 ? 's' : ''} au total)`}
                        </small>
                      ))
                    )}
                  </td>
                  <td>
                    <span className="adm-pill" data-tone={d.status === 'contested' ? 'warn' : d.status === 'confirmed' ? 'ok' : undefined}>
                      {STATUS[d.status]}
                    </span>
                  </td>
                  <td>
                    {d.status === 'contested' || d.status === 'pending' ? (
                      <>
                        <label className="adm-field">
                          <span className="adm-label">Motif (envoyé au joueur si refusée)</span>
                          <input
                            className="neon-input"
                            value={notes[d.result_id] ?? ''}
                            onChange={(e) => setNotes({ ...notes, [d.result_id]: e.target.value })}
                          />
                        </label>
                        <span className="adm-actions">
                          <button type="button" className="neon-btn adm-btn" data-variant="solid" onClick={() => void decide(d, true)}>
                            <Check size={14} aria-hidden /> Accorder
                          </button>
                          <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={() => void decide(d, false)}>
                            <X size={14} aria-hidden /> Refuser
                          </button>
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
