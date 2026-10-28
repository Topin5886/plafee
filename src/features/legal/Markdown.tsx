import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/*
 * Juste ce qu'il faut de Markdown pour les pages légales : titres, paragraphes,
 * listes, tableaux, gras, italique et liens. Le texte vient du dépôt, jamais
 * d'un joueur : rien n'est interprété comme du HTML.
 */

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = out.length;
    if (m[1] !== undefined) out.push(<strong key={key}>{inline(m[1])}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key}>{inline(m[2])}</em>);
    else if (m[3] !== undefined) out.push(<LegalLink key={key} href={m[4]}>{inline(m[3])}</LegalLink>);
    else out.push(<LegalLink key={key} href={m[5]}>{m[5]}</LegalLink>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/')) return <Link to={href}>{children}</Link>;
  const external = href.startsWith('http');
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {children}
    </a>
  );
}

/** « Sanctions » → « sanctions » : l'ancre d'un titre, pour /cgu#8-sanctions. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      blocks.push(
        <Tag key={key} id={slug(heading[2])}>
          {inline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      blocks.push(
        <div key={key} className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                {cells(head).map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {cells(r).map((c, j) => (
                    <td key={j}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*(-|\d+\.)\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i])) items.push(lines[i++].replace(bullet, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // Paragraphe : les lignes qui se suivent, chacune à la ligne (adresses).
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*(-|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <>{blocks}</>;
}
