import type { AvatarLook } from '../avatarLook';

const BOW = `${import.meta.env.BASE_URL}cosmetics/bow.svg`;

/*
 * Les cosmétiques posés sur une photo, sur le site comme en partie : trois
 * emplacements cumulables (styles/cosmetics-base.css).
 *   - le cadre       → <span class="cos-frame"  data-frame>
 *   - l'accessoire   → <span class="cos-acc"    data-acc>
 *   - l'effet        → <span class="cos-effect" data-effect>
 * Un visuel envoyé depuis l'admin (icon_url de l'objet) remplace le dessin
 * d'origine, à la même place.
 */

/** Les contours historiques, dessinés en CSS sur l'avatar lui-même (styles/plafee-v2.css). */
const HOST_BORDERS = new Set(['silver', 'gold', 'platine', 'rainbow', 'flame', 'badge']);

/** Un calque : le dessin d'origine (fond CSS), ou l'image envoyée depuis l'admin. */
function Layer({ kind, id, img }: { kind: 'frame' | 'acc' | 'effect'; id: string | null | undefined; img: string | null | undefined }) {
  const attr = { [`data-${kind}`]: id ?? 'custom' };
  return (
    <span className={`cos-${kind}${img ? ' cos-custom' : ''}`} {...attr} aria-hidden>
      {img && <img src={img} alt="" draggable={false} loading="lazy" decoding="async" />}
    </span>
  );
}

/** Les calques d'un avatar habillé, à poser dans l'avatar (qui est en position relative). */
export function AvatarLayers({ look }: { look: AvatarLook }) {
  const { border, accessory, effect, borderImg, accessoryImg, effectImg } = look;
  const frame = borderImg || (border && !HOST_BORDERS.has(border));
  return (
    <>
      {frame && <Layer kind="frame" id={border} img={borderImg} />}
      {accessory === 'bow' && !accessoryImg ? (
        <img className="cos-bow" src={BOW} alt="" draggable={false} />
      ) : (
        (accessory || accessoryImg) && <Layer kind="acc" id={accessory} img={accessoryImg} />
      )}
      {(effect || effectImg) && <Layer kind="effect" id={effect} img={effectImg} />}
    </>
  );
}
