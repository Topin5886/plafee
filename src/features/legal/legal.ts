/*
 * Constantes partagées par les pages légales, l'inscription et la modération.
 *
 * TERMS_VERSION doit rester égale à public._terms_version() (migration 0013) :
 * la base refuse une acceptation d'une autre version. La changer redemande
 * l'accord de tous les joueurs à leur prochaine visite.
 */
export const TERMS_VERSION = '2026-10-28';

export const CONTACT_EMAIL = 'julesvalet71250@gmail.com';

/** Lien « Contester » : un e-mail prérempli, l'objet dit de quelle sanction il s'agit. */
export function contestHref(what: string): string {
  const subject = `Contestation : ${what}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export const LEGAL_LINKS = [
  { to: '/mentions-legales', label: 'Mentions légales' },
  { to: '/confidentialite', label: 'Confidentialité' },
  { to: '/cgu', label: 'CGU' },
] as const;
