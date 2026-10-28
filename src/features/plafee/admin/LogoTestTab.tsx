import { useState } from 'react';
import { Play } from 'lucide-react';
import { PlafeeMark, PlafeeWordmark } from '../../../components/brand/PlafeeLogo';

/**
 * Un banc d'essai pour l'animation du logo.
 *
 * Le logo s'allume déjà au montage de l'accueil (voir `brand.css`), mais un
 * réglage d'animation se juge mal depuis une page qu'on ne recharge pas. Ce
 * panneau rejoue la séquence à la demande, sans rien écrire en base : la clé
 * `run` remonte les deux SVG, et leurs animations CSS repartent de zéro.
 */
export function LogoTestTab() {
  const [run, setRun] = useState(0);

  return (
    <section className="acc-card acc-card-wide adm-logo-test">
      <div className="adm-row-between">
        <h2 className="acc-section-title">Test d'animation du logo</h2>
        <button
          type="button"
          className="neon-btn adm-btn"
          data-variant="solid"
          onClick={() => setRun((n) => n + 1)}
        >
          <Play size={14} aria-hidden /> Lancer l'animation
        </button>
      </div>
      <p className="neon-hint">
        Les flammes du symbole s'allument une à une, puis le lettrage, avant un balayage
        lumineux. Le bouton rejoue la séquence — rien n'est enregistré.
      </p>

      <div className="adm-logo-stage">
        <div className="adm-logo-lockup" key={run}>
          <PlafeeMark animated className="adm-logo-mark" />
          <PlafeeWordmark animated className="adm-logo-wordmark" />
        </div>
        <span className="adm-logo-scan" key={`scan-${run}`} aria-hidden />
      </div>

      <p className="neon-hint" role="status">
        {run === 0 ? 'Animation jouée à l\'ouverture de l\'onglet.' : `Animation relancée ${run} fois.`}
      </p>
    </section>
  );
}
