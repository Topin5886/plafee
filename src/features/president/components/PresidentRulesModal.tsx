import { motion } from 'framer-motion';
import { ArrowLeftRight, Crown, Layers, ListOrdered, Scissors, Target, X, Zap } from 'lucide-react';
import { PresidentCardFace } from './PresidentCard';
import type { PresidentCard } from '../engine/types';

interface PresidentRulesModalProps {
  open: boolean;
  onClose: () => void;
  xOuRien?: boolean;
  manches?: number;
}

/** L'échelle des valeurs, du 3 au 2, en vraies cartes. */
const LADDER: PresidentCard[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((rank, i) => ({
  id: `regle-${rank}`,
  rank,
  suit: (['spades', 'hearts', 'clubs', 'diamonds'] as const)[i % 4],
}));

export function PresidentRulesModal({ open, onClose, xOuRien = true, manches = 3 }: PresidentRulesModalProps) {
  if (!open) return null;

  // Plein écran : retiré d'un bloc plutôt qu'animé en sortie, pour qu'il ne
  // puisse jamais traîner et avaler un clic destiné à la table.
  return (
    <motion.div className="p4-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div
        className="p4-modal p4-rules-modal pres-rules"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pres-rules-title"
      >
        <div className="p4-modal-header">
          <h2 id="pres-rules-title">Règles du Président</h2>
          <button type="button" className="p4-modal-close" onClick={onClose} aria-label="Fermer" autoFocus>
            <X size={18} />
          </button>
        </div>

        <div className="p4-modal-body">
          <section className="p4-rule-section">
            <h3>
              <Target size={17} className="p4-rule-icon" /> Objectif
            </h3>
            <p>
              Se débarrasser de toutes ses cartes <strong>le premier</strong>. L'ordre de sortie donne les rôles de la
              manche suivante : le premier sorti devient <strong>Président</strong>, le dernier{' '}
              <strong>Trou du cul</strong>. De 3 à 7 joueurs, avec un jeu de 52 cartes entièrement distribué (les
              premiers servis ont une carte de plus si la donne tombe mal).
            </p>
          </section>

          <section className="p4-rule-section">
            <h3>
              <ListOrdered size={17} className="p4-rule-icon" /> L'ordre des cartes
            </h3>
            <div className="pres-rules-ladder" role="img" aria-label="Du plus faible au plus fort : 3, 4, 5, 6, 7, 8, 9, 10, Valet, Dame, Roi, As, 2">
              {LADDER.map((c) => (
                <span key={c.id} className="pres-rules-card">
                  <PresidentCardFace card={c} />
                </span>
              ))}
            </div>
            <p>
              Du plus faible au plus fort : 3, 4, 5, 6, 7, 8, 9, 10, Valet, Dame, Roi, As et <strong>le 2</strong>, la
              carte la plus forte. Les couleurs ne comptent jamais.
            </p>
          </section>

          <section className="p4-rule-section">
            <h3>
              <Layers size={17} className="p4-rule-icon" /> Les plis
            </h3>
            <ul className="p4-rule-list">
              <li>
                Celui qui ouvre pose <strong>1, 2, 3 ou 4 cartes de même valeur</strong> (simple, paire, brelan ou
                carré). Il ne peut pas passer.
              </li>
              <li>
                Les suivants posent <strong>le même nombre</strong> de cartes, d'une valeur{' '}
                <strong>égale ou supérieure</strong>, ou passent.
              </li>
              <li>
                Passer n'exclut pas du pli : tu peux rejouer au tour suivant si ça revient à toi.
              </li>
              <li>
                Quand tout le monde a passé après une pose, le pli est fermé : <strong>le dernier à avoir posé</strong>{' '}
                ouvre le suivant.
              </li>
            </ul>
          </section>

          <section className="p4-rule-section">
            <h3>
              <Scissors size={17} className="p4-rule-icon" /> Le 2 et le carré coupent
            </h3>
            <p>
              Poser un ou plusieurs <strong>2</strong>, ou un <strong>carré</strong> (quatre cartes de même valeur
              d'un coup), ferme le pli sur-le-champ : celui qui l'a posé rouvre aussitôt avec ce qu'il veut.
            </p>
          </section>

          <section className="p4-rule-section">
            <h3>
              <Zap size={17} className="p4-rule-icon" /> X ou rien
              <span className="uno-rule-flag">{xOuRien ? 'activé' : 'désactivé'}</span>
            </h3>
            {xOuRien ? (
              <p>
                Si quelqu'un pose <strong>la même valeur</strong> que la pose précédente, le joueur suivant doit
                poser cette valeur (autant de cartes) <strong>ou passer</strong> : « 7 ou rien ! ». La contrainte ne
                vaut que pour lui, sauf s'il repose encore la même valeur : elle passe alors au suivant.
              </p>
            ) : (
              <p>
                Désactivé pour cette table : reposer la même valeur n'impose rien au suivant, qui peut toujours
                monter. L'hôte règle l'option avant de lancer la partie.
              </p>
            )}
          </section>

          <section className="p4-rule-section">
            <h3>
              <Crown size={17} className="p4-rule-icon" /> Sorties et rôles
            </h3>
            <p>
              Un joueur sans carte sort. Si c'était à lui de rouvrir le pli, la main passe au joueur suivant encore en
              jeu. La manche s'arrête quand il ne reste qu'un joueur avec des cartes : il finit Trou du cul.
            </p>
            <ul className="p4-rule-list">
              <li>
                <strong>Président</strong> : le premier sorti.
              </li>
              <li>
                <strong>Vice-président</strong> : le deuxième (à partir de 4 joueurs).
              </li>
              <li>
                <strong>Neutres</strong> : les places du milieu.
              </li>
              <li>
                <strong>Vice-trou</strong> : l'avant-dernier (à partir de 4 joueurs).
              </li>
              <li>
                <strong>Trou du cul</strong> : le dernier.
              </li>
            </ul>
          </section>

          <section className="p4-rule-section">
            <h3>
              <ArrowLeftRight size={17} className="p4-rule-icon" /> L'échange
            </h3>
            <p>
              À partir de la deuxième manche, avant de jouer : le <strong>Trou du cul</strong> donne d'office ses{' '}
              <strong>2 meilleures cartes</strong> au Président, qui lui en rend 2 de son choix. Dès 4 joueurs, le{' '}
              <strong>Vice-trou</strong> donne sa meilleure carte au Vice-président, qui lui en rend une. Le Trou du
              cul ouvre ensuite la manche (en première manche, c'est le détenteur de la Dame de cœur).
            </p>
          </section>

          <section className="p4-rule-section">
            <h3>Points et manches</h3>
            <p>
              Chaque manche rapporte des points selon la place : à <em>n</em> joueurs, le Président marque{' '}
              <em>n</em> − 1, le suivant <em>n</em> − 2… et le Trou du cul 0. La partie se joue en{' '}
              <strong>{manches} manches</strong> ; le plus gros total gagne, et à égalité, la meilleure place de la
              dernière manche départage.
            </p>
            <p className="p4-rule-note">
              Un joueur qui quitte la table est sauté. Il est classé derrière ceux qui ont fini la manche, et un
              observateur peut reprendre sa place à la donne suivante.
            </p>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}
