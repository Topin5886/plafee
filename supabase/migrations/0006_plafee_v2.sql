-- ===========================================================================
-- PLAFEE V2 — trophées par rareté, badges, événements, FEES, boutique, admin
--
-- À appliquer après 0005. Mêmes principes que le reste du schéma :
--   - lecture filtrée par la RLS ;
--   - toute écriture passe par une fonction SECURITY DEFINER qui porte la
--     règle (qui peut, combien, à quelle condition) ;
--   - tout ce qui rapporte (trophées, FEES) se calcule ici, à partir des
--     parties enregistrées — jamais à partir de ce qu'un client affirme.
--
-- Réserve assumée, la même depuis 0001 : les parties sont en P2P, un client
-- modifié peut déclarer une victoire. Les FEES de victoire sont donc plafonnés
-- par jour (réglable), et le plafond de vainqueurs par partie tient toujours.
--
-- L'administration n'a pas de serveur à elle : un admin est un compte dont
-- l'e-mail (confirmé) figure dans `admin_users`. Chaque fonction `admin_*`
-- vérifie ce statut elle-même, et laisse une trace dans `admin_logs`.
--
-- Idempotent : le rejouer sur une base à jour ne change rien.
-- ===========================================================================

-- ===========================================================================
-- 1. Administration
-- ===========================================================================

create table if not exists public.admin_users (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  role       text        not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at timestamptz not null default now()
);
create unique index if not exists admin_users_email_key on public.admin_users (lower(email));

insert into public.admin_users (email, role)
values ('julesvalet71250@gmail.com', 'super_admin')
on conflict (lower(email)) do update set role = excluded.role;

alter table public.admin_users enable row level security;
-- Aucune policy : la liste des admins ne se lit que par is_admin().

create table if not exists public.admin_logs (
  id         bigint      generated always as identity primary key,
  admin_id   uuid        references public.profiles (id) on delete set null,
  action     text        not null,
  target_id  text,
  details    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_logs_created_idx on public.admin_logs (created_at desc);
alter table public.admin_logs enable row level security;

-- L'appelant est-il admin ? L'e-mail doit être confirmé : un compte créé avec
-- l'adresse d'un admin, sans accès à sa boîte, n'obtient rien.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_users a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function public._require_admin()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux admins.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function public._admin_log(p_action text, p_target text, p_details jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.admin_logs (admin_id, action, target_id, details)
  values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

-- ===========================================================================
-- 2. Modération : bans, avertissements, signalements
-- ===========================================================================
-- Hors de `profiles` : un joueur peut modifier sa propre ligne de profil, il
-- ne doit pas pouvoir y effacer son ban.

create table if not exists public.player_bans (
  user_id   uuid        primary key references public.profiles (id) on delete cascade,
  reason    text,
  banned_by uuid        references public.profiles (id) on delete set null,
  banned_at timestamptz not null default now()
);
alter table public.player_bans enable row level security;
drop policy if exists player_bans_read_self on public.player_bans;
create policy player_bans_read_self on public.player_bans
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.player_warnings (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  admin_id   uuid        references public.profiles (id) on delete set null,
  message    text        not null check (char_length(message) between 3 and 500),
  created_at timestamptz not null default now()
);
alter table public.player_warnings enable row level security;
drop policy if exists player_warnings_read_self on public.player_warnings;
create policy player_warnings_read_self on public.player_warnings
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.player_reports (
  id          bigint      generated always as identity primary key,
  reporter_id uuid        references public.profiles (id) on delete set null,
  reported_id uuid        not null references public.profiles (id) on delete cascade,
  reason      text        not null check (reason in ('spam', 'toxique', 'triche', 'pseudo', 'autre')),
  details     text        check (details is null or char_length(details) <= 500),
  status      text        not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolution  text,
  resolved_by uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists player_reports_status_idx on public.player_reports (status, created_at desc);
alter table public.player_reports enable row level security;

-- Un compte banni ne peut plus rien écrire : toutes les fonctions sociales
-- passent par _require_uid(), la bannir ici suffit à les fermer.
create or replace function public._require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Il faut être connecté.' using errcode = '42501';
  end if;
  if exists (select 1 from public.player_bans where user_id = v_uid) then
    raise exception 'Ton compte est suspendu.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.report_player(p_user_id uuid, p_reason text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'Signalement impossible.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Joueur introuvable.' using errcode = '22023';
  end if;
  if exists (select 1 from public.player_reports
              where reporter_id = v_uid and reported_id = p_user_id and status = 'pending') then
    raise exception 'Tu as déjà signalé ce joueur, un admin va regarder.' using errcode = '23505';
  end if;
  if (select count(*) from public.player_reports
       where reporter_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Trop de signalements aujourd''hui.' using errcode = '54000';
  end if;
  insert into public.player_reports (reporter_id, reported_id, reason, details)
  values (v_uid, p_user_id, coalesce(p_reason, 'autre'), nullif(btrim(coalesce(p_details, '')), ''));
end;
$$;

-- Le statut de mon compte : banni ? avertissements récents ?
create or replace function public.my_standing()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'banned', exists (select 1 from public.player_bans where user_id = auth.uid()),
    'ban_reason', (select reason from public.player_bans where user_id = auth.uid()),
    'is_admin', public.is_admin(),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object('message', w.message, 'created_at', w.created_at) order by w.created_at desc)
      from (select * from public.player_warnings where user_id = auth.uid() order by created_at desc limit 5) w
    ), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- 3. Trophées V2 : 50 trophées, six raretés
-- ===========================================================================

alter table public.achievements drop constraint if exists achievements_tier_check;
alter table public.achievements drop constraint if exists achievements_category_check;
alter table public.achievements add column if not exists metric     text    not null default 'builtin';
alter table public.achievements add column if not exists game       text    references public.game_types (id) on delete set null;
alter table public.achievements add column if not exists image_url  text;
alter table public.achievements add column if not exists event_id   uuid;
alter table public.achievements add column if not exists is_limited boolean not null default false;
alter table public.achievements add column if not exists active     boolean not null default true;
alter table public.achievements add column if not exists created_at timestamptz not null default now();

-- Les anciennes raretés « légende » deviennent « platine ».
update public.achievements set tier = 'platine' where tier = 'legende';

alter table public.achievements add constraint achievements_tier_check
  check (tier in ('bronze', 'argent', 'or', 'platine', 'divin', 'og'));
alter table public.achievements add constraint achievements_category_check
  check (category in ('victoires', 'flip7', 'scopa', 'uno', 'puissance4', 'verite', 'social', 'defis', 'evenement', 'special'));
alter table public.achievements drop constraint if exists achievements_metric_check;
alter table public.achievements add constraint achievements_metric_check
  check (metric in ('builtin', 'wins', 'games', 'manual', 'event'));

alter table public.user_achievements add column if not exists extra jsonb not null default '{}'::jsonb;

-- Le catalogue des 50 trophées « maison ». Les trophées créés par un admin
-- (metric wins/games/manual) et ceux des événements vivent à côté.
insert into public.achievements (id, title, description, category, icon, tier, goal, sort_order, metric, game) values
  -- Victoires
  ('first_win',        'Premier pas',       'Gagner une partie, n''importe laquelle.',                      'victoires',  'Footprints',     'bronze',  1,    10, 'builtin', null),
  ('warrior',          'Guerrier',          'Gagner 10 parties.',                                           'victoires',  'Swords',         'argent',  10,   20, 'builtin', null),
  ('champion',         'Champion',          'Gagner 50 parties.',                                           'victoires',  'Trophy',         'or',      50,   30, 'builtin', null),
  ('king',             'Roi des rois',      'Gagner 100 parties.',                                          'victoires',  'Crown',          'platine', 100,  40, 'builtin', null),
  ('god',              'Divinité',          'Gagner 500 parties.',                                          'victoires',  'Sun',            'divin',   500,  45, 'builtin', null),
  -- Flip 7
  ('flip7_first',      'Premier flip',      'Gagner une partie de Flip 7.',                                 'flip7',      'Dices',          'bronze',  1,    50, 'builtin', 'flip7'),
  ('flip7_zero',       'Zéro pointé',       'Au Flip 7, t''arrêter à 0 point, 10 fois.',                    'flip7',      'Hand',           'bronze',  10,   52, 'builtin', 'flip7'),
  ('flip7_cardiac',    'Cardiaque',         'Gagner 5 parties de Flip 7.',                                  'flip7',      'HeartPulse',     'argent',  5,    54, 'builtin', 'flip7'),
  ('flip7_ace',        'As du flip',        'Gagner 20 parties de Flip 7.',                                 'flip7',      'Spade',          'or',      20,   56, 'builtin', 'flip7'),
  ('flip7_master',     'Maître du flip',    'Gagner 50 parties de Flip 7.',                                 'flip7',      'Gem',            'platine', 50,   58, 'builtin', 'flip7'),
  -- Scopa
  ('scopa_first',      'Première scopa',    'Gagner une partie de Scopa.',                                  'scopa',      'Sparkle',        'bronze',  1,    70, 'builtin', 'scopa'),
  ('scopa_scopeur',    'Scopeur',           'Réussir 3 scopas d''affilée dans une même partie.',            'scopa',      'Sparkles',       'argent',  3,    72, 'builtin', 'scopa'),
  ('scopa_legend',     'Légendaire',        'Gagner 20 parties de Scopa.',                                  'scopa',      'Medal',          'or',      20,   74, 'builtin', 'scopa'),
  ('scopa_master',     'Maestro',           'Gagner 50 parties de Scopa.',                                  'scopa',      'Award',          'platine', 50,   76, 'builtin', 'scopa'),
  ('scopa_god',        'Il Padrino',        'Gagner 100 parties de Scopa.',                                 'scopa',      'Crown',          'divin',   100,  78, 'builtin', 'scopa'),
  -- UNO
  ('uno_first',        'Premier UNO',       'Gagner une partie d''UNO.',                                    'uno',        'Layers',         'bronze',  1,    90, 'builtin', 'uno'),
  ('uno_strategist',   'Stratège',          'Jouer 50 cartes spéciales à l''UNO.',                          'uno',        'Shuffle',        'bronze',  50,   92, 'builtin', 'uno'),
  ('uno_fast',         'Rapide',            'Gagner 3 parties d''UNO d''affilée.',                          'uno',        'Zap',            'argent',  3,    94, 'builtin', 'uno'),
  ('uno_ace',          'Crusher',           'Gagner 20 parties d''UNO.',                                    'uno',        'Flame',          'or',      20,   96, 'builtin', 'uno'),
  ('uno_master',       'Maître du chaos',   'Gagner 50 parties d''UNO.',                                    'uno',        'Tornado',        'platine', 50,   98, 'builtin', 'uno'),
  -- Puissance 4
  ('p4_geometer',      'Géomètre',          'Gagner 10 parties de Puissance 4.',                            'puissance4', 'Grid3x3',        'bronze',  10,   110, 'builtin', null),
  ('p4_strategist',    'Stratégiste',       'Gagner 5 parties de Puissance 4 d''affilée.',                  'puissance4', 'Brain',          'argent',  5,    112, 'builtin', null),
  ('p4_classic',       'Puriste',           'Gagner 30 parties de P4 Classic.',                             'puissance4', 'Disc',           'argent',  30,   114, 'builtin', 'puissance4-original'),
  ('p4_forge',         'Forgeron',          'Gagner 30 parties de P4 Forge.',                               'puissance4', 'Hammer',         'or',      30,   116, 'builtin', 'puissance4'),
  ('p4_master',        'Grand maître',      'Gagner 100 parties de Puissance 4, tous modes.',               'puissance4', 'Castle',         'platine', 100,  118, 'builtin', null),
  -- Roulette de Vérité
  ('verite_first',     'Premier aveu',      'Jouer une partie de Roulette de Vérité.',                      'verite',     'Wine',           'bronze',  1,    130, 'builtin', 'verite'),
  ('verite_honest',    'Franc-jeu',         'Répondre à 5 questions d''affilée sans en esquiver une.',      'verite',     'MessageCircle',  'bronze',  5,    132, 'builtin', 'verite'),
  ('verite_valid20',   'Crédible',          'Faire valider 20 réponses par le chef.',                       'verite',     'BadgeCheck',     'argent',  20,   134, 'builtin', 'verite'),
  ('verite_chef',      'Chef étoilé',       'Arbitrer 10 parties complètes en tant que chef.',              'verite',     'ChefHat',        'argent',  10,   136, 'builtin', 'verite'),
  ('verite_hard10',    'Sans filtre',       'Répondre à 10 questions HARD d''affilée.',                     'verite',     'Flame',          'or',      10,   138, 'builtin', 'verite'),
  ('verite_valid100',  'Parole d''or',      'Faire valider 100 réponses par le chef.',                      'verite',     'ShieldCheck',    'platine', 100,  140, 'builtin', 'verite'),
  ('verite_author',    'Grand inquisiteur', 'Poser 50 questions perso validées par le chef.',               'verite',     'Feather',        'divin',   50,   142, 'builtin', 'verite'),
  -- Sociabilité
  ('social_sociable',  'Sociable',          'Jouer avec 5 amis différents.',                                'social',     'Users',          'bronze',  5,    150, 'builtin', null),
  ('social_groupie',   'Groupie',           'Créer ou rejoindre 3 groupes.',                                'social',     'MessagesSquare', 'argent',  3,    152, 'builtin', null),
  ('social_best',      'Meilleur ami',      'Jouer 10 parties avec le même ami.',                           'social',     'HeartHandshake', 'or',      10,   154, 'builtin', null),
  ('social_star',      'Star de la salle',  'Jouer avec 20 amis différents.',                               'social',     'Star',           'platine', 20,   156, 'builtin', null),
  ('social_founder',   'Fondateur',         'Créer 5 groupes actifs (plus de 5 membres).',                  'social',     'Building2',      'divin',   5,    158, 'builtin', null),
  -- Défis
  ('first_game',       'Insert coin',       'Jouer ta première partie.',                                    'defis',      'Coins',          'bronze',  1,    170, 'builtin', null),
  ('shopper',          'Client fidèle',     'Faire un premier achat à la boutique.',                        'defis',      'ShoppingBag',    'bronze',  1,    172, 'builtin', null),
  ('five_stars',       'Cinq étoiles',      'Gagner à 3 jeux différents le même jour.',                     'defis',      'Stars',          'argent',  3,    174, 'builtin', null),
  ('fees_1000',        'Tirelire',          'Gagner 1 000 FEES au total.',                                  'defis',      'PiggyBank',      'argent',  1000, 176, 'builtin', null),
  ('gold_week',        'Semaine d''or',     'Finir premier du classement d''une semaine.',                  'defis',      'Medal',          'or',      1,    178, 'builtin', null),
  ('streak',           'Série',             'Gagner 5 parties d''affilée, tous jeux confondus.',            'defis',      'TrendingUp',     'or',      5,    180, 'builtin', null),
  ('regular',          'Habitué',           'Jouer 100 parties.',                                           'defis',      'Coffee',         'or',      100,  182, 'builtin', null),
  ('daily7',           'Assidu',            'Gagner au moins une partie 7 jours de suite.',                 'defis',      'CalendarCheck',  'or',      7,    184, 'builtin', null),
  ('all_games',        'Touche-à-tout',     'Gagner au moins une partie à chacun des 6 jeux.',              'defis',      'Joystick',       'platine', 6,    186, 'builtin', null),
  ('veteran',          'Vétéran',           'Jouer 500 parties.',                                           'defis',      'Shield',         'platine', 500,  188, 'builtin', null),
  ('fire_month',       'Mois de feu',       'Finir premier du classement d''un mois.',                      'defis',      'Flame',          'divin',   1,    190, 'builtin', null),
  ('legend_1000',      'Légende vivante',   'Jouer 1 000 parties.',                                         'defis',      'Infinity',       'divin',   1000, 192, 'builtin', null),
  ('og_collector',     'OG',                'Atteindre 50 trophées. Édition limitée.',                      'defis',      'Sparkles',       'og',      50,   199, 'builtin', null)
on conflict (id) do update
  set title = excluded.title, description = excluded.description, category = excluded.category,
      icon = excluded.icon, tier = excluded.tier, goal = excluded.goal, sort_order = excluded.sort_order,
      metric = excluded.metric, game = excluded.game;

update public.achievements set is_limited = true where id = 'og_collector';

-- Les trophées maison de la V1 qui n'existent plus. La V1 (0004) en posait
-- 20 ; tous ont été repris ci-dessus, sauf « Timide ». On nomme les retirés
-- plutôt que de garder une liste des conservés : une telle liste, figée ici,
-- effacerait à chaque réexécution de 0006 les trophées maison des jeux arrivés
-- après (le Président, 0015), et avec eux, par la cascade de
-- `user_achievements`, tous les déblocages des joueurs.
delete from public.achievements
where metric = 'builtin' and id in ('flip7_shy');

-- Le compte de trophées, par rareté : pour le classement et les profils.
create or replace view public.achievement_counts
with (security_invoker = on) as
select ua.user_id,
       count(*) filter (where ua.unlocked_at is not null) as unlocked,
       count(*) filter (where ua.unlocked_at is not null and a.tier = 'divin') as divin,
       count(*) filter (where ua.unlocked_at is not null and a.tier = 'og') as og
from public.user_achievements ua
join public.achievements a on a.id = ua.achievement_id
group by ua.user_id;

-- ===========================================================================
-- 4. Badges (cosmétiques, décernés par un admin ou gagnés)
-- ===========================================================================

create table if not exists public.badges (
  id          uuid        primary key default gen_random_uuid(),
  sku         text        unique,
  name        text        not null check (char_length(btrim(name)) between 2 and 40),
  description text        check (description is null or char_length(description) <= 300),
  type        text        not null check (type in ('title', 'visual', 'border', 'plate', 'temporal')),
  rarity      text        not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  image_url   text,
  -- Pour un contour ou une plaque sans image : une couleur, un style.
  style       jsonb       not null default '{}'::jsonb,
  created_by  uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  is_active   boolean     not null default true,
  expiry_date timestamptz
);

create table if not exists public.user_badges (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  badge_id   uuid        not null references public.badges (id) on delete cascade,
  -- Précision propre au joueur : « Parrainé par Jules ».
  note       text,
  awarded_at timestamptz not null default now(),
  awarded_by uuid        references public.profiles (id) on delete set null,
  unique (user_id, badge_id)
);
create index if not exists user_badges_user_idx on public.user_badges (user_id);

alter table public.badges      enable row level security;
alter table public.user_badges enable row level security;
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select to anon, authenticated using (true);
drop policy if exists user_badges_read on public.user_badges;
create policy user_badges_read on public.user_badges for select to anon, authenticated using (true);

insert into public.badges (sku, name, description, type, rarity, style) values
  ('referred', 'Parrainé', 'Arrivé grâce à un ami, et resté.', 'title', 'common', '{"color":"#00ffff"}')
on conflict (sku) do nothing;

create or replace function public._award_badge(p_user uuid, p_badge uuid, p_note text default null, p_by uuid default null)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  insert into public.user_badges (user_id, badge_id, note, awarded_by)
  values (p_user, p_badge, p_note, p_by)
  on conflict (user_id, badge_id) do nothing;
  if not found then
    return false;
  end if;
  select name into v_name from public.badges where id = p_badge;
  perform public._notify(p_user, 'badge', p_by, null, jsonb_build_object('badge_id', p_badge, 'name', v_name));
  return true;
end;
$$;

-- ===========================================================================
-- 5. FEES : la monnaie de PLAFEE
-- ===========================================================================

create table if not exists public.user_fees (
  user_id           uuid        primary key references public.profiles (id) on delete cascade,
  balance           bigint      not null default 0 check (balance >= 0),
  lifetime_earned   bigint      not null default 0,
  lifetime_spent    bigint      not null default 0,
  last_daily_streak date,
  current_streak    int         not null default 0,
  best_streak       int         not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.fees_transactions (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  amount      bigint      not null,
  type        text        not null check (type in ('victory', 'chef', 'event', 'streak', 'referral', 'admin_grant', 'admin_revoke', 'shop_purchase')),
  related_id  text,
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists fees_transactions_user_idx on public.fees_transactions (user_id, created_at desc);
create index if not exists fees_transactions_created_idx on public.fees_transactions (created_at desc);

-- Tous les montants réglables : gains par jeu, bonus, plafonds.
create table if not exists public.fees_price_config (
  action     text        primary key,
  label      text        not null,
  amount     bigint      not null check (amount >= 0),
  updated_by uuid        references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.fees_price_config (action, label, amount) values
  ('victory_scopa',               'Victoire Scopa',                        50),
  ('victory_puissance4',          'Victoire P4 Forge',                     75),
  ('victory_puissance4-original', 'Victoire P4 Classic',                   60),
  ('victory_uno',                 'Victoire UNO',                          55),
  ('victory_flip7',               'Victoire Flip 7',                       40),
  ('victory_verite',              'Victoire Roulette de Vérité',           0),
  ('verite_chef_complete',        'Chef d''une Roulette complète',         100),
  ('daily_streak_7',              'Série quotidienne de 7 jours',          200),
  ('referral',                    'Parrainage d''un ami actif',            50),
  ('referral_monthly_cap',        'Parrainages payés par mois (max)',      5),
  ('victory_daily_cap',           'Victoires payées par jour (anti-abus)', 30),
  ('chef_daily_cap',              'Parties de chef payées par jour',       5)
on conflict (action) do update set label = excluded.label;

create table if not exists public.shop_items (
  id          uuid        primary key default gen_random_uuid(),
  sku         text        unique,
  name        text        not null check (char_length(btrim(name)) between 2 and 60),
  description text,
  category    text        not null check (category in ('card_theme', 'site_theme', 'badge', 'profile_border', 'nameplate', 'victory_animation')),
  price       bigint      not null check (price >= 0),
  icon_url    text,
  -- Ce que l'objet fait : {"skin":"synthwave"}, {"plate":"LE CHAMPION"}, {"custom":true}…
  payload     jsonb       not null default '{}'::jsonb,
  -- Condition d'achat : {"account_age_days":365}, {"leaderboard_top":100}, {"lifetime_earned":1000000}.
  requirement jsonb       not null default '{}'::jsonb,
  is_default  boolean     not null default false,
  is_active   boolean     not null default true,
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.user_shop_purchases (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  item_id      uuid        not null references public.shop_items (id) on delete cascade,
  quantity     int         not null default 1,
  equipped     boolean     not null default false,
  custom_text  text,
  purchased_at timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists user_shop_purchases_user_idx on public.user_shop_purchases (user_id);

-- Les badges vendus en boutique.
insert into public.badges (sku, name, description, type, rarity, style) values
  ('anniv_1',     'Anniversaire 1 an',  'Un an dans la salle.',              'visual', 'rare',      '{"icon":"Cake","color":"#ffc53d"}'),
  ('anniv_2',     'Anniversaire 2 ans', 'Deux ans dans la salle.',           'visual', 'epic',      '{"icon":"Cake","color":"#ff00ff"}'),
  ('top_100',     'Top 100',            'Dans le top 100 du classement.',    'visual', 'epic',      '{"icon":"Medal","color":"#00ffff"}'),
  ('millionaire', 'Millionnaire',       'Un million de FEES gagnés. Flex.',  'visual', 'legendary', '{"icon":"Gem","color":"#50ff4d"}')
on conflict (sku) do nothing;

insert into public.shop_items (sku, name, description, category, price, payload, requirement, is_default, sort_order) values
  -- Cartes
  ('cards_classic',   'Cartes Classique',       'Le style d''origine.',                               'card_theme',        0,    '{"skin":"classic"}',   '{}', true,  10),
  ('cards_pixel',     'Cartes Pixel Rétro',     'Bords crénelés et palette 8 bits.',                  'card_theme',        200,  '{"skin":"pixel"}',     '{}', false, 11),
  ('cards_holo',      'Cartes Holographiques',  'Reflet arc-en-ciel sur toutes les cartes.',          'card_theme',        300,  '{"skin":"holo"}',      '{}', false, 12),
  ('cards_neon',      'Cartes Néon Cyberpunk',  'Contour cyan et magenta, lueur électrique.',         'card_theme',        300,  '{"skin":"neon"}',      '{}', false, 13),
  ('cards_gold',      'Cartes Gold Prestige',   'Liseré or et éclat doré.',                           'card_theme',        500,  '{"skin":"gold"}',      '{}', false, 14),
  -- Site
  ('site_arcade',     'Arcade Vert',            'Le vert PLAFEE d''origine.',                         'site_theme',        0,    '{"skin":"arcade"}',    '{}', true,  20),
  ('site_retro',      'Retro Orange',           'L''ambre des vieux terminaux.',                       'site_theme',        350,  '{"skin":"retro"}',     '{}', false, 21),
  ('site_synthwave',  'Synthwave Rose',         'Néon rose, nuit de 1986.',                           'site_theme',        400,  '{"skin":"synthwave"}', '{}', false, 22),
  ('site_cyber',      'Cyberpunk Bleu',         'Bleu électrique et cyan.',                           'site_theme',        400,  '{"skin":"cyber"}',     '{}', false, 23),
  -- Badges
  ('badge_anniv_1',   'Badge Anniversaire 1 an',  'Pour les comptes d''au moins un an.',              'badge',             250,  '{"badge_sku":"anniv_1"}',     '{"account_age_days":365}',     false, 30),
  ('badge_anniv_2',   'Badge Anniversaire 2 ans', 'Pour les comptes d''au moins deux ans.',           'badge',             500,  '{"badge_sku":"anniv_2"}',     '{"account_age_days":730}',     false, 31),
  ('badge_top100',    'Badge Top 100',            'Être dans le top 100 du classement (mois).',       'badge',             600,  '{"badge_sku":"top_100"}',     '{"leaderboard_top":100}',      false, 32),
  ('badge_million',   'Badge Millionnaire',       'Avoir gagné 1 000 000 FEES au total.',             'badge',             1000, '{"badge_sku":"millionaire"}', '{"lifetime_earned":1000000}',  false, 33),
  -- Contours
  ('border_silver',   'Contour Argent',         'Un liseré argent classique.',                        'profile_border',    150,  '{"border":"silver"}',  '{}', false, 40),
  ('border_gold',     'Contour Or épique',      'Or brillant, halo chaud.',                           'profile_border',    300,  '{"border":"gold"}',    '{}', false, 41),
  ('border_platine',  'Contour Platine',        'Platine et halo blanc intense.',                     'profile_border',    600,  '{"border":"platine"}', '{}', false, 42),
  ('border_rainbow',  'Contour Rainbow',        'Change de couleur en boucle.',                       'profile_border',    800,  '{"border":"rainbow"}', '{}', false, 43),
  -- Plaques
  ('plate_champion',  'Plaque « Le Champion »',     'Sous ton pseudo, partout.',                      'nameplate',         400,  '{"plate":"LE CHAMPION"}',     '{}', false, 50),
  ('plate_roulette',  'Plaque « Roulette Master »', 'Sous ton pseudo, partout.',                      'nameplate',         350,  '{"plate":"ROULETTE MASTER"}', '{}', false, 51),
  ('plate_scopa',     'Plaque « Scopa Legend »',    'Sous ton pseudo, partout.',                      'nameplate',         350,  '{"plate":"SCOPA LEGEND"}',    '{}', false, 52),
  ('plate_uno',       'Plaque « UNO Crusher »',     'Sous ton pseudo, partout.',                      'nameplate',         350,  '{"plate":"UNO CRUSHER"}',     '{}', false, 53),
  ('plate_custom',    'Plaque perso (5 car.)',      'Ton texte, 5 caractères maximum.',               'nameplate',         500,  '{"custom":true}',             '{}', false, 54),
  -- Animations de victoire
  ('anim_confetti',   'Confettis',              'La pluie de confettis classique.',                   'victory_animation', 0,    '{"anim":"confetti"}',  '{}', true,  60),
  ('anim_fireworks',  'Feux d''artifice',       'Des fusées qui éclatent sur l''écran.',              'victory_animation', 200,  '{"anim":"fireworks"}', '{}', false, 61),
  ('anim_pixels',     'Explosion de pixels',    'L''écran part en morceaux 8 bits.',                  'victory_animation', 250,  '{"anim":"pixels"}',    '{}', false, 62),
  ('anim_hologram',   'Hologramme',             'Ta victoire en projection holo.',                    'victory_animation', 300,  '{"anim":"hologram"}',  '{}', false, 63)
on conflict (sku) do update
  set name = excluded.name, description = excluded.description, category = excluded.category,
      payload = excluded.payload, requirement = excluded.requirement, is_default = excluded.is_default,
      sort_order = excluded.sort_order;

-- Parrainage : une ligne par filleul. Écrite par le trigger d'inscription.
create table if not exists public.referrals (
  referee_id  uuid        primary key references public.profiles (id) on delete cascade,
  referrer_id uuid        not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  rewarded_at timestamptz,
  check (referee_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.user_fees           enable row level security;
alter table public.fees_transactions   enable row level security;
alter table public.fees_price_config   enable row level security;
alter table public.shop_items          enable row level security;
alter table public.user_shop_purchases enable row level security;
alter table public.referrals           enable row level security;

-- Le solde est public (classement de la richesse) ; l'historique, non.
drop policy if exists user_fees_read on public.user_fees;
create policy user_fees_read on public.user_fees for select to anon, authenticated using (true);
drop policy if exists fees_transactions_read_self on public.fees_transactions;
create policy fees_transactions_read_self on public.fees_transactions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists fees_price_config_read on public.fees_price_config;
create policy fees_price_config_read on public.fees_price_config for select to anon, authenticated using (true);
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items for select to anon, authenticated using (true);
drop policy if exists user_shop_purchases_read on public.user_shop_purchases;
create policy user_shop_purchases_read on public.user_shop_purchases for select to anon, authenticated using (true);
drop policy if exists referrals_read_self on public.referrals;
create policy referrals_read_self on public.referrals
  for select to authenticated using (referrer_id = (select auth.uid()) or referee_id = (select auth.uid()));

create or replace function public._fees_config(p_action text)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$ select coalesce((select amount from public.fees_price_config where action = p_action), 0) $$;

-- Crédite (ou débite) un joueur et garde la trace. Un débit ne descend jamais
-- sous zéro : il retire ce qu'il y a.
create or replace function public._fees_add(
  p_user uuid, p_amount bigint, p_type text, p_related text default null, p_description text default null, p_notify boolean default true
)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_balance bigint;
  v_amount  bigint := p_amount;
begin
  if coalesce(p_amount, 0) = 0 then
    return 0;
  end if;
  insert into public.user_fees (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into v_balance from public.user_fees where user_id = p_user for update;
  if v_amount < 0 then
    v_amount := -least(-v_amount, v_balance);
  end if;
  if v_amount = 0 then
    return 0;
  end if;
  update public.user_fees
     set balance         = balance + v_amount,
         lifetime_earned = lifetime_earned + greatest(v_amount, 0) * (p_type <> 'admin_revoke')::int,
         lifetime_spent  = lifetime_spent + case when p_type = 'shop_purchase' then -v_amount else 0 end,
         updated_at      = now()
   where user_id = p_user;
  insert into public.fees_transactions (user_id, amount, type, related_id, description)
  values (p_user, v_amount, p_type, p_related, p_description);
  if p_notify and v_amount > 0 then
    perform public._notify(p_user, 'fees', null, null,
      jsonb_build_object('amount', v_amount, 'type', p_type, 'description', p_description));
  end if;
  return v_amount;
end;
$$;

-- Série quotidienne : un jour de suite de plus à chaque premier gain du jour.
-- À 7 jours, le bonus tombe et la série repart de zéro.
create or replace function public._daily_streak(p_user uuid)
returns table (streak int, bonus bigint)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row   public.user_fees%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_next  int;
  v_bonus bigint := 0;
begin
  insert into public.user_fees (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v_row from public.user_fees where user_id = p_user for update;
  if v_row.last_daily_streak = v_today then
    return query select v_row.current_streak, 0::bigint;
    return;
  end if;
  v_next := case when v_row.last_daily_streak = v_today - 1 then v_row.current_streak + 1 else 1 end;
  update public.user_fees
     set last_daily_streak = v_today,
         best_streak       = greatest(best_streak, v_next),
         current_streak    = case when v_next >= 7 then 0 else v_next end
   where user_id = p_user;
  if v_next >= 7 then
    v_bonus := public._fees_add(p_user, public._fees_config('daily_streak_7'), 'streak', null, 'Série quotidienne de 7 jours');
  end if;
  return query select v_next, v_bonus;
end;
$$;

-- Parrainage payé quand le filleul est vraiment actif : au moins 3 parties,
-- jouées sur 7 jours consécutifs. Au plus N parrainages payés par mois.
create or replace function public._process_referral(p_referee uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ref     public.referrals%rowtype;
  v_games   int;
  v_run     int;
  v_month   int;
  v_name    text;
  v_badge   uuid;
begin
  select * into v_ref from public.referrals where referee_id = p_referee and rewarded_at is null;
  if not found then
    return;
  end if;
  select count(*) into v_games from public.game_results where user_id = p_referee;
  if v_games < 3 then
    return;
  end if;
  -- Plus longue suite de jours consécutifs avec au moins une partie.
  select coalesce(max(n), 0) into v_run from (
    select count(*) as n from (
      select d, d - (row_number() over (order by d))::int as grp
      from (select distinct (created_at at time zone 'utc')::date as d from public.game_results where user_id = p_referee) days
    ) g group by grp
  ) runs;
  if v_run < 7 then
    return;
  end if;
  select count(*) into v_month from public.referrals
   where referrer_id = v_ref.referrer_id and rewarded_at >= date_trunc('month', now());
  if v_month >= public._fees_config('referral_monthly_cap') then
    return;
  end if;
  update public.referrals set rewarded_at = now() where referee_id = p_referee;
  select username into v_name from public.profiles where id = v_ref.referrer_id;
  perform public._fees_add(v_ref.referrer_id, public._fees_config('referral'), 'referral', p_referee::text,
    'Parrainage : ' || coalesce((select username from public.profiles where id = p_referee), 'un ami'));
  select id into v_badge from public.badges where sku = 'referred';
  if v_badge is not null then
    perform public._award_badge(p_referee, v_badge, 'Parrainé par ' || coalesce(v_name, '?'), null);
  end if;
end;
$$;

-- L'inscription enregistre le parrain passé dans les métadonnées (lien ?ref=).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted   text := nullif(new.raw_user_meta_data ->> 'username', '');
  v_fallback text := 'joueur_' || substr(replace(new.id::text, '-', ''), 1, 8);
  v_ref      text := nullif(new.raw_user_meta_data ->> 'ref', '');
  v_referrer uuid;
begin
  if v_wanted is null or v_wanted !~ '^[A-Za-z0-9_]{3,20}$' then
    v_wanted := v_fallback;
  end if;

  begin
    insert into public.profiles (id, username) values (new.id, v_wanted);
  exception
    when unique_violation then
      insert into public.profiles (id, username) values (new.id, v_fallback)
      on conflict (id) do nothing;
  end;

  if v_ref is not null then
    select id into v_referrer from public.profiles where lower(username) = lower(v_ref) and id <> new.id;
    if v_referrer is not null then
      insert into public.referrals (referee_id, referrer_id) values (new.id, v_referrer)
      on conflict (referee_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- Pour un compte créé sans le lien : déclarer son parrain dans les 7 jours.
create or replace function public.set_referrer(p_username text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := public._require_uid();
  v_referrer uuid;
begin
  if (select created_at from public.profiles where id = v_uid) < now() - interval '7 days' then
    raise exception 'Le parrainage se déclare dans les 7 jours qui suivent l''inscription.' using errcode = '22023';
  end if;
  select id into v_referrer from public.profiles where lower(username) = lower(btrim(p_username));
  if v_referrer is null or v_referrer = v_uid then
    raise exception 'Parrain introuvable.' using errcode = '22023';
  end if;
  insert into public.referrals (referee_id, referrer_id) values (v_uid, v_referrer);
exception
  when unique_violation then
    raise exception 'Tu as déjà un parrain.' using errcode = '23505';
end;
$$;

-- ===========================================================================
-- 6. Événements temporaires
-- ===========================================================================

create table if not exists public.events (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null check (char_length(btrim(name)) between 3 and 60),
  description     text        check (description is null or char_length(description) <= 500),
  game            text        references public.game_types (id) on delete set null,
  objective_type  text        not null check (objective_type in ('victories', 'games', 'global_target')),
  objective_value int         not null check (objective_value > 0),
  trophy_id       text        references public.achievements (id) on delete set null,
  trophy_rarity   text        not null default 'or' check (trophy_rarity in ('bronze', 'argent', 'or', 'platine', 'divin', 'og')),
  image_url       text,
  badge_id        uuid        references public.badges (id) on delete set null,
  start_date      timestamptz not null,
  end_date        timestamptz not null,
  is_active       boolean     not null default true,
  ended_early_at  timestamptz,
  created_by      uuid        references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  reward_fees     int         not null default 0 check (reward_fees >= 0),
  check (end_date > start_date)
);
create index if not exists events_window_idx on public.events (start_date, end_date);

create table if not exists public.event_participants (
  event_id        uuid        not null references public.events (id) on delete cascade,
  user_id         uuid        not null references public.profiles (id) on delete cascade,
  progress        int         not null default 0,
  completed_at    timestamptz,
  trophy_unlocked boolean     not null default false,
  joined_at       timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.events             enable row level security;
alter table public.event_participants enable row level security;
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (true);
drop policy if exists event_participants_read on public.event_participants;
create policy event_participants_read on public.event_participants for select to anon, authenticated using (true);

create or replace function public._event_live(e public.events)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$ select e.is_active and now() >= e.start_date and now() < e.end_date $$;

-- Objectif atteint : trophé limité, badge d'événement, FEES, notification.
create or replace function public._complete_event(p_event uuid, p_user uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.events%rowtype;
begin
  select * into e from public.events where id = p_event;
  update public.event_participants
     set completed_at = now(), trophy_unlocked = e.trophy_id is not null
   where event_id = p_event and user_id = p_user and completed_at is null;
  if not found then
    return;
  end if;
  if e.trophy_id is not null then
    insert into public.user_achievements as ua (user_id, achievement_id, progress, unlocked_at, updated_at)
    values (p_user, e.trophy_id, e.objective_value, now(), now())
    on conflict (user_id, achievement_id) do update
      set progress = excluded.progress, unlocked_at = coalesce(ua.unlocked_at, now()), updated_at = now();
  end if;
  if e.badge_id is not null then
    perform public._award_badge(p_user, e.badge_id, e.name, null);
  end if;
  perform public._fees_add(p_user, e.reward_fees, 'event', e.id::text, 'Événement : ' || e.name);
  perform public._notify(p_user, 'event_completed', null, null,
    jsonb_build_object('event_id', e.id, 'name', e.name, 'trophy_id', e.trophy_id, 'rarity', e.trophy_rarity, 'fees', e.reward_fees));
end;
$$;

-- Fait avancer les événements en cours après une partie enregistrée.
create or replace function public._advance_events(p_user uuid, p_game text, p_won boolean)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e       public.events%rowtype;
  v_step  int;
  v_prog  int;
  v_total bigint;
  v_done  jsonb := '[]'::jsonb;
  r       record;
begin
  for e in
    select * from public.events ev
    where public._event_live(ev) and (ev.game is null or ev.game = p_game)
  loop
    v_step := case e.objective_type when 'victories' then p_won::int else 1 end;
    insert into public.event_participants (event_id, user_id, progress)
    values (e.id, p_user, v_step)
    on conflict (event_id, user_id) do update set progress = public.event_participants.progress + v_step
    returning progress into v_prog;

    if e.objective_type = 'global_target' then
      select sum(progress) into v_total from public.event_participants where event_id = e.id;
      if v_total >= e.objective_value then
        for r in select user_id from public.event_participants where event_id = e.id and completed_at is null and progress > 0 loop
          perform public._complete_event(e.id, r.user_id);
        end loop;
        v_done := v_done || jsonb_build_object('event_id', e.id, 'name', e.name);
      end if;
    elsif v_prog >= e.objective_value
          and exists (select 1 from public.event_participants where event_id = e.id and user_id = p_user and completed_at is null) then
      perform public._complete_event(e.id, p_user);
      v_done := v_done || jsonb_build_object('event_id', e.id, 'name', e.name);
    end if;
  end loop;
  return v_done;
end;
$$;

-- Les événements visibles : en cours, et ceux qui démarrent bientôt.
create or replace function public.list_events(p_include_past boolean default false)
returns table (
  id uuid, name text, description text, game text, objective_type text, objective_value int,
  trophy_id text, trophy_rarity text, image_url text, start_date timestamptz, end_date timestamptz,
  status text, reward_fees int, participants bigint, completed bigint, global_progress bigint,
  my_progress int, my_completed boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.name, e.description, e.game, e.objective_type, e.objective_value,
         e.trophy_id, e.trophy_rarity, e.image_url, e.start_date, e.end_date,
         case when not e.is_active or now() >= e.end_date then 'ended'
              when now() < e.start_date then 'upcoming' else 'live' end,
         e.reward_fees,
         (select count(*) from public.event_participants p where p.event_id = e.id),
         (select count(*) from public.event_participants p where p.event_id = e.id and p.completed_at is not null),
         (select coalesce(sum(progress), 0) from public.event_participants p where p.event_id = e.id),
         (select p.progress from public.event_participants p where p.event_id = e.id and p.user_id = auth.uid()),
         (select p.completed_at is not null from public.event_participants p where p.event_id = e.id and p.user_id = auth.uid())
  from public.events e
  where p_include_past or (e.is_active and e.end_date > now() and e.start_date < now() + interval '7 days')
  order by e.start_date desc;
$$;

-- ===========================================================================
-- 7. Calcul des trophées
-- ===========================================================================

-- Somme ou maximum d'un compteur de partie, pour un jeu.
create or replace function public._detail_sum(p_user uuid, p_game text, p_key text)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum((details ->> p_key)::numeric), 0)::int from public.game_results
  where user_id = p_user and (p_game is null or game_type = p_game) and jsonb_typeof(details -> p_key) = 'number';
$$;

create or replace function public._detail_max(p_user uuid, p_game text, p_key text)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(max((details ->> p_key)::numeric), 0)::int from public.game_results
  where user_id = p_user and (p_game is null or game_type = p_game) and jsonb_typeof(details -> p_key) = 'number';
$$;

drop function if exists public._achievement_progress(uuid);

create or replace function public._achievement_progress(p_user uuid)
returns table (achievement_id text, progress int, extra jsonb)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_wins      int;
  v_games     int;
  v_friends   int := 0;
  v_best_pal  int := 0;
  v_p4_wins   int;
  v_bests     jsonb;
begin
  select count(*) filter (where won), count(*) into v_wins, v_games
  from public.game_results where user_id = p_user;

  select count(*) filter (where game_type in ('puissance4', 'puissance4-original') and won)
    into v_p4_wins from public.game_results where user_id = p_user;

  -- Les amis croisés en partie : les autres lignes des mêmes parties.
  select count(*), coalesce(max(n), 0) into v_friends, v_best_pal
  from (
    select o.user_id, count(distinct o.session_id) as n
    from public.game_results m
    join public.game_results o on o.session_id = m.session_id and o.user_id <> m.user_id
    join public.friendships f on f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(p_user, o.user_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(p_user, o.user_id)
    where m.user_id = p_user
    group by o.user_id
  ) pals;

  v_bests := jsonb_build_object(
    'CLEAN',  least(public._detail_max(p_user, 'verite', 'streak_clean'), 10),
    'NORMAL', least(public._detail_max(p_user, 'verite', 'streak_normal'), 10),
    'HARD',   least(public._detail_max(p_user, 'verite', 'streak_hard'), 10)
  );

  return query
  select b.id, b.p::int, b.x from (values
    ('first_win',       v_wins, '{}'::jsonb),
    ('warrior',         v_wins, '{}'::jsonb),
    ('champion',        v_wins, '{}'::jsonb),
    ('king',            v_wins, '{}'::jsonb),
    ('god',             v_wins, '{}'::jsonb),
    ('first_game',      v_games, '{}'::jsonb),
    ('regular',         v_games, '{}'::jsonb),
    ('veteran',         v_games, '{}'::jsonb),
    ('legend_1000',     v_games, '{}'::jsonb),
    ('flip7_first',     (select count(*)::int from public.game_results where user_id = p_user and game_type = 'flip7' and won), '{}'::jsonb),
    ('flip7_cardiac',   (select count(*)::int from public.game_results where user_id = p_user and game_type = 'flip7' and won), '{}'::jsonb),
    ('flip7_ace',       (select count(*)::int from public.game_results where user_id = p_user and game_type = 'flip7' and won), '{}'::jsonb),
    ('flip7_master',    (select count(*)::int from public.game_results where user_id = p_user and game_type = 'flip7' and won), '{}'::jsonb),
    ('flip7_zero',      public._detail_sum(p_user, 'flip7', 'zero_stays'), '{}'::jsonb),
    ('scopa_first',     (select count(*)::int from public.game_results where user_id = p_user and game_type = 'scopa' and won), '{}'::jsonb),
    ('scopa_legend',    (select count(*)::int from public.game_results where user_id = p_user and game_type = 'scopa' and won), '{}'::jsonb),
    ('scopa_master',    (select count(*)::int from public.game_results where user_id = p_user and game_type = 'scopa' and won), '{}'::jsonb),
    ('scopa_god',       (select count(*)::int from public.game_results where user_id = p_user and game_type = 'scopa' and won), '{}'::jsonb),
    ('scopa_scopeur',   public._detail_max(p_user, 'scopa', 'scopa_streak'), '{}'::jsonb),
    ('uno_first',       (select count(*)::int from public.game_results where user_id = p_user and game_type = 'uno' and won), '{}'::jsonb),
    ('uno_ace',         (select count(*)::int from public.game_results where user_id = p_user and game_type = 'uno' and won), '{}'::jsonb),
    ('uno_master',      (select count(*)::int from public.game_results where user_id = p_user and game_type = 'uno' and won), '{}'::jsonb),
    ('uno_fast',        public._best_streak(p_user, array['uno']), '{}'::jsonb),
    ('uno_strategist',  public._detail_sum(p_user, 'uno', 'special_cards'), '{}'::jsonb),
    ('p4_geometer',     v_p4_wins, '{}'::jsonb),
    ('p4_master',       v_p4_wins, '{}'::jsonb),
    ('p4_strategist',   public._best_streak(p_user, array['puissance4', 'puissance4-original']), '{}'::jsonb),
    ('p4_forge',        (select count(*)::int from public.game_results where user_id = p_user and game_type = 'puissance4' and won), '{}'::jsonb),
    ('p4_classic',      (select count(*)::int from public.game_results where user_id = p_user and game_type = 'puissance4-original' and won), '{}'::jsonb),
    ('verite_first',    (select count(*)::int from public.game_results where user_id = p_user and game_type = 'verite'), '{}'::jsonb),
    ('verite_honest',   public._detail_max(p_user, 'verite', 'answer_streak'), '{}'::jsonb),
    ('verite_valid20',  public._detail_sum(p_user, 'verite', 'valid_answers'), '{}'::jsonb),
    ('verite_valid100', public._detail_sum(p_user, 'verite', 'valid_answers'), '{}'::jsonb),
    ('verite_chef',     public._detail_sum(p_user, 'verite', 'chef_complete'), '{}'::jsonb),
    ('verite_hard10',   public._detail_max(p_user, 'verite', 'streak_hard'), v_bests),
    ('verite_author',   public._detail_sum(p_user, 'verite', 'custom_validated'), '{}'::jsonb),
    ('social_sociable', v_friends, '{}'::jsonb),
    ('social_star',     v_friends, '{}'::jsonb),
    ('social_best',     v_best_pal, '{}'::jsonb),
    ('social_groupie',  (select count(*)::int from public.group_members where user_id = p_user), '{}'::jsonb),
    ('social_founder',  (select count(*)::int from public.groups g where g.created_by = p_user
                           and (select count(*) from public.group_members gm where gm.group_id = g.id) > 5), '{}'::jsonb),
    ('gold_week',       public._topped_period(p_user, 'week')::int, '{}'::jsonb),
    ('fire_month',      public._topped_period(p_user, 'month')::int, '{}'::jsonb),
    ('streak',          public._best_streak(p_user, null), '{}'::jsonb),
    ('five_stars',      (select coalesce(max(n), 0)::int from (
                           select count(distinct game_type) as n from public.game_results
                           where user_id = p_user and won
                           group by date_trunc('day', created_at at time zone 'utc')) d), '{}'::jsonb),
    ('all_games',       (select count(distinct game_type)::int from public.game_results where user_id = p_user and won), '{}'::jsonb),
    ('shopper',         (select count(*)::int from public.user_shop_purchases where user_id = p_user), '{}'::jsonb),
    ('fees_1000',       (select coalesce(least(lifetime_earned, 1000000), 0)::int from public.user_fees where user_id = p_user), '{}'::jsonb),
    ('daily7',          (select coalesce(best_streak, 0) from public.user_fees where user_id = p_user), '{}'::jsonb)
  ) as b(id, p, x)
  union all
  -- Les trophées créés par un admin : victoires ou parties, sur un jeu ou tous.
  select a.id,
         (select count(*)::int from public.game_results g
           where g.user_id = p_user and (a.game is null or g.game_type = a.game)
             and (a.metric = 'games' or g.won)),
         '{}'::jsonb
  from public.achievements a
  where a.metric in ('wins', 'games') and a.active;
end;
$$;

-- Met à jour la progression et renvoie ce qui vient d'être débloqué. La
-- progression ne recule jamais. L'OG se compte en dernier : il dépend des autres.
create or replace function public._evaluate_achievements(p_user uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := '[]'::jsonb;
  r     record;
  v_p   int;
begin
  for r in
    select a.id, a.title, a.icon, a.tier, a.goal, coalesce(p.progress, 0) as progress, coalesce(p.extra, '{}'::jsonb) as extra
    from public.achievements a
    left join public._achievement_progress(p_user) p on p.achievement_id = a.id
    where a.active and a.metric in ('builtin', 'wins', 'games')
    order by (a.id = 'og_collector'), a.sort_order
  loop
    v_p := r.progress;
    if r.id = 'og_collector' then
      select count(*) into v_p from public.user_achievements
      where user_id = p_user and unlocked_at is not null and achievement_id <> 'og_collector';
    end if;

    insert into public.user_achievements as ua (user_id, achievement_id, progress, extra, unlocked_at, updated_at)
    values (p_user, r.id, least(v_p, r.goal), r.extra, case when v_p >= r.goal then now() end, now())
    on conflict (user_id, achievement_id) do update
      set progress    = greatest(ua.progress, excluded.progress),
          extra       = excluded.extra,
          unlocked_at = coalesce(ua.unlocked_at, excluded.unlocked_at),
          updated_at  = now()
      where ua.progress < excluded.progress or ua.extra is distinct from excluded.extra
         or (ua.unlocked_at is null and excluded.unlocked_at is not null);

    if v_p >= r.goal and exists (
      select 1 from public.user_achievements
      where user_id = p_user and achievement_id = r.id and unlocked_at >= now()
    ) then
      v_new := v_new || jsonb_build_object('id', r.id, 'title', r.title, 'icon', r.icon, 'tier', r.tier);
      perform public._notify(p_user, 'achievement', null, null,
        jsonb_build_object('achievement_id', r.id, 'title', r.title, 'icon', r.icon, 'tier', r.tier));
    end if;
  end loop;
  return v_new;
end;
$$;

create or replace function public.refresh_my_achievements()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._process_referral(v_uid);
  return public._evaluate_achievements(v_uid);
end;
$$;

-- ===========================================================================
-- 8. Enregistrer une partie : trophées, FEES, série, événements, parrainage
-- ===========================================================================
drop function if exists public.record_game_result(text, text, text, int, boolean, int, int, jsonb);

create or replace function public.record_game_result(
  p_session_key      text,
  p_game_type        text,
  p_room_code        text,
  p_player_count     int,
  p_won              boolean,
  p_score            int     default 0,
  p_duration_seconds int     default null,
  p_details          jsonb   default '{}'::jsonb
)
returns table (
  session_id   uuid,
  points       int,
  streak       int,
  streak_bonus boolean,
  already      boolean,
  unlocked     jsonb,
  fees         bigint,
  daily_streak int,
  events_done  jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := public._require_uid();
  v_game        public.game_types%rowtype;
  v_session     uuid;
  v_points      int  := 0;
  v_streak      int  := 0;
  v_bonus       boolean := false;
  v_winners     int;
  v_max_winners int;
  v_existing    public.game_results%rowtype;
  v_details     jsonb := '{}'::jsonb;
  v_key         text;
  v_fees        bigint := 0;
  v_daily       int := 0;
  v_paid_today  int;
  v_events      jsonb := '[]'::jsonb;
  r             record;
begin
  select * into v_game from public.game_types where id = p_game_type;
  if not found then
    raise exception 'Jeu inconnu : %', p_game_type using errcode = '22023';
  end if;

  if p_session_key is null or char_length(p_session_key) < 8 then
    raise exception 'Clé de session invalide.' using errcode = '22023';
  end if;

  p_player_count := least(greatest(coalesce(p_player_count, 2), 1), 8);

  -- Seuls les compteurs connus passent, en entiers bornés.
  foreach v_key in array array[
    'scopas', 'scopa_streak', 'special_cards', 'early_stays', 'zero_stays',
    'answered', 'valid_answers', 'answer_streak', 'streak_clean', 'streak_normal', 'streak_hard',
    'custom_validated', 'chef_complete'
  ] loop
    if jsonb_typeof(p_details -> v_key) = 'number' then
      v_details := v_details || jsonb_build_object(v_key, least(greatest((p_details ->> v_key)::numeric::int, 0), 200));
    end if;
  end loop;
  -- Le chef ne se déclare qu'à la Roulette, et une fois par partie.
  if p_game_type <> 'verite' then
    v_details := v_details - 'chef_complete';
  elsif (v_details ->> 'chef_complete')::int > 1 then
    v_details := v_details || '{"chef_complete":1}'::jsonb;
  end if;

  insert into public.game_sessions (session_key, game_type, room_code, player_count, duration_seconds)
  values (p_session_key, p_game_type, nullif(p_room_code, ''), p_player_count, nullif(p_duration_seconds, 0))
  on conflict (session_key) do nothing
  returning id into v_session;

  if v_session is null then
    select id into v_session from public.game_sessions where session_key = p_session_key;
  end if;

  select * into v_existing from public.game_results gr where gr.session_id = v_session and gr.user_id = v_uid;
  if found then
    return query select v_session, v_existing.points, 0, v_existing.streak_bonus, true, '[]'::jsonb, 0::bigint, 0, '[]'::jsonb;
    return;
  end if;

  if p_won then
    v_max_winners := greatest(1, p_player_count / 2);
    select count(*) into v_winners from public.game_results gr where gr.session_id = v_session and gr.won;
    if v_winners >= v_max_winners then
      raise exception 'Cette partie compte déjà tous ses vainqueurs.' using errcode = '23514';
    end if;

    v_points := v_game.win_points + v_game.per_extra_player_points * greatest(p_player_count - 2, 0);

    for r in
      select gr.won from public.game_results gr where gr.user_id = v_uid order by gr.seq desc limit 100
    loop
      exit when not r.won;
      v_streak := v_streak + 1;
    end loop;
    v_streak := v_streak + 1;

    if v_streak % 3 = 0 then
      v_points := v_points + 50;
      v_bonus  := true;
    end if;
  end if;

  insert into public.game_results (session_id, user_id, game_type, won, score, points, streak_bonus, details)
  values (v_session, v_uid, p_game_type, p_won, coalesce(p_score, 0), v_points, v_bonus, v_details);

  -- FEES de victoire, plafonnés par jour contre les victoires fabriquées.
  if p_won then
    select count(*) into v_paid_today from public.fees_transactions
     where user_id = v_uid and type = 'victory' and created_at >= date_trunc('day', now());
    if v_paid_today < public._fees_config('victory_daily_cap') then
      v_fees := v_fees + public._fees_add(v_uid, public._fees_config('victory_' || p_game_type), 'victory',
        v_session::text, 'Victoire : ' || v_game.label, false);
    end if;
    select s.streak, v_fees + s.bonus into v_daily, v_fees from public._daily_streak(v_uid) s;
  end if;

  -- Le chef d'une Roulette menée jusqu'au bout.
  if p_game_type = 'verite' and (v_details ->> 'chef_complete')::int = 1 then
    select count(*) into v_paid_today from public.fees_transactions
     where user_id = v_uid and type = 'chef' and created_at >= date_trunc('day', now());
    if v_paid_today < public._fees_config('chef_daily_cap') then
      v_fees := v_fees + public._fees_add(v_uid, public._fees_config('verite_chef_complete'), 'chef',
        v_session::text, 'Chef d''une Roulette de Vérité', false);
    end if;
  end if;

  v_events := public._advance_events(v_uid, p_game_type, p_won);
  perform public._process_referral(v_uid);

  return query select v_session, v_points, v_streak, v_bonus, false, public._evaluate_achievements(v_uid),
                      v_fees, v_daily, v_events;
end;
$$;

-- ===========================================================================
-- 9. Boutique
-- ===========================================================================

create or replace function public.shop_purchase(p_item_id uuid, p_custom_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := public._require_uid();
  v_item    public.shop_items%rowtype;
  v_fees    public.user_fees%rowtype;
  v_req     jsonb;
  v_custom  text;
  v_badge   uuid;
  v_rank    int;
begin
  select * into v_item from public.shop_items where id = p_item_id;
  if not found or not v_item.is_active then
    raise exception 'Cet objet n''est pas en vente.' using errcode = '22023';
  end if;
  if v_item.is_default then
    raise exception 'Cet objet est gratuit : il suffit de l''équiper.' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_shop_purchases where user_id = v_uid and item_id = p_item_id) then
    raise exception 'Tu possèdes déjà cet objet.' using errcode = '23505';
  end if;

  v_req := v_item.requirement;
  if v_req ? 'account_age_days'
     and (select created_at from public.profiles where id = v_uid) > now() - make_interval(days => (v_req ->> 'account_age_days')::int) then
    raise exception 'Réservé aux comptes de plus de % jours.', v_req ->> 'account_age_days' using errcode = '22023';
  end if;
  if v_req ? 'lifetime_earned'
     and coalesce((select lifetime_earned from public.user_fees where user_id = v_uid), 0) < (v_req ->> 'lifetime_earned')::bigint then
    raise exception 'Il faut avoir gagné % FEES au total.', v_req ->> 'lifetime_earned' using errcode = '22023';
  end if;
  if v_req ? 'leaderboard_top' then
    select r."position" into v_rank from public.get_leaderboard_rank('monthly', null, v_uid) r;
    if v_rank is null or v_rank > (v_req ->> 'leaderboard_top')::int then
      raise exception 'Réservé au top % du classement du mois.', v_req ->> 'leaderboard_top' using errcode = '22023';
    end if;
  end if;

  if v_item.payload ? 'custom' then
    v_custom := upper(btrim(coalesce(p_custom_text, '')));
    if v_custom !~ '^[A-Z0-9 !?]{1,5}$' then
      raise exception 'Ta plaque : 1 à 5 caractères (lettres, chiffres).' using errcode = '22023';
    end if;
  end if;

  insert into public.user_fees (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_fees from public.user_fees where user_id = v_uid for update;
  if v_fees.balance < v_item.price then
    raise exception 'Pas assez de FEES ! Tu en as %, il en faut %.', v_fees.balance, v_item.price using errcode = '22023';
  end if;

  perform public._fees_add(v_uid, -v_item.price, 'shop_purchase', v_item.id::text, 'Boutique : ' || v_item.name, false);

  -- Acheté, donc équipé : un seul objet équipé par catégorie.
  update public.user_shop_purchases set equipped = false
   where user_id = v_uid and item_id in (select id from public.shop_items where category = v_item.category);
  insert into public.user_shop_purchases (user_id, item_id, equipped, custom_text)
  values (v_uid, v_item.id, v_item.category <> 'badge', v_custom);

  if v_item.category = 'badge' then
    select id into v_badge from public.badges where sku = v_item.payload ->> 'badge_sku';
    if v_badge is not null then
      perform public._award_badge(v_uid, v_badge, null, null);
    end if;
  end if;

  perform public._evaluate_achievements(v_uid);

  return jsonb_build_object('balance', v_fees.balance - v_item.price, 'item_id', v_item.id);
end;
$$;

-- Équipe un objet possédé (ou gratuit). Sans objet : retour au défaut.
create or replace function public.shop_equip(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := public._require_uid();
  v_item public.shop_items%rowtype;
begin
  select * into v_item from public.shop_items where id = p_item_id;
  if not found or v_item.category = 'badge' then
    raise exception 'Objet inconnu.' using errcode = '22023';
  end if;
  if not v_item.is_default and not exists (select 1 from public.user_shop_purchases where user_id = v_uid and item_id = p_item_id) then
    raise exception 'Tu ne possèdes pas cet objet.' using errcode = '42501';
  end if;
  update public.user_shop_purchases set equipped = (item_id = p_item_id)
   where user_id = v_uid and item_id in (select id from public.shop_items where category = v_item.category);
end;
$$;

-- Mon porte-monnaie : solde, série, 20 dernières transactions.
create or replace function public.my_fees()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'balance',         coalesce(f.balance, 0),
    'lifetime_earned', coalesce(f.lifetime_earned, 0),
    'lifetime_spent',  coalesce(f.lifetime_spent, 0),
    'current_streak',  case when f.last_daily_streak >= (now() at time zone 'utc')::date - 1 then coalesce(f.current_streak, 0) else 0 end,
    'best_streak',     coalesce(f.best_streak, 0),
    'played_today',    coalesce(f.last_daily_streak = (now() at time zone 'utc')::date, false),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(t) - 'user_id' order by t.created_at desc)
      from (select * from public.fees_transactions where user_id = auth.uid() order by created_at desc limit 20) t
    ), '[]'::jsonb),
    'referrals', jsonb_build_object(
      'total',    (select count(*) from public.referrals where referrer_id = auth.uid()),
      'rewarded', (select count(*) from public.referrals where referrer_id = auth.uid() and rewarded_at is not null)
    )
  )
  from (select auth.uid() as uid) me
  left join public.user_fees f on f.user_id = me.uid;
$$;

create or replace function public.fees_leaderboard(p_limit int default 100)
returns table ("position" bigint, user_id uuid, username text, avatar text, balance bigint, lifetime_earned bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rank() over (order by f.balance desc), f.user_id, p.username, p.avatar, f.balance, f.lifetime_earned
  from public.user_fees f
  join public.profiles p on p.id = f.user_id
  where f.balance > 0 and not exists (select 1 from public.player_bans b where b.user_id = f.user_id)
  order by f.balance desc, p.username
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

-- ===========================================================================
-- 10. Cosmétiques : ce qu'on voit de chaque joueur
-- ===========================================================================

create or replace function public.profile_cosmetics(p_user_ids uuid[])
returns table (
  user_id uuid, border text, plate text, title text, site_skin text, card_skin text,
  victory_anim text, badges jsonb, banned boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id,
    coalesce(
      (select i.payload ->> 'border' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
        where p.user_id = u.id and p.equipped and i.category = 'profile_border' limit 1),
      (select coalesce(b.style ->> 'border', 'badge') from public.user_badges ub join public.badges b on b.id = ub.badge_id
        where ub.user_id = u.id and b.type = 'border' and b.is_active and (b.expiry_date is null or b.expiry_date > now())
        order by ub.awarded_at desc limit 1)
    ),
    coalesce(
      (select coalesce(p.custom_text, i.payload ->> 'plate') from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
        where p.user_id = u.id and p.equipped and i.category = 'nameplate' limit 1),
      (select b.name from public.user_badges ub join public.badges b on b.id = ub.badge_id
        where ub.user_id = u.id and b.type = 'plate' and b.is_active and (b.expiry_date is null or b.expiry_date > now())
        order by ub.awarded_at desc limit 1)
    ),
    (select coalesce(ub.note, b.name) from public.user_badges ub join public.badges b on b.id = ub.badge_id
      where ub.user_id = u.id and b.type = 'title' and b.is_active and (b.expiry_date is null or b.expiry_date > now())
      order by array_position(array['legendary','epic','rare','common'], b.rarity), ub.awarded_at desc limit 1),
    (select i.payload ->> 'skin' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'site_theme' limit 1),
    (select i.payload ->> 'skin' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'card_theme' limit 1),
    (select i.payload ->> 'anim' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'victory_animation' limit 1),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'description', b.description, 'type', b.type, 'rarity', b.rarity,
               'image_url', b.image_url, 'style', b.style, 'note', ub.note, 'awarded_at', ub.awarded_at,
               'expiry_date', b.expiry_date)
             order by array_position(array['legendary','epic','rare','common'], b.rarity), ub.awarded_at desc)
      from public.user_badges ub join public.badges b on b.id = ub.badge_id
      where ub.user_id = u.id and b.is_active and (b.expiry_date is null or b.expiry_date > now())
    ), '[]'::jsonb),
    exists (select 1 from public.player_bans pb where pb.user_id = u.id)
  from public.profiles u
  where u.id = any (p_user_ids[1:100]);
$$;

-- ===========================================================================
-- 11. Classements des trophées
-- ===========================================================================

create or replace function public.trophy_leaderboard(p_limit int default 10)
returns table ("position" bigint, user_id uuid, username text, avatar text, total bigint,
               divin bigint, og bigint, platine bigint, orr bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rank() over (order by count(*) desc,
                               count(*) filter (where a.tier = 'og') desc,
                               count(*) filter (where a.tier = 'divin') desc),
         p.id, p.username, p.avatar, count(*),
         count(*) filter (where a.tier = 'divin'), count(*) filter (where a.tier = 'og'),
         count(*) filter (where a.tier = 'platine'), count(*) filter (where a.tier = 'or')
  from public.user_achievements ua
  join public.achievements a on a.id = ua.achievement_id
  join public.profiles p on p.id = ua.user_id
  where ua.unlocked_at is not null
    and not exists (select 1 from public.player_bans b where b.user_id = p.id)
  group by p.id, p.username, p.avatar
  order by 1, p.username
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- La part des joueurs qui possèdent chaque trophée, du plus rare au plus courant.
create or replace function public.trophy_rarity()
returns table (id text, title text, tier text, icon text, category text, holders bigint, pct numeric, is_limited boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with players as (
    select greatest(count(*), 1) as n from public.profiles
  )
  select a.id, a.title, a.tier, a.icon, a.category,
         count(ua.user_id) filter (where ua.unlocked_at is not null),
         round(100.0 * count(ua.user_id) filter (where ua.unlocked_at is not null) / (select n from players), 2),
         a.is_limited
  from public.achievements a
  left join public.user_achievements ua on ua.achievement_id = a.id
  where a.active
  group by a.id
  order by 7 asc, array_position(array['og','divin','platine','or','argent','bronze'], a.tier), a.sort_order;
$$;

create or replace function public.recent_unlocks(p_days int default 7, p_limit int default 30)
returns table (user_id uuid, username text, avatar text, achievement_id text, title text, tier text, icon text, unlocked_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.avatar, a.id, a.title, a.tier, a.icon, ua.unlocked_at
  from public.user_achievements ua
  join public.achievements a on a.id = ua.achievement_id
  join public.profiles p on p.id = ua.user_id
  where ua.unlocked_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
  order by ua.unlocked_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- ===========================================================================
-- 12. Visites et statistiques
-- ===========================================================================

create table if not exists public.site_visits (
  day      date        not null,
  visitor  text        not null,
  user_id  uuid        references public.profiles (id) on delete set null,
  first_at timestamptz not null default now(),
  hits     int         not null default 1,
  primary key (day, visitor)
);
alter table public.site_visits enable row level security;

-- Une visite par navigateur et par jour. L'identifiant est tiré au hasard par
-- le navigateur : rien qui permette de suivre quelqu'un d'un site à l'autre.
create or replace function public.track_visit(p_visitor text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_visitor is null or p_visitor !~ '^[a-z0-9]{12,40}$' then
    return;
  end if;
  insert into public.site_visits (day, visitor, user_id)
  values ((now() at time zone 'utc')::date, p_visitor, auth.uid())
  on conflict (day, visitor) do update
    set hits = least(public.site_visits.hits + 1, 10000),
        user_id = coalesce(public.site_visits.user_id, excluded.user_id);
end;
$$;

-- Le tableau de bord : un seul appel, un seul objet.
create or replace function public.admin_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_week timestamptz := now() - interval '7 days';
  v_prev timestamptz := now() - interval '14 days';
begin
  perform public._require_admin();
  return jsonb_build_object(
    'visits_series', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day::date, 'visits', coalesce(v.n, 0), 'hits', coalesce(v.h, 0)) order by d.day)
      from generate_series((now() at time zone 'utc')::date - (v_days - 1), (now() at time zone 'utc')::date, interval '1 day') as d(day)
      left join (select day, count(*) as n, sum(hits) as h from public.site_visits group by day) v on v.day = d.day::date
    ), '[]'::jsonb),
    'visits_week',      (select count(*) from public.site_visits where day > (now() at time zone 'utc')::date - 7),
    'visits_prev_week', (select count(*) from public.site_visits where day > (now() at time zone 'utc')::date - 14
                                                               and day <= (now() at time zone 'utc')::date - 7),
    'active_players',   (select count(distinct user_id) from public.game_results where created_at > v_week),
    'games_week',       (select count(*) from public.game_sessions where ended_at > v_week),
    'games_prev_week',  (select count(*) from public.game_sessions where ended_at > v_prev and ended_at <= v_week),
    'win_rate',         (select round(100.0 * count(*) filter (where won) / nullif(count(*), 0), 1)
                           from public.game_results where created_at > v_week),
    'new_players',      (select count(*) from public.profiles where created_at > v_week),
    'total_players',    (select count(*) from public.profiles),
    'online_now',       (select count(*) from public.last_seen where seen_at > now() - interval '5 minutes'),
    'fees_in_circulation', (select coalesce(sum(balance), 0) from public.user_fees),
    'per_game', coalesce((
      select jsonb_agg(jsonb_build_object('game', gt.id, 'label', gt.label, 'games', coalesce(s.n, 0)) order by coalesce(s.n, 0) desc, gt.sort_order)
      from public.game_types gt
      left join (select game_type, count(*) as n from public.game_sessions where ended_at > v_week group by game_type) s
        on s.game_type = gt.id
    ), '[]'::jsonb),
    'pending_reports', (select count(*) from public.player_reports where status = 'pending')
  );
end;
$$;

-- Les joueurs, pour la modération : recherche, stats, e-mail, statut.
create or replace function public.admin_players(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  user_id uuid, username text, email text, avatar text, created_at timestamptz, games bigint, wins bigint,
  losses bigint, trophies bigint, balance bigint, banned boolean, ban_reason text, warnings bigint, last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.username, u.email::text, p.avatar, p.created_at,
         (select count(*) from public.game_results g where g.user_id = p.id),
         (select count(*) from public.game_results g where g.user_id = p.id and g.won),
         (select count(*) from public.game_results g where g.user_id = p.id and not g.won),
         (select count(*) from public.user_achievements ua where ua.user_id = p.id and ua.unlocked_at is not null),
         coalesce((select f.balance from public.user_fees f where f.user_id = p.id), 0),
         exists (select 1 from public.player_bans b where b.user_id = p.id),
         (select b.reason from public.player_bans b where b.user_id = p.id),
         (select count(*) from public.player_warnings w where w.user_id = p.id),
         (select ls.seen_at from public.last_seen ls where ls.user_id = p.id)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p_search is null or btrim(p_search) = ''
     or p.username ilike '%' || btrim(p_search) || '%' or u.email ilike '%' || btrim(p_search) || '%'
  order by (select count(*) from public.game_results g where g.user_id = p.id) desc, p.username
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ===========================================================================
-- 13. Actions d'admin
-- ===========================================================================

create or replace function public.admin_ban(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
begin
  if p_user_id = v_admin or exists (
    select 1 from auth.users u join public.admin_users a on lower(a.email) = lower(u.email) where u.id = p_user_id
  ) then
    raise exception 'On ne bannit pas un admin.' using errcode = '42501';
  end if;
  insert into public.player_bans (user_id, reason, banned_by) values (p_user_id, nullif(btrim(coalesce(p_reason, '')), ''), v_admin)
  on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, banned_at = now();
  -- Un banni quitte l'annuaire des tables.
  delete from public.game_rooms where host_id = p_user_id;
  delete from public.player_rooms where user_id = p_user_id;
  perform public._admin_log('ban', p_user_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_unban(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  delete from public.player_bans where user_id = p_user_id;
  perform public._admin_log('unban', p_user_id::text);
end;
$$;

create or replace function public.admin_warn(p_user_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
begin
  insert into public.player_warnings (user_id, admin_id, message) values (p_user_id, v_admin, btrim(p_message));
  perform public._notify(p_user_id, 'warning', null, null, jsonb_build_object('message', btrim(p_message)));
  perform public._admin_log('warn', p_user_id::text, jsonb_build_object('message', p_message));
end;
$$;

-- Remise à zéro des statistiques : parties, trophées, FEES gagnés en jeu.
create or replace function public.admin_reset_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  delete from public.game_results where user_id = p_user_id;
  delete from public.user_achievements where user_id = p_user_id;
  delete from public.event_participants where user_id = p_user_id;
  update public.user_fees set current_streak = 0, best_streak = 0, last_daily_streak = null where user_id = p_user_id;
  perform public._admin_log('reset_stats', p_user_id::text);
end;
$$;

create or replace function public.admin_list_reports(p_status text default 'pending')
returns table (
  id bigint, created_at timestamptz, reporter text, reported_id uuid, reported text, reason text,
  details text, status text, resolution text, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select r.id, r.created_at, rp.username, r.reported_id, dp.username, r.reason, r.details, r.status, r.resolution, r.resolved_at
  from public.player_reports r
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles dp on dp.id = r.reported_id
  where p_status is null or r.status = p_status
  order by r.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_resolve_report(p_id bigint, p_status text, p_resolution text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
begin
  if p_status not in ('resolved', 'dismissed', 'pending') then
    raise exception 'Statut inconnu.' using errcode = '22023';
  end if;
  update public.player_reports
     set status = p_status, resolution = nullif(btrim(coalesce(p_resolution, '')), ''),
         resolved_by = case when p_status = 'pending' then null else v_admin end,
         resolved_at = case when p_status = 'pending' then null else now() end
   where id = p_id;
  perform public._admin_log('report_' || p_status, p_id::text, jsonb_build_object('resolution', p_resolution));
end;
$$;

-- Les questions de la Roulette signalées (0005).
create or replace function public.admin_list_flagged_questions()
returns table (id uuid, content text, theme text, author text, report_count int, hidden boolean, used_count int, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if to_regclass('public.truth_questions') is null then
    return;
  end if;
  return query execute
    'select q.id, q.content, q.theme, p.username, q.report_count, q.hidden, q.used_count, q.created_at
       from public.truth_questions q left join public.profiles p on p.id = q.creator_id
      where q.report_count > 0 or q.hidden
      order by q.hidden, q.report_count desc, q.created_at desc limit 200';
end;
$$;

create or replace function public.admin_moderate_question(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if p_action = 'hide' then
    execute 'update public.truth_questions set hidden = true where id = $1' using p_id;
  elsif p_action = 'restore' then
    execute 'update public.truth_questions set hidden = false, report_count = 0 where id = $1' using p_id;
    execute 'delete from public.truth_question_reports where question_id = $1' using p_id;
  elsif p_action = 'delete' then
    execute 'delete from public.truth_questions where id = $1' using p_id;
  else
    raise exception 'Action inconnue.' using errcode = '22023';
  end if;
  perform public._admin_log('question_' || p_action, p_id::text);
end;
$$;

-- --- Trophées ----------------------------------------------------------------

create or replace function public.admin_upsert_trophy(
  p_id text, p_title text, p_description text, p_category text, p_tier text, p_goal int,
  p_metric text, p_game text, p_icon text default 'Award', p_image_url text default null, p_active boolean default true
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := nullif(btrim(coalesce(p_id, '')), '');
  v_builtin boolean;
begin
  perform public._require_admin();
  if v_id is null then
    v_id := 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  end if;
  select metric = 'builtin' into v_builtin from public.achievements where id = v_id;
  if coalesce(v_builtin, false) then
    -- Un trophée maison garde son calcul : seuls ses textes, sa rareté, son
    -- seuil et son image se modifient.
    update public.achievements
       set title = btrim(p_title), description = btrim(p_description), tier = p_tier,
           goal = greatest(p_goal, 1), icon = coalesce(nullif(p_icon, ''), icon),
           image_url = p_image_url, active = coalesce(p_active, true)
     where id = v_id;
  else
    if p_metric not in ('wins', 'games', 'manual') then
      raise exception 'Objectif inconnu.' using errcode = '22023';
    end if;
    insert into public.achievements (id, title, description, category, icon, tier, goal, sort_order, metric, game, image_url, active)
    values (v_id, btrim(p_title), btrim(p_description), coalesce(nullif(p_category, ''), 'special'),
            coalesce(nullif(p_icon, ''), 'Award'), p_tier, greatest(p_goal, 1), 500, p_metric, nullif(p_game, ''),
            p_image_url, coalesce(p_active, true))
    on conflict (id) do update
      set title = excluded.title, description = excluded.description, category = excluded.category,
          icon = excluded.icon, tier = excluded.tier, goal = excluded.goal, metric = excluded.metric,
          game = excluded.game, image_url = excluded.image_url, active = excluded.active;
  end if;
  perform public._admin_log('upsert_trophy', v_id, jsonb_build_object('title', p_title, 'tier', p_tier));
  return v_id;
end;
$$;

create or replace function public.admin_delete_trophy(p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if exists (select 1 from public.achievements where id = p_id and metric = 'builtin') then
    -- Les trophées maison ne se suppriment pas (leur calcul vit ici) : on les masque.
    update public.achievements set active = false where id = p_id;
  else
    delete from public.achievements where id = p_id;
  end if;
  perform public._admin_log('delete_trophy', p_id);
end;
$$;

-- Décerner à la main un trophée « manuel » (ou n'importe lequel).
create or replace function public.admin_award_trophy(p_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.achievements%rowtype;
begin
  perform public._require_admin();
  select * into a from public.achievements where id = p_id;
  if not found then
    raise exception 'Trophée inconnu.' using errcode = '22023';
  end if;
  insert into public.user_achievements as ua (user_id, achievement_id, progress, unlocked_at, updated_at)
  values (p_user_id, a.id, a.goal, now(), now())
  on conflict (user_id, achievement_id) do update set progress = a.goal, unlocked_at = coalesce(ua.unlocked_at, now()), updated_at = now();
  perform public._notify(p_user_id, 'achievement', null, null,
    jsonb_build_object('achievement_id', a.id, 'title', a.title, 'icon', a.icon, 'tier', a.tier));
  perform public._admin_log('award_trophy', p_id, jsonb_build_object('user_id', p_user_id));
end;
$$;

-- --- Badges ----------------------------------------------------------------

create or replace function public.admin_upsert_badge(
  p_id uuid, p_name text, p_description text, p_type text, p_rarity text,
  p_image_url text default null, p_style jsonb default '{}'::jsonb, p_expiry timestamptz default null, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
  v_id uuid := p_id;
begin
  if v_id is null then
    insert into public.badges (name, description, type, rarity, image_url, style, expiry_date, is_active, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_type, p_rarity, p_image_url,
            coalesce(p_style, '{}'::jsonb), p_expiry, coalesce(p_active, true), v_admin)
    returning id into v_id;
  else
    update public.badges
       set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), type = p_type,
           rarity = p_rarity, image_url = p_image_url, style = coalesce(p_style, '{}'::jsonb),
           expiry_date = p_expiry, is_active = coalesce(p_active, true)
     where id = v_id;
  end if;
  perform public._admin_log('upsert_badge', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end;
$$;

create or replace function public.admin_delete_badge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  delete from public.badges where id = p_id;
  perform public._admin_log('delete_badge', p_id::text);
end;
$$;

create or replace function public.admin_award_badge(p_badge_id uuid, p_username text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
  v_user  uuid;
begin
  select id into v_user from public.profiles where lower(username) = lower(btrim(p_username));
  if v_user is null then
    raise exception 'Joueur introuvable.' using errcode = '22023';
  end if;
  if not public._award_badge(v_user, p_badge_id, nullif(btrim(coalesce(p_note, '')), ''), v_admin) then
    raise exception 'Ce joueur a déjà ce badge.' using errcode = '23505';
  end if;
  perform public._admin_log('award_badge', p_badge_id::text, jsonb_build_object('user', p_username));
end;
$$;

create or replace function public.admin_revoke_badge(p_badge_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  delete from public.user_badges where badge_id = p_badge_id and user_id = p_user_id;
  perform public._admin_log('revoke_badge', p_badge_id::text, jsonb_build_object('user_id', p_user_id));
end;
$$;

-- --- Événements --------------------------------------------------------------

create or replace function public.admin_upsert_event(
  p_id uuid, p_name text, p_description text, p_game text, p_objective_type text, p_objective_value int,
  p_trophy_rarity text, p_start timestamptz, p_end timestamptz, p_reward_fees int default 0,
  p_image_url text default null, p_trophy_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  uuid := public._require_admin();
  v_id     uuid := p_id;
  v_trophy text;
  v_badge  uuid;
  v_desc   text;
begin
  if p_end <= p_start then
    raise exception 'La fin doit suivre le début.' using errcode = '22023';
  end if;
  v_desc := coalesce(nullif(btrim(coalesce(p_trophy_description, '')), ''),
    case p_objective_type
      when 'victories' then 'Gagner ' || p_objective_value || ' parties pendant l''événement « ' || btrim(p_name) || ' ».'
      when 'games' then 'Jouer ' || p_objective_value || ' parties pendant l''événement « ' || btrim(p_name) || ' ».'
      else 'Avoir participé à l''objectif commun de l''événement « ' || btrim(p_name) || ' ».'
    end);

  if v_id is null then
    insert into public.events (name, description, game, objective_type, objective_value, trophy_rarity,
                               image_url, start_date, end_date, reward_fees, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), nullif(p_game, ''), p_objective_type,
            p_objective_value, p_trophy_rarity, p_image_url, p_start, p_end, greatest(coalesce(p_reward_fees, 0), 0), v_admin)
    returning id into v_id;
    v_trophy := 'event_' || substr(replace(v_id::text, '-', ''), 1, 12);
    insert into public.achievements (id, title, description, category, icon, tier, goal, sort_order, metric,
                                     game, image_url, event_id, is_limited)
    values (v_trophy, btrim(p_name), v_desc, 'evenement', 'PartyPopper', p_trophy_rarity, p_objective_value, 900,
            'event', nullif(p_game, ''), p_image_url, v_id, true);
    insert into public.badges (name, description, type, rarity, image_url, style, expiry_date, created_by)
    values (left(btrim(p_name), 40), 'Participant de l''événement « ' || btrim(p_name) || ' ».', 'temporal', 'epic',
            p_image_url, '{"icon":"PartyPopper","color":"#ff00ff"}', p_end + interval '14 days', v_admin)
    returning id into v_badge;
    update public.events set trophy_id = v_trophy, badge_id = v_badge where id = v_id;
    perform public._admin_log('create_event', v_id::text, jsonb_build_object('name', p_name));
  else
    update public.events
       set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), game = nullif(p_game, ''),
           objective_type = p_objective_type, objective_value = p_objective_value, trophy_rarity = p_trophy_rarity,
           image_url = p_image_url, start_date = p_start, end_date = p_end,
           reward_fees = greatest(coalesce(p_reward_fees, 0), 0)
     where id = v_id
     returning trophy_id, badge_id into v_trophy, v_badge;
    update public.achievements
       set title = btrim(p_name), description = v_desc, tier = p_trophy_rarity, goal = p_objective_value,
           game = nullif(p_game, ''), image_url = p_image_url
     where id = v_trophy;
    update public.badges set expiry_date = p_end + interval '14 days', image_url = p_image_url where id = v_badge;
    perform public._admin_log('update_event', v_id::text, jsonb_build_object('name', p_name));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_end_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  update public.events set end_date = least(end_date, now()), ended_early_at = now() where id = p_id and end_date > now();
  perform public._admin_log('end_event', p_id::text);
end;
$$;

create or replace function public.admin_delete_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.events%rowtype;
begin
  perform public._require_admin();
  select * into e from public.events where id = p_id;
  delete from public.events where id = p_id;
  -- Le trophée n'a de sens qu'avec son événement ; ceux qui l'ont gagné le perdent.
  delete from public.achievements where id = e.trophy_id;
  delete from public.badges where id = e.badge_id;
  perform public._admin_log('delete_event', p_id::text, jsonb_build_object('name', e.name));
end;
$$;

create or replace function public.admin_event_participants(p_id uuid)
returns table (user_id uuid, username text, avatar text, progress int, completed_at timestamptz, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.username, p.avatar, ep.progress, ep.completed_at, ep.joined_at
  from public.event_participants ep join public.profiles p on p.id = ep.user_id
  where ep.event_id = p_id
  order by ep.completed_at nulls last, ep.progress desc, p.username;
end;
$$;

-- --- FEES ----------------------------------------------------------------------

create or replace function public.admin_grant_fees(p_username text, p_amount bigint, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_done bigint;
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;
  select id into v_user from public.profiles where lower(username) = lower(btrim(p_username));
  if v_user is null then
    raise exception 'Joueur introuvable.' using errcode = '22023';
  end if;
  v_done := public._fees_add(v_user, p_amount, case when p_amount > 0 then 'admin_grant' else 'admin_revoke' end,
    auth.uid()::text, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), case when p_amount > 0 then 'Cadeau de l''admin' else 'Retrait par l''admin' end));
  perform public._admin_log(case when p_amount > 0 then 'grant_fees' else 'revoke_fees' end, v_user::text,
    jsonb_build_object('amount', v_done, 'reason', p_reason));
  return v_done;
end;
$$;

create or replace function public.admin_set_fees_config(p_action text, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  update public.fees_price_config set amount = greatest(p_amount, 0), updated_by = auth.uid(), updated_at = now()
   where action = p_action;
  if not found then
    raise exception 'Réglage inconnu.' using errcode = '22023';
  end if;
  perform public._admin_log('fees_config', p_action, jsonb_build_object('amount', p_amount));
end;
$$;

create or replace function public.admin_upsert_shop_item(
  p_id uuid, p_name text, p_description text, p_category text, p_price bigint,
  p_icon_url text default null, p_payload jsonb default '{}'::jsonb, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
begin
  perform public._require_admin();
  if v_id is null then
    insert into public.shop_items (name, description, category, price, icon_url, payload, is_active, sort_order)
    values (btrim(p_name), p_description, p_category, greatest(p_price, 0), p_icon_url, coalesce(p_payload, '{}'::jsonb),
            coalesce(p_active, true), 100)
    returning id into v_id;
  else
    update public.shop_items
       set name = btrim(p_name), description = p_description, price = greatest(p_price, 0), icon_url = p_icon_url,
           is_active = coalesce(p_active, true), updated_at = now(),
           -- Les objets fournis gardent leur effet ; un objet créé ici peut le changer.
           payload = case when sku is null then coalesce(p_payload, payload) else payload end,
           category = case when sku is null then p_category else category end
     where id = v_id;
  end if;
  perform public._admin_log('upsert_shop_item', v_id::text, jsonb_build_object('name', p_name, 'price', p_price));
  return v_id;
end;
$$;

create or replace function public.admin_list_transactions(p_type text default null, p_username text default null, p_limit int default 100)
returns table (id bigint, created_at timestamptz, username text, amount bigint, type text, description text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select t.id, t.created_at, p.username, t.amount, t.type, t.description
  from public.fees_transactions t join public.profiles p on p.id = t.user_id
  where (p_type is null or p_type = '' or t.type = p_type)
    and (p_username is null or p_username = '' or p.username ilike '%' || btrim(p_username) || '%')
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.admin_recent_logs(p_limit int default 50)
returns table (id bigint, created_at timestamptz, admin text, action text, target_id text, details jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select l.id, l.created_at, p.username, l.action, l.target_id, l.details
  from public.admin_logs l left join public.profiles p on p.id = l.admin_id
  order by l.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ===========================================================================
-- 14. Images : un dossier public, écrit par les admins seulement
-- ===========================================================================
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('plafee-assets', 'plafee-assets', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                  allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists plafee_assets_admin_insert on storage.objects';
  execute $p$create policy plafee_assets_admin_insert on storage.objects
    for insert to authenticated with check (bucket_id = 'plafee-assets' and public.is_admin())$p$;
  execute 'drop policy if exists plafee_assets_admin_update on storage.objects';
  execute $p$create policy plafee_assets_admin_update on storage.objects
    for update to authenticated using (bucket_id = 'plafee-assets' and public.is_admin())$p$;
  execute 'drop policy if exists plafee_assets_admin_delete on storage.objects';
  execute $p$create policy plafee_assets_admin_delete on storage.objects
    for delete to authenticated using (bucket_id = 'plafee-assets' and public.is_admin())$p$;
  execute 'drop policy if exists plafee_assets_read on storage.objects';
  execute $p$create policy plafee_assets_read on storage.objects
    for select to anon, authenticated using (bucket_id = 'plafee-assets')$p$;
end;
$$;

-- ===========================================================================
-- 15. Droits d'exécution
-- ===========================================================================
do $$
declare
  f text;
begin
  -- Internes : personne ne les appelle directement.
  foreach f in array array[
    'public._require_admin()', 'public._admin_log(text, text, jsonb)',
    'public._award_badge(uuid, uuid, text, uuid)', 'public._fees_config(text)',
    'public._fees_add(uuid, bigint, text, text, text, boolean)', 'public._daily_streak(uuid)',
    'public._process_referral(uuid)', 'public._event_live(public.events)',
    'public._complete_event(uuid, uuid)', 'public._advance_events(uuid, text, boolean)',
    'public._detail_sum(uuid, text, text)', 'public._detail_max(uuid, text, text)',
    'public._achievement_progress(uuid)', 'public._evaluate_achievements(uuid)', 'public.handle_new_user()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  -- Joueurs connectés.
  foreach f in array array[
    'public.report_player(uuid, text, text)', 'public.my_standing()', 'public.refresh_my_achievements()',
    'public.record_game_result(text, text, text, int, boolean, int, int, jsonb)',
    'public.shop_purchase(uuid, text)', 'public.shop_equip(uuid)', 'public.my_fees()', 'public.set_referrer(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Admins (la fonction vérifie elle-même) : connectés seulement.
  foreach f in array array[
    'public.admin_stats(int)', 'public.admin_players(text, int, int)', 'public.admin_ban(uuid, text)',
    'public.admin_unban(uuid)', 'public.admin_warn(uuid, text)', 'public.admin_reset_stats(uuid)',
    'public.admin_list_reports(text)', 'public.admin_resolve_report(bigint, text, text)',
    'public.admin_list_flagged_questions()', 'public.admin_moderate_question(uuid, text)',
    'public.admin_upsert_trophy(text, text, text, text, text, int, text, text, text, text, boolean)',
    'public.admin_delete_trophy(text)', 'public.admin_award_trophy(text, uuid)',
    'public.admin_upsert_badge(uuid, text, text, text, text, text, jsonb, timestamptz, boolean)',
    'public.admin_delete_badge(uuid)', 'public.admin_award_badge(uuid, text, text)', 'public.admin_revoke_badge(uuid, uuid)',
    'public.admin_upsert_event(uuid, text, text, text, text, int, text, timestamptz, timestamptz, int, text, text)',
    'public.admin_end_event(uuid)', 'public.admin_delete_event(uuid)', 'public.admin_event_participants(uuid)',
    'public.admin_grant_fees(text, bigint, text)', 'public.admin_set_fees_config(text, bigint)',
    'public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean)',
    'public.admin_list_transactions(text, text, int)', 'public.admin_recent_logs(int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Publics : lectures agrégées et visites.
  foreach f in array array[
    'public.is_admin()', 'public.list_events(boolean)', 'public.fees_leaderboard(int)',
    'public.profile_cosmetics(uuid[])', 'public.trophy_leaderboard(int)', 'public.trophy_rarity()',
    'public.recent_unlocks(int, int)', 'public.track_visit(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end;
$$;
