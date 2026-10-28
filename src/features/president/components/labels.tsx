import { cardLabel } from '../engine/deck';
import type { PresidentCard } from '../engine/types';

/*
 * Les petits textes de l'écran, partagés par les composants : une liste de
 * cartes pour les lecteurs d'écran, la place de sortie. Le nom d'une carte
 * seule et d'une pose viennent du moteur (deck.ts), pour parler comme le journal.
 */

/** « Dame de cœur, 7 de pique et As de trèfle ». */
export function cardsLabel(cards: PresidentCard[]): string {
  const names = cards.map(cardLabel);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** 0 → « 1er », 3 → « 4e ». */
export function placeLabel(place: number): string {
  return place === 0 ? '1er' : `${place + 1}e`;
}

/**
 * 0 → « 1re place » : la place, au féminin, accorde la phrase sans deviner
 * qui la lit (« Tu as fini à la 1re place », pas « Tu es sorti 1er »).
 */
export function placeName(place: number): string {
  return `${place === 0 ? '1re' : `${place + 1}e`} place`;
}

/** « 1 carte », « 2 cartes ». */
export function cardCount(n: number): string {
  return `${n} carte${n > 1 ? 's' : ''}`;
}
