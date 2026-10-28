import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../../social/components/Modal';
import { LATEST_PATCH, type PatchNote } from '../patchNotes';
import { EventPopup } from './site';

const SEEN_KEY = 'plafee-patch-seen';

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Le contenu d'une note : ses rubriques et leurs points. */
export function PatchNoteBody({ note }: { note: PatchNote }) {
  return (
    <div className="plf-patch-body">
      {note.sections.map((s) => (
        <section key={s.title} className="plf-patch-section">
          <h3>{s.title}</h3>
          <ul>
            {s.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Les fenêtres de l'ouverture du site, une à la fois : la note de mise à jour
 * tant que le joueur ne l'a pas vue, puis l'événement en cours.
 */
export function LaunchPopups() {
  const [seen, setSeen] = useState(readSeen);
  if (seen === LATEST_PATCH.version) return <EventPopup />;

  const close = () => {
    setSeen(LATEST_PATCH.version);
    try {
      localStorage.setItem(SEEN_KEY, LATEST_PATCH.version);
    } catch {
      // Revue à la prochaine visite.
    }
  };

  return (
    <Modal open onClose={close} title="Nouveautés">
      <div className="plf-patch-pop">
        <p className="plf-patch-date">Mise à jour du {LATEST_PATCH.date}</p>
        <h3 className="plf-patch-title">{LATEST_PATCH.title}</h3>
        <PatchNoteBody note={LATEST_PATCH} />
        <div className="plf-actions">
          <button type="button" className="neon-btn" data-variant="solid" onClick={close}>
            C'est parti
          </button>
          <Link to="/nouveautes" className="neon-btn" data-variant="ghost" onClick={close}>
            Toutes les nouveautés
          </Link>
        </div>
      </div>
    </Modal>
  );
}
