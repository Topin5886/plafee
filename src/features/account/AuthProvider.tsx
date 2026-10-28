import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { accountsEnabled, getSupabase, authRedirectUrl } from '../../lib/supabase';
import { AuthContext, type AuthValue, type SignUpResult } from './authContext';
import { DEFAULT_PREFERENCES, type Profile } from './types';
import { translateAuthError } from './validation';
import { clearSavedPseudo, savePseudo } from '../rooms/playerName';
import { clearReferral, pendingReferral } from '../plafee/api';
import { setCurrentUserId } from './currentUser';
import { TERMS_VERSION } from '../legal/legal';

/** Remonte l'erreur Supabase en français, sans perdre la cause d'origine. */
function fail(message: string): never {
  throw new Error(translateAuthError(message));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>(
    // Sans configuration, il n'y a pas de session à attendre : on part
    // directement déconnecté plutôt que de laisser l'UI en chargement.
    accountsEnabled ? 'loading' : 'signed-out',
  );
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const userId = session?.user.id ?? null;

  /*
   * Reprise de session, puis abonnement aux changements.
   *
   * Le callback de `onAuthStateChange` s'exécute dans le verrou interne du
   * client Supabase : y attendre une autre requête (le profil, typiquement)
   * peut bloquer. On n'y fait donc que poser l'état, et le chargement du
   * profil vit dans son propre effet, déclenché par l'identifiant.
   */
  useEffect(() => {
    if (!accountsEnabled) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    getSupabase()
      .then(async (client) => {
        if (cancelled) return;

        const { data } = await client.auth.getSession();
        if (cancelled) return;
        setSession(data.session);
        setStatus(data.session ? 'signed-in' : 'signed-out');

        const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
          if (cancelled) return;
          setSession(next);
          setStatus(next ? 'signed-in' : 'signed-out');
          if (!next) setProfile(null);
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      })
      .catch(() => {
        // Le chargement du client a échoué (réseau coupé, ressource bloquée) :
        // le site doit rester jouable, simplement sans compte.
        if (!cancelled) setStatus('signed-out');
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /*
   * Le profil suit l'identifiant du compte, pas l'objet session : ce dernier
   * est remplacé à chaque rafraîchissement de jeton (toutes les heures), ce
   * qui relancerait la requête pour rien.
   */
  const loadedFor = useRef<string | null>(null);

  const fetchProfile = useCallback(async (id: string) => {
    const { data, error } = await (await getSupabase())
      .from('profiles')
      .select('id, username, avatar, bio, preferences, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(translateAuthError(error.message));
    if (!data) return null;

    return {
      ...data,
      // Un profil créé avant l'ajout d'une préférence n'a pas la clé : on
      // complète plutôt que de laisser l'UI lire `undefined`.
      preferences: { ...DEFAULT_PREFERENCES, ...(data.preferences ?? {}) },
    } as Profile;
  }, []);

  useEffect(() => {
    if (!userId) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;

    let cancelled = false;
    fetchProfile(userId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // Le profil manquant ne doit pas empêcher de jouer : le site reste
        // utilisable, seule la page Compte signalera le problème.
        if (!cancelled) setProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await (await getSupabase()).auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) fail(error.message);
  }, []);

  const signUp = useCallback(
    async (email: string, username: string, password: string): Promise<SignUpResult> => {
      const client = await getSupabase();
      const wanted = username.trim();

      // Vérification de courtoisie : elle évite d'annoncer « compte créé » à
      // quelqu'un qui récupérerait en fait un pseudo de repli. La garantie
      // d'unicité, elle, reste l'index en base.
      const { data: taken, error: lookupError } = await client
        .from('profiles')
        .select('username')
        .ilike('username', wanted)
        .maybeSingle();
      if (lookupError) fail(lookupError.message);
      if (taken) throw new Error('Ce pseudo est déjà pris.');

      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Lu par le trigger `handle_new_user` pour créer le profil dans la
          // même transaction que le compte — le parrain d'un lien ?ref=, et la
          // version des CGU que le formulaire a fait accepter.
          data: { username: wanted, terms_version: TERMS_VERSION, ...(pendingReferral() ? { ref: pendingReferral() } : {}) },
          emailRedirectTo: authRedirectUrl('compte'),
        },
      });
      if (error) fail(error.message);
      clearReferral();

      return { needsEmailConfirmation: data.session === null };
    },
    [],
  );

  const signOut = useCallback(async () => {
    const { error } = await (await getSupabase()).auth.signOut();
    if (error) fail(error.message);
    setProfile(null);
    // Un navigateur partagé ne doit pas proposer le pseudo du compte qui vient
    // de partir au prochain qui s'assoit.
    clearSavedPseudo();
  }, []);

  // Le pseudo du compte devient celui des salons de jeu, y compris hors
  // connexion plus tard sur ce navigateur (jusqu'à la déconnexion).
  useEffect(() => {
    if (profile?.username) savePseudo(profile.username);
  }, [profile?.username]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfile(await fetchProfile(userId));
  }, [userId, fetchProfile]);

  const updateProfile = useCallback<AuthValue['updateProfile']>(
    async (patch) => {
      if (!userId) throw new Error('Il faut être connecté.');

      const { data, error } = await (await getSupabase())
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select('id, username, avatar, bio, preferences, created_at, updated_at')
        .single();

      if (error) {
        // 23505 : l'index unique sur lower(username). Le message brut de
        // Postgres ne dirait rien au joueur.
        if (error.code === '23505') throw new Error('Ce pseudo est déjà pris.');
        if (error.code === '23514') throw new Error('Pseudo ou bio au mauvais format.');
        throw new Error(translateAuthError(error.message));
      }

      setProfile({
        ...data,
        preferences: { ...DEFAULT_PREFERENCES, ...(data.preferences ?? {}) },
      } as Profile);
    },
    [userId],
  );

  // Les rooms annoncent le compte en rejoignant une table (cosmétiques en jeu).
  useEffect(() => setCurrentUserId(session?.user?.id ?? null), [session]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      signIn,
      signUp,
      signOut,
      updateProfile,
      refreshProfile,
    }),
    [status, session, profile, signIn, signUp, signOut, updateProfile, refreshProfile],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
