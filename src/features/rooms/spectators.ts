/*
 * Le mode observation, côté hôte, commun aux cinq jeux.
 *
 * Un observateur est une connexion P2P comme une autre, qui n'a simplement pas
 * de siège dans l'état du jeu. Il reçoit l'état masqué comme n'importe quel
 * joueur — et puisqu'il n'est aucun des joueurs, toutes les mains lui sont
 * cachées : le masquage existant suffit, sans code de sécurité supplémentaire.
 * Les moteurs de jeu, eux, ne savent rien des observateurs.
 *
 * Prendre une place : dans tous les jeux, un joueur qui part en cours de partie
 * garde son siège, marqué déconnecté. Au début de la manche suivante, l'hôte
 * donne ces sièges vides aux observateurs qui l'ont demandé, dans l'ordre de
 * leur demande. Le nouveau venu hérite du siège (et, en Scopa, du score de
 * match du partant) ; la main est redistribuée par la manche qui commence.
 */

export interface Spectator {
  id: string;
  name: string;
  /** A demandé à prendre la prochaine place libérée. */
  wantsSeat: boolean;
}

/** Au-delà, la table refuse les curieux : chaque observateur coûte une connexion à l'hôte. */
export const MAX_SPECTATORS = 8;

export type SpectatorsMessage = { type: 'SPECTATORS'; spectators: Spectator[] };
export type SeatMessage = { type: 'SEAT'; want: boolean };

export function isSeatMessage(data: unknown): data is SeatMessage {
  return Boolean(data) && typeof data === 'object' && (data as SeatMessage).type === 'SEAT'
    && typeof (data as SeatMessage).want === 'boolean';
}

export function isSpectatorsMessage(data: unknown): data is SpectatorsMessage {
  return Boolean(data) && typeof data === 'object' && (data as SpectatorsMessage).type === 'SPECTATORS'
    && Array.isArray((data as SpectatorsMessage).spectators);
}

interface Seat {
  id: string;
  name: string;
  connected: boolean;
}

/** Le registre des observateurs d'une table, tenu par l'hôte. */
export function createSpectatorDesk(onChange: (list: Spectator[]) => void) {
  const desk = new Map<string, Spectator>();
  const emit = () => onChange([...desk.values()]);

  return {
    has: (id: string) => desk.has(id),
    list: () => [...desk.values()],

    /** Faux quand la table est déjà pleine de curieux. */
    add(id: string, name: string): boolean {
      if (desk.has(id)) return true;
      if (desk.size >= MAX_SPECTATORS) return false;
      desk.set(id, { id, name: name.trim().slice(0, 18) || 'Observateur', wantsSeat: false });
      emit();
      return true;
    },

    remove(id: string) {
      if (desk.delete(id)) emit();
    },

    setWant(id: string, want: boolean) {
      const s = desk.get(id);
      if (!s || s.wantsSeat === want) return;
      // Réinsérer place la demande en fin de file : premier à demander,
      // premier servi.
      desk.delete(id);
      desk.set(id, { ...s, wantsSeat: want });
      emit();
    },

    /**
     * Remet le registre dans l'état d'une photo prise avec `list()` : les
     * observateurs qu'un `fillVacatedSeats` avait assis y reviennent avec leur
     * demande de place et leur rang dans la file.
     */
    restore(snapshot: Spectator[]) {
      const current = new Map(desk);
      desk.clear();
      for (const s of snapshot) desk.set(s.id, current.get(s.id) ?? s);
      for (const [id, s] of current) if (!desk.has(id)) desk.set(id, s);
      emit();
    },

    /**
     * Donne les sièges des joueurs partis aux observateurs qui attendent.
     * Renvoie la liste de joueurs à jour ; ceux qui ont trouvé place quittent
     * le registre.
     */
    fillVacatedSeats<P extends Seat>(players: P[]): P[] {
      const queue = [...desk.values()].filter((s) => s.wantsSeat);
      if (!queue.length || !players.some((p) => !p.connected)) return players;
      const next = players.map((p) => {
        if (p.connected || !queue.length) return p;
        const s = queue.shift()!;
        desk.delete(s.id);
        return { ...p, id: s.id, name: s.name, connected: true };
      });
      emit();
      return next;
    },
  };
}

export type SpectatorDesk = ReturnType<typeof createSpectatorDesk>;

/**
 * Applique une action de début de manche en installant d'abord les
 * observateurs sur les sièges libérés — mais seulement si l'action réussit :
 * un « manche suivante » refusé (mauvaise phase) ne doit pas déplacer
 * quelqu'un pour rien.
 */
export function withSeatsFilled<S extends { players: Seat[] }, R extends { state: S; error?: string }>(
  state: S,
  desk: SpectatorDesk,
  apply: (s: S) => R,
): R {
  const probe = apply(state);
  if (probe.error) return probe;
  const snapshot = desk.list();
  const players = desk.fillVacatedSeats(state.players);
  if (players === state.players) return probe;
  const seated = apply({ ...state, players } as S);
  if (seated.error) {
    // Improbable, mais on ne perd personne : retour au registre d'avant,
    // demandes de place comprises.
    desk.restore(snapshot);
    return probe;
  }
  return seated;
}

/** Nombre de sièges qu'un observateur pourrait reprendre à la prochaine manche. */
export function vacatedSeats(players: Seat[] | undefined): number {
  return players?.filter((p) => !p.connected).length ?? 0;
}
