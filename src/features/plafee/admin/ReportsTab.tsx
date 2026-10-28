import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, RotateCcw, X } from 'lucide-react';
import { getReports, resolveReport, type AdminReport } from './adminApi';
import { Flash } from './ui';
import { fmtDateTime, useFlash } from './helpers';
import { DisputesPanel } from './DisputesPanel';

const FILTERS = [
  { id: 'pending', label: 'En attente' },
  { id: 'resolved', label: 'Résolus' },
  { id: 'dismissed', label: 'Classés' },
  { id: 'all', label: 'Tous' },
];

const REASONS: Record<string, string> = {
  spam: 'Spam',
  toxique: 'Langage toxique',
  triche: 'Triche',
  pseudo: 'Pseudo inapproprié',
  autre: 'Autre',
};

const STATUS: Record<AdminReport['status'], string> = { pending: 'En attente', resolved: 'Résolu', dismissed: 'Classé' };

/** Les signalements de joueurs. */
export function ReportsTab() {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState<AdminReport[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [msg, flash] = useFlash();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    getReports(filter === 'all' ? null : filter)
      .then((r) => !cancelled && setRows(r))
      .catch((e: unknown) => flash('error', e instanceof Error ? e.message : 'Chargement impossible.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, nonce]);

  const resolve = async (r: AdminReport, status: 'resolved' | 'dismissed' | 'pending') => {
    try {
      await resolveReport(r.id, status, notes[r.id] ?? '');
      flash('ok', status === 'resolved' ? 'Marqué résolu.' : status === 'dismissed' ? 'Signalement classé.' : 'Remis en attente.');
      setNonce((n) => n + 1);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Action impossible.');
    }
  };

  return (
    <>
    <DisputesPanel />
    <section className="acc-card acc-card-wide">
      <div className="adm-row-between">
        <h2 className="acc-section-title">Signalements reçus</h2>
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
        <p className="soc-empty">Rien à traiter. Tout le monde est sage.</p>
      ) : (
        <div className="acc-table-scroll">
          <table className="acc-table adm-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Signalé</th>
                <th scope="col">Raison</th>
                <th scope="col">Statut</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td>
                      <Link to={`/admin?onglet=joueurs&q=${encodeURIComponent(r.reported ?? '')}`} className="adm-link">
                        {r.reported ?? '?'}
                      </Link>
                      <small className="adm-sub">par {r.reporter ?? 'compte supprimé'}</small>
                    </td>
                    <td>{REASONS[r.reason] ?? r.reason}</td>
                    <td>
                      <span className="adm-pill" data-tone={r.status === 'pending' ? 'warn' : r.status === 'resolved' ? 'ok' : undefined}>
                        {STATUS[r.status]}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                        Voir détails
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="adm-details-row">
                      <td colSpan={5}>
                        <p>
                          <strong>Détails :</strong> {r.details ?? <em>aucun</em>}
                        </p>
                        {r.resolution && (
                          <p>
                            <strong>Décision :</strong> {r.resolution} ({fmtDateTime(r.resolved_at)})
                          </p>
                        )}
                        <label className="adm-field">
                          <span className="adm-label">Note de décision</span>
                          <input className="neon-input" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="Ex : banni 7 jours" />
                        </label>
                        <span className="adm-actions">
                          {r.status !== 'resolved' && (
                            <button type="button" className="neon-btn adm-btn" data-variant="solid" onClick={() => void resolve(r, 'resolved')}>
                              <Check size={14} aria-hidden /> Marquer résolu
                            </button>
                          )}
                          {r.status !== 'dismissed' && (
                            <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={() => void resolve(r, 'dismissed')}>
                              <X size={14} aria-hidden /> Classer sans suite
                            </button>
                          )}
                          {r.status !== 'pending' && (
                            <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={() => void resolve(r, 'pending')}>
                              <RotateCcw size={14} aria-hidden /> Remettre en attente
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    </>
  );
}
