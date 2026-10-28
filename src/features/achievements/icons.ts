import {
  Award,
  BadgeCheck,
  Brain,
  Building2,
  Cake,
  CalendarCheck,
  Castle,
  ChefHat,
  Coffee,
  Coins,
  Crown,
  Dices,
  Disc,
  Feather,
  Flame,
  Footprints,
  Gem,
  Grid2x2,
  Grid3x3,
  Hammer,
  Hand,
  Heart,
  HeartHandshake,
  HeartPulse,
  Infinity as InfinityIcon,
  Joystick,
  Landmark,
  Layers,
  Medal,
  MessageCircle,
  MessagesSquare,
  PartyPopper,
  PiggyBank,
  Rocket,
  Scissors,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Shuffle,
  Spade,
  Sparkle,
  Sparkles,
  Star,
  Stars,
  Sun,
  Swords,
  Tornado,
  TrendingUp,
  Trophy,
  Users,
  Vote,
  Wine,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Les icônes des trophées et des badges, par le nom que la base leur donne.
 * Une table explicite plutôt qu'un import dynamique de toute la bibliothèque :
 * seules ces icônes entrent dans le bundle. Un nom inconnu (trophée créé par
 * un admin) retombe sur la médaille.
 */
const ICONS: Record<string, LucideIcon> = {
  Award, BadgeCheck, Brain, Building2, Cake, CalendarCheck, Castle, ChefHat, Coffee, Coins, Crown, Dices, Disc,
  Feather, Flame, Footprints, Gem, Grid2x2, Grid3x3, Hammer, Hand, Heart, HeartHandshake, HeartPulse,
  Infinity: InfinityIcon, Joystick, Landmark, Layers, Medal, MessageCircle, MessagesSquare, PartyPopper, PiggyBank,
  Rocket, Scissors, Shield, ShieldCheck, ShoppingBag, Shuffle, Spade, Sparkle, Sparkles, Star, Stars, Sun, Swords,
  Tornado, TrendingUp, Trophy, Users, Vote, Wine, Zap,
};

export const ICON_NAMES = Object.keys(ICONS).sort();

export const achievementIcon = (name: string | null | undefined): LucideIcon => (name && ICONS[name]) || Award;
