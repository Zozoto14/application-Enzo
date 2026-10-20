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
 *   GET    /fichiers/:id?c=&exp=&sig=              lecture par lien signé (sans session)
 *
 *   GET|POST          /teams/:t/objectifs          ; PATCH|DELETE /teams/:t/objectifs/:id
 *   GET|POST          /teams/:t/taches             (?filtre=miennes|retard&statut=&objectif=&assigne=&priorite=)
 *   PATCH|DELETE      /teams/:t/taches/:id
 *   GET               /teams/:t/taches/export.csv ; /teams/:t/objectifs/export.csv  (?format=json : enveloppe)
 */

import { servicesObjectifs } from './objectifs.mjs';
import { servicesResumes } from './resumes.mjs';
import { ENTETES_SECURITE, disposition, reponseFichier } from './entetes.mjs';
import { echec } from './outils.mjs';

const ENTETES_PDF = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, no-store',
  ...ENTETES_SECURITE,
  // Pas de « sandbox » : Chrome refuserait d'afficher le PDF.
  'Content-Security-Policy': "frame-ancestors 'none'",
};

/** Lecture d'un fichier par lien signé : avant la session (le lien porte la preuve). */
export async function routeFichierSigne(resumes, url) {
  const f = /^\/fichiers\/([^/]+)$/.exec(url.pathname.replace(/^\/api\/esport(?=\/|$)/, ''));
  if (!f) return undefined;
  const { octets, type, nom, telecharger } = await resumes.lireFichierSigne(f[1], url.searchParams);
  return new Response(octets, {
    status: 200,
    headers: { ...ENTETES_PDF, 'Content-Type': type, 'Content-Length': String(octets.length), 'Content-Disposition': disposition(nom, !telecharger) },
  });
}

const filtresTaches = q => ({
  filtre: q.get('filtre') || undefined,
  statut: q.get('statut') || undefined,
  objectif: q.get('objectif') || undefined,
  assigne: q.get('assigne') || undefined,
  priorite: q.get('priorite') || undefined,
});

export function servicesPhase3({ base, stockage, cleSession, maintenant, socle }) {
  return {
    resumes: servicesResumes({ base, stockage, cleSession, maintenant, socle }),
    objectifs: servicesObjectifs({ base, maintenant, socle }),
  };
}

/**
 * Routeur des routes authentifiées de la phase 3. Rend `undefined` si la
 * route n'est pas la sienne (api.mjs continue alors).
 */
export async function routerPhase3({ resumes, objectifs }, { requete, url, chemin, acteur, lireCorps }) {
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

  const r = /^\/teams\/([^/]+)\/(resumes|objectifs|taches)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(chemin);
  if (!r) return undefined;
  const [, teamId, section, a, b, c] = r;

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
