/**
 * Service des tickets : enregistre dans le profil chiffré, envoie au relais,
 * renvoie seul ce qui est resté en attente (hors ligne, relais ou Discord
 * momentanément indisponible). Sans React : le hook `useSupport` n'est qu'une fine couche.
 */

import { envoyerTicket, type LiaisonSupport } from './envoi';
import { ecrireTickets, erreurFormulaire, infosTechniques, lireTickets, nouveauTicket, prochainNumero, type FormulaireTicket, type InfosTechniques, type Ticket } from './tickets';

export interface DepotTickets {
  lire(): string | undefined;
  ecrire(valeur: string): void;
}

export interface OptionsService {
  depot: DepotTickets;
  liaison(): Promise<LiaisonSupport | undefined>;
  technique(): InfosTechniques;
  requete?: typeof fetch;
  maintenant?(): Date;
  /** Appelé après chaque changement de l'historique. */
  surChangement?(tickets: readonly Ticket[]): void;
}

/** Au-delà, un ticket en attente passe en erreur : à l'utilisateur de le renvoyer. */
export const ESSAIS_AUTOMATIQUES_MAX = 20;

export class ServiceSupport {
  private tickets: Ticket[];
  private readonly enCours = new Set<number>();

  constructor(private readonly o: OptionsService) {
    this.tickets = lireTickets(o.depot.lire());
  }

  liste(): readonly Ticket[] {
    return [...this.tickets].sort((a, b) => b.numero - a.numero);
  }

  private enregistrer(tickets: Ticket[]): void {
    this.tickets = tickets;
    try {
      this.o.depot.ecrire(ecrireTickets(tickets));
    } catch {
      // Base verrouillée en cours de route : l'état en mémoire reste à jour.
    }
    this.o.surChangement?.(this.liste());
  }

  private remplacer(numero: number, suite: (t: Ticket) => Ticket): void {
    this.enregistrer(this.tickets.map(t => (t.numero === numero ? suite(t) : t)));
  }

  /** Enregistre le ticket puis tente de l'envoyer. Lève si le formulaire est invalide. */
  async creer(formulaire: FormulaireTicket): Promise<Ticket> {
    const erreur = erreurFormulaire(formulaire);
    if (erreur) {
      throw new Error(erreur);
    }
    const maintenant = (this.o.maintenant?.() ?? new Date()).toISOString();
    const ticket = nouveauTicket(formulaire, prochainNumero(this.tickets), this.o.technique(), maintenant);
    this.enregistrer([...this.tickets, ticket]);
    await this.envoyer(ticket.numero);
    return this.tickets.find(t => t.numero === ticket.numero) ?? ticket;
  }

  /** Envoie (ou renvoie) un ticket. Sans effet s'il est déjà parti ou en cours d'envoi. */
  async envoyer(numero: number): Promise<void> {
    const ticket = this.tickets.find(t => t.numero === numero);
    if (!ticket || ticket.statut === 'envoye' || this.enCours.has(numero)) {
      return;
    }
    this.enCours.add(numero);
    try {
      const resultat = await envoyerTicket(await this.o.liaison().catch(() => undefined), ticket, this.o.requete);
      this.remplacer(numero, t => {
        const { piece, erreur, ...reste } = t;
        if (resultat.ok) {
          return { ...reste, statut: 'envoye' as const, tentatives: t.tentatives + 1 };
        }
        const tentatives = t.tentatives + 1;
        const abandon = !resultat.reessayer || tentatives >= ESSAIS_AUTOMATIQUES_MAX;
        return { ...reste, ...(piece ? { piece } : {}), statut: abandon ? ('erreur' as const) : ('attente' as const), erreur: resultat.motif, tentatives };
      });
    } finally {
      this.enCours.delete(numero);
    }
  }

  get enAttente(): number {
    return this.tickets.filter(t => t.statut === 'attente').length;
  }

  /** Renvoi automatique : les tickets en attente, un par un. */
  async renvoyerEnAttente(): Promise<void> {
    for (const t of this.tickets.filter(x => x.statut === 'attente')) {
      await this.envoyer(t.numero);
    }
  }

  /** « Réessayer » sur un ticket en erreur : repart comme un ticket neuf. */
  async reessayer(numero: number): Promise<void> {
    this.remplacer(numero, t => (t.statut === 'erreur' ? { ...t, statut: 'attente', tentatives: 0 } : t));
    await this.envoyer(numero);
  }

  supprimer(numero: number): void {
    this.enregistrer(this.tickets.filter(t => t.numero !== numero));
  }
}

export { infosTechniques };
