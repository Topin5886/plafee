import { NavLink } from 'react-router-dom';
import { House, PartyPopper, Store, Trophy } from 'lucide-react';
import { accountsEnabled } from '../../../lib/supabase';
import { useSocial } from '../useSocial';

/**
 * La navigation de l'espace compte, en tête de chacune de ses pages.
 *
 * Quatre destinations visibles d'un coup d'oeil ; le reste du site est rangé
 * dans le menu principal (MainMenu), et le compte derrière l'avatar.
 */
export function SocialNav({ variant = 'page' }: { variant?: 'page' | 'header' }) {
  const { active } = useSocial();

  // L'essentiel seulement : Amis a son bouton dans l'en-tête, Groupes et
  // Sessions sont dans le menu « trois traits », le profil derrière l'avatar.
  const links = [
    { to: '/', label: 'Accueil', icon: House, badge: 0 },
    { to: '/classements', label: 'Classements', icon: Trophy, badge: 0 },
    { to: '/evenements', label: 'Événements', icon: PartyPopper, badge: 0 },
    { to: '/boutique', label: 'Boutique', icon: Store, badge: 0 },
  ];

  // Ces quatre pages sont publiques : dans l'en-tête, un visiteur les voit
  // aussi. Dans la page, les onglets restent réservés à l'espace compte.
  if (variant === 'header' ? !accountsEnabled : !active) return null;

  return (
    <nav className="soc-nav" data-variant={variant} aria-label={variant === 'header' ? 'Navigation principale' : 'Espace joueur'}>
      {links.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className="soc-nav-link"
          end
          // Sur téléphone, les libellés se cachent : le nom du lien reste là.
          aria-label={badge > 0 ? `${label} (${badge} en attente)` : label}
          title={label}
        >
          <Icon size={16} aria-hidden />
          <span className="soc-nav-label">{label}</span>
          {badge > 0 && (
            <span className="soc-badge" aria-label={`${badge} en attente`}>
              {badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
