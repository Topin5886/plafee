import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Coins, ExternalLink, Megaphone, RotateCcw, Search, ShieldCheck, Zap } from 'lucide-react';
import { UserAvatar } from '../../social/components/UserAvatar';
import { formatFees } from '../format';
import { usePlafee } from '../usePlafee';
import { banPlayer, getAdminPlayers, grantFees, resetStats, unbanPlayer, warnPlayer, type AdminPlayer } from './adminApi';
import { ConfirmAction, Field, Flash } from './ui';
import { fmtDate, fmtDateTime, useFlash } from './helpers';

const PAGE = 50;

/** Les joueurs : recherche, statistiques détaillées, et actions de modération. */
export function PlayersTab() {
  // « ?q=pseudo » : arrivée depuis un signalement.
  const [params] = useSearchParams();
  const initialSearch = params.get('q') ?? '';
  const [query, setQuery] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [rows, setRows] = useState<AdminPlayer[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getAdminPlayers(search, PAGE, 0)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setMore(r.length === PAGE);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Chargement impossible.'));
    return () => {
      cancelled = true;
    };
  }, [search, nonce]);

  const loadMore = async () => {
    if (!rows) return;
    const next = await getAdminPlayers(search, PAGE, rows.length);
    setRows([...rows, ...next]);
    setMore(next.length === PAGE);
  };

  const current = rows?.find((r) => r.user_id === selected) ?? null;

  return (
    <div className="adm-split">
      <section className="acc-card acc-card-wide">
        <form
          className="adm-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
        >
          <input className="neon-input" placeholder="Pseudo ou e-mail" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un joueur" />
          <button type="submit" className="neon-btn adm-btn" data-variant="solid">
            <Search size={14} aria-hidden /> Chercher
          </button>
        </form>
        {error && (
          <p className="neon-error" role="alert">
            {error}
          </p>
        )}
        {!rows ? (
          <p className="neon-hint" role="status">
            Chargement…
          </p>
        ) : rows.length === 0 ? (
          <p className="soc-empty">Aucun joueur ne correspond.</p>
        ) : (
          <div className="acc-table-scroll">
            <table className="acc-table adm-table">
              <thead>
                <tr>
                  <th scope="col">Pseudo</th>
                  <th scope="col">Parties</th>
                  <th scope="col">Victoires</th>
                  <th scope="col" className="acc-col-opt">Défaites</th>
                  <th scope="col">V/D</th>
                  <th scope="col" className="acc-col-opt">Trophées</th>
                  <th scope="col" className="acc-col-opt">FEES</th>
                  <th scope="col">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} data-selected={r.user_id === selected || undefined}>
                    <td>
                      <button type="button" className="adm-link" onClick={() => setSelected(r.user_id)}>
                        <UserAvatar username={r.username} src={r.avatar} size={24} />
                        {r.username}
                      </button>
                    </td>
                    <td>{r.games}</td>
                    <td>{r.wins}</td>
                    <td className="acc-col-opt">{r.losses}</td>
                    <td>{r.games ? `${Math.round((r.wins / r.games) * 100)} %` : '—'}</td>
                    <td className="acc-col-opt">{r.trophies}</td>
                    <td className="acc-col-opt">{formatFees(r.balance)}</td>
                    <td>
                      {r.banned ? (
                        <span className="adm-pill" data-tone="danger">
                          Banni
                        </span>
                      ) : (
                        <span className="adm-pill" data-tone="ok">
                          Actif
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more && (
          <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={() => void loadMore()}>
            Afficher plus
          </button>
        )}
      </section>

      {current && <PlayerDetail key={current.user_id} player={current} onChanged={() => setNonce((n) => n + 1)} onClose={() => setSelected(null)} />}
    </div>
  );
}

function PlayerDetail({ player, onChanged, onClose }: { player: AdminPlayer; onChanged: () => void; onClose: () => void }) {
  const { isSuperAdmin } = usePlafee();
  const [msg, flash] = useFlash();
  const [reason, setReason] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [warning, setWarning] = useState('');
  const [amount, setAmount] = useState('');
  const [feesReason, setFeesReason] = useState('');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      flash('ok', ok);
      onChanged();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Action impossible.');
    }
  };

  const onWarn = (e: FormEvent) => {
    e.preventDefault();
    if (warning.trim().length < 3) return;
    void run(() => warnPlayer(player.user_id, warning.trim()), 'Avertissement envoyé.').then(() => setWarning(''));
  };

  const onFees = (e: FormEvent) => {
    e.preventDefault();
    const n = Math.trunc(Number(amount));
    if (!n) return;
    void run(() => grantFees(player.username, n, feesReason), n > 0 ? `${n} FEES donnés.` : `${-n} FEES retirés.`).then(() => {
      setAmount('');
      setFeesReason('');
    });
  };

  return (
    <aside className="acc-card adm-detail" aria-label={`Fiche de ${player.username}`}>
      <header className="adm-row-between">
        <div className="adm-detail-id">
          <UserAvatar username={player.username} src={player.avatar} size={48} userId={player.user_id} />
          <div>
            <h2 className="acc-section-title">{player.username}</h2>
            <p className="neon-hint">{player.email ?? 'e-mail inconnu'}</p>
          </div>
        </div>
        <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={onClose}>
          Fermer
        </button>
      </header>

      <dl className="adm-facts">
        <div>
          <dt>Inscrit le</dt>
          <dd>{fmtDate(player.created_at)}</dd>
        </div>
        <div>
          <dt>Vu pour la dernière fois</dt>
          <dd>{fmtDateTime(player.last_seen)}</dd>
        </div>
        <div>
          <dt>Parties</dt>
          <dd>
            {player.games} ({player.wins} V / {player.losses} D)
          </dd>
        </div>
        <div>
          <dt>Trophées</dt>
          <dd>{player.trophies}</dd>
        </div>
        <div>
          <dt>Solde</dt>
          <dd>{formatFees(player.balance)} FEES</dd>
        </div>
        <div>
          <dt>Avertissements</dt>
          <dd>{player.warnings}</dd>
        </div>
        <div>
          <dt>Statut</dt>
          <dd>{player.banned ? `Banni${player.ban_reason ? ` — ${player.ban_reason}` : ''}` : 'Actif'}</dd>
        </div>
      </dl>
      <div className="adm-actions">
        <Link to={`/joueur/${player.username}`} className="adm-link" target="_blank">
          <ExternalLink size={14} aria-hidden /> Voir le profil public
        </Link>
        {isSuperAdmin && (
          <Link to={`/admin?onglet=god&joueur=${player.user_id}`} className="adm-link adm-link-god">
            <Zap size={14} aria-hidden /> Ouvrir en God mode
          </Link>
        )}
      </div>

      <Flash msg={msg} />

      <div className="adm-block">
        <h3 className="adm-block-title">
          <Ban size={15} aria-hidden /> Bannissement
        </h3>
        {player.banned ? (
          <ConfirmAction variant="ghost" label={<><ShieldCheck size={14} aria-hidden /> Lever le ban</>} confirm="Confirmer le déban" onConfirm={() => run(() => unbanPlayer(player.user_id), 'Ban levé.')} />
        ) : (
          <>
            <Field label="Motif (obligatoire, envoyé au joueur)">
              <input className="neon-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ex : insultes répétées" />
            </Field>
            <ConfirmAction
              label="Bannir le joueur"
              confirm="Confirmer le ban"
              disabled={reason.trim().length < 3}
              onConfirm={() => run(() => banPlayer(player.user_id, reason.trim()), 'Joueur banni et prévenu.')}
            />
          </>
        )}
      </div>

      <form className="adm-block" onSubmit={onWarn}>
        <h3 className="adm-block-title">
          <Megaphone size={15} aria-hidden /> Avertir
        </h3>
        <Field label="Message (notification + bandeau)">
          <textarea className="neon-input" rows={2} maxLength={500} value={warning} onChange={(e) => setWarning(e.target.value)} />
        </Field>
        <button type="submit" className="neon-btn adm-btn" disabled={warning.trim().length < 3}>
          Envoyer l'avertissement
        </button>
      </form>

      <form className="adm-block" onSubmit={onFees}>
        <h3 className="adm-block-title">
          <Coins size={15} aria-hidden /> FEES
        </h3>
        <div className="adm-grid-2">
          <Field label="Montant" hint="Négatif pour retirer.">
            <input className="neon-input" type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100 ou -50" />
          </Field>
          <Field label="Motif">
            <input className="neon-input" value={feesReason} maxLength={120} onChange={(e) => setFeesReason(e.target.value)} placeholder="Ex : gagnant du tournoi" />
          </Field>
        </div>
        <button type="submit" className="neon-btn adm-btn" disabled={!Math.trunc(Number(amount))}>
          Appliquer
        </button>
      </form>

      <div className="adm-block">
        <h3 className="adm-block-title">
          <RotateCcw size={15} aria-hidden /> Remise à zéro
        </h3>
        <p className="neon-hint">Efface ses parties, ses trophées et sa série. Son solde de FEES et ses achats restent. Irréversible.</p>
        <Field label="Motif (obligatoire, envoyé au joueur)">
          <input className="neon-input" value={resetReason} maxLength={200} onChange={(e) => setResetReason(e.target.value)} placeholder="Ex : fausses victoires contre un second compte" />
        </Field>
        <ConfirmAction
          label="Remettre les stats à zéro"
          confirm="Oui, tout effacer"
          disabled={resetReason.trim().length < 3}
          onConfirm={() => run(() => resetStats(player.user_id, resetReason.trim()), 'Statistiques remises à zéro, joueur prévenu.').then(() => setResetReason(''))}
        />
      </div>
    </aside>
  );
}
