import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { ArcadeBackdrop } from './components/ArcadeBackdrop';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { ScopaLobby } from './features/scopa/ScopaLobby';
import { ScopaRoom } from './features/scopa/ScopaRoom';
import { P4Lobby } from './features/puissance4/P4Lobby';
import { P4Room } from './features/puissance4/P4Room';
import { OriginalLobby } from './features/puissance4/original/OriginalLobby';
import { OriginalRoom } from './features/puissance4/original/OriginalRoom';
import { UnoLobby } from './features/uno/UnoLobby';
import { UnoRoom } from './features/uno/UnoRoom';
import { AuthProvider } from './features/account/AuthProvider';
import { LoginPage } from './features/account/LoginPage';
import { RegisterPage } from './features/account/RegisterPage';
import { ProfilePage } from './features/account/ProfilePage';
import { SocialProvider } from './features/social/SocialProvider';
import { PlafeeProvider } from './features/plafee/PlafeeProvider';
import { EventBanner, StandingNotice } from './features/plafee/components/site';
import { LaunchPopups } from './features/plafee/components/patchNotes';
import { VictoryFx } from './features/plafee/components/VictoryFx';
import { SiteFooter } from './features/legal/SiteFooter';
import { LegalGate } from './features/legal/LegalGate';

const Flip7Lobby = lazy(() => import('./features/flip7/Flip7Lobby').then(m => ({ default: m.Flip7Lobby })));
const Flip7Room = lazy(() => import('./features/flip7/Flip7Room').then(m => ({ default: m.Flip7Room })));
const VeriteLobby = lazy(() => import('./features/verite/VeriteLobby').then(m => ({ default: m.VeriteLobby })));
const VeriteRoom = lazy(() => import('./features/verite/VeriteRoom').then(m => ({ default: m.VeriteRoom })));
// L'espace joueur n'intéresse que les joueurs connectés (et les curieux des
// classements) : il se charge à la demande plutôt que d'alourdir la page
// d'accueil et les tables de jeu.
const DashboardPage = lazy(() => import('./features/social/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const FriendsPage = lazy(() => import('./features/social/pages/FriendsPage').then(m => ({ default: m.FriendsPage })));
const GroupsPage = lazy(() => import('./features/social/pages/GroupsPage').then(m => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import('./features/social/pages/GroupDetailPage').then(m => ({ default: m.GroupDetailPage })));
const LeaderboardsPage = lazy(() => import('./features/social/pages/LeaderboardsPage').then(m => ({ default: m.LeaderboardsPage })));
const SessionsPage = lazy(() => import('./features/social/pages/SessionsPage').then(m => ({ default: m.SessionsPage })));
const PlayerPage = lazy(() => import('./features/social/pages/PlayerPage').then(m => ({ default: m.PlayerPage })));
// PLAFEE V2 : boutique, hall des trophées, événements, et le tableau de bord admin.
const ShopPage = lazy(() => import('./features/plafee/pages/ShopPage').then(m => ({ default: m.ShopPage })));
const TrophyHallPage = lazy(() => import('./features/plafee/pages/TrophyHallPage').then(m => ({ default: m.TrophyHallPage })));
const EventsPage = lazy(() => import('./features/plafee/pages/EventsPage').then(m => ({ default: m.EventsPage })));
const PatchNotesPage = lazy(() => import('./features/plafee/pages/PatchNotesPage').then(m => ({ default: m.PatchNotesPage })));
const AdminPage = lazy(() => import('./features/plafee/admin/AdminPage').then(m => ({ default: m.AdminPage })));
const LegalPage = lazy(() => import('./features/legal/LegalPage'));

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ArcadeBackdrop />
      {/* Le provider enveloppe l'en-tête autant que les pages : c'est lui qui
          alimente le raccourci de compte, visible partout sur le site. */}
      <AuthProvider>
      <SocialProvider>
      <PlafeeProvider>
      <Header />
      <StandingNotice />
      <EventBanner />
      <LaunchPopups />
      <VictoryFx />
      <main className="site-main">
        <Suspense
          fallback={
            <div className="container site-loading" role="status">
              Chargement<span className="plf-blink">_</span>
            </div>
          }
        ><Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scopa" element={<ScopaLobby />} />
          <Route path="/scopa/:code" element={<ScopaRoom />} />
          <Route path="/puissance4" element={<P4Lobby />} />
          <Route path="/puissance4/:code" element={<P4Room />} />
          <Route path="/puissance4-original" element={<OriginalLobby />} />
          <Route path="/puissance4-original/:code" element={<OriginalRoom />} />
          <Route path="/uno" element={<UnoLobby />} />
          <Route path="/uno/:code" element={<UnoRoom />} />
          <Route path="/flip7" element={<Flip7Lobby />} />
          <Route path="/flip7/:code" element={<Flip7Room />} />
          <Route path="/verite" element={<VeriteLobby />} />
          <Route path="/verite/:code" element={<VeriteRoom />} />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/compte" element={<ProfilePage />} />
          <Route path="/tableau-de-bord" element={<DashboardPage />} />
          <Route path="/amis" element={<FriendsPage />} />
          <Route path="/groupes" element={<GroupsPage />} />
          <Route path="/groupes/:groupId" element={<GroupDetailPage />} />
          <Route path="/classements" element={<LeaderboardsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/joueur/:username" element={<PlayerPage />} />
          <Route path="/boutique" element={<ShopPage />} />
          <Route path="/trophees" element={<TrophyHallPage />} />
          <Route path="/evenements" element={<EventsPage />} />
          <Route path="/nouveautes" element={<PatchNotesPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/mentions-legales" element={<LegalPage page="mentions-legales" />} />
          <Route path="/confidentialite" element={<LegalPage page="confidentialite" />} />
          <Route path="/cgu" element={<LegalPage page="cgu" />} />
          <Route path="*" element={<NotFound />} />
        </Routes></Suspense>
      </main>
      <SiteFooter />
      <LegalGate />
      </PlafeeProvider>
      </SocialProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
