import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { accountsEnabled } from '../../lib/supabase';
import { useAuth } from './useAuth';
import { NeonButton } from './components/NeonButton';
import { NeonInput } from './components/NeonInput';
import { AccBanner } from './components/AccBanner';

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // D'où venait le joueur avant d'être renvoyé ici. Le ramener à sa page
  // d'origine vaut mieux que de le déposer systématiquement sur son profil.
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  // Arrivée ici juste après « Supprimer mon compte ».
  const deleted = Boolean((location.state as { deleted?: boolean } | null)?.deleted);

  // Déjà connecté (session reprise, ou retour en arrière du navigateur) :
  // rediriger par le rendu plutôt qu'en appelant navigate() pendant celui-ci,
  // qui reviendrait à changer d'état au milieu d'un rendu.
  // Juste après une suppression, la session locale peut mettre un instant à
  // tomber : ne pas renvoyer vers l'accueil un compte qui n'existe plus.
  if (status === 'signed-in' && !deleted) return <Navigate to={from} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
      setBusy(false);
    }
  }

  return (
    <div className="container acc-scope">
      <div className="acc-page">
        <form className="acc-card" onSubmit={onSubmit}>
          <h1 className="acc-title">Content de te revoir</h1>
          <p className="acc-subtitle">Connecte-toi pour retrouver tes statistiques.</p>

          {deleted && <AccBanner tone="success">Ton compte et tes données ont été supprimés. Merci d'avoir joué sur PLAFEE !</AccBanner>}

          {!accountsEnabled && (
            <AccBanner tone="info">
              Les comptes ne sont pas configurés sur cette instance. Les jeux restent
              accessibles sans connexion.
            </AccBanner>
          )}

          <div className="acc-form">
            {error && <AccBanner tone="error">{error}</AccBanner>}

            <NeonInput
              label="E-mail"
              type="email"
              autoComplete="email"
              required
              disabled={!accountsEnabled}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.fr"
            />

            <NeonInput
              label="Mot de passe"
              type="password"
              autoComplete="current-password"
              required
              disabled={!accountsEnabled}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            <NeonButton
              type="submit"
              variant="solid"
              block
              loading={busy}
              disabled={!accountsEnabled}
              icon={<LogIn size={17} aria-hidden />}
            >
              Se connecter
            </NeonButton>
          </div>

          <p className="acc-switch">
            Pas encore de compte ? <Link to="/inscription">Crée-le ici</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
