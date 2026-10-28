import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Markdown } from './Markdown';
import mentions from './content/mentions-legales.md?raw';
import confidentialite from './content/confidentialite.md?raw';
import cgu from './content/cgu.md?raw';
import './legal.css';

const PAGES = {
  'mentions-legales': { source: mentions },
  confidentialite: { source: confidentialite },
  cgu: { source: cgu },
} as const;

export type LegalPageId = keyof typeof PAGES;

export function LegalPage({ page }: { page: LegalPageId }) {
  const { source } = PAGES[page];
  const { hash } = useLocation();

  // « /cgu#8-sanctions » depuis le lien « Contester » : descendre au bon titre.
  useEffect(() => {
    if (!hash) return;
    const timer = window.setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }), 50);
    return () => window.clearTimeout(timer);
  }, [hash, page]);

  return (
    <div className="container">
      <article className="legal-page">
        <Markdown source={source} />
      </article>
    </div>
  );
}

export default LegalPage;
