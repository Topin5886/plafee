-- ===========================================================================
-- PLAFEE — Boutique : tous les prix +35 %
-- ===========================================================================
-- Les objets étaient trop vite abordables. Chaque objet payant (en vente ou
-- non) passe à son prix +35 %, arrondi au multiple de 5 le plus proche. Les
-- objets gratuits restent gratuits. Les offres du jour suivent toutes seules
-- (-15 % sur le nouveau prix). Rien ne change pour les objets déjà achetés.
--
-- Chaque ligne donne l'ancien et le nouveau prix : un objet n'est modifié que
-- s'il est encore à l'ancien prix. Rejouer la migration ne change donc rien,
-- et un prix modifié depuis dans l'admin n'est pas écrasé.
--
-- À appliquer après 0011.
-- ===========================================================================

update public.shop_items s
   set price = v.new_price, updated_at = now()
  from (values
  ('cards_pixel', null, 200, 270),
  ('cards_holo', null, 300, 405),
  ('cards_neon', null, 300, 405),
  ('cards_gold', null, 500, 675),
  ('site_retro', null, 350, 475),
  ('site_synthwave', null, 400, 540),
  ('site_cyber', null, 400, 540),
  ('badge_anniv_1', null, 250, 340),
  ('badge_anniv_2', null, 500, 675),
  ('badge_top100', null, 600, 810),
  ('badge_million', null, 1000, 1350),
  ('plate_champion', null, 400, 540),
  ('plate_roulette', null, 350, 475),
  ('plate_scopa', null, 350, 475),
  ('plate_uno', null, 350, 475),
  ('plate_custom', null, 500, 675),
  ('anim_fireworks', null, 200, 270),
  ('anim_pixels', null, 250, 340),
  ('anim_hologram', null, 300, 405),
  ('border_neon', null, 500, 675),
  ('border_silver', null, 1000, 1350),
  ('border_frost', null, 1200, 1620),
  ('border_felt', null, 1200, 1620),
  ('border_cards', null, 1500, 2025),
  ('border_gold', null, 2000, 2700),
  ('border_rainbow', null, 2500, 3375),
  ('accessory_flowers', null, 2500, 3375),
  ('border_circuit', null, 2500, 3375),
  ('border_lava', null, 2500, 3375),
  ('border_flame', null, 3000, 4050),
  ('border_bolt', null, 3000, 4050),
  ('border_platine', null, 5000, 6750),
  ('border_glitch', null, 5000, 6750),
  ('border_holo', null, 6000, 8100),
  ('border_pixelrainbow', null, 10000, 13500),
  ('acc_cat', null, 500, 675),
  ('acc_gg', null, 500, 675),
  ('acc_gamepad', null, 600, 810),
  ('acc_cap', null, 1000, 1350),
  ('accessory_bow', null, 1200, 1620),
  ('acc_headset', null, 1200, 1620),
  ('acc_horns', null, 1200, 1620),
  ('acc_shades', null, 1500, 2025),
  ('acc_token', null, 2000, 2700),
  ('acc_bottle', null, 2500, 3375),
  ('acc_halo', null, 3000, 4050),
  ('acc_crown', null, 5000, 6750),
  ('acc_dragon', null, 7000, 9450),
  ('fx_bubbles', null, 600, 810),
  ('fx_snow', null, 1200, 1620),
  ('fx_coins', null, 1500, 2025),
  ('fx_petals', null, 1500, 2025),
  ('fx_crt', null, 2000, 2700),
  ('fx_smoke', null, 3000, 4050),
  ('fx_stars', null, 5000, 6750),
  ('fx_hologram', null, 6000, 8100),
  ('fx_aura', null, 12000, 16200),
  -- Objet créé dans l'admin (« Ailes Angélique »), sans code : repéré par son id.
  (null, '5c74bffc-fd66-41aa-b1b7-750ba46db1d6', 2990, 4035)
  ) as v (sku, id, old_price, new_price)
 where (s.sku = v.sku or (v.sku is null and s.id = v.id::uuid))
   and s.price = v.old_price;
