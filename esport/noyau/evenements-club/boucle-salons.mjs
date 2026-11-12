/**
 * Boucle rapide des salons de match (docs/esport/evenements.md, « Synchronisation ») : tenue par UN SEUL processus
 * de l'app Esport (bail `salons-match-boucle` dans tickets_bail, comme le meneur de la Gateway), que les tickets, la
 * bienvenue ou les salons vocaux soient activés ou non (avant : le passage rapide n'existait que dans le superviseur de
 * la Gateway, et seulement quand une de ces fonctions était activée ; sinon, une relecture toutes les 5 minutes).
 *
 * Toutes les 15 s, le meneur : reprend les avis du site non traités (processus redémarré, autre processus occupé),
 * relit les événements en cours (60 s ; 15 s s'il reste du travail), vide la file d'envoi (réessais, « Mise à jour »
 * regroupées). Tant qu'un événement est en cours, il garde l'app éveillée (Passenger arrête un processus sans requête) :
 * URL_PUBLIQUE/sante toutes les 4 minutes. Sans processus (app endormie), le cron (5 min) relit et réveille l'app.
 */

import { hostname } from 'node:os';
import { iso } from '../outils.mjs';

export const BAIL_BOUCLE = 'salons-match-boucle';
export const INTERVALLE_BOUCLE_MS = 15_000;
export const DUREE_BAIL_BOUCLE_MS = 45_000;
export const INTERVALLE_REVEIL_BOUCLE_MS = 240_000;

async function prendreBail(base, titulaire, t, duree) {
  await base.executer("INSERT INTO tickets_bail (id, titulaire, expire_le, maj_le) VALUES (?, NULL, '1970-01-01T00:00:00.000Z', ?) ON CONFLICT (id) DO NOTHING", [BAIL_BOUCLE, iso(t)]);
  const r = await base.executer('UPDATE tickets_bail SET titulaire = ?, expire_le = ?, maj_le = ? WHERE id = ? AND (titulaire = ? OR titulaire IS NULL OR expire_le < ?)', [titulaire, iso(t + duree), iso(t), BAIL_BOUCLE, titulaire, iso(t)]);
  return Number(r.changements) === 1;
}

/**
 * `salonsMatch` : service (salons-match.mjs) ; `reveil` : adresse /sante de l'app (null : pas de maintien en éveil).
 * Rend `{ passage, demarrer, arreter, etat }`.
 */
export function creerBoucleSalonsMatch({
  base,
  salonsMatch,
  maintenant = () => Date.now(),
  identifiant = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}:sm`,
  intervalle = INTERVALLE_BOUCLE_MS,
  dureeBail = DUREE_BAIL_BOUCLE_MS,
  reveil = null,
  fetchReveil = (...a) => globalThis.fetch(...a),
  intervalleReveil = INTERVALLE_REVEIL_BOUCLE_MS,
  journal = console,
}) {
  let minuterie = null;
  let enCours = null;
  let meneur = false;
  let arrete = false;
  let dernierReveil = 0;
  let dernier = null;

  function maintenirEveil(t) {
    if (!reveil || t - dernierReveil < intervalleReveil) return;
    dernierReveil = t;
    Promise.resolve()
      .then(() => fetchReveil(reveil, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) }))
      .catch(() => undefined);
  }

  async function passage() {
    if (enCours) return enCours;
    enCours = (async () => {
      const t = maintenant();
      meneur = await prendreBail(base, identifiant, t, dureeBail);
      if (!meneur) return { meneur: false };
      const r = await salonsMatch.tacheBoucle();
      if (r?.enCours > 0) maintenirEveil(t);
      dernier = { ...r, le: iso(t) };
      return { meneur: true, ...r };
    })();
    try {
      return await enCours;
    } finally {
      enCours = null;
    }
  }

  return {
    identifiant,
    passage,
    demarrer() {
      if (minuterie || arrete) return;
      const tour = () => {
        passage().catch(e => journal.error?.('[esport] salons de match : boucle', e?.message ?? e));
      };
      tour();
      minuterie = setInterval(tour, intervalle);
      minuterie.unref?.();
    },
    async arreter() {
      arrete = true;
      if (minuterie) clearInterval(minuterie);
      minuterie = null;
      await enCours?.catch(() => undefined);
      await salonsMatch.attendrePoussees?.().catch(() => undefined);
      if (meneur) await base.executer('UPDATE tickets_bail SET expire_le = ?, maj_le = ? WHERE id = ? AND titulaire = ?', [iso(maintenant() - 1), iso(maintenant()), BAIL_BOUCLE, identifiant]).catch(() => undefined);
      meneur = false;
    },
    etat: () => ({ meneur, dernier }),
  };
}
