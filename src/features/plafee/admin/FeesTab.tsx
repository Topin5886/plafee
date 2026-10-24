import { useEffect, useState, type FormEvent } from 'react';
import { Coins, Pencil, Plus, Save, SlidersHorizontal, Store } from 'lucide-react';
import { getPriceConfig, getShopItems, RARITIES, RARITY_LABELS, SHOP_CATEGORIES, TX_LABELS, type FeesTxType, type PriceConfig, type ShopCategory, type ShopItem } from '../api';
import { FeesAmount } from '../components/bits';
import { formatFees } from '../format';
import { getTransactions, grantFees, setFeesConfig, upsertShopItem, type AdminTransaction } from './adminApi';
import { Field, Flash, ImagePicker } from './ui';
import { fmtDateTime, useFlash } from './helpers';

/** Ce que chaque rayon attend dans l'effet d'un objet créé ici. */
const PAYLOAD_HINTS: Record<ShopCategory, { key: string; hint: string; options?: string[] }> = {
  card_theme: { key: 'skin', hint: 'Style des cartes.', options: ['classic', 'pixel', 'holo', 'neon', 'gold'] },
  site_theme: { key: 'skin', hint: 'Couleurs du site.', options: ['arcade', 'retro', 'synthwave', 'cyber'] },
  badge: { key: 'badge_sku', hint: 'Code du badge offert (colonne « sku » d’un badge).' },
  profile_border: {
    key: 'border',
    hint: 'Autour de la photo. Un nouveau nom + une image = un cadre à toi.',
    options: ['neon', 'silver', 'frost', 'felt', 'cards', 'gold', 'rainbow', 'flowers', 'circuit', 'lava', 'flame', 'bolt', 'platine', 'glitch', 'holo', 'pixelrainbow'],
  },
  avatar_accessory: {
    key: 'accessory',
    hint: 'Posé sur un bord de la photo.',
    options: ['cat', 'gg', 'gamepad', 'cap', 'bow', 'headset', 'horns', 'shades', 'token', 'bottle', 'halo', 'crown', 'dragon'],
  },
  avatar_effect: {
    key: 'effect',
    hint: 'Animation par-dessus la photo.',
    options: ['bubbles', 'snow', 'coins', 'petals', 'crt', 'smoke', 'stars', 'hologram', 'aura'],
  },
  nameplate: { key: 'plate', hint: 'Texte de la plaque (majuscules).' },
  victory_animation: { key: 'anim', hint: 'Animation.', options: ['confetti', 'fireworks', 'pixels', 'hologram'] },
};

export function FeesTab() {
  const [msg, flash] = useFlash();
  return (
    <div className="adm-stack">
      <Flash msg={msg} />
      <GrantForm flash={flash} />
      <PriceTable flash={flash} />
      <ShopItems flash={flash} />
      <Transactions />
    </div>
  );
}

type FlashFn = (tone: 'ok' | 'error', text: string) => void;

function GrantForm({ flash }: { flash: FlashFn }) {
  const [username, setUsername] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.trunc(Number(amount));
    if (!n || !username.trim()) return;
    try {
      const done = await grantFees(username.trim(), n, reason);
      flash('ok', done >= 0 ? `${formatFees(done)} FEES donnés à ${username.trim()}.` : `${formatFees(-done)} FEES retirés à ${username.trim()}.`);
      setAmount('');
      setReason('');
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Opération impossible.');
    }
  };
  return (
    <form className="acc-card acc-card-wide adm-form" onSubmit={submit}>
      <h2 className="acc-section-title">
        <Coins size={17} aria-hidden /> Donner ou retirer des FEES
      </h2>
      <div className="adm-grid-3">
        <Field label="Pseudo">
          <input className="neon-input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Montant" hint="Négatif pour retirer (jamais sous zéro).">
          <input className="neon-input" type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Motif">
          <input className="neon-input" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <button type="submit" className="neon-btn adm-btn" data-variant="solid" disabled={!username.trim() || !Math.trunc(Number(amount))}>
        Appliquer
      </button>
    </form>
  );
}

function PriceTable({ flash }: { flash: FlashFn }) {
  const [rows, setRows] = useState<PriceConfig[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    getPriceConfig()
      .then(setRows)
      .catch((e: unknown) => flash('error', e instanceof Error ? e.message : 'Chargement impossible.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (r: PriceConfig) => {
    const v = Math.max(0, Math.trunc(Number(draft[r.action] ?? r.amount)));
    try {
      await setFeesConfig(r.action, v);
      setRows((rows) => rows?.map((x) => (x.action === r.action ? { ...x, amount: v } : x)) ?? null);
      setDraft(({ [r.action]: _drop, ...rest }) => rest);
      flash('ok', `${r.label} : ${formatFees(v)}.`);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Enregistrement impossible.');
    }
  };

  return (
    <section className="acc-card acc-card-wide">
      <h2 className="acc-section-title">
        <SlidersHorizontal size={17} aria-hidden /> Gains et plafonds
      </h2>
      <p className="neon-hint">Les gains par victoire, les bonus, et les plafonds anti-abus. Pris en compte dès la prochaine partie.</p>
      {!rows ? (
        <p className="neon-hint">Chargement…</p>
      ) : (
        <ul className="adm-config">
          {rows.map((r) => {
            const value = draft[r.action] ?? String(r.amount);
            const dirty = draft[r.action] !== undefined && Number(draft[r.action]) !== r.amount;
            return (
              <li key={r.action}>
                <label htmlFor={`cfg-${r.action}`}>{r.label}</label>
                <input id={`cfg-${r.action}`} className="neon-input" type="number" min={0} value={value} onChange={(e) => setDraft({ ...draft, [r.action]: e.target.value })} />
                <button type="button" className="adm-icon-btn" disabled={!dirty} onClick={() => void save(r)} aria-label={`Enregistrer ${r.label}`} title="Enregistrer">
                  <Save size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface ItemForm {
  id: string | null;
  sku: string | null;
  name: string;
  description: string;
  category: ShopCategory;
  price: number;
  icon_url: string | null;
  effect: string;
  active: boolean;
  rarity: string;
}

const BLANK_ITEM: ItemForm = { id: null, sku: null, name: '', description: '', category: 'nameplate', price: 300, icon_url: null, effect: '', active: true, rarity: '' };

/** Les rayons de la photo : leur image remplace le dessin d'origine, et un nom libre crée un objet à toi. */
const PHOTO_CATEGORIES: ShopCategory[] = ['profile_border', 'avatar_accessory', 'avatar_effect'];

function ShopItems({ flash }: { flash: FlashFn }) {
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [form, setForm] = useState<ItemForm>(BLANK_ITEM);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    getShopItems(true)
      .then(setItems)
      .catch((e: unknown) => flash('error', e instanceof Error ? e.message : 'Chargement impossible.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const hint = PAYLOAD_HINTS[form.category];
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const edit = (i: ShopItem) =>
    setForm({
      id: i.id,
      sku: i.sku,
      name: i.name,
      description: i.description ?? '',
      category: i.category,
      price: i.price,
      icon_url: i.icon_url,
      effect: String(i.payload[PAYLOAD_HINTS[i.category].key] ?? (i.payload.custom ? '(texte au choix)' : '')),
      active: i.is_active,
      rarity: i.rarity ?? '',
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return;
    try {
      await upsertShopItem({
        id: form.id,
        name: form.name.trim(),
        description: form.description,
        category: form.category,
        price: Math.max(0, Math.trunc(form.price)),
        icon_url: form.icon_url,
        payload: form.effect.trim() ? { [hint.key]: form.category === 'nameplate' ? form.effect.trim().toUpperCase() : form.effect.trim() } : {},
        active: form.active,
        rarity: form.rarity,
      });
      flash('ok', form.id ? 'Objet modifié.' : 'Objet ajouté à la boutique.');
      setForm(BLANK_ITEM);
      setNonce((n) => n + 1);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <>
      <form className="acc-card acc-card-wide adm-form" onSubmit={submit}>
        <h2 className="acc-section-title">
          {form.id ? <Pencil size={17} aria-hidden /> : <Plus size={17} aria-hidden />} {form.id ? `Modifier « ${form.name} »` : 'Créer un objet de boutique'}
        </h2>
        {form.sku && <p className="neon-hint">Objet d'origine : son rayon et son effet sont fixes. Nom, prix, image et mise en vente se modifient.</p>}
        <div className="adm-grid-2">
          <Field label="Nom">
            <input className="neon-input" value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Prix (FEES)">
            <input className="neon-input" type="number" min={0} step={10} value={form.price} onChange={(e) => set('price', Number(e.target.value))} />
          </Field>
          <Field label="Rayon">
            <select className="neon-input" value={form.category} disabled={Boolean(form.sku)} onChange={(e) => set('category', e.target.value as ShopCategory)}>
              {SHOP_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effet" hint={hint.hint}>
            {PHOTO_CATEGORIES.includes(form.category) ? (
              <>
                <input
                  className="neon-input"
                  list={`fx-${form.category}`}
                  value={form.effect}
                  disabled={Boolean(form.sku)}
                  maxLength={24}
                  onChange={(e) => set('effect', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                />
                <datalist id={`fx-${form.category}`}>
                  {hint.options?.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </>
            ) : hint.options ? (
              <select className="neon-input" value={form.effect} disabled={Boolean(form.sku)} onChange={(e) => set('effect', e.target.value)}>
                <option value="">—</option>
                {hint.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input className="neon-input" value={form.effect} disabled={Boolean(form.sku)} maxLength={24} onChange={(e) => set('effect', e.target.value)} />
            )}
          </Field>
          <Field label="Rareté">
            <select className="neon-input" value={form.rarity} onChange={(e) => set('rarity', e.target.value)}>
              <option value="">Aucune</option>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Image"
            hint={
              PHOTO_CATEGORIES.includes(form.category)
                ? 'PNG ou SVG transparent, carré : remplace le dessin d’origine sur toutes les photos (cadre et effet : la photo occupe le centre, 77 % de l’image).'
                : undefined
            }
          >
            <ImagePicker value={form.icon_url} onChange={(url) => set('icon_url', url)} folder="shop" onError={(m) => flash('error', m)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="neon-input" rows={2} maxLength={200} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <label className="adm-check">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> En vente
        </label>
        <div className="plf-actions">
          <button type="submit" className="neon-btn" data-variant="solid">
            {form.id ? 'Enregistrer' : 'Créer'}
          </button>
          {form.id && (
            <button type="button" className="neon-btn" data-variant="ghost" onClick={() => setForm(BLANK_ITEM)}>
              Annuler
            </button>
          )}
        </div>
      </form>

      <section className="acc-card acc-card-wide">
        <h2 className="acc-section-title">
          <Store size={17} aria-hidden /> Articles de la boutique
        </h2>
        {!items ? (
          <p className="neon-hint">Chargement…</p>
        ) : (
          <div className="acc-table-scroll">
            <table className="acc-table adm-table">
              <thead>
                <tr>
                  <th scope="col">Objet</th>
                  <th scope="col">Rayon</th>
                  <th scope="col">Rareté</th>
                  <th scope="col">Prix</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} data-inactive={!i.is_active || undefined}>
                    <td>{i.name}</td>
                    <td>{SHOP_CATEGORIES.find((c) => c.id === i.category)?.label}</td>
                    <td>{i.rarity ? <span className="plf-chip-mini" data-rarity={i.rarity}>{RARITY_LABELS[i.rarity]}</span> : '—'}</td>
                    <td>{i.is_default ? 'Gratuit' : <FeesAmount value={i.price} size="sm" />}</td>
                    <td>
                      <span className="adm-pill" data-tone={i.is_active ? 'ok' : 'danger'}>
                        {i.is_active ? 'En vente' : 'Retiré'}
                      </span>
                    </td>
                    <td>
                      <span className="adm-actions">
                        <button type="button" className="adm-icon-btn" onClick={() => edit(i)} aria-label={`Modifier ${i.name}`} title="Modifier">
                          <Pencil size={14} />
                        </button>
                        {!i.is_default && (
                          <button
                            type="button"
                            className="neon-btn adm-btn"
                            data-variant="ghost"
                            onClick={async () => {
                              try {
                                await upsertShopItem({
                                  id: i.id,
                                  name: i.name,
                                  description: i.description ?? '',
                                  category: i.category,
                                  price: i.price,
                                  icon_url: i.icon_url,
                                  payload: i.payload,
                                  active: !i.is_active,
                                });
                                setNonce((n) => n + 1);
                              } catch (e) {
                                flash('error', e instanceof Error ? e.message : 'Action impossible.');
                              }
                            }}
                          >
                            {i.is_active ? 'Retirer de la vente' : 'Remettre en vente'}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Transactions() {
  const [type, setType] = useState('');
  const [username, setUsername] = useState('');
  const [query, setQuery] = useState({ type: '', username: '' });
  const [rows, setRows] = useState<AdminTransaction[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    getTransactions(query.type, query.username, 150)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <section className="acc-card acc-card-wide">
      <h2 className="acc-section-title">Transactions récentes</h2>
      <form
        className="adm-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ type, username: username.trim() });
        }}
      >
        <select className="neon-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de transaction">
          <option value="">Tous les types</option>
          {(Object.keys(TX_LABELS) as FeesTxType[]).map((t) => (
            <option key={t} value={t}>
              {TX_LABELS[t]}
            </option>
          ))}
        </select>
        <input className="neon-input" placeholder="Pseudo" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Filtrer par joueur" />
        <button type="submit" className="neon-btn adm-btn" data-variant="solid">
          Filtrer
        </button>
      </form>
      {!rows ? (
        <p className="neon-hint">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="soc-empty">Aucune transaction.</p>
      ) : (
        <div className="acc-table-scroll">
          <table className="acc-table adm-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Joueur</th>
                <th scope="col">Type</th>
                <th scope="col">Montant</th>
                <th scope="col" className="acc-col-opt">Détail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.created_at)}</td>
                  <td>{t.username}</td>
                  <td>{TX_LABELS[t.type as FeesTxType] ?? t.type}</td>
                  <td>
                    <FeesAmount value={t.amount} signed size="sm" />
                  </td>
                  <td className="acc-col-opt">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
