import type { Cosmetics } from './api';

/** Ce qu'une photo porte : un objet par emplacement, et les visuels envoyés depuis l'admin. */
export interface AvatarLook {
  border?: string | null;
  accessory?: string | null;
  effect?: string | null;
  borderImg?: string | null;
  accessoryImg?: string | null;
  effectImg?: string | null;
}

/** Ce que porte un joueur, d'après ses cosmétiques chargés. */
export function lookOf(c: Cosmetics | null | undefined): AvatarLook {
  if (!c) return {};
  return {
    border: c.border,
    accessory: c.accessory ?? null,
    effect: c.effect ?? null,
    borderImg: c.border_img ?? null,
    accessoryImg: c.accessory_img ?? null,
    effectImg: c.effect_img ?? null,
  };
}
