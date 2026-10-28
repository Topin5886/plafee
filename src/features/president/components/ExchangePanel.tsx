import { ArrowLeftRight, Check, Gift, Hourglass, X } from 'lucide-react';
import { ROLE_LABEL } from '../engine/deck';
import type { PresidentCard, PresidentExchange, PresidentState } from '../engine/types';
import { PresidentCardFace } from './PresidentCard';
import { cardCount, cardsLabel } from './labels';

/** Quelques cartes en petit, pour dire « voilà ce qui a changé de main ». */
function MiniCards({ cards }: { cards: PresidentCard[] }) {
  if (cards.length === 0) return null;
  return (
    <span className="pres-mini-cards" role="img" aria-label={cardsLabel(cards)}>
      {cards.map((c) => (
        <span key={c.id} className="pres-mini-card">
          <PresidentCardFace card={c} />
        </span>
      ))}
    </span>
  );
}

/** « le Président (Moka) » : le rôle d'abord, c'est lui qui explique l'échange. */
function who(state: PresidentState, seat: number): string {
  const p = state.players[seat];
  if (!p) return '';
  return p.role ? `${roleWithArticle(p.role)} (${p.name})` : p.name;
}

function roleWithArticle(role: NonNullable<PresidentState['players'][number]['role']>): string {
  return `le ${ROLE_LABEL[role]}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Le « il/elle » neutre du site : on reprend le prénom plutôt que de deviner. */
const nameOf = (state: PresidentState, seat: number) => state.players[seat]?.name ?? '';

interface ExchangePanelProps {
  state: PresidentState;
  seat: number;
}

/**
 * Ce qui se passe à l'échange, raconté à chacun selon sa place, au centre de
 * la table (là où sera le pli) :
 *   - le Président (ou son vice) voit ce que le Trou du cul lui a donné
 *     d'office ; il choisit quoi lui rendre dans sa main, juste dessous, et
 *     valide avec « Donner » dans le dock — l'action principale reste à la
 *     même place que « Poser » ;
 *   - le Trou du cul (ou le Vice-trou) voit ce qu'il a dû donner et attend
 *     ce qu'on va lui rendre ;
 *   - les Neutres et les observateurs savent juste qui échange avec qui.
 * Les cartes d'un échange ne voyagent que vers ses deux joueurs (voir
 * maskState) : un Neutre n'en voit jamais le contenu.
 *
 * La consigne (« À toi : choisis 2 cartes… ») est dans le dock ; le panneau
 * ne la répète pas.
 */
export function ExchangePanel({ state, seat }: ExchangePanelProps) {
  const xs = state.exchanges;
  const toGive = xs.find((e) => e.from === seat && e.kind === 'choice' && !e.done);
  const gaveChoice = xs.find((e) => e.from === seat && e.kind === 'choice' && e.done);
  const gotBest = xs.find((e) => e.to === seat && e.kind === 'best');
  const gaveBest = xs.find((e) => e.from === seat && e.kind === 'best');
  const gotChoice = xs.find((e) => e.to === seat && e.kind === 'choice');
  const involved = Boolean(gotBest || gaveBest);

  // Une ligne par paire (le don d'office est fait dès la donne) : qui
  // échange avec qui, et si le retour est arrivé.
  const pairLine = (e: PresidentExchange) => (
    <li key={`${e.from}-${e.to}`} data-done={e.done || undefined}>
      <span className="pres-xline-names">
        {nameOf(state, e.to)} <ArrowLeftRight size={12} aria-hidden />
        <span className="sr-only"> échange avec </span> {nameOf(state, e.from)}
      </span>
      <span className="pres-xline-what">{cardCount(e.count)}</span>
      {e.done ? (
        <>
          <Check size={14} aria-hidden />
          <span className="sr-only">fait</span>
        </>
      ) : (
        <>
          <Hourglass size={14} aria-hidden />
          <span className="sr-only">en attente</span>
        </>
      )}
    </li>
  );

  return (
    <section className="pres-exchange" aria-label="Échange des cartes">
      <header className="pres-exchange-head">
        <Gift size={15} aria-hidden />
        <h2>Échange — manche {state.manche}</h2>
      </header>

      {gotBest && (
        <div className="pres-exchange-step">
          <p>
            {capitalize(who(state, gotBest.from))} t'a donné{' '}
            {gotBest.count === 1 ? 'sa meilleure carte' : `ses ${gotBest.count} meilleures cartes`} :
          </p>
          <MiniCards cards={gotBest.cards} />
          {toGive ? (
            <p className="pres-exchange-tip">Tu peux lui rendre une carte qu'on vient de te donner.</p>
          ) : gaveChoice ? (
            <>
              <p>Tu as rendu :</p>
              <MiniCards cards={gaveChoice.cards} />
            </>
          ) : null}
        </div>
      )}

      {gaveBest && (
        <div className="pres-exchange-step">
          <p>
            Tu as dû donner {gaveBest.count === 1 ? 'ta meilleure carte' : `tes ${gaveBest.count} meilleures cartes`} à{' '}
            {who(state, gaveBest.to)} :
          </p>
          <MiniCards cards={gaveBest.cards} />
          {gotChoice?.done ? (
            <>
              <p>{nameOf(state, gaveBest.to)} t'a rendu :</p>
              <MiniCards cards={gotChoice.cards} />
            </>
          ) : (
            <p className="pres-exchange-wait">
              <Hourglass size={14} aria-hidden /> {nameOf(state, gaveBest.to)} choisit {cardCount(gotChoice?.count ?? gaveBest.count)}{' '}
              à te rendre…
            </p>
          )}
        </div>
      )}

      {!involved && (
        <p className="pres-exchange-step">
          {seat >= 0
            ? "Tu es Neutre : pas d'échange pour toi."
            : 'Les cartes changent de main entre le haut et le bas de la table.'}
        </p>
      )}

      {xs.some((e) => e.kind === 'choice') && (
        <ul className="pres-xlines">{xs.filter((e) => e.kind === 'choice').map(pairLine)}</ul>
      )}
    </section>
  );
}

/**
 * Pendant la manche, une ligne dans le dock pour se rappeler son échange :
 * ce qu'on a reçu, ce qu'on a donné. Rien pour qui n'a rien échangé.
 */
export function ExchangeRecap({ state, seat, onDismiss }: { state: PresidentState; seat: number; onDismiss: () => void }) {
  const got = state.exchanges.filter((e) => e.to === seat).flatMap((e) => e.cards);
  const gave = state.exchanges.filter((e) => e.from === seat).flatMap((e) => e.cards);
  if (got.length === 0 && gave.length === 0) return null;

  return (
    <div className="pres-recap" role="group" aria-label="Ton échange">
      <Gift size={14} aria-hidden />
      <span className="pres-recap-part">
        Reçu <MiniCards cards={got} />
      </span>
      <span className="pres-recap-part">
        Donné <MiniCards cards={gave} />
      </span>
      <button type="button" className="pres-exchange-close" onClick={onDismiss} aria-label="Fermer le récapitulatif">
        <X size={15} />
      </button>
    </div>
  );
}
