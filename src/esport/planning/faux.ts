/**
 * Faux serveur du planning pour les tests de l'écran (jest) : répond à
 * `client.requete(chemin, méthode, corps)` comme l'API, avec des données
 * fixes. Les droits suivent la liste de permissions donnée.
 */

import type { AccueilPlanning, CarteDispos, DroitsPlanning, ListePlanning, MembreConvocable, MesDispos, Occurrence, PresenceOccurrence, StatsPresence } from './api';

export function droitsDe(permissions: readonly string[]): DroitsPlanning {
  const a = (p: string) => permissions.includes(p);
  return {
    creer: a('planning.create'),
    modifier: a('planning.update'),
    supprimer: a('planning.delete'),
    rsvp: a('attendance.rsvp_own'),
    marquer: a('attendance.mark'),
    voirPresences: a('attendance.view_all'),
    voirDispos: a('availability.view_all'),
    saisirDispos: a('availability.edit_own'),
    reglages: a('team.manage'),
  };
}

export const OCCURRENCE: Occurrence = {
  evenementId: 'e1e1e1e1-0000-4000-8000-000000000001',
  cle: '2026-10-20T18:00:00.000Z',
  type: 'training',
  titre: 'Entraînement',
  description: 'Aim puis exécutions',
  lieu: 'Discord',
  debut: '2026-10-20T18:00:00.000Z',
  fin: '2026-10-20T20:00:00.000Z',
  jour: '2026-10-20',
  heureDebut: '20:00',
  jourFin: '2026-10-20',
  heureFin: '22:00',
  recurrent: true,
  modifiee: false,
  adversaireId: null,
  reviewId: null,
  convocation: { groupes: ['joueurs'], membres: [], exclus: [], proprietaires: [] },
  convoques: ['lea12345', 'kai12345'],
  concernes: ['lea12345', 'kai12345'],
  convoqueMoi: true,
  concerneMoi: true,
  monRsvp: 'sans_reponse',
  maPresence: 'inconnu',
  reponses: null,
  termine: false,
};

/** Membres convocables (formulaire du staff) : deux joueurs, un coach, deux Propriétaires (dont le Fondateur). */
export const MEMBRES_CONVOCABLES: MembreConvocable[] = [
  { compte: 'lea12345', pseudo: 'Léa', groupe: 'joueurs' },
  { compte: 'kai12345', pseudo: 'Kai', groupe: 'joueurs' },
  { compte: 'zed12345', pseudo: 'Zed', groupe: 'staff' },
  { compte: 'principal', pseudo: 'Fondateur', groupe: 'proprietaire' },
  { compte: 'own12345', pseudo: 'Olga', groupe: 'proprietaire' },
];

export interface AppelPlanning {
  chemin: string;
  methode: string;
  corps?: unknown;
}

/** `requete` du faux client ; `appels` garde la trace de chaque appel. */
export function fauxPlanning(permissions: readonly string[], { occurrences = [OCCURRENCE] }: { occurrences?: Occurrence[] } = {}) {
  const appels: AppelPlanning[] = [];
  const droits = droitsDe(permissions);
  const requete = async <T>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    let r: unknown = { ok: true };
    if (/\/planning$/.test(c) && methode === 'GET') {
      r = { fuseau: 'Europe/Paris', fuseauTeam: 'Europe/Paris', du: '', au: '', occurrences, droits, modules: { presence: true, dispos: true }, membres: droits.creer || droits.modifier ? MEMBRES_CONVOCABLES : null } satisfies ListePlanning;
    } else if (/\/planning\/accueil$/.test(c)) {
      r = { fuseau: 'Europe/Paris', prochains: occurrences, alertes: [{ ...occurrences[0], genre: 'rsvp' }], droits, modules: { presence: true } } satisfies AccueilPlanning;
    } else if (/\/planning\/ical$/.test(c) && methode === 'GET') {
      r = { abonnements: [] };
    } else if (/\/planning\/ical$/.test(c)) {
      r = { jeton: 'ical_x', chemin: '/ical/ical_x.ics', abonnement: { id: 'a1', libelle: 'Mon calendrier', creeLe: '', dernierAcces: null, revoque: false } };
    } else if (/\/planning\/reglages$/.test(c)) {
      r = { effectifMin: 5, rappelHeures: 24, fuseau: 'Europe/Paris', droits };
    } else if (/\/presence$/.test(c)) {
      r = {
        occurrence: occurrences[0],
        lignes: [
          { compte: 'lea12345', pseudo: 'Léa', rsvp: 'oui', reel: 'inconnu', note: '', marqueLe: null },
          { compte: 'kai12345', pseudo: 'Kai', rsvp: 'non', reel: 'inconnu', note: '', marqueLe: null },
        ],
        droits,
      } satisfies PresenceOccurrence;
    } else if (/\/planning\/[^/]+$/.test(c) && methode === 'GET') {
      r = { id: OCCURRENCE.evenementId, type: 'training', titre: 'Entraînement', description: '', lieu: 'Discord', debut: OCCURRENCE.debut, fin: OCCURRENCE.fin, fuseau: 'Europe/Paris', date: '2026-10-20', heureDebut: '20:00', heureFin: '22:00', recurrence: { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null, nombre: null }, adversaireId: null, reviewId: null, concernes: [], exceptions: [], droits };
    } else if (/\/presence\/stats$/.test(c)) {
      const n = { evenements: 4, marques: 4, present: 2, retard: 1, absent: 1, excuse: 0, rsvpOui: 3, rsvpRepondus: 4, taux: 0.75, ponctualite: 2 / 3, tauxReponse: 1 };
      r = { debut: '', fin: '', fuseau: 'Europe/Paris', tout: droits.voirPresences, noms: { lea12345: 'Léa' }, global: n, joueurs: [{ compte: 'lea12345', ...n }], parType: [{ type: 'training', ...n }], parPeriode: [{ periode: '2026-10', ...n }] } satisfies StatsPresence;
    } else if (/\/presence\/export\.csv$/.test(c)) {
      r = { nom: 'presence.csv', type: 'text/csv', contenu: '"Date"\r\n' };
    } else if (/\/dispos\/moi/.test(c)) {
      r = { fuseau: 'Europe/Paris', fuseauTeam: 'Europe/Paris', regles: [{ id: 'r1', jour: 1, debut: '19:00', fin: '23:00', type: 'disponible', fuseau: 'Europe/Paris' }], exceptions: [], droits } satisfies MesDispos;
    } else if (/\/dispos\/carte$/.test(c)) {
      const jours = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
      const creneaux = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
      r = {
        fuseau: 'Europe/Paris',
        fuseauTeam: 'Europe/Paris',
        pas: 60,
        seuil: 2,
        total: 3,
        renseignes: 3,
        noms: { a: 'Léa', b: 'Kai', c: 'Tom' },
        jours,
        creneaux,
        cellules: jours.map((j, d) => creneaux.map((h, i) => ({ debut: `${j}T${h}:00.000Z`, fin: `${j}T${h}:00.000Z`, n: d === 0 && i >= 20 && i < 22 ? 2 : 0, comptes: d === 0 && i >= 20 && i < 22 ? ['a', 'b'] : [], atteint: d === 0 && i >= 20 && i < 22 }))),
        plages: [{ jour: '2026-10-19', debut: '2026-10-19T18:00:00.000Z', fin: '2026-10-19T20:00:00.000Z', n: 2, heureDebut: '20:00', heureFin: '22:00' }],
        droits,
      } satisfies CarteDispos;
    }
    return r as T;
  };
  return { requete, appels };
}
