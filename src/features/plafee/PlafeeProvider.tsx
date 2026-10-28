import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { accountsEnabled } from '../../lib/supabase';
import { useAuth } from '../account/useAuth';
import { useNotificationEvents } from '../social/useSocial';
import { PlafeeContext, type PlafeeValue } from './plafeeContext';
import {
  captureReferral,
  getCosmetics,
  getStanding,
  getWallet,
  listEvents,
  trackVisit,
  type Cosmetics,
  type PlafeeEvent,
  type Standing,
  type Wallet,
} from './api';

/*
 * L'état PLAFEE V2 du joueur courant : statut (admin, banni), porte-monnaie,
 * cosmétiques équipés, événements en cours.
 *
 * Chargé une fois à la connexion, puis tenu à jour par les notifications que
 * la base émet (FEES reçus, badge, événement complété, avertissement) — pas
 * de sondage régulier.
 */

const SKIN_KEY = 'plafee-skin';
const CARDS_KEY = 'plafee-cards';

/** Le thème du site et des cartes, posés sur <html> et retenus pour le prochain chargement. */
function applySkins(site: string | null, cards: string | null) {
  const root = document.documentElement;
  const s = site && site !== 'arcade' ? site : null;
  const c = cards && cards !== 'classic' ? cards : null;
  if (s) root.setAttribute('data-skin', s);
  else root.removeAttribute('data-skin');
  if (c) root.setAttribute('data-cards', c);
  else root.removeAttribute('data-cards');
  try {
    if (s) localStorage.setItem(SKIN_KEY, s);
    else localStorage.removeItem(SKIN_KEY);
    if (c) localStorage.setItem(CARDS_KEY, c);
    else localStorage.removeItem(CARDS_KEY);
  } catch {
    // Le thème reviendra au prochain chargement du compte.
  }
}

export function PlafeeProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const uid = status === 'signed-in' ? (user?.id ?? null) : null;
  const location = useLocation();

  const [standing, setStanding] = useState<Standing | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [mine, setMine] = useState<Cosmetics | null>(null);
  const [events, setEvents] = useState<PlafeeEvent[]>([]);
  const [nonce, setNonce] = useState({ wallet: 0, mine: 0, events: 0, standing: 0 });

  const bump = useCallback((key: keyof typeof nonce) => setNonce((n) => ({ ...n, [key]: n[key] + 1 })), []);
  const refreshWallet = useCallback(() => bump('wallet'), [bump]);
  const refreshMine = useCallback(() => bump('mine'), [bump]);
  const refreshEvents = useCallback(() => bump('events'), [bump]);
  const refreshStanding = useCallback(() => bump('standing'), [bump]);

  // Un lien ?ref=pseudo se retient jusqu'à l'inscription.
  useEffect(() => {
    captureReferral(location.search);
  }, [location.search]);

  // Une visite par jour et par navigateur.
  useEffect(() => {
    if (accountsEnabled) trackVisit().catch(() => {});
  }, []);

  useEffect(() => {
    if (!uid) {
      setStanding(null);
      return;
    }
    let cancelled = false;
    getStanding()
      .then((s) => !cancelled && setStanding(s))
      .catch(() => !cancelled && setStanding(null));
    return () => {
      cancelled = true;
    };
  }, [uid, nonce.standing]);

  useEffect(() => {
    if (!uid) {
      setWallet(null);
      return;
    }
    let cancelled = false;
    getWallet()
      .then((w) => !cancelled && setWallet(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, nonce.wallet]);

  useEffect(() => {
    if (!uid) {
      setMine(null);
      // Déconnecté : retour au thème d'origine.
      if (status === 'signed-out') applySkins(null, null);
      return;
    }
    let cancelled = false;
    getCosmetics([uid])
      .then(([c]) => {
        if (cancelled || !c) return;
        setMine(c);
        applySkins(c.site_skin, c.card_skin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, status, nonce.mine]);

  useEffect(() => {
    if (!accountsEnabled) return;
    let cancelled = false;
    listEvents()
      .then((e) => !cancelled && setEvents(e))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, nonce.events]);

  useEffect(() => {
    const on = () => {
      refreshWallet();
      refreshEvents();
    };
    window.addEventListener('plafee:wallet', on);
    return () => window.removeEventListener('plafee:wallet', on);
  }, [refreshWallet, refreshEvents]);

  useNotificationEvents((event) => {
    switch (event.kind) {
      case 'fees':
      case 'victory_confirmed':
        refreshWallet();
        break;
      case 'badge':
        refreshMine();
        break;
      case 'event_completed':
        refreshEvents();
        refreshWallet();
        refreshMine();
        break;
      case 'warning':
      case 'ban':
      case 'unban':
        refreshStanding();
        break;
      case 'stats_reset':
        refreshMine();
        refreshWallet();
        break;
    }
  });

  const value = useMemo<PlafeeValue>(
    () => ({
      standing,
      refreshStanding,
      isAdmin: Boolean(standing?.is_admin),
      isSuperAdmin: Boolean(standing?.is_super_admin),
      banned: Boolean(standing?.banned),
      wallet,
      refreshWallet,
      mine,
      refreshMine,
      events,
      refreshEvents,
    }),
    [standing, refreshStanding, wallet, refreshWallet, mine, refreshMine, events, refreshEvents],
  );

  return <PlafeeContext value={value}>{children}</PlafeeContext>;
}
