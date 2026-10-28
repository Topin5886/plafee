import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { MainMenu } from './MainMenu';
import { AccountMenu } from '../features/account/components/AccountMenu';
import { NotificationBell } from '../features/social/components/NotificationBell';
import { SocialNav } from '../features/social/components/SocialNav';
import { accountsEnabled } from '../lib/supabase';
import { useAuth } from '../features/account/useAuth';
import { HeaderExtras } from '../features/plafee/components/site';

const BRAND = `${import.meta.env.BASE_URL}brand/`;

/*
 * Les paliers de l'en-tête, du plus riche au plus serré (voir arcade.css).
 * On prend le premier qui tient : l'en-tête ne déborde jamais, quelle que
 * soit la largeur, et quels que soient les boutons affichés (admin, solde…).
 *   full    onglets dans l'en-tête, tous les libellés
 *   tabs    les onglets gardent leurs libellés, les commandes passent en icônes
 *   active  seul l'onglet actif garde son libellé
 *   icons   onglets en icônes seules
 *   out     les onglets redescendent dans la page ; commandes avec libellés
 *   compact commandes en icônes
 *   mini    le logo perd son lettrage
 *   tiny    cases de 34px, espacement resserré
 */
const LEVELS = ['full', 'tabs', 'active', 'icons', 'out', 'compact', 'mini', 'tiny'] as const;
const NAV_IN = new Set<string>(['full', 'tabs', 'active', 'icons']);

function useHeaderFit() {
  const header = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const h = header.current;
    const b = bar.current;
    if (!h || !b) return;
    const root = document.documentElement;

    const fit = () => {
      const hasNav = !!b.querySelector('.soc-nav');
      let level: string = LEVELS[LEVELS.length - 1];
      for (const l of LEVELS) {
        if (!hasNav && NAV_IN.has(l)) continue;
        h.dataset.fit = l;
        // `safe flex-end` : un contenu trop large part de la gauche, donc
        // scrollWidth mesure bien tout le dépassement.
        if (b.scrollWidth <= b.clientWidth) {
          level = l;
          break;
        }
      }
      h.dataset.fit = level;
      // Les onglets de la page se cachent quand ils sont déjà dans l'en-tête.
      root.dataset.hdrNav = hasNav && NAV_IN.has(level) ? 'in' : 'out';
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(h);
    // Le contenu change aussi : solde, onglet actif, bouton admin, pastilles.
    const mutations = new MutationObserver(schedule);
    mutations.observe(b, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      delete root.dataset.hdrNav;
    };
  }, []);

  return { header, bar };
}

export function Header() {
  const { status } = useAuth();
  const { header, bar } = useHeaderFit();
  return (
    <header className="site-header" ref={header}>
      <div className="container site-header-inner">
        <Link to="/" className="site-brand" aria-label="PLAFEE, accueil">
          <img src={`${BRAND}plafee-mark.svg`} alt="" className="site-brand-mark" width={23} height={40} />
          <img src={`${BRAND}plafee-wordmark.svg`} alt="" className="site-brand-word" width={116} height={20} />
        </Link>
        {/* Onglets et commandes : une seule rangée calée à droite, même écart partout. */}
        <div className="site-header-bar" ref={bar}>
          <SocialNav variant="header" />
          <div className="site-header-actions">
            {/* Les classements sont publics : le raccourci reste visible sans
                compte. Connecté, il s'efface quand les onglets (qui ont les
                classements) sont dans l'en-tête, et au téléphone, où il cède
                sa place au bouton d'amis. */}
            {accountsEnabled && (
              <Link
                to="/classements"
                className={`account-chip account-chip-icon hdr-classements${status === 'signed-in' ? ' hdr-hide-mobile' : ''}`}
                aria-label="Classements"
                title="Classements"
              >
                <Trophy size={17} aria-hidden />
              </Link>
            )}
            <HeaderExtras />
            <NotificationBell />
            <AccountMenu />
            <ThemeToggle />
            <MainMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
