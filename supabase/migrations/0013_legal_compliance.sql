-- ===========================================================================
-- 0013 — Mise en conformité : CGU, suppression de compte, sanctions motivées,
-- mesure d'audience anonyme, durées de conservation.
--
-- Les durées inscrites ici sont celles de /confidentialite : changer l'une
-- sans l'autre rendrait la politique mensongère.
-- ===========================================================================

-- ===========================================================================
-- 1. Acceptation des CGU
-- ===========================================================================
-- Hors de `profiles`, que tout le monde peut lire : qui a accepté quoi et
-- quand ne regarde que le joueur.
create table if not exists public.terms_acceptances (
  user_id     uuid        primary key references public.profiles (id) on delete cascade,
  version     text        not null,
  accepted_at timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;
drop policy if exists terms_acceptances_read_self on public.terms_acceptances;
create policy terms_acceptances_read_self on public.terms_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

-- Version en vigueur des CGU et de la politique. Le client porte la même
-- constante (src/features/legal/legal.ts) ; elle n'est vérifiée qu'ici.
create or replace function public._terms_version()
returns text
language sql
immutable
as $$ select '2026-10-28' $$;

-- Pour un compte créé avant les CGU, ou après leur changement.
create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Connecte-toi d''abord.' using errcode = '42501';
  end if;
  if p_version is distinct from public._terms_version() then
    raise exception 'Ces CGU ne sont plus à jour : recharge la page.' using errcode = '22023';
  end if;
  insert into public.terms_acceptances (user_id, version) values (v_uid, p_version)
  on conflict (user_id) do update set version = excluded.version, accepted_at = now();
end;
$$;

-- ===========================================================================
-- 2. Trace minimale des bans
-- ===========================================================================
-- Seule chose gardée d'un compte banni qui se supprime : l'empreinte SHA-256
-- de son e-mail, le motif et la date, trois ans. Assez pour refuser la même
-- adresse à l'inscription, rien qui permette de la relire.
create table if not exists public.banned_email_hashes (
  email_hash text        primary key,
  reason     text,
  banned_at  timestamptz not null,
  expires_at timestamptz not null
);
alter table public.banned_email_hashes enable row level security;
-- Aucune policy : lue par le trigger d'inscription seulement.

create or replace function public._email_hash(p_email text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$ select encode(digest(lower(btrim(p_email)), 'sha256'), 'hex') $$;

-- ===========================================================================
-- 3. Inscription : CGU enregistrées, ban retrouvé
-- ===========================================================================
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
  v_terms    text := nullif(new.raw_user_meta_data ->> 'terms_version', '');
  v_referrer uuid;
  v_banned   public.banned_email_hashes%rowtype;
begin
  -- Ce trigger sert aussi l'autre application du projet (mêmes comptes) :
  -- refuser l'inscription ici la casserait. Sans CGU acceptées, le compte
  -- existe mais le site bloque tout jusqu'à l'acceptation (LegalGate).
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

  if v_terms = public._terms_version() then
    insert into public.terms_acceptances (user_id, version) values (new.id, v_terms)
    on conflict (user_id) do nothing;
  end if;

  -- Un banni qui s'est supprimé puis réinscrit avec la même adresse retrouve
  -- son ban, et pas de parrainage à la clé.
  select * into v_banned from public.banned_email_hashes
  where email_hash = public._email_hash(new.email) and expires_at > now();
  if found then
    insert into public.player_bans (user_id, reason, banned_at)
    values (new.id, coalesce(v_banned.reason, 'Ban précédent toujours en cours'), v_banned.banned_at)
    on conflict (user_id) do nothing;
    return new;
  end if;

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

-- ===========================================================================
-- 4. Suppression de compte
-- ===========================================================================
-- Tout ce qui appartient au joueur part avec `profiles` (on delete cascade).
-- Trois choses n'y partiraient pas d'elles-mêmes, ou mal :
--   * un groupe qu'il a créé serait supprimé pour tous ses membres ;
--   * ses messages de groupe resteraient, sans auteur ;
--   * un banni pourrait se réinscrire aussitôt avec la même adresse.
-- Les fichiers d'avatar, eux, sont effacés par le client via l'API Storage
-- avant cet appel : Supabase interdit de les supprimer en SQL.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Pas _require_uid() : elle refuse les bannis, qui ont aussi le droit de partir.
  v_uid   uuid := auth.uid();
  v_email text;
  v_ban   public.player_bans%rowtype;
  v_group record;
  v_heir  uuid;
  v_other_app boolean := false;
begin
  if v_uid is null then
    raise exception 'Connecte-toi d''abord.' using errcode = '42501';
  end if;
  if public.is_admin() then
    raise exception 'Un compte admin ne se supprime pas depuis le site.' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_ban from public.player_bans where user_id = v_uid;
  if found and v_email is not null then
    insert into public.banned_email_hashes (email_hash, reason, banned_at, expires_at)
    values (public._email_hash(v_email), v_ban.reason, v_ban.banned_at, v_ban.banned_at + interval '3 years')
    on conflict (email_hash) do update
      set reason = excluded.reason, banned_at = excluded.banned_at, expires_at = excluded.expires_at;
  end if;

  -- Le groupe passe au plus ancien admin, à défaut au plus ancien membre.
  -- Un groupe dont il est le seul membre part avec lui.
  for v_group in select id from public.groups where created_by = v_uid loop
    select user_id into v_heir from public.group_members
    where group_id = v_group.id and user_id <> v_uid
    order by (role = 'admin') desc, joined_at
    limit 1;
    if v_heir is not null then
      update public.groups set created_by = v_heir, updated_at = now() where id = v_group.id;
      update public.group_members set role = 'admin' where group_id = v_group.id and user_id = v_heir;
    end if;
  end loop;

  update public.group_messages
     set content = null, deleted_at = now()
   where sender_id = v_uid and deleted_at is null;

  -- Le même compte de connexion peut servir à une autre application du
  -- projet (tables `adresses`, `commandes`). On n'efface alors que PLAFEE.
  if to_regclass('public.adresses') is not null then
    execute 'select exists (select 1 from public.adresses where user_id = $1)' into v_other_app using v_uid;
  end if;
  if not v_other_app and to_regclass('public.commandes') is not null then
    execute 'select exists (select 1 from public.commandes where user_id = $1)' into v_other_app using v_uid;
  end if;

  if v_other_app then
    delete from public.profiles where id = v_uid;
  else
    delete from auth.users where id = v_uid;
  end if;
end;
$$;

-- ===========================================================================
-- 5. Sanctions : motif obligatoire, joueur toujours prévenu
-- ===========================================================================
create or replace function public._require_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Indique un motif : il est montré au joueur.' using errcode = '22023';
  end if;
  return left(btrim(p_reason), 500);
end;
$$;

create or replace function public.admin_ban(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  uuid := public._require_admin();
  v_reason text := public._require_reason(p_reason);
begin
  if p_user_id = v_admin or exists (
    select 1 from auth.users u join public.admin_users a on lower(a.email) = lower(u.email) where u.id = p_user_id
  ) then
    raise exception 'On ne bannit pas un admin.' using errcode = '42501';
  end if;
  insert into public.player_bans (user_id, reason, banned_by) values (p_user_id, v_reason, v_admin)
  on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, banned_at = now();
  -- Un banni quitte l'annuaire des tables.
  delete from public.game_rooms where host_id = p_user_id;
  delete from public.player_rooms where user_id = p_user_id;
  perform public._notify(p_user_id, 'ban', null, null, jsonb_build_object('reason', v_reason));
  perform public._admin_log('ban', p_user_id::text, jsonb_build_object('reason', v_reason));
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
  if found then
    perform public._notify(p_user_id, 'unban', null, null, '{}'::jsonb);
  end if;
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
  v_admin   uuid := public._require_admin();
  v_message text := public._require_reason(p_message);
begin
  insert into public.player_warnings (user_id, admin_id, message) values (p_user_id, v_admin, v_message);
  perform public._notify(p_user_id, 'warning', null, null, jsonb_build_object('message', v_message));
  perform public._admin_log('warn', p_user_id::text, jsonb_build_object('message', v_message));
end;
$$;

-- L'ancienne signature, sans motif, laisserait un reset muet.
drop function if exists public.admin_reset_stats(uuid);
create or replace function public.admin_reset_stats(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  perform public._require_admin();
  v_reason := public._require_reason(p_reason);
  delete from public.game_results where user_id = p_user_id;
  delete from public.user_achievements where user_id = p_user_id;
  delete from public.event_participants where user_id = p_user_id;
  update public.user_fees set current_streak = 0, best_streak = 0, last_daily_streak = null where user_id = p_user_id;
  perform public._notify(p_user_id, 'stats_reset', null, null, jsonb_build_object('reason', v_reason));
  perform public._admin_log('reset_stats', p_user_id::text, jsonb_build_object('reason', v_reason));
end;
$$;

-- Un badge peut récompenser comme sanctionner : la note, quand elle est
-- donnée, part dans la notification pour que le joueur sache pourquoi.
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
  perform public._notify(p_user, 'badge', p_by, null,
    jsonb_build_object('badge_id', p_badge, 'name', v_name) || coalesce(jsonb_build_object('note', p_note), '{}'::jsonb));
  return true;
end;
$$;

-- ===========================================================================
-- 6. Mesure d'audience anonyme (exemption CNIL)
-- ===========================================================================
-- Plus aucun lien entre une visite et un compte : la colonne `user_id`
-- n'était lue nulle part, et elle faisait de ce comptage un suivi des joueurs.
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
  insert into public.site_visits (day, visitor)
  values ((now() at time zone 'utc')::date, p_visitor)
  on conflict (day, visitor) do update
    set hits = least(public.site_visits.hits + 1, 10000);
end;
$$;

-- Effacement des liens déjà enregistrés, validé par l'éditeur le 28/10/2026.
update public.site_visits set user_id = null where user_id is not null;

comment on column public.site_visits.user_id is
  'Plus alimentée depuis 0013 (mesure d''audience anonyme). Conservée vide pour ne pas casser d''anciens clients.';

-- ===========================================================================
-- 7. Durées de conservation
-- ===========================================================================
create or replace function public.purge_expired_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.site_visits         where day < (now() - interval '25 months')::date;
  delete from public.fees_transactions   where created_at < now() - interval '3 years';
  delete from public.group_messages      where created_at < now() - interval '1 year';
  delete from public.notifications       where created_at < now() - interval '6 months';
  delete from public.player_reports      where status <> 'pending' and coalesce(resolved_at, created_at) < now() - interval '1 year';
  delete from public.player_warnings     where created_at < now() - interval '2 years';
  delete from public.admin_logs          where created_at < now() - interval '1 year';
  delete from public.banned_email_hashes where expires_at < now();
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'plafee-purge-expired';
    perform cron.schedule('plafee-purge-expired', '30 3 * * *', 'select public.purge_expired_data()');
  end if;
end;
$$;

-- ===========================================================================
-- 8. Ce que le client sait de son compte
-- ===========================================================================
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
    'is_super_admin', public.is_super_admin(),
    'terms_version', (select version from public.terms_acceptances where user_id = auth.uid()),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object('message', w.message, 'created_at', w.created_at) order by w.created_at desc)
      from (select * from public.player_warnings where user_id = auth.uid() order by created_at desc limit 5) w
    ), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- Droits
-- ===========================================================================
revoke all on function public._terms_version()              from public, anon, authenticated;
revoke all on function public._email_hash(text)              from public, anon, authenticated;
revoke all on function public._require_reason(text)          from public, anon, authenticated;
revoke all on function public.purge_expired_data()           from public, anon, authenticated;
revoke all on function public.handle_new_user()              from public, anon, authenticated;
revoke all on function public._award_badge(uuid, uuid, text, uuid) from public, anon, authenticated;

revoke all on function public.accept_terms(text)       from public, anon;
grant execute on function public.accept_terms(text)    to authenticated;
revoke all on function public.delete_my_account()      from public, anon;
grant execute on function public.delete_my_account()   to authenticated;
revoke all on function public.admin_reset_stats(uuid, text)    from public, anon;
grant execute on function public.admin_reset_stats(uuid, text) to authenticated;
revoke all on function public.admin_ban(uuid, text)     from public, anon;
grant execute on function public.admin_ban(uuid, text)  to authenticated;
revoke all on function public.admin_unban(uuid)         from public, anon;
grant execute on function public.admin_unban(uuid)      to authenticated;
revoke all on function public.admin_warn(uuid, text)    from public, anon;
grant execute on function public.admin_warn(uuid, text) to authenticated;
revoke all on function public.my_standing()             from public, anon;
grant execute on function public.my_standing()          to authenticated;
revoke all on function public.track_visit(text)         from public;
grant execute on function public.track_visit(text)      to anon, authenticated;
