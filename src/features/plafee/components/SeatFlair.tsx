import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCosmetics } from '../useCosmetics';
import { useSeatCards } from '../seatCosmetics';
import { AvatarLayers } from './AvatarAccessory';
import { lookOf } from '../avatarLook';

/*
 * Les cosmétiques en partie : tout le monde voit ceux des autres. Les jeux
 * connaissent le compte de chaque place (`userId`, annoncé en rejoignant la
 * table) ; ces composants vont chercher le reste.
 */

/**
 * Habille l'avatar d'une place : cadre, accessoire et effet. Sous 40 px (la
 * taille de l'avatar du jeu, mesurée), tout est figé, comme sur le site.
 */
export function SeatFlair({ userId, children, className }: { userId?: string | null; children: ReactNode; className?: string }) {
  const c = useCosmetics(userId ?? null);
  const look = lookOf(c);
  const ref = useRef<HTMLSpanElement>(null);
  const [small, setSmall] = useState(true);
  const dressed = Boolean(look.border || look.accessory || look.effect || look.borderImg || look.accessoryImg || look.effectImg);
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el || !dressed) return;
    const measure = () => setSmall(el.offsetWidth < 40);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dressed]);
  return (
    <span
      ref={ref}
      className={`cos-seat${className ? ` ${className}` : ''}`}
      data-border={look.border ?? undefined}
      data-accessory={look.accessory ?? undefined}
      data-effect={look.effect ?? undefined}
      data-small={(dressed && small) || undefined}
    >
      {children}
      <AvatarLayers look={look} />
    </span>
  );
}

/** Un avatar de place pour les jeux qui n'en dessinent pas : l'initiale, à la couleur du joueur. */
export function SeatAvatar({ userId, name, color, size = 26 }: { userId?: string | null; name: string; color?: string; size?: number }) {
  return (
    <SeatFlair userId={userId}>
      <span className="cos-seat-avatar" style={{ width: size, height: size, fontSize: size * 0.46, '--seat-color': color } as CSSProperties} aria-hidden>
        {name.charAt(0).toUpperCase()}
      </span>
    </SeatFlair>
  );
}

/** Un conteneur de cartes au skin de son joueur (la main d'un adversaire, par exemple). */
export function SeatCards({ userId, className, children }: { userId?: string | null; className?: string; children: ReactNode }) {
  const skin = useSeatCards(userId);
  return (
    <div className={className} data-seat-cards={skin}>
      {children}
    </div>
  );
}
