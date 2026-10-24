-- ===========================================================================
-- PLAFEE — Collection d'accessoires de photo : 3 emplacements et rareté
-- ===========================================================================
-- Une photo de profil porte maintenant jusqu'à trois objets en même temps :
--   - un CADRE       (rayon profile_border, payload {"border": id})
--   - un ACCESSOIRE  (rayon avatar_accessory, payload {"accessory": id})
--   - un EFFET       (nouveau rayon avatar_effect, payload {"effect": id})
-- Chaque rayon garde sa règle « un seul objet équipé » (shop_equip), donc les
-- trois se cumulent sans rien changer à l'achat ni à l'équipement.
--
-- Nouveautés :
--   - colonne `rarity` (bronze, argent, or, platine, divin) sur shop_items ;
--   - 31 nouveaux objets (10 cadres, 12 accessoires, 9 effets) ;
--   - les objets de photo existants passent aux nouveaux prix, rangés par
--     rareté, et les Plantes japonaises passent au rayon Cadres ;
--   - « Sans cadre » et « Sans effet », gratuits, pour tout retirer ;
--   - profile_cosmetics renvoie l'effet, et le visuel envoyé depuis l'admin
--     (icon_url) de chaque objet équipé, qui remplace le dessin d'origine ;
--   - admin_upsert_shop_item accepte la rareté.
--
-- À appliquer après 0009. Rejouable sans risque.
-- ===========================================================================

-- --- Rayons et rareté ------------------------------------------------------------
alter table public.shop_items drop constraint if exists shop_items_category_check;
alter table public.shop_items add constraint shop_items_category_check
  check (category in ('card_theme', 'site_theme', 'badge', 'profile_border', 'nameplate', 'victory_animation',
                      'avatar_accessory', 'avatar_effect'));

alter table public.shop_items add column if not exists rarity text;
alter table public.shop_items drop constraint if exists shop_items_rarity_check;
alter table public.shop_items add constraint shop_items_rarity_check
  check (rarity is null or rarity in ('bronze', 'argent', 'or', 'platine', 'divin'));

-- --- Les Plantes japonaises passent aux cadres ----------------------------------------
-- Un joueur qui portait à la fois les fleurs et un contour garde son contour :
-- les deux sont maintenant dans le même rayon.
update public.user_shop_purchases p
   set equipped = false
 where p.equipped
   and p.item_id in (select id from public.shop_items where sku = 'accessory_flowers' and category = 'avatar_accessory')
   and exists (select 1 from public.user_shop_purchases q join public.shop_items i on i.id = q.item_id
                where q.user_id = p.user_id and q.equipped and i.category = 'profile_border');

-- --- Le catalogue ------------------------------------------------------------------
insert into public.shop_items (sku, name, description, category, price, payload, requirement, is_default, sort_order, rarity) values
  -- Cadres
  ('border_none',         'Sans cadre',          'La photo, sans rien autour.',                                        'profile_border', 0,     '{"border":null}',           '{}', true,  100, null),
  ('border_neon',         'Néon PLAFEE',         'Un contour vert fluo qui pulse, aux couleurs de la salle.',          'profile_border', 500,   '{"border":"neon"}',         '{}', false, 101, 'bronze'),
  ('border_silver',       'Contour Argent',      'Un liseré argenté, sobre et net.',                                   'profile_border', 1000,  '{"border":"silver"}',       '{}', false, 102, 'argent'),
  ('border_frost',        'Givre',               'De la glace et des cristaux de givre aux coins.',                    'profile_border', 1200,  '{"border":"frost"}',        '{}', false, 103, 'argent'),
  ('border_felt',         'Table de jeu',        'Le feutre vert du casino, liseré doré.',                             'profile_border', 1200,  '{"border":"felt"}',         '{}', false, 104, 'argent'),
  ('border_cards',        'Cartes à jouer',      'Quatre cartes posées dans les coins de ta photo.',                   'profile_border', 1500,  '{"border":"cards"}',        '{}', false, 105, 'argent'),
  ('border_gold',         'Contour Or',          'Un cadre doré qui brille.',                                          'profile_border', 2000,  '{"border":"gold"}',         '{}', false, 106, 'or'),
  ('border_rainbow',      'Contour Rainbow',     'Un contour qui change de couleur en boucle.',                        'profile_border', 2500,  '{"border":"rainbow"}',      '{}', false, 107, 'or'),
  ('accessory_flowers',   'Plantes japonaises',  'Des fleurs de cerisier grises, dans les coins de ta photo.',         'profile_border', 2500,  '{"border":"flowers"}',      '{}', false, 108, 'or'),
  ('border_circuit',      'Circuit imprimé',     'Des pistes cyan qui s''allument une à une.',                         'profile_border', 2500,  '{"border":"circuit"}',      '{}', false, 109, 'or'),
  ('border_lava',         'Lave',                'Un contour de lave qui coule lentement.',                            'profile_border', 2500,  '{"border":"lava"}',         '{}', false, 110, 'or'),
  ('border_flame',        'Contour Flammes',     'Ta photo prend feu. Littéralement.',                                 'profile_border', 3000,  '{"border":"flame"}',        '{}', false, 111, 'or'),
  ('border_bolt',         'Éclairs',             'Un contour sous tension, avec des éclairs.',                         'profile_border', 3000,  '{"border":"bolt"}',         '{}', false, 112, 'or'),
  ('border_platine',      'Contour Platine',     'Le cadre des grands joueurs.',                                       'profile_border', 5000,  '{"border":"platine"}',      '{}', false, 113, 'platine'),
  ('border_glitch',       'Glitch RGB',          'Un contour qui bugue en rouge, vert et bleu.',                       'profile_border', 5000,  '{"border":"glitch"}',       '{}', false, 114, 'platine'),
  ('border_holo',         'Holographique',       'Un reflet holo qui passe, comme une carte rare.',                    'profile_border', 6000,  '{"border":"holo"}',         '{}', false, 115, 'platine'),
  ('border_pixelrainbow', 'Arc-en-ciel pixel',   'Le cadre le plus rare : des pixels de toutes les couleurs.',         'profile_border', 10000, '{"border":"pixelrainbow"}', '{}', false, 116, 'divin'),
  -- Accessoires
  ('accessory_none',      'Sans accessoire',     'La photo, rien que la photo.',                                       'avatar_accessory', 0,    '{"accessory":null}',       '{}', true,  200, null),
  ('acc_cat',             'Chat qui dépasse',    'Un petit chat pixel passe la tête par le haut de ta photo.',         'avatar_accessory', 500,  '{"accessory":"cat"}',      '{}', false, 201, 'bronze'),
  ('acc_gg',              'Bulle « GG »',        'Une bulle « GG » dans le coin, pour les bons perdants.',             'avatar_accessory', 500,  '{"accessory":"gg"}',       '{}', false, 202, 'bronze'),
  ('acc_gamepad',         'Manette',             'Une petite manette pixel dans le coin.',                             'avatar_accessory', 600,  '{"accessory":"gamepad"}',  '{}', false, 203, 'bronze'),
  ('acc_cap',             'Casquette à l''envers','Une casquette posée sur le haut de ta photo.',                      'avatar_accessory', 1000, '{"accessory":"cap"}',      '{}', false, 204, 'argent'),
  ('accessory_bow',       'Nœud papillon',       'Un nœud magenta, en haut à droite de ta photo.',                     'avatar_accessory', 1200, '{"accessory":"bow"}',      '{}', false, 205, 'argent'),
  ('acc_headset',         'Casque gaming',       'Un casque de joueur, LED allumée.',                                  'avatar_accessory', 1200, '{"accessory":"headset"}',  '{}', false, 206, 'argent'),
  ('acc_horns',           'Cornes de diable',    'Deux petites cornes rouges. Ça te va bien.',                         'avatar_accessory', 1200, '{"accessory":"horns"}',    '{}', false, 207, 'argent'),
  ('acc_shades',          'Lunettes pixel',      'Des lunettes de soleil pixel, posées sur le haut.',                  'avatar_accessory', 1500, '{"accessory":"shades"}',   '{}', false, 208, 'argent'),
  ('acc_token',           'Jeton P4 Forge',      'Un jeton de Puissance 4 forgé, qui brille dans le coin.',            'avatar_accessory', 2000, '{"accessory":"token"}',    '{}', false, 209, 'or'),
  ('acc_bottle',          'Bouteille de la Roulette', 'La bouteille de la Roulette de Vérité, qui tourne de temps en temps.', 'avatar_accessory', 2500, '{"accessory":"bottle"}', '{}', false, 210, 'or'),
  ('acc_halo',            'Auréole',             'Un anneau doré qui flotte au-dessus de ta photo.',                   'avatar_accessory', 3000, '{"accessory":"halo"}',     '{}', false, 211, 'or'),
  ('acc_crown',           'Couronne pixel',      'Une couronne dorée sertie de joyaux.',                               'avatar_accessory', 5000, '{"accessory":"crown"}',    '{}', false, 212, 'platine'),
  ('acc_dragon',          'Dragon pixel',        'Un petit dragon enroulé dans le coin, qui crache du feu.',           'avatar_accessory', 7000, '{"accessory":"dragon"}',   '{}', false, 213, 'platine'),
  -- Effets
  ('effect_none',         'Sans effet',          'Pas d''animation sur ta photo.',                                     'avatar_effect', 0,     '{"effect":null}',         '{}', true,  300, null),
  ('fx_bubbles',          'Bulles',              'Quelques bulles qui montent doucement.',                             'avatar_effect', 600,   '{"effect":"bubbles"}',    '{}', false, 301, 'bronze'),
  ('fx_snow',             'Neige pixel',         'Des flocons pixel qui tombent sur ta photo.',                        'avatar_effect', 1200,  '{"effect":"snow"}',       '{}', false, 302, 'argent'),
  ('fx_coins',            'Pluie de FEES',       'Des pièces FEES qui tombent par moments.',                           'avatar_effect', 1500,  '{"effect":"coins"}',      '{}', false, 303, 'argent'),
  ('fx_petals',           'Pétales',             'Des pétales roses qui volent en travers.',                           'avatar_effect', 1500,  '{"effect":"petals"}',     '{}', false, 304, 'argent'),
  ('fx_crt',              'Scan lines CRT',      'Les lignes d''un vieil écran de borne.',                             'avatar_effect', 2000,  '{"effect":"crt"}',        '{}', false, 305, 'or'),
  ('fx_smoke',            'Aura sombre',         'Une fumée violette qui ondule autour de toi.',                       'avatar_effect', 3000,  '{"effect":"smoke"}',      '{}', false, 306, 'or'),
  ('fx_stars',            'Étoiles en orbite',   'Trois étoiles qui tournent autour de ta photo.',                     'avatar_effect', 5000,  '{"effect":"stars"}',      '{}', false, 307, 'platine'),
  ('fx_hologram',         'Hologramme',          'Ta photo devient une projection holographique.',                     'avatar_effect', 6000,  '{"effect":"hologram"}',   '{}', false, 308, 'platine'),
  ('fx_aura',             'Aura arcade',         'L''objet le plus rare de la salle : un halo qui change de couleur.', 'avatar_effect', 12000, '{"effect":"aura"}',       '{}', false, 309, 'divin')
on conflict (sku) do update
  set name = excluded.name, description = excluded.description, category = excluded.category,
      price = excluded.price, payload = excluded.payload, is_default = excluded.is_default,
      sort_order = excluded.sort_order, rarity = excluded.rarity, updated_at = now();

-- --- Les cosmétiques d'un joueur : + effet et visuels envoyés depuis l'admin -------------
drop function if exists public.profile_cosmetics(uuid[]);

create function public.profile_cosmetics(p_user_ids uuid[])
returns table (
  user_id uuid, border text, plate text, title text, site_skin text, card_skin text,
  victory_anim text, accessory text, effect text,
  border_img text, accessory_img text, effect_img text,
  badges jsonb, banned boolean
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
    (select i.payload ->> 'accessory' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'avatar_accessory' limit 1),
    (select i.payload ->> 'effect' from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'avatar_effect' limit 1),
    (select nullif(i.icon_url, '') from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'profile_border' limit 1),
    (select nullif(i.icon_url, '') from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'avatar_accessory' limit 1),
    (select nullif(i.icon_url, '') from public.user_shop_purchases p join public.shop_items i on i.id = p.item_id
      where p.user_id = u.id and p.equipped and i.category = 'avatar_effect' limit 1),
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

revoke all on function public.profile_cosmetics(uuid[]) from public;
grant execute on function public.profile_cosmetics(uuid[]) to anon, authenticated;

-- --- Admin : créer / modifier un objet, avec sa rareté ----------------------------------
drop function if exists public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean);

create or replace function public.admin_upsert_shop_item(
  p_id uuid, p_name text, p_description text, p_category text, p_price bigint,
  p_icon_url text default null, p_payload jsonb default '{}'::jsonb, p_active boolean default true,
  p_rarity text default null
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
    insert into public.shop_items (name, description, category, price, icon_url, payload, is_active, sort_order, rarity)
    values (btrim(p_name), p_description, p_category, greatest(p_price, 0), p_icon_url, coalesce(p_payload, '{}'::jsonb),
            coalesce(p_active, true), 500, v_rarity)
    returning id into v_id;
  else
    update public.shop_items
       set name = btrim(p_name), description = p_description, price = greatest(p_price, 0), icon_url = p_icon_url,
           is_active = coalesce(p_active, true), updated_at = now(),
           rarity = case when p_rarity is null then rarity else v_rarity end,
           -- Les objets fournis gardent leur effet ; un objet créé ici peut le changer.
           payload = case when sku is null then coalesce(p_payload, payload) else payload end,
           category = case when sku is null then p_category else category end
     where id = v_id;
  end if;
  perform public._admin_log('upsert_shop_item', v_id::text,
    jsonb_build_object('name', p_name, 'price', p_price, 'rarity', v_rarity));
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean, text) from public, anon;
grant execute on function public.admin_upsert_shop_item(uuid, text, text, text, bigint, text, jsonb, boolean, text) to authenticated;
