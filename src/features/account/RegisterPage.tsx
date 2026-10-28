import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MailCheck, UserPlus } from 'lucide-react';
import { accountsEnabled } from '../../lib/supabase';
import { useAuth } from './useAuth';
import { NeonButton } from './components/NeonButton';
import { NeonInput } from './components/NeonInput';
import { AccBanner } from './components/AccBanner';
import { validateEmail, validatePassword, validateUsername } from './validation';
import { TermsCheckbox } from '../legal/TermsCheckbox';

interface FieldErrors {
  email?: string | null;
  username?: string | null;
  password?: string | null;
  confirm?: string | null;
  terms?: string | null;
}

export function RegisterPage() {
  const { signUp, status } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  if (status === 'signed-in') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    // Tout valider d'un coup : ne signaler que la première erreur obligerait
    // le joueur à corriger son formulaire champ par champ, un envoi à la fois.
    const found: FieldErrors = {
      email: validateEmail(email),
      username: validateUsername(username),
      password: validatePassword(password),
      confirm: password !== confirm ? 'Les deux mots de passe diffèrent.' : null,
      terms: terms ? null : 'Coche la case pour créer ton compte.',
    };
    setFields(found);
    if (Object.values(found).some(Boolean)) return;

    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUp(email, username, password);
      if (needsEmailConfirmation) {
        setConfirmationSent(true);
        setBusy(false);
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
      setBusy(false);
    }
  }

  /*
   * Le projet Supabase peut exiger une confirmation par e-mail. Dans ce cas le
   * compte existe mais aucune session n'est ouverte : rediriger vers le profil
   * afficherait une page vide et laisserait croire à un échec.
   */
  if (confirmationSent) {
    return (
      <div className="container acc-scope">
        <div className="acc-page">
          <div className="acc-card">
            <h1 className="acc-title">Presque fini</h1>
            <p className="acc-subtitle">Ton compte est créé.</p>
            <AccBanner tone="success">
              <MailCheck size={16} aria-hidden /> Un e-mail de confirmation vient de partir vers{' '}
              <strong>{email}</strong>. Clique le lien qu'il contient pour activer ton compte, puis
              reviens te connecter.
            </AccBanner>
            <p className="acc-switch">
              <Link to="/connexion">Retour à la connexion</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container acc-scope">
      <div className="acc-page">
        <form className="acc-card" onSubmit={onSubmit} noValidate>
          <h1 className="acc-title">Rejoins la table</h1>
          <p className="acc-subtitle">Un compte pour suivre tes parties et tes points.</p>

          {!accountsEnabled && (
            <AccBanner tone="info">
              Les comptes ne sont pas configurés sur cette instance. Les jeux restent
              accessibles sans connexion.
            </AccBanner>
          )}

          <div className="acc-form">
            {error && <AccBanner tone="error">{error}</AccBanner>}

            <NeonInput
              label="Pseudo"
              autoComplete="nickname"
              required
              disabled={!accountsEnabled}
              value={username}
              error={fields.username}
              hint="3 à 20 caractères : lettres, chiffres et tirets bas."
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jules"
            />

            <NeonInput
              label="E-mail"
              type="email"
              autoComplete="email"
              required
              disabled={!accountsEnabled}
              value={email}
              error={fields.email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.fr"
            />

            <NeonInput
              label="Mot de passe"
              type="password"
              autoComplete="new-password"
              required
              disabled={!accountsEnabled}
              value={password}
              error={fields.password}
              hint="8 caractères minimum, dont une majuscule, un chiffre et un caractère spécial."
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            <NeonInput
              label="Confirme le mot de passe"
              type="password"
              autoComplete="new-password"
              required
              disabled={!accountsEnabled}
              value={confirm}
              error={fields.confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />

            <TermsCheckbox
              checked={terms}
              disabled={!accountsEnabled}
              error={fields.terms}
              onChange={(v) => {
                setTerms(v);
                if (v) setFields((f) => ({ ...f, terms: null }));
              }}
            />

            <NeonButton
              type="submit"
              variant="solid"
              block
              loading={busy}
              disabled={!accountsEnabled}
              icon={<UserPlus size={17} aria-hidden />}
            >
              Créer mon compte
            </NeonButton>
          </div>

          <p className="acc-switch">
            Tu as déjà un compte ? <Link to="/connexion">Connecte-toi</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
