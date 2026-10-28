import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Camera, Check, Flame, LogOut, Pencil, Trophy, X } from 'lucide-react';
import { useAuth } from './useAuth';
import { useProfileStats } from './useProfileStats';
import { NeonButton } from './components/NeonButton';
import { NeonInput } from './components/NeonInput';
import { AccBanner } from './components/AccBanner';
import { GAME_LABELS } from './types';
import { validateBio, validateUsername } from './validation';
import { SocialNav } from '../social/components/SocialNav';
import { AchievementPanel } from '../achievements/AchievementPanel';
import { refreshMyAchievements } from '../achievements/api';
import { UserAvatar } from '../social/components/UserAvatar';
const AvatarUpload = lazy(() => import('./components/AvatarUpload').then((m) => ({ default: m.AvatarUpload })));
import { GameStats } from '../social/components/GameStats';
import { RankStrip } from '../social/components/RankStrip';
import { PlayerFlair } from '../plafee/components/bits';
import { BadgesPanel, WalletPanel } from '../plafee/components/panels';
import { DeleteAccountSection } from './components/DeleteAccountSection';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const SHORT_FMT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** « /compte#trophees » : descendre jusqu'aux trophées une fois la page posée. */
function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const timer = window.setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => window.clearTimeout(timer);
  }, [ready, hash]);
}

export function ProfilePage() {
  const { status, profile, user, signOut, updateProfile } = useAuth();
  useScrollToHash(Boolean(user));
  // Les trophées hors partie (groupes, podium passé) se recalculent ici aussi :
  // la vitrine doit être à jour quand on vient la regarder.
  const uid = user?.id;
  useEffect(() => {
    if (uid) refreshMyAchievements().catch(() => {});
  }, [uid]);
  const location = useLocation();
  const { loading, stats, recent, error } = useProfileStats(user?.id ?? null);

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ username?: string | null; bio?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);

  if (status === 'loading') {
    return (
      <div className="container acc-scope">
        <div className="acc-page">
          <p role="status">Chargement de ton profil…</p>
        </div>
      </div>
    );
  }

  if (status === 'signed-out') {
    // On garde d'où venait le joueur pour l'y ramener après connexion.
    return <Navigate to="/connexion" state={{ from: location.pathname }} replace />;
  }

  function startEditing() {
    setUsername(profile?.username ?? '');
    setBio(profile?.bio ?? '');
    setFieldError({});
    setFormError(null);
    setEditing(true);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const found = { username: validateUsername(username), bio: validateBio(bio) };
    setFieldError(found);
    if (found.username || found.bio) return;

    setBusy(true);
    setFormError(null);
    try {
      await updateProfile({ username: username.trim(), bio: bio.trim() || null });
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  const ratio =
    stats && stats.games_played > 0 ? Math.round((stats.wins / stats.games_played) * 100) : null;

  return (
    <div className="container acc-scope">
      <div className="acc-page acc-page-wide">
        <SocialNav />
        <section className="acc-card acc-card-wide">
          <header className="acc-profile-head">
            <div className="acc-avatar-col">
              <button
                type="button"
                className="acc-avatar acc-avatar-btn"
                onClick={() => setUploading(true)}
                aria-label="Changer ma photo de profil"
              >
                <UserAvatar username={profile?.username ?? '?'} src={profile?.avatar} size={68} userId={profile?.id} />
                <Camera size={16} aria-hidden className="acc-avatar-cam" />
              </button>
              <button type="button" className="acc-avatar-change" onClick={() => setUploading(true)}>
                Changer photo
              </button>
            </div>
            <div className="acc-profile-id">
              <h1 className="acc-title">{profile?.username ?? 'Profil'}</h1>
              {profile && <PlayerFlair userId={profile.id} />}
              <p className="acc-subtitle">
                {profile?.bio || <em>Aucune description pour l'instant.</em>}
              </p>
              {profile && (
                <p className="neon-hint">Inscrit le {DATE_FMT.format(new Date(profile.created_at))}</p>
              )}
            </div>
            <div className="acc-profile-actions">
              {!editing && (
                <NeonButton onClick={startEditing} icon={<Pencil size={16} aria-hidden />}>
                  Modifier
                </NeonButton>
              )}
              <NeonButton
                variant="ghost"
                onClick={() => void signOut()}
                icon={<LogOut size={16} aria-hidden />}
              >
                Se déconnecter
              </NeonButton>
            </div>
          </header>

          {photoSaved && <AccBanner tone="success">Photo mise à jour.</AccBanner>}

          {uploading && (
            <Suspense fallback={null}>
              <AvatarUpload
                open
                onClose={() => setUploading(false)}
                onDone={() => {
                  setPhotoSaved(true);
                  window.setTimeout(() => setPhotoSaved(false), 3500);
                }}
              />
            </Suspense>
          )}

          {!profile && (
            <AccBanner tone="error">
              Ton profil est introuvable. Déconnecte-toi puis reconnecte-toi ; si le problème
              persiste, le compte a besoin d'être recréé.
            </AccBanner>
          )}

          {editing && (
            <form className="acc-form acc-edit" onSubmit={onSave} noValidate>
              {formError && <AccBanner tone="error">{formError}</AccBanner>}
              <NeonInput
                label="Pseudo"
                value={username}
                error={fieldError.username}
                hint="3 à 20 caractères : lettres, chiffres et tirets bas."
                onChange={(e) => setUsername(e.target.value)}
              />
              <NeonInput
                label="Description"
                value={bio}
                error={fieldError.bio}
                hint={`${bio.length} / 200 caractères.`}
                maxLength={200}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Deux mots sur toi"
              />
              <div className="acc-edit-actions">
                <NeonButton type="submit" variant="solid" loading={busy} icon={<Check size={16} aria-hidden />}>
                  Enregistrer
                </NeonButton>
                <NeonButton
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                  icon={<X size={16} aria-hidden />}
                >
                  Annuler
                </NeonButton>
              </div>
            </form>
          )}
        </section>

        <section className="acc-card acc-card-wide">
          <h2 className="acc-section-title">
            <Trophy size={18} aria-hidden /> Statistiques
          </h2>

          {error && <AccBanner tone="error">{error}</AccBanner>}

          <dl className="acc-stats">
            <div className="acc-stat">
              <dt>Points</dt>
              <dd className="acc-stat-hero">{stats?.points ?? 0}</dd>
            </div>
            <div className="acc-stat">
              <dt>Parties</dt>
              <dd>{stats?.games_played ?? 0}</dd>
            </div>
            <div className="acc-stat">
              <dt>Victoires</dt>
              <dd>{stats?.wins ?? 0}</dd>
            </div>
            <div className="acc-stat">
              <dt>Défaites</dt>
              <dd>{stats?.losses ?? 0}</dd>
            </div>
            <div className="acc-stat">
              <dt>Ratio</dt>
              <dd>{ratio === null ? '—' : `${ratio} %`}</dd>
            </div>
            <div className="acc-stat">
              <dt>Jeu favori</dt>
              <dd>{stats?.favorite_game ? GAME_LABELS[stats.favorite_game] : '—'}</dd>
            </div>
          </dl>

          {user && (
            <>
              <h3 className="acc-section-title soc-subsection">Au classement</h3>
              <RankStrip userId={user.id} />
            </>
          )}
        </section>

        <WalletPanel />
        {user && <BadgesPanel userId={user.id} self />}
        {user && <GameStats userId={user.id} />}
        {user && <AchievementPanel userId={user.id} self />}

        <section className="acc-card acc-card-wide">
          <h2 className="acc-section-title">Dernières parties</h2>

          {loading && <p className="neon-hint" role="status">Chargement…</p>}

          {!loading && recent.length === 0 && (
            <AccBanner tone="info">
              Aucune partie enregistrée pour l'instant. Joue une partie en étant connecté et elle
              apparaîtra ici.
            </AccBanner>
          )}

          {recent.length > 0 && (
            <div className="acc-table-scroll">
              <table className="acc-table">
                <thead>
                  <tr>
                    <th scope="col">Jeu</th>
                    <th scope="col">Résultat</th>
                    <th scope="col" className="acc-col-opt">Score</th>
                    <th scope="col">Points</th>
                    <th scope="col">Quand</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((game) => (
                    <tr key={game.id}>
                      <td>{GAME_LABELS[game.game_type] ?? game.game_type}</td>
                      <td>
                        <span className="acc-outcome" data-won={game.won}>
                          {game.won ? 'Victoire' : 'Défaite'}
                        </span>
                      </td>
                      <td className="acc-col-opt">{game.score || '—'}</td>
                      <td>
                        {game.points > 0 ? `+${game.points}` : '—'}
                        {game.streak_bonus && (
                          <span className="acc-streak" title="Prime de série">
                            <Flame size={13} aria-hidden /> série
                          </span>
                        )}
                      </td>
                      <td>{SHORT_FMT.format(new Date(game.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <DeleteAccountSection />
      </div>
    </div>
  );
}
