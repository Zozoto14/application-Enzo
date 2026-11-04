/**
 * Canal temps réel de l'Esport (docs/esport/temps-reel.md) : « les actions d'une personne arrivent chez les
 * autres en moins d'une seconde, et le premier qui enregistre a la main ».
 *
 * Routes (session obligatoire, comme toute l'API) :
 *
 *   GET  /temps-reel/flux?depuis=<id>&appareil=<id>      flux SSE (lu par fetch : la session part dans
 *                                                        Authorization) ; bourrage 2 Kio, battement ~20 s,
 *                                                        fermé au bout de 5 min (le navigateur rouvre avec
 *                                                        son curseur : rien n'est perdu)
 *   GET  /temps-reel/attendre?depuis=<id>&delai=<s>      attente longue (≤ 50 s ; un espace toutes les 15 s)
 *   GET  /temps-reel/evenements?depuis=<id>              sondage : les changements depuis le curseur, tout de suite
 *   GET  /temps-reel/version?chemin=<route de l'objet>   version, dernier auteur et éditeurs présents d'un objet
 *   POST /temps-reel/presence { chemin, etat }           « je modifie cet objet » (etat: edition | fin)
 *   GET  /temps-reel/etat                                mesures (Fondateur)
 *
 * Le mode le plus haut permis est fixé par l'hébergeur (`TEMPS_REEL` : sse, attente ou sondage, voir
 * serveur/config.mjs) : `sse` → flux, attente et sondage ; `attente` → attente et sondage ; `sondage` → sondage
 * seulement (les autres routes répondent tout de suite 429 « utilise le sondage », sans rien garder ouvert).
 *
 * Sobriété (hébergement mutualisé, pare-feu qui bannit une adresse qui ouvre trop de connexions) :
 * au plus 2 connexions tenues par compte ET par adresse, 4 par compte, `maxTotal` par processus ; au-delà,
 * réponse immédiate 429 + `Retry-After` + `mode: 'sondage'`. Au plus 60 appels par minute et par adresse.
 * Une connexion du MÊME appareil remplace l'ancienne. Durée maximale, libération dès que le navigateur
 * s'en va, balayage des orphelines. Côté navigateur : UNE connexion par navigateur (onglets coordonnés).
 *
 * Contrôle d'accès : regles.mjs (sujet, puis objet ; la route GET de l'objet est rejouée au nom du
 * destinataire). Rien n'est envoyé à qui ne peut pas voir.
 */

import { echec, iso } from '../outils.mjs';
import { porteesDe } from '../cm/commun.mjs';
import { surNouvelleNotification } from '../notifications/centre.mjs';
import { bornes, ecouterBase, prevenir, publierEnBase, purger, relire } from './diffusion.mjs';
import { LECTURE_MODULE, LECTURE_PERSONNELLE, MOTIF_SUJET, SONDES_SUJETS, objetDe, publicationsDe } from './regles.mjs';

export { abonneTempsReel } from './bus.mjs';

export const MODES_TEMPS_REEL = ['sse', 'attente', 'sondage'];
export const MODE_TEMPS_REEL_DEFAUT = 'sse';
export const PAS_COEUR_MS = 20_000;
export const PAS_COEUR_ATTENTE_MS = 15_000;
export const DUREE_FLUX_MS = 5 * 60_000;
export const ATTENTE_MAX_S = 50;
export const PAS_SONDAGE_S = 15;
export const MAX_PAR_COMPTE_IP = 2;
export const MAX_PAR_COMPTE = 4;
export const MAX_TOTAL = 30;
export const LIMITE_MINUTE_IP = 60;
export const AGE_MAX_CONNEXION_MS = DUREE_FLUX_MS + 60_000;
/** Présence « en train de modifier » : le navigateur la renouvelle toutes les 20 s. */
export const DUREE_PRESENCE_MS = 45_000;
/** Contrôles d'accès en cache : sujet (30 s), objet (15 s). Oubliés dès qu'un rôle ou un membre change. */
export const CACHE_SUJET_MS = 30_000;
export const CACHE_OBJET_MS = 15_000;
const BOURRAGE = 2048;
const REJEU_MAX = 200;

/** Mode choisi par l'hébergeur (`TEMPS_REEL`) ; `ws` (WebSocket, non proposé : voir la doc) vaut `sse`. */
export function lireModeTempsReel(valeur) {
  const m = String(valeur ?? '')
    .trim()
    .toLowerCase();
  if (m === 'ws' || m === 'websocket') return 'sse';
  return MODES_TEMPS_REEL.includes(m) ? m : MODE_TEMPS_REEL_DEFAUT;
}

const RANG = { sondage: 0, attente: 1, sse: 2 };

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept-Language, X-Methode',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const ENTETES_TENUE = {
  ...ENTETES,
  'Cache-Control': 'no-cache, no-store, no-transform',
  // Passenger, nginx, LiteSpeed : ne pas retenir la réponse dans un tampon, pas de compression.
  'X-Accel-Buffering': 'no',
};
const json = (corps, statut = 200, entetes = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...entetes } });

const MESSAGES = {
  'trop-de-connexions': 'Trop de connexions ouvertes pour ce compte depuis cette adresse : sondage.',
  'trop-de-requetes': 'Trop de requêtes depuis cette adresse : sondage espacé.',
  'mode-sondage': 'Ce serveur ne garde aucune connexion ouverte : sondage.',
  'mode-attente': 'Ce serveur n’ouvre pas de flux : attente longue.',
};

const minuterie = (f, ms, repete = false) => {
  const t = repete ? setInterval(f, ms) : setTimeout(f, ms);
  t?.unref?.();
  return t;
};

const appareilDe = url => {
  const id = url.searchParams.get('appareil') ?? '';
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : undefined;
};
const curseurDe = url => {
  const n = Number(url.searchParams.get('depuis'));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

/**
 * Service temps réel d'une API. `socle` : servicesEsport (contexteTeam, exiger) ; `sonder(acteur, chemin)` :
 * route GET rejouée au nom d'un compte (résultat, ou null si refusée). `config` : `{ mode, maxTotal, … }`.
 */
export function servicesTempsReel({ base, maintenant = () => Date.now(), socle, sonder, config = {}, journal = console }) {
  const mode = lireModeTempsReel(config.mode);
  const lim = {
    maxParCompteIp: config.maxParCompteIp ?? MAX_PAR_COMPTE_IP,
    maxParCompte: config.maxParCompte ?? MAX_PAR_COMPTE,
    maxTotal: config.maxTotal ?? MAX_TOTAL,
    limiteMinuteIp: config.limiteMinuteIp ?? LIMITE_MINUTE_IP,
    coeurMs: config.coeurMs ?? PAS_COEUR_MS,
    coeurAttenteMs: config.coeurAttenteMs ?? PAS_COEUR_ATTENTE_MS,
    dureeFluxMs: config.dureeFluxMs ?? DUREE_FLUX_MS,
    pas: config.pas ?? PAS_SONDAGE_S,
  };
  /** Connexions tenues par ce processus : { acteur, ip, appareil, depuis, genre, livrer(m), fermer(), file }. */
  const connexions = new Set();
  const appels = new Map();
  const cacheSujets = new Map();
  const cacheObjets = new Map();
  const pseudos = new Map();
  const mesures = { messages: 0, envois: 0, refus: 0, latences: [], ouvertures: 0 };
  let ecoute;
  let dernierRecu = 0;
  let dernierePurge = 0;

  // ------------------------------------------------------------------ Contrôle d'accès

  const oublierAcces = () => {
    cacheSujets.clear();
    cacheObjets.clear();
  };

  async function calculerSujet(acteur, sujet) {
    if (!MOTIF_SUJET.test(sujet)) return false;
    if (sujet.startsWith('compte:')) return sujet === `compte:${acteur.compte}`;
    if (sujet === 'club') return true;
    if (sujet === 'cm') {
      // Lecture des tableaux (cm.voir) quelque part : un joueur qui ne peut que proposer un clip ne reçoit rien, ni le
      // Manager d'une team (cm.deposer, cm.clips.proposer par défaut, migration 0053). Un rôle de team qui garde cm.voir
      // (personnalisé) suit le tableau de SA team dans l'onglet CM : le sujet ne porte que des signaux de relecture, chaque
      // objet est revérifié (sonde) et l'état relu (`/cm/etat`) ne rend que ses tableaux ; l'espace du club reste fermé.
      const p = await porteesDe(base, acteur);
      return p.club.has('cm.voir') || [...p.teams.values()].some(x => x.has('cm.voir'));
    }
    const sonde = SONDES_SUJETS[sujet];
    if (sonde) {
      const r = await sonder(acteur, sonde.chemin);
      return r !== null && (sonde.ok ? sonde.ok(r) : true);
    }
    const t = /^team:([0-9a-f-]{36})(?::([a-z_]+))?$/.exec(sujet);
    if (!t) return false;
    let ctx;
    try {
      ctx = await socle.contexteTeam(acteur, t[1]);
    } catch {
      return false;
    }
    if (!t[2]) return true;
    const module = t[2];
    const lecture = LECTURE_MODULE[module];
    if (!lecture || !ctx.modules.has(module)) return false;
    for (const permission of [lecture, ...(LECTURE_PERSONNELLE[module] ?? [])]) {
      try {
        socle.exiger(ctx, permission);
        return true;
      } catch {
        // Permission suivante.
      }
    }
    return false;
  }

  /** Le compte peut-il lire ce sujet ? (cache 30 s, calcul partagé entre les connexions d'un même compte) */
  function accesSujet(acteur, sujet) {
    const cle = `${acteur.compte}|${acteur.superAdmin ? 1 : 0}|${sujet}`;
    const c = cacheSujets.get(cle);
    if (c && maintenant() - c.le < CACHE_SUJET_MS) return c.p;
    if (cacheSujets.size > 5000) cacheSujets.clear();
    const p = calculerSujet(acteur, sujet).catch(() => false);
    cacheSujets.set(cle, { le: maintenant(), p });
    return p;
  }

  /**
   * Le compte peut-il lire CET objet ? `frais` : ignore un « oui » en cache (l'écriture qu'on diffuse a pu
   * changer sa visibilité : carte déplacée dans un tableau fermé, strat passée « staff »).
   */
  async function accesObjet(acteur, m, { frais = false } = {}) {
    if (!m.cle) return false;
    if (m.objetPublic) return accesSujet(acteur, m.sujet);
    if (!m.sonde) return false;
    const cle = `${acteur.compte}|${acteur.superAdmin ? 1 : 0}|${m.sonde}`;
    const c = cacheObjets.get(cle);
    if (c && maintenant() - c.le < CACHE_OBJET_MS && !(frais && c.ok !== false)) return c.p;
    if (cacheObjets.size > 5000) cacheObjets.clear();
    const p = sonder(acteur, m.sonde).then(
      r => r !== null,
      () => false,
    );
    const entree = { le: maintenant(), p, ok: undefined };
    cacheObjets.set(cle, entree);
    entree.ok = await p;
    return entree.ok;
  }

  /** Ce que `acteur` voit d'un message (null : rien). */
  async function vue(acteur, m) {
    if (m.type === 'presence') {
      if (m.acteur === acteur.compte) return null;
      if (!(await accesSujet(acteur, m.sujet)) || !(await accesObjet(acteur, m))) return null;
      return { type: 'presence', sujet: afficheSujet(m.sujet), cle: m.cle, acteur: m.acteur, pseudo: m.pseudo ?? null, etat: m.etat, jusqua: m.jusqua };
    }
    if (!(await accesSujet(acteur, m.sujet))) return null;
    const sortie = { type: 'maj', id: m.id, sujet: afficheSujet(m.sujet), le: m.le, t: m.t, ...(m.action ? { action: m.action } : {}) };
    // Objet supprimé : sa route ne répond plus ; seul un accès vérifié peu avant (cache) laisse passer sa clé.
    if (m.cle && (await accesObjet(acteur, m, { frais: m.action !== 'supprime' }))) {
      Object.assign(sortie, { cle: m.cle, ...(m.version !== undefined ? { version: m.version } : {}), ...(m.acteur ? { acteur: m.acteur, pseudo: m.pseudo ?? null } : {}) });
    }
    return sortie;
  }

  /** Le destinataire voit « compte » pour ses propres notifications (jamais l'identifiant d'un autre). */
  const afficheSujet = sujet => (sujet.startsWith('compte:') ? 'compte' : sujet);

  // ------------------------------------------------------------------ Réception (tous les processus)

  function recevoir(m) {
    if (!m || typeof m !== 'object' || typeof m.sujet !== 'string') return;
    if (m.type !== 'presence') {
      if (typeof m.id !== 'number' || m.id <= dernierRecu - 10_000) return;
      dernierRecu = Math.max(dernierRecu, m.id);
      mesures.messages++;
    }
    if (m.invalider) oublierAcces();
    for (const c of connexions) c.livrer(m);
  }

  async function rattraper() {
    if (!dernierRecu) return;
    for (const m of await relire(base, dernierRecu, 500)) recevoir(m);
  }

  /**
   * Centre de notifications : un élément du fil annoncé pour un compte (droits et préférences déjà appliqués par
   * le centre) → son compteur bouge en direct. Les notifications personnelles passent déjà par bus.mjs.
   * Le message ne dit pas de quelle base il vient : il n'est publié que si l'élément existe dans CETTE base.
   */
  let arreterCentre;
  const surCentre = m => {
    if (!m || m.source !== 'fil' || typeof m.compte !== 'string' || typeof m.id !== 'string') return;
    void base
      .premier('SELECT id FROM notifs_centre WHERE id = ?', [m.id])
      .then(l => (l ? publierEnBase(base, { sujet: `compte:${m.compte}`, action: 'cree' }, maintenant()) : undefined))
      .catch(() => undefined);
  };

  function ecouterSiBesoin() {
    // Seulement tant que ce processus a des navigateurs connectés (l'annonce du centre coûte une passe par compte).
    if (connexions.size > 0 && !arreterCentre) arreterCentre = surNouvelleNotification(surCentre);
    else if (connexions.size === 0 && arreterCentre) {
      arreterCentre();
      arreterCentre = undefined;
    }
    if (connexions.size > 0 && !ecoute) {
      ecoute = ecouterBase(base, recevoir, { rattraper, journal });
      // Point de départ du rattrapage : la dernière ligne au moment où ce processus commence à écouter.
      void bornes(base)
        .then(b => {
          if (!dernierRecu) dernierRecu = b.max;
        })
        .catch(() => undefined);
    } else if (connexions.size === 0 && ecoute) {
      // Plus personne ici : la connexion LISTEN est rendue (aucune ressource tenue au repos).
      const e = ecoute;
      ecoute = undefined;
      void e.fermer();
    }
  }

  // ------------------------------------------------------------------ Publication (après une écriture)

  async function pseudoDe(compte) {
    if (!compte) return null;
    const c = pseudos.get(compte);
    if (c && maintenant() - c.le < 300_000) return c.pseudo;
    const l = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [compte]).catch(() => null);
    if (pseudos.size > 2000) pseudos.clear();
    pseudos.set(compte, { pseudo: l?.pseudo ?? null, le: maintenant() });
    return l?.pseudo ?? null;
  }

  async function purgerParfois() {
    const t = maintenant();
    if (t - dernierePurge < 10 * 60_000) return;
    dernierePurge = t;
    await purger(base, t).catch(e => journal.error?.('[esport] temps réel : purge', e?.message ?? e));
  }

  /**
   * Verrou optimiste, AVANT une écriture : `X-Version-Lue` annoncée → refus 409 si quelqu'un a enregistré
   * entre-temps ; la version de l'objet augmente tout de suite (elle sert de verrou : de deux enregistrements
   * simultanés, un seul passe). Rend `{ cle, version, annuler() }` (écriture refusée ensuite : version rendue),
   * ou null si la route ne modifie pas un objet.
   */
  async function avantEcriture(methode, chemin, requete, acteur) {
    if (!['PATCH', 'PUT', 'DELETE'].includes(methode)) return null;
    const objet = objetDe(chemin);
    if (!objet?.exact) return null;
    const brut = requete.headers.get('X-Version-Lue');
    const lue = brut === null || brut.trim() === '' ? null : Number(brut);
    if (lue !== null && (!Number.isSafeInteger(lue) || lue < 0)) throw echec(400, 'version-lue', 'En-tête X-Version-Lue invalide (entier attendu).');
    const t = iso(maintenant());
    const avant = await base.premier('SELECT version, maj_par, maj_le FROM temps_reel_versions WHERE cle = ?', [objet.cle]);
    const conflit = async () => {
      const l = await base.premier('SELECT version, maj_par, maj_le FROM temps_reel_versions WHERE cle = ?', [objet.cle]);
      // Qui a modifié, seulement à qui peut voir l'objet (sinon : la route répondra comme d'habitude).
      if (!(await accesSujet(acteur, objet.sujet)) || !(await accesObjet(acteur, objet, { frais: true }))) throw echec(404, 'introuvable', 'Élément introuvable.');
      const e = echec(409, 'conflit-version', 'Quelqu’un a enregistré cet élément entre-temps : vos modifications n’ont pas été enregistrées (rien n’a été écrasé).');
      e.details = { version: Number(l?.version ?? 0), lue, par: l?.maj_par ? { compte: l.maj_par, pseudo: await pseudoDe(l.maj_par) } : null, le: l?.maj_le ?? null };
      throw e;
    };
    if (lue !== null && Number(avant?.version ?? 0) !== lue) return conflit();
    if (lue !== null && avant) {
      const r = await base.executer('UPDATE temps_reel_versions SET version = version + 1, maj_par = ?, maj_le = ? WHERE cle = ? AND version = ?', [acteur.compte, t, objet.cle, lue]);
      if (r.changements === 0) return conflit();
    } else if (lue !== null) {
      try {
        await base.executer('INSERT INTO temps_reel_versions (cle, version, maj_par, maj_le) VALUES (?, 1, ?, ?)', [objet.cle, acteur.compte, t]);
      } catch {
        return conflit();
      }
    } else {
      await base.executer(
        'INSERT INTO temps_reel_versions (cle, version, maj_par, maj_le) VALUES (?, 1, ?, ?) ON CONFLICT (cle) DO UPDATE SET version = temps_reel_versions.version + 1, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
        [objet.cle, acteur.compte, t],
      );
    }
    const apres = await base.premier('SELECT version FROM temps_reel_versions WHERE cle = ?', [objet.cle]);
    const version = Number(apres?.version ?? 1);
    return {
      cle: objet.cle,
      version,
      annuler: async () => {
        if (avant) await base.executer('UPDATE temps_reel_versions SET version = ?, maj_par = ?, maj_le = ? WHERE cle = ? AND version = ?', [Number(avant.version), avant.maj_par, avant.maj_le, objet.cle, version]);
        else await base.executer('DELETE FROM temps_reel_versions WHERE cle = ? AND version = ?', [objet.cle, version]);
      },
    };
  }

  /** Diffuse une écriture réussie (après la réponse). `verrou` : résultat d'`avantEcriture`. */
  async function apresEcriture(methode, chemin, acteur, verrou) {
    const publications = publicationsDe(methode, chemin, acteur);
    if (publications.length === 0) return 0;
    // Droits changés (rôle, accès d'un tableau CM…) : oubliés tout de suite dans CE processus, même sans navigateur
    // connecté (les autres processus l'apprennent par le message).
    if (publications.some(p => p.invalider)) oublierAcces();
    const pseudo = await pseudoDe(acteur?.compte);
    for (const p of publications) {
      await publierEnBase(
        base,
        {
          sujet: p.sujet,
          cle: p.cle,
          sonde: p.sonde,
          objetPublic: p.objetPublic,
          version: p.cle && verrou?.cle === p.cle ? verrou.version : p.cle ? await versionDe(p.cle) : undefined,
          action: p.action,
          acteur: acteur?.compte,
          pseudo,
          invalider: p.invalider,
        },
        maintenant(),
      );
    }
    await purgerParfois();
    return publications.length;
  }

  async function versionDe(cle) {
    const l = await base.premier('SELECT version FROM temps_reel_versions WHERE cle = ?', [cle]);
    return l ? Number(l.version) : undefined;
  }

  // ------------------------------------------------------------------ Connexions tenues

  /** Compte un appel venant de `ip` ; faux au-delà de la limite par minute. */
  function accepterAppel(ip) {
    const t = maintenant();
    if (appels.size > 5000) for (const [k, v] of appels) if (t - v.debut >= 60_000) appels.delete(k);
    if (appels.size > 5000) appels.clear();
    const e = appels.get(ip);
    if (!e || t - e.debut >= 60_000) {
      appels.set(ip, { debut: t, n: 1 });
      return true;
    }
    e.n++;
    return e.n <= lim.limiteMinuteIp;
  }

  function balayer() {
    const limite = maintenant() - AGE_MAX_CONNEXION_MS;
    for (const c of [...connexions]) if (c.depuis <= limite) c.fermer();
  }

  /** Inscrit une connexion tenue ; null si une limite est atteinte (le même appareil remplace l'ancienne). */
  function inscrire(c) {
    balayer();
    if (c.appareil) for (const autre of [...connexions]) if (autre.appareil === c.appareil && autre.acteur.compte === c.acteur.compte) autre.fermer();
    let parCompte = 0;
    let parCompteIp = 0;
    for (const autre of connexions) {
      if (autre.acteur.compte !== c.acteur.compte) continue;
      parCompte++;
      if (autre.ip === c.ip) parCompteIp++;
    }
    if (parCompteIp >= lim.maxParCompteIp || parCompte >= lim.maxParCompte || connexions.size >= lim.maxTotal) return null;
    connexions.add(c);
    mesures.ouvertures++;
    ecouterSiBesoin();
    return () => {
      if (connexions.delete(c)) ecouterSiBesoin();
    };
  }

  const versSondage = (motif, dernierId, attenteS = lim.pas) => {
    mesures.refus++;
    return json({ erreur: MESSAGES[motif], code: motif, motif, mode: 'sondage', pas: lim.pas, ...(typeof dernierId === 'number' ? { dernierId } : {}) }, 429, { 'Retry-After': String(attenteS) });
  };

  /** Rejeu depuis le curseur : `{ messages, dernierId, reinitialiser }` (déjà filtrés pour l'acteur). */
  async function rejouer(acteur, depuis) {
    const b = await bornes(base);
    if (!depuis) return { messages: [], dernierId: b.max, reinitialiser: false };
    // Curseur d'une autre base (restauration), ou trop ancien (journal purgé) : l'app recharge tout.
    if (depuis > b.max || (b.min > 0 && depuis < b.min - 1)) return { messages: [], dernierId: b.max, reinitialiser: true };
    const lignes = await relire(base, depuis, REJEU_MAX + 1);
    if (lignes.length > REJEU_MAX) return { messages: [], dernierId: b.max, reinitialiser: true };
    const messages = [];
    for (const m of lignes) {
      const v = await vue(acteur, m);
      if (v) messages.push(v);
    }
    return { messages, dernierId: lignes.length ? lignes[lignes.length - 1].id : depuis, reinitialiser: false };
  }

  const noter = m => {
    if (m.t) {
      mesures.latences.push(Math.max(0, maintenant() - m.t));
      if (mesures.latences.length > 200) mesures.latences.shift();
    }
    mesures.envois++;
  };

  /** `GET /temps-reel/flux` : flux SSE. */
  async function flux(acteur, url, ip) {
    if (!accepterAppel(ip)) return versSondage('trop-de-requetes', undefined, 60);
    if (mode === 'sondage') return versSondage('mode-sondage');
    if (mode !== 'sse') return versSondage('mode-attente');
    const encodeur = new TextEncoder();
    const depuis = curseurDe(url);
    let fermer = () => {};
    let desinscrire;
    let refuse = false;
    const corps = new ReadableStream({
      start(ctrl) {
        let ferme = false;
        let pret = false;
        let vu = 0;
        const attente = [];
        const envoyer = texte => {
          if (ferme) return;
          try {
            ctrl.enqueue(encodeur.encode(texte));
          } catch {
            fermer();
          }
        };
        const evenement = m => `${m.id ? `id: ${m.id}\n` : ''}event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`;
        const c = {
          acteur,
          ip,
          appareil: appareilDe(url),
          depuis: maintenant(),
          genre: 'flux',
          file: Promise.resolve(),
          livrer(m) {
            if (!pret) {
              attente.push(m);
              return;
            }
            c.file = c.file.then(async () => {
              if (ferme) return;
              // Déjà envoyé par le rejeu (arrivé pendant qu'il tournait) : jamais deux fois.
              if (m.id) {
                if (m.id <= vu) return;
                vu = m.id;
              }
              const v = await vue(acteur, m).catch(() => null);
              if (v) {
                envoyer(evenement(v));
                noter(m);
              }
            });
          },
          fermer: () => fermer(),
        };
        desinscrire = inscrire(c);
        if (!desinscrire) {
          refuse = true;
          return;
        }
        const coeur = minuterie(() => envoyer(`: coeur ${maintenant()}\n\n`), lim.coeurMs, true);
        const fin = minuterie(() => fermer(), lim.dureeFluxMs);
        fermer = () => {
          if (ferme) return;
          ferme = true;
          clearInterval(coeur);
          clearTimeout(fin);
          desinscrire?.();
          try {
            ctrl.close();
          } catch {
            // Déjà fermé par le navigateur.
          }
        };
        // Premier envoi tout de suite : bourrage (tampons des mandataires), délai de reconnexion, puis
        // « bonjour » (preuve que le flux passe sans être retenu), puis ce qui a été manqué depuis le curseur.
        envoyer(`:${' '.repeat(BOURRAGE)}\nretry: 30000\n\n`);
        c.file = c.file
          .then(() => rejouer(acteur, depuis))
          .then(r => {
            vu = r.dernierId;
            envoyer(`event: bonjour\ndata: ${JSON.stringify({ dernierId: r.dernierId, reinitialiser: r.reinitialiser, mode, pas: lim.pas, coeur: lim.coeurMs })}\n\n`);
            for (const m of r.messages) envoyer(evenement(m));
          })
          .catch(() => fermer())
          .finally(() => {
            pret = true;
            for (const m of attente.splice(0)) c.livrer(m);
          });
      },
      cancel() {
        // Le navigateur est parti (onglet masqué, réseau) : la place est rendue tout de suite.
        fermer();
      },
    });
    if (refuse) {
      corps.cancel().catch(() => undefined);
      return versSondage('trop-de-connexions');
    }
    return new Response(corps, { status: 200, headers: { ...ENTETES_TENUE, 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }

  /** `GET /temps-reel/attendre` : attente longue (JSON précédé d'espaces de battement). */
  async function attendre(acteur, url, ip) {
    if (!accepterAppel(ip)) return versSondage('trop-de-requetes', undefined, 60);
    if (mode === 'sondage') return versSondage('mode-sondage');
    const depuis = curseurDe(url);
    const delai = Math.max(1, Math.min(ATTENTE_MAX_S, Number(url.searchParams.get('delai')) || ATTENTE_MAX_S));
    const r = await rejouer(acteur, depuis);
    if (r.messages.length || r.reinitialiser || !depuis) return json({ ...r, evenements: r.messages, messages: undefined, mode, pas: lim.pas });
    const encodeur = new TextEncoder();
    let terminer = () => {};
    let desinscrire;
    let refuse = false;
    const corps = new ReadableStream({
      start(ctrl) {
        let fini = false;
        let dernierId = r.dernierId;
        const c = {
          acteur,
          ip,
          appareil: appareilDe(url),
          depuis: maintenant(),
          genre: 'attente',
          file: Promise.resolve(),
          livrer(m) {
            c.file = c.file.then(async () => {
              if (fini) return;
              if (m.id) dernierId = Math.max(dernierId, m.id);
              const v = await vue(acteur, m).catch(() => null);
              if (v) {
                noter(m);
                terminer([v]);
              }
            });
          },
          fermer: () => terminer([]),
        };
        desinscrire = inscrire(c);
        if (!desinscrire) {
          refuse = true;
          return;
        }
        const coeur = minuterie(() => {
          try {
            ctrl.enqueue(encodeur.encode(' '));
          } catch {
            terminer(undefined);
          }
        }, lim.coeurAttenteMs, true);
        const fin = minuterie(() => terminer([]), delai * 1000);
        ctrl.enqueue(encodeur.encode(' '));
        // Écrit entre le rejeu et l'inscription : relu une fois (rien ne passe entre les deux).
        void relire(base, r.dernierId, 50)
          .then(ms => ms.forEach(m => c.livrer(m)))
          .catch(() => undefined);
        terminer = evenements => {
          if (fini) return;
          fini = true;
          clearInterval(coeur);
          clearTimeout(fin);
          desinscrire?.();
          if (evenements === undefined) return;
          try {
            ctrl.enqueue(encodeur.encode(JSON.stringify({ evenements, dernierId, reinitialiser: false, mode, pas: lim.pas, ...(evenements.length ? {} : { attente: delai }) })));
            ctrl.close();
          } catch {
            // Le navigateur est déjà parti.
          }
        };
      },
      cancel() {
        terminer(undefined);
      },
    });
    if (refuse) {
      corps.cancel().catch(() => undefined);
      return versSondage('trop-de-connexions', r.dernierId);
    }
    return new Response(corps, { status: 200, headers: { ...ENTETES_TENUE, 'Content-Type': 'application/json; charset=utf-8' } });
  }

  /** `GET /temps-reel/evenements` : sondage, réponse immédiate. */
  async function evenements(acteur, url, ip) {
    if (!accepterAppel(ip)) return versSondage('trop-de-requetes', undefined, 60);
    const r = await rejouer(acteur, curseurDe(url));
    return json({ evenements: r.messages, dernierId: r.dernierId, reinitialiser: r.reinitialiser, mode, pas: lim.pas });
  }

  /** Objet d'une route donnée par l'app, contrôlé (404 sans accès). */
  async function objetLisible(acteur, chemin) {
    const propre = typeof chemin === 'string' ? chemin.split('?')[0].replace(/^\/api\/esport(?=\/)/, '') : '';
    const objet = /^\/[A-Za-z0-9/_.:%-]{1,300}$/.test(propre) ? objetDe(propre) : null;
    // `frais` : un « oui » en cache ne suffit pas (accès retiré à l'instant : tableau CM restreint, rôle retiré).
    if (!objet || !(await accesSujet(acteur, objet.sujet)) || !(await accesObjet(acteur, objet, { frais: true }))) throw echec(404, 'introuvable', 'Élément introuvable.');
    return objet;
  }

  async function presencesDe(cle, sauf) {
    const lignes = await base.tous('SELECT compte_id, pseudo, jusqua FROM temps_reel_presences WHERE cle = ? AND jusqua > ? ORDER BY jusqua DESC', [cle, iso(maintenant())]);
    return lignes.filter(l => l.compte_id !== sauf).map(l => ({ compte: l.compte_id, pseudo: l.pseudo ?? null, jusqua: l.jusqua }));
  }

  /** `GET /temps-reel/version?chemin=` : version, dernier auteur, éditeurs présents. */
  async function version(acteur, url) {
    const objet = await objetLisible(acteur, url.searchParams.get('chemin'));
    const l = await base.premier('SELECT version, maj_par, maj_le FROM temps_reel_versions WHERE cle = ?', [objet.cle]);
    return {
      cle: objet.cle,
      moi: acteur.compte,
      version: Number(l?.version ?? 0),
      par: l?.maj_par ? { compte: l.maj_par, pseudo: await pseudoDe(l.maj_par) } : null,
      le: l?.maj_le ?? null,
      presences: await presencesDe(objet.cle, acteur.compte),
    };
  }

  /** `POST /temps-reel/presence { chemin, etat }` : « je modifie cet objet » (renouvelé toutes les 20 s). */
  async function presence(acteur, corps) {
    const etat = corps?.etat === 'fin' ? 'fin' : 'edition';
    const objet = await objetLisible(acteur, corps?.chemin);
    const t = maintenant();
    const pseudo = await pseudoDe(acteur.compte);
    const jusqua = iso(t + DUREE_PRESENCE_MS);
    if (etat === 'fin') await base.executer('DELETE FROM temps_reel_presences WHERE cle = ? AND compte_id = ?', [objet.cle, acteur.compte]);
    else {
      await base.executer(
        'INSERT INTO temps_reel_presences (cle, compte_id, pseudo, jusqua) VALUES (?, ?, ?, ?) ON CONFLICT (cle, compte_id) DO UPDATE SET pseudo = excluded.pseudo, jusqua = excluded.jusqua',
        [objet.cle, acteur.compte, pseudo, jusqua],
      );
    }
    await prevenir(base, { type: 'presence', sujet: objet.sujet, cle: objet.cle, sonde: objet.sonde, objetPublic: objet.objetPublic, acteur: acteur.compte, pseudo, etat, jusqua });
    return { ok: true, cle: objet.cle, jusqua: etat === 'fin' ? null : jusqua, presences: await presencesDe(objet.cle, acteur.compte) };
  }

  function etat(acteur) {
    if (!acteur.superAdmin) throw echec(404, 'route', 'Adresse inconnue.');
    const l = [...mesures.latences].sort((a, b) => a - b);
    const q = p => (l.length ? l[Math.min(l.length - 1, Math.floor(p * l.length))] : null);
    const parGenre = {};
    for (const c of connexions) parGenre[c.genre] = (parGenre[c.genre] ?? 0) + 1;
    return {
      mode,
      processus: typeof process !== 'undefined' ? process.pid : null,
      connexions: connexions.size,
      parGenre,
      comptes: new Set([...connexions].map(c => c.acteur.compte)).size,
      limites: { parCompteIp: lim.maxParCompteIp, parCompte: lim.maxParCompte, total: lim.maxTotal, appelsMinuteIp: lim.limiteMinuteIp },
      messages: mesures.messages,
      envois: mesures.envois,
      refus: mesures.refus,
      ouvertures: mesures.ouvertures,
      latenceMs: { mediane: q(0.5), p95: q(0.95), max: l.length ? l[l.length - 1] : null },
      ecoutePostgres: Boolean(ecoute),
    };
  }

  /** Routes `/temps-reel/…` (après l'authentification) ; undefined si l'adresse ne les concerne pas. */
  async function routes({ acteur, chemin, methode, url, ip, lireCorps, limite }) {
    if (!chemin.startsWith('/temps-reel')) return undefined;
    if (chemin === '/temps-reel/flux' && methode === 'GET') return flux(acteur, url, ip || 'inconnue');
    if (chemin === '/temps-reel/attendre' && methode === 'GET') return attendre(acteur, url, ip || 'inconnue');
    if (chemin === '/temps-reel/evenements' && methode === 'GET') return evenements(acteur, url, ip || 'inconnue');
    if (chemin === '/temps-reel/version' && methode === 'GET') return version(acteur, url);
    if (chemin === '/temps-reel/presence' && methode === 'POST') {
      const corps = await lireCorps();
      await limite('temps_reel_presence', acteur.compte);
      return presence(acteur, corps);
    }
    if (chemin === '/temps-reel/etat' && methode === 'GET') return etat(acteur);
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  return {
    mode,
    rang: RANG[mode],
    routes,
    avantEcriture,
    apresEcriture,
    recevoir,
    etat: () => etat({ superAdmin: true }),
    nombre: () => connexions.size,
    oublierAcces,
    async fermer() {
      for (const c of [...connexions]) c.fermer();
      arreterCentre?.();
      arreterCentre = undefined;
      const e = ecoute;
      ecoute = undefined;
      await e?.fermer();
    },
  };
}
