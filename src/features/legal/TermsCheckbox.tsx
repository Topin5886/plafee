import { Link } from 'react-router-dom';
import './legal.css';

/** La case de l'inscription, reprise telle quelle quand les CGU changent. */
export function TermsCheckbox({
  checked,
  onChange,
  error,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="legal-check-field">
      <label className="legal-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          required
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          J'ai 15 ans ou plus (ou l'accord d'un parent) et j'accepte les{' '}
          <Link to="/cgu" target="_blank">
            CGU
          </Link>{' '}
          et la{' '}
          <Link to="/confidentialite" target="_blank">
            politique de confidentialité
          </Link>
          .
        </span>
      </label>
      {error && (
        <p className="neon-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
