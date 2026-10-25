-- ===========================================================================
-- PLAFEE — Vérifier les offres du jour (migration 0011)
-- ===========================================================================
-- À coller dans l'éditeur SQL de Supabase. Lecture seule : rien n'est modifié.
-- Depuis l'éditeur (ou en étant admin), get_daily_deals accepte une date.

-- 1. Aujourd'hui, demain, après-demain : le tirage change chaque jour.
select day, slot, sku, rarity, price, deal_price, discount_pct, ends_at
  from public.get_daily_deals()
union all
select day, slot, sku, rarity, price, deal_price, discount_pct, ends_at
  from public.get_daily_deals(((now() at time zone 'Europe/Paris')::date + 1))
union all
select day, slot, sku, rarity, price, deal_price, discount_pct, ends_at
  from public.get_daily_deals(((now() at time zone 'Europe/Paris')::date + 2))
order by day, slot;

-- 2. 1000 jours simulés : règles respectées et répartition des raretés.
--    Attendu : 0 doublon, 0 reprise de la veille, 0 écart avec get_daily_deals.
with s as (select * from public.simulate_daily_deals((now() at time zone 'Europe/Paris')::date, 1000)),
     d as (select day, array_agg(item_id order by slot) ids from s group by day)
select
  (select count(distinct day) from s)                                                    as jours,
  (select count(*) from d where cardinality(ids) <> (select count(distinct x) from unnest(ids) x)) as doublons_meme_jour,
  (select count(*) from d a join d b on b.day = a.day - 1 where a.ids && b.ids)          as reprises_de_la_veille,
  (select count(*) from d
    where d.ids is distinct from (select array_agg(g.item_id order by g.slot) from public.get_daily_deals(d.day) g)) as ecarts_avec_get_daily_deals;

-- Raretés tirées, comparées aux cibles. Avec peu d'objets dans une rareté
-- (2 en bronze aujourd'hui), la règle « pas d'objet de la veille » la fait
-- sortir moins souvent que sa cible : sa part revient aux autres.
with s as (select * from public.simulate_daily_deals((now() at time zone 'Europe/Paris')::date, 1000))
select s.rarity,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_tire,
       max(c.cible) as pct_cible,
       (select count(*) from public.shop_items i
         where i.rarity = s.rarity and i.is_active and not i.is_default and i.price > 0
           and not i.is_og and i.requirement = '{}'::jsonb) as objets_eligibles
  from s
  join (values ('bronze', 35), ('argent', 30), ('or', 22), ('platine', 10), ('divin', 3)) c(rarity, cible) using (rarity)
 group by s.rarity
 order by max(c.cible) desc;

-- 3. Le pool éligible (ce qui peut sortir), et les objets OG exclus.
select rarity, count(*) filter (where not is_og) as eligibles, count(*) filter (where is_og) as og_exclus
  from public.shop_items
 where is_active and not is_default and price > 0 and rarity is not null and requirement = '{}'::jsonb
 group by rarity
 order by array_position(array['bronze', 'argent', 'or', 'platine', 'divin'], rarity);
