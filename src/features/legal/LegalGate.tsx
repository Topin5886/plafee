import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { useAuth } from '../account/useAuth';
import { NeonButton } from '../account/components/NeonButton';
import { AccBanner } from '../account/components/AccBanner';
import { usePlafee } from '../plafee/usePlafee';
import { acceptTerms } from '../plafee/api';
import { TermsCheckbox } from './TermsCheckbox';
import { TERMS_VERSION } from './legal';

const READABLE = new Set(['/cgu', '/confidentialite', '/mentions-legales', '/compte']);

/**
 * Un compte créé avant les CGU, ou après qu'elles ont changé, doit les
 * accepter avant de continuer. Les pages légales et le profil restent
 * ouverts : on doit pouvoir lire avant de signer, ou partir.
 */
export function LegalGate() {
  const { status, signOut } = useAuth();
  const { standing, refreshStanding } = usePlafee();
  const { pathname } = useLocation();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `terms_version` absent : base d'avant la migration 0013, on ne bloque pas.
  if (status !== 'signed-in' || !standing || !('terms_version' in standing)) return null;
  if (standing.terms_version === TERMS_VERSION || READABLE.has(pathname)) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptTerms(TERMS_VERSION);
      refreshStanding();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer ton accord.');
      setBusy(false);
    }
  }

  return (
    <div className="legal-gate acc-scope" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <div className="acc-card legal-gate-card">
        <h2 id="legal-gate-title" className="acc-section-title">
          <ScrollText size={18} aria-hidden /> Nouvelles règles du jeu
        </h2>
        <p>
          {standing.terms_version
            ? 'Les CGU ou la politique de confidentialité ont changé.'
            : 'PLAFEE a maintenant des CGU et une politique de confidentialité.'}{' '}
          Prends deux minutes pour les lire : elles expliquent les règles, les FEES, les sanctions et ce qu’on fait de tes données.
        </p>
        {error && <AccBanner tone="error">{error}</AccBanner>}
        <TermsCheckbox checked={checked} onChange={setChecked} />
        <div className="legal-gate-actions">
          <NeonButton variant="solid" disabled={!checked} loading={busy} onClick={() => void accept()}>
            Continuer
          </NeonButton>
          <NeonButton variant="ghost" onClick={() => void signOut()}>
            Se déconnecter
          </NeonButton>
        </div>
        <p className="neon-hint">
          Pas d’accord ? Tu peux <Link to="/compte#supprimer">supprimer ton compte</Link>.
        </p>
      </div>
    </div>
  );
}
