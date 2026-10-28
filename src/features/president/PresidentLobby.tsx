import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Check, Zap } from 'lucide-react';
import { BotPlayCard } from '../bots/BotPlayCard';
import { botRoomCode, type BotSetup } from '../bots/bots';
import { GameTitle } from '../../components/GameTitle';
import { PresidentRulesModal } from './components/PresidentRulesModal';
import { usePlayerName, savePseudo } from '../rooms/playerName';
import { SessionVisibility, type Visibility } from '../rooms/SessionVisibility';
import { SessionsLink } from '../rooms/SessionsLink';
import { DEFAULT_MANCHES, MANCHE_CHOICES, MAX_PLAYERS, MIN_PLAYERS, rolesFor } from './engine/rules';
import type { PresidentRole } from './engine/types';
import './president.css';

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const PLAYER_COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

/** « 13 cartes chacun », ou « 18 ou 17 cartes » quand la donne ne tombe pas juste. */
function dealLine(n: number): string {
  const per = Math.floor(52 / n);
  return 52 % n === 0 ? `${per} cartes chacun` : `${per + 1} ou ${per} cartes chacun`;
}

const COUNT_TAGLINE: Record<number, string> = {
  3: 'Président, Neutre et Trou du cul : la version serrée.',
  4: 'Arrivent le Vice-président et le Vice-trou.',
  5: 'La table classique, avec un Neutre au milieu.',
  6: 'Les plis tournent longtemps : gare aux 2.',
  7: 'La grande tablée, sept rôles à se disputer.',
};

const MANCHE_TAGLINE: Record<number, string> = {
  3: 'Une partie rapide.',
  5: 'Le temps de renverser un Président.',
  7: 'Un vrai mandat.',
};

export function PresidentLobby() {
  const navigate = useNavigate();
  // Pré-rempli : le pseudo du compte, ou le dernier tapé sur ce navigateur.
  const [name, setName] = usePlayerName();
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [joinCode, setJoinCode] = useState('');
  const [players, setPlayers] = useState(4);
  const [xOuRien, setXOuRien] = useState(true);
  const [manches, setManches] = useState(DEFAULT_MANCHES);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const requireName = () => {
    if (name.trim()) return true;
    setNameError('Choisis un pseudo pour commencer.');
    return false;
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!requireName()) return;
    savePseudo(name);
    navigate(`/president/${randomRoomCode()}`, {
      state: { isHost: true, visibility, name: name.trim(), maxPlayers: players, xOuRien, manches },
    });
  };

  const handleBots = (bots: BotSetup) => {
    if (!requireName()) return;
    savePseudo(name);
    navigate(`/president/${botRoomCode()}`, {
      state: { isHost: true, name: name.trim(), bots, maxPlayers: players, xOuRien, manches },
    });
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!requireName()) return;
    if (!joinCode.trim()) return;
    savePseudo(name);
    navigate(`/president/${joinCode.trim().toUpperCase()}`, {
      state: { isHost: false, name: name.trim() },
    });
  };

  return (
    <div className="container p4-lobby pres-lobby">
      <PresidentRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} xOuRien={xOuRien} manches={manches} />

      <header className="p4-lobby-header">
        <GameTitle as="h1" game="president" size="xl" motto />
        <p>
          Le jeu de cartes des fins de soirée : vide ta main avant les autres, coupe au 2, et grimpe du Trou du cul
          jusqu'au trône.
        </p>
        <button type="button" className="btn btn-outline p4-rules-link" onClick={() => setRulesOpen(true)}>
          <BookOpen size={15} /> Règles du jeu
        </button>
      </header>

      <div className="p4-lobby-name">
        <label htmlFor="pres-pseudo">Ton pseudo</label>
        <input
          id="pres-pseudo"
          type="text"
          maxLength={18}
          placeholder="ex: Jules"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {nameError && <p className="p4-form-error">{nameError}</p>}
      </div>

      <section className="p4-mode-picker">
        <h2>Nombre de joueurs</h2>
        <div className="p4-mode-grid pres-count-grid" role="radiogroup" aria-label="Nombre de joueurs">
          {PLAYER_COUNTS.map((count) => {
            const active = players === count;
            const roles: PresidentRole[] = rolesFor(count);
            return (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={active}
                className={`p4-mode-card${active ? ' is-active' : ''}`}
                onClick={() => setPlayers(count)}
              >
                <span className="p4-mode-top">
                  <span className="p4-mode-label">{count} joueurs</span>
                  {active && (
                    <span className="p4-mode-check">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </span>
                {/* Un siège par joueur, teinté du rôle qu'il pourra gagner. */}
                <span className="pres-mode-seats" aria-hidden>
                  {roles.map((role, i) => (
                    <span key={i} className="pres-mode-seat" data-role={role} />
                  ))}
                </span>
                <span className="p4-mode-tagline">
                  {COUNT_TAGLINE[count]} {dealLine(count)}.
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pres-options">
        <button
          type="button"
          role="switch"
          aria-checked={xOuRien}
          className={`uno-toggle pres-toggle${xOuRien ? ' is-on' : ''}`}
          onClick={() => setXOuRien((v) => !v)}
        >
          <span className="uno-toggle-track">
            <span className="uno-toggle-thumb" />
          </span>
          <span className="uno-toggle-text">
            <span className="uno-toggle-label">
              <Zap size={15} /> Règle « X ou rien »
            </span>
            <span className="uno-toggle-sub">
              {xOuRien
                ? 'Reposer la même valeur que la pose d’avant force le suivant : « 7 ou rien ! » — il pose un 7 ou il passe.'
                : 'Désactivée : reposer la même valeur n’impose rien, le suivant peut toujours monter.'}
            </span>
          </span>
        </button>

        <div className="pres-manches">
          <span className="pres-manches-label" id="pres-manches-label">
            Nombre de manches
          </span>
          <div className="pres-seg" role="radiogroup" aria-labelledby="pres-manches-label">
            {MANCHE_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={manches === m}
                className={`pres-seg-btn${manches === m ? ' is-active' : ''}`}
                onClick={() => setManches(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="pres-manches-sub">{MANCHE_TAGLINE[manches] ?? ''}</span>
        </div>
      </section>

      <div className="p4-lobby-grid">
        <BotPlayCard
          className="p4-lobby-card"
          fixedCount={players - 1}
          fixedNote="selon le nombre de joueurs choisi plus haut"
          onPlay={handleBots}
        />

        <form className="p4-lobby-card" onSubmit={handleCreate}>
          <h2>Créer une partie</h2>
          <p>
            Un code de room sera généré. Partage-le à tes potes : il faut être <strong>{players}</strong> pour lancer
            la partie, en <strong>{manches} manches</strong>.
          </p>
          <SessionVisibility value={visibility} onChange={setVisibility} />
          <button type="submit" className="btn btn-primary">
            Créer la room
          </button>
        </form>

        <form className="p4-lobby-card" onSubmit={handleJoin}>
          <h2>Rejoindre une partie</h2>
          <p>Entre le code de room que ton pote t'a envoyé. C'est l'hôte qui choisit les options.</p>
          <input
            type="text"
            placeholder="Code de room"
            maxLength={8}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className="p4-code-input"
            aria-label="Code de room"
          />
          <button type="submit" className="btn btn-outline" disabled={!joinCode.trim()}>
            Rejoindre
          </button>
          <SessionsLink />
        </form>
      </div>
    </div>
  );
}
