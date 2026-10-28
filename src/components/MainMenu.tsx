import { useEffect, useId, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { Gauge, House, MessagesSquare, PartyPopper, Radio, Settings, Store, Trophy, Medal, Users, X, type LucideProps } from 'lucide-react';
import { accountsEnabled } from '../lib/supabase';
import { useAuth } from '../features/account/useAuth';
import { useSocial } from '../features/social/useSocial';
import { usePlafee } from '../features/plafee/usePlafee';

/**
 * Le menu principal : le bouton « trois traits » à gauche du logo, et le
 * tiroir qui glisse depuis le bord de l'écran.
 *
 * L'en-tête ne garde que l'essentiel (Accueil, Classements, Boutique) ; tout
 * le reste du site se range ici. Le compte (profil, trophées, photo,
 * déconnexion) reste derrière l'avatar.
 *
 * Comme le menu du compte, c'est un `popover` natif : couche supérieure,
 * Échap et clic extérieur gérés par le navigateur, focus rendu au bouton.
 */

interface Entry {
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  badge?: number;
  /** Réservé aux joueurs connectés. */
  account?: boolean;
}

export function MainMenu() {
  const { status } = useAuth();
  const { incoming, groupInvitations } = useSocial();
  const { isAdmin } = usePlafee();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Le bouton suit l'état réel du popover (Échap, clic dehors…).
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === 'open');
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);

  const signedIn = accountsEnabled && status === 'signed-in';
  const close = () => menuRef.current?.hidePopover();

  const sections: { title: string; entries: Entry[] }[] = [
    {
      title: 'Jouer',
      entries: [
        { to: '/', label: 'Accueil', icon: House },
        { to: '/sessions', label: 'Sessions', icon: Radio, account: true },
        { to: '/evenements', label: 'Événements', icon: PartyPopper },
      ],
    },
    {
      title: 'Entre potes',
      entries: [
        { to: '/amis', label: 'Amis', icon: Users, badge: incoming.length, account: true },
        { to: '/groupes', label: 'Groupes', icon: MessagesSquare, badge: groupInvitations.length, account: true },
      ],
    },
    {
      title: 'Gloire',
      entries: [
        { to: '/classements', label: 'Classements', icon: Trophy },
        { to: '/trophees', label: 'Hall des trophées', icon: Medal },
        { to: '/boutique', label: 'Boutique', icon: Store, account: true },
      ],
    },
  ];

  const pending = signedIn ? incoming.length + groupInvitations.length : 0;
  let n = 0;

  return (
    <>
      <button
        type="button"
        className="main-menu-btn"
        popoverTarget={menuId}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={pending > 0 ? `Menu (${pending} en attente)` : 'Menu'}
        title="Menu"
        data-open={open || undefined}
      >
        <span className="main-menu-bars" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        {pending > 0 && <span className="main-menu-dot" aria-hidden />}
      </button>

      <div id={menuId} ref={menuRef} popover="auto" className="main-menu acc-scope" aria-label="Menu principal">
        <div className="main-menu-head">
          <span className="main-menu-title">
            <span className="main-menu-caret" aria-hidden>
              ▶
            </span>
            Menu
          </span>
          <button type="button" className="main-menu-close" onClick={close} aria-label="Fermer le menu">
            <X size={18} aria-hidden />
          </button>
        </div>

        <nav className="main-menu-body">
          {sections.map(({ title, entries }) => {
            const shown = entries.filter((e) => !e.account || signedIn);
            if (shown.length === 0) return null;
            return (
              <div key={title} className="main-menu-section">
                <p className="main-menu-section-title">{title}</p>
                {shown.map(({ to, label, icon: Icon, badge }) => {
                  n += 1;
                  return (
                    <NavLink key={to} to={to} end onClick={close} className="main-menu-link" style={{ '--i': n } as CSSProperties}>
                      <span className="main-menu-num" aria-hidden>
                        {String(n).padStart(2, '0')}
                      </span>
                      <Icon size={17} aria-hidden />
                      <span className="main-menu-label">{label}</span>
                      {signedIn && badge ? (
                        <span className="soc-badge" aria-label={`${badge} en attente`}>
                          {badge}
                        </span>
                      ) : null}
                      <span className="main-menu-arrow" aria-hidden>
                        ›
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {signedIn && (
          <div className="main-menu-foot">
            {isAdmin && (
              <NavLink to="/admin" onClick={close} className="main-menu-link main-menu-admin">
                <span className="main-menu-num" aria-hidden />
                <Gauge size={17} aria-hidden />
                <span className="main-menu-label">Dashboard admin</span>
                <span className="main-menu-arrow" aria-hidden>
                  ›
                </span>
              </NavLink>
            )}
            <NavLink to="/compte" end onClick={close} className="main-menu-link">
              <span className="main-menu-num" aria-hidden />
              <Settings size={17} aria-hidden />
              <span className="main-menu-label">Paramètres</span>
              <span className="main-menu-arrow" aria-hidden>
                ›
              </span>
            </NavLink>
          </div>
        )}

        <p className="main-menu-hint" aria-hidden>
          <kbd>Échap</kbd> pour fermer
        </p>
      </div>
    </>
  );
}
