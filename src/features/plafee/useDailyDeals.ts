import { useEffect, useState } from 'react';
import { getDailyDeals, type DailyDeal } from './api';

/**
 * Les offres du jour, rechargées toutes seules à minuit (heure de Paris).
 *
 * La base donne la fin de l'offre (`ends_at`) : on recharge juste après. Si
 * le serveur répond encore avec les offres de la veille (horloges décalées),
 * on réessaie quelques secondes plus tard. Un onglet en arrière-plan peut
 * retarder les minuteries : on revérifie aussi quand il revient au premier plan.
 */
export function useDailyDeals() {
  const [deals, setDeals] = useState<DailyDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDailyDeals()
      .then((d) => {
        if (cancelled) return;
        setDeals(d);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Offres indisponibles.'));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const endsAt = deals?.[0] ? Date.parse(deals[0].ends_at) : null;

  useEffect(() => {
    if (endsAt === null) return;
    const left = endsAt - Date.now();
    const t = window.setTimeout(() => setNonce((n) => n + 1), left > 0 ? Math.min(left + 500, 2 ** 31 - 1) : 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= endsAt) setNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endsAt, nonce]);

  return { deals, error, endsAt };
}

/** Le temps qui reste, en HH:MM:SS, mis à jour chaque seconde. */
export function useCountdown(endsAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);
  if (endsAt === null) return '--:--:--';
  const s = Math.max(0, Math.floor((endsAt - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
