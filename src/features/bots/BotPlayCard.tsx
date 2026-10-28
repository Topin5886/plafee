import { useState, type FormEvent } from 'react';
import { Bot } from 'lucide-react';
import { BOT_CHOICES, type BotChoice, type BotSetup } from './bots';
import './bots.css';

const LEVEL_KEY = 'plafee-bot-level';

function savedLevel(): BotChoice {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (v && BOT_CHOICES.some((c) => c.id === v)) return v as BotChoice;
  } catch {
    /* stockage indisponible : niveau par défaut */
  }
  return 'normal';
}

/**
 * « Contre les bots », dans le salon de chaque jeu : combien d'adversaires
 * (sauf quand le jeu le fixe déjà, par son mode), et quel niveau. La partie
 * entre dans les stats, mais sans points, FEES ni victoire comptée : jouée
 * dans un seul navigateur, personne ne peut la confirmer (migration 0014).
 */
export function BotPlayCard({
  className,
  counts,
  fixedCount,
  fixedNote,
  onPlay,
}: {
  className: string;
  /** Nombres de bots proposés ; ignoré si `fixedCount` est donné. */
  counts?: number[];
  fixedCount?: number;
  /** Pourquoi le nombre est fixé (« selon le mode choisi plus haut »). */
  fixedNote?: string;
  onPlay: (setup: BotSetup) => void;
}) {
  const [count, setCount] = useState(counts?.[0] ?? 1);
  const [level, setLevel] = useState<BotChoice>(savedLevel);
  const n = fixedCount ?? count;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      /* rien à retenir */
    }
    onPlay({ count: n, level });
  };

  return (
    <form className={`${className} bot-card`} onSubmit={submit}>
      <h2>
        <Bot size={20} aria-hidden /> Contre les bots
      </h2>
      <p>Une partie tout de suite, sans attendre personne. Pour t'entraîner : elle entre dans tes parties, sans points ni FEES.</p>

      {fixedCount === undefined && counts && counts.length > 1 ? (
        <div className="bot-row" role="radiogroup" aria-label="Nombre de bots">
          {counts.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={count === c} className="bot-chip" onClick={() => setCount(c)}>
              {c} bot{c > 1 ? 's' : ''}
            </button>
          ))}
        </div>
      ) : (
        <p className="bot-fixed">
          {n} bot{n > 1 ? 's' : ''}
          {fixedNote ? ` · ${fixedNote}` : ''}
        </p>
      )}

      <fieldset className="bot-levels">
        <legend>Difficulté</legend>
        {BOT_CHOICES.map((c) => (
          <label key={c.id} className="bot-level" data-level={c.id}>
            <input type="radio" name="bot-level" value={c.id} checked={level === c.id} onChange={() => setLevel(c.id)} />
            <span className="bot-level-name">{c.label}</span>
            <span className="bot-level-hint">{c.hint}</span>
          </label>
        ))}
      </fieldset>

      <button type="submit" className="btn btn-primary">
        <Bot size={16} aria-hidden /> Jouer contre {n > 1 ? 'les bots' : 'le bot'}
      </button>
    </form>
  );
}
