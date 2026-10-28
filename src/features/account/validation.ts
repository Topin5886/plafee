/*
 * Règles de saisie du formulaire d'inscription.
 *
 * Elles doublent des contraintes qui existent déjà en base (format du pseudo,
 * longueur de la bio) : la base reste l'autorité, le client n'est là que pour
 * dire au joueur ce qui ne va pas avant l'aller-retour réseau.
 */

/** Doit rester identique à la contrainte `profiles_username_format`. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Choisis un pseudo.';
  if (v.length < 3) return 'Trois caractères au minimum.';
  if (v.length > 20) return 'Vingt caractères au maximum.';
  if (!USERNAME_RE.test(v)) return 'Lettres, chiffres et tirets bas uniquement.';
  return null;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Indique ton adresse e-mail.';
  // Volontairement permissif : la seule validation qui fasse autorité est
  // l'e-mail de confirmation qui arrive, ou non, dans la boîte de réception.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Cette adresse ne ressemble pas à un e-mail.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Choisis un mot de passe.';
  if (value.length < 8) return 'Huit caractères au minimum.';
  if (!/[A-Z]/.test(value)) return 'Il faut au moins une majuscule.';
  if (!/[0-9]/.test(value)) return 'Il faut au moins un chiffre.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Il faut au moins un caractère spécial.';
  return null;
}

export function validateBio(value: string): string | null {
  if (value.length > 200) return 'Deux cents caractères au maximum.';
  return null;
}

/**
 * Traduit les erreurs de Supabase Auth, qui arrivent en anglais.
 *
 * La liste ne couvre que ce qu'un joueur peut réellement déclencher depuis les
 * formulaires ; tout le reste retombe sur le message d'origine, plus utile
 * qu'un « une erreur est survenue » qui masquerait la cause.
 */
export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return "Ton adresse n'est pas encore confirmée — regarde tes e-mails.";
  if (m.includes('already confirmed')) return 'Ton adresse est déjà confirmée : tu peux te connecter.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Un compte existe déjà avec cette adresse.';
  if (m.includes('password should be at least')) return 'Mot de passe trop court.';
  if (m.includes('unable to validate email')) return 'Cette adresse ne ressemble pas à un e-mail.';
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many'))
    return 'Trop de tentatives. Attends un instant avant de réessayer.';
  if (m.includes('failed to fetch') || m.includes('networkerror'))
    return 'Impossible de joindre le serveur. Vérifie ta connexion.';
  return message;
}
