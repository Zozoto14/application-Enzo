/**
 * Profils de jeu (migration 0021) : services du serveur.
 *
 * Droits :
 *  - lecture d'un profil ACTIF : tout compte Esport (création de team) ; profil de SA team : tout membre
 *    (`GET /teams/:id/jeu`, contrôle d'appartenance habituel) ;
 *  - gestion (créer, modifier, archiver, historique, assistant IA, propositions) : permission GLOBALE
 *    `jeux.gerer` — le Fondateur, et les comptes à qui il l'accorde (`permissions_globales`) ;
 *  - Administration de l'IA (plafonds, test de connexion, délégations) : le Fondateur seul.
 *
 * Versions : chaque écriture d'un profil crée une version (données complètes + résumé des différences),
 * avec un contrôle de concurrence (version attendue). Les travaux de l'IA (brouillon, vérification)
 * tournent après la réponse HTTP (ou dans le cron) ; leur résultat attend la validation du Fondateur.
 *
 * Trois moteurs (docs/esport/ia-api.md), essayés dans un ORDRE DE REPLI propre à chaque tâche (« profils » :
 * brouillons et vérifications ; « leger » : traductions, posts CM), réglé par le Fondateur
 * (Administration IA ; défaut : IA_ORDRE, IA_ORDRE_LEGER). Tâches CONFIDENTIELLES (réunions, suivi, strats) :
 * IA locale seulement, sauf levée par le Fondateur tâche par tâche (../ia/confidentialite.mjs) :
 *  - « api » / « api2 » : moteurs d'API principal et secondaire (IA_API_*, IA_API2_*), plafond mensuel d'appels
 *    PAR MOTEUR ; un moteur en panne, limité (429) ou au plafond passe la main au suivant ;
 *  - « claude » : API Anthropic (ANTHROPIC_API_KEY, IA_CLAUDE_*), plafond mensuel propre ; jamais pour une tâche
 *    confidentielle, même levée ;
 *  - « local » : IA LOCALE (llama.cpp sur le serveur, `ia.local`), sans plafond mensuel mais une requête à
 *    la fois, durée bornée ; ses travaux longs tournent dans un processus de fond (lancé tout de suite, et
 *    par le cron en secours), pas dans l'app Passenger qui peut être endormie à tout moment.
 * L'ancien réglage `mode` (local, api, local-api) reste accepté : il fixe l'ordre des profils de jeu.
 */

import { distribuer, evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { servicesFileTranscription } from '../medias/fileTranscription.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { MOTEURS_IA, TACHES_IA, creerConnecteur, creerConnecteurClaude, creerRepartiteurIa, lireOrdreIa, ordresIaEnv, peutReplier, tacheIa } from '../ia/connecteur.mjs';
import { preparerBrouillon, testerConnexion, verifierProfil } from '../ia/assistant.mjs';
import { TACHES_CONFIDENTIELLES, TACHES_EXTERNES_OK, autorisationsDepuisBase, cleExterne, lireAutorisationsExternes } from '../ia/confidentialite.mjs';
import { verifierAdresseHttps } from '../ia/recherche.mjs';
import { appliquerChangement, resumeDifferences } from './differences.mjs';
import { MOTIF_CLE_JEU, SECTIONS_LISTES, cleDe, SECTIONS_OBJETS, Invalide, libelleFormat, lireElement, lireObjet, reporterChampsLocaux, validerDonnees, validerEntete } from './schema.mjs';
import { servicesImagesJeux, verifierOctetsImage, TYPES_IMAGE_JEU } from './images.mjs';
import { CARTES_THEFINALS, HOTES_VALORANT, TAILLE_MAX_IMAGE_IMPORT, TAILLE_MAX_JSON_IMPORT, URL_MAPS_VALORANT, echelleApproxTheFinals, echelleDepuisUnitesParMetre, mapValorant, telechargerBorne } from './import.mjs';
import { modeleDuJeu } from '../strats/modeles.mjs';

export const PERMISSION_JEUX = 'jeux.gerer';
export const PERMISSIONS_GLOBALES = [PERMISSION_JEUX];
export const REGLAGES_IA_DEFAUT = { quotaAppels: 30, quotaAppelsApi2: 200, quotaAppelsClaude: 100, quotaVerifications: 8, autoActif: true };
/** Ancien réglage « mode » (avant les ordres de repli par tâche) : il reste accepté et fixe l'ordre des profils de jeu. */
export const MODES_IA = ['local', 'api', 'local-api'];
const ORDRE_MODE = { local: ['local'], api: ['api', 'api2'], 'local-api': ['local', 'api', 'api2'] };
const DELAI_TEST_LOCAL_MS = 4 * 60_000;
/** Durée maximale du test d'un moteur d'API (même un modèle à raisonnement), et attente de la réponse HTTP. */
const PLAFOND_TEST_API_MS = 90_000;
const ATTENTE_TEST_MS = 10_000;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const DUREE_EN_COURS_MAX_MS = 15 * 60_000;
const ATTENTE_REPRISE_MS = 2 * 60_000;
/** Progression d'un brouillon notée au plus toutes les 10 s pendant une étape. */
const PROGRESSION_INTERVALLE_MS = 10_000;
/** Un brouillon « en cours » sans nouvelle depuis 15 min (processus arrêté) ne bloque plus un nouveau brouillon du même jeu. */
const EN_COURS_MUET_MS = 15 * 60_000;

/** Premier jour du mois (UTC) de l'instant `t`, en ISO. */
export const debutMois = t => {
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

/** Le jeu est-il dû pour une vérification automatique ? */
export function verificationDue(jeu, maintenant) {
  const depuis = Date.parse(jeu.derniere_verif_le ?? jeu.cree_le);
  const frequence = Math.max(1, Number(jeu.frequence_jours) || 7) * 86_400_000;
  return !Number.isFinite(depuis) || maintenant - depuis >= frequence;
}

const erreurPublique = e => ({ code: e?.code ?? 'interne', message: e?.code ? String(e.message ?? '').slice(0, 300) : 'Erreur interne.' });

/**
 * Jeu choisi pour une team : un profil ACTIF (création), ou celui qu'elle a déjà (modification). Utilisé
 * par service.mjs (création et modification d'une team) : 400 `jeu-requis` / `jeu` sinon.
 */
export async function jeuValidePourTeam(base, cle, { actuel } = {}) {
  if (typeof cle !== 'string' || !cle) throw echec(400, 'jeu-requis', 'Choisissez le jeu de la team.');
  const j = MOTIF_CLE_JEU.test(cle) ? await base.premier('SELECT cle, statut FROM jeux WHERE cle = ?', [cle]) : null;
  if (!j || (j.statut !== 'actif' && cle !== actuel)) throw echec(400, 'jeu', 'Jeu inconnu.');
  return j.cle;
}

/** Noms et couleurs des jeux (affichage des teams). */
export async function nomsDesJeux(base) {
  return new Map((await base.tous('SELECT cle, nom, couleur FROM jeux', [])).map(j => [j.cle, { nom: j.nom, couleur: j.couleur }]));
}

/** Le compte a-t-il la permission globale `jeux.gerer` (Fondateur : toujours) ? */
export async function aPermissionJeux(base, acteur) {
  // Accord direct (Jeux › Administration IA) ou rôle du club qui la porte (migration 0033) : vue permissions_club.
  return aGlobale(base, acteur, PERMISSION_JEUX);
}

/**
 * `ia` : { config (configIa), fetch, telecharger, resoudre, local } ; `local` (IA locale, facultatif) :
 * { connecteur (creerConnecteurLocal), disponible(), raison, info: { modele, nomModele, moteur, threads,
 * contexte, delaiMs, benchmark }, etat() (en marche, dernière vitesse…), lancerTravailleur() }.
 */
export function servicesJeux({ base, stockage, cleSession, fetchImport = (...a) => globalThis.fetch(...a), maintenant = () => Date.now(), socle, ia = {}, travauxIa = 'fond', journal = console, attenteTestMs = ia.attenteTestMs ?? ATTENTE_TEST_MS }) {
  const images = servicesImagesJeux({ base, stockage, cleSession, maintenant });
  const config = ia.config ?? null;
  // Moteurs d'API : principal (IA_API_*) et secondaire (IA_API2_*, porté par la config du principal).
  const configs = { api: config, api2: ia.config2 ?? config?.secondaire ?? null, claude: ia.configClaude ?? config?.claude ?? null };
  const optionsConnecteur = { ...(ia.fetch ? { fetch: ia.fetch } : {}), ...(ia.attendre ? { attendre: ia.attendre } : {}), maintenant, journal: texte => journal.warn?.(texte) };
  const connecteurs = {
    api: creerConnecteur(configs.api, optionsConnecteur),
    api2: creerConnecteur(configs.api2, optionsConnecteur),
    claude: creerConnecteurClaude(configs.claude ?? { actif: false }, { ...(ia.fetch ? { fetch: ia.fetch } : {}), ...(ia.Anthropic ? { Anthropic: ia.Anthropic } : {}), maintenant, journal: texte => journal.warn?.(texte) }),
  };
  const ordresEnv = ia.ordres ?? config?.ordres ?? ordresIaEnv({});
  const local = ia.local ?? null;
  const localPret = () => Boolean(local?.disponible?.() && local.connecteur);
  const optionsRecherche = { telecharger: ia.telecharger, resoudre: ia.resoudre, maintenant };
  // Un travail local (plusieurs requêtes de 20 min au plus) dure plus longtemps qu'un appel d'API ; un brouillon
  // en cours rafraîchit `maj_le` à chaque progression, il n'est donc jamais pris pour un travail bloqué.
  const dureeEnCoursMax = localPret() ? Math.max(DUREE_EN_COURS_MAX_MS, 2 * (local.info?.delaiMs ?? 20 * 60_000) + 10 * 60_000) : DUREE_EN_COURS_MAX_MS;

  // -------------------------------------------------------------- Droits

  const peutGerer = acteur => aPermissionJeux(base, acteur);
  async function exigerGestion(acteur) {
    if (!(await peutGerer(acteur))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }
  function exigerFondateur(acteur) {
    if (!acteur?.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
  }

  // -------------------------------------------------------------- Lectures

  async function ligneJeu(cle) {
    if (typeof cle !== 'string' || !MOTIF_CLE_JEU.test(cle)) throw echec(404, 'jeu-introuvable', 'Jeu introuvable.');
    const j = await base.premier('SELECT * FROM jeux WHERE cle = ?', [cle]);
    if (!j) throw echec(404, 'jeu-introuvable', 'Jeu introuvable.');
    return j;
  }

  const donneesDe = j => validerDonnees(jsonOu(j.donnees, {}), { tolerant: true }).donnees;

  function resumeProfil(d) {
    return {
      formats: d.formats.map(f => ({ nom: f.nom, libelle: libelleFormat(f), bo: f.bo })),
      score: d.score?.type ?? null,
      roster: d.roster,
      cartes: d.cartes.length,
      cartesActives: d.cartes.filter(c => c.actif).length,
      personnages: d.personnages.length,
      modes: d.modes.length,
      // Précision des maps et des capacités (éditeur de strats) : ce qu'il reste à préparer.
      cartesImages: d.cartes.filter(c => c.fichier).length,
      cartesCalibrees: d.cartes.filter(c => c.echelle).length,
      capacites: d.personnages.reduce((n, p) => n + (p.capacites?.length ?? 0), 0),
      capacitesAVerifier: d.personnages.reduce((n, p) => n + (p.capacites ?? []).filter(c => c.aVerifier).length, 0),
    };
  }

  const entetePublic = j => ({ cle: j.cle, nom: j.nom, couleur: j.couleur, icone: j.icone ?? null, base: j.base ?? null, modeleStrat: modeleDuJeu(j.modele_strat, j.cle), statut: j.statut, version: Number(j.version) });

  async function teamsParJeu() {
    const lignes = await base.tous('SELECT jeu, COUNT(*) AS n FROM teams WHERE supprimee_le IS NULL GROUP BY jeu', []);
    return new Map(lignes.map(l => [l.jeu, Number(l.n)]));
  }

  async function attentesParJeu() {
    const lignes = await base.tous("SELECT jeu_cle, COUNT(*) AS n FROM ia_propositions WHERE statut = 'en_attente' GROUP BY jeu_cle", []);
    return new Map(lignes.map(l => [l.jeu_cle, Number(l.n)]));
  }

  /** `GET /jeux` : profils actifs (création de team) ; pour un gestionnaire, tous, avec l'état de l'IA. */
  async function liste(acteur, { tous = false } = {}) {
    const gerer = await peutGerer(acteur);
    const lignes = gerer && tous ? await base.tous('SELECT * FROM jeux ORDER BY nom', []) : await base.tous("SELECT * FROM jeux WHERE statut = 'actif' ORDER BY nom", []);
    const teams = gerer ? await teamsParJeu() : new Map();
    const attentes = gerer ? await attentesParJeu() : new Map();
    return {
      gerer,
      jeux: lignes.map(j => ({
        ...entetePublic(j),
        resume: resumeProfil(donneesDe(j)),
        ...(gerer
          ? { teams: teams.get(j.cle) ?? 0, propositions: attentes.get(j.cle) ?? 0, majAuto: Number(j.maj_auto) === 1, frequenceJours: Number(j.frequence_jours), derniereVerif: j.derniere_verif_le ?? null, majLe: j.maj_le }
          : {}),
      })),
      ...(gerer ? { ia: await disponibilite().then(d => ({ disponible: d.disponible, raison: d.raison })) } : {}),
    };
  }

  /** `GET /jeux/:cle` : profil complet (actif ; tout profil pour un gestionnaire). */
  async function detail(acteur, cle, { origine = '' } = {}) {
    const j = await ligneJeu(cle);
    const gerer = await peutGerer(acteur);
    if (j.statut !== 'actif' && !gerer) throw echec(404, 'jeu-introuvable', 'Jeu introuvable.');
    const donnees = donneesDe(j);
    // Images déposées (fonds des maps) : liens signés de lecture, 6 h.
    const sortie = { ...entetePublic(j), donnees, images: await images.liens(j.cle, donnees, acteur.compte, origine) };
    if (!gerer) return sortie;
    const teams = await teamsParJeu();
    const attente = await base.premier("SELECT COUNT(*) AS n FROM ia_propositions WHERE jeu_cle = ? AND statut = 'en_attente'", [cle]);
    return { ...sortie, gerer: true, teams: teams.get(cle) ?? 0, propositions: Number(attente?.n ?? 0), majAuto: Number(j.maj_auto) === 1, frequenceJours: Number(j.frequence_jours), derniereVerif: j.derniere_verif_le ?? null, majLe: j.maj_le, majPar: j.maj_par ?? null };
  }

  /** `GET /teams/:id/jeu` : profil du jeu de la team (tout membre), même archivé. */
  async function pourTeam(acteur, teamId, { origine = '' } = {}) {
    const ctx = await socle.contexteTeam(acteur, teamId);
    const j = await base.premier('SELECT * FROM jeux WHERE cle = ?', [ctx.team.jeu]);
    if (!j) return { cle: ctx.team.jeu, nom: ctx.team.jeu, couleur: '#8b8b9a', icone: null, base: ctx.team.jeu === 'valorant' ? 'valorant' : null, modeleStrat: modeleDuJeu(null, ctx.team.jeu), statut: 'actif', version: 0, donnees: validerDonnees({}).donnees, images: {} };
    const donnees = donneesDe(j);
    return { ...entetePublic(j), donnees, images: await images.liens(j.cle, donnees, acteur.compte, origine) };
  }

  /** Télécharge une image (bornée, vérifiée) et la dépose si elle a changé ; rend `{ fichier, empreinte, statut }`. */
  async function importerImage(acteur, j, url, ancienFichier, { hotes, nom }) {
    const { octets, type } = await telechargerBorne(fetchImport, url, { hotes, max: TAILLE_MAX_IMAGE_IMPORT, types: Object.keys(TYPES_IMAGE_JEU) });
    const v = verifierOctetsImage(octets, type, TAILLE_MAX_IMAGE_IMPORT);
    const { empreinteSha256 } = await import('../fichiers.mjs');
    const empreinte = await empreinteSha256(octets);
    if (ancienFichier && (await images.empreinteDe(j.cle, ancienFichier)) === empreinte) return { fichier: ancienFichier, empreinte, statut: 'inchangee' };
    const r = await images.deposerVerifiee(acteur, j.cle, v, nom);
    return { fichier: r.id, empreinte, statut: 'importee' };
  }

  /**
   * `POST /jeux/:cle/importer` : images des maps et échelle, téléchargées par le serveur (voir import.mjs).
   * Valorant : valorant-api.com (minimaps, échelle calculée, callouts) ; The Finals : `{ urls: { [carte]: adresse } }`
   * fournies par le gestionnaire, échelle approximative « à vérifier ». Rend le profil et un compte rendu par map.
   * Idempotent ; un calibrage fait à la main et une image déposée à la main (sans source) ne sont jamais remplacés,
   * sauf `{ remplacer: true }` pour les images.
   */
  async function importerCartes(acteur, cle, corps = {}) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const modele = modeleDuJeu(j.modele_strat, j.cle);
    const d = structuredClone(donneesDe(j));
    const t = new Date(maintenant()).toISOString();
    const rapport = [];
    const remplacer = corps?.remplacer === true;
    const peutRemplacerImage = c => !c.fichier || remplacer || Boolean(c.source);
    if (modele === 'valorant') {
      const { octets } = await telechargerBorne(fetchImport, URL_MAPS_VALORANT, { hotes: HOTES_VALORANT, max: TAILLE_MAX_JSON_IMPORT, types: ['application/json'] });
      let json;
      try {
        json = JSON.parse(new TextDecoder().decode(octets));
      } catch {
        throw echec(502, 'import-json', 'Réponse de valorant-api.com illisible.');
      }
      const maps = (Array.isArray(json?.data) ? json.data : []).map(mapValorant).filter(Boolean);
      if (maps.length === 0) throw echec(502, 'import-vide', 'valorant-api.com ne donne aucune map exploitable.');
      for (const m of maps) {
        let c = d.cartes.find(x => x.cle === m.cle);
        if (!c) {
          // Map absente du profil : ajoutée HORS du pool (le Fondateur choisit le pool compétitif) ; seulement les maps de compétition.
          if (!m.competitive || d.cartes.length >= 80) continue;
          c = { cle: m.cle, nom: m.nom, image: null, actif: false, modes: [] };
          d.cartes.push(c);
        }
        const ligne = { carte: c.nom, image: 'gardee', echelle: 'gardee', reperes: 0 };
        try {
          if (peutRemplacerImage(c)) {
            const r = await importerImage(acteur, j, m.minimap, c.fichier, { hotes: HOTES_VALORANT, nom: `${m.cle}.png` });
            c.fichier = r.fichier;
            c.source = { fournisseur: 'valorant-api.com', url: m.minimap, le: t, empreinte: r.empreinte, aVerifier: false };
            ligne.image = r.statut;
          }
          if (!c.echelle || c.echelle.methode === 'import' || c.echelle.methode === 'approx') {
            const e = echelleDepuisUnitesParMetre(m.pxParMetre, 'import');
            if (e) {
              c.echelle = e;
              ligne.echelle = 'importee';
            }
          }
          // Callouts importés : remplacés à chaque import ; les repères posés à la main restent.
          const manuels = (c.reperes ?? []).filter(r => !r.importe);
          const pris = new Set(manuels.map(r => r.cle));
          const importes = m.reperes
            .map(r => ({ ...r, cle: cleDe(r.nom) }))
            .filter(r => r.cle && !pris.has(r.cle) && (pris.add(r.cle), true))
            .slice(0, Math.max(0, 120 - manuels.length));
          c.reperes = [...manuels, ...importes.map(r => ({ ...r, importe: true }))];
          ligne.reperes = importes.length;
        } catch (e) {
          if (!e?.code) throw e;
          ligne.erreur = e.code;
        }
        rapport.push(ligne);
      }
    } else if (modele === 'thefinals') {
      const urls = corps?.urls && typeof corps.urls === 'object' ? corps.urls : {};
      for (const nom of CARTES_THEFINALS) {
        const k = cleDe(nom);
        if (!d.cartes.some(c => c.cle === k) && d.cartes.length < 80) d.cartes.push({ cle: k, nom, image: null, actif: true, modes: [] });
      }
      for (const c of d.cartes) {
        const ligne = { carte: c.nom, image: 'gardee', echelle: 'gardee', reperes: 0 };
        const url = typeof urls[c.cle] === 'string' ? urls[c.cle].trim() : '';
        try {
          if (url && peutRemplacerImage(c)) {
            const r = await importerImage(acteur, j, url, c.fichier, { nom: `${c.cle}` });
            c.fichier = r.fichier;
            c.source = { fournisseur: new URL(url).hostname, url, le: t, empreinte: r.empreinte, aVerifier: true };
            ligne.image = r.statut;
          } else if (!url && !c.fichier) ligne.image = 'sans-adresse';
          if (!c.echelle) {
            c.echelle = echelleApproxTheFinals();
            ligne.echelle = 'approximative';
          }
        } catch (e) {
          if (!e?.code) throw e;
          ligne.erreur = e.code;
        }
        rapport.push(ligne);
      }
    } else throw echec(400, 'import-modele', 'Import automatique : Valorant et The Finals seulement (déposez les images à la main).');
    const r = await ecrireVersion(acteur, j, { donnees: validerDonnees(d).donnees, versionAttendue: corps?.version, motif: 'import' });
    return { rapport, inchange: Boolean(r.inchange), jeu: await detail(acteur, cle) };
  }

  /** `POST /jeux/:cle/images` : dépôt d'une image (fond d'une map), à citer ensuite dans le profil (`cartes[].fichier`). */
  async function deposerImage(acteur, cle, corps, { origine = '' } = {}) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    return images.deposer(acteur, j.cle, corps, { origine });
  }

  const nomsJeux = () => nomsDesJeux(base);

  // -------------------------------------------------------------- Écritures (versionnées)

  function insertionVersion(j, { version, donnees, motif, resume, auteur, t }) {
    return {
      sql: 'INSERT INTO jeu_versions (id, jeu_cle, version, nom, couleur, icone, donnees, motif, resume, auteur_id, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [nouvelId(), j.cle, version, j.nom, j.couleur, j.icone ?? null, JSON.stringify(donnees), motif, JSON.stringify(resume ?? {}), auteur ?? null, iso(t)],
    };
  }

  async function creerProfil(acteur, corps, { motif = 'creation', lot: extra = [] } = {}) {
    const entete = validerEntete(corps, { avecCle: true });
    const { donnees } = validerDonnees(corps?.donnees ?? {});
    if (await base.premier('SELECT cle FROM jeux WHERE cle = ?', [entete.cle])) throw echec(409, 'jeu-existe', 'Un jeu porte déjà cette clé.');
    const t = maintenant();
    const j = { ...entete };
    await base.lot([
      {
        sql: `INSERT INTO jeux (cle, nom, couleur, icone, base, statut, donnees, version, maj_auto, frequence_jours, modele_strat, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, NULL, 'actif', ?, 1, 1, 7, ?, ?, ?, ?, ?)`,
        params: [j.cle, j.nom, j.couleur, j.icone, JSON.stringify(donnees), j.modeleStrat ?? 'generique', acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      insertionVersion(j, { version: 1, donnees, motif, resume: resumeDifferences(null, donnees), auteur: acteur.compte, t }),
      ...extra,
      evenement('game.created', { acteur: acteur.compte, entiteType: 'jeu', entiteId: j.cle, charge: { nom: j.nom, motif }, maintenant: t }),
    ]);
    return detail(acteur, j.cle);
  }

  /**
   * Nouvelle version d'un profil : en-tête et/ou données. `versionAttendue` : celle que l'écran a lue
   * (409 `version-conflit` si quelqu'un a modifié le profil entre-temps).
   */
  async function ecrireVersion(acteur, j, { entete = {}, donnees, versionAttendue, motif, extra = [] }) {
    if (versionAttendue !== undefined && Number(versionAttendue) !== Number(j.version)) {
      const e = echec(409, 'version-conflit', 'Ce profil a été modifié entre-temps : rechargez-le.');
      e.details = { version: Number(j.version) };
      throw e;
    }
    const avant = donneesDe(j);
    const apres = donnees ?? avant;
    const nouveau = { cle: j.cle, nom: entete.nom ?? j.nom, couleur: entete.couleur ?? j.couleur, icone: entete.icone !== undefined ? entete.icone : (j.icone ?? null) };
    const modeleAvant = modeleDuJeu(j.modele_strat, j.cle);
    const modele = entete.modeleStrat ?? modeleAvant;
    const resume = resumeDifferences(avant, apres);
    for (const champ of ['nom', 'couleur', 'icone']) if ((nouveau[champ] ?? null) !== (j[champ] ?? null)) resume[champ] = true;
    if (modele !== modeleAvant) resume.modeleStrat = true;
    if (Object.keys(resume).length === 0) return { inchange: true };
    const t = maintenant();
    const version = Number(j.version) + 1;
    const [maj] = await base.lot([
      {
        sql: 'UPDATE jeux SET nom = ?, couleur = ?, icone = ?, donnees = ?, modele_strat = ?, version = ?, maj_par = ?, maj_le = ? WHERE cle = ? AND version = ?',
        params: [nouveau.nom, nouveau.couleur, nouveau.icone, JSON.stringify(apres), modele, version, acteur.compte, iso(t), j.cle, Number(j.version)],
      },
      insertionVersion(nouveau, { version, donnees: apres, motif, resume, auteur: acteur.compte, t }),
      ...extra,
      evenement('game.updated', { acteur: acteur.compte, entiteType: 'jeu', entiteId: j.cle, charge: { nom: nouveau.nom, version, motif, sections: Object.keys(resume) }, maintenant: t }),
    ]).catch(e => {
      // Deux écritures simultanées : la seconde bute sur UNIQUE (jeu_cle, version).
      if (/unique|duplicate/i.test(String(e?.message))) throw echec(409, 'version-conflit', 'Ce profil a été modifié entre-temps : rechargez-le.');
      throw e;
    });
    if (maj.changements === 0) throw echec(409, 'version-conflit', 'Ce profil a été modifié entre-temps : rechargez-le.');
    return { version };
  }

  async function creer(acteur, corps) {
    await exigerGestion(acteur);
    return creerProfil(acteur, corps);
  }

  async function modifier(acteur, cle, corps) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    if (corps?.version === undefined) throw echec(400, 'version-requise', 'Version du profil attendue.');
    const entete = validerEntete(corps, { partiel: true });
    const donnees = corps?.donnees !== undefined ? validerDonnees(corps.donnees).donnees : undefined;
    await ecrireVersion(acteur, j, { entete, donnees, versionAttendue: corps.version, motif: 'modification' });
    return detail(acteur, cle);
  }

  async function archiver(acteur, cle, corps) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const statut = corps?.archive ? 'archive' : 'actif';
    if (statut === j.statut) return detail(acteur, cle);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE jeux SET statut = ?, maj_par = ?, maj_le = ? WHERE cle = ?', params: [statut, acteur.compte, iso(t), cle] },
      evenement('game.archived', { acteur: acteur.compte, entiteType: 'jeu', entiteId: cle, charge: { nom: j.nom, archive: statut === 'archive' }, maintenant: t }),
    ]);
    return detail(acteur, cle);
  }

  async function supprimer(acteur, cle) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const n = await base.premier('SELECT COUNT(*) AS n FROM teams WHERE jeu = ? AND supprimee_le IS NULL', [cle]);
    if (Number(n?.n ?? 0) > 0) {
      const e = echec(409, 'jeu-utilise', 'Des teams jouent à ce jeu : archivez-le plutôt.');
      e.details = { teams: Number(n.n) };
      throw e;
    }
    const t = maintenant();
    const purge = await images.preparerPurge(cle);
    await base.lot([
      ...purge.instructions,
      { sql: 'DELETE FROM ia_propositions WHERE jeu_cle = ?', params: [cle] },
      { sql: "UPDATE ia_travaux SET statut = 'abandonne', maj_le = ? WHERE jeu_cle = ? AND statut IN ('attente', 'pret')", params: [iso(t), cle] },
      { sql: 'DELETE FROM jeu_versions WHERE jeu_cle = ?', params: [cle] },
      { sql: 'DELETE FROM jeux WHERE cle = ?', params: [cle] },
      evenement('game.deleted', { acteur: acteur.compte, entiteType: 'jeu', entiteId: cle, charge: { nom: j.nom }, maintenant: t }),
    ]);
    await purge.effacer();
    return { ok: true };
  }

  async function versions(acteur, cle) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const lignes = await base.tous('SELECT version, nom, motif, resume, auteur_id, cree_le FROM jeu_versions WHERE jeu_cle = ? ORDER BY version DESC LIMIT 200', [cle]);
    const noms = await pseudosDe(base, lignes.map(l => l.auteur_id).filter(Boolean));
    return { versions: lignes.map(l => ({ version: Number(l.version), nom: l.nom, motif: l.motif, resume: jsonOu(l.resume, {}), auteur: l.auteur_id ? { compte: l.auteur_id, pseudo: noms[l.auteur_id] ?? null } : null, le: l.cree_le })) };
  }

  async function ligneVersion(cle, n) {
    const v = await base.premier('SELECT * FROM jeu_versions WHERE jeu_cle = ? AND version = ?', [cle, Number(n)]);
    if (!v || !/^\d{1,6}$/.test(String(n))) throw echec(404, 'version-introuvable', 'Version introuvable.');
    return v;
  }

  async function version(acteur, cle, n) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const v = await ligneVersion(cle, n);
    return { version: Number(v.version), nom: v.nom, couleur: v.couleur, icone: v.icone ?? null, motif: v.motif, le: v.cree_le, donnees: validerDonnees(jsonOu(v.donnees, {}), { tolerant: true }).donnees };
  }

  async function restaurer(acteur, cle, n, corps) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const v = await ligneVersion(cle, n);
    await ecrireVersion(acteur, j, {
      entete: { nom: v.nom, couleur: v.couleur, icone: v.icone ?? null },
      donnees: validerDonnees(jsonOu(v.donnees, {}), { tolerant: true }).donnees,
      versionAttendue: corps?.version,
      motif: 'restauration',
    });
    return detail(acteur, cle);
  }

  async function reglerMaj(acteur, cle, corps) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const champs = [];
    const valeurs = [];
    if (corps?.majAuto !== undefined) {
      champs.push('maj_auto');
      valeurs.push(corps.majAuto ? 1 : 0);
    }
    if (corps?.frequenceJours !== undefined) {
      const f = Number(corps.frequenceJours);
      if (!Number.isInteger(f) || f < 1 || f > 90) throw echec(400, 'frequence', 'Fréquence : de 1 à 90 jours.');
      champs.push('frequence_jours');
      valeurs.push(f);
    }
    if (champs.length) await base.executer(`UPDATE jeux SET ${champs.map(c => `${c} = ?`).join(', ')} WHERE cle = ?`, [...valeurs, cle]);
    return detail(acteur, cle);
  }

  // -------------------------------------------------------------- Délégation (Fondateur)

  async function gestionnaires(acteur) {
    exigerFondateur(acteur);
    const lignes = await base.tous('SELECT compte_id, cree_le FROM permissions_globales WHERE permission = ? ORDER BY cree_le', [PERMISSION_JEUX]);
    const noms = await pseudosDe(base, lignes.map(l => l.compte_id));
    return { gestionnaires: lignes.map(l => ({ compte: l.compte_id, pseudo: noms[l.compte_id] ?? null, depuis: l.cree_le })) };
  }

  async function reglerGestionnaires(acteur, corps) {
    exigerFondateur(acteur);
    const lire = v => (Array.isArray(v) ? v.slice(0, 50).filter(c => typeof c === 'string' && MOTIF_COMPTE.test(c) && c !== 'principal') : []);
    const ajouter = lire(corps?.ajouter);
    const retirer = lire(corps?.retirer);
    const t = maintenant();
    const lot = [];
    for (const c of ajouter) {
      if (!(await base.premier('SELECT id FROM comptes WHERE id = ?', [c]))) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
      lot.push({ sql: 'INSERT INTO permissions_globales (compte_id, permission, accorde_par, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT (compte_id, permission) DO NOTHING', params: [c, PERMISSION_JEUX, acteur.compte, iso(t)] });
    }
    for (const c of retirer) lot.push({ sql: 'DELETE FROM permissions_globales WHERE compte_id = ? AND permission = ?', params: [c, PERMISSION_JEUX] });
    if (lot.length) await base.lot(lot);
    return gestionnaires(acteur);
  }

  // -------------------------------------------------------------- IA : réglages, quota, appels

  /** Le moteur peut-il répondre (clé et modèle pour une API, installation pour l'IA locale) ? */
  const pret = m => (m === 'local' ? localPret() : Boolean(connecteurs[m]?.disponible()));

  /**
   * Ordre des profils de jeu : celui de l'Administration IA (`ordre_profils`), sinon l'ancien réglage `mode`
   * (avant les ordres de repli), sinon l'environnement (IA_ORDRE ; IA_FOURNISSEUR=local → locale d'abord).
   */
  async function reglagesIa() {
    const lignes = await base.tous('SELECT cle, valeur FROM ia_reglages', []);
    const r = { ...REGLAGES_IA_DEFAUT };
    let mode = null;
    const ordres = {};
    for (const l of lignes) {
      if (l.cle === 'quota_appels') r.quotaAppels = Number(l.valeur);
      if (l.cle === 'quota_appels_api2') r.quotaAppelsApi2 = Number(l.valeur);
      if (l.cle === 'quota_appels_claude') r.quotaAppelsClaude = Number(l.valeur);
      if (l.cle === 'quota_verifications') r.quotaVerifications = Number(l.valeur);
      if (l.cle === 'auto_actif') r.autoActif = l.valeur === '1';
      if (l.cle === 'mode' && MODES_IA.includes(l.valeur)) mode = l.valeur;
      if (l.cle === 'ordre_profils') ordres.profils = lireOrdreIa(l.valeur, ordresEnv.profils);
      if (l.cle === 'ordre_leger') ordres.leger = lireOrdreIa(l.valeur, ordresEnv.leger);
    }
    r.ordres = { profils: ordres.profils ?? (mode ? [...ORDRE_MODE[mode]] : [...ordresEnv.profils]), leger: ordres.leger ?? [...ordresEnv.leger] };
    r.ordresPersonnalises = { profils: Boolean(ordres.profils ?? mode), leger: Boolean(ordres.leger) };
    r.mode = modeDe(r.ordres.profils);
    return r;
  }

  /** Ancien « mode » (affichage, plafond des vérifications) déduit de l'ordre des profils de jeu. */
  function modeDe(ordre) {
    const dispo = ordre.filter(pret);
    const tete = (dispo.length ? dispo : ordre)[0];
    if (tete !== 'local') return 'api';
    return dispo.some(m => m !== 'local') ? 'local-api' : 'local';
  }

  /** L'assistant peut-il travailler (tâche « profils » ou « leger ») ? `{ disponible, raison, mode, moteurs, ordre }`. */
  async function disponibilite(tache = 'profils') {
    const r = await reglagesIa();
    const ordre = r.ordres[tacheIa(tache)];
    const moteurs = ordre.filter(pret);
    let raison = null;
    if (!moteurs.length) raison = ordre[0] === 'local' ? (local?.raison ?? 'locale-absente') : (config?.raison ?? 'cle-absente');
    return { disponible: moteurs.length > 0, raison, mode: r.mode, moteurs, ordre };
  }

  /** Erreur « assistant indisponible », adaptée au mode (clé absente / IA locale absente). */
  const indisponible = d => (d.mode === 'api' ? echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).') : echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).'));

  // Appels d'un moteur : `MOTEUR = ?`. Les lignes d'avant la colonne `moteur` (migration 0034) : 'local' ou l'API
  // principale. (Expression écrite en toutes lettres dans chaque requête : aucune interpolation dans le SQL.)
  const plafondDe = (m, reglages) => ({ api: reglages.quotaAppels, api2: reglages.quotaAppelsApi2, claude: reglages.quotaAppelsClaude })[m] ?? null;

  async function usageMois(t = maintenant()) {
    const depuis = debutMois(t);
    const compter = async m => Number((await base.premier("SELECT COUNT(*) AS n FROM ia_appels WHERE cree_le >= ? AND COALESCE(moteur, CASE WHEN fournisseur = 'local' THEN 'local' ELSE 'api' END) = ?", [depuis, m]))?.n ?? 0);
    const verifs = await base.premier("SELECT COUNT(*) AS n FROM ia_travaux WHERE genre = 'verification' AND cree_le >= ?", [depuis]);
    return { mois: depuis.slice(0, 7), appels: await compter('api'), appelsApi2: await compter('api2'), appelsClaude: await compter('claude'), appelsLocaux: await compter('local'), verifications: Number(verifs?.n ?? 0) };
  }

  /**
   * Transcription sur le serveur (Administration IA) : moteur (ONNX dans le processus, whisper.cpp désactivé ?),
   * qualités, dernier passage du processus de fond, dernière décision du cron, travaux par statut et bloqués.
   * `ia.transcription()` est fourni par le serveur Node (esport/serveur/transcription/moteur.mjs) ; ailleurs : null.
   */
  async function etatTranscription() {
    if (typeof ia.transcription !== 'function') return null;
    try {
      const e = await ia.transcription();
      const f = await servicesFileTranscription({ base, maintenant }).resumeFile();
      return { ...e, ...f };
    } catch {
      return null;
    }
  }

  /** État de l'IA locale pour l'Administration IA (installation, moteur en marche, mesures). */
  async function etatLocal() {
    if (!local) return { installe: false, raison: 'non-installee' };
    const dernier = await base.premier("SELECT cree_le, duree_ms, statut FROM ia_appels WHERE COALESCE(moteur, CASE WHEN fournisseur = 'local' THEN 'local' ELSE 'api' END) = ? AND statut = 'ok' ORDER BY cree_le DESC LIMIT 1", ['local']);
    let marche = {};
    try {
      marche = local.etat?.() ?? {};
    } catch {
      marche = {};
    }
    const info = local.info ?? {};
    const mesure = marche.mesure && Number.isFinite(marche.mesure.jetonsParSeconde) ? { jetonsParSeconde: marche.mesure.jetonsParSeconde, le: marche.mesure.le ?? null, source: 'requete' } : null;
    const banc = info.benchmark && Number.isFinite(info.benchmark.jetonsParSeconde) ? { jetonsParSeconde: info.benchmark.jetonsParSeconde, le: info.benchmark.le ?? null, source: 'test' } : null;
    let hebergement = null;
    try {
      hebergement = local.hebergement?.() ?? null;
    } catch {
      hebergement = null;
    }
    return {
      installe: localPret(),
      raison: localPret() ? null : (local.raison ?? 'non-installee'),
      // Moteur arrêté de force par l'hébergeur (SIGKILL) : nombre d'arrêts, indisponible (sauté dans les ordres) depuis quand.
      hebergement: hebergement ? { indisponible: Boolean(hebergement.indisponible), tues: Number(hebergement.tues ?? 0), max: Number(hebergement.max ?? 0), depuis: hebergement.depuis ?? null } : null,
      modele: info.modele ?? null,
      nomModele: info.nomModele ?? null,
      moteur: info.moteur ?? null,
      threads: info.threads ?? null,
      contexte: info.contexte ?? null,
      enMarche: Boolean(marche.enMarche),
      ailleurs: Boolean(marche.ailleurs),
      demarrage: Boolean(marche.demarrage),
      depuis: marche.depuis ?? null,
      file: Number(marche.file ?? 0),
      derniereErreur: marche.derniereErreur?.code ?? null,
      derniereVitesse: mesure ?? banc,
      benchmark: banc,
      dernierTempsReponseMs: dernier ? Number(dernier.duree_ms) : null,
      dernierAppelLe: dernier?.cree_le ?? null,
    };
  }

  /**
   * Un moteur pour l'Administration IA : fournisseur, modèle, hôte, clé présente ou absente (JAMAIS sa valeur),
   * appels et erreurs du mois, plafond, latence moyenne, dernier appel.
   */
  async function etatMoteur(m, reglages, t = maintenant()) {
    const c = m === 'local' ? null : configs[m];
    const info = local?.info ?? {};
    const fiche =
      m === 'local'
        ? { id: 'local', configure: localPret(), raison: localPret() ? null : (local?.raison ?? 'non-installee'), fournisseur: 'local', modele: info.nomModele ?? info.modele ?? null, hote: null, cle: null, externe: false, raisonnement: false, effort: null, images: false }
        : c
          ? { ...c.moteurPublic(), externe: true }
          : { id: m, configure: false, raison: 'cle-absente', fournisseur: null, modele: null, hote: null, cle: 'absente', externe: true, raisonnement: false, effort: null, images: false };
    // Claude : dernière erreur et dernière latence vues par ce processus (jamais la clé).
    const vu = m === 'claude' ? (connecteurs.claude.etat?.() ?? {}) : null;
    const mois = await base.premier(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN statut = 'echec' THEN 1 ELSE 0 END) AS erreurs, AVG(CASE WHEN statut = 'ok' THEN duree_ms END) AS latence FROM ia_appels WHERE cree_le >= ? AND COALESCE(moteur, CASE WHEN fournisseur = 'local' THEN 'local' ELSE 'api' END) = ?",
      [debutMois(t), m],
    );
    const dernier = await base.premier("SELECT cree_le, genre, statut, duree_ms, erreur FROM ia_appels WHERE statut <> 'en_cours' AND COALESCE(moteur, CASE WHEN fournisseur = 'local' THEN 'local' ELSE 'api' END) = ? ORDER BY cree_le DESC LIMIT 1", [m]);
    const latence = Number(mois?.latence);
    return {
      ...fiche,
      pret: pret(m),
      appelsMois: Number(mois?.n ?? 0),
      erreursMois: Number(mois?.erreurs ?? 0),
      plafond: plafondDe(m, reglages),
      latenceMoyenneMs: Number.isFinite(latence) && mois?.latence !== null ? Math.round(latence) : null,
      dernierAppel: dernier ? { le: dernier.cree_le, genre: dernier.genre, statut: dernier.statut, dureeMs: dernier.duree_ms === null ? null : Number(dernier.duree_ms), erreur: dernier.erreur ?? null } : null,
      ...(vu ? { derniereErreur: vu.derniereErreur ?? (dernier?.statut === 'echec' ? { code: dernier.erreur ?? 'erreur', le: dernier.cree_le } : null), derniereLatenceMs: vu.derniereLatenceMs ?? (dernier?.statut === 'ok' && dernier.duree_ms !== null ? Number(dernier.duree_ms) : null) } : {}),
    };
  }

  async function etatIa(acteur) {
    await exigerGestion(acteur);
    const reglages = await reglagesIa();
    const usage = await usageMois();
    const dernier = await base.premier("SELECT * FROM ia_appels WHERE statut <> 'en_cours' ORDER BY cree_le DESC LIMIT 1", []);
    const travaux = await base.tous("SELECT id, genre, jeu_cle, statut, declenchement, erreur, cree_le, fini_le FROM ia_travaux WHERE genre = 'verification' ORDER BY cree_le DESC LIMIT 10", []);
    const apiPret = pret('api') || pret('api2') || pret('claude');
    const moteurs = [];
    for (const m of MOTEURS_IA) moteurs.push(await etatMoteur(m, reglages));
    return {
      ...(config ? config.etatPublic() : { configure: false, raison: 'cle-absente', fournisseur: null, modele: null, hote: null, format: 'openai-chat', recherche: 'serveur', cle: 'absente' }),
      disponible: (await disponibilite()).disponible,
      mode: reglages.mode,
      modesPossibles: MODES_IA.filter(m => ({ local: localPret(), api: apiPret, 'local-api': localPret() && apiPret })[m]),
      moteurs,
      ordres: reglages.ordres,
      ordresDefaut: ordresEnv,
      confidentialite: await etatConfidentialite(),
      local: await etatLocal(),
      transcription: await etatTranscription(),
      lectureWeb: typeof ia.telecharger === 'function',
      fondateur: Boolean(acteur.superAdmin),
      reglages,
      usage: { ...usage, plafondAppels: reglages.quotaAppels, plafondAppelsApi2: reglages.quotaAppelsApi2, plafondAppelsClaude: reglages.quotaAppelsClaude, plafondVerifications: reglages.quotaVerifications },
      dernierAppel: dernier ? { le: dernier.cree_le, genre: dernier.genre, statut: dernier.statut, moteur: dernier.moteur ?? (dernier.fournisseur === 'local' ? 'local' : 'api'), fournisseur: dernier.fournisseur ?? null, modele: dernier.modele ?? null, dureeMs: dernier.duree_ms === null ? null : Number(dernier.duree_ms), erreur: dernier.erreur ?? null, jeu: dernier.jeu_cle ?? null } : null,
      verifications: travaux.map(x => ({ id: x.id, jeu: x.jeu_cle, statut: x.statut, declenchement: x.declenchement, erreur: jsonOu(x.erreur, null), le: x.cree_le, finiLe: x.fini_le ?? null })),
    };
  }

  /** Ordre de repli envoyé par l'Administration IA : 1 à 4 moteurs connus, sans doublon (null : celui par défaut). */
  function ordreRecu(v) {
    if (v === null) return null;
    const liste = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
    const propre = liste?.map(x => String(x).trim());
    if (!propre || propre.length < 1 || propre.length > MOTEURS_IA.length || propre.some(m => !MOTEURS_IA.includes(m)) || new Set(propre).size !== propre.length) {
      throw echec(400, 'ordre-ia', 'Ordre de repli : 1 à 4 moteurs parmi api, api2, claude et local, sans doublon.');
    }
    return propre;
  }

  async function reglerIa(acteur, corps) {
    exigerFondateur(acteur);
    const t = iso(maintenant());
    const lot = [];
    const poser = (cle, valeur) => lot.push({ sql: 'INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le', params: [cle, valeur, t] });
    const retirer = cle => lot.push({ sql: 'DELETE FROM ia_reglages WHERE cle = ?', params: [cle] });
    const plafond = (champ, cle) => {
      if (corps?.[champ] === undefined) return;
      const n = Number(corps[champ]);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) throw echec(400, 'quota', 'Plafond : un nombre entier de 0 à 10 000.');
      poser(cle, String(n));
    };
    plafond('quotaAppels', 'quota_appels');
    plafond('quotaAppelsApi2', 'quota_appels_api2');
    plafond('quotaAppelsClaude', 'quota_appels_claude');
    plafond('quotaVerifications', 'quota_verifications');
    if (corps?.autoActif !== undefined) poser('auto_actif', corps.autoActif ? '1' : '0');
    if (corps?.mode !== undefined) {
      if (!MODES_IA.includes(corps.mode)) throw echec(400, 'mode-ia', 'Mode de l’IA inconnu (local, api ou local-api).');
      // Ancien réglage (avant les ordres de repli) : il fixe l'ordre des profils de jeu.
      poser('mode', corps.mode);
      poser('ordre_profils', ORDRE_MODE[corps.mode].join(','));
    }
    const ordres = corps?.ordres && typeof corps.ordres === 'object' ? corps.ordres : {};
    for (const tache of TACHES_IA) {
      if (ordres[tache] === undefined) continue;
      const o = ordreRecu(ordres[tache]);
      if (o) poser(`ordre_${tache}`, o.join(','));
      else {
        retirer(`ordre_${tache}`);
        if (tache === 'profils') retirer('mode');
      }
    }
    // Confidentialité : le Fondateur seul lève la règle « IA locale seulement », tâche par tâche (journalisé).
    const externes = corps?.externes && typeof corps.externes === 'object' ? corps.externes : {};
    const avant = Object.keys(externes).length ? await lireAutorisationsExternes(base) : {};
    for (const [tache, valeur] of Object.entries(externes)) {
      if (!TACHES_CONFIDENTIELLES[tache]) throw echec(400, 'tache-confidentielle', 'Tâche inconnue : transcription, correction, resumes, suivi ou strats.');
      if (typeof valeur !== 'boolean') throw echec(400, 'tache-confidentielle', 'Autoriser l’envoi à un service externe : oui ou non.');
      if (valeur) poser(cleExterne(tache), '1');
      else retirer(cleExterne(tache));
      if (Boolean(avant[tache]?.autorise) !== valeur) {
        lot.push(evenement('ia.confidentialite_changed', { acteur: acteur.compte, entiteType: 'ia_tache', entiteId: tache, charge: { tache, externeAutorise: valeur }, maintenant: maintenant() }));
        try {
          journal.warn?.(`[ia] confidentialité : envoi de la tâche « ${tache} » à un service externe ${valeur ? 'AUTORISÉ' : 'retiré'} par ${acteur.compte}`);
        } catch {
          // Journal indisponible : l'événement reste en base.
        }
      }
    }
    if (lot.length) await base.lot(lot);
    return etatIa(acteur);
  }

  /** Tâches de l'IA : celles qui restent sur le serveur (confidentielles) et celles qui peuvent partir chez le fournisseur. */
  async function etatConfidentialite() {
    const a = await lireAutorisationsExternes(base);
    return {
      locales: Object.entries(TACHES_CONFIDENTIELLES).map(([cle, libelle]) => ({ cle, libelle, externeAutorise: a[cle]?.autorise === true, le: a[cle]?.autorise ? a[cle].le : null })),
      externes: Object.entries(TACHES_EXTERNES_OK).map(([cle, libelle]) => ({ cle, libelle })),
    };
  }

  /**
   * Appel à une API EXTERNE (« api », « api2 » ou « claude »), compté et plafonné PAR MOTEUR : la ligne `ia_appels` est
   * écrite AVANT l'appel, puis on compte les appels du mois de ce moteur (elle comprise) ; au-delà du plafond,
   * elle est retirée et l'appel refusé (429 `quota-ia` : le répartiteur passe au moteur suivant).
   */
  async function appelApi(m, genre, jeuCle, messages, options) {
    const t = maintenant();
    const id = nouvelId();
    const c = configs[m];
    await base.executer("INSERT INTO ia_appels (id, genre, jeu_cle, statut, fournisseur, modele, moteur, cree_le) VALUES (?, ?, ?, 'en_cours', ?, ?, ?, ?)", [id, genre, jeuCle ?? null, c.fournisseur, m === 'claude' && tacheIa(genre) === 'leger' ? c.modeleLeger : c.modele, m, iso(t)]);
    const plafond = plafondDe(m, await reglagesIa());
    const n = await base.premier("SELECT COUNT(*) AS n FROM ia_appels WHERE cree_le >= ? AND COALESCE(moteur, CASE WHEN fournisseur = 'local' THEN 'local' ELSE 'api' END) = ?", [debutMois(t), m]);
    if (Number(n?.n ?? 0) > plafond) {
      await base.executer('DELETE FROM ia_appels WHERE id = ?', [id]);
      throw echec(429, 'quota-ia', `Plafond mensuel d’appels à l’IA atteint (moteur ${m === 'api2' ? 'secondaire' : m === 'claude' ? 'Claude' : 'principal'} ; réglable dans Administration › IA).`);
    }
    return suivre(id, t, () => connecteurs[m].discuter(messages, options));
  }

  /** Appel à l'IA LOCALE : noté (statistiques, dernier temps de réponse) mais pas plafonné au mois. */
  async function appelLocal(genre, jeuCle, messages, options) {
    const t = maintenant();
    const id = nouvelId();
    await base.executer("INSERT INTO ia_appels (id, genre, jeu_cle, statut, fournisseur, modele, moteur, cree_le) VALUES (?, ?, ?, 'en_cours', 'local', ?, 'local', ?)", [id, genre, jeuCle ?? null, local.info?.modele ?? null, iso(t)]);
    return suivre(id, t, () => local.connecteur.discuter(messages, { ...options, ...(genre === 'test' ? { delaiLocal: DELAI_TEST_LOCAL_MS } : {}) }));
  }

  async function suivre(id, t, appel) {
    try {
      const r = await appel();
      await base.executer("UPDATE ia_appels SET statut = 'ok', duree_ms = ?, jetons_entree = ?, jetons_sortie = ? WHERE id = ?", [r.dureeMs ?? null, r.jetons?.entree ?? null, r.jetons?.sortie ?? null, id]);
      return r;
    } catch (e) {
      await base.executer("UPDATE ia_appels SET statut = 'echec', duree_ms = ?, erreur = ? WHERE id = ?", [maintenant() - t, String(e?.code ?? 'erreur').slice(0, 60), id]);
      throw e;
    }
  }

  const genreAppel = t => (/^[a-z][a-z0-9-]{0,29}$/.test(String(t ?? '')) ? String(t) : 'autre');

  /**
   * Répartiteur du service : ordre de repli de la tâche réglé dans l'Administration IA, chaque appel compté
   * (et plafonné par moteur pour les API). `discuterPour(tache, messages, options)` est aussi exposé aux autres
   * modules (traductions, section CM…) ; `options.jeu` : profil de jeu concerné (statistiques).
   */
  const repartiteur = creerRepartiteurIa({
    moteurs: { api: connecteurs.api, api2: connecteurs.api2, claude: connecteurs.claude, local: { disponible: localPret, images: false } },
    ordrePour: async tache => (await reglagesIa()).ordres[tache],
    executer: (m, tache, messages, { jeu, ...options }) => (m === 'local' ? appelLocal(genreAppel(tache), jeu, messages, options) : appelApi(m, genreAppel(tache), jeu, messages, options)),
    journal: texte => journal.warn?.(texte),
    // Tâches confidentielles (réunions, suivi, strats) : IA locale seule, sauf levée explicite par le Fondateur.
    externeAutorise: autorisationsDepuisBase(base),
  });

  /**
   * Appels au modèle d'un travail ou d'un test : `moteurs` (groupe de moteurs du travail, dans l'ordre) avec repli
   * de l'un à l'autre ; `options.cible` (test de connexion) force un moteur.
   */
  function appeleur(jeuCle, moteurs = null) {
    return (genre, messages, options = {}) => repartiteur.discuterPour(genre, messages, { ...options, ...(options.cible || !moteurs ? {} : { moteurs }), jeu: jeuCle ?? null });
  }

  /** Consignes compactes (petit modèle) quand l'IA locale est le premier moteur disponible des profils de jeu. */
  const compactPour = d => d.moteurs[0] === 'local';

  /**
   * Test de connexion d'un moteur (Administration IA), EN TÂCHE DE FOND : un modèle à raisonnement (NVIDIA) ou l'IA
   * locale (chargement du modèle) peut mettre plus d'une minute, bien au-delà du délai d'une requête de l'app (15 s)
   * et de celui du frontal de l'hébergeur : la page affichait alors « Le serveur Esport ne répond pas ». Le test est
   * lancé, la réponse attend au plus `ATTENTE_TEST_MS` (10 s) ; s'il n'est pas fini, elle rend `{ enCours: true,
   * test: { id } }` et l'app interroge `GET /jeux/ia/test/:id` (résultat gardé en base : n'importe quel processus de
   * l'app répond). Durée du test plafonnée (`PLAFOND_TEST_API_MS`, IA locale `DELAI_TEST_LOCAL_MS`).
   */
  async function testerIa(acteur, corps = {}) {
    exigerFondateur(acteur);
    const cible = MOTEURS_IA.includes(corps?.cible) ? corps.cible : undefined;
    const id = nouvelId();
    const debut = maintenant();
    const plafondMs = cible === 'local' ? DELAI_TEST_LOCAL_MS : cible ? PLAFOND_TEST_API_MS : Math.max(PLAFOND_TEST_API_MS, localPret() ? DELAI_TEST_LOCAL_MS : 0);
    const cle = `test:${id}`;
    const ecrire = async etatTest => {
      try {
        await base.executer('INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le', [cle, JSON.stringify(etatTest), iso(maintenant())]);
      } catch {
        // Base indisponible : le résultat reste dans la réponse (si elle attend), sinon le test sera déclaré expiré.
      }
    };
    // Ménage : tests de plus d'un jour.
    await base.executer("DELETE FROM ia_reglages WHERE cle LIKE 'test:%' AND maj_le < ?", [iso(debut - 86_400_000)]).catch(() => undefined);
    await ecrire({ statut: 'en_cours', cible: cible ?? null, debut: iso(debut), plafondMs });
    const calcul = testerConnexion({ appeler: appeleur(null), cible, delaiMax: PLAFOND_TEST_API_MS })
      .then(
        r => ({ statut: 'ok', ok: true, reponse: r.reponse, dureeMs: r.dureeMs, moteur: r.moteur ?? null }),
        e => {
          const refus = e?.statut === 403 || ['quota-ia', 'ia-non-configuree', 'ia-locale-absente', 'ia-locale-indisponible'].includes(e?.code);
          return { statut: refus ? 'refuse' : 'echec', ok: false, erreur: erreurPublique(e), statutHttp: e?.statut ?? null, cause: e };
        },
      )
      .then(async r => {
        const { cause, ...publie } = r;
        await ecrire({ ...publie, cible: cible ?? null, debut: iso(debut), fin: iso(maintenant()), plafondMs });
        return r;
      });
    const fini = await Promise.race([calcul, new Promise(ok => setTimeout(() => ok(null), attenteTestMs).unref?.())]);
    if (!fini) return { ok: null, enCours: true, test: { id, debutLe: iso(debut), plafondMs }, ...(cible ? { cible } : {}), etat: await etatIa(acteur) };
    if (fini.statut === 'refuse') throw fini.cause;
    return fini.ok
      ? { ok: true, reponse: fini.reponse, dureeMs: fini.dureeMs, ...(cible ? { cible } : {}), ...(fini.moteur ? { moteur: fini.moteur } : {}), etat: await etatIa(acteur) }
      : { ok: false, erreur: fini.erreur, ...(cible ? { cible } : {}), etat: await etatIa(acteur) };
  }

  /** Résultat d'un test lancé en tâche de fond (voir `testerIa`) ; un test resté « en cours » au-delà de son plafond a échoué. */
  async function etatTestIa(acteur, id) {
    exigerFondateur(acteur);
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'test-introuvable', 'Test introuvable (lancez-le à nouveau).');
    const l = await base.premier('SELECT valeur FROM ia_reglages WHERE cle = ?', [`test:${id}`]);
    const t = jsonOu(l?.valeur, null);
    if (!t) throw echec(404, 'test-introuvable', 'Test introuvable (lancez-le à nouveau).');
    const debut = Date.parse(t.debut ?? '');
    const cible = t.cible ? { cible: t.cible } : {};
    if (t.statut === 'en_cours') {
      // Processus de l'app arrêté pendant le test (redémarrage Passenger), ou moteur muet : plafond + 30 s de marge.
      if (Number.isFinite(debut) && maintenant() - debut > Number(t.plafondMs ?? PLAFOND_TEST_API_MS) + 30_000) {
        const s = Math.round((maintenant() - debut) / 1000);
        return { ok: false, enCours: false, test: { id }, erreur: { code: 'ia-test-sans-resultat', message: `Test resté sans résultat après ${s} s : le processus de l’app a sans doute été redémarré pendant le test (relancez-le ; diagnostic : esport/outils/tester-ia.mjs).` }, ...cible, etat: await etatIa(acteur) };
      }
      return { ok: null, enCours: true, test: { id, debutLe: t.debut ?? null, plafondMs: t.plafondMs ?? null }, ...cible };
    }
    if (t.ok) return { ok: true, enCours: false, test: { id }, reponse: Boolean(t.reponse), dureeMs: t.dureeMs ?? null, ...cible, ...(t.moteur ? { moteur: t.moteur } : {}), etat: await etatIa(acteur) };
    return { ok: false, enCours: false, test: { id }, erreur: t.erreur ?? { code: 'interne', message: 'Erreur interne.' }, ...cible, etat: await etatIa(acteur) };
  }

  /** `discuterPour(tache, messages, options)` du service (voir `repartiteur`). */
  const discuterPour = (tache, messages, options = {}) => repartiteur.discuterPour(tache, messages, options);

  // -------------------------------------------------------------- IA : travaux

  const travailPublic = (x, noms = {}) => ({
    id: x.id,
    genre: x.genre,
    jeu: x.jeu_cle ?? null,
    demande: jsonOu(x.demande, {}),
    statut: x.statut,
    declenchement: x.declenchement,
    resultat: x.statut === 'en_cours' ? null : jsonOu(x.resultat, null),
    sources: jsonOu(x.sources, []),
    incertitudes: jsonOu(x.incertitudes, []),
    avertissements: jsonOu(x.avertissements, []),
    erreur: jsonOu(x.erreur, null),
    // Pendant le calcul, `resultat` porte la progression (étape n/total, lecture des pages, jetons écrits).
    progression: x.statut === 'en_cours' ? (jsonOu(x.resultat, null)?.progression ?? null) : null,
    demandePar: x.demande_par ? { compte: x.demande_par, pseudo: noms[x.demande_par] ?? null } : null,
    creeLe: x.cree_le,
    majLe: x.maj_le,
    finiLe: x.fini_le ?? null,
  });

  async function ligneTravail(id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'travail-introuvable', 'Travail introuvable.');
    const x = await base.premier('SELECT * FROM ia_travaux WHERE id = ?', [id]);
    if (!x) throw echec(404, 'travail-introuvable', 'Travail introuvable.');
    return x;
  }

  /**
   * Lance un travail : après la réponse (défaut), ou attendu (tests, cron). Avec l'IA locale, un travail
   * dure plusieurs minutes : il est confié au processus de fond (lancé tout de suite ; le cron en relance
   * un si besoin) plutôt qu'à l'app Passenger, qui peut être arrêtée pendant le calcul.
   */
  async function demarrer(id, d) {
    if (d && compactPour(d) && travauxIa !== 'synchrone') {
      await lancerTravailleurLocal();
      return;
    }
    // Après le travail : distribution de ses événements (notification « brouillon prêt », « mises à jour proposées »).
    const travail = executerTravail(id)
      .then(() => distribuer(base, { maintenant: maintenant() }))
      .catch(e => journal.error('[esport] travail IA', e?.code ?? e));
    if (travauxIa === 'synchrone') await travail;
  }

  function lireUrls(v) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 5) throw echec(400, 'ia-adresse', 'Adresse refusée : seules les pages web publiques en https sont lues.');
    return v.map(u => verifierAdresseHttps(u).href);
  }

  /** `POST /jeux/ia/brouillons` : « Préparer avec l'IA » (nom du jeu, pages facultatives, consignes). */
  async function lancerBrouillon(acteur, corps) {
    await exigerGestion(acteur);
    const d = await disponibilite();
    if (!d.disponible) throw indisponible(d);
    const nom = texteNettoye(corps?.nom, 60);
    if (nom.length < 2) throw echec(400, 'nom', 'Nom du jeu : 2 caractères au moins.');
    const urls = lireUrls(corps?.urls);
    const jeu = corps?.jeu ? (await ligneJeu(corps.jeu)).cle : null;
    // Un seul brouillon à la fois pour un même jeu (en attente ou en calcul) : les autres jeux vont dans la file.
    const encours = await base.tous("SELECT id, jeu_cle, demande FROM ia_travaux WHERE genre = 'brouillon' AND (statut = 'attente' OR (statut = 'en_cours' AND maj_le >= ?))", [iso(maintenant() - EN_COURS_MUET_MS)]);
    const cle = cleDe(nom);
    if (encours.some(x => (jeu && x.jeu_cle === jeu) || cleDe(String(jsonOu(x.demande, {})?.nom ?? '')) === cle)) {
      throw echec(409, 'brouillon-en-cours', 'Un brouillon de ce jeu est déjà en préparation : attendez qu’il soit prêt (ou abandonnez-le).');
    }
    const t = maintenant();
    const id = nouvelId();
    await base.executer(
      "INSERT INTO ia_travaux (id, genre, jeu_cle, demande, statut, declenchement, demande_par, cree_le, maj_le) VALUES (?, 'brouillon', ?, ?, 'attente', 'manuel', ?, ?, ?)",
      [id, jeu, JSON.stringify({ nom, urls, consignes: texteLong(corps?.consignes, 1000) }), acteur.compte, iso(t), iso(t)],
    );
    await demarrer(id, d);
    return travail(acteur, id);
  }

  /**
   * Vérification d'un profil (mise à jour limitée) : manuelle (gestionnaire) ou automatique (cron). Plafond
   * mensuel en mode « api » seulement (l'IA locale ne coûte rien ; ses appels sont bornés en durée).
   */
  async function creerVerification(cle, { acteur = null, declenchement, sansPlafond = false }) {
    const t = maintenant();
    const id = nouvelId();
    await base.executer(
      "INSERT INTO ia_travaux (id, genre, jeu_cle, demande, statut, declenchement, demande_par, cree_le, maj_le) VALUES (?, 'verification', ?, '{}', 'attente', ?, ?, ?, ?)",
      [id, cle, declenchement, acteur, iso(t), iso(t)],
    );
    if (sansPlafond) return id;
    const { quotaVerifications } = await reglagesIa();
    const n = await base.premier("SELECT COUNT(*) AS n FROM ia_travaux WHERE genre = 'verification' AND cree_le >= ?", [debutMois(t)]);
    if (Number(n?.n ?? 0) > quotaVerifications) {
      await base.executer('DELETE FROM ia_travaux WHERE id = ?', [id]);
      throw echec(429, 'quota-verifications', 'Plafond mensuel de vérifications atteint (réglable dans Administration › IA).');
    }
    return id;
  }

  async function lancerVerification(acteur, cle) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const d = await disponibilite();
    if (!d.disponible) throw indisponible(d);
    const enCours = await base.premier("SELECT id FROM ia_travaux WHERE genre = 'verification' AND jeu_cle = ? AND statut IN ('attente', 'en_cours')", [j.cle]);
    if (enCours) return travail(acteur, enCours.id);
    const id = await creerVerification(j.cle, { acteur: acteur.compte, declenchement: 'manuel', sansPlafond: d.mode !== 'api' });
    await demarrer(id, d);
    return travail(acteur, id);
  }

  /**
   * Progression d'un brouillon en cours, notée dans `resultat` (et `maj_le`) : à chaque nouvelle étape, et au
   * plus toutes les 10 s pendant une étape. Écritures à la file (jamais deux à la fois), erreurs ignorées.
   */
  const ecrituresProgression = new Map();
  function suiviProgression(id, debut = maintenant()) {
    let derniere = 0;
    let etapeNotee = 0;
    return p => {
      const t = maintenant();
      if (p.n === etapeNotee && t - derniere < PROGRESSION_INTERVALLE_MS) return undefined;
      derniere = t;
      etapeNotee = p.n;
      const progression = { etape: p.n, etapes: p.total, cle: /^[a-z]{1,20}$/.test(p.cle ?? '') ? p.cle : null, libelle: texteNettoye(p.libelle, 60), depuis: iso(debut), ...(p.lecture ? { lecture: { total: p.lecture.total, cache: p.lecture.cache, traites: p.lecture.traites } } : {}), ...(Number.isFinite(p.ecrits) ? { ecrits: p.ecrits } : {}), le: iso(t) };
      const avant = ecrituresProgression.get(id) ?? Promise.resolve();
      const suite = avant
        .then(() => base.executer("UPDATE ia_travaux SET resultat = ?, maj_le = ? WHERE id = ? AND statut = 'en_cours'", [JSON.stringify({ progression }), iso(t), id]))
        .catch(() => undefined);
      ecrituresProgression.set(id, suite);
      return suite;
    };
  }
  /** Attend les écritures de progression d'un travail (avant d'écrire son résultat). */
  suiviProgression.fin = async id => {
    await ecrituresProgression.get(id);
    ecrituresProgression.delete(id);
  };

  /** Moteurs déjà essayés sans succès par un travail (repli vers l'IA locale confié au processus de fond). */
  const exclusDe = demande => (Array.isArray(demande?.exclus) ? demande.exclus.filter(m => MOTEURS_IA.includes(m)) : []);

  /**
   * Groupes de moteurs d'un travail, dans l'ordre de repli : les API qui se suivent forment un groupe (mêmes
   * consignes complètes, repli de l'une à l'autre à chaque appel) ; l'IA locale est un groupe à elle seule
   * (consignes compactes, brouillon en étapes). Si un groupe échoue (panne, limite de débit, plafond…), le
   * travail entier est REPRIS avec le groupe suivant.
   */
  function groupesMoteurs(ordre) {
    const groupes = [];
    for (const m of ordre) {
      const dernier = groupes.at(-1);
      if (m !== 'local' && dernier && dernier[0] !== 'local') dernier.push(m);
      else groupes.push([m]);
    }
    return groupes;
  }

  /** Le travail en attente commence-t-il par l'IA locale (donc pour le processus de fond) ? */
  const departLocal = (x, d) => d.moteurs.filter(m => !exclusDe(jsonOu(x.demande, {})).includes(m))[0] === 'local';

  async function lancerTravailleurLocal() {
    try {
      await local?.lancerTravailleur?.();
    } catch (e) {
      journal.error('[esport] IA locale : processus de fond', e?.message ?? e);
    }
  }

  /** Échec d'un travail (statut, erreur publique ; une vérification ratée compte comme faite). */
  async function echouerTravail(x, e) {
    await suiviProgression.fin(x.id);
    const t = maintenant();
    await base.executer("UPDATE ia_travaux SET statut = 'echec', resultat = NULL, erreur = ?, maj_le = ?, fini_le = ? WHERE id = ?", [JSON.stringify(erreurPublique(e)), iso(t), iso(t), x.id]);
    // Une vérification ratée compte comme faite : pas de nouvel essai toutes les 5 minutes.
    if (x.genre === 'verification') await base.executer('UPDATE jeux SET derniere_verif_le = ? WHERE cle = ?', [iso(t), x.jeu_cle]);
    if (!e?.code) journal.error('[esport] travail IA', e);
  }

  /**
   * Exécute un travail en attente (une seule fois : il est « pris » par une mise à jour conditionnelle), groupe
   * de moteurs après groupe de moteurs (voir `groupesMoteurs`). `local` : ce processus peut-il faire tourner
   * l'IA locale (processus de fond, tests) ? Sinon (app Passenger, cron), un repli vers l'IA locale remet le
   * travail en attente pour le processus de fond, avec les moteurs déjà essayés (`demande.exclus`).
   */
  async function executerTravail(id, { local: peutLocal = travauxIa === 'synchrone' } = {}) {
    const debut = maintenant();
    const pris = await base.executer("UPDATE ia_travaux SET statut = 'en_cours', maj_le = ? WHERE id = ? AND statut = 'attente'", [iso(debut), id]);
    if (pris.changements === 0) return;
    const x = await base.premier('SELECT * FROM ia_travaux WHERE id = ?', [id]);
    const demande = jsonOu(x.demande, {});
    const exclus = exclusDe(demande);
    const d = await disponibilite();
    const groupes = groupesMoteurs(d.moteurs.filter(m => !exclus.includes(m)));
    if (!groupes.length) return echouerTravail(x, indisponible(d));
    const essayes = [...exclus];
    for (const [k, groupe] of groupes.entries()) {
      const compact = groupe[0] === 'local';
      if (compact && !peutLocal) {
        // Repli vers l'IA locale : confié au processus de fond (l'app Passenger peut être arrêtée pendant le calcul).
        await suiviProgression.fin(id);
        await base.executer("UPDATE ia_travaux SET statut = 'attente', demande = ?, resultat = NULL, maj_le = ? WHERE id = ?", [JSON.stringify({ ...demande, exclus: essayes }), iso(maintenant()), id]);
        await lancerTravailleurLocal();
        return;
      }
      try {
        await executerAvec(x, demande, { moteurs: groupe, compact, debut });
        return;
      } catch (e) {
        if (k === groupes.length - 1 || !peutReplier(e)) return echouerTravail(x, e);
        essayes.push(...groupe);
        journal.warn?.(`[esport] travail IA : moteur(s) ${groupe.join(', ')} en échec (${e?.code ?? 'erreur'}) : repli sur ${groupes[k + 1].join(', ')}.`);
      }
    }
  }

  /** Le travail lui-même (brouillon ou vérification), avec un groupe de moteurs. */
  async function executerAvec(x, demande, { moteurs, compact, debut }) {
    const id = x.id;
    if (x.genre === 'brouillon') {
      const existant = x.jeu_cle ? await base.premier('SELECT * FROM jeux WHERE cle = ?', [x.jeu_cle]) : null;
      const r = await preparerBrouillon(demande, { appeler: appeleur(x.jeu_cle, moteurs), recherche: config?.recherche, ...optionsRecherche, existant: existant ? donneesDe(existant) : null, compact, etape: suiviProgression(id, debut) });
      await suiviProgression.fin(id);
      const t = maintenant();
      await base.lot([
        {
          sql: "UPDATE ia_travaux SET statut = 'pret', resultat = ?, sources = ?, incertitudes = ?, avertissements = ?, erreur = NULL, maj_le = ?, fini_le = ? WHERE id = ?",
          params: [
            JSON.stringify({ cle: existant ? existant.cle : r.brouillon.cle, nom: existant ? existant.nom : r.brouillon.nom, couleur: existant ? existant.couleur : r.brouillon.couleur, donnees: r.brouillon.donnees, pagesLues: r.pagesLues, pagesEchecs: r.pagesEchecs, version: existant ? Number(existant.version) : null }),
            JSON.stringify(r.brouillon.sources),
            JSON.stringify(r.brouillon.incertitudes),
            JSON.stringify(r.brouillon.avertissements),
            iso(t),
            iso(t),
            id,
          ],
        },
        evenement('game.draft_ready', { acteur: x.demande_par, entiteType: 'ia_travail', entiteId: id, charge: { nom: r.brouillon.nom || demande.nom, demandePar: x.demande_par }, maintenant: t }),
      ]);
      return;
    }
    // Vérification : différences proposées, enregistrées une par une (sans doublon d'une proposition en attente).
    const j = await ligneJeu(x.jeu_cle);
    const r = await verifierProfil({ nom: j.nom, donnees: donneesDe(j) }, { appeler: appeleur(j.cle, moteurs), recherche: config?.recherche, ...optionsRecherche, compact });
    const enAttente = await base.tous("SELECT section, operation, cle_element, apres FROM ia_propositions WHERE jeu_cle = ? AND statut = 'en_attente'", [j.cle]);
    const deja = new Set(enAttente.map(p => `${p.section}|${p.operation}|${p.cle_element ?? ''}|${p.apres ?? ''}`));
    const t = maintenant();
    const lot = [];
    let n = 0;
    for (const c of r.changements) {
      const apres = c.apres === null ? null : JSON.stringify(c.apres);
      if (deja.has(`${c.section}|${c.operation}|${c.cle ?? ''}|${apres ?? ''}`)) continue;
      n++;
      lot.push({
        sql: `INSERT INTO ia_propositions (id, jeu_cle, travail_id, section, operation, cle_element, avant, apres, justification, sources, confiance, version_base, statut, cree_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?)`,
        params: [nouvelId(), j.cle, id, c.section, c.operation, c.cle, c.avant === null ? null : JSON.stringify(c.avant), apres, c.justification, JSON.stringify(c.sources), c.confiance, Number(j.version), iso(t)],
      });
    }
    lot.push(
      { sql: "UPDATE ia_travaux SET statut = 'termine', resultat = ?, sources = ?, avertissements = ?, maj_le = ?, fini_le = ? WHERE id = ?", params: [JSON.stringify({ propositions: n, pagesLues: r.pagesLues, pagesEchecs: r.pagesEchecs }), JSON.stringify(r.sources), JSON.stringify(r.avertissements), iso(t), iso(t), id] },
      { sql: 'UPDATE jeux SET derniere_verif_le = ? WHERE cle = ?', params: [iso(t), j.cle] },
    );
    if (n > 0) lot.push(evenement('game.updates_proposed', { acteur: x.demande_par, entiteType: 'jeu', entiteId: j.cle, charge: { nom: j.nom, n, auto: x.declenchement === 'auto' }, maintenant: t }));
    await base.lot(lot);
  }

  async function travaux(acteur, { genre, jeu } = {}) {
    await exigerGestion(acteur);
    const conditions = [];
    const params = [];
    if (genre === 'brouillon' || genre === 'verification') {
      conditions.push('genre = ?');
      params.push(genre);
    }
    if (jeu) {
      conditions.push('jeu_cle = ?');
      params.push(String(jeu).slice(0, 40));
    }
    const condition = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lignes = await base.tous(`SELECT * FROM ia_travaux ${condition} ORDER BY cree_le DESC LIMIT 50`, params);
    const noms = await pseudosDe(base, lignes.map(l => l.demande_par).filter(Boolean));
    // Place dans la file des travaux en attente (le processus de fond les fait un par un, du plus ancien au plus récent).
    const file = await base.tous("SELECT id, statut FROM ia_travaux WHERE statut IN ('attente', 'en_cours') ORDER BY cree_le", []);
    const enCalcul = file.some(x => x.statut === 'en_cours') ? 1 : 0;
    const places = new Map(file.filter(x => x.statut === 'attente').map((x, i) => [x.id, i + 1 + enCalcul]));
    // La liste reste légère : sans le brouillon complet.
    return { travaux: lignes.map(l => ({ ...travailPublic(l, noms), resultat: undefined, ...(places.has(l.id) ? { placeFile: places.get(l.id) } : {}) })) };
  }

  async function travail(acteur, id) {
    await exigerGestion(acteur);
    const x = await ligneTravail(id);
    const noms = await pseudosDe(base, [x.demande_par].filter(Boolean));
    return travailPublic(x, noms);
  }

  /** Le Fondateur valide le brouillon (corrigé) : création du profil, ou nouvelle version du profil complété. */
  async function validerBrouillon(acteur, id, corps) {
    await exigerGestion(acteur);
    const x = await ligneTravail(id);
    if (x.genre !== 'brouillon' || x.statut !== 'pret') throw echec(409, 'travail-statut', 'Ce brouillon n’est plus à valider.');
    const fini = { sql: "UPDATE ia_travaux SET statut = 'valide', maj_le = ? WHERE id = ? AND statut = 'pret'", params: [iso(maintenant()), id] };
    if (x.jeu_cle) {
      const j = await ligneJeu(x.jeu_cle);
      const entete = validerEntete(corps, { partiel: true });
      // Le brouillon a été préparé sans les champs propres au club (images, calibrages, callouts, capacités) : ils restent.
      const { donnees } = validerDonnees(reporterChampsLocaux(donneesDe(j), validerDonnees(corps?.donnees ?? {}).donnees));
      const r = await ecrireVersion(acteur, j, { entete, donnees, versionAttendue: corps?.version, motif: 'ia-brouillon', extra: [fini] });
      if (r.inchange) await base.lot([fini]);
      return detail(acteur, j.cle);
    }
    return creerProfil(acteur, corps, { motif: 'ia-brouillon', lot: [fini] });
  }

  async function abandonnerTravail(acteur, id) {
    await exigerGestion(acteur);
    const x = await ligneTravail(id);
    if (!['attente', 'pret', 'echec'].includes(x.statut)) throw echec(409, 'travail-statut', 'Ce brouillon n’est plus à valider.');
    await base.executer("UPDATE ia_travaux SET statut = 'abandonne', maj_le = ? WHERE id = ?", [iso(maintenant()), id]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Propositions (différences)

  const propositionPublique = (p, noms = {}, jeux = new Map()) => ({
    id: p.id,
    jeu: p.jeu_cle,
    jeuNom: jeux.get(p.jeu_cle)?.nom ?? p.jeu_cle,
    section: p.section,
    operation: p.operation,
    cle: p.cle_element ?? null,
    avant: jsonOu(p.avant, null),
    apres: jsonOu(p.apres, null),
    justification: p.justification,
    sources: jsonOu(p.sources, []),
    confiance: p.confiance,
    versionBase: Number(p.version_base),
    statut: p.statut,
    motif: p.motif ?? null,
    decidePar: p.decide_par ? { compte: p.decide_par, pseudo: noms[p.decide_par] ?? null } : null,
    decideLe: p.decide_le ?? null,
    creeLe: p.cree_le,
  });

  /** Différences proposées (`statut` : en_attente par défaut, ou acceptee, refusee, obsolete, « tous »). */
  async function propositions(acteur, { jeu, statut = 'en_attente' } = {}) {
    await exigerGestion(acteur);
    const conditions = [];
    const params = [];
    if (['en_attente', 'acceptee', 'refusee', 'obsolete'].includes(statut)) {
      conditions.push('statut = ?');
      params.push(statut);
    }
    if (jeu) {
      conditions.push('jeu_cle = ?');
      params.push(String(jeu).slice(0, 40));
    }
    const condition = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lignes = await base.tous(`SELECT * FROM ia_propositions ${condition} ORDER BY cree_le DESC, section, cle_element LIMIT 300`, params);
    const noms = await pseudosDe(base, lignes.map(l => l.decide_par).filter(Boolean));
    const jeux = await nomsJeux();
    return { propositions: lignes.map(p => propositionPublique(p, noms, jeux)) };
  }

  /** Valeur corrigée par le Fondateur avant d'accepter : revalidée, clé de l'élément conservée. */
  function valeurCorrigee(p, brut) {
    try {
      if (SECTIONS_OBJETS.includes(p.section)) return lireObjet(p.section, brut);
      if (!SECTIONS_LISTES.includes(p.section) || p.operation === 'retrait') return null;
      return lireElement(p.section, { ...brut, cle: p.operation === 'modification' ? p.cle_element : (brut?.cle ?? p.cle_element) }, p.section);
    } catch (e) {
      if (!(e instanceof Invalide)) throw e;
      const err = echec(400, 'profil-invalide', 'Profil de jeu invalide.');
      err.details = { chemin: e.chemin, raison: e.raison };
      throw err;
    }
  }

  /**
   * `POST /jeux/:cle/propositions/decider` { acceptees: [id], refusees: [id], corrections: { id: valeur } } :
   * chaque proposition est acceptée ou refusée INDIVIDUELLEMENT ; les acceptées s'appliquent au profil
   * courant (une seule nouvelle version) ; celles qui ne s'appliquent plus deviennent « obsolètes ».
   */
  async function deciderPropositions(acteur, cle, corps) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const ids = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && MOTIF_UUID.test(x)))].slice(0, 300) : []);
    const acceptees = ids(corps?.acceptees);
    const refusees = ids(corps?.refusees).filter(x => !acceptees.includes(x));
    if (acceptees.length + refusees.length === 0) throw echec(400, 'propositions', 'Aucun changement choisi.');
    const toutes = await base.tous(`SELECT * FROM ia_propositions WHERE jeu_cle = ? AND statut = 'en_attente'`, [cle]);
    const parId = new Map(toutes.map(p => [p.id, p]));
    const corrections = corps?.corrections && typeof corps.corrections === 'object' ? corps.corrections : {};
    let donnees = donneesDe(j);
    const appliquees = [];
    const obsoletes = [];
    for (const id of acceptees) {
      const p = parId.get(id);
      if (!p) continue;
      const apres = corrections[id] !== undefined ? valeurCorrigee(p, corrections[id]) : jsonOu(p.apres, null);
      try {
        donnees = appliquerChangement(donnees, { section: p.section, operation: p.operation, cle: p.operation === 'ajout' ? (apres?.cle ?? p.cle_element) : p.cle_element, apres });
        appliquees.push({ id, apres });
      } catch (e) {
        if (e?.code !== 'proposition-obsolete' && e?.code !== 'profil-invalide') throw e;
        obsoletes.push(id);
      }
    }
    const t = maintenant();
    const decisions = [
      ...appliquees.map(a => ({ sql: "UPDATE ia_propositions SET statut = 'acceptee', apres = ?, decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'en_attente'", params: [a.apres === null ? null : JSON.stringify(a.apres), acteur.compte, iso(t), a.id] })),
      ...refusees.filter(id => parId.has(id)).map(id => ({ sql: "UPDATE ia_propositions SET statut = 'refusee', decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'en_attente'", params: [acteur.compte, iso(t), id] })),
      ...obsoletes.map(id => ({ sql: "UPDATE ia_propositions SET statut = 'obsolete', motif = 'ne-s-applique-plus', decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'en_attente'", params: [acteur.compte, iso(t), id] })),
    ];
    if (appliquees.length > 0) {
      const r = await ecrireVersion(acteur, j, { donnees, motif: 'ia-maj', extra: decisions, versionAttendue: Number(j.version) });
      if (r.inchange && decisions.length) await base.lot(decisions);
    } else if (decisions.length) await base.lot(decisions);
    return { acceptees: appliquees.length, refusees: refusees.filter(id => parId.has(id)).length, obsoletes: obsoletes.length, jeu: await detail(acteur, cle) };
  }

  // -------------------------------------------------------------- Cron

  /**
   * Tâche planifiée : reprend les travaux restés en attente (processus arrêté), marque en échec ceux
   * bloqués « en cours », puis lance AU PLUS une vérification automatique due (profil actif, mise à jour
   * automatique activée, plafond mensuel non atteint). Rend un petit bilan.
   *
   * L'IA locale ne tourne que dans le PROCESSUS DE FOND (esport/serveur/ia-locale/travailleur.mjs,
   * `executionLocale: true`, sans attendre : `reprise` immédiate) : le cron fait les travaux qui commencent par
   * une API, et rend `{ raison: 'ia-locale', aFaire }` s'il en reste pour l'IA locale (il lance alors le processus
   * de fond). IA locale en tête de l'ordre : le cron ne fait que le ménage.
   */
  async function tacheCron({ limite = 1, executionLocale = false } = {}) {
    const t = maintenant();
    await base.executer("UPDATE ia_travaux SET statut = 'echec', erreur = ?, maj_le = ?, fini_le = ? WHERE statut = 'en_cours' AND maj_le < ?", [JSON.stringify({ code: 'interrompu', message: 'Travail interrompu.' }), iso(t), iso(t), iso(t - dureeEnCoursMax)]);
    // Compteur d'usage : les appels de plus de 13 mois ne servent plus (plafonds mensuels).
    await base.executer('DELETE FROM ia_appels WHERE cree_le < ?', [iso(t - 400 * 86_400_000)]);
    const d = await disponibilite();
    if (!d.disponible) return { n: 0, raison: d.raison };
    const locale = compactPour(d);
    const reglages = await reglagesIa();
    const candidatsDus = async () => {
      if (!reglages.autoActif) return [];
      const c = (await base.tous("SELECT * FROM jeux WHERE statut = 'actif' AND maj_auto = 1 ORDER BY cle", [])).filter(j => verificationDue(j, t));
      c.sort((a, b) => String(a.derniere_verif_le ?? a.cree_le).localeCompare(String(b.derniere_verif_le ?? b.cree_le)));
      return c;
    };
    const attente = await base.tous("SELECT id, demande, cree_le FROM ia_travaux WHERE statut = 'attente' ORDER BY cree_le", []);
    const pourLocal = attente.filter(x => departLocal(x, d));
    // Travaux de CE processus : ceux de l'IA locale (processus de fond, tout de suite), ou ceux d'une API (cron, après 2 min).
    const reprise = executionLocale ? iso(t + 1) : iso(t - ATTENTE_REPRISE_MS);
    const enAttente = attente.filter(x => departLocal(x, d) === executionLocale && x.cree_le < reprise).slice(0, 2);
    if (!executionLocale && locale) {
      for (const { id } of enAttente) await executerTravail(id, { local: false });
      const aFaire = pourLocal.length + Math.min(limite, (await candidatsDus()).length);
      return { n: 0, raison: 'ia-locale', aFaire, ...(enAttente.length ? { repris: enAttente.length } : {}) };
    }
    if (executionLocale && !locale && !enAttente.length) return { n: 0, raison: 'mode-api' };
    for (const { id } of enAttente) await executerTravail(id, { local: executionLocale });
    // Un processus de fond dont l'IA locale n'est pas en tête : seulement les replis vers elle, pas de vérification automatique.
    if (executionLocale && !locale) return { n: enAttente.length, repris: enAttente.length };
    // Travaux laissés à l'IA locale (repli d'une API en échec) : le cron le dit, et lance le processus de fond.
    const bilan = async r => {
      if (executionLocale) return r;
      const restants = (await base.tous("SELECT id, demande FROM ia_travaux WHERE statut = 'attente'", [])).filter(x => departLocal(x, d)).length;
      return restants ? { ...r, raison: 'ia-locale', aFaire: restants } : r;
    };
    if (!reglages.autoActif) return bilan({ n: executionLocale ? enAttente.length : 0, repris: enAttente.length, raison: 'auto-desactive' });
    let n = 0;
    for (const j of (await candidatsDus()).slice(0, limite)) {
      const occupe = await base.premier("SELECT id FROM ia_travaux WHERE genre = 'verification' AND jeu_cle = ? AND statut IN ('attente', 'en_cours')", [j.cle]);
      if (occupe) continue;
      let id;
      try {
        id = await creerVerification(j.cle, { declenchement: 'auto', sansPlafond: d.mode !== 'api' });
      } catch (e) {
        if (e?.code === 'quota-verifications') return bilan({ n: n + (executionLocale ? enAttente.length : 0), repris: enAttente.length, raison: 'quota' });
        throw e;
      }
      await executerTravail(id, { local: executionLocale });
      n++;
    }
    return bilan({ n: n + (executionLocale ? enAttente.length : 0), repris: enAttente.length });
  }

  return {
    peutGerer,
    liste,
    detail,
    pourTeam,
    deposerImage,
    importerCartes,
    servirImage: images.servir,
    creer,
    modifier,
    archiver,
    supprimer,
    versions,
    version,
    restaurer,
    reglerMaj,
    gestionnaires,
    reglerGestionnaires,
    etatIa,
    reglerIa,
    testerIa,
    etatTestIa,
    discuterPour,
    // Fournisseur d'une API (nvidia, mistral…), jamais la clé : mention « Texte envoyé à l'IA (…) » de l'assistant d'écriture.
    fournisseurDe: m => (m === 'api' || m === 'api2' ? (configs[m]?.fournisseur ?? null) : null),
    lancerBrouillon,
    lancerVerification,
    executerTravail,
    travaux,
    travail,
    validerBrouillon,
    abandonnerTravail,
    propositions,
    deciderPropositions,
    tacheCron,
  };
}
