# Inventaire des données personnelles — PLAFEE

État au 28/10/2026, établi à partir des migrations `supabase/migrations/0001` à `0012`, du schéma en production (projet `wlmmbvnhkxactvfxtdgr`, eu-west-1) et du code `src/`. Les tables `commandes` et `adresses` sont hors périmètre.

> Les écarts relevés aux §5 et §8 sont corrigés par `supabase/migrations/0013_legal_compliance.sql` et le code de `src/features/legal/`. Les pages publiées sont dans `src/features/legal/content/`.

Légende des durées : **actuelle** = ce que fait le code aujourd'hui, **proposée** = ce que je propose d'inscrire dans la politique (et d'automatiser avec `pg_cron`, déjà installé).

## 1. Compte

| Où | Données | Pourquoi | Visible par | Durée actuelle → proposée |
|---|---|---|---|---|
| `auth.users` (Supabase Auth) | e-mail, mot de passe **haché**, dates d'inscription / dernière connexion, pseudo et code parrain dans `raw_user_meta_data` | Se connecter, récupérer son compte | Jules (admin) seulement | Illimitée → jusqu'à suppression du compte, ou **3 ans sans connexion** |
| `auth.audit_log_entries`, journaux Supabase | adresse IP, date des connexions | Sécurité (Supabase) | Jules, Supabase | Gérée par Supabase (rétention courte des journaux selon l'offre) |
| `profiles` | pseudo, avatar, bio (200 car.), préférences (thème, notifs, langue), dates | Profil de joueur | **Public, même sans compte** | Jusqu'à suppression |
| bucket `avatars` (public) | photo de profil importée | Avatar | **Public** (URL directe) | Jusqu'à remplacement ou suppression |
| `last_seen` | dernière heure de passage | « En ligne / vu il y a… » | Amis | Écrasée à chaque passage ; supprimée avec le compte |
| `player_rooms`, `game_rooms` | table de jeu actuelle | Bouton « Rejoindre » des amis | Amis | Éphémère (battement de 30 s) |

## 2. Jeu et progression

| Où | Données | Pourquoi | Visible par | Durée |
|---|---|---|---|---|
| `game_sessions`, `game_results` | parties, victoires, score, points, séries | Statistiques, classements | **Public** (classements) | Jusqu'à suppression du compte |
| `user_achievements`, `user_badges`, `event_participants`, `event_sessions` | trophées, badges, participation aux événements | Progression | Public | Jusqu'à suppression |
| `user_fees` | solde de FEES, total gagné/dépensé, série quotidienne | Monnaie virtuelle | **Public** (classement richesse) | Jusqu'à suppression |
| `fees_transactions` | historique des gains/dépenses | Anti-triche, réclamations | Le joueur, Jules | Illimitée → **3 ans** |
| `user_shop_purchases` | cosmétiques possédés, texte perso | Boutique | Le joueur (équipés : public) | Jusqu'à suppression |
| `referrals` | qui a parrainé qui | Récompense de parrainage, anti-comptes multiples | Jules | Jusqu'à suppression |
| `truth_questions` | questions écrites par le joueur | Jeu Action/Vérité | Public (si non masquée) | Jusqu'à suppression |

## 3. Social

| Où | Données | Pourquoi | Visible par | Durée |
|---|---|---|---|---|
| `friendships`, `blocks` | demandes d'amis, amis, blocages | Liste d'amis | Les deux joueurs concernés | Jusqu'à suppression |
| `groups`, `group_members`, `group_invitations` | groupes créés, membres, invitations | Groupes | Membres | Jusqu'à suppression |
| `group_messages` | messages de groupe (500 car.) | Chat | Membres du groupe | Illimitée → **1 an**, ou jusqu'à suppression par l'auteur |
| `notifications` | notifications reçues | Cloche | Le joueur | Illimitée → **6 mois** |
| Chat des parties (Flip 7…) | messages pendant la partie | Chat de table | Joueurs de la table | **Non stocké** : passe en direct entre navigateurs |

## 4. Modération

| Où | Données | Pourquoi | Visible par | Durée |
|---|---|---|---|---|
| `player_reports` | signaleur, joueur signalé, motif, détails, décision | Modération | Jules | Illimitée → **1 an** après décision |
| `truth_question_reports` | qui a signalé quelle question | Masquage auto au 3e signalement | Personne (fonctions seulement) | Jusqu'à suppression |
| `player_warnings` | avertissements reçus | Sanction graduée | Le joueur, Jules | Illimitée → **2 ans** |
| `player_bans` | ban, motif, date | Sanction | Le joueur, Jules | Pendant le ban |
| `admin_logs` | actions de Jules, joueur visé (uuid), détails | Traçabilité des sanctions | Jules | Illimitée → **1 an** |
| `admin_users` | e-mail des admins | Accès à /admin | Personne | — |

## 5. Mesure d'audience : `site_visits`

- Colonnes : `day`, `visitor`, `user_id`, `first_at`, `hits`.
- **Pas d'IP** stockée. `visitor` est un identifiant aléatoire de 20 caractères tiré par le navigateur et gardé dans `localStorage` (`plafee-visitor`) : pas d'identifiant brut ni d'empreinte.
- **Mais** : `track_visit()` enregistre aussi `user_id` quand le visiteur est connecté (14 lignes sur 39 aujourd'hui). La visite est donc **reliée au compte**, alors que cette colonne n'est lue nulle part (`admin_stats` ne compte que `visitor`).
- Pas de transmission à des tiers. Pas de purge : la conservation est **illimitée** (données depuis le 23/09/2026).
- L'identifiant `plafee-visitor` n'expire jamais.

**Verdict CNIL** : ce n'est **pas** encore une mesure d'audience exemptée de consentement. La CNIL exige des données anonymes ou au moins non recoupées avec d'autres traitements (le lien vers le compte casse cette condition), un traceur valable **13 mois maximum** et des données gardées **25 mois maximum**.

**Correction proposée (sans bandeau)** :
1. `track_visit()` n'écrit plus `user_id`.
2. L'identifiant du navigateur est renouvelé tous les 13 mois.
3. Une purge `pg_cron` supprime les lignes de plus de 25 mois.
4. Mettre à `null` les 14 `user_id` déjà stockés. **Ça modifie des données existantes : j'attends ton accord explicite.**

Avec ces quatre points, pas besoin de bandeau de cookies.

## 6. Stockage dans le navigateur (pas de cookies)

Aucun `document.cookie` dans le code. Tout est en `localStorage` / `sessionStorage` :

| Clé | Rôle | Catégorie |
|---|---|---|
| `sb-…-auth-token` (Supabase) | Rester connecté | Indispensable |
| `userTheme`, `plafee-crt`, `plafee-fx`, `plafee-look`, `plafee-skin`, `plafee-cards`, RGB | Apparence | Préférence demandée par l'utilisateur |
| pseudo invité, statut social, niveau des bots, stats Flip 7, bannières vues, avertissements vus | Confort | Préférence |
| `plafee-ref` | Code parrain jusqu'à l'inscription | Fonctionnel (demandé via le lien) |
| `plafee-visitor` (+ `plafee-visit-day` en session) | Mesure d'audience | Exemptée **après correction §5** |

Aucun traceur publicitaire, aucun outil d'analyse tiers. Pas de Google Fonts ni de CDN externe dans le code.

## 7. Destinataires et services tiers

| Service | Rôle | Données | Localisation |
|---|---|---|---|
| **Supabase** (Supabase Pte. Ltd.) | Base de données, comptes, fichiers | Tout ce qui précède | Serveurs en Irlande (eu-west-1) ; société hors UE |
| **GitHub Inc.** (GitHub Pages) | Héberge le site | Adresse IP des visiteurs (journaux techniques de GitHub) | États-Unis |
| **PeerJS Cloud** (`0.peerjs.com`, réglage par défaut de la bibliothèque `peerjs`) ⚠️ | Mise en relation des joueurs pour les parties en ligne (WebRTC) | Adresse IP, identifiant de connexion | Hors de ton contrôle, probablement hors UE |
| **Serveurs STUN** par défaut (Google) ⚠️ | Aident les navigateurs à se trouver | Adresse IP | États-Unis |
| **Les autres joueurs de la table** ⚠️ | Connexion directe pair-à-pair | **Ton adresse IP est visible par les navigateurs des autres joueurs** | — |

Les lignes ⚠️ ne figuraient pas dans ta liste. Elles doivent apparaître dans la politique de confidentialité. Une piste technique pour plus tard : héberger son propre serveur PeerJS et un relais TURN dans l'UE.

## 8. Écarts avec la demande (à corriger dans le code)

1. **Inscription** : pas de case CGU/âge, et rien n'enregistre l'acceptation.
2. **Suppression de compte** : aucune fonction. Supprimer `auth.users` déclencherait les suppressions en cascade, mais avec trois effets de bord :
   - `groups.created_by … on delete cascade` : supprimer le créateur **supprime le groupe pour tous les membres** → il faut transférer le groupe à un autre membre avant.
   - `group_messages.sender_id … on delete set null` : les messages **restent, sans auteur** → il faut en effacer le texte (suppression « douce » déjà prévue par le schéma).
   - Les fichiers du bucket `avatars` ne partent pas avec la cascade → il faut les supprimer via l'API Storage.
3. **Bans** : le joueur voit déjà le motif (bandeau `site.tsx`), mais le motif est **facultatif** dans `/admin`. Si le compte est supprimé, rien n'empêche de se réinscrire avec le même e-mail → il faut une trace minimale (empreinte de l'e-mail + date + motif).
4. **Avertissements** : déjà notifiés au joueur (cloche + bandeau). ✔
5. **Reset des stats** et **badge de sanction** : le joueur **n'est pas prévenu** et aucun motif n'est demandé.
6. **Contestation** : aucun moyen prévu → lien « Contester » vers l'adresse de contact.
7. **Durées de conservation** : aucune purge automatique aujourd'hui (seul le job `plafee-settle-events` tourne).

## 9. Points hors code à connaître

- Le dépôt GitHub est **public**, et la migration `0006_plafee_v2.sql` contient ton adresse e-mail personnelle (seed de `admin_users`). Si tu veux rester anonyme au titre de la LCEN, c'est une fuite : ton nom figure aussi dans l'adresse. Pour la retirer de l'historique, il faudrait réécrire l'historique git, et je ne le fais pas sans ta demande.
- `profiles`, `user_fees` et les classements sont lisibles **sans compte**. C'est voulu, mais la politique le dira clairement.
