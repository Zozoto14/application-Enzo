/**
 * Relevés AUTOMATIQUES des statistiques : interface d'adaptateur (V1 : aucun adaptateur branché).
 *
 * En V1 tout se saisit à la main ou par import CSV : X, Instagram et TikTok exigent des comptes développeur
 * (et des jetons) pour lire les statistiques. Pour brancher une API plus tard, il suffit d'écrire un adaptateur
 * et de le passer au cron (`tachesPlanifiees(…, { adaptateursReseaux })`) — rien d'autre à changer : les relevés
 * arrivent dans les mêmes tables (`source` = « api:<nom> »), les tableaux de bord, l'export et les rappels les
 * prennent tels quels.
 *
 * Contrat d'un adaptateur (objet) :
 *   nom            : texte court [a-z0-9-] (ex. « x-api ») ;
 *   reseaux        : réseaux couverts (clés de RESEAUX_COMPTES) ;
 *   releverCompte? : async ({ compte: { id, reseau, identifiant, url }, jour }) → { abonnes?, publications?, vues?, impressions? }
 *   releverPost?   : async ({ publication: { id, reseau, url, publieLe }, compte, jour }) → { vues?, likes?, … } (METRIQUES_POST)
 * Les valeurs rendues passent par la même validation que la saisie manuelle (nombres ≥ 0) ; une erreur d'un
 * adaptateur n'arrête pas les autres (elle est comptée dans le bilan). Les secrets (jetons d'API) restent dans
 * l'adaptateur (variables d'environnement du serveur), jamais en base.
 */

import { iso, nouvelId } from '../outils.mjs';
import { METRIQUES_COMPTE, METRIQUES_POST, jourDans, normaliserMetriques } from './regles.mjs';

const MOTIF_NOM = /^[a-z0-9-]{2,30}$/;

/** Registre validé : `Map<reseau, adaptateur>` (un adaptateur par réseau ; le dernier déclaré l'emporte). */
export function registreAdaptateurs(adaptateurs = []) {
  const registre = new Map();
  for (const a of adaptateurs) {
    if (!a || !MOTIF_NOM.test(String(a.nom ?? '')) || !Array.isArray(a.reseaux) || (typeof a.releverCompte !== 'function' && typeof a.releverPost !== 'function')) {
      throw new Error('Adaptateur de statistiques invalide (nom, reseaux, releverCompte ou releverPost).');
    }
    for (const r of a.reseaux) registre.set(r, a);
  }
  return registre;
}

/** Requêtes (fixes) d'enregistrement d'un relevé : un par jour, la valeur du jour est remplacée. */
const SQL_RELEVE = Object.freeze({
  compte: `INSERT INTO cm_rs_releves_comptes (id, compte_id, jour, abonnes, publications, vues, impressions, source, saisi_par, cree_le, maj_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (compte_id, jour) DO UPDATE SET abonnes = excluded.abonnes, publications = excluded.publications, vues = excluded.vues,
             impressions = excluded.impressions, source = excluded.source, saisi_par = excluded.saisi_par, maj_le = excluded.maj_le`,
  post: `INSERT INTO cm_rs_releves_posts (id, publication_id, jour, vues, likes, commentaires, partages, enregistrements, impressions, portee, clics, duree_moyenne, taux_completion, source, saisi_par, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (publication_id, jour) DO UPDATE SET vues = excluded.vues, likes = excluded.likes, commentaires = excluded.commentaires,
           partages = excluded.partages, enregistrements = excluded.enregistrements, impressions = excluded.impressions, portee = excluded.portee,
           clics = excluded.clics, duree_moyenne = excluded.duree_moyenne, taux_completion = excluded.taux_completion, source = excluded.source,
           saisi_par = excluded.saisi_par, maj_le = excluded.maj_le`,
});

/** Enregistre un relevé (un par jour : la valeur du jour est remplacée). Instruction SQL. */
export function instructionReleve(genre, cibleId, jour, valeurs, { source = 'manuel', saisiPar = null, t }) {
  const champs = genre === 'compte' ? METRIQUES_COMPTE : METRIQUES_POST;
  return { sql: SQL_RELEVE[genre === 'compte' ? 'compte' : 'post'], params: [nouvelId(), cibleId, jour, ...champs.map(c => valeurs[c] ?? null), source, saisiPar, iso(t), iso(t)] };
}

/**
 * Relevés automatiques du jour (cron) : comptes actifs et publications des 30 derniers jours des réseaux couverts.
 * Sans adaptateur : rien (0). Rend `{ comptes, publications, erreurs }`.
 */
export async function releverAutomatiquement(base, { adaptateurs = [], maintenant = Date.now() } = {}) {
  const registre = registreAdaptateurs(adaptateurs);
  const bilan = { comptes: 0, publications: 0, erreurs: 0 };
  if (registre.size === 0) return bilan;
  const jour = jourDans(maintenant);
  const reseaux = [...registre.keys()];
  const comptes = await base.tous(`SELECT id, reseau, identifiant, url FROM cm_rs_comptes WHERE supprime_le IS NULL AND actif = 1 AND reseau IN (${reseaux.map(() => '?').join(', ')})`, reseaux);
  for (const c of comptes) {
    const a = registre.get(c.reseau);
    if (typeof a.releverCompte !== 'function') continue;
    try {
      const v = normaliserMetriques(await a.releverCompte({ compte: c, jour }), METRIQUES_COMPTE);
      if (v.erreur) throw new Error(v.erreur);
      await base.lot([instructionReleve('compte', c.id, jour, v, { source: `api:${a.nom}`, t: maintenant })]);
      bilan.comptes++;
    } catch {
      bilan.erreurs++;
    }
  }
  const publications = await base.tous(
    `SELECT id, reseau, url, publie_le, compte_id FROM cm_rs_publications WHERE supprime_le IS NULL AND publie_le >= ? AND reseau IN (${reseaux.map(() => '?').join(', ')}) ORDER BY publie_le DESC LIMIT 500`,
    [iso(maintenant - 30 * 86_400_000), ...reseaux],
  );
  const parId = new Map(comptes.map(c => [c.id, c]));
  for (const p of publications) {
    const a = registre.get(p.reseau);
    if (typeof a.releverPost !== 'function') continue;
    try {
      const v = normaliserMetriques(await a.releverPost({ publication: { id: p.id, reseau: p.reseau, url: p.url, publieLe: p.publie_le }, compte: parId.get(p.compte_id) ?? null, jour }), METRIQUES_POST);
      if (v.erreur) throw new Error(v.erreur);
      await base.lot([instructionReleve('post', p.id, jour, v, { source: `api:${a.nom}`, t: maintenant })]);
      bilan.publications++;
    } catch {
      bilan.erreurs++;
    }
  }
  return bilan;
}
