import { Crown, Medal, Toilet, TrendingDown, UserRound, type LucideIcon } from 'lucide-react';
import { ROLE_LABEL } from '../engine/deck';
import type { PresidentRole } from '../engine/types';

/** Une icône par rang, du trône au fond du trou. */
const ROLE_ICON: Record<PresidentRole, LucideIcon> = {
  president: Crown,
  'vice-president': Medal,
  neutre: UserRound,
  'vice-trou': TrendingDown,
  trou: Toilet,
};

/**
 * La pastille d'un rôle. La couleur vient du CSS (`data-role`) : or pour le
 * Président, argent pour son vice, brun pour le bas de la table. `compact`
 * ne garde que l'icône, le nom passant en infobulle et en texte masqué.
 */
export function RoleBadge({ role, compact = false, className }: { role: PresidentRole; compact?: boolean; className?: string }) {
  const Icon = ROLE_ICON[role];
  const label = ROLE_LABEL[role];
  return (
    <span
      className={`pres-role${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}
      data-role={role}
      title={compact ? label : undefined}
    >
      <Icon size={compact ? 13 : 14} strokeWidth={2.4} aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  );
}
