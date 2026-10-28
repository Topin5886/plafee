import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile } from './types';

export interface SignUpResult {
  /**
   * Vrai quand le projet Supabase exige une confirmation par e-mail : le
   * compte existe mais aucune session n'est ouverte tant que le lien n'est pas
   * cliqué. L'UI doit alors afficher une consigne plutôt que de rediriger.
   */
  needsEmailConfirmation: boolean;
}

export interface AuthValue {
  /**
   * `loading` couvre la reprise de session au démarrage. Sans cet état
   * intermédiaire, un rechargement sur /compte ferait clignoter l'écran de
   * connexion avant que la session stockée ne soit relue.
   */
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  user: User | null;
  /** Null tant que le profil n'est pas chargé, même session ouverte. */
  profile: Profile | null;
  /**
   * Erreur renvoyée par Supabase quand le lien de confirmation revient sur le
   * site (lien expiré, déjà utilisé, etc.), sinon null.
   */
  authLinkError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, username: string, password: string) => Promise<SignUpResult>;
  /** Renvoie l'e-mail de confirmation d'un compte pas encore activé. */
  resendConfirmation: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'username' | 'bio' | 'avatar' | 'preferences'>>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);
