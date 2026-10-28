import { memo } from 'react';
import { RANK_LABEL, SUIT_COLOR } from '../engine/deck';
import type { PresidentCard, PresidentSuit } from '../engine/types';

/*
 * Une carte française dessinée en SVG : nette à toutes les tailles, sans un
 * seul fichier image, et teintée par le CSS (president.css) pour suivre les
 * thèmes du site. Le dessin suit un vrai jeu : index en coin (valeur et
 * couleur, répétés tête-bêche), enseignes disposées comme sur les cartes du
 * commerce, figures à deux têtes.
 *
 * Toutes les coordonnées vivent dans une boîte de 100 × 140 ; c'est le
 * conteneur qui donne la taille réelle.
 */

const W = 100;
const H = 140;
const MID = H / 2;

/** Les enseignes, dessinées dans une boîte de 100 × 100 centrée sur (50, 50). */
function SuitShape({ suit }: { suit: PresidentSuit }) {
  switch (suit) {
    case 'hearts':
      return (
        <path d="M50 92 C47 86 34 76 22 64 C10 52 4 42 4 30 C4 16 15 6 28 6 C38 6 46 12 50 22 C54 12 62 6 72 6 C85 6 96 16 96 30 C96 42 90 52 78 64 C66 76 53 86 50 92 Z" />
      );
    case 'diamonds':
      return <path d="M50 3 L89 50 L50 97 L11 50 Z" />;
    case 'spades':
      return (
        <path d="M50 4 C58 20 96 38 96 62 C96 76 86 84 74 84 C65 84 58 80 54 73 C55 83 60 90 68 96 L32 96 C40 90 45 83 46 73 C42 80 35 84 26 84 C14 84 4 76 4 62 C4 38 42 20 50 4 Z" />
      );
    case 'clubs':
      return (
        <>
          <circle cx={50} cy={28} r={21} />
          <circle cx={26} cy={58} r={21} />
          <circle cx={74} cy={58} r={21} />
          <circle cx={50} cy={52} r={12} />
          <path d="M46 54 C46 74 41 86 31 96 L69 96 C59 86 54 74 54 54 Z" />
        </>
      );
  }
}

/** Une enseigne posée en (x, y), de `size` de côté, retournée sous la ligne médiane. */
function Pip({ suit, x, y, size, flip = false }: { suit: PresidentSuit; x: number; y: number; size: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${flip ? 180 : 0}) scale(${size / 100}) translate(-50 -50)`}>
      <SuitShape suit={suit} />
    </g>
  );
}

/*
 * La disposition des enseignes, de 2 à 10, comme sur un jeu du commerce :
 * deux colonnes et une colonne centrale, quatre rangées pour le 9 et le 10.
 */
const L = 31;
const C = 50;
const R = 69;
const TOP = 31;
const BOT = 109;
const Q1 = TOP + (BOT - TOP) / 3;
const Q2 = TOP + ((BOT - TOP) * 2) / 3;

const PIPS: Record<number, [number, number][]> = {
  2: [[C, TOP], [C, BOT]],
  3: [[C, TOP], [C, MID], [C, BOT]],
  4: [[L, TOP], [R, TOP], [L, BOT], [R, BOT]],
  5: [[L, TOP], [R, TOP], [C, MID], [L, BOT], [R, BOT]],
  6: [[L, TOP], [R, TOP], [L, MID], [R, MID], [L, BOT], [R, BOT]],
  7: [[L, TOP], [R, TOP], [C, (TOP + MID) / 2], [L, MID], [R, MID], [L, BOT], [R, BOT]],
  8: [[L, TOP], [R, TOP], [C, (TOP + MID) / 2], [L, MID], [R, MID], [C, (MID + BOT) / 2], [L, BOT], [R, BOT]],
  9: [[L, TOP], [R, TOP], [L, Q1], [R, Q1], [C, MID], [L, Q2], [R, Q2], [L, BOT], [R, BOT]],
  10: [[L, TOP], [R, TOP], [C, (TOP + Q1) / 2], [L, Q1], [R, Q1], [L, Q2], [R, Q2], [C, (Q2 + BOT) / 2], [L, BOT], [R, BOT]],
};

/**
 * L'index de coin : la valeur, l'enseigne dessous. Répété tête-bêche en bas à
 * droite. Un « gros index », comme sur les jeux de poker : sur un téléphone,
 * une carte de la main fait 54 px de large et n'en montre que la moitié dans
 * un groupe — l'index doit se lire à lui seul. Il tient dans la colonne
 * laissée libre à gauche des enseignes (x < 22) et du cadre des figures.
 */
function Index({ rank, suit }: { rank: number; suit: PresidentSuit }) {
  const label = RANK_LABEL[rank] ?? String(rank);
  const wide = label.length > 1;
  return (
    <g>
      <text
        x={11.5}
        y={17}
        textAnchor="middle"
        dominantBaseline="central"
        className="pres-card-index"
        fontSize={wide ? 17 : 21}
        letterSpacing={wide ? -1.6 : 0}
      >
        {label}
      </text>
      <Pip suit={suit} x={11.5} y={34} size={13} />
    </g>
  );
}

/*
 * Les emblèmes des figures, centrés sur (0, 0) : la couronne du Roi, le
 * diadème de la Dame, la toque à plume du Valet. Stylisés plutôt que copiés
 * des portraits : à la taille d'une carte de téléphone, une silhouette nette
 * se lit mieux qu'un visage.
 */
function Emblem({ rank }: { rank: number }) {
  if (rank === 13) {
    return (
      <g>
        <path className="pres-fig-gold" d="M-15 9 L-15 -5 L-8 2 L0 -11 L8 2 L15 -5 L15 9 Z" />
        <circle className="pres-fig-ink" cx={-15} cy={-6.5} r={2.3} />
        <circle className="pres-fig-ink" cx={0} cy={-12.5} r={2.6} />
        <circle className="pres-fig-ink" cx={15} cy={-6.5} r={2.3} />
        <rect className="pres-fig-ink" x={-15} y={8} width={30} height={4} />
      </g>
    );
  }
  if (rank === 12) {
    return (
      <g>
        <path className="pres-fig-gold" d="M-15 9 Q0 -5 15 9 L15 13 Q0 2 -15 13 Z" />
        <circle className="pres-fig-ink" cx={0} cy={-5} r={4.6} />
        <circle className="pres-fig-gold" cx={0} cy={-5} r={2} />
        <circle className="pres-fig-ink" cx={-9} cy={0.5} r={2.7} />
        <circle className="pres-fig-ink" cx={9} cy={0.5} r={2.7} />
      </g>
    );
  }
  return (
    <g>
      <path className="pres-fig-gold" d="M4 -8 C10 -19 21 -21 25 -16 C19 -14 13 -10 9 -4 Z" />
      <path className="pres-fig-ink" d="M-14 10 C-14 -3 -6 -8 2 -8 C10 -8 14 -2 14 10 Z" />
      <rect className="pres-fig-gold" x={-14} y={6} width={28} height={3.5} />
    </g>
  );
}

const FIGURE_LETTER: Record<number, string> = { 11: 'V', 12: 'D', 13: 'R' };

/** Une moitié de figure : emblème et lettre. Dessinée deux fois, tête-bêche. */
function FigureHalf({ rank, flip }: { rank: number; flip?: boolean }) {
  return (
    <g transform={flip ? `rotate(180 ${W / 2} ${MID})` : undefined}>
      <g transform={`translate(${W / 2} 40)`}>
        <Emblem rank={rank} />
      </g>
      <text x={W / 2} y={60} textAnchor="middle" dominantBaseline="central" className="pres-fig-letter">
        {FIGURE_LETTER[rank]}
      </text>
    </g>
  );
}

function Figure({ rank, suit }: { rank: number; suit: PresidentSuit }) {
  return (
    <g>
      <rect className="pres-fig-frame" x={22} y={20} width={56} height={100} rx={3} />
      <FigureHalf rank={rank} />
      <FigureHalf rank={rank} flip />
      <line className="pres-fig-split" x1={22} y1={MID} x2={78} y2={MID} />
      <circle className="pres-fig-medal" cx={W / 2} cy={MID} r={7.5} />
      <Pip suit={suit} x={W / 2} y={MID} size={10} />
    </g>
  );
}

function Center({ rank, suit }: { rank: number; suit: PresidentSuit }) {
  if (rank >= 11 && rank <= 13) return <Figure rank={rank} suit={suit} />;
  if (rank === 14) {
    // L'As : une seule grande enseigne, cerclée comme sur les cartes de luxe.
    return (
      <g>
        <circle className="pres-ace-ring" cx={W / 2} cy={MID} r={27} />
        <Pip suit={suit} x={W / 2} y={MID} size={38} />
      </g>
    );
  }
  // Le 2 porte la valeur 15 : deux enseignes, comme un 2 du commerce.
  const pips = PIPS[rank === 15 ? 2 : rank] ?? [];
  return (
    <g>
      {pips.map(([x, y], i) => (
        <Pip key={i} suit={suit} x={x} y={y} size={17} flip={y > MID + 0.5} />
      ))}
    </g>
  );
}

/**
 * La face d'une carte. Mémoïsée : une main de 18 cartes se redessine à chaque
 * coup des autres, et une carte ne change jamais de face.
 */
export const PresidentCardFace = memo(function PresidentCardFace({ card, className }: { card: PresidentCard; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`pres-card${className ? ` ${className}` : ''}`}
      data-color={SUIT_COLOR[card.suit]}
      data-rank={card.rank}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="pres-card-bg" x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={7} />
      <g className="pres-card-ink">
        <Center rank={card.rank} suit={card.suit} />
        <Index rank={card.rank} suit={card.suit} />
        <g transform={`rotate(180 ${W / 2} ${MID})`}>
          <Index rank={card.rank} suit={card.suit} />
        </g>
      </g>
    </svg>
  );
});

/*
 * Le dos : le noir de la salle, un semis de petits losanges néon et une
 * couronne au centre — l'emblème du jeu. Les couleurs viennent du CSS
 * (`--neon`), donc le dos suit le thème choisi dans les réglages.
 */
const BACK_LATTICE = (() => {
  let d = '';
  for (let y = 15; y <= 125; y += 11) {
    for (let x = 15; x <= 85; x += 11.6) {
      d += `M${x} ${y - 2.6}L${x + 2.6} ${y}L${x} ${y + 2.6}L${x - 2.6} ${y}Z`;
    }
  }
  return d;
})();

export const PresidentCardBack = memo(function PresidentCardBack({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`pres-card pres-card-back${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="pres-back-bg" x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={7} />
      <path className="pres-back-lattice" d={BACK_LATTICE} />
      <rect className="pres-back-frame" x={7} y={7} width={W - 14} height={H - 14} rx={4} />
      <path className="pres-back-diamond" d={`M${W / 2} ${MID - 30} L${W / 2 + 24} ${MID} L${W / 2} ${MID + 30} L${W / 2 - 24} ${MID} Z`} />
      <g transform={`translate(${W / 2} ${MID + 1}) scale(1.05)`}>
        <path className="pres-back-crown" d="M-15 9 L-15 -5 L-8 2 L0 -11 L8 2 L15 -5 L15 9 Z" />
      </g>
    </svg>
  );
});
