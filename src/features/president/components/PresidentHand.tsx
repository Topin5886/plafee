import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { cardLabel, sortHand } from '../engine/deck';
import type { PresidentCard } from '../engine/types';
import { PresidentCardFace } from './PresidentCard';
import { cardCount } from './labels';

interface PresidentHandProps {
  cards: PresidentCard[];
  /** Cliquable seulement quand il y a quelque chose à faire : jouer, ou donner à l'échange. */
  enabled: boolean;
  selected: string[];
  /** Les cartes qui ne peuvent rien sur ce pli : atténuées et hors d'atteinte. */
  isDimmed?: (card: PresidentCard) => boolean;
  /** Reçues à l'échange de cette manche : marquées d'un point, pour qu'on les retrouve. */
  received?: Set<string>;
  onToggle: (card: PresidentCard) => void;
}

/**
 * La main du joueur, rangée par valeur et regroupée : au Président on joue
 * des paquets (paire, brelan, carré), alors la main les montre comme tels.
 * Dans un groupe, les cartes se chevauchent juste assez pour qu'on lise
 * chaque index.
 *
 * La largeur des cartes se calcule sur la largeur de la main (requête de
 * conteneur, voir `.pres-hand-card`) à partir du nombre de groupes et de
 * cartes en plus : au bureau, même 18 cartes tiennent sur une ligne, sous
 * les boutons ; sur un téléphone, deux rangées au plus.
 *
 * Contrairement à UNO, l'écran aide ici : quand on suit, les valeurs
 * impossibles s'atténuent. Au Président, le choix difficile n'est pas « qu'ai-je
 * le droit de poser » mais « que vaut-il mieux garder ».
 */
export function PresidentHand({ cards, enabled, selected, isDimmed, received, onToggle }: PresidentHandProps) {
  const groups: PresidentCard[][] = [];
  for (const card of sortHand(cards)) {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === card.rank) last.push(card);
    else groups.push([card]);
  }

  const fit = { '--groups': Math.max(groups.length, 1), '--extra': cards.length - groups.length } as CSSProperties;

  return (
    <div
      className="pres-hand"
      role="group"
      aria-label={`Ta main : ${cardCount(cards.length)}`}
      data-enabled={enabled || undefined}
      style={fit}
    >
      {groups.map((group) => (
        <div key={group[0].rank} className="pres-hand-group" data-size={group.length}>
          {group.map((card) => {
            const isSelected = selected.includes(card.id);
            const dim = Boolean(isDimmed?.(card));
            const isReceived = Boolean(received?.has(card.id));
            const usable = enabled && !dim;
            return (
              <motion.button
                key={card.id}
                type="button"
                layout="position"
                className="pres-hand-card"
                data-selected={isSelected || undefined}
                data-dim={(enabled && dim) || undefined}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: isSelected ? -16 : 0 }}
                transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                disabled={!usable}
                aria-pressed={isSelected}
                aria-label={`${cardLabel(card)}${isReceived ? ', reçue à l’échange' : ''}`}
                title={enabled && dim ? `${cardLabel(card)} : ne passe pas sur ce pli` : cardLabel(card)}
                onClick={() => usable && onToggle(card)}
              >
                <PresidentCardFace card={card} />
                {isReceived && <span className="pres-hand-received" aria-hidden />}
              </motion.button>
            );
          })}
        </div>
      ))}
      {cards.length === 0 && <p className="pres-hand-empty">Plus une carte en main.</p>}
    </div>
  );
}
