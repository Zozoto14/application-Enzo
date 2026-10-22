/**
 * Routes HTTP de la phase 3 (résumés de réunions, objectifs et tâches),
 * branchées par api.mjs. Même middleware que le reste : la session est déjà
 * vérifiée (authentification) ; appartenance, module et permission sont
 * contrôlés dans resumes.mjs et objectifs.mjs.
 *
 *   GET    /resumes/boite                          boîte de réception (toutes teams accessibles)
 *   GET    /teams/:t/resumes                       résumés terminés lisibles (?limite=)
 *   POST   /teams/:t/resumes                       déposer une réunion
 *   GET    /teams/:t/resumes/miens                 historique de mes dépôts
 *   GET    /teams/:t/resumes/types                 types de réunion (globaux + team)
 *   POST   /teams/:t/resumes/types                 créer un type (rédacteur ; `global` : Fondateur)
 *   PATCH  /teams/:t/resumes/types/:id             modifier un type
 *   DELETE /teams/:t/resumes/types/:id             supprimer un type (logique)
 *   GET    /teams/:t/resumes/:id                   détail (+ historique des PDF pour les rédacteurs)
 *   DELETE /teams/:t/resumes/:id                   supprimer un dépôt
 *   POST   /teams/:t/resumes/:id/vu                marquer « Vu » (rédacteur)
 *   PATCH  /teams/:t/resumes/:id                   changer le statut (rédacteur)
 *   PUT    /teams/:t/resumes/:id/pdf               déposer / remplacer le PDF (corps binaire application/pdf)
 *   POST   /teams/:t/resumes/:id/lien              lien signé temporaire vers le PDF
 *   GET    /fichiers/:id?c=&exp=&sig=              lecture par lien signé (sans session ; Range accepté)
 *   POST   /teams/:t/resumes/envois                ; GET|DELETE …/envois/:e ; PUT …/envois/:e/morceaux/:i ; POST …/envois/:e/fin
 *   POST   /teams/:t/resumes/:id/enregistrement/lien   lien signé (2 h) de l'enregistrement déposé
 *   GET    /teams/:t/resumes/:id/transcription     transcription horodatée (même visibilité que le dépôt)
 *   PUT    /teams/:t/resumes/:id/transcription     enregistrer (partielle ou complète → PDF) : déposant, rédacteurs
 *   POST   /teams/:t/resumes/:id/transcription/lien     lien signé du PDF de transcription
 *   POST   /teams/:t/resumes/:id/transcription/externe  API externe (désactivée par défaut)
 *   POST   /teams/:t/resumes/:id/transcription/serveur  transcription sur le serveur (file) ; DELETE : annuler
 *   GET    /teams/:t/resumes/reglages-transcription     mode de transcription de la team ; PATCH (team.manage)
 *
 *   GET|POST          /teams/:t/objectifs          ; PATCH|DELETE /teams/:t/objectifs/:id
 *   GET|POST          /teams/:t/taches             (?filtre=miennes|retard&statut=&objectif=&assigne=&priorite=)
 *   PATCH|DELETE      /teams/:t/taches/:id
 *   GET               /teams/:t/taches/export.csv ; /teams/:t/objectifs/export.csv  (?format=json : enveloppe)
 */

import { servicesObjectifs } from './objectifs.mjs';
import { servicesResumes } from './resumes.mjs';
import { reponseFichier } from './entetes.mjs';
import { echec } from './outils.mjs';
import { routesEnvois } from './review/routes.mjs';

/**
 * Lecture d'un fichier par lien signé : avant la session (le lien porte la preuve). Entier, ou par
 * plage (en-tête Range → 206) pour les vidéos et les enregistrements (medias/lecture.mjs).
 */
export async function routeFichierSigne(medias, url, requete) {
  const f = /^\/fichiers\/([^/]+)$/.exec(url.pathname.replace(/^\/api\/esport(?=\/|$)/, ''));
  if (!f) return undefined;
  return medias.servirFichierSigne(f[1], url.searchParams, requete);
}

const filtresTaches = q => ({
  filtre: q.get('filtre') || undefined,
  statut: q.get('statut') || undefined,
  objectif: q.get('objectif') || undefined,
  assigne: q.get('assigne') || undefined,
  priorite: q.get('priorite') || undefined,
});

export function servicesPhase3({ base, stockage, cleSession, maintenant, socle, medias, transcriptionExterne, fetchTranscription, transcriptionServeur }) {
  return {
    resumes: servicesResumes({ base, stockage, cleSession, maintenant, socle, medias, transcriptionExterne, fetchTranscription, ...(transcriptionServeur ? { transcriptionServeur } : {}) }),
    objectifs: servicesObjectifs({ base, maintenant, socle }),
  };
}

/**
 * Routeur des routes authentifiées de la phase 3. Rend `undefined` si la
 * route n'est pas la sienne (api.mjs continue alors).
 */
/** Corps JSON d'une transcription (jusqu'à 2 Mo). */
const TAILLE_MAX_TRANSCRIPTION = 2 * 1024 * 1024;

export async function routerPhase3({ resumes, objectifs }, { requete, url, chemin, acteur, lireCorps, medias }) {
  const m = requete.method;
  const q = url.searchParams;

  if (chemin === '/resumes/boite' && m === 'GET') {
    return resumes.boite(acteur, {
      statut: q.get('statut') || undefined,
      team: q.get('team') || undefined,
      type: q.get('type') || undefined,
      du: q.get('du') || undefined,
      au: q.get('au') || undefined,
      deposePar: q.get('deposePar') || undefined,
      nouveaux: q.get('nouveaux') === '1',
      tri: q.get('tri') || undefined,
      limite: q.get('limite') || undefined,
    });
  }

  const r = /^\/teams\/([^/]+)\/(resumes|objectifs|taches)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(chemin);
  if (!r) return undefined;
  const [, teamId, section, a, b, c, d] = r;
  const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
  const lienAbsolu = ({ chemin: lien, expire }) => ({ url: `${url.origin}${prefixe}${lien}`, expire: new Date(expire).toISOString() });

  if (section === 'resumes' && a === 'envois' && medias) {
    return routesEnvois({ medias, acteur, teamId, usage: 'reunion', p: [b, c, d].filter(Boolean), methode: m, requete, lireCorps: () => lireCorps(requete) });
  }
  // Paramètres de la team : mode de transcription par défaut (serveur, navigateur, API externe).
  if (section === 'resumes' && a === 'reglages-transcription' && !b) {
    if (m === 'GET') return resumes.reglagesTranscription(acteur, teamId);
    if (m === 'PATCH') return resumes.changerReglagesTranscription(acteur, teamId, await lireCorps(requete));
  }
  if (section === 'resumes' && a && a !== 'miens' && a !== 'types') {
    if (b === 'transcription' && c === 'serveur' && !d && m === 'POST') return resumes.demanderTranscriptionServeur(acteur, teamId, a, await lireCorps(requete));
    if (b === 'transcription' && c === 'serveur' && !d && m === 'DELETE') return resumes.annulerTranscriptionServeur(acteur, teamId, a);
    if (b === 'enregistrement' && c === 'lien' && !d && m === 'POST') return lienAbsolu(await resumes.lienEnregistrement(acteur, teamId, a, await lireCorps(requete)));
    if (b === 'transcription' && !c && m === 'GET') return resumes.transcription(acteur, teamId, a);
    if (b === 'transcription' && !c && m === 'PUT') return resumes.enregistrerTranscription(acteur, teamId, a, await lireCorps(requete, TAILLE_MAX_TRANSCRIPTION));
    if (b === 'transcription' && c === 'lien' && !d && m === 'POST') return lienAbsolu(await resumes.lienTranscription(acteur, teamId, a, await lireCorps(requete)));
    if (b === 'transcription' && c === 'externe' && !d && m === 'POST') return resumes.demanderTranscriptionExterne(acteur, teamId, a, await lireCorps(requete));
  }
  if (d) throw echec(404, 'route', 'Adresse inconnue.');

  if (section === 'resumes') {
    if (!a) {
      if (m === 'GET') return { resumes: await resumes.resumesTeam(acteur, teamId, { limite: q.get('limite') }) };
      if (m === 'POST') return resumes.deposer(acteur, teamId, await lireCorps(requete));
    }
    if (a === 'miens' && !b && m === 'GET') return { depots: await resumes.mesDepots(acteur, teamId) };
    if (a === 'types') {
      if (!b && m === 'GET') return { types: await resumes.typesReunion(acteur, teamId) };
      if (!b && m === 'POST') return resumes.creerTypeReunion(acteur, teamId, await lireCorps(requete));
      if (b && !c && m === 'PATCH') return resumes.modifierTypeReunion(acteur, teamId, b, await lireCorps(requete));
      if (b && !c && m === 'DELETE') return resumes.supprimerTypeReunion(acteur, teamId, b);
    }
    if (a && a !== 'miens' && a !== 'types') {
      if (!b && m === 'GET') return resumes.detail(acteur, teamId, a);
      if (!b && m === 'PATCH') return resumes.changerStatut(acteur, teamId, a, await lireCorps(requete));
      if (!b && m === 'DELETE') return resumes.supprimerDepot(acteur, teamId, a);
      if (b === 'vu' && !c && m === 'POST') return resumes.marquerVu(acteur, teamId, a);
      if (b === 'pdf' && !c && (m === 'PUT' || m === 'POST')) return resumes.deposerPdf(acteur, teamId, a, requete);
      if (b === 'lien' && !c && m === 'POST') {
        const { chemin: lien, expire } = await resumes.lienFichier(acteur, teamId, a, await lireCorps(requete));
        const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
        return { url: `${url.origin}${prefixe}${lien}`, expire: new Date(expire).toISOString() };
      }
    }
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  if (section === 'objectifs' && a === 'export.csv' && !b && m === 'GET') return reponseFichier(await objectifs.exporterObjectifs(acteur, teamId), url);
  if (section === 'taches' && a === 'export.csv' && !b && m === 'GET') return reponseFichier(await objectifs.exporterTaches(acteur, teamId, filtresTaches(q)), url);
  if (section === 'objectifs' && !b) {
    if (!a && m === 'GET') return { objectifs: await objectifs.objectifs(acteur, teamId) };
    if (!a && m === 'POST') return objectifs.creerObjectif(acteur, teamId, await lireCorps(requete));
    if (a && m === 'PATCH') return objectifs.modifierObjectif(acteur, teamId, a, await lireCorps(requete));
    if (a && m === 'DELETE') return objectifs.supprimerObjectif(acteur, teamId, a);
  }
  if (section === 'taches' && !b) {
    if (!a && m === 'GET') {
      return objectifs.taches(acteur, teamId, { ...filtresTaches(q), limite: q.get('limite') || undefined, decalage: q.get('decalage') || undefined });
    }
    if (!a && m === 'POST') return objectifs.creerTache(acteur, teamId, await lireCorps(requete));
    if (a && m === 'PATCH') return objectifs.modifierTache(acteur, teamId, a, await lireCorps(requete));
    if (a && m === 'DELETE') return objectifs.supprimerTache(acteur, teamId, a);
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
