/**
 * Les notes de mise à jour, de la plus récente à la plus ancienne.
 *
 * La première s'affiche une fois à l'ouverture du site (voir LaunchPopups) ;
 * toutes sont sur la page /nouveautes. Pour annoncer une mise à jour, on
 * ajoute une entrée en tête avec une nouvelle `version` : chaque joueur la
 * verra une fois.
 */
export interface PatchNote {
  /** Identifiant unique, la date de mise en ligne suffit. */
  version: string;
  date: string;
  title: string;
  sections: { title: string; items: string[] }[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: '2026-10-28',
    date: '28 octobre 2026',
    title: 'La salle s’agrandit',
    sections: [
      {
        title: 'Une interface faite pour l’ordinateur',
        items: [
          'L’accueil prend toute la largeur de l’écran : l’événement en cours à côté de la bannière, les jeux en grand, ta fiche de joueur à droite.',
          'Nouveau menu ☰ en haut à droite : toutes les pages du site au même endroit (Sessions, Amis, Groupes, Hall des trophées…).',
          'En-tête revu : Accueil, Classements, Événements et Boutique au centre, accessibles même sans compte.',
          'Le menu de ton avatar se concentre sur ton compte : profil, trophées, photo, déconnexion.',
        ],
      },
      {
        title: 'Boutique',
        items: [
          '10 cadres et 9 effets pour ta photo de profil, classés par rareté.',
          'Offres du jour : 3 objets à -15 %, renouvelés chaque nuit à minuit.',
          'Les prix de la boutique ont été réajustés.',
        ],
      },
      {
        title: 'Événement',
        items: [
          'La Nuit des Revenants, l’événement d’Halloween : toute la commu joue 30 parties ensemble pour débloquer un trophée en édition limitée, des FEES et des objets exclusifs.',
        ],
      },
      {
        title: 'Compte et vie privée',
        items: [
          'Mentions légales, politique de confidentialité et conditions d’utilisation (CGU), en bas de chaque page.',
          'À l’inscription, tu acceptes les CGU ; si elles changent, on te redemande ton accord.',
          '« Supprimer mon compte » dans ton profil : tes données sont effacées, tes groupes passent à un autre membre.',
          'En cas de sanction (ban, remise à zéro, retrait de badge), tu es prévenu du motif et tu peux la contester.',
          'La mesure d’audience du site est anonyme, et les vieilles données sont supprimées automatiquement.',
        ],
      },
    ],
  },
];

export const LATEST_PATCH = PATCH_NOTES[0];
