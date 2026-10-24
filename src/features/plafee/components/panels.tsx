import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Coins, Copy, Flag, Flame, Gift, Tag } from 'lucide-react';
import { useAuth } from '../../account/useAuth';
import { Modal } from '../../social/components/Modal';
import { usePlafee } from '../usePlafee';
import { useCosmetics } from '../useCosmetics';
import { getFeesLeaderboard, referralLink, reportPlayer, setReferrer, TX_LABELS, type FeesRow } from '../api';
import { BadgeChip, FeesAmount } from './bits';
import { formatFees } from '../format';

const SHORT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Le porte-monnaie du joueur, sur son profil. */
export function WalletPanel() {
  const { profile, user } = useAuth();
  const { wallet, refreshWallet } = usePlafee();
  const [top, setTop] = useState<FeesRow[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    refreshWallet();
    getFeesLeaderboard(10)
      .then(setTop)
      .catch(() => setTop([]));
  }, [refreshWallet]);

  if (!profile || !user) return null;
  const link = referralLink(profile.username);
  const recent = wallet?.transactions.slice(0, 5) ?? [];

  return (
    <section className="acc-card acc-card-wide plf-wallet" id="fees">
      <div className="plf-wallet-main">
        <h2 className="acc-section-title">
          <Coins size={18} aria-hidden /> Porte-monnaie
        </h2>
        <div className="plf-wallet-balance">
          <FeesAmount value={wallet?.balance ?? 0} size="lg" />
          <Link to="/boutique" className="neon-btn plf-btn-sm" data-variant="solid">
            Boutique
          </Link>
        </div>
        <dl className="plf-wallet-stats">
          <div>
            <dt>Gagnés au total</dt>
            <dd>{formatFees(wallet?.lifetime_earned ?? 0)}</dd>
          </div>
          <div>
            <dt>Dépensés</dt>
            <dd>{formatFees(wallet?.lifetime_spent ?? 0)}</dd>
          </div>
          <div>
            <dt>Série quotidienne</dt>
            <dd>
              <Flame size={14} aria-hidden /> {wallet?.current_streak ?? 0}/7
              {wallet?.played_today ? <small> · gagné aujourd'hui</small> : <small> · gagne une partie aujourd'hui</small>}
            </dd>
          </div>
        </dl>
        <p className="neon-hint">Chaque victoire rapporte des FEES. Une victoire par jour 7 jours de suite : +200 FEES.</p>

        <h3 className="acc-section-title soc-subsection">Dernières transactions</h3>
        {recent.length === 0 ? (
          <p className="soc-empty">Rien pour l'instant. Ta première victoire en rapporte.</p>
        ) : (
          <ul className="plf-tx-list">
            {recent.map((t) => (
              <li key={t.id}>
                <span className="plf-tx-type">{TX_LABELS[t.type] ?? t.type}</span>
                <span className="plf-tx-desc">{t.description}</span>
                <FeesAmount value={t.amount} signed size="sm" />
                <time dateTime={t.created_at}>{SHORT.format(new Date(t.created_at))}</time>
              </li>
            ))}
          </ul>
        )}

        <h3 className="acc-section-title soc-subsection">
          <Gift size={16} aria-hidden /> Parrainage
        </h3>
        <p className="neon-hint">
          Invite un ami avec ton lien : quand il a joué 7 jours d'affilée (et au moins 3 parties), tu gagnes 50 FEES. Jusqu'à 5 amis par
          mois.
        </p>
        <div className="plf-ref">
          <input className="neon-input" value={link} readOnly aria-label="Ton lien de parrainage" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="neon-btn plf-btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(link).catch(() => {});
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
        {wallet && (
          <p className="neon-hint">
            {wallet.referrals.total} ami{wallet.referrals.total > 1 ? 's' : ''} parrainé{wallet.referrals.total > 1 ? 's' : ''}, dont {wallet.referrals.rewarded} récompensé
            {wallet.referrals.rewarded > 1 ? 's' : ''}.
          </p>
        )}
        {Date.now() - new Date(profile.created_at).getTime() < 7 * 86_400_000 && <DeclareReferrer />}
      </div>

      <aside className="plf-wallet-side" aria-label="Les plus riches">
        <h3 className="acc-section-title">Top 10 FEES</h3>
        {!top ? (
          <p className="neon-hint">Chargement…</p>
        ) : top.length === 0 ? (
          <p className="soc-empty">Personne pour l'instant.</p>
        ) : (
          <ol className="plf-mini-rank">
            {top.map((r) => (
              <li key={r.user_id} data-self={r.user_id === user.id || undefined}>
                <span className="plf-mini-pos">{r.position}</span>
                <Link to={`/joueur/${r.username}`}>{r.username}</Link>
                <span>{formatFees(r.balance)}</span>
              </li>
            ))}
          </ol>
        )}
        <Link to="/trophees?onglet=fees" className="sess-link">
          Voir le top 100
        </Link>
      </aside>
    </section>
  );
}

/** Compte créé sans lien : déclarer son parrain dans les 7 jours. */
function DeclareReferrer() {
  const [name, setName] = useState('');
  const [state, setState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await setReferrer(name.trim());
      setState({ tone: 'ok', text: `C'est noté : ${name.trim()} est ton parrain.` });
    } catch (err) {
      setState({ tone: 'error', text: err instanceof Error ? err.message : 'Impossible.' });
    }
  };
  return (
    <form className="plf-ref" onSubmit={submit}>
      <input className="neon-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pseudo de ton parrain" aria-label="Pseudo de ton parrain" />
      <button type="submit" className="neon-btn plf-btn-sm" disabled={name.trim().length < 3}>
        Déclarer
      </button>
      {state && <p className={state.tone === 'ok' ? 'neon-hint' : 'neon-error'}>{state.text}</p>}
    </form>
  );
}

/** Les badges et cosmétiques d'un joueur, sur son profil. */
export function BadgesPanel({ userId, self = false }: { userId: string; self?: boolean }) {
  const c = useCosmetics(userId);
  if (!c) return null;
  const hasAny = c.badges.length || c.border || c.plate || c.title;
  if (!hasAny && !self) return null;
  return (
    <section className="acc-card acc-card-wide" id="badges">
      <h2 className="acc-section-title">
        <Tag size={18} aria-hidden /> Badges & cosmétiques
      </h2>
      {!hasAny ? (
        <p className="soc-empty">
          Aucun badge pour l'instant. Les badges s'obtiennent aux événements, à la <Link to="/boutique">boutique</Link> ou de la main de l'équipe.
        </p>
      ) : (
        <>
          {(c.plate || c.title || c.border) && (
            <p className="plf-equipped-line">
              {c.plate && (
                <>
                  Plaque : <span className="plf-plate">{c.plate}</span>
                </>
              )}
              {c.title && (
                <>
                  {' '}
                  Titre : <span className="plf-title">{c.title}</span>
                </>
              )}
              {c.border === 'badge' && <> · Contour de badge</>}
            </p>
          )}
          <ul className="plf-badge-list">
            {c.badges.map((b) => (
              <li key={b.id}>
                <BadgeChip badge={b} />
                {b.description && <small>{b.description}</small>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const REASONS = [
  { id: 'toxique', label: 'Langage toxique' },
  { id: 'spam', label: 'Spam' },
  { id: 'triche', label: 'Triche' },
  { id: 'pseudo', label: 'Pseudo inapproprié' },
  { id: 'autre', label: 'Autre' },
];

/** Signaler un joueur à l'équipe. */
export function ReportButton({ userId, username }: { userId: string; username: string }) {
  const { status, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('toxique');
  const [details, setDetails] = useState('');
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (status !== 'signed-in' || user?.id === userId) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await reportPlayer(userId, reason, details.trim());
      setResult({ tone: 'ok', text: 'Merci, un admin va regarder.' });
    } catch (err) {
      setResult({ tone: 'error', text: err instanceof Error ? err.message : 'Signalement impossible.' });
    }
  };

  return (
    <>
      <button type="button" className="neon-btn plf-btn-sm" data-variant="ghost" onClick={() => setOpen(true)}>
        <Flag size={14} aria-hidden /> Signaler
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
        }}
        title={`Signaler ${username}`}
      >
        {result?.tone === 'ok' ? (
          <p className="neon-hint">{result.text}</p>
        ) : (
          <form className="plf-buy" onSubmit={submit}>
            <label className="neon-field">
              <span className="neon-field-label">Raison</span>
              <select className="neon-input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="neon-field">
              <span className="neon-field-label">Ce qui s'est passé (facultatif)</span>
              <textarea className="neon-input" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
            </label>
            {result && <p className="neon-error">{result.text}</p>}
            <div className="plf-actions">
              <button type="submit" className="neon-btn" data-variant="danger">
                Envoyer le signalement
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
