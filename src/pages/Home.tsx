import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Flame, Radio, Trophy } from 'lucide-react';
import { GameTitle } from '../components/GameTitle';
import { accountsEnabled } from '../lib/supabase';
import { GAMES, gameById, type GameEntry } from '../features/games';
import { getTrendingGame, refreshMyAchievements } from '../features/achievements/api';
import { useAuth } from '../features/account/useAuth';
import { Splash } from './home/Splash';
import { HomeSide } from './home/HomeSide';
import { HomeEvents } from '../features/plafee/components/site';
import './home/home.css';

// Le tableau de bord (tables, classement, parties, groupes) sous l'écran
// d'accueil : chargé à la demande, il ne concerne que les joueurs connectés.
const DashboardSections = lazy(() =>
  import('../features/social/pages/DashboardPage').then((m) => ({ default: m.DashboardSections })),
);

const SPLASH_KEY = 'cafet-splash-seen';
const SPLASH_MIN_MS = 1700;
const BRAND = `${import.meta.env.BASE_URL}brand/`;

function splashSeen() {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * L'accueil, façon salle d'arcade : le fronton (la bannière de la charte),
 * les jeux en bornes néon — le jeu du moment en tête — et la fiche du
 * joueur ; le tableau de bord en dessous pour un joueur connecté.
 *
 * À la première visite, l'écran de démarrage allume le logo flamme par
 * flamme, puis laisse place à l'interface par un zoom flouté.
 */
export function Home() {
  const reduce = useReducedMotion();
  const { status } = useAuth();
  const [splash, setSplash] = useState(() => !splashSeen());
  const [trending, setTrending] = useState<GameEntry>(() => gameById('flip7')!);

  useEffect(() => {
    if (!splash) return;
    const start = Date.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.setTimeout(() => {
        setSplash(false);
        try {
          sessionStorage.setItem(SPLASH_KEY, '1');
        } catch {
          // Tant pis, il reviendra à la prochaine visite.
        }
      }, Math.max(0, SPLASH_MIN_MS - (Date.now() - start)));
    };
    // L'accueil doit arriver dans ses polices pixel, pas dans celles de secours.
    if (document.fonts) document.fonts.ready.then(finish, finish);
    else finish();
    const cap = window.setTimeout(finish, 3200);
    return () => window.clearTimeout(cap);
  }, [splash]);

  useEffect(() => {
    if (!accountsEnabled) return;
    getTrendingGame()
      .then((id) => setTrending(gameById(id) ?? gameById('flip7')!))
      .catch(() => {});
  }, []);

  // Les trophées qui ne viennent pas d'une partie (groupes, podium de la
  // semaine passée) : relus une fois par visite. Un déblocage s'annonce tout
  // seul par sa notification.
  useEffect(() => {
    if (status !== 'signed-in') return;
    try {
      if (sessionStorage.getItem('cafet-ach-refreshed') === '1') return;
      sessionStorage.setItem('cafet-ach-refreshed', '1');
    } catch {
      // Pas de stockage : on relit à chaque accueil, sans conséquence.
    }
    refreshMyAchievements().catch(() => {});
  }, [status]);

  const others = GAMES.filter((g) => g.id !== trending.id);

  return (
    <div className="home">
      <AnimatePresence>{splash && <Splash key="splash" />}</AnimatePresence>

      {!splash && (
        <motion.div
          className="container home-layout"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.06, filter: 'blur(12px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Sur grand écran, l'événement en cours se range à droite du
              fronton, dans la même colonne que la fiche du joueur. */}
          <div className="home-top">
            <section className="home-hero" aria-labelledby="home-title">
              <div className="home-marquee">
                <img src={`${BRAND}plafee-banner.svg`} alt="" className="home-banner" width={1662} height={650} />
              </div>
              <div className="home-hero-copy">
                <h1 id="home-title" className="home-title">
                  <span className="soc-sr-only">PLAFEE : </span>La salle d'arcade entre potes
                </h1>
                <Link to={trending.to} className="home-press" aria-label={`Jouer au jeu tendance : ${trending.name}`}>
                  <span className="home-press-key">
                    <span className="plf-blink" aria-hidden>
                      ▶
                    </span>{' '}
                    Press start
                  </span>
                  <small aria-hidden>Jeu tendance : {trending.name}</small>
                </Link>
              </div>
            </section>

            <HomeEvents />
          </div>

          <div className="home-main">
            <section className="home-games-wrap" aria-labelledby="home-games-title">
              <header className="home-section-head">
                <h2 id="home-games-title">Choisis ton jeu</h2>
                <span className="home-credits" aria-hidden>
                  Free play
                </span>
              </header>
              <nav className="home-games" aria-label="Les jeux">
                <GameTile game={trending} hot />
                {others.map((g) => (
                  <GameTile key={g.id} game={g} />
                ))}
                {/* La sixième borne : les tables des amis pour un joueur
                    connecté, les classements pour un visiteur. */}
                {status === 'signed-in' ? (
                  <Link to="/sessions" className="home-tile" data-kind="extra">
                    <span className="home-tile-top">
                      <span>Multijoueur</span>
                    </span>
                    <span className="home-tile-icon" aria-hidden>
                      <Radio size={28} strokeWidth={1.75} />
                    </span>
                    <strong className="home-tile-name">Tables</strong>
                    <span className="home-tile-desc">Rejoins les parties ouvertes de tes amis.</span>
                    <span className="home-tile-cta">
                      Voir <ChevronRight size={16} aria-hidden />
                    </span>
                  </Link>
                ) : (
                  <Link to="/classements" className="home-tile" data-kind="extra">
                    <span className="home-tile-top">
                      <span>Hi-score</span>
                    </span>
                    <span className="home-tile-icon" aria-hidden>
                      <Trophy size={28} strokeWidth={1.75} />
                    </span>
                    <strong className="home-tile-name">Classements</strong>
                    <span className="home-tile-desc">Qui mène la salle cette semaine.</span>
                    <span className="home-tile-cta">
                      Voir <ChevronRight size={16} aria-hidden />
                    </span>
                  </Link>
                )}
              </nav>
            </section>

            <HomeSide />
          </div>
        </motion.div>
      )}

      {!splash && status === 'signed-in' && (
        <Suspense fallback={null}>
          <div className="container">
            <DashboardSections withFriends={false} />
          </div>
        </Suspense>
      )}
    </div>
  );
}

/** Une borne : le jeu, sa devise, son nombre de joueurs. */
function GameTile({ game, hot = false }: { game: GameEntry; hot?: boolean }) {
  const Icon = game.icon;
  return (
    <Link
      to={game.to}
      className="home-tile"
      data-hot={hot || undefined}
      aria-label={`${game.name}${hot ? ', jeu tendance' : ''} — ${game.tagline} ${game.players}.`}
    >
      <span className="home-tile-top" aria-hidden>
        {hot ? (
          <span className="home-tile-badge">
            <Flame size={12} aria-hidden /> Hot
          </span>
        ) : (
          <span>Jeu</span>
        )}
        <span className="home-tile-players">{game.players}</span>
      </span>
      <span className="home-tile-icon" aria-hidden>
        <Icon size={28} strokeWidth={1.75} />
      </span>
      <GameTitle game={game.id} size="lg" motto />
      <span className="home-tile-desc" aria-hidden>
        {game.tagline}
      </span>
      <span className="home-tile-cta" aria-hidden>
        Jouer <ChevronRight size={16} aria-hidden />
      </span>
    </Link>
  );
}
