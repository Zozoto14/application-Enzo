/**
 * Service des demandes de support : enregistre dans le profil chiffré, envoie au relais, renvoie seul
 * ce qui est resté en attente (hors ligne, relais momentanément indisponible), puis suit les
 * demandes parties : statut, réponses du Fondateur (notification : `nonLus`), compléments.
 * Sans React : le hook `useSupport` n'est qu'une fine couche.
 */

import { agirSurTicket, envoyerTicket, listerTickets, type LiaisonSupport } from './envoi';
import {
  avecVueServeur,
  ecrireTickets,
  erreurFormulaire,
  infosTechniques,
  lireTickets,
  nouveauTicket,
  prochainNumero,
  ticketDepuisServeur,
  type FormulaireTicket,
  type InfosTechniques,
  type Ticket,
} from './tickets';

export interface DepotTickets {
  lire(): string | undefined;
  ecrire(valeur: string): void;
}

export interface OptionsService {
  depot: DepotTickets;
  liaison(): Promise<LiaisonSupport | undefined>;
  technique(): InfosTechniques;
  /** Nom affiché de l'auteur (son prénom ou pseudo), joint à la demande. */
  auteur?(): string | undefined;
  requete?: typeof fetch;
  maintenant?(): Date;
  /** Appelé après chaque changement de l'historique. */
  surChangement?(tickets: readonly Ticket[]): void;
}

/** Au-delà, une demande en attente passe en erreur : à l'utilisateur de la renvoyer. */
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

  /** Réponses du Fondateur pas encore vues (badge du bouton Support). */
  get nonLus(): number {
    return this.tickets.reduce((n, t) => n + (t.nonLus ?? 0), 0);
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

  /** Enregistre la demande puis tente de l'envoyer. Lève si le formulaire est invalide. */
  async creer(formulaire: FormulaireTicket): Promise<Ticket & { avertissement?: string }> {
    const erreur = erreurFormulaire(formulaire);
    if (erreur) {
      throw new Error(erreur);
    }
    const maintenant = (this.o.maintenant?.() ?? new Date()).toISOString();
    const ticket = nouveauTicket(formulaire, prochainNumero(this.tickets), this.o.technique(), maintenant);
    this.enregistrer([...this.tickets, ticket]);
    const avertissement = await this.envoyer(ticket.numero);
    const fini = this.tickets.find(t => t.numero === ticket.numero) ?? ticket;
    return avertissement ? { ...fini, avertissement } : fini;
  }

  /** Envoie (ou renvoie) une demande. Sans effet si elle est déjà partie ou en cours d'envoi. */
  async envoyer(numero: number): Promise<string | undefined> {
    const ticket = this.tickets.find(t => t.numero === numero);
    if (!ticket || ticket.statut === 'envoye' || this.enCours.has(numero)) {
      return undefined;
    }
    this.enCours.add(numero);
    try {
      const resultat = await envoyerTicket(await this.o.liaison().catch(() => undefined), ticket, this.o.requete, this.o.auteur?.());
      this.remplacer(numero, t => {
        const reste: Ticket = { ...t };
        const piece = reste.piece;
        delete reste.piece;
        delete reste.erreur;
        if (resultat.ok) {
          const envoye: Ticket = { ...reste, statut: 'envoye' as const, tentatives: t.tentatives + 1 };
          return resultat.vue ? avecVueServeur(envoye, resultat.vue) : envoye;
        }
        const tentatives = t.tentatives + 1;
        const abandon = !resultat.reessayer || tentatives >= ESSAIS_AUTOMATIQUES_MAX;
        return { ...reste, ...(piece ? { piece } : {}), statut: abandon ? ('erreur' as const) : ('attente' as const), erreur: resultat.motif, tentatives };
      });
      return resultat.ok ? resultat.avertissement : undefined;
    } finally {
      this.enCours.delete(numero);
    }
  }

  get enAttente(): number {
    return this.tickets.filter(t => t.statut === 'attente').length;
  }

  /** Renvoi automatique : les demandes en attente, une par une. */
  async renvoyerEnAttente(): Promise<void> {
    for (const t of this.tickets.filter(x => x.statut === 'attente')) {
      await this.envoyer(t.numero);
    }
  }

  /** « Réessayer » sur une demande en erreur : repart comme une demande neuve. */
  async reessayer(numero: number): Promise<void> {
    this.remplacer(numero, t => (t.statut === 'erreur' ? { ...t, statut: 'attente', tentatives: 0 } : t));
    await this.envoyer(numero);
  }

  supprimer(numero: number): void {
    this.enregistrer(this.tickets.filter(t => t.numero !== numero));
  }

  /**
   * Relit mes demandes sur le relais : statut, réponses, non lues ; ajoute celles envoyées d'un
   * autre appareil. Rend le nombre de NOUVELLES réponses (notification). Sans réseau : 0.
   */
  async synchroniser(): Promise<number> {
    const lu = await listerTickets(await this.o.liaison().catch(() => undefined), this.o.requete);
    if (!lu) return 0;
    const avant = this.nonLus;
    let suivants = [...this.tickets];
    for (const v of lu.tickets) {
      const i = suivants.findIndex(t => t.id === v.id);
      if (i >= 0) suivants[i] = avecVueServeur(suivants[i], v);
      else {
        const nouveau = ticketDepuisServeur(v, prochainNumero(suivants));
        if (nouveau) suivants = [...suivants, nouveau];
      }
    }
    this.enregistrer(suivants);
    return Math.max(0, this.nonLus - avant);
  }

  private async action(numero: number, action: 'messages' | 'lu', corps: unknown = {}): Promise<string | undefined> {
    const t = this.tickets.find(x => x.numero === numero);
    if (!t?.id) return 'Cette demande n’est pas encore partie.';
    const r = await agirSurTicket(await this.o.liaison().catch(() => undefined), t.id, action, corps, this.o.requete);
    if (!r.ok) return r.motif;
    this.remplacer(numero, x => avecVueServeur(x, r.vue));
    return undefined;
  }

  /** Compléter sa demande (le message part aussi dans le fil Discord). Rend le motif d'un échec. */
  repondre(numero: number, texte: string): Promise<string | undefined> {
    if (texte.trim().length < 2) return Promise.resolve('Le message est vide.');
    return this.action(numero, 'messages', { texte: texte.trim() });
  }

  /** L'utilisateur a vu les réponses : la notification s'efface. */
  async marquerLu(numero: number): Promise<void> {
    const t = this.tickets.find(x => x.numero === numero);
    if (!t?.nonLus) return;
    await this.action(numero, 'lu');
  }
}

export { infosTechniques };
