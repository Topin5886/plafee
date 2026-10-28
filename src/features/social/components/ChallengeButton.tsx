import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords } from 'lucide-react';
import { useAuth } from '../../account/useAuth';
import { GAME_LABELS } from '../../account/types';
import { INVITABLE_GAMES, PLAYER_COUNTS, fewestPlayers, gameRoomPath, newRoomCode } from '../gameRooms';
import * as api from '../api';
import type { GameTypeId } from '../../account/types';

/**
 * « Défier » : ouvrir une room, y inviter l'ami, et s'y installer comme hôte.
 *
 * L'invitation part avant la navigation : si elle échoue (l'ami vient de
 * nous retirer, par exemple), on reste sur la page avec le message plutôt que
 * d'attendre seul à une table où personne ne viendra.
 */
export function ChallengeButton({ friendId, friendName }: { friendId: string; friendName: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function challenge(game: GameTypeId) {
    if (!profile) return;
    setBusy(true);
    setError(null);
    const code = newRoomCode(game);
    try {
      await api.inviteToGame(friendId, game, code);
      panelRef.current?.hidePopover();
      // Les jeux à nombre de places réglable reçoivent leur minimum : à trois,
      // un défi au Président attend un seul joueur de plus (un autre ami, invité
      // depuis la table), pas deux. Les autres gardent le défaut de leur room.
      const seats = PLAYER_COUNTS[game] ? { maxPlayers: fewestPlayers(game) } : {};
      navigate(gameRoomPath(game, code), { state: { isHost: true, name: profile.username, ...seats } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation impossible.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="soc-pill" data-tone="accept" popoverTarget={panelId}>
        <Swords size={14} aria-hidden /> Défier
      </button>
      <div id={panelId} ref={panelRef} popover="auto" className="soc-menu acc-scope">
        <p className="soc-menu-title">Défier {friendName} à…</p>
        <ul>
          {INVITABLE_GAMES.map((game) => (
            <li key={game}>
              <button type="button" disabled={busy} onClick={() => void challenge(game)}>
                {GAME_LABELS[game]}
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <p className="neon-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
