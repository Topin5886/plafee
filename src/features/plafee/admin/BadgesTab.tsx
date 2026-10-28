import { useEffect, useState, type FormEvent } from 'react';
import { Gift, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { achievementIcon, ICON_NAMES } from '../../achievements/icons';
import { BADGE_RARITY_LABELS, BADGE_TYPE_LABELS, type BadgeRarity, type BadgeType } from '../api';
import { BadgeChip } from '../components/bits';
import { awardBadge, deleteBadge, getBadgeHolders, getBadges, revokeBadge, upsertBadge, type BadgeRow } from './adminApi';
import { ConfirmAction, Field, Flash, ImagePicker } from './ui';
import { fmtDate, toLocalInput, useFlash } from './helpers';

interface Form {
  id: string | null;
  name: string;
  description: string;
  type: BadgeType;
  rarity: BadgeRarity;
  image_url: string | null;
  color: string;
  icon: string;
  temporary: boolean;
  expiry: string;
  active: boolean;
}

const EMPTY: Form = {
  id: null,
  name: '',
  description: '',
  type: 'title',
  rarity: 'common',
  image_url: null,
  color: '#50ff4d',
  icon: 'Star',
  temporary: false,
  expiry: toLocalInput(new Date(Date.now() + 30 * 86_400_000)),
  active: true,
};

const TYPE_HINTS: Record<BadgeType, string> = {
  title: 'Un titre sous le pseudo (« Maître du Jeu »).',
  visual: 'Une petite icône au coin de l’avatar.',
  border: 'Un contour autour de l’avatar (dans la couleur choisie).',
  plate: 'Une plaque sous le pseudo, avec le nom du badge.',
  temporal: 'Affiché dans les classements tant qu’il n’a pas expiré.',
};

export function BadgesTab() {
  const [list, setList] = useState<BadgeRow[] | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, flash] = useFlash();
  const [nonce, setNonce] = useState(0);
  const [award, setAward] = useState<BadgeRow | null>(null);
  const [holdersOf, setHoldersOf] = useState<BadgeRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBadges()
      .then((l) => !cancelled && setList(l))
      .catch((e: unknown) => flash('error', e instanceof Error ? e.message : 'Chargement impossible.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      flash('error', 'Donne un nom au badge.');
      return;
    }
    try {
      await upsertBadge({
        id: form.id,
        name: form.name.trim(),
        description: form.description,
        type: form.type,
        rarity: form.rarity,
        image_url: form.image_url,
        style: { color: form.color, icon: form.icon, ...(form.type === 'border' ? { border: 'badge' } : {}) },
        expiry: form.temporary || form.type === 'temporal' ? new Date(form.expiry).toISOString() : null,
        active: form.active,
      });
      flash('ok', form.id ? 'Badge modifié.' : 'Badge créé.');
      setForm(EMPTY);
      setNonce((n) => n + 1);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Enregistrement impossible.');
    }
  };

  const edit = (b: BadgeRow) => {
    setForm({
      id: b.id,
      name: b.name,
      description: b.description ?? '',
      type: b.type,
      rarity: b.rarity,
      image_url: b.image_url,
      color: b.style.color ?? '#50ff4d',
      icon: b.style.icon ?? 'Star',
      temporary: Boolean(b.expiry_date),
      expiry: toLocalInput(b.expiry_date ?? new Date(Date.now() + 30 * 86_400_000)),
      active: b.is_active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const Icon = achievementIcon(form.icon);
  const preview: BadgeRow = {
    id: 'preview',
    sku: null,
    name: form.name || 'Aperçu',
    description: form.description,
    type: form.type,
    rarity: form.rarity,
    image_url: form.image_url,
    style: { color: form.color, icon: form.icon },
    is_active: true,
    expiry_date: null,
    created_at: '',
  };

  return (
    <div className="adm-stack">
      <form className="acc-card acc-card-wide adm-form" onSubmit={submit}>
        <h2 className="acc-section-title">
          {form.id ? <Pencil size={17} aria-hidden /> : <Plus size={17} aria-hidden />} {form.id ? `Modifier « ${form.name} »` : 'Créer un badge'}
        </h2>
        <div className="adm-grid-2">
          <Field label="Nom">
            <input className="neon-input" value={form.name} maxLength={40} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" hint={TYPE_HINTS[form.type]}>
            <select className="neon-input" value={form.type} onChange={(e) => set('type', e.target.value as BadgeType)}>
              {(Object.keys(BADGE_TYPE_LABELS) as BadgeType[]).map((t) => (
                <option key={t} value={t}>
                  {BADGE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rareté">
            <select className="neon-input" value={form.rarity} onChange={(e) => set('rarity', e.target.value as BadgeRarity)}>
              {(Object.keys(BADGE_RARITY_LABELS) as BadgeRarity[]).map((r) => (
                <option key={r} value={r}>
                  {BADGE_RARITY_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Couleur">
            <input className="neon-input adm-color" type="color" value={form.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="Icône">
            <span className="adm-icon-select">
              <Icon size={20} aria-hidden style={{ color: form.color }} />
              <select className="neon-input" value={form.icon} onChange={(e) => set('icon', e.target.value)}>
                {ICON_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
          </Field>
          <Field label="Image (remplace l'icône)">
            <ImagePicker value={form.image_url} onChange={(url) => set('image_url', url)} folder="badges" onError={(m) => flash('error', m)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="neon-input" rows={2} maxLength={300} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <label className="adm-check">
          <input type="checkbox" checked={form.temporary || form.type === 'temporal'} disabled={form.type === 'temporal'} onChange={(e) => set('temporary', e.target.checked)} />{' '}
          Temporaire
        </label>
        {(form.temporary || form.type === 'temporal') && (
          <Field label="Expire le">
            <input className="neon-input" type="datetime-local" value={form.expiry} onChange={(e) => set('expiry', e.target.value)} />
          </Field>
        )}
        <label className="adm-check">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Actif
        </label>
        <p className="adm-preview">
          Aperçu : <BadgeChip badge={{ ...preview, note: null, awarded_at: '' }} />
        </p>
        <Flash msg={msg} />
        <div className="plf-actions">
          <button type="submit" className="neon-btn" data-variant="solid">
            {form.id ? 'Enregistrer' : 'Créer'}
          </button>
          {form.id && (
            <button type="button" className="neon-btn" data-variant="ghost" onClick={() => setForm(EMPTY)}>
              Annuler
            </button>
          )}
        </div>
      </form>

      {award && <AwardBadge badge={award} onClose={() => setAward(null)} onDone={(t, tone) => { flash(tone, t); if (tone === 'ok') setAward(null); }} />}
      {holdersOf && <Holders badge={holdersOf} onClose={() => setHoldersOf(null)} />}

      <section className="acc-card acc-card-wide">
        <h2 className="acc-section-title">Badges existants {list && <span className="soc-count">{list.length}</span>}</h2>
        {!list ? (
          <p className="neon-hint">Chargement…</p>
        ) : list.length === 0 ? (
          <p className="soc-empty">Aucun badge.</p>
        ) : (
          <div className="acc-table-scroll">
            <table className="acc-table adm-table">
              <thead>
                <tr>
                  <th scope="col">Badge</th>
                  <th scope="col">Type</th>
                  <th scope="col">Rareté</th>
                  <th scope="col" className="acc-col-opt">Expire</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} data-inactive={!b.is_active || undefined}>
                    <td>
                      <BadgeChip badge={{ ...b, note: null, awarded_at: b.created_at }} />
                    </td>
                    <td>{BADGE_TYPE_LABELS[b.type]}</td>
                    <td>{BADGE_RARITY_LABELS[b.rarity]}</td>
                    <td className="acc-col-opt">{b.expiry_date ? fmtDate(b.expiry_date) : '—'}</td>
                    <td>
                      <span className="adm-actions">
                        <button type="button" className="adm-icon-btn" onClick={() => edit(b)} title="Modifier" aria-label={`Modifier ${b.name}`}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="adm-icon-btn" onClick={() => setAward(b)} title="Attribuer" aria-label={`Attribuer ${b.name}`}>
                          <Gift size={14} />
                        </button>
                        <button type="button" className="adm-icon-btn" onClick={() => setHoldersOf(b)} title="Détenteurs" aria-label={`Détenteurs de ${b.name}`}>
                          <Users size={14} />
                        </button>
                        <ConfirmAction
                          label={<Trash2 size={14} aria-label="Supprimer" />}
                          confirm="Supprimer ?"
                          onConfirm={async () => {
                            try {
                              await deleteBadge(b.id);
                              flash('ok', 'Badge supprimé.');
                              setNonce((n) => n + 1);
                            } catch (err) {
                              flash('error', err instanceof Error ? err.message : 'Suppression impossible.');
                            }
                          }}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AwardBadge({ badge, onClose, onDone }: { badge: BadgeRow; onClose: () => void; onDone: (t: string, tone: 'ok' | 'error') => void }) {
  const [username, setUsername] = useState('');
  const [note, setNote] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await awardBadge(badge.id, username.trim(), note.trim());
      onDone(`« ${badge.name} » attribué à ${username.trim()}.`, 'ok');
    } catch (err) {
      onDone(err instanceof Error ? err.message : 'Attribution impossible.', 'error');
    }
  };
  return (
    <form className="acc-card acc-card-wide adm-form" onSubmit={submit}>
      <h2 className="acc-section-title">
        <Gift size={17} aria-hidden /> Attribuer « {badge.name} »
      </h2>
      <div className="adm-grid-2">
        <Field label="Pseudo du joueur">
          <input className="neon-input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label="Précision" hint="Remplace le nom affiché et part dans la notification du joueur. Obligatoire pour un badge de sanction : c'est son motif.">
          <input className="neon-input" value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="plf-actions">
        <button type="submit" className="neon-btn" data-variant="solid" disabled={!username.trim()}>
          Attribuer
        </button>
        <button type="button" className="neon-btn" data-variant="ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Holders({ badge, onClose }: { badge: BadgeRow; onClose: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getBadgeHolders>> | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getBadgeHolders(badge.id)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [badge.id, nonce]);
  return (
    <section className="acc-card acc-card-wide">
      <div className="adm-row-between">
        <h2 className="acc-section-title">
          <Users size={17} aria-hidden /> Détenteurs de « {badge.name} »
        </h2>
        <button type="button" className="neon-btn adm-btn" data-variant="ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
      {!rows ? (
        <p className="neon-hint">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="soc-empty">Personne ne l'a encore.</p>
      ) : (
        <ul className="adm-list">
          {rows.map((r) => (
            <li key={r.user_id}>
              <strong>{r.username}</strong>
              {r.note && <span className="neon-hint"> — {r.note}</span>}
              <span className="neon-hint"> · {fmtDate(r.awarded_at)}</span>
              <ConfirmAction
                variant="ghost"
                label="Retirer"
                confirm="Retirer ?"
                onConfirm={async () => {
                  await revokeBadge(badge.id, r.user_id);
                  setNonce((n) => n + 1);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
