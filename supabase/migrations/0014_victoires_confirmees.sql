-- ===========================================================================
-- 0014 — Des victoires confirmées par les adversaires.
--
-- Jusqu'ici, chaque joueur déclarait seul « j'ai gagné » et la base le
-- croyait : une ligne tapée dans la console suffisait à s'offrir points,
-- trophées et FEES. Désormais :
--
--   - chaque joueur décrit la partie entière (`p_winners` : les comptes
--     gagnants, `p_chef` : le chef d'une Roulette menée au bout) ;
--   - une victoire déclarée reste « en attente » tant qu'un adversaire (un
--     compte qui n'est pas lui-même gagnant) n'a pas décrit le même gagnant ;
--   - à la majorité : le gagnant et ceux qui le confirment contre ceux qui
--     le démentent, avec au moins une confirmation. À égalité (un contre un),
--     la victoire est « contestée » et part dans l'onglet Rapports de
--     l'admin ; démentie par la majorité, elle est refusée d'office ;
--   - une partie ne compte pour les événements et le parrainage que si au
--     moins deux comptes l'ont décrite ;
--   - les parties contre des bots se jouent dans un seul navigateur : elles
--     restent dans les statistiques, sans victoire comptée, ni points, ni
--     FEES, ni trophées de victoire ;
--   - les points de classement suivent le plafond des FEES : 30 victoires
--     payées par jour, et 5 au plus confirmées par le même adversaire.
--
-- Ce qui reste possible : deux comptes complices qui se confirment l'un
-- l'autre. Le plafond par adversaire le borne, et l'admin voit les
-- contestations à répétition.
--
-- Rejouable sans risque. Les lignes déjà en base gardent leur valeur
-- (statut « confirmed ») : rien de ce qui a été gagné n'est repris.
-- ===========================================================================

-- ===========================================================================
-- 1. Ce qu'une ligne de résultat réclame, et où elle en est
-- ===========================================================================
-- `won` et `points` gardent leur sens : une victoire *acquise*. Une victoire
-- en attente a `won = false` et `points = 0`, si bien que les classements,
-- les statistiques et les trophées, qui lisent ces deux colonnes, ne voient
-- que ce qui a été confirmé — sans qu'il faille les réécrire.
alter table public.game_results
  add column if not exists claim        text,
  add column if not exists status       text        not null default 'confirmed',
  add column if not exists verified     boolean     not null default true,
  add column if not exists paid         boolean     not null default false,
  add column if not exists confirmers   uuid[]      not null default '{}',
  add column if not exists confirmed_at timestamptz;

alter table public.game_results drop constraint if exists game_results_claim_check;
alter table public.game_results add constraint game_results_claim_check
  check (claim is null or claim in ('win', 'chef'));
alter table public.game_results drop constraint if exists game_results_status_check;
alter table public.game_results add constraint game_results_status_check
  check (status in ('confirmed', 'pending', 'contested', 'rejected', 'bots'));

-- Les plafonds du jour se comptent sur cet index.
create index if not exists game_results_paid_idx
  on public.game_results (user_id, confirmed_at desc) where paid;
create index if not exists game_results_open_claims_idx
  on public.game_results (session_id) where status in ('pending', 'contested');

-- ===========================================================================
-- 2. Ce que chaque joueur a vu de la partie
-- ===========================================================================
-- Une ligne par compte et par partie. `winners` nul : un client d'avant cette
-- migration, qui ne décrit que lui-même — il ne confirme ni ne dément rien.
create table if not exists public.game_reports (
  session_id uuid        not null references public.game_sessions (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id)      on delete cascade,
  winners    uuid[],
  chef       uuid,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
-- Aucune policy : personne ne lit ni n'écrit cette table en direct.
alter table public.game_reports enable row level security;

-- Qui a démenti quelle victoire : l'admin y lit les mauvais perdants.
create table if not exists public.claim_disputes (
  result_id  uuid        not null references public.game_results (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (result_id, user_id)
);
alter table public.claim_disputes enable row level security;

insert into public.fees_price_config (action, label, amount) values
  ('victory_pair_daily_cap', 'Victoires payées par jour contre un même adversaire', 5)
on conflict (action) do update set label = excluded.label;

-- ===========================================================================
-- 3. Les défaites ne comptent que les parties tranchées
-- ===========================================================================
-- Une victoire en attente, ou contre des bots, n'est pas une défaite.
create or replace view public.profile_stats
with (security_invoker = on) as
select
  p.id                                 as user_id,
  p.username,
  p.avatar,
  p.created_at,
  count(r.id)                          as games_played,
  count(r.id) filter (where r.won)     as wins,
  count(r.id) filter (where not r.won and r.status = 'confirmed') as losses,
  coalesce(sum(r.points), 0)::bigint   as points,
  (
    select r2.game_type
    from public.game_results r2
    where r2.user_id = p.id
    group by r2.game_type
    order by count(*) desc, r2.game_type
    limit 1
  )                                    as favorite_game
from public.profiles p
left join public.game_results r on r.user_id = p.id
group by p.id, p.username, p.avatar, p.created_at;

-- Les séries ne lisent que les parties tranchées entre comptes : une victoire
-- en attente n'interrompt pas une série, une partie contre des bots non plus.
create or replace function public._best_streak(p_user uuid, p_games text[] default null)
returns int
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_best int := 0;
  v_cur  int := 0;
  r      record;
begin
  for r in
    select won from public.game_results
    where user_id = p_user and (p_games is null or game_type = any (p_games)) and status = 'confirmed'
    order by seq
  loop
    if r.won then
      v_cur := v_cur + 1;
      v_best := greatest(v_best, v_cur);
    else
      v_cur := 0;
    end if;
  end loop;
  return v_best;
end;
$$;

-- ===========================================================================
-- 4. Événements et parrainage : les parties vérifiées seulement
-- ===========================================================================
-- Deux temps, au lieu d'un : « une partie jouée » quand un second compte l'a
-- décrite, « une victoire » quand elle est confirmée. Chaque temps ne fait
-- avancer que les objectifs qui le concernent.
create or replace function public._advance_events_kind(p_user uuid, p_game text, p_kind text)
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
      and (p_kind = 'game' or ev.objective_type = 'victories')
  loop
    -- Une partie jouée inscrit le joueur aux objectifs de victoires, sans les
    -- faire avancer : c'est ce que faisait une défaite avant.
    v_step := case when e.objective_type = 'victories' then (p_kind = 'victory')::int else 1 end;
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
  -- Des parties jouées contre d'autres comptes : seules celles-là prouvent un
  -- filleul actif.
  select count(*) into v_games from public.game_results where user_id = p_referee and verified;
  if v_games < 3 then
    return;
  end if;
  -- Plus longue suite de jours consécutifs avec au moins une partie.
  select coalesce(max(n), 0) into v_run from (
    select count(*) as n from (
      select d, d - (row_number() over (order by d))::int as grp
      from (select distinct (created_at at time zone 'utc')::date as d from public.game_results
            where user_id = p_referee and verified) days
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

-- ===========================================================================
-- 5. Accorder une victoire (ou une Roulette menée par son chef)
-- ===========================================================================
-- Appelée par le règlement d'une partie, ou par l'admin qui tranche une
-- contestation (`p_admin`, qui lève le plafond par adversaire : l'admin a
-- regardé). `p_caller` est le joueur dont l'appel déclenche le règlement :
-- quand ce n'est pas le gagnant, celui-ci l'apprend par une notification, et
-- ses trophées sont recalculés ici — sinon c'est record_game_result qui le fait,
-- une seule fois par transaction.
create or replace function public._confirm_claim(
  p_result uuid, p_confirmers uuid[], p_caller uuid, p_admin uuid default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r         public.game_results%rowtype;
  v_game    public.game_types%rowtype;
  v_players int;
  v_today   timestamptz := date_trunc('day', now());
  v_paid    boolean := false;
  v_points  int := 0;
  v_streak  int := 0;
  v_bonus   boolean := false;
  v_fees    bigint := 0;
  v_daily   int := 0;
  v_events  jsonb := '[]'::jsonb;
  v_remote  boolean;
  g         record;
begin
  select * into r from public.game_results where id = p_result for update;
  if not found or r.status not in ('pending', 'contested') then
    return null;
  end if;
  v_remote := p_caller is distinct from r.user_id;
  select * into v_game from public.game_types where id = r.game_type;

  if r.claim = 'chef' then
    v_paid := (select count(*) from public.game_results
                where user_id = r.user_id and claim = 'chef' and paid and confirmed_at >= v_today)
              < public._fees_config('chef_daily_cap');
    update public.game_results
       set status = 'confirmed', confirmed_at = now(), confirmers = coalesce(p_confirmers, '{}'), paid = v_paid,
           details = details || '{"chef_complete":1}'::jsonb
     where id = r.id;
    if v_paid then
      v_fees := public._fees_add(r.user_id, public._fees_config('verite_chef_complete'), 'chef', r.session_id::text,
        'Chef d''une Roulette de Vérité', v_remote);
    end if;
  else
    -- Le plafond du jour, puis celui par adversaire : il faut au moins un
    -- confirmateur qui n'a pas déjà offert 5 victoires aujourd'hui.
    v_paid := (select count(*) from public.game_results
                where user_id = r.user_id and claim = 'win' and paid and confirmed_at >= v_today)
              < public._fees_config('victory_daily_cap');
    if v_paid and p_admin is null then
      v_paid := exists (
        select 1 from unnest(p_confirmers) c
        where (select count(*) from public.game_results g2
                where g2.user_id = r.user_id and g2.claim = 'win' and g2.paid
                  and g2.confirmed_at >= v_today and c = any (g2.confirmers))
              < public._fees_config('victory_pair_daily_cap')
      );
    end if;

    -- La série : les parties tranchées qui précèdent celle-ci.
    for g in
      select gr.won from public.game_results gr
      where gr.user_id = r.user_id and gr.seq < r.seq and gr.status = 'confirmed'
      order by gr.seq desc limit 100
    loop
      exit when not g.won;
      v_streak := v_streak + 1;
    end loop;
    v_streak := v_streak + 1;

    if v_paid then
      select player_count into v_players from public.game_sessions where id = r.session_id;
      v_points := v_game.win_points + v_game.per_extra_player_points * greatest(coalesce(v_players, 2) - 2, 0);
      if v_streak % 3 = 0 then
        v_points := v_points + 50;
        v_bonus  := true;
      end if;
    end if;

    update public.game_results
       set won = true, status = 'confirmed', confirmed_at = now(), confirmers = coalesce(p_confirmers, '{}'),
           paid = v_paid, points = v_points, streak_bonus = v_bonus
     where id = r.id;

    if v_paid then
      v_fees := public._fees_add(r.user_id, public._fees_config('victory_' || r.game_type), 'victory',
        r.session_id::text, case when v_remote then 'Victoire confirmée : ' else 'Victoire : ' end || v_game.label, v_remote);
    end if;
    select s.streak, v_fees + s.bonus into v_daily, v_fees from public._daily_streak(r.user_id) s;
    v_events := public._advance_events_kind(r.user_id, r.game_type, 'victory');
  end if;

  -- Le gagnant n'était pas là quand c'est arrivé : son écran de fin passe à
  -- « confirmée » et son solde se rafraîchit. La notification ne s'affiche que
  -- s'il n'y a pas de FEES — sinon celle des FEES le dit déjà.
  if v_remote then
    perform public._notify(r.user_id, 'victory_confirmed', null, null,
      jsonb_build_object('session_id', r.session_id, 'game_type', r.game_type, 'claim', r.claim,
                         'paid', v_paid, 'points', v_points, 'fees', v_fees),
      v_fees > 0);
    perform public._evaluate_achievements(r.user_id);
  end if;

  return jsonb_build_object('points', v_points, 'streak', v_streak, 'bonus', v_bonus, 'fees', v_fees,
                            'daily_streak', v_daily, 'events', v_events, 'paid', v_paid);
end;
$$;

-- ===========================================================================
-- 6. Régler une partie
-- ===========================================================================
-- Rejouée à chaque description reçue : le dernier arrivé tranche. Renvoie ce
-- qui revient à `p_caller` (sa victoire confirmée, les événements avancés).
-- L'appelant tient déjà le verrou de la partie.
create or replace function public._settle_session(p_session uuid, p_caller uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_conf   uuid[];
  v_deny   uuid[];
  v_res    jsonb;
  v_mine   jsonb := null;
  v_events jsonb := '[]'::jsonb;
  v_ev     jsonb;
begin
  -- Une partie jouée : dès que deux comptes l'ont décrite.
  if (select count(*) from public.game_reports where session_id = p_session) >= 2 then
    for r in
      update public.game_results set verified = true
       where session_id = p_session and not verified and status <> 'bots'
      returning user_id, game_type
    loop
      v_ev := public._advance_events_kind(r.user_id, r.game_type, 'game');
      if r.user_id = p_caller then
        v_events := v_events || v_ev;
      end if;
      perform public._process_referral(r.user_id);
    end loop;
  end if;

  for r in
    select gr.id, gr.user_id, gr.game_type, gr.claim, gr.status from public.game_results gr
    where gr.session_id = p_session and gr.status in ('pending', 'contested')
  loop
    if r.claim = 'chef' then
      select coalesce(array_agg(rep.user_id) filter (where rep.chef = r.user_id), '{}'),
             coalesce(array_agg(rep.user_id) filter (where rep.chef is distinct from r.user_id), '{}')
        into v_conf, v_deny
        from public.game_reports rep
       where rep.session_id = p_session and rep.user_id <> r.user_id and rep.winners is not null;
    else
      -- Confirme : un compte qui n'est pas lui-même gagnant et qui nomme ce
      -- gagnant. Dément : un compte qui ne le nomme pas.
      select coalesce(array_agg(rep.user_id) filter (where r.user_id = any (rep.winners) and not rep.user_id = any (rep.winners)), '{}'),
             coalesce(array_agg(rep.user_id) filter (where not r.user_id = any (rep.winners)), '{}')
        into v_conf, v_deny
        from public.game_reports rep
       where rep.session_id = p_session and rep.user_id <> r.user_id and rep.winners is not null;
    end if;

    -- Les voix : celle du gagnant et de ceux qui le confirment, contre celles
    -- qui le démentent. À trois, un menteur ne pèse pas plus que le gagnant et
    -- un témoin honnête ; à deux, un contre un, c'est l'admin qui tranche.
    if cardinality(v_conf) >= 1 and 1 + cardinality(v_conf) > cardinality(v_deny) then
      v_res := public._confirm_claim(r.id, v_conf, p_caller);
      if r.user_id = p_caller then
        v_mine := v_res;
      end if;
    elsif cardinality(v_deny) >= 1 then
      insert into public.claim_disputes (result_id, user_id)
      select r.id, d from unnest(v_deny) d
      on conflict do nothing;
      if cardinality(v_deny) > 1 + cardinality(v_conf) then
        -- La majorité de la table dit le contraire : refusée sans attendre.
        update public.game_results set status = 'rejected' where id = r.id;
        perform public._notify(r.user_id, 'victory_rejected', null, null,
          jsonb_build_object('session_id', p_session, 'game_type', r.game_type, 'claim', r.claim));
      elsif r.status = 'pending' then
        update public.game_results set status = 'contested' where id = r.id;
        perform public._notify(r.user_id, 'victory_contested', null, null,
          jsonb_build_object('session_id', p_session, 'game_type', r.game_type, 'claim', r.claim));
      end if;
    end if;
  end loop;

  if v_mine is not null then
    v_events := v_events || coalesce(v_mine -> 'events', '[]'::jsonb);
  end if;
  return coalesce(v_mine, '{}'::jsonb) || jsonb_build_object('events', v_events);
end;
$$;

-- ===========================================================================
-- 7. Enregistrer une partie
-- ===========================================================================
drop function if exists public.record_game_result(text, text, text, int, boolean, int, int, jsonb);
drop function if exists public.record_game_result(text, text, text, int, boolean, int, int, jsonb, uuid[], uuid, boolean);

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

-- L'ancienne version, remplacée par _advance_events_kind.
drop function if exists public._advance_events(uuid, text, boolean);

-- ===========================================================================
-- 8. L'admin tranche les contestations
-- ===========================================================================
create or replace function public.admin_list_disputes(p_status text default 'contested')
returns table (
  result_id   uuid,
  created_at  timestamptz,
  game_type   text,
  game_label  text,
  room_code   text,
  claim       text,
  status      text,
  claimant_id uuid,
  claimant    text,
  -- Les autres comptes de la partie : ce qu'ils ont dit, et combien de
  -- victoires chacun a déjà démenties (tous temps confondus).
  reporters   jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select gr.id, gr.created_at, gr.game_type, gt.label, gs.room_code, gr.claim, gr.status, gr.user_id, cp.username,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'user_id', rep.user_id,
                    'username', rp.username,
                    'agrees', case when gr.claim = 'chef' then rep.chef = gr.user_id
                                   else gr.user_id = any (rep.winners) end,
                    'disputes', (select count(*) from public.claim_disputes cd where cd.user_id = rep.user_id))
                  order by rp.username)
           from public.game_reports rep
           left join public.profiles rp on rp.id = rep.user_id
           where rep.session_id = gr.session_id and rep.user_id <> gr.user_id and rep.winners is not null
         ), '[]'::jsonb)
  from public.game_results gr
  join public.game_sessions gs on gs.id = gr.session_id
  join public.game_types gt on gt.id = gr.game_type
  left join public.profiles cp on cp.id = gr.user_id
  where gr.claim is not null and (p_status is null or gr.status = p_status)
    and (p_status is not null or gr.status in ('contested', 'rejected') or exists (select 1 from public.claim_disputes cd where cd.result_id = gr.id))
  order by gr.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_resolve_dispute(p_result uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public._require_admin();
  r       public.game_results%rowtype;
begin
  select * into r from public.game_results where id = p_result;
  if not found or r.status not in ('pending', 'contested') then
    raise exception 'Cette victoire n''attend plus de décision.' using errcode = '22023';
  end if;
  perform 1 from public.game_sessions where id = r.session_id for update;

  if p_accept then
    perform public._confirm_claim(r.id, (
      select coalesce(array_agg(rep.user_id), '{}') from public.game_reports rep
      where rep.session_id = r.session_id and rep.user_id <> r.user_id
        and (case when r.claim = 'chef' then rep.chef = r.user_id else r.user_id = any (rep.winners) end)
    ), v_admin, v_admin);
  else
    update public.game_results set status = 'rejected' where id = r.id;
    perform public._notify(r.user_id, 'victory_rejected', null, null,
      jsonb_build_object('session_id', r.session_id, 'game_type', r.game_type, 'claim', r.claim,
                         'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;
  perform public._admin_log(case when p_accept then 'dispute_accept' else 'dispute_reject' end, r.id::text,
    jsonb_build_object('user_id', r.user_id, 'game_type', r.game_type, 'claim', r.claim, 'reason', p_reason));
end;
$$;

-- ===========================================================================
-- 9. Droits d'exécution
-- ===========================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._advance_events_kind(uuid, text, text)', 'public._process_referral(uuid)',
    'public._best_streak(uuid, text[])', 'public._confirm_claim(uuid, uuid[], uuid, uuid)',
    'public._settle_session(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.record_game_result(text, text, text, int, boolean, int, int, jsonb, uuid[], uuid, boolean)',
    'public.admin_list_disputes(text)', 'public.admin_resolve_dispute(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
