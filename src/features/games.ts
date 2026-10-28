import { BottleWine, Crown, Dices, Disc, Grid3x3, Layers, Spade, type LucideIcon } from 'lucide-react';
import type { GameTypeId } from './account/types';

/** Les jeux de La Cafétéria, tels que l'accueil les présente. */
export interface GameEntry {
  id: GameTypeId;
  name: string;
  tagline: string;
  players: string;
  icon: LucideIcon;
  to: string;
}

export const GAMES: GameEntry[] = [
  { id: 'flip7', name: 'Flip 7', tagline: 'Une carte de plus ? Évite le doublon.', players: '1 à 5 joueurs', icon: Dices, to: '/flip7' },
  { id: 'scopa', name: 'Scopa', tagline: 'Le jeu de cartes italien.', players: '2 à 4 joueurs', icon: Spade, to: '/scopa' },
  { id: 'uno', name: 'UNO', tagline: 'Cartes mystère et Contre UNO.', players: '2 à 4 joueurs', icon: Layers, to: '/uno' },
  { id: 'president', name: 'Président', tagline: 'Sors en premier. Le Trou du cul paie.', players: '3 à 7 joueurs', icon: Crown, to: '/president' },
  { id: 'puissance4', name: 'P4 Forge', tagline: 'Quatre alignés, avec des pouvoirs.', players: '2 à 4 joueurs', icon: Grid3x3, to: '/puissance4' },
  { id: 'puissance4-original', name: 'P4 Classic', tagline: 'Le classique, sans pouvoirs.', players: '2 à 4 joueurs', icon: Disc, to: '/puissance4-original' },
  { id: 'verite', name: 'Roulette de Vérité', tagline: 'La bouteille tourne. Le chef tranche.', players: '2 à 6 joueurs + 1 chef', icon: BottleWine, to: '/verite' },
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
