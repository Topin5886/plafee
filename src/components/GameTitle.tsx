import { Fragment } from 'react';
import type { GameTypeId } from '../features/account/types';
import './gameTitle.css';

/**
 * Le nom d'un jeu en lettres de borne d'arcade : chaque jeu a sa police
 * pixel, sa couleur néon, ses ornements et sa devise (voir gameTitle.css).
 *
 * Ornements et crochets sont décoratifs : les lecteurs d'écran lisent le nom
 * simple (`label`).
 */
interface TitleSpec {
  label: string;
  /** Ornements de part et d'autre du nom. */
  before?: string;
  after?: string;
  /** Les mots du nom : la ligne ne se coupe qu'entre eux. `[`, `]` et `.`
   *  y deviennent des signes décoratifs. */
  parts: string[];
  motto: string;
}

const GAME_TITLES: Record<GameTypeId, TitleSpec> = {
  scopa: { label: 'Scopa', before: '>>', after: '<<', parts: ['SCOPA'], motto: 'CARD BATTLE' },
  puissance4: { label: 'P4 Forge', parts: ['[P4]', 'FORGE'], motto: 'POWER MODE' },
  'puissance4-original': { label: 'P4 Classic', parts: ['[P4]', 'CLASSIC'], motto: 'PURE MODE' },
  uno: { label: 'UNO', before: '***', after: '***', parts: ['UNO'], motto: 'CHAOS MODE' },
  flip7: { label: 'Flip 7', parts: ['[FLIP.7]'], motto: 'STOP OR CONTINUE' },
  verite: { label: 'Roulette de Vérité', parts: ['ROULETTE', 'DE', 'VÉRITÉ'], motto: 'VÉRITÉ OU MYTHO ?' },
  // La couronne posée de travers sur le P est dessinée en CSS (gameTitle.css).
  president: { label: 'Président', before: '-=', after: '=-', parts: ['PRÉSIDENT'], motto: 'LE TRÔNE OU LE TROU' },
};

interface Props {
  game: GameTypeId;
  /** sm : listes et onglets · md : cartes · lg : tuiles · xl : en-têtes de page. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Affiche la devise du jeu sous son nom. */
  motto?: boolean;
  /** Suffixe en texte simple, ex. « room ABC123 ». */
  suffix?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
}

/** `[P4]` → crochets décoratifs, `FLIP.7` → point décoratif. */
function renderPart(part: string) {
  return part.split(/([[\].])/).map((bit, i) =>
    bit === '[' || bit === ']' ? (
      <span key={i} className="gt-brk">
        {bit}
      </span>
    ) : bit === '.' ? (
      <span key={i} className="gt-dot">
        .
      </span>
    ) : (
      <Fragment key={i}>{bit}</Fragment>
    ),
  );
}

export function GameTitle({ game, size = 'md', motto = false, suffix, as: Tag = 'span', className }: Props) {
  const spec = GAME_TITLES[game];
  return (
    <Tag className={`gt${className ? ` ${className}` : ''}`} data-game={game} data-size={size}>
      <span className="gt-name">
        <span className="gt-sr">{spec.label}</span>
        <span className="gt-word" aria-hidden>
          {spec.before && <span className="gt-orn">{spec.before}</span>}
          {spec.parts.map((p, i) => (
            <span key={i} className="gt-part" data-i={i}>
              {renderPart(p)}
            </span>
          ))}
          {spec.after && <span className="gt-orn">{spec.after}</span>}
        </span>
        {suffix && <span className="gt-suffix">{suffix}</span>}
      </span>
      {motto && <span className="gt-motto">{spec.motto}</span>}
    </Tag>
  );
}
