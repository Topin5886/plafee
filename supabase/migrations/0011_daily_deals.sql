-- ===========================================================================
-- PLAFEE — Offres du jour : 3 objets à -15 %, renouvelés à minuit (Paris)
-- ===========================================================================
-- Pas de cron, pas de table : le tirage est calculé à la demande, à partir de
-- la date de Paris (YYYY-MM-DD). Même jour = même résultat pour tout le monde.
--
-- Règles :
--   - pool : objets en vente, pas par défaut, prix > 0, avec une rareté, sans
--     condition d'achat (requirement vide) et non OG (nouvelle colonne is_og) ;
--   - 3 emplacements : on tire une rareté (bronze 35, argent 30, or 22,
--     platine 10, divin 3), puis un objet dans cette rareté. Une rareté sans
--     objet disponible est retirée et sa part revient aux autres, au prorata ;
--   - pas deux fois le même objet le même jour, et pas un objet de la veille
--     tant que le pool le permet. Pour connaître « la veille » sans rien
--     stocker, le tirage se déroule jour après jour à partir de 60 jours plus
--     tôt : chaque jour exclut les objets du jour d'avant. Deux déroulés partis
--     de jours différents se rejoignent en quelques jours (les nombres tirés
--     sont les mêmes), donc 60 jours de recul donnent le même résultat qu'un
--     déroulé depuis toujours, pour un coût fixe ;
--   - remise : réglage « daily_deal_pct » de fees_price_config (15 au départ,
--     modifiable dans /admin > FEES), prix arrondi à l'entier inférieur.
--
-- Le prix remisé est calculé ici, et shop_purchase s'en sert : le navigateur
-- n'envoie jamais de prix (au mieux un plafond, qui ne peut que bloquer).
--
-- À appliquer après 0010. Rejouable sans risque. Ne touche à aucune donnée.
-- ===========================================================================

-- --- OG : exclus des offres -----------------------------------------------------------
alter table public.shop_items add column if not exists is_og boolean not null default false;

-- --- Le pourcentage, réglable dans l'admin ------------------------------------------------
insert into public.fees_price_config (action, label, amount) values
  ('daily_deal_pct', 'Offres du jour : remise (%)', 15)
on conflict (action) do nothing;

-- --- Hasard déterministe : un nombre dans [0, 1) tiré d'une clé texte -------------------------
create or replace function public._deal_rand(p_key text)
returns double precision
language sql
immutable
set search_path = public, pg_temp
as $$ select ('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint / 4294967296.0 $$;

-- --- Le tirage, jour après jour --------------------------------------------------------
-- Renvoie les offres de chaque jour entre p_from et p_to (inclus). Le déroulé
-- commence c_window jours avant p_from, pour que « la veille » de p_from soit
-- bien celle que les joueurs ont vue.
create or replace function public._daily_deals_draw(p_from date, p_to date)
returns table (day date, slot int, item_id uuid, rarity text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  c_window  constant int    := 60;
  c_slots   constant int    := 3;
  c_rar     constant text[] := array['bronze', 'argent', 'or', 'platine', 'divin'];
  c_weight  constant int[]  := array[35, 30, 22, 10, 3];
  v_ids     uuid[];
  v_rars    text[];
  v_n       int;
  v_day     date;
  v_key     text;
  v_prev    uuid[] := '{}';
  v_today   uuid[];
  v_avail   int[];   -- indices (dans v_ids) encore tirables
  v_strict  boolean;
  v_count   int[];
  v_total   int;
  v_u       double precision;
  v_acc     double precision;
  v_pick_r  int;
  v_k       int;
  v_r       int;
  v_i       int;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return;
  end if;

  -- Le pool, dans un ordre stable.
  select coalesce(array_agg(s.id order by array_position(c_rar, s.rarity), s.sort_order, s.id), '{}'),
         coalesce(array_agg(s.rarity order by array_position(c_rar, s.rarity), s.sort_order, s.id), '{}')
    into v_ids, v_rars
    from public.shop_items s
   where s.is_active and not s.is_default and s.price > 0
     and s.rarity = any (c_rar)
     and not s.is_og
     and coalesce(s.requirement, '{}'::jsonb) = '{}'::jsonb;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    return;
  end if;

  v_day := p_from - c_window;
  while v_day <= p_to loop
    v_key   := to_char(v_day, 'YYYY-MM-DD');
    v_today := '{}';

    for v_k in 1 .. c_slots loop
      -- D'abord sans la veille ; si plus rien, la veille redevient permise.
      foreach v_strict in array array[true, false] loop
        v_avail := '{}';
        for v_i in 1 .. v_n loop
          if not (v_ids[v_i] = any (v_today)) and not (v_strict and v_ids[v_i] = any (v_prev)) then
            v_avail := v_avail || v_i;
          end if;
        end loop;
        exit when cardinality(v_avail) > 0;
      end loop;
      exit when cardinality(v_avail) = 0;   -- pool de moins de 3 objets

      -- La rareté : seules celles qui ont encore un objet comptent.
      v_count := array[0, 0, 0, 0, 0];
      foreach v_i in array v_avail loop
        v_r := array_position(c_rar, v_rars[v_i]);
        v_count[v_r] := v_count[v_r] + 1;
      end loop;
      v_total := 0;
      for v_r in 1 .. 5 loop
        if v_count[v_r] > 0 then v_total := v_total + c_weight[v_r]; end if;
      end loop;

      v_u := public._deal_rand(v_key || ':' || v_k || ':rarity') * v_total;
      v_acc := 0;
      v_pick_r := null;
      for v_r in 1 .. 5 loop
        if v_count[v_r] > 0 then
          v_acc := v_acc + c_weight[v_r];
          v_pick_r := v_r;
          exit when v_u < v_acc;
        end if;
      end loop;

      -- L'objet : au hasard parmi ceux de cette rareté.
      v_r := floor(public._deal_rand(v_key || ':' || v_k || ':item') * v_count[v_pick_r])::int;
      foreach v_i in array v_avail loop
        if v_rars[v_i] = c_rar[v_pick_r] then
          if v_r = 0 then
            v_today := v_today || v_ids[v_i];
            if v_day >= p_from then
              day := v_day; slot := v_k; item_id := v_ids[v_i]; rarity := v_rars[v_i];
              return next;
            end if;
            exit;
          end if;
          v_r := v_r - 1;
        end if;
      end loop;
    end loop;

    v_prev := v_today;
    v_day  := v_day + 1;
  end loop;
end;
$$;

-- Accès aux autres jours que celui d'aujourd'hui : admins, ou SQL direct
-- (éditeur Supabase, connecteur), où aucune session PostgREST n'existe.
create or replace function public._deals_can_peek()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.is_admin(), false) or coalesce(current_setting('request.jwt.claims', true), '') = '' $$;

-- --- Les offres du jour ----------------------------------------------------------------
-- p_day : pour tester un autre jour (admins seulement). Par défaut, aujourd'hui à Paris.
create or replace function public.get_daily_deals(p_day date default null)
returns table (
  day date, slot int, item_id uuid, sku text, name text, description text, category text, rarity text,
  icon_url text, payload jsonb, price bigint, deal_price bigint, discount_pct int, ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_day   date := coalesce(p_day, v_today);
  v_pct   int  := least(greatest(public._fees_config('daily_deal_pct'), 0), 90)::int;
begin
  if v_day <> v_today and not public._deals_can_peek() then
    raise exception 'Seuls les admins peuvent voir les offres d''un autre jour.' using errcode = '42501';
  end if;
  return query
    select d.day, d.slot, s.id, s.sku, s.name, s.description, s.category, s.rarity,
           s.icon_url, s.payload, s.price,
           (s.price * (100 - v_pct)) / 100,          -- division entière : arrondi à l'inférieur
           v_pct,
           ((d.day + 1)::timestamp at time zone 'Europe/Paris')
      from public._daily_deals_draw(v_day, v_day) d
      join public.shop_items s on s.id = d.item_id
     order by d.slot;
end;
$$;

-- --- Pour tester : N jours simulés d'un coup -----------------------------------------------
create or replace function public.simulate_daily_deals(p_from date, p_days int default 1000)
returns table (day date, slot int, item_id uuid, rarity text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public._deals_can_peek() then
    raise exception 'Réservé aux admins.' using errcode = '42501';
  end if;
  return query select * from public._daily_deals_draw(p_from, p_from + least(greatest(p_days, 1), 5000) - 1);
end;
$$;

-- --- L'achat : prix remisé si l'objet est en offre aujourd'hui ---------------------------------
-- p_max_price (facultatif) : le prix affiché au joueur. S'il a changé entre-temps
-- (offre finie à minuit), l'achat est refusé au lieu de débiter plus que prévu.
drop function if exists public.shop_purchase(uuid, text);

create or replace function public.shop_purchase(p_item_id uuid, p_custom_text text default null, p_max_price bigint default null)
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
  v_price   bigint;
  v_pct     int;
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

  -- Le prix : celui de l'offre du jour si l'objet en fait partie, calculé ici.
  select d.deal_price, d.discount_pct into v_price, v_pct
    from public.get_daily_deals() d where d.item_id = v_item.id;
  v_price := coalesce(v_price, v_item.price);
  if p_max_price is not null and v_price > p_max_price then
    raise exception 'L''offre du jour est terminée : cet objet coûte maintenant % FEES.', v_price using errcode = '22023';
  end if;

  insert into public.user_fees (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_fees from public.user_fees where user_id = v_uid for update;
  if v_fees.balance < v_price then
    raise exception 'Pas assez de FEES ! Tu en as %, il en faut %.', v_fees.balance, v_price using errcode = '22023';
  end if;

  perform public._fees_add(v_uid, -v_price, 'shop_purchase', v_item.id::text,
    'Boutique : ' || v_item.name || case when v_pct is not null then ' (offre du jour -' || v_pct || ' %)' else '' end,
    false);

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

  return jsonb_build_object('balance', v_fees.balance - v_price, 'item_id', v_item.id, 'price', v_price, 'deal', v_pct is not null);
end;
$$;

-- --- Admin : la case OG --------------------------------------------------------------------
drop function if exists public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean, text);

create or replace function public.admin_upsert_shop_item(
  p_id uuid, p_name text, p_description text, p_category text, p_price bigint,
  p_icon_url text default null, p_payload jsonb default '{}'::jsonb, p_active boolean default true,
  p_rarity text default null, p_is_og boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  -- null : on ne touche pas à la rareté ; '' : on la retire.
  v_rarity text := nullif(btrim(coalesce(p_rarity, '')), '');
begin
  perform public._require_admin();
  if v_rarity is not null and v_rarity not in ('bronze', 'argent', 'or', 'platine', 'divin') then
    raise exception 'Rareté inconnue.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.shop_items (name, description, category, price, icon_url, payload, is_active, sort_order, rarity, is_og)
    values (btrim(p_name), p_description, p_category, greatest(p_price, 0), p_icon_url, coalesce(p_payload, '{}'::jsonb),
            coalesce(p_active, true), 500, v_rarity, coalesce(p_is_og, false))
    returning id into v_id;
  else
    update public.shop_items
       set name = btrim(p_name), description = p_description, price = greatest(p_price, 0), icon_url = p_icon_url,
           is_active = coalesce(p_active, true), updated_at = now(),
           rarity = case when p_rarity is null then rarity else v_rarity end,
           is_og = coalesce(p_is_og, is_og),
           -- Les objets fournis gardent leur effet ; un objet créé ici peut le changer.
           payload = case when sku is null then coalesce(p_payload, payload) else payload end,
           category = case when sku is null then p_category else category end
     where id = v_id;
  end if;
  perform public._admin_log('upsert_shop_item', v_id::text,
    jsonb_build_object('name', p_name, 'price', p_price, 'rarity', v_rarity, 'is_og', p_is_og));
  return v_id;
end;
$$;

-- --- Droits --------------------------------------------------------------------------------
revoke all on function public._deal_rand(text) from public, anon, authenticated;
revoke all on function public._daily_deals_draw(date, date) from public, anon, authenticated;
revoke all on function public._deals_can_peek() from public, anon, authenticated;

revoke all on function public.get_daily_deals(date) from public;
grant execute on function public.get_daily_deals(date) to anon, authenticated;

revoke all on function public.simulate_daily_deals(date, int) from public, anon;
grant execute on function public.simulate_daily_deals(date, int) to authenticated;

revoke all on function public.shop_purchase(uuid, text, bigint) from public, anon;
grant execute on function public.shop_purchase(uuid, text, bigint) to authenticated;

revoke all on function public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean, text, boolean) from public, anon;
grant execute on function public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean, text, boolean) to authenticated;
