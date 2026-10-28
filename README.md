# PLAFEE 🟩

La salle d'arcade entre potes : plusieurs jeux, un seul endroit, et une borne
néon pour tout le monde, sur https://topin5886.github.io/plafee/. (Le site
s'appelait « La Cafétéria » jusqu'à la refonte arcade, et vivait sous
`/la-cafeteria/` ; les clés de stockage, elles, n'ont pas changé : les réglages
déjà en place suivent.)

## Features

- **Flip 7** — un plateau casino, de 2 à 5 amis en ligne, 1 à 3 bots (trois difficultés), ou un entraînement solo illimité. Une roulette révèle chaque carte ; arrête pour sécuriser tes points, ou tente les sept numéros différents. Règles officielles (94 cartes, objectif 200 points) et variante PLAFEE (62 cartes et effets personnalisés) disponibles au salon. Chat intégré, sons et musique activables, statistiques locales et mode d’animation léger.

- **Scopa** — le jeu de cartes italien classique, jouable en ligne à 2, 3 ou 4 joueurs. Crée une room, partage le code (ou le lien) à tes potes, et jouez ensemble en temps réel — sans backend, tout passe en pair-à-pair (WebRTC via [PeerJS](https://peerjs.com/)).
- **Puissance 4** — le classique, mais avec des pouvoirs. De 2 à 4 joueurs : duel, chacun pour soi à 3 ou 4, ou 2 v 2 en équipes (l'alignement gagnant peut mélanger les jetons des deux coéquipiers). Personne ne *choisit* ses pouvoirs : chaque joueur reçoit une réserve de jetons pour la partie, dont une minorité tirée au sort est chargée d'un pouvoir — Traversée, Destruction, Inversion de gravité, Double-tour ou Blocage de colonne. Tu joues ta colonne normalement ; si ce jeton-là était chargé, l'effet part à l'impact. Même système de rooms que la Scopa.
- **Puissance 4 Original** — la même chose, sans aucun pouvoir : le Puissance 4 classique sur une grille 7 × 6, dans les quatre mêmes formats.
- **UNO** — le jeu de cartes, de 2 à 4 joueurs, avec deux ajouts : deux **cartes mystère** mélangées à la pioche, qui déclenchent un effet-surprise dès qu'on les tire (aucune en duel — sans public, la surprise ne vaut rien), et une option de **surenchère des +** que l'hôte active avant la partie, où un +2 peut être relancé jusqu'à ce que quelqu'un encaisse la pile. Les boutons **UNO** et **Contre UNO** sont à double tranchant : oublier d'annoncer coûte deux cartes, dénoncer à tort aussi.
- **Roulette de Vérité** — action ou vérité façon arcade, de 2 à 6 joueurs + 1 **chef du jeu** qui ne joue pas. La bouteille tourne et désigne un joueur, une carte se retourne et la question s'écrit lettre par lettre ; il répond, le chef tranche **✓ valide** (+1 point) ou **✗ invalide**. Trois thèmes : CLEAN, NORMAL (du fun et une question qui pique toutes les quatre manches) et HARD (18+, confirmation demandée). Questions perso **privées** (cette partie seulement, jamais écrites en base) ou **publiques** (pool partagé, compte requis, masquées au troisième signalement). 10, 20 manches ou partie libre ; on peut rejoindre en cours de route. Moteur : [src/features/verite/engine/](src/features/verite/engine/), tests : `npm run test:verite`, schéma : [0005_roulette_verite.sql](supabase/migrations/0005_roulette_verite.sql).

## Identité : la charte PLAFEE

Le logo, le lettrage et la bannière viennent du fichier Illustrator de la marque
(`PLAFEE.ai`). Ils n'ont pas été redessinés : un script a lu les tracés du fichier
et les a convertis en SVG — 355 carrés pivotés pour le symbole, 415 pastilles
pour le lettrage. D'où `public/brand/` (symbole, lettrage, logo empilé, bannière,
arcs d'angle, favicon, icônes d'application, image de partage) et
[src/components/brand/plafeeArt.ts](src/components/brand/plafeeArt.ts), qui sert
au symbole et au lettrage animés de l'écran de démarrage.

| Couleur | Valeur | Emploi |
| --- | --- | --- |
| Vert PLAFEE | `#50FF4D` | tout ce qui s'allume : cadres, titres, actions |
| Vert clair | `#A6FFA3` | devises, étiquettes, texte vif secondaire |
| Noir salle / borne | `#0D0D0D` / `#1A1A1A` | fond de page, fond des cartes |
| Cyan | `#00FFFF` | observer, Flip 7, contour de focus |
| Magenta | `#FF00FF` | alertes, badge « hot », UNO |

Le vert est celui de la charte, mesuré sur les fichiers de marque — un vert fluo
légèrement plus tendre que le `#00FF00` pur, pour que l'interface et le logo
soient exactement de la même couleur. Il ne vit qu'à un seul endroit :
`--neon` / `--neon-rgb` dans [src/index.css](src/index.css).

**Typographies** — servies avec le site, aucune requête chez Google :

| Police | Rôle |
| --- | --- |
| Silkscreen 700 | l'interface : titres, boutons, onglets, étiquettes (elle dessine les capitales accentuées en entier, ce que Press Start 2P ne fait pas) |
| Press Start 2P | l'arcade pure, sans accents : titres SCOPA et UNO, PRESS START, devises |
| VT323 | les afficheurs : scores, points, codes de room |
| JetBrains Mono | le texte courant |

## La page d'accueil

Le fronton (la bannière de la charte) en haut, « PRESS START » qui mène au **jeu
tendance** (le plus joué des 7 derniers jours, `trending_game()`), puis les jeux en
bornes néon et la fiche « Joueur 1 » — niveau, amis, ajout d'un ami par pseudo.
Pour un joueur connecté, le tableau de bord (tables des amis, classement de la
semaine, dernières parties, groupes) suit juste en dessous. Code :
[src/pages/Home.tsx](src/pages/Home.tsx) et [src/pages/home/](src/pages/home/).

À la première visite, la borne s'allume : les deux flammes du symbole, puis le
lettrage lettre par lettre, une jauge qui se remplit, et l'interface arrive par un
zoom flouté. Le niveau affiché est tiré des points (`level.ts`), rien n'est stocké.

**Réglages d'affichage** (engrenage de l'en-tête) : le **thème** — Moderne
(l'arcade vert et noir, par défaut), Noir et Blanc (une interface sobre, typo
moderne, sans néon), RGB (le néon fait le tour des couleurs, vitesse réglable :
trois crans, un curseur ou une durée en ms), plus les thèmes achetés à la
boutique —, le décor de l'arcade — grille néon, noir total, phosphore —, l'effet
cathodique et les animations néon. Les thèmes redéfinissent les jetons de
couleur et de police ([src/styles/looks.css](src/styles/looks.css)) ; les tables
de jeu gardent leurs tapis sombres. Les choix sont gardés dans `localStorage`
(`plafee-look`, `plafee-rgb-ms`, `userTheme`, `plafee-crt`, `plafee-fx`) et
appliqués avant le premier rendu par le script d'`index.html`, sous forme
d'attributs `data-look`, `data-backdrop`, `data-crt` et `data-fx` sur `<html>`. Couper les
animations calme aussi les pulsations des bornes ; `prefers-reduced-motion` fait
la même chose sans réglage.

**Noms des jeux** : `<GameTitle game="scopa" />`
([src/components/GameTitle.tsx](src/components/GameTitle.tsx)) affiche le nom d'un
jeu dans sa typographie de borne (`>> SCOPA <<`, `[P4] FORGE`, `[P4] CLASSIC`,
`*** UNO ***` qui cycle vert → cyan → magenta, `[FLIP.7]` en cyan), avec sa
devise en option (CARD BATTLE, POWER MODE, PURE MODE, CHAOS MODE, STOP OR
CONTINUE). On s'en sert sur les bornes de l'accueil, en tête des salons et des
parties, et dans les listes.

**Installable** : `manifest.webmanifest` déclare PLAFEE en plein écran avec ses
icônes ; ajouté à l'écran d'accueil d'un téléphone, le site s'ouvre sans barre de
navigateur, encoche comprise (`viewport-fit=cover` et `env(safe-area-inset-*)`).

## Stack technique

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [React Router](https://reactrouter.com/) pour la navigation
- [Three.js](https://threejs.org/) + [React Three Fiber](https://r3f.docs.pmnd.rs/) pour la roulette de Flip 7
- [PeerJS](https://peerjs.com/) (WebRTC) pour le multijoueur temps réel — aucun serveur de jeu à héberger. Dans chaque jeu, l'hôte fait autorité : il applique toutes les actions via un moteur de règles pur, puis diffuse l'état.
- [Supabase](https://supabase.com/) (Postgres + Auth) pour les comptes, les statistiques et les classements — voir « Comptes et statistiques » plus bas
- Déploiement statique automatique sur GitHub Pages via GitHub Actions

## Développement local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Tests

```bash
npm run test:flip7
```

Le moteur Flip 7 possède des tests déterministes : composition des paquets, doublons, ordre des bonus, cartes spéciales et cascades de Flip Three, distribution initiale, déconnexions, autorisation des actions, fin de manche, égalités et parties complètes simulées avec conservation des cartes. Node 24 est utilisé en CI.

Les détails des règles et de l’implémentation sont dans [src/features/flip7/README.md](src/features/flip7/README.md).

Le moteur de règles du Puissance 4 (gravité, pouvoirs, détection d'alignement) est du code pur, sans React ni réseau — il se teste beaucoup mieux là qu'à la souris :

```bash
npm run test:p4
```

Aucun framework de test : Node exécute le TypeScript directement, [scripts/register-ts.mjs](scripts/register-ts.mjs) se contentant de reproduire la résolution d'imports que Vite applique déjà.

## Comptes et statistiques

Les comptes sont une couche **additive** posée sur un site qui reste statique et
P2P : sans configuration Supabase, tout le site fonctionne exactement comme
avant, simplement sans bouton « Se connecter ».

### Configuration

Deux variables, dans [.env](.env) (versionné) :

| Variable | Rôle |
| --- | --- |
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique du client |

Ces valeurs ne sont pas des secrets : le site étant un build statique, tout ce
que le navigateur doit connaître finit dans le bundle publié, et la clé
*publishable* est faite pour ça. Ce qui protège les données, c'est la Row Level
Security en base — jamais la confidentialité de cette clé. **Ne jamais placer
ici la clé `service_role`**, qui, elle, contourne la RLS.

### Schéma

[supabase/migrations/0001_accounts_and_stats.sql](supabase/migrations/0001_accounts_and_stats.sql)
décrit l'état complet du schéma et peut être rejoué sans risque sur une base
déjà à jour.

- `profiles` — pseudo, bio, préférences. Créé par un trigger sur `auth.users`,
  donc un compte ne peut pas exister sans profil.
- `game_sessions` / `game_results` — une partie, et une ligne par joueur.
- `game_types` — le barème de points, ajustable par un simple `UPDATE`.
- `profile_stats` — vue agrégée (parties, victoires, points, jeu favori).

### Comment une partie est comptée

Il n'y a pas de serveur pour arbitrer : chaque joueur connecté enregistre sa
propre ligne via `record_game_result()`, seule voie d'écriture autorisée. Les
points sont calculés en base, jamais fournis par le client, et ne sont versés
qu'une fois la victoire confirmée par un adversaire (voir plus bas).

Pour que quatre joueurs se retrouvent rattachés à la *même* partie, chaque jeu
produit une **signature** de son état final — faite de champs que tous les pairs
voient à l'identique, et qui change à la revanche. Voir
[src/features/account/gameOutcomes.ts](src/features/account/gameOutcomes.ts).

**Une victoire se confirme par les adversaires** (migration
[0014](supabase/migrations/0014_victoires_confirmees.sql)). Chaque joueur décrit
la partie entière : les comptes gagnants (`p_winners`) et, à la Roulette, le
chef qui l'a menée au bout (`p_chef`). Une victoire reste « en attente »
(`won = false`, 0 point) tant qu'un adversaire — un compte qui n'a pas lui-même
gagné — n'a pas nommé le même gagnant. Les voix du gagnant et de ceux qui le
confirment l'emportent sur celles qui le démentent : à égalité (un contre un),
la victoire est « contestée » et l'admin la tranche dans l'onglet Rapports ;
démentie par la majorité, elle est refusée d'office. Une console ne suffit donc
plus à s'offrir une victoire contre de vrais joueurs. Reste possible : deux
comptes complices qui se confirment l'un l'autre, borné à 5 victoires payées
par jour et par adversaire (`victory_pair_daily_cap`). Une partie ne compte pour
les événements et le parrainage que si deux comptes au moins l'ont décrite.

Limite connue : l'hôte d'une partie tient l'état complet, mains comprises. Un
hôte modifié peut voir les cartes des autres ou fausser la donne ; seul un
arbitre côté serveur l'empêcherait.

Le mode solo et les parties contre des bots de Flip 7 ne sont pas enregistrés :
ils se gagnent à volonté, et les compter mettrait en tête du classement le plus
patient plutôt que le meilleur joueur.

### Classements

`get_leaderboard(période, jeu, limite)` agrège à la lecture, avec remise à zéro
à 00:00 UTC (jour, semaine ISO commençant le lundi, mois). Aucune tâche
planifiée à surveiller : le classement ne peut pas être en retard sur les
parties. `get_leaderboard_rank()` donne la place d'un joueur sur le même
classement, même hors du top 100.

## Amis, groupes et temps réel

Schéma : [supabase/migrations/0002_social.sql](supabase/migrations/0002_social.sql),
à appliquer après 0001 (SQL Editor de Supabase, ou `supabase db push`). Rejouable
sans risque, comme 0001.

Même règle que pour les parties : **lecture par la RLS, écriture uniquement par
des fonctions RPC** (`send_friend_request`, `create_group`, `send_group_message`,
`invite_to_game`…). Aucune table sociale n'a de policy d'écriture : les règles
(seul un admin invite, seul le créateur supprime, on n'écrit pas à quelqu'un
qui nous a bloqué) vivent dans ces fonctions.

| Page | Route |
| --- | --- |
| Tableau de bord | `/tableau-de-bord` |
| Amis (ajout, demandes, défis, blocage) | `/amis` |
| Groupes, et un groupe avec sa discussion | `/groupes`, `/groupes/:id` |
| Classements (publics) | `/classements?periode=weekly&jeu=uno` |
| Fiche publique d'un joueur | `/joueur/:pseudo` |

Le temps réel passe par **Supabase Realtime**, pas par un serveur Socket.io :

- `notifications` (publiée) sert de bus d'événements : demande d'ami, invitation
  de groupe ou de partie, groupe supprimé… Le destinataire la reçoit en direct
  (toast + cloche) ou la retrouve à sa prochaine visite. Les signaux
  `silent` ne font que rafraîchir une liste.
- `group_messages` (publiée) : les messages arrivent en direct, filtrés par la
  RLS — un membre retiré cesse aussitôt de les recevoir.
- Canaux privés `online` (présence) et `group:<id>` (« X écrit… »), autorisés
  par les policies posées sur `realtime.messages`. Si ces canaux échouent, le
  site retombe sur « vu il y a… » et la discussion marche sans indicateur.

Inviter un ami à une partie ne change rien au P2P : l'invitation transporte
seulement le code de room jusqu'à sa cloche.

## Panneau d'amis, sessions, observation, photo de profil

Schéma : [supabase/migrations/0003_sessions_avatars.sql](supabase/migrations/0003_sessions_avatars.sql),
à appliquer après 0002. Rejouable sans risque.

**Pseudo retenu.** La session Supabase persistait déjà ; ce qui redemandait
le pseudo, c'étaient les salons et les liens de room. Connecté, on joue sous le
pseudo du compte et un lien de room s'ouvre sans formulaire. Sans compte, le
dernier pseudo tapé est gardé (`localStorage.userPseudo`), effacé à la
déconnexion. Le jeton, lui, n'est pas recopié : Supabase le gère et le rafraîchit.

**Panneau d'amis** (bouton « Amis » de l'en-tête) : amis triés en ligne /
absent / hors ligne, recherche au-delà de six amis, statut personnel (en
ligne, absent, hors ligne = invisible ; absent automatique après 5 min
d'onglet caché). « Inviter » invite à la table en cours, ou ouvre « Crée ta
session » ; « Rejoindre » s'allume quand l'ami est à une table publique.
Colonne à droite sur ordinateur (la page se décale), tiroir par le bas au
téléphone. Pas de raccourci Tab : il servirait déjà à naviguer au clavier.

**Sessions publiques / privées.** Choisies à la création (salons de chaque jeu,
ou « Crée ta session »). Une table *publique* est annoncée à ses **amis** via
`publish_room()` (battement toutes les 30 s, oubliée après 90 s sans battement) ;
une table *privée* n'est jamais écrite en base. `/sessions` liste les tables
d'amis, et celles où un ami est assis.

**Observation.** Arriver à une table lancée (ou pleine) fait entrer en
observateur : même état masqué qu'un joueur, donc aucune main visible ; aucun
clic ne passe (`inert`, et l'hôte ignore toute action d'un observateur). Les
joueurs voient la liste des observateurs. « Rejoindre la manche suivante »
réserve la prochaine place : quand un joueur est parti, son siège revient au
premier observateur en attente au début de la manche ou de la revanche
suivante. Code commun : [src/features/rooms/spectators.ts](src/features/rooms/spectators.ts).

**Trophées.** Schéma [0004_achievements.sql](supabase/migrations/0004_achievements.sql) :
20 trophées (victoires, par jeu, sociabilité, défis), calculés en base après
chaque partie (`record_game_result`) et à l'ouverture de l'accueil ou du profil
(`refresh_my_achievements`, pour les groupes et le podium de la semaine passée).
Un déblocage émet une notification `achievement` : pop-up doré, petite fanfare.
Les compteurs propres à un jeu (scopas, cartes spéciales UNO, arrêts à la
première carte au Flip 7) viennent du client, bornés : un client modifié peut
les gonfler, comme il peut déjà déclarer une victoire en P2P.

**Photo de profil.** Recadrée en carré (comme les avatars du site) et réencodée en 512 × 512 dans le
navigateur (métadonnées GPS perdues au passage), puis déposée dans le bucket
public `avatars` sous `users/<id>/`. Une contrainte en base interdit à
`profiles.avatar` de pointer ailleurs que dans le dossier du joueur.


## PLAFEE V2 : trophées, FEES, boutique, événements, admin

Schéma : [supabase/migrations/0006_plafee_v2.sql](supabase/migrations/0006_plafee_v2.sql),
à appliquer après 0005. Même règle que tout le reste : lecture par la RLS,
écriture uniquement par des fonctions en base. Code client :
[src/features/plafee/](src/features/plafee/).

**Trophées.** 50 trophées maison (catégories Victoires, Flip 7, Scopa, UNO,
Puissance 4, Roulette de Vérité, Sociabilité, Défis) et six raretés : bronze,
argent, or, platine, divin, OG. Tout se calcule en base après chaque partie
(`_achievement_progress`) ; les compteurs propres à un jeu (arrêts à 0 point,
scopas d'affilée, réponses validées, séries par difficulté…) viennent du
client, bornés, comme avant. L'OG demande 50 trophées : les 49 autres plus au
moins un trophée d'événement ou créé par un admin. Hall des trophées :
`/trophees` (top 10, raretés, déblocages récents, richesse).

**FEES.** La monnaie : gains par victoire (réglables par jeu), chef d'une
Roulette menée au bout, série de 7 jours avec une victoire (+200), événements,
parrainage (lien `/inscription?ref=pseudo` : 50 FEES quand le filleul a joué
7 jours de suite, 5 par mois au plus). Plafond de victoires payées par jour
contre les victoires fabriquées en P2P. Chaque mouvement est tracé
(`fees_transactions`) ; un débit ne descend jamais sous zéro.

**Boutique** (`/boutique`) : thèmes de cartes, thèmes du site (ils
redéfinissent `--neon`, donc tout le site suit), badges, contours d'avatar,
plaques (dont une plaque perso de 5 caractères), animations de victoire.
Un objet par rayon est équipé ; les achats sont définitifs.

**Badges** : cosmétiques décernés par l'admin (titre, icône, contour, plaque,
temporaire), ou gagnés (événement, parrainage, boutique).

**Événements** (`/evenements`) : un objectif (victoires, parties, ou objectif
commun) entre deux dates, un trophée en édition limitée, un badge temporaire
et des FEES en récompense. Bandeau en haut du site, carte sur l'accueil,
fenêtre à la première visite.

**Admin** (`/admin`) : réservé aux e-mails (confirmés) de `admin_users` —
`julesvalet71250@gmail.com` au départ. Statistiques (visites anonymes par
navigateur et par jour, joueurs, parties, par jeu), joueurs (ban, avertissement,
remise à zéro, FEES), trophées, badges, événements, modération (bannis,
questions de la Roulette signalées), signalements, FEES (prix, gains,
plafonds, objets, transactions) et journal. Le site est statique : un ban
ferme toutes les écritures (parties, amis, groupes, messages), pas la
connexion elle-même. Images : bucket public `plafee-assets`, écrit par les
admins seulement.

**God mode** (`/admin?onglet=god`, migration
[0007](supabase/migrations/0007_admin_god_mode.sql)) : réservé au rôle
`super_admin` d'`admin_users`. Pseudo, photo, bio, solde de FEES, victoires
et défaites par jeu (ou un win rate global), trophées, objets de boutique,
badges : tout se modifie dans un brouillon, puis part en un seul envoi
(`admin_god_save`, tout ou rien). Chaque modification laisse une ligne
`god_edit` dans le journal. Les victoires ajoutées sont de vraies lignes de
`game_results` (0 point, datées de l'inscription, `details.admin`) : elles
comptent dans les totaux et les trophées, pas dans les classements de la
semaine ni dans l'historique des parties.

**Bots** : Scopa, UNO, Puissance 4 (Forge et Classic) et Flip 7 se jouent
contre des bots — Facile, Normal, Difficile, ou Aléatoire (chaque bot tire son
niveau en secret). Aucune connexion : le navigateur tient la table comme l'hôte
d'une partie en ligne, avec le même moteur, et joue pour les bots
([src/features/bots/](src/features/bots/), une IA par jeu dans `engine/ai.ts`).
Depuis la migration 0014, ces parties entrent dans le nombre de parties jouées,
mais ne rapportent ni victoire, ni points, ni FEES : jouées dans un seul
navigateur, personne ne peut les confirmer. `npm run test:bots` fait jouer des
centaines de parties bot contre bot : aucune ne doit se bloquer.

**Cosmétiques en partie** : chaque joueur annonce son compte en rejoignant une
table ; tout le monde voit alors le contour, les flammes et le nœud papillon
des autres sur leur place, le dos de leurs cartes à leur skin, et leur
animation de victoire quand ils gagnent. Le nœud papillon (rayon Accessoires)
et le contour Flammes sont dessinés en SVG dans `public/cosmetics/`
(migration [0008](supabase/migrations/0008_cosmetics_bow_flame.sql)), comme les
Plantes japonaises, des fleurs de cerisier grises dans les coins de la photo qui
oscillent à peine (`flowers.svg`, version fixe `flowers-still.svg` quand les
animations sont coupées ; migration [0009](supabase/migrations/0009_accessory_flowers.sql)).

**Avertissements** : le bandeau d'un avertissement d'admin s'efface seul après
10 secondes et ne revient plus (il reste dans la cloche) ; seule la suspension
d'un compte reste affichée.

## Ajouter une nouvelle feature

Chaque mini-app vit dans son propre dossier sous `src/features/<nom>/`. Pour
qu'elle apparaisse sur l'accueil, ajoute-la au tableau `GAMES` de
[src/features/games.ts](src/features/games.ts), à `GAME_TITLES` de
`GameTitle.tsx` (et son style dans `gameTitle.css` : sa police pixel, sa couleur
et sa devise), et à `game_types` en base si ses parties doivent compter.

## Déploiement

Le site se déploie automatiquement sur GitHub Pages à chaque push sur `main` (voir [.github/workflows/deploy.yml](.github/workflows/deploy.yml)). Le repo doit avoir Pages activé avec la source "GitHub Actions" (Settings → Pages).

Le build copie également l’entrée compilée vers `404.html`, pour que les liens directs de jeux et de rooms soient résolus par React Router sur GitHub Pages.
