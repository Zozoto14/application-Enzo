/**
 * Avis de nouvelle version d'un coffre (relais version 10, docs/synchro-relais.md).
 *
 * Quand un appareil écrit dans le coffre d'un compte, le serveur prévient les autres appareils de ce
 * compte que « le coffre X a maintenant la révision N » — et rien d'autre : aucune donnée, aucun
 * identifiant d'enregistrement. L'appareil tire ensuite lui-même les différences (`GET
 * /v10/coffre/<compte>?depuis=<rev>`), chiffrées de bout en bout comme avant.
 *
 * Trois façons d'attendre, de la plus rapide à la plus robuste (l'appareil descend seul l'échelle) :
 *
 *   GET /v10/coffre/<compte>/flux?rev=<n>        flux SSE (text/event-stream) : un événement `version`
 *                                                à chaque écriture, un battement de cœur toutes les
 *                                                15 s, fermé au bout de 5 min (l'appareil se reconnecte)
 *   GET /v10/coffre/<compte>/attendre?rev=<n>    attente longue : répond dès que la révision dépasse n,
 *                                                ou au bout de 25 s au plus
 *   GET /v10/coffre/<compte>/version             sondage : la révision courante, tout de suite
 *
 * Mutualisé (o2switch : Node sous Passenger, une instance) : les connexions tenues ouvertes sont
 * bornées par compte (`MAX_PAR_COMPTE`) et en tout (`MAX_TOTAL`) ; au-delà, 429 et l'appareil passe
 * au sondage. Les avis sont publiés en mémoire du processus ; un second processus éventuel est
 * rattrapé par la relecture de la révision en base (flux : toutes les 30 s ; attente : à la fin).
 */

export const PAS_COEUR_MS = 15_000;
export const DUREE_FLUX_MS = 5 * 60_000;
export const PAS_FILET_MS = 30_000;
export const ATTENTE_MAX_S = 25;
export const MAX_PAR_COMPTE = 6;
export const MAX_TOTAL = 300;
/** Bourrage du premier envoi : traverse les tampons des mandataires qui attendent quelques Kio. */
const BOURRAGE = 2048;

/** Bus en mémoire : abonnés par compte, bornés. */
export function creerAvis({ maxParCompte = MAX_PAR_COMPTE, maxTotal = MAX_TOTAL } = {}) {
  const abonnes = new Map();
  let total = 0;
  return {
    /** Prévient les abonnés du compte (la révision seulement). */
    publier(compte, rev) {
      for (const f of [...(abonnes.get(compte) ?? [])]) {
        try {
          f(rev);
        } catch {
          // Un abonné en panne ne gêne pas les autres.
        }
      }
    },
    /** Abonne `f` ; rend la fonction de désabonnement, ou undefined si les limites sont atteintes. */
    abonner(compte, f) {
      const ensemble = abonnes.get(compte) ?? new Set();
      if (ensemble.size >= maxParCompte || total >= maxTotal) return undefined;
      ensemble.add(f);
      abonnes.set(compte, ensemble);
      total++;
      let fait = false;
      return () => {
        if (fait) return;
        fait = true;
        ensemble.delete(f);
        total--;
        if (ensemble.size === 0) abonnes.delete(compte);
      };
    },
    nombre: compte => abonnes.get(compte)?.size ?? 0,
    total: () => total,
  };
}

/** Un bus par magasin de coffres (le serveur n'en a qu'un ; les tests, un par test). */
const parMagasin = new WeakMap();
export function avisDe(env) {
  if (env.AVIS) return env.AVIS;
  const magasin = env.COFFRES;
  if (!parMagasin.has(magasin)) parMagasin.set(magasin, creerAvis());
  return parMagasin.get(magasin);
}

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const json = (corps, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes } });
const plein = () => json({ erreur: 'Trop de connexions ouvertes pour ce compte : sondage.', motif: 'trop-de-connexions' }, 429, { 'Retry-After': '60' });

const minuterie = (f, ms, repete = false) => {
  const t = repete ? setInterval(f, ms) : setTimeout(f, ms);
  t?.unref?.();
  return t;
};

/** `GET …/version` : la révision courante. */
export async function routeVersion(store, compte) {
  return json({ rev: await store.version(compte) });
}

/** `GET …/attendre?rev=<n>&delai=<s>` : attente longue. */
export async function routeAttendre(store, avis, compte, url) {
  const depuis = Math.max(0, Number(url.searchParams.get('rev')) || 0);
  const delai = Math.max(1, Math.min(ATTENTE_MAX_S, Number(url.searchParams.get('delai')) || ATTENTE_MAX_S));
  const actuelle = await store.version(compte);
  if (actuelle > depuis) return json({ rev: actuelle });
  let desabonner;
  const recue = await new Promise(ok => {
    const fin = minuterie(() => ok(undefined), delai * 1000);
    desabonner = avis.abonner(compte, rev => {
      if (rev > depuis) {
        clearTimeout(fin);
        ok(rev);
      }
    });
    if (!desabonner) {
      clearTimeout(fin);
      ok('plein');
    }
  });
  desabonner?.();
  if (recue === 'plein') return plein();
  return json({ rev: recue ?? (await store.version(compte)), ...(recue === undefined ? { attente: delai } : {}) });
}

/** `GET …/flux?rev=<n>` : flux SSE. */
export async function routeFlux(store, avis, compte, url) {
  const depuis = Math.max(0, Number(url.searchParams.get('rev')) || 0);
  const actuelle = await store.version(compte);
  const encodeur = new TextEncoder();
  let fermer = () => {};
  let abonnement;
  const flux = new ReadableStream({
    start(ctrl) {
      let derniere = Math.max(depuis, actuelle);
      let ferme = false;
      const envoyer = texte => {
        if (ferme) return;
        try {
          ctrl.enqueue(encodeur.encode(texte));
        } catch {
          fermer();
        }
      };
      const pousser = rev => {
        if (rev > derniere) {
          derniere = rev;
          envoyer(`event: version\nid: ${rev}\ndata: {"rev":${rev}}\n\n`);
        }
      };
      abonnement = avis.abonner(compte, pousser);
      const coeur = minuterie(() => envoyer(`: coeur ${Date.now()}\n\n`), PAS_COEUR_MS, true);
      const filet = minuterie(() => store.version(compte).then(pousser, () => undefined), PAS_FILET_MS, true);
      const fin = minuterie(() => fermer(), DUREE_FLUX_MS);
      fermer = () => {
        if (ferme) return;
        ferme = true;
        clearInterval(coeur);
        clearInterval(filet);
        clearTimeout(fin);
        abonnement?.();
        try {
          ctrl.close();
        } catch {
          // Déjà fermé par le client.
        }
      };
      // Premier envoi : bourrage (tampons des mandataires), délai de reconnexion, révision courante —
      // toujours envoyée, c'est elle qui prouve à l'appareil que le flux passe sans être retenu.
      envoyer(`:${' '.repeat(BOURRAGE)}\nretry: 3000\n\nevent: version\nid: ${actuelle}\ndata: {"rev":${actuelle}}\n\n`);
    },
    cancel() {
      fermer();
    },
  });
  if (!abonnement) {
    fermer();
    return plein();
  }
  return new Response(flux, {
    status: 200,
    headers: {
      ...ENTETES,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      // Passenger, nginx et LiteSpeed : ne pas retenir la réponse dans un tampon.
      'X-Accel-Buffering': 'no',
    },
  });
}
