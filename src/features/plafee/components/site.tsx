import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, PartyPopper, ShieldAlert, Store, X } from 'lucide-react';
import { useAuth } from '../../account/useAuth';
import { Modal } from '../../social/components/Modal';
import { usePlafee } from '../usePlafee';
import { OBJECTIVE_LABELS, timeLeft, type PlafeeEvent } from '../api';
import { eventProgress, objectiveText } from '../format';
import { FeesAmount, RarityTag } from './bits';
import { contestHref } from '../../legal/legal';

/** Se remet à jour chaque minute, pour les comptes à rebours. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const DISMISS_KEY = 'plafee-event-banner-hidden';

/** La bande d'annonce en haut du site, tant qu'un événement est en cours. */
export function EventBanner() {
  const { events } = usePlafee();
  const now = useMinuteClock();
  const live = events.filter((e) => e.status === 'live');
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const shown = live.find((e) => !hidden.includes(e.id));
  if (!shown) return null;

  const hide = () => {
    const next = [...hidden, shown.id];
    setHidden(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Masqué pour cette visite seulement.
    }
  };

  return (
    <div className="plf-event-banner" role="region" aria-label="Événement en cours">
      <div className="container plf-event-banner-inner">
        <PartyPopper size={18} aria-hidden />
        <Link to="/evenements" className="plf-event-banner-text">
          <strong>{shown.name} en cours</strong>
          <span>
            {objectiveText(shown)} · {timeLeft(shown, now)}
            {live.length > 1 && ` · +${live.length - 1} autre${live.length > 2 ? 's' : ''}`}
          </span>
        </Link>
        <button type="button" className="plf-event-banner-close" onClick={hide} aria-label="Masquer l'annonce">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

const SEEN_KEY = 'plafee-events-seen';

/** Une fenêtre à la première visite pendant un événement (une seule, même s'il y en a plusieurs). */
export function EventPopup() {
  const { events } = usePlafee();
  const [seen, setSeen] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
    } catch {
      setSeen([]);
    }
  }, []);
  const fresh = useMemo(() => (seen ? events.find((e) => e.status === 'live' && !seen.includes(e.id)) : undefined), [events, seen]);
  if (!fresh || !seen) return null;

  // Une seule fenêtre : la fermer vaut pour tous les événements en cours.
  const close = () => {
    const live = events.filter((e) => e.status === 'live').map((e) => e.id);
    const next = [...new Set([...seen, ...live])].slice(-50);
    setSeen(next);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      // Revu à la prochaine visite.
    }
  };

  return (
    <Modal open onClose={close} title="Événement en cours">
      <div className="plf-event-pop">
        {fresh.image_url ? (
          <img src={fresh.image_url} alt="" className="plf-event-img" />
        ) : (
          <span className="plf-event-icon" aria-hidden>
            <PartyPopper size={40} />
          </span>
        )}
        <h3>{fresh.name}</h3>
        {fresh.description && <p>{fresh.description}</p>}
        <p className="plf-event-goal">{objectiveText(fresh)}</p>
        <p className="neon-hint">
          Trophée <RarityTag tier={fresh.trophy_rarity} /> en édition limitée
          {fresh.reward_fees > 0 && (
            <>
              {' '}
              + <FeesAmount value={fresh.reward_fees} size="sm" />
            </>
          )}{' '}
          · {timeLeft(fresh)}
        </p>
        <div className="plf-actions">
          <Link to="/evenements" className="neon-btn" data-variant="solid" onClick={close}>
            Voir l'événement
          </Link>
          <button type="button" className="neon-btn" data-variant="ghost" onClick={close}>
            Plus tard
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** La carte d'un événement : accueil, page des événements. */
export function EventCard({ e, compact = false }: { e: PlafeeEvent; compact?: boolean }) {
  const now = useMinuteClock();
  const { status } = useAuth();
  const p = eventProgress(e);
  const pct = Math.round((p.value / p.goal) * 100);
  const mine = e.objective_type !== 'global_target';
  return (
    <article className="plf-event-card" data-status={e.status} data-compact={compact || undefined}>
      <header>
        <span className="plf-event-status">{e.status === 'live' ? 'En cours' : e.status === 'upcoming' ? 'Bientôt' : 'Terminé'}</span>
        <span className="plf-event-time">{timeLeft(e, now)}</span>
      </header>
      <div className="plf-event-body">
        {e.image_url ? (
          <img src={e.image_url} alt="" className="plf-event-img" />
        ) : (
          <span className="plf-event-icon" aria-hidden>
            <PartyPopper size={compact ? 26 : 34} />
          </span>
        )}
        <div>
          <h3>{e.name}</h3>
          {!compact && e.description && <p>{e.description}</p>}
          <p className="plf-event-goal">{objectiveText(e)}</p>
        </div>
      </div>
      <div className="plf-event-reward">
        <span>
          Trophée <RarityTag tier={e.trophy_rarity} />
        </span>
        {e.reward_fees > 0 && <FeesAmount value={e.reward_fees} signed size="sm" />}
      </div>
      {e.status !== 'upcoming' && (mine ? status === 'signed-in' : true) && (
        <div className="plf-event-progress" aria-label={`Progression : ${p.value} sur ${p.goal}`}>
          <span className="ach-bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span>
            {e.my_completed ? 'Complété !' : `${p.value.toLocaleString('fr-FR')} / ${p.goal.toLocaleString('fr-FR')}`}
            {!mine && ' (communauté)'}
          </span>
        </div>
      )}
      <footer className="plf-event-foot">
        {e.participants} participant{e.participants > 1 ? 's' : ''} · {e.completed} l'ont complété · {OBJECTIVE_LABELS[e.objective_type]}
      </footer>
    </article>
  );
}

/** Les événements en cours, en tête de l'accueil. */
export function HomeEvents() {
  const { events } = usePlafee();
  const live = events.filter((e) => e.status === 'live');
  if (!live.length) return null;
  return (
    <section className="plf-home-events" aria-label="Événements en cours">
      {live.slice(0, 2).map((e) => (
        <Link key={e.id} to="/evenements" className="plf-home-event-link">
          <EventCard e={e} compact />
        </Link>
      ))}
    </section>
  );
}

/** Solde FEES et accès admin, dans l'en-tête. */
export function HeaderExtras() {
  const { status } = useAuth();
  const { wallet, isAdmin } = usePlafee();
  if (status !== 'signed-in') return null;
  return (
    <>
      {isAdmin && (
        <Link to="/admin" className="account-chip plf-admin-chip" title="Tableau de bord admin">
          <Gauge size={16} aria-hidden />
          <span className="account-chip-label">Dashboard</span>
        </Link>
      )}
      <Link to="/boutique" className="account-chip plf-fees-chip" title="Boutique et FEES" aria-label={`Boutique — ${wallet?.balance ?? 0} FEES`}>
        <Store size={16} aria-hidden className="plf-fees-chip-store" />
        <FeesAmount value={wallet?.balance ?? 0} size="sm" />
      </Link>
    </>
  );
}

/** Compte suspendu, ou avertissement récent d'un admin. */
export function StandingNotice() {
  const { standing } = usePlafee();
  if (!standing) return null;
  if (standing.banned) {
    return (
      <div className="plf-standing" data-kind="ban" role="alert">
        <div className="container plf-standing-inner">
          <ShieldAlert size={18} aria-hidden />
          <span>
            <strong>Ton compte est suspendu.</strong> Tu peux encore jouer en invité, mais tes parties ne comptent plus et tu ne peux plus
            écrire aux autres.
            {standing.ban_reason && <> Motif : {standing.ban_reason}.</>}{' '}
            <a href={contestHref('bannissement')} className="plf-standing-link">
              Contester
            </a>
          </span>
        </div>
      </div>
    );
  }
  return <WarningNotice warnings={standing.warnings} />;
}

const WARN_SEEN_KEY = 'plafee-warnings-seen';
const WARN_MS = 10_000;

function seenWarnings(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WARN_SEEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * Un avertissement ne s'affiche qu'une fois : il s'efface seul au bout de
 * quelques secondes (ou d'un clic) et ne revient plus. Il reste lisible dans
 * la cloche. Seule la suspension du compte, plus haut, reste en place.
 */
function WarningNotice({ warnings }: { warnings: { message: string; created_at: string }[] }) {
  const [seen, setSeen] = useState(seenWarnings);
  const recent = warnings.find((w) => Date.now() - new Date(w.created_at).getTime() < 7 * 86_400_000 && !seen.includes(w.created_at));

  const close = useCallback(() => {
    if (!recent) return;
    const next = [...seenWarnings(), recent.created_at].slice(-20);
    try {
      localStorage.setItem(WARN_SEEN_KEY, JSON.stringify(next));
    } catch {
      // Masqué pour cette visite seulement.
    }
    setSeen(next);
  }, [recent]);

  useEffect(() => {
    if (!recent) return;
    const t = window.setTimeout(close, WARN_MS);
    return () => window.clearTimeout(t);
  }, [recent, close]);

  if (!recent) return null;
  return (
    <div className="plf-standing" data-kind="warn" role="status">
      <div className="container plf-standing-inner">
        <ShieldAlert size={18} aria-hidden />
        <span>
          <strong>Avertissement de l'équipe PLAFEE :</strong> {recent.message}{' '}
          <a href={contestHref('avertissement')} className="plf-standing-link">
            Contester
          </a>
        </span>
        <button type="button" className="plf-event-banner-close" onClick={close} aria-label="Fermer">
          <X size={16} />
        </button>
      </div>
      <span className="plf-standing-timer" style={{ animationDuration: `${WARN_MS}ms` }} aria-hidden />
    </div>
  );
}
