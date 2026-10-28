import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Award, BarChart3, Coins, Flag, Gauge, PartyPopper, ScrollText, ShieldAlert, Sparkles, Tag, Users, Zap } from 'lucide-react';
import { useAuth } from '../../account/useAuth';
import { usePlafee } from '../usePlafee';
import { StatsTab } from './StatsTab';
import { PlayersTab } from './PlayersTab';
import { TrophiesTab } from './TrophiesTab';
import { BadgesTab } from './BadgesTab';
import { EventsTab } from './EventsTab';
import { ModerationTab } from './ModerationTab';
import { ReportsTab } from './ReportsTab';
import { FeesTab } from './FeesTab';
import { LogsTab } from './LogsTab';
import { LogoTestTab } from './LogoTestTab';
import { GodTab } from './GodTab';
import './admin.css';

const TABS = [
  { id: 'stats', label: 'Statistiques', icon: BarChart3, Panel: StatsTab },
  { id: 'joueurs', label: 'Joueurs', icon: Users, Panel: PlayersTab },
  { id: 'trophees', label: 'Trophées', icon: Award, Panel: TrophiesTab },
  { id: 'badges', label: 'Badges', icon: Tag, Panel: BadgesTab },
  { id: 'evenements', label: 'Événements', icon: PartyPopper, Panel: EventsTab },
  { id: 'moderation', label: 'Modération', icon: ShieldAlert, Panel: ModerationTab },
  { id: 'rapports', label: 'Rapports', icon: Flag, Panel: ReportsTab },
  { id: 'fees', label: 'FEES', icon: Coins, Panel: FeesTab },
  { id: 'journal', label: 'Journal', icon: ScrollText, Panel: LogsTab },
  { id: 'animation', label: 'Animation', icon: Sparkles, Panel: LogoTestTab },
  // Réservé au super admin : la base refuse les autres de toute façon.
  { id: 'god', label: 'God mode', icon: Zap, Panel: GodTab, superOnly: true },
];

/**
 * Le tableau de bord de PLAFEE, réservé aux admins.
 *
 * Masquer la page n'est qu'une commodité : chaque action passe par une
 * fonction `admin_*` qui vérifie en base que l'appelant est admin.
 */
export function AdminPage() {
  const { status } = useAuth();
  const { standing, isAdmin, isSuperAdmin } = usePlafee();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !('superOnly' in t) || isSuperAdmin);
  const tab = tabs.find((t) => t.id === params.get('onglet')) ?? tabs[0];

  if (status === 'loading' || (status === 'signed-in' && !standing)) {
    return (
      <div className="container acc-scope">
        <div className="acc-page">
          <p role="status">Vérification de tes droits…</p>
        </div>
      </div>
    );
  }
  if (status === 'signed-out') return <Navigate to="/connexion" state={{ from: location.pathname }} replace />;
  if (!isAdmin) {
    return (
      <div className="container acc-scope">
        <div className="acc-page">
          <section className="acc-card">
            <h1 className="acc-title">Accès réservé</h1>
            <p className="acc-subtitle">Cette page est réservée à l'équipe PLAFEE.</p>
          </section>
        </div>
      </div>
    );
  }

  const Panel = tab.Panel;
  return (
    <div className="container acc-scope adm">
      <header className="adm-head">
        <h1 className="acc-title">
          <Gauge size={26} aria-hidden /> Dashboard admin
        </h1>
        <nav className="adm-tabs" aria-label="Sections du tableau de bord">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className="adm-tab" data-god={id === 'god' || undefined} aria-current={tab.id === id ? 'page' : undefined} onClick={() => setParams({ onglet: id })}>
              <Icon size={15} aria-hidden /> {label}
            </button>
          ))}
        </nav>
      </header>
      <Panel />
    </div>
  );
}
