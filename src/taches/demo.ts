/**
 * Données d'exemple (facultatives) pour découvrir l'app : un espace
 * « Exemple » avec un projet, deux listes et quelques tâches variées.
 * Retirées d'un geste (pierre tombale de l'espace).
 */

import { ajouterJours } from './dates';
import {
  ajouterCommentaire,
  ajouterElement,
  changerElement,
  changerReglages,
  creerEspace,
  creerListe,
  creerProjet,
  creerTache,
  modifierListe,
  supprimerEspace,
  vivant,
  type Contexte,
  type DonneesTaches,
  type SaisieTache,
} from './modele';

export function ajouterDemo(d: DonneesTaches, ctx: Contexte, aujourdhui: string): { donnees: DonneesTaches; projetId: string } {
  let r = creerEspace(d, 'Exemple', ctx, '#B78CFF');
  const espace = r.espace;
  const p = creerProjet(r.donnees, espace.id, 'Lancement du site', ctx);
  let donnees = modifierListe(p.donnees, p.liste.id, { nom: 'Préparation' }, ctx);
  const l2 = creerListe(donnees, p.projet.id, 'Mise en ligne', ctx);
  donnees = l2.donnees;
  const j = (n: number) => ajouterJours(aujourdhui, n);
  const taches: Array<[SaisieTache, string?]> = [
    [{ titre: 'Relire les textes de la page d’accueil', listeId: p.liste.id, priorite: 'haute', echeance: { jour: j(-1) }, etiquettes: ['contenu'], statut: 'en-cours' }],
    [{ titre: 'Choisir les photos', listeId: p.liste.id, echeance: { jour: j(0), heure: '14:00' }, etiquettes: ['design'], rappels: [30] }],
    [{ titre: 'Appeler l’hébergeur', listeId: p.liste.id, priorite: 'urgente', echeance: { jour: j(0), heure: '10:30' }, description: 'Numéro sur https://exemple.fr/contact' }],
    [{ titre: 'Préparer la checklist de mise en ligne', listeId: l2.liste.id, echeance: { jour: j(2) }, etiquettes: ['technique'], statut: 'en-revue' }, 'checklist'],
    [{ titre: 'Point hebdo', listeId: l2.liste.id, echeance: { jour: j(3), heure: '09:00' }, recurrence: { type: 'hebdo', jours: [1] }, etiquettes: ['equipe'] }],
    [{ titre: 'Annoncer le lancement', listeId: l2.liste.id, priorite: 'basse', echeance: { jour: j(9) }, etiquettes: ['communication'] }],
    [{ titre: 'Acheter le nom de domaine', listeId: p.liste.id, statut: 'fait', etiquettes: ['technique'] }],
    [{ titre: 'Idées pour la page « À propos »', listeId: p.liste.id, pourAujourdhui: aujourdhui }],
  ];
  for (const [saisie, extra] of taches) {
    const c = creerTache(donnees, saisie, ctx);
    donnees = c.donnees;
    if (extra === 'checklist') {
      for (const e of ['Sauvegarde', 'Certificat HTTPS', 'Redirections', 'Test sur téléphone']) donnees = ajouterElement(donnees, c.tache.id, e, ctx);
      const premier = Object.values(donnees.taches[c.tache.id].checklist)[0];
      donnees = changerElement(donnees, c.tache.id, premier.id, { fait: true }, ctx);
      donnees = ajouterCommentaire(donnees, c.tache.id, 'Pensez à tester aussi sur l’iPad.', ctx);
    }
  }
  donnees = changerReglages(donnees, { demo: espace.id }, ctx);
  r = { donnees, espace };
  return { donnees: r.donnees, projetId: p.projet.id };
}

export function retirerDemo(d: DonneesTaches, ctx: Contexte): DonneesTaches {
  const id = d.reglages.demo;
  if (!id) return d;
  const sans = vivant(d.espaces[id]) ? supprimerEspace(d, id, ctx) : d;
  return changerReglages(sans, { demo: undefined }, ctx);
}
