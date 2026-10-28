import type { PresidentCard, PresidentRole, PresidentSuit } from './types';

/*
 * Le jeu de 52 cartes du Président, et tout ce qui sert à en parler.
 *
 * Les valeurs vont de 3 (la plus faible) à 15 (le 2, la plus forte) : on
 * compare directement les nombres, sans table d'ordre à consulter partout.
 */

export const SUITS: PresidentSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** De la plus faible à la plus forte. */
export const RANKS: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Le 2, la carte maîtresse : il ferme le pli à lui seul. */
export const TWO = 15;

const SUIT_LETTER: Record<PresidentSuit, string> = { clubs: 'c', diamonds: 'd', hearts: 'h', spades: 's' };

/** Ce qui s'imprime dans le coin de la carte. */
export const RANK_LABEL: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'V',
  12: 'D',
  13: 'R',
  14: 'A',
  15: '2',
};

/** Le nom qu'on dit à voix haute : « un Valet », « Dame ou rien ! ». */
export const RANK_NAME: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'Valet',
  12: 'Dame',
  13: 'Roi',
  14: 'As',
  15: '2',
};

/** Au pluriel, pour « une paire de Dames ». Les chiffres et l'As ne prennent pas de s. */
const RANK_PLURAL: Record<number, string> = { ...RANK_NAME, 11: 'Valets', 12: 'Dames', 13: 'Rois' };

export const SUIT_SYMBOL: Record<PresidentSuit, string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };

export const SUIT_NAME: Record<PresidentSuit, string> = {
  clubs: 'trèfle',
  diamonds: 'carreau',
  hearts: 'cœur',
  spades: 'pique',
};

export const SUIT_COLOR: Record<PresidentSuit, 'black' | 'red'> = {
  clubs: 'black',
  diamonds: 'red',
  hearts: 'red',
  spades: 'black',
};

export const ROLE_LABEL: Record<PresidentRole, string> = {
  president: 'Président',
  'vice-president': 'Vice-président',
  neutre: 'Neutre',
  'vice-trou': 'Vice-trou',
  trou: 'Trou du cul',
};

/**
 * Les 52 cartes, dans l'ordre. Les ids sont stables (`p12h` = la Dame de
 * cœur) : l'écran les garde comme clés d'animation d'une manche à l'autre, et
 * les tests peuvent viser une carte précise sans dépendre du mélange.
 */
export function createDeck(): PresidentCard[] {
  const deck: PresidentCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ id: cardId(rank, suit), rank, suit });
  }
  return deck;
}

export function cardId(rank: number, suit: PresidentSuit): string {
  return `p${rank}${SUIT_LETTER[suit]}`;
}

/** Fisher-Yates. L'aléa est injectable pour que les tests rejouent la même donne. */
export function shuffle<T>(input: T[], random: () => number = Math.random): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Par valeur croissante, puis par couleur : les groupes se retrouvent côte à côte. */
export function sortHand(cards: PresidentCard[]): PresidentCard[] {
  return [...cards].sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

/** « Dame de cœur », « 2 de pique ». */
export function cardLabel(card: PresidentCard): string {
  return `${RANK_NAME[card.rank]} de ${SUIT_NAME[card.suit]}`;
}

/** L'article qui va avec la valeur : la Dame est la seule au féminin. */
function one(rank: number): string {
  return `${rank === 12 ? 'une' : 'un'} ${RANK_NAME[rank]}`;
}

/** « de Dames », « de 8 » (on dit « de huit »), mais « d'As » : seul l'As élide. */
function of(rank: number): string {
  return rank === 14 ? `d'${RANK_PLURAL[rank]}` : `de ${RANK_PLURAL[rank]}`;
}

/**
 * Une pose dite comme à table : « un 7 », « une paire de Dames », « un brelan
 * de Rois », « un carré d'As ». Les 2 se comptent (« deux 2 ») : « une paire
 * de 2 » ne se dit pas, on annonce la force.
 */
export function describePlay(rank: number, count: number): string {
  if (rank === TWO) {
    if (count === 4) return 'un carré de 2';
    return ['un 2', 'deux 2', 'trois 2'][count - 1] ?? `${count} × 2`;
  }
  switch (count) {
    case 1:
      return one(rank);
    case 2:
      return `une paire ${of(rank)}`;
    case 3:
      return `un brelan ${of(rank)}`;
    case 4:
      return `un carré ${of(rank)}`;
    default:
      return `${count} × ${RANK_NAME[rank]}`;
  }
}
