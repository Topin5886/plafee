# Président

Routes : `/president` (salon) et `/president/:code` (table). Jeu de cartes traditionnel, de 3 à 7 joueurs, construit sur le modèle d’UNO : un moteur pur dans `engine/`, un hôte autoritaire en PeerJS dans `net/`, des bots qui jouent avec le même moteur que tout le monde.

## Règles

- **Les cartes.** 52 cartes. Ordre croissant : 3, 4, 5, 6, 7, 8, 9, 10, Valet, Dame, Roi, As, 2. Le 2 est la plus forte. Les couleurs ne comptent jamais. Toutes les cartes sont distribuées une à une à partir du siège 0 : si la donne tombe mal, les premiers sièges ont une carte de plus (à 5 joueurs : 11, 11, 10, 10, 10).
- **Le pli.** Celui qui ouvre pose 1, 2, 3 ou 4 cartes de même valeur ; il ne peut pas passer. Les suivants posent le même nombre de cartes, de valeur égale ou supérieure, ou passent. Passer n’exclut pas du pli : on peut rejouer au tour suivant si quelqu’un a reposé entre-temps.
- **La fermeture.** Le pli se ferme quand tous les autres joueurs encore en jeu ont passé depuis la dernière pose : le dernier à avoir posé rouvre. Il se ferme aussi d’un coup quand quelqu’un pose un ou plusieurs 2, ou un carré : celui-là rouvre aussitôt.
- **« X ou rien »** (option, activée par défaut). Reposer la même valeur que la pose précédente l’impose au joueur suivant : « 7 ou rien ! ». Il pose cette valeur ou il passe. La contrainte ne vaut que pour lui, et se reporte s’il repose encore la même valeur. Elle tombe à la fermeture du pli.
- **La sortie.** Un joueur sans cartes sort. Si le pli doit être rouvert par un joueur sorti, la main passe au suivant encore en jeu. La manche finit quand il ne reste qu’un joueur avec des cartes.
- **Les rôles**, dans l’ordre de sortie : Président, Vice-président (dès 4 joueurs), Neutres, Vice-trou (dès 4 joueurs), Trou du cul. À 3 : Président, Neutre, Trou du cul.
- **Les points.** Une place vaut `n − 1 − place` : le Président marque `n − 1`, le Trou du cul 0. La partie se joue en 3, 5 ou 7 manches. Le plus gros total gagne ; à égalité, la meilleure place de la dernière manche départage, il y a donc toujours un seul gagnant.
- **L’échange**, au début de chaque manche après la première. Le Trou du cul donne d’office ses 2 meilleures cartes au Président, qui lui en rend 2 de son choix. Dès 4 joueurs, le Vice-trou donne sa meilleure carte au Vice-président, qui en rend 1. On peut rendre une carte qu’on vient de recevoir.
- **Qui ouvre.** En première manche, celui qui a la Dame de cœur. Ensuite, le Trou du cul de la manche précédente.

## Choix d’implémentation

Le moteur (`engine/rules.ts`) est pur : pas de React, pas de navigateur. Chaque action rend un nouvel état, et une action refusée rend le même état avec un message en français, prêt à afficher. Le seul aléa est le mélange : `applyAction`, `shuffle` et l’IA acceptent une source d’aléa optionnelle, ce qui rend les tests rejouables.

- **Événements.** Chaque action qui fait avancer la partie incrémente `lastEvent.seq` une seule fois. Quand une pose déclenche plusieurs choses (un 2 qui fait sortir le joueur et finit la manche), l’événement émis est le plus important (`over` > `manche-end` > `out` > `trick` > `play`), et il garde le détail de la pose (`by`, `rank`, `count`, `reason`, `place`). Le journal raconte tout, dans l’ordre. Pour un pli fermé par les passes, `by` désigne celui qui remporte le pli, pas celui qui a passé en dernier.
- **Départs.** Un joueur parti est sauté et ne compte plus parmi les joueurs en jeu : la table ne l’attend jamais. S’il avait la main, elle passe (et le pli peut se fermer). Pendant l’échange, s’il devait rendre des cartes, le moteur rend d’office ses plus basses. S’il ne reste qu’un joueur avec des cartes, la manche finit ; les partis sont classés après le dernier, dans l’ordre des sièges. Sous 2 joueurs connectés, la partie s’arrête au score, sans compter la manche interrompue. Une fois la partie finie, un départ marque seulement le joueur déconnecté, sans ligne au journal ni événement : la signature d’issue est tirée de l’état final, et si elle bougeait, ceux restés sur l’écran de fin enregistreraient la partie une deuxième fois.
- **Manche suivante après un départ.** Les cartes ne sont distribuées qu’aux joueurs connectés : un joueur parti ne jouerait plus les siennes. Un échange dont l’un des deux joueurs est parti n’a pas lieu, et si le Trou du cul est parti, le suivant connecté ouvre.
- **Revanche.** `REMATCH` repart de zéro avec les mêmes joueurs (scores, rôles, statistiques, historique), mais `lastEvent.seq` et le journal continuent de croître : la signature de partie (`gagnant|seq|longueur du journal`) change donc à chaque partie. Il faut au moins 3 joueurs connectés.
- **États masqués.** Les aides partagées avec l’écran (`activeSeats`, `legalPlays`, `canPlayCards`…) se fient à `handCount`, jamais à la main des autres : elles marchent sur l’état masqué que reçoit chaque joueur.
- **Statistiques**, tenues par le moteur et identiques chez tous : carrés posés, plis fermés au 2, série de manches finies Président (en cours et record), passages de Trou du cul à Président. Elles alimentent les trophées, sans compteur supplémentaire côté écran.

## Les bots

`engine/ai.ts` ne choisit jamais qu’entre les poses de `legalPlays` : un bot ne tente jamais de coup illégal, et quand il ouvre, il pose toujours. Il gère son tour (poser ou passer) et ses dons pendant l’échange ; il ne lance jamais la manche suivante, c’est l’hôte.

- **Facile** : une pose légale au hasard, et il passe parfois alors qu’il pourrait jouer. Il rend des cartes au hasard.
- **Normal** : ouvre avec son groupe le plus faible, en entier ; suit avec la plus petite pose qui ne casse pas une paire ou un brelan ; garde ses 2. Il rend ses plus basses cartes.
- **Difficile** : garde ses 2 et ses carrés pour reprendre la main, et les joue d’abord quand il ne lui reste qu’un groupe à placer ; ouvre avec ses groupes les plus faibles ; près de la sortie, vide ses grosses combinaisons et garde sa carte la plus forte pour la fin ; ne gâche pas un As sur un petit pli en début de manche ; coupe au 2 dès qu’un adversaire va sortir. Il rend ses cartes isolées les plus basses, et garde As et 2.

Sur des parties de 5 manches à 4 joueurs, le difficile gagne environ 99 % de ses parties contre trois faciles, et 57 % contre trois normaux (le hasard donnerait 25 %) ; le normal gagne environ la moitié des siennes contre trois faciles.

## Vérification

`npm run test:president` lance `engine/rules.test.mts` (272 vérifications : donne de 3 à 7 joueurs, poses et erreurs, fermetures, « X ou rien », sorties, échanges, départs à chaque phase, scores, départage, statistiques, revanche, immuabilité) puis `engine/ai.test.mts` (choix ciblés par niveau, et 275 parties complètes bot contre bot de 3 à 7 joueurs, dont 75 avec un départ en cours de route, dans n’importe quelle phase : aucune erreur, aucun blocage, les 52 cartes toujours présentes, `handCount` toujours juste, un seul gagnant, et 600 parties pour comparer les niveaux).
