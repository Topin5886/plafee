import { Sparkles } from 'lucide-react';
import { SocialPage } from '../../social/components/SocialPage';
import { PATCH_NOTES } from '../patchNotes';
import { PatchNoteBody } from '../components/patchNotes';

/** Toutes les notes de mise à jour, la plus récente en tête. */
export function PatchNotesPage() {
  return (
    <SocialPage public>
      <section className="acc-card acc-card-wide">
        <h1 className="acc-title">
          <Sparkles size={26} aria-hidden /> Nouveautés
        </h1>
        <p className="acc-subtitle">Ce qui a changé dans la salle, mise à jour après mise à jour.</p>
        {PATCH_NOTES.map((note) => (
          <article key={note.version} className="plf-patch-entry">
            <header>
              <h2 className="ach-group-title">{note.title}</h2>
              <span className="plf-patch-date">{note.date}</span>
            </header>
            <PatchNoteBody note={note} />
          </article>
        ))}
      </section>
    </SocialPage>
  );
}
