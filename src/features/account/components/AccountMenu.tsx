import { lazy, Suspense, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Award, Camera, CircleUserRound, LogIn, LogOut, User, Users } from 'lucide-react';
import { accountsEnabled } from '../../../lib/supabase';
import { useAuth } from '../useAuth';
import { useSocial } from '../../social/useSocial';
import { UserAvatar } from '../../social/components/UserAvatar';
import { usePlafee } from '../../plafee/usePlafee';
import { FeesAmount } from '../../plafee/components/bits';
// Le recadrage d'image ne sert qu'au moment de changer de photo.
const AvatarUpload = lazy(() => import('./AvatarUpload').then((m) => ({ default: m.AvatarUpload })));

/**
 * Le contrôle de compte de l'en-tête : le bouton du panneau d'amis, puis
 * l'avatar et son menu (profil, compte, trophées, photo, déconnexion). La
 * navigation du site est dans le menu principal (MainMenu).
 *
 * Le menu est un `popover` natif : couche supérieure au-dessus de la scène 3D
 * et des plateaux, Échap et clic extérieur gérés par le navigateur, focus
 * rendu à l'avatar à la fermeture — sans piège au clavier.
 */
export function AccountMenu() {
  const { status, profile, signOut } = useAuth();
  const { panelOpen, setPanelOpen, online, friends } = useSocial();
  const { wallet } = usePlafee();
  const navigate = useNavigate();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);

  // Sans configuration, aucun compte n'est possible : mieux vaut ne rien
  // afficher qu'un bouton qui mène à un formulaire inerte.
  if (!accountsEnabled) return null;

  if (status === 'loading') {
    // Une empreinte de la bonne taille, pour que l'en-tête ne sursaute pas
    // quand la session finit d'être relue.
    return <span className="account-chip" data-placeholder="true" aria-hidden />;
  }

  if (status === 'signed-out') {
    return (
      <Link to="/connexion" className="account-chip account-chip-signin">
        <LogIn size={16} aria-hidden />
        <span className="account-chip-label">Se connecter</span>
      </Link>
    );
  }

  const friendsOnline = friends.filter((f) => online.has(f.user_id)).length;
  const close = () => menuRef.current?.hidePopover();

  return (
    <>
      <button
        type="button"
        className="account-chip account-chip-icon dock-toggle"
        aria-pressed={panelOpen}
        aria-label={friendsOnline > 0 ? `Amis, ${friendsOnline} en ligne` : 'Amis'}
        title="Amis"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <Users size={17} aria-hidden />
        {friendsOnline > 0 && (
          <span className="dock-toggle-count" aria-hidden>
            {friendsOnline}
          </span>
        )}
      </button>

      <button
        type="button"
        className="account-chip account-chip-avatar"
        popoverTarget={menuId}
        title={profile?.username ?? 'Mon compte'}
        aria-label={profile ? `Menu du compte de ${profile.username}` : 'Menu du compte'}
      >
        {profile ? <UserAvatar username={profile.username} src={profile.avatar} size={36} userId={profile.id} /> : <User size={17} aria-hidden />}
      </button>

      <div id={menuId} ref={menuRef} popover="auto" className="acc-menu acc-scope" role="menu">
        {profile && (
          <div className="acc-menu-head">
            <UserAvatar username={profile.username} src={profile.avatar} size={40} userId={profile.id} />
            <strong>{profile.username}</strong>
            <FeesAmount value={wallet?.balance ?? 0} size="sm" />
          </div>
        )}
        {profile && (
          <Link role="menuitem" to={`/joueur/${profile.username}`} onClick={close}>
            <User size={16} aria-hidden /> Voir mon profil
          </Link>
        )}
        <Link role="menuitem" to="/compte" onClick={close}>
          <CircleUserRound size={16} aria-hidden /> Mon compte
        </Link>
        <Link role="menuitem" to="/compte#trophees" onClick={close}>
          <Award size={16} aria-hidden /> Mes trophées
        </Link>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            setUploading(true);
          }}
        >
          <Camera size={16} aria-hidden /> Changer ma photo
        </button>
        <button
          type="button"
          role="menuitem"
          className="acc-menu-danger"
          onClick={() => {
            close();
            void signOut().then(() => navigate('/'));
          }}
        >
          <LogOut size={16} aria-hidden /> Se déconnecter
        </button>
      </div>

      {uploading && (
        <Suspense fallback={null}>
          <AvatarUpload open onClose={() => setUploading(false)} />
        </Suspense>
      )}
    </>
  );
}
