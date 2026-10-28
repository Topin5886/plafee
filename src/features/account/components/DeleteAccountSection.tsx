import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../useAuth';
import { NeonButton } from './NeonButton';
import { NeonInput } from './NeonInput';
import { AccBanner } from './AccBanner';
import { removeAvatarFiles } from '../avatarUpload';
import { deleteMyAccount } from '../../plafee/api';
import { usePlafee } from '../../plafee/usePlafee';
import '../../legal/legal.css';

/**
 * « Supprimer mon compte », confirmé dans la page : il faut retaper son
 * pseudo. Un double clic ou un enfant curieux ne doivent pas suffire à
 * effacer des mois de parties.
 */
export function DeleteAccountSection() {
  const { user, profile, signOut } = useAuth();
  const { isAdmin, banned } = usePlafee();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const username = profile?.username ?? '';
  const matches = typed.trim().toLowerCase() === username.toLowerCase() && username !== '';

  async function onDelete() {
    if (!user || !matches) return;
    setBusy(true);
    setError(null);
    try {
      // Les fichiers d'abord : une fois le compte parti, plus personne n'a le
      // droit de les effacer depuis le navigateur.
      await removeAvatarFiles(user.id);
      await deleteMyAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
      setBusy(false);
      return;
    }
    // Le compte n'existe plus : la déconnexion peut échouer côté serveur, la
    // session locale part quand même.
    await signOut().catch(() => {});
    navigate('/connexion', { replace: true, state: { deleted: true } });
  }

  return (
    <section className="acc-card acc-card-wide acc-danger-zone" id="supprimer">
      <h2 className="acc-section-title">
        <Trash2 size={18} aria-hidden /> Supprimer mon compte
      </h2>

      {isAdmin ? (
        <p>Un compte admin ne se supprime pas depuis le site.</p>
      ) : !open ? (
        <>
          <p>
            Tu peux partir quand tu veux. C'est <strong>définitif</strong> : ton profil, tes stats, tes FEES, tes cosmétiques, tes amis et tes
            questions sont effacés. Le texte de tes messages de groupe aussi.
          </p>
          <div className="acc-danger-actions">
            <NeonButton variant="danger" onClick={() => setOpen(true)} icon={<Trash2 size={16} aria-hidden />}>
              Supprimer mon compte
            </NeonButton>
          </div>
        </>
      ) : (
        <>
          <p>Avant de confirmer :</p>
          <ul>
            <li>tes FEES et tes cosmétiques disparaissent, sans remboursement ;</li>
            <li>un groupe que tu as créé passe à un autre membre ;</li>
            {banned && (
              <li>
                ton compte est banni : on garde une empreinte de ton e-mail, le motif et la date pendant 3 ans, pour éviter un retour avec la même
                adresse ;
              </li>
            )}
            <li>
              tout est expliqué dans la <Link to="/confidentialite#5-quand-tu-supprimes-ton-compte">politique de confidentialité</Link>.
            </li>
          </ul>
          {error && <AccBanner tone="error">{error}</AccBanner>}
          <NeonInput
            label={`Tape ton pseudo (${username}) pour confirmer`}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <div className="acc-danger-actions">
            <NeonButton
              variant="danger"
              disabled={!matches}
              loading={busy}
              onClick={() => void onDelete()}
              icon={<Trash2 size={16} aria-hidden />}
            >
              Supprimer définitivement
            </NeonButton>
            <NeonButton
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTyped('');
                setError(null);
              }}
            >
              Annuler
            </NeonButton>
          </div>
        </>
      )}
    </section>
  );
}
