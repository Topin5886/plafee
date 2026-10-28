import { motion } from 'framer-motion';
import { Crown, Layers, Scissors, Shuffle, Toilet, Trophy, Zap, type LucideIcon } from 'lucide-react';

export type FlashTone = 'gold' | 'neon' | 'magenta' | 'cyan' | 'brown';
export type FlashIcon = 'crown' | 'quad' | 'two' | 'forced' | 'out' | 'trou' | 'deal';

export interface PresidentShot {
  key: number;
  title: string;
  sub?: string;
  tone: FlashTone;
  icon: FlashIcon;
}

const ICONS: Record<FlashIcon, LucideIcon> = {
  crown: Crown,
  quad: Layers,
  two: Scissors,
  forced: Zap,
  out: Trophy,
  trou: Toilet,
  deal: Shuffle,
};

/** Durée d'une annonce, en secondes. La room la retire un peu après. */
export const FLASH_SECONDS = 1.5;

/**
 * Les annonces de la table : « PRÉSIDENT ! », « CARRÉ ! », « 7 ou rien ! »…
 *
 * Sobres et rapides, contrairement au grand « UNO ! » : au Président les
 * coups s'enchaînent, et une annonce qui traînerait masquerait le pli
 * suivant. Une bande posée au milieu de la table (PresidentTable la rend),
 * jamais un plein écran ; `pointer-events: none`, donc on continue de jouer
 * dessous.
 *
 * Décoratives : l'information est aussi dans la puce du pli et dans le
 * journal. En mode calme, l'annonce reste mais sans balayage ni zoom : un
 * simple fondu (les retours ponctuels ne sont pas les animations
 * permanentes que ce mode coupe). Le mouvement réduit du système est géré
 * par le MotionConfig de la room. Sans AnimatePresence, comme les annonces
 * d'UNO : la disparition est dans les images clés.
 */
export function PresidentFlash({ shot }: { shot: PresidentShot | null }) {
  if (!shot) return null;
  const Icon = ICONS[shot.icon];
  const calm = typeof document !== 'undefined' && document.documentElement.dataset.fx === 'calm';

  return (
    <div className="pres-flash" aria-hidden="true">
      <motion.div
        key={shot.key}
        className="pres-flash-band"
        data-tone={shot.tone}
        initial={calm ? { opacity: 0 } : { opacity: 0, scaleX: 0.3, y: -12 }}
        animate={
          calm
            ? { opacity: [0, 1, 1, 0] }
            : { opacity: [0, 1, 1, 0], scaleX: [0.3, 1.04, 1, 1], y: [-12, 0, 0, -6] }
        }
        transition={{ duration: FLASH_SECONDS, times: [0, 0.14, 0.8, 1], ease: 'easeOut' }}
      >
        <span className="pres-flash-icon">
          <Icon size={22} strokeWidth={2.4} />
        </span>
        <span className="pres-flash-text">
          <span className="pres-flash-title">{shot.title}</span>
          {shot.sub && <span className="pres-flash-sub">{shot.sub}</span>}
        </span>
        {!calm && (
          <motion.span
            className="pres-flash-sweep"
            initial={{ x: '-120%' }}
            animate={{ x: '220%' }}
            transition={{ duration: 0.7, delay: 0.12, ease: 'easeOut' }}
          />
        )}
      </motion.div>
    </div>
  );
}
