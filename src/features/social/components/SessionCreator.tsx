import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Lock, Play } from 'lucide-react';
import { useAuth } from '../../account/useAuth';
import { GAME_LABELS, type GameTypeId } from '../../account/types';
import { MODES, MODE_ORDER, ORIGINAL_MODES } from '../../puissance4/engine/modes';
import type { P4Mode } from '../../puissance4/engine/types';
import { INVITABLE_GAMES, PLAYER_COUNTS, fewestPlayers, gameRoomPath, newRoomCode } from '../gameRooms';
import * as api from '../api';
import { Modal } from './Modal';

/**
 * « Crée ta session » : jeu, visibilité, nombre de joueurs — puis la table.
 *
 * Ouvert depuis le panneau d'amis quand on invite quelqu'un sans être assis à
 * une table : l'invitation part avec la table, en un seul geste. Les salons de
 * chaque jeu gardent leurs propres options plus fines (surenchère UNO, règles
 * Flip 7…) ; ici, on prend leurs valeurs par défaut.
 */
export function SessionCreator({
  open,
  onClose,
  invitee,
}: {
  open: boolean;
  onClose: () => void;
  invitee?: { id: string; username: string } | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Crée ta session" variant="casino">
      <CreatorForm onClose={onClose} invitee={invitee ?? null} />
    </Modal>
  );
}

function CreatorForm({ onClose, invitee }: { onClose: () => void; invitee: { id: string; username: string } | null }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameTypeId>('uno');
  const [isPublic, setIsPublic] = useState(true);
  const [count, setCount] = useState(2);
  const [mode, setMode] = useState<P4Mode>('duel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = PLAYER_COUNTS[game];
  const p4Modes = game === 'puissance4' ? MODES : game === 'puissance4-original' ? ORIGINAL_MODES : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    const code = newRoomCode(game);
    try {
      // L'invitation d'abord : si elle échoue, on ne s'installe pas seul à une
      // table où personne ne viendra.
      if (invitee) await api.inviteToGame(invitee.id, game, code);
      onClose();
      navigate(gameRoomPath(game, code), {
        state: {
          isHost: true,
          name: profile.username,
          visibility: isPublic ? 'public' : 'private',
          // Le Président lit `maxPlayers` et garde ses autres réglages par
          // défaut (« X ou rien » activé, 3 manches) : on les change au salon.
          maxPlayers: count,
          mode: game === 'flip7' ? 'online' : mode,
          ...(game === 'flip7' ? { difficulty: 'medium', ruleset: 'official' } : {}),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
      setBusy(false);
    }
  }

  return (
    <form className="sess-form" onSubmit={submit}>
      {invitee && (
        <p className="sess-invitee">
          <strong>{invitee.username}</strong> recevra une invitation dès la table créée.
        </p>
      )}

      <fieldset className="sess-field">
        <legend>Jeu</legend>
        <div className="sess-chips">
          {INVITABLE_GAMES.map((g) => (
            <button
              key={g}
              type="button"
              className="sess-chip"
              aria-pressed={game === g}
              onClick={() => {
                setGame(g);
                setCount(fewestPlayers(g));
                setMode('duel');
              }}
            >
              {GAME_LABELS[g]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="sess-field">
        <legend>Visibilité</legend>
        <div className="sess-chips sess-chips-2">
          <button type="button" className="sess-chip sess-chip-lg" aria-pressed={isPublic} onClick={() => setIsPublic(true)}>
            <Globe size={17} aria-hidden />
            <span>
              <strong>Publique</strong>
              <small>Tes amis la voient</small>
            </span>
          </button>
          <button type="button" className="sess-chip sess-chip-lg" aria-pressed={!isPublic} onClick={() => setIsPublic(false)}>
            <Lock size={17} aria-hidden />
            <span>
              <strong>Privée</strong>
              <small>Invitations seulement</small>
            </span>
          </button>
        </div>
      </fieldset>

      {counts && (
        <fieldset className="sess-field">
          <legend>Nombre de joueurs</legend>
          <div className="sess-chips">
            {counts.map((n) => (
              <button key={n} type="button" className="sess-chip" aria-pressed={count === n} onClick={() => setCount(n)}>
                {n} joueurs
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {p4Modes && (
        <fieldset className="sess-field">
          <legend>Mode</legend>
          <div className="sess-chips">
            {MODE_ORDER.map((id) => (
              <button key={id} type="button" className="sess-chip" aria-pressed={mode === id} onClick={() => setMode(id)}>
                {p4Modes[id].label} · {p4Modes[id].players} joueurs
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {game === 'scopa' && <p className="sess-note">La Scopa se joue de 2 à 4 : tu lances quand la table te convient.</p>}

      {error && (
        <p className="sess-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="sess-primary" disabled={busy}>
        <Play size={17} aria-hidden /> {invitee ? 'Créer et inviter' : 'Créer la session'}
      </button>
    </form>
  );
}
