-- ===========================================================================
-- 0015 — Le Président : le septième jeu de la salle.
--
-- Ce que la base doit savoir du jeu, et rien de plus — la partie elle-même
-- reste en P2P, chez l'hôte :
--   - le jeu au catalogue (`game_types`), pour publier une table, inviter,
--     compter les parties et payer les victoires ;
--   - le gain en FEES d'une victoire (`victory_president`) ;
--   - les sept trophées de la catégorie `president`, et `all_games` qui passe
--     à sept jeux ;
--   - les compteurs de partie propres au jeu (carrés, plis coupés au 2,
--     séries de Président, remontées du trou au trône), ajoutés à la liste de
--     ceux que `record_game_result` accepte : sans ça, il les jetterait en
--     silence et les trophées ne bougeraient jamais.
--
-- Les compteurs viennent du client, bornés, comme ceux des autres jeux : le
-- moteur les tient à l'identique chez tous les pairs, mais un client modifié
-- peut les gonfler. Les trophées de victoire, eux, passent par la
-- confirmation des adversaires (0014).
--
-- Rejouable sans risque, à appliquer après 0014. À rejouer aussi après toute
-- réexécution d'une migration plus ancienne qui redéfinit
-- `_achievement_progress` ou `record_game_result` (0004, 0006, 0014) : elle
-- remettrait leur version d'avant le Président, et ses trophées cesseraient
-- d'avancer. Ils ne disparaissent plus, en revanche : la purge de 0006 nomme
-- désormais les trophées retirés au lieu de garder une liste des conservés,
-- qui ignorait ceux de 0015 et les effaçait, déblocages compris.
-- ===========================================================================

-- ===========================================================================
-- 1. Le jeu au catalogue
-- ===========================================================================
-- Même barème qu'UNO (120), plus 10 points par joueur au-delà du duel comme
-- Flip 7 : `_confirm_claim` (0014) paie `win_points + per_extra_player_points
-- × (joueurs - 2)`. Le Président se jouant à 3 au moins, une victoire vaut
-- donc 130 points à 3 et 170 à 7 — sortir premier d'une table pleine est plus
-- dur que d'une table de trois.
insert into public.game_types (id, label, win_points, per_extra_player_points, sort_order) values
  ('president', 'Président', 120, 10, 7)
on conflict (id) do update
  set label                   = excluded.label,
      win_points              = excluded.win_points,
      per_extra_player_points = excluded.per_extra_player_points,
      sort_order              = excluded.sort_order;

-- Le gain d'une victoire, comme UNO. Le montant n'est écrit qu'à la création :
-- un réglage fait depuis /admin > FEES survit au rejeu de ce fichier.
insert into public.fees_price_config (action, label, amount) values
  ('victory_president', 'Victoire Président', 55)
on conflict (action) do update set label = excluded.label;

-- ===========================================================================
-- 2. Les trophées
-- ===========================================================================
alter table public.achievements drop constraint if exists achievements_category_check;
alter table public.achievements add constraint achievements_category_check
  check (category in ('victoires', 'flip7', 'scopa', 'uno', 'puissance4', 'verite', 'president',
                      'social', 'defis', 'evenement', 'special'));

-- Rangés entre la Roulette de Vérité (130-142) et la Sociabilité (150-158).
-- Les icônes sont des noms lucide que le site sait dessiner
-- (src/features/achievements/icons.ts).
insert into public.achievements (id, title, description, category, icon, tier, goal, sort_order, metric, game) values
  ('president_first',     'Premier mandat',   'Gagner une partie de Président.',                                          'president', 'Crown',    'bronze',  1,  143, 'builtin', 'president'),
  ('president_twos',      'Coupe-feu',        'Au Président, fermer 50 plis avec un 2.',                                  'president', 'Scissors', 'bronze',  50, 144, 'builtin', 'president'),
  ('president_quad',      'Carré magique',    'Au Président, poser 10 carrés.',                                           'president', 'Grid2x2',  'argent',  10, 145, 'builtin', 'president'),
  ('president_reelected', 'Réélu',            'Finir Président 3 manches d''affilée dans une même partie.',               'president', 'Vote',     'argent',  3,  146, 'builtin', 'president'),
  ('president_comeback',  'Du trou au trône', 'Passer de Trou du cul à Président d''une manche à l''autre.',              'president', 'Rocket',   'or',      1,  147, 'builtin', 'president'),
  ('president_ace',       'Chef d''État',     'Gagner 20 parties de Président.',                                          'president', 'Landmark', 'or',      20, 148, 'builtin', 'president'),
  ('president_master',    'Président à vie',  'Gagner 50 parties de Président.',                                          'president', 'Infinity', 'platine', 50, 149, 'builtin', 'president')
on conflict (id) do update
  set title = excluded.title, description = excluded.description, category = excluded.category,
      icon = excluded.icon, tier = excluded.tier, goal = excluded.goal, sort_order = excluded.sort_order,
      metric = excluded.metric, game = excluded.game;

-- Touche-à-tout : une victoire à chacun des sept jeux. Ceux qui l'avaient
-- débloqué à six jeux le gardent (`unlocked_at` ne recule jamais) ; les
-- autres voient l'objectif monter d'un cran.
update public.achievements
   set goal = 7, description = 'Gagner au moins une partie à chacun des 7 jeux.'
 where id = 'all_games';

-- ===========================================================================
-- 3. Le calcul des trophées
-- ===========================================================================
-- Redéfinie en entier à partir de 0006 (dernière version : aucune migration
-- depuis n'y a touché), avec les lignes `president_*` en plus. Le reste est
-- inchangé ; `all_games` compte déjà les jeux distincts gagnés, le Président
-- y entre de lui-même.
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
  v_pres_wins int;
  v_bests     jsonb;
begin
  select count(*) filter (where won), count(*) into v_wins, v_games
  from public.game_results where user_id = p_user;

  select count(*) filter (where game_type in ('puissance4', 'puissance4-original') and won),
         count(*) filter (where game_type = 'president' and won)
    into v_p4_wins, v_pres_wins
    from public.game_results where user_id = p_user;

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
    -- Président : les victoires confirmées, puis les compteurs de partie.
    -- La série de Président se lit partie par partie (`detail_max`) : le
    -- trophée parle de trois manches d'affilée dans une même partie.
    ('president_first',     v_pres_wins, '{}'::jsonb),
    ('president_ace',       v_pres_wins, '{}'::jsonb),
    ('president_master',    v_pres_wins, '{}'::jsonb),
    ('president_twos',      public._detail_sum(p_user, 'president', 'twos'), '{}'::jsonb),
    ('president_quad',      public._detail_sum(p_user, 'president', 'quads'), '{}'::jsonb),
    ('president_reelected', public._detail_max(p_user, 'president', 'president_streak'), '{}'::jsonb),
    ('president_comeback',  public._detail_sum(p_user, 'president', 'rags_to_riches'), '{}'::jsonb),
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

-- ===========================================================================
-- 4. Enregistrer une partie : les compteurs du Président
-- ===========================================================================
-- Redéfinie en entier à partir de 0014 : seule la liste des compteurs
-- acceptés change (`quads`, `twos`, `president_streak`, `rags_to_riches`).
-- Même signature, donc pas de `drop` : les droits restent en place, et sont
-- réaffirmés plus bas.
create or replace function public.record_game_result(
  p_session_key      text,
  p_game_type        text,
  p_room_code        text,
  p_player_count     int,
  p_won              boolean,
  p_score            int     default 0,
  p_duration_seconds int     default null,
  p_details          jsonb   default '{}'::jsonb,
  -- Les comptes gagnants, tels que ce joueur les a vus. Nul : un client
  -- d'avant 0014, qui ne parle que de lui.
  p_winners          uuid[]  default null,
  -- Roulette de Vérité : le chef, quand la partie a été menée au bout.
  p_chef             uuid    default null,
  p_vs_bots          boolean default false
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
  events_done  jsonb,
  status       text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := public._require_uid();
  v_game        public.game_types%rowtype;
  v_session     uuid;
  v_existing    public.game_results%rowtype;
  v_details     jsonb := '{}'::jsonb;
  v_key         text;
  v_winners     uuid[];
  v_claim       text;
  v_chef_claim  boolean := false;
  v_status      text;
  v_settled     jsonb;
begin
  select * into v_game from public.game_types where id = p_game_type;
  if not found then
    raise exception 'Jeu inconnu : %', p_game_type using errcode = '22023';
  end if;

  if p_session_key is null or char_length(p_session_key) < 8 then
    raise exception 'Clé de session invalide.' using errcode = '22023';
  end if;

  p_player_count := least(greatest(coalesce(p_player_count, 2), 1), 8);

  -- Seuls les compteurs connus passent, en entiers bornés. Le plafond de 200
  -- couvre large au Président : sept manches de treize carrés au plus.
  foreach v_key in array array[
    'scopas', 'scopa_streak', 'special_cards', 'early_stays', 'zero_stays',
    'answered', 'valid_answers', 'answer_streak', 'streak_clean', 'streak_normal', 'streak_hard',
    'custom_validated', 'chef_complete',
    'quads', 'twos', 'president_streak', 'rags_to_riches'
  ] loop
    if jsonb_typeof(p_details -> v_key) = 'number' then
      v_details := v_details || jsonb_build_object(v_key, least(greatest((p_details ->> v_key)::numeric::int, 0), 200));
    end if;
  end loop;
  -- Le chef ne se déclare plus dans les compteurs : il se réclame, et les
  -- joueurs le confirment. Le compteur n'est posé qu'une fois confirmé.
  v_chef_claim := p_game_type = 'verite' and coalesce((v_details ->> 'chef_complete')::int, 0) >= 1 and not p_vs_bots;
  v_details := v_details - 'chef_complete';

  if p_winners is not null then
    v_winners := array(select distinct w from unnest(p_winners) w where w is not null limit 8);
    p_won := v_uid = any (v_winners);
  end if;

  insert into public.game_sessions (session_key, game_type, room_code, player_count, duration_seconds)
  values (p_session_key, p_game_type, nullif(p_room_code, ''), p_player_count, nullif(p_duration_seconds, 0))
  on conflict (session_key) do nothing
  returning id into v_session;

  if v_session is null then
    select gs.id into v_session from public.game_sessions gs where gs.session_key = p_session_key;
  end if;

  -- Les joueurs d'une même partie se suivent ici un par un : sans ce verrou,
  -- deux descriptions arrivées ensemble ne se verraient pas l'une l'autre, et
  -- personne ne réglerait la partie.
  perform 1 from public.game_sessions gs where gs.id = v_session for update;

  select * into v_existing from public.game_results gr where gr.session_id = v_session and gr.user_id = v_uid;
  if found then
    return query select v_session, v_existing.points, 0, v_existing.streak_bonus, true, '[]'::jsonb, 0::bigint, 0,
                        '[]'::jsonb, v_existing.status;
    return;
  end if;

  -- Plus de plafond de vainqueurs par partie : ce sont les voix qui tranchent.
  -- L'ancien refus (« Cette partie compte déjà tous ses vainqueurs ») laissait
  -- un menteur arrivé le premier empêcher le vrai gagnant d'enregistrer.
  v_claim := case when p_won then 'win' when v_chef_claim then 'chef' end;

  v_status := case when p_vs_bots then 'bots' when v_claim is not null then 'pending' else 'confirmed' end;

  insert into public.game_results (session_id, user_id, game_type, won, score, points, streak_bonus, details,
                                   claim, status, verified)
  values (v_session, v_uid, p_game_type, false, coalesce(p_score, 0), 0, false, v_details,
          v_claim, v_status, false);

  -- Une partie contre des bots ne se décrit à personne : il n'y a personne.
  if not p_vs_bots then
    insert into public.game_reports (session_id, user_id, winners, chef)
    values (v_session, v_uid, v_winners, case when p_game_type = 'verite' then p_chef end);
  end if;

  v_settled := public._settle_session(v_session, v_uid);
  select gr.status into v_status from public.game_results gr where gr.session_id = v_session and gr.user_id = v_uid;

  return query select v_session,
                      coalesce((v_settled ->> 'points')::int, 0),
                      coalesce((v_settled ->> 'streak')::int, 0),
                      coalesce((v_settled ->> 'bonus')::boolean, false),
                      false,
                      public._evaluate_achievements(v_uid),
                      coalesce((v_settled ->> 'fees')::bigint, 0),
                      coalesce((v_settled ->> 'daily_streak')::int, 0),
                      coalesce(v_settled -> 'events', '[]'::jsonb),
                      v_status;
end;
$$;

-- ===========================================================================
-- 5. Droits d'exécution
-- ===========================================================================
-- Les mêmes qu'en 0006 et 0014 : le calcul des trophées est interne, seul
-- l'enregistrement d'une partie s'ouvre aux joueurs connectés.
revoke all on function public._achievement_progress(uuid) from public, anon, authenticated;
revoke all on function public.record_game_result(text, text, text, int, boolean, int, int, jsonb, uuid[], uuid, boolean)
  from public, anon;
grant execute on function public.record_game_result(text, text, text, int, boolean, int, int, jsonb, uuid[], uuid, boolean)
  to authenticated;
