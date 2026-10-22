/**
 * Avis de nouvelle version d'un coffre (relais version 10, docs/synchro-relais.md).
 *
 * Quand un appareil écrit dans le coffre d'un compte, le serveur prévient les autres appareils de ce
 * compte que « le coffre X a maintenant la révision N » — et rien d'autre : aucune donnée, aucun
 * identifiant d'enregistrement. L'appareil tire ensuite lui-même les différences (`GET
 * /v10/coffre/<compte>?depuis=<rev>`), chiffrées de bout en bout comme avant.
 *
 * Trois façons d'attendre ; le serveur fixe la plus haute permise (`SYNCHRO_TEMPS_REEL` dans
 * relais.env, annoncée par `/sante` : `tempsReel`), l'appareil la suit et ne monte jamais au-dessus :
 *
 *   GET /v10/coffre/<compte>/version             sondage : la révision courante, tout de suite
 *                                                (mode « sondage », PAR DÉFAUT : aucune connexion tenue)
 *   GET /v10/coffre/<compte>/attendre?rev=<n>    attente longue : répond dès que la révision dépasse n,
 *                                                ou au bout de 50 s au plus ; un espace toutes les 15 s
 *                                                (le JSON reste valide) garde la connexion en vie
 *                                                (mode « attente »)
 *   GET /v10/coffre/<compte>/flux?rev=<n>        flux SSE : un événement `version` à chaque écriture, un
 *                                                battement toutes les 15 s, fermé au bout de 5 min
 *                                                (mode « sse » seulement)
 *
 * Mutualisé (o2switch : Node sous Passenger derrière LiteSpeed/Apache, pare-feu CSF/LFD) : chaque
 * connexion tenue occupe une place chez l'hébergeur, et trop de connexions venues d'une même adresse
 * font bannir cette adresse. Donc :
 *  - au plus `MAX_PAR_COMPTE_IP` (2) connexions tenues par compte ET par adresse IP, `MAX_PAR_COMPTE`
 *    par compte, `MAX_TOTAL` en tout ; au-delà, réponse immédiate 429 « utilise le sondage »
 *    (`mode: 'sondage'`, révision courante, `Retry-After`) : rien n'est gardé ouvert ;
 *  - au plus `LIMITE_MINUTE_IP` appels aux routes d'avis par adresse et par minute (même réponse) ;
 *  - chaque connexion tenue a une durée maximale, se libère dès que l'appareil s'en va (annulation
 *    du flux de réponse), et un balayage ferme celles qui auraient échappé à tout le reste ;
 *  - une nouvelle connexion du MÊME appareil (`&appareil=<id>`) remplace l'ancienne : un frontal ou un
 *    navigateur qui ne signale pas une connexion abandonnée (onglet masqué puis revenu) n'en laisse
 *    jamais deux.
 * Les avis sont publiés en mémoire du processus ; un second processus éventuel est rattrapé par la
 * relecture de la révision en base (flux : toutes les 30 s ; attente : à la fin).
 */

export const PAS_COEUR_MS = 15_000;
export const DUREE_FLUX_MS = 5 * 60_000;
export const PAS_FILET_MS = 30_000;
export const ATTENTE_MAX_S = 50;
/** Pas du sondage conseillé aux appareils (secondes), annoncé par `/sante` et dans chaque refus. */
export const PAS_SONDAGE_S = 15;
export const MAX_PAR_COMPTE_IP = 2;
export const MAX_PAR_COMPTE = 4;
export const MAX_TOTAL = 60;
export const LIMITE_MINUTE_IP = 60;
/** Une connexion tenue plus longtemps que ça est forcément orpheline : le balayage la ferme. */
export const AGE_MAX_CONNEXION_MS = DUREE_FLUX_MS + 60_000;
/** Bourrage du premier envoi du flux SSE : traverse les tampons des mandataires qui attendent quelques Kio. */
const BOURRAGE = 2048;

export const MODES_TEMPS_REEL = ['sse', 'attente', 'sondage'];
/** Le plus sûr sur un mutualisé : aucune connexion tenue, des requêtes courtes seulement. */
export const MODE_TEMPS_REEL_DEFAUT = 'sondage';

/** Mode de temps réel choisi par l'hébergeur (`SYNCHRO_TEMPS_REEL`), « sondage » par défaut. */
export function modeTempsReel(env) {
  const m = String(env?.SYNCHRO_TEMPS_REEL ?? '')
    .trim()
    .toLowerCase();
  return MODES_TEMPS_REEL.includes(m) ? m : MODE_TEMPS_REEL_DEFAUT;
}

/** Adresse de l'appareil (le pont du serveur Node la recalcule dans X-Adresse-Client). */
export function ipDe(requete) {
  return requete.headers.get('X-Adresse-Client') || (requete.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() || 'inconnue';
}

/** Bus en mémoire : abonnés par compte, bornés par compte et adresse, par compte, et en tout. */
export function creerAvis({ maxParCompteIp = MAX_PAR_COMPTE_IP, maxParCompte = MAX_PAR_COMPTE, maxTotal = MAX_TOTAL, limiteMinuteIp = LIMITE_MINUTE_IP, maintenant = Date.now } = {}) {
  /** compte → Set<{ f, ip, depuis, fermer }> */
  const abonnes = new Map();
  const parCompteIp = new Map();
  const appels = new Map();
  let total = 0;
  const cleIp = (compte, ip) => `${compte}\u0000${ip}`;

  const retirer = (compte, a) => {
    const ensemble = abonnes.get(compte);
    if (!ensemble?.delete(a)) return;
    total--;
    if (ensemble.size === 0) abonnes.delete(compte);
    const c = cleIp(compte, a.ip);
    const n = (parCompteIp.get(c) ?? 1) - 1;
    if (n <= 0) parCompteIp.delete(c);
    else parCompteIp.set(c, n);
  };

  const bus = {
    /** Prévient les abonnés du compte (la révision seulement). */
    publier(compte, rev) {
      for (const a of [...(abonnes.get(compte) ?? [])]) {
        try {
          a.f(rev);
        } catch {
          // Un abonné en panne ne gêne pas les autres.
        }
      }
    },
    /**
     * Abonne `f` (connexion tenue venant de `ip`) ; rend la fonction de désabonnement, ou undefined si
     * une limite est atteinte. `fermer` : appelée par le balayage si la connexion a dépassé son âge, ou
     * quand le même `appareil` en ouvre une nouvelle (elle remplace l'ancienne).
     */
    abonner(compte, f, { ip = 'inconnue', fermer, appareil } = {}) {
      bus.balayer();
      if (appareil) {
        for (const a of [...(abonnes.get(compte) ?? [])]) {
          if (a.appareil !== appareil) continue;
          retirer(compte, a);
          try {
            a.fermer?.();
          } catch {
            // Déjà fermée.
          }
        }
      }
      const ensemble = abonnes.get(compte) ?? new Set();
      const c = cleIp(compte, ip);
      if ((parCompteIp.get(c) ?? 0) >= maxParCompteIp || ensemble.size >= maxParCompte || total >= maxTotal) return undefined;
      const a = { f, ip, depuis: maintenant(), fermer, appareil };
      ensemble.add(a);
      abonnes.set(compte, ensemble);
      parCompteIp.set(c, (parCompteIp.get(c) ?? 0) + 1);
      total++;
      let fait = false;
      return () => {
        if (fait) return;
        fait = true;
        retirer(compte, a);
      };
    },
    /** Ferme les connexions orphelines (plus vieilles que toute durée prévue). */
    balayer(ageMax = AGE_MAX_CONNEXION_MS) {
      const limite = maintenant() - ageMax;
      for (const [compte, ensemble] of [...abonnes]) {
        for (const a of [...ensemble]) {
          if (a.depuis > limite) continue;
          retirer(compte, a);
          try {
            a.fermer?.();
          } catch {
            // Déjà fermée.
          }
        }
      }
    },
    /** Compte un appel aux routes d'avis venant de `ip` ; faux au-delà de la limite par minute. */
    accepterAppel(ip) {
      const t = maintenant();
      if (appels.size > 5000) for (const [k, v] of appels) if (t - v.debut >= 60_000) appels.delete(k);
      if (appels.size > 5000) appels.clear();
      const e = appels.get(ip);
      if (!e || t - e.debut >= 60_000) {
        appels.set(ip, { debut: t, n: 1 });
        return true;
      }
      e.n++;
      return e.n <= limiteMinuteIp;
    },
    nombre: compte => abonnes.get(compte)?.size ?? 0,
    nombreIp: (compte, ip) => parCompteIp.get(cleIp(compte, ip)) ?? 0,
    total: () => total,
  };
  return bus;
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

const MESSAGES = {
  'trop-de-connexions': 'Trop de connexions ouvertes pour ce compte depuis cette adresse : sondage.',
  'trop-de-requetes': 'Trop de requêtes depuis cette adresse : sondage espacé.',
  'mode-sondage': 'Ce serveur ne garde aucune connexion ouverte : sondage.',
  'mode-attente': 'Ce serveur n’ouvre pas de flux : attente longue ou sondage.',
};
/**
 * « Utilise le sondage » : réponse immédiate, rien n'est gardé ouvert. 429 pour que les appareils
 * d'avant ce réglage (veille v10 déjà chargée dans un onglet) passent eux aussi au sondage au lieu
 * de reboucler.
 */
const versSondage = (motif, rev, attenteS = PAS_SONDAGE_S) =>
  json({ erreur: MESSAGES[motif], motif, mode: 'sondage', pas: PAS_SONDAGE_S, ...(typeof rev === 'number' ? { rev } : {}) }, 429, { 'Retry-After': String(attenteS) });

/** Identifiant d'appareil donné par la veille (`&appareil=`), ou rien s'il est absent ou invalide. */
const appareilDe = url => {
  const id = url.searchParams.get('appareil') ?? '';
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : undefined;
};

const minuterie = (f, ms, repete = false) => {
  const t = repete ? setInterval(f, ms) : setTimeout(f, ms);
  t?.unref?.();
  return t;
};

const ENTETES_TENUE = {
  ...ENTETES,
  'Cache-Control': 'no-cache, no-store, no-transform',
  // Passenger, nginx et LiteSpeed : ne pas retenir la réponse dans un tampon (et pas de gzip : compression.mjs).
  'X-Accel-Buffering': 'no',
};

/** `GET …/version` : la révision courante. */
export async function routeVersion(store, avis, compte, { ip = 'inconnue' } = {}) {
  const rev = await store.version(compte);
  if (!avis.accepterAppel(ip)) return versSondage('trop-de-requetes', rev, 60);
  return json({ rev });
}

/** `GET …/attendre?rev=<n>&delai=<s>` : attente longue (JSON précédé d'espaces de battement). */
export async function routeAttendre(store, avis, compte, url, { ip = 'inconnue', mode = 'attente' } = {}) {
  const actuelle = await store.version(compte);
  if (!avis.accepterAppel(ip)) return versSondage('trop-de-requetes', actuelle, 60);
  if (mode === 'sondage') return versSondage('mode-sondage', actuelle);
  const depuis = Math.max(0, Number(url.searchParams.get('rev')) || 0);
  const delai = Math.max(1, Math.min(ATTENTE_MAX_S, Number(url.searchParams.get('delai')) || ATTENTE_MAX_S));
  if (actuelle > depuis) return json({ rev: actuelle });
  const encodeur = new TextEncoder();
  let terminer = () => {};
  let liberer = () => false;
  // Abonnement et flux créés sans `await` entre eux : aucune écriture ne peut passer entre les deux.
  const desabonner = avis.abonner(compte, rev => rev > depuis && terminer(rev), { ip, fermer: () => terminer(undefined), appareil: appareilDe(url) });
  if (!desabonner) return versSondage('trop-de-connexions', actuelle);
  const corps = new ReadableStream({
    start(ctrl) {
      let fini = false;
      const coeur = minuterie(() => {
        try {
          ctrl.enqueue(encodeur.encode(' '));
        } catch {
          liberer();
        }
      }, PAS_COEUR_MS, true);
      const fin = minuterie(() => terminer(undefined), delai * 1000);
      // Un premier espace tout de suite : les en-têtes partent, l'appareil sait que la connexion tient.
      ctrl.enqueue(encodeur.encode(' '));
      liberer = () => {
        if (fini) return false;
        fini = true;
        clearInterval(coeur);
        clearTimeout(fin);
        desabonner();
        return true;
      };
      terminer = async rev => {
        if (!liberer()) return;
        const finale = rev ?? (await store.version(compte).catch(() => depuis));
        try {
          ctrl.enqueue(encodeur.encode(JSON.stringify({ rev: finale, ...(rev === undefined ? { attente: delai } : {}) })));
          ctrl.close();
        } catch {
          // L'appareil est déjà parti.
        }
      };
    },
    cancel() {
      // L'appareil a fermé (onglet masqué, réseau) : la place est rendue tout de suite.
      liberer();
    },
  });
  return new Response(corps, { status: 200, headers: { ...ENTETES_TENUE, 'Content-Type': 'application/json; charset=utf-8' } });
}

/** `GET …/flux?rev=<n>` : flux SSE (mode « sse » seulement). */
export async function routeFlux(store, avis, compte, url, { ip = 'inconnue', mode = 'sse' } = {}) {
  const actuelle = await store.version(compte);
  if (!avis.accepterAppel(ip)) return versSondage('trop-de-requetes', actuelle, 60);
  if (mode === 'sondage') return versSondage('mode-sondage', actuelle);
  if (mode !== 'sse') return versSondage('mode-attente', actuelle);
  const depuis = Math.max(0, Number(url.searchParams.get('rev')) || 0);
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
      abonnement = avis.abonner(compte, pousser, { ip, fermer: () => fermer(), appareil: appareilDe(url) });
      if (!abonnement) return;
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
      envoyer(`:${' '.repeat(BOURRAGE)}\nretry: 30000\n\nevent: version\nid: ${actuelle}\ndata: {"rev":${actuelle}}\n\n`);
    },
    cancel() {
      fermer();
    },
  });
  if (!abonnement) {
    flux.cancel().catch(() => undefined);
    return versSondage('trop-de-connexions', actuelle);
  }
  return new Response(flux, { status: 200, headers: { ...ENTETES_TENUE, 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
