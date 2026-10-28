import { Link } from 'react-router-dom';
import { CONTACT_EMAIL, LEGAL_LINKS } from './legal';
import './legal.css';

/** Le pied de page de tout le site : les trois pages légales et le contact. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <span>PLAFEE · jeux gratuits entre potes</span>
        <nav aria-label="Informations légales" className="site-footer-links">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label}
            </Link>
          ))}
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </nav>
      </div>
    </footer>
  );
}
