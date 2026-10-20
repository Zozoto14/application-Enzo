/**
 * Faux serveur du planning pour les tests de l'écran (jest) : répond à
 * `client.requete(chemin, méthode, corps)` comme l'API, avec des données
 * fixes. Les droits suivent la liste de permissions donnée.
 */

import type { AccueilPlanning, AMarquer, LignePresence, Marque, CarteDispos, DroitsPlanning, FichePresence, HistoriquePresence, ListePlanning, MembreConvocable, MesDispos, Occurrence, PresenceOccurrence, StatsPresence } from './api';

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
  // Feuille d'appel : les marquages envoyés sont gardés (le faux serveur les rend ensuite).
  const marques = new Map<string, Marque>();
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
      const envoi = corps as { marques?: Marque[]; toutPresent?: boolean } | undefined;
      if (methode === 'PUT') {
        for (const m of envoi?.marques ?? []) marques.set(m.compte, { ...marques.get(m.compte), ...m });
        if (envoi?.toutPresent) for (const compte of ['lea12345', 'kai12345']) if (!marques.has(compte)) marques.set(compte, { compte, reel: 'present' });
      }
      const appliquer = (l: LignePresence): LignePresence => {
        const m = marques.get(l.compte);
        return m ? { ...l, reel: m.reel, retardMinutes: m.retardMinutes ?? l.retardMinutes ?? null, motif: m.motif ?? l.motif ?? '' } : l;
      };
      const base: LignePresence[] = [
        { compte: 'lea12345', pseudo: 'Léa', horsConvocation: false, rsvp: 'oui', retardPrevu: 10, motifPrevu: '', reel: 'inconnu', retardMinutes: null, motif: '', note: '', marqueLe: null },
        { compte: 'kai12345', pseudo: 'Kai', horsConvocation: false, rsvp: 'non', retardPrevu: null, motifPrevu: 'Examen', reel: 'inconnu', retardMinutes: null, motif: '', note: '', marqueLe: null },
      ];
      const ajoute = marques.get('tom12345');
      const lignes = [...base, ...(ajoute && ajoute.reel !== 'inconnu' ? [{ compte: 'tom12345', pseudo: 'Tom', horsConvocation: true, rsvp: 'sans_reponse' as const, reel: 'inconnu' as const, note: '', marqueLe: null }] : [])].map(appliquer);
      const n = (f: (l: LignePresence) => boolean) => lignes.filter(l => !l.horsConvocation && f(l)).length;
      r = {
        occurrence: occurrences[0],
        lignes,
        compteurs: {
          convoques: 2,
          oui: 1,
          peutEtre: 0,
          non: 1,
          sansReponse: 0,
          marques: n(l => l.reel !== 'inconnu'),
          nonMarques: n(l => l.reel === 'inconnu'),
          present: n(l => l.reel === 'present'),
          retard: n(l => l.reel === 'retard'),
          absent: n(l => l.reel === 'absent'),
          excuse: n(l => l.reel === 'excuse'),
          enPlus: lignes.filter(l => l.horsConvocation).length,
        },
        ajoutables: lignes.some(l => l.compte === 'tom12345') ? [] : [{ compte: 'tom12345', pseudo: 'Tom' }],
        commence: true,
        termine: false,
        droits,
      } satisfies PresenceOccurrence;
    } else if (/\/planning\/[^/]+$/.test(c) && methode === 'GET') {
      r = { id: OCCURRENCE.evenementId, type: 'training', titre: 'Entraînement', description: '', lieu: 'Discord', debut: OCCURRENCE.debut, fin: OCCURRENCE.fin, fuseau: 'Europe/Paris', date: '2026-10-20', heureDebut: '20:00', heureFin: '22:00', recurrence: { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null, nombre: null }, adversaireId: null, reviewId: null, concernes: [], exceptions: [], droits };
    } else if (/\/presence\/stats$/.test(c)) {
      const n = { evenements: 5, marques: 4, nonMarques: 1, present: 2, retard: 1, absent: 1, excuse: 0, enPlus: 0, rsvpOui: 3, rsvpRepondus: 4, taux: 0.75, ponctualite: 2 / 3, retardMoyen: 10, tauxReponse: 1 };
      r = {
        debut: '2026-07-23',
        fin: '2026-10-21',
        fuseau: 'Europe/Paris',
        tout: droits.voirPresences,
        noms: { lea12345: 'Léa' },
        global: n,
        joueurs: [{ compte: 'lea12345', ...n, serie: 2, serieMax: 2, tendance: -0.25 }],
        parType: [{ type: 'training', ...n }],
        parPeriode: [{ periode: '2026-10', ...n }],
      } satisfies StatsPresence;
    } else if (/\/presence\/a-marquer$/.test(c)) {
      r = { total: 1, jours: 30, seances: [{ ...occurrences[0], convoquesTotal: 2, marques: 0, restants: 2, enCours: true }] } satisfies AMarquer;
    } else if (/\/presence\/historique$/.test(c)) {
      const n = { evenements: 2, marques: 1, nonMarques: 1, present: 1, retard: 0, absent: 0, excuse: 0, enPlus: 0, rsvpOui: 1, rsvpRepondus: 2, taux: 1, ponctualite: 1, retardMoyen: null, tauxReponse: 1 };
      r = { debut: '2026-07-23', fin: '2026-10-21', fuseau: 'Europe/Paris', seances: [{ evenementId: OCCURRENCE.evenementId, cle: OCCURRENCE.cle, titre: 'Entraînement', type: 'training', jour: '2026-10-20', heureDebut: '20:00', ...n }] } satisfies HistoriquePresence;
    } else if (/\/presence\/joueurs\/[^/]+$/.test(c)) {
      r = {
        compte: 'lea12345',
        pseudo: 'Léa',
        debut: '2026-09-21',
        fin: '2026-10-21',
        evenements: 3,
        marques: 2,
        nonMarques: 1,
        present: 1,
        retard: 0,
        absent: 1,
        excuse: 0,
        enPlus: 0,
        rsvpOui: 1,
        rsvpRepondus: 2,
        taux: 0.5,
        ponctualite: 1,
        retardMoyen: null,
        tauxReponse: 2 / 3,
        serie: 1,
        serieMax: 1,
        historique: [
          { evenementId: OCCURRENCE.evenementId, cle: OCCURRENCE.cle, titre: 'Entraînement', type: 'training', jour: '2026-10-20', heureDebut: '20:00', compte: 'lea12345', pseudo: 'Léa', rsvp: 'non', motifPrevu: 'Examen', reel: 'absent', motif: 'Examen', note: '', marqueLe: null },
        ],
        motifs: [{ motif: 'Examen', n: 1 }],
      } satisfies FichePresence;
    } else if (/\/suivi\/moi$/.test(c)) {
      r = { notes: [] };
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
