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
 * Deux moteurs, choisis par le Fondateur (Administration IA, réglage `mode`) :
 *  - « api » : clé d'API d'un fournisseur (plafond mensuel d'appels) ;
 *  - « local » : IA LOCALE (llama.cpp sur le serveur, `ia.local`), sans plafond mensuel mais une requête à
 *    la fois, durée bornée ; ses travaux longs tournent dans un processus de fond (lancé tout de suite, et
 *    par le cron en secours), pas dans l'app Passenger qui peut être endormie à tout moment ;
 *  - « local-api » : locale d'abord, l'API en secours si l'IA locale échoue (démarrage, délai, occupée…).
 */

import { distribuer, evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { creerConnecteur } from '../ia/connecteur.mjs';
import { preparerBrouillon, testerConnexion, verifierProfil } from '../ia/assistant.mjs';
import { verifierAdresseHttps } from '../ia/recherche.mjs';
import { appliquerChangement, resumeDifferences } from './differences.mjs';
import { MOTIF_CLE_JEU, SECTIONS_LISTES, SECTIONS_OBJETS, Invalide, libelleFormat, lireElement, lireObjet, validerDonnees, validerEntete } from './schema.mjs';

export const PERMISSION_JEUX = 'jeux.gerer';
export const PERMISSIONS_GLOBALES = [PERMISSION_JEUX];
export const REGLAGES_IA_DEFAUT = { quotaAppels: 30, quotaVerifications: 8, autoActif: true };
export const MODES_IA = ['local', 'api', 'local-api'];
const ORDRE_MODE = { local: ['local'], api: ['api'], 'local-api': ['local', 'api'] };
const DELAI_TEST_LOCAL_MS = 4 * 60_000;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const DUREE_EN_COURS_MAX_MS = 15 * 60_000;
const ATTENTE_REPRISE_MS = 2 * 60_000;

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
  if (acteur?.superAdmin) return true;
  if (!acteur?.compte) return false;
  return Boolean(await base.premier('SELECT compte_id FROM permissions_globales WHERE compte_id = ? AND permission = ?', [acteur.compte, PERMISSION_JEUX]));
}

/**
 * `ia` : { config (configIa), fetch, telecharger, resoudre, local } ; `local` (IA locale, facultatif) :
 * { connecteur (creerConnecteurLocal), disponible(), raison, info: { modele, nomModele, moteur, threads,
 * contexte, delaiMs, benchmark }, etat() (en marche, dernière vitesse…), lancerTravailleur() }.
 */
export function servicesJeux({ base, maintenant = () => Date.now(), socle, ia = {}, travauxIa = 'fond', journal = console }) {
  const config = ia.config ?? null;
  const connecteur = creerConnecteur(config, { ...(ia.fetch ? { fetch: ia.fetch } : {}), maintenant });
  const local = ia.local ?? null;
  const localPret = () => Boolean(local?.disponible?.() && local.connecteur);
  const optionsRecherche = { telecharger: ia.telecharger, resoudre: ia.resoudre, maintenant };
  // Un travail local (deux requêtes de 20 min au plus) dure plus longtemps qu'un appel d'API.
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
    };
  }

  const entetePublic = j => ({ cle: j.cle, nom: j.nom, couleur: j.couleur, icone: j.icone ?? null, base: j.base ?? null, statut: j.statut, version: Number(j.version) });

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
  async function detail(acteur, cle) {
    const j = await ligneJeu(cle);
    const gerer = await peutGerer(acteur);
    if (j.statut !== 'actif' && !gerer) throw echec(404, 'jeu-introuvable', 'Jeu introuvable.');
    const sortie = { ...entetePublic(j), donnees: donneesDe(j) };
    if (!gerer) return sortie;
    const teams = await teamsParJeu();
    const attente = await base.premier("SELECT COUNT(*) AS n FROM ia_propositions WHERE jeu_cle = ? AND statut = 'en_attente'", [cle]);
    return { ...sortie, gerer: true, teams: teams.get(cle) ?? 0, propositions: Number(attente?.n ?? 0), majAuto: Number(j.maj_auto) === 1, frequenceJours: Number(j.frequence_jours), derniereVerif: j.derniere_verif_le ?? null, majLe: j.maj_le, majPar: j.maj_par ?? null };
  }

  /** `GET /teams/:id/jeu` : profil du jeu de la team (tout membre), même archivé. */
  async function pourTeam(acteur, teamId) {
    const ctx = await socle.contexteTeam(acteur, teamId);
    const j = await base.premier('SELECT * FROM jeux WHERE cle = ?', [ctx.team.jeu]);
    if (!j) return { cle: ctx.team.jeu, nom: ctx.team.jeu, couleur: '#8b8b9a', icone: null, base: ctx.team.jeu === 'valorant' ? 'valorant' : null, statut: 'actif', version: 0, donnees: validerDonnees({}).donnees };
    return { ...entetePublic(j), donnees: donneesDe(j) };
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
        sql: `INSERT INTO jeux (cle, nom, couleur, icone, base, statut, donnees, version, maj_auto, frequence_jours, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, NULL, 'actif', ?, 1, 1, 7, ?, ?, ?, ?)`,
        params: [j.cle, j.nom, j.couleur, j.icone, JSON.stringify(donnees), acteur.compte, iso(t), acteur.compte, iso(t)],
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
    const resume = resumeDifferences(avant, apres);
    for (const champ of ['nom', 'couleur', 'icone']) if ((nouveau[champ] ?? null) !== (j[champ] ?? null)) resume[champ] = true;
    if (Object.keys(resume).length === 0) return { inchange: true };
    const t = maintenant();
    const version = Number(j.version) + 1;
    const [maj] = await base.lot([
      {
        sql: 'UPDATE jeux SET nom = ?, couleur = ?, icone = ?, donnees = ?, version = ?, maj_par = ?, maj_le = ? WHERE cle = ? AND version = ?',
        params: [nouveau.nom, nouveau.couleur, nouveau.icone, JSON.stringify(apres), version, acteur.compte, iso(t), j.cle, Number(j.version)],
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
    await base.lot([
      { sql: 'DELETE FROM ia_propositions WHERE jeu_cle = ?', params: [cle] },
      { sql: "UPDATE ia_travaux SET statut = 'abandonne', maj_le = ? WHERE jeu_cle = ? AND statut IN ('attente', 'pret')", params: [iso(t), cle] },
      { sql: 'DELETE FROM jeu_versions WHERE jeu_cle = ?', params: [cle] },
      { sql: 'DELETE FROM jeux WHERE cle = ?', params: [cle] },
      evenement('game.deleted', { acteur: acteur.compte, entiteType: 'jeu', entiteId: cle, charge: { nom: j.nom }, maintenant: t }),
    ]);
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

  async function reglagesIa() {
    const lignes = await base.tous('SELECT cle, valeur FROM ia_reglages', []);
    const r = { ...REGLAGES_IA_DEFAUT };
    for (const l of lignes) {
      if (l.cle === 'quota_appels') r.quotaAppels = Number(l.valeur);
      if (l.cle === 'quota_verifications') r.quotaVerifications = Number(l.valeur);
      if (l.cle === 'auto_actif') r.autoActif = l.valeur === '1';
      if (l.cle === 'mode' && MODES_IA.includes(l.valeur)) r.mode = l.valeur;
    }
    r.mode ??= MODES_IA.includes(config?.modeDefaut) ? config.modeDefaut : 'api';
    return r;
  }

  /** Moteurs utilisables pour un mode, dans l'ordre d'essai. */
  const moteursDe = mode => ORDRE_MODE[mode].filter(f => (f === 'local' ? localPret() : connecteur.disponible()));

  /** L'assistant peut-il travailler ? `{ disponible, raison, mode, moteurs }` (raison : de quoi il manque). */
  async function disponibilite() {
    const { mode } = await reglagesIa();
    const moteurs = moteursDe(mode);
    let raison = null;
    if (!moteurs.length) raison = mode === 'api' ? (config?.raison ?? 'cle-absente') : (local?.raison ?? 'locale-absente');
    return { disponible: moteurs.length > 0, raison, mode, moteurs };
  }

  /** Erreur « assistant indisponible », adaptée au mode (clé absente / IA locale absente). */
  const indisponible = d => (d.mode === 'api' ? echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).') : echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).'));

  // Les plafonds mensuels portent sur les appels à l'API EXTERNE : les appels à l'IA locale ne comptent pas.
  const SQL_APPELS_API = "SELECT COUNT(*) AS n FROM ia_appels WHERE cree_le >= ? AND (fournisseur IS NULL OR fournisseur <> 'local')";

  async function usageMois(t = maintenant()) {
    const depuis = debutMois(t);
    const appels = await base.premier(SQL_APPELS_API, [depuis]);
    const locaux = await base.premier("SELECT COUNT(*) AS n FROM ia_appels WHERE cree_le >= ? AND fournisseur = 'local'", [depuis]);
    const verifs = await base.premier("SELECT COUNT(*) AS n FROM ia_travaux WHERE genre = 'verification' AND cree_le >= ?", [depuis]);
    return { mois: depuis.slice(0, 7), appels: Number(appels?.n ?? 0), appelsLocaux: Number(locaux?.n ?? 0), verifications: Number(verifs?.n ?? 0) };
  }

  /** État de l'IA locale pour l'Administration IA (installation, moteur en marche, mesures). */
  async function etatLocal() {
    if (!local) return { installe: false, raison: 'non-installee' };
    const dernier = await base.premier("SELECT cree_le, duree_ms, statut FROM ia_appels WHERE fournisseur = 'local' AND statut = 'ok' ORDER BY cree_le DESC LIMIT 1", []);
    let marche = {};
    try {
      marche = local.etat?.() ?? {};
    } catch {
      marche = {};
    }
    const info = local.info ?? {};
    const mesure = marche.mesure && Number.isFinite(marche.mesure.jetonsParSeconde) ? { jetonsParSeconde: marche.mesure.jetonsParSeconde, le: marche.mesure.le ?? null, source: 'requete' } : null;
    const banc = info.benchmark && Number.isFinite(info.benchmark.jetonsParSeconde) ? { jetonsParSeconde: info.benchmark.jetonsParSeconde, le: info.benchmark.le ?? null, source: 'test' } : null;
    return {
      installe: localPret(),
      raison: localPret() ? null : (local.raison ?? 'non-installee'),
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

  async function etatIa(acteur) {
    await exigerGestion(acteur);
    const reglages = await reglagesIa();
    const usage = await usageMois();
    const dernier = await base.premier("SELECT * FROM ia_appels WHERE statut <> 'en_cours' ORDER BY cree_le DESC LIMIT 1", []);
    const travaux = await base.tous("SELECT id, genre, jeu_cle, statut, declenchement, erreur, cree_le, fini_le FROM ia_travaux WHERE genre = 'verification' ORDER BY cree_le DESC LIMIT 10", []);
    return {
      ...(config ? config.etatPublic() : { configure: false, raison: 'cle-absente', fournisseur: null, modele: null, hote: null, format: 'openai-chat', recherche: 'serveur', cle: 'absente' }),
      disponible: (await disponibilite()).disponible,
      mode: reglages.mode,
      modesPossibles: MODES_IA.filter(m => ORDRE_MODE[m].every(f => (f === 'local' ? localPret() : connecteur.disponible()))),
      local: await etatLocal(),
      lectureWeb: typeof ia.telecharger === 'function',
      fondateur: Boolean(acteur.superAdmin),
      reglages,
      usage: { ...usage, plafondAppels: reglages.quotaAppels, plafondVerifications: reglages.quotaVerifications },
      dernierAppel: dernier ? { le: dernier.cree_le, genre: dernier.genre, statut: dernier.statut, fournisseur: dernier.fournisseur ?? null, modele: dernier.modele ?? null, dureeMs: dernier.duree_ms === null ? null : Number(dernier.duree_ms), erreur: dernier.erreur ?? null, jeu: dernier.jeu_cle ?? null } : null,
      verifications: travaux.map(x => ({ id: x.id, jeu: x.jeu_cle, statut: x.statut, declenchement: x.declenchement, erreur: jsonOu(x.erreur, null), le: x.cree_le, finiLe: x.fini_le ?? null })),
    };
  }

  async function reglerIa(acteur, corps) {
    exigerFondateur(acteur);
    const t = iso(maintenant());
    const lot = [];
    const poser = (cle, valeur) => lot.push({ sql: 'INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le', params: [cle, valeur, t] });
    if (corps?.quotaAppels !== undefined) {
      const n = Number(corps.quotaAppels);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) throw echec(400, 'quota', 'Plafond : un nombre entier de 0 à 10 000.');
      poser('quota_appels', String(n));
    }
    if (corps?.quotaVerifications !== undefined) {
      const n = Number(corps.quotaVerifications);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) throw echec(400, 'quota', 'Plafond : un nombre entier de 0 à 10 000.');
      poser('quota_verifications', String(n));
    }
    if (corps?.autoActif !== undefined) poser('auto_actif', corps.autoActif ? '1' : '0');
    if (corps?.mode !== undefined) {
      if (!MODES_IA.includes(corps.mode)) throw echec(400, 'mode-ia', 'Mode de l’IA inconnu (local, api ou local-api).');
      poser('mode', corps.mode);
    }
    if (lot.length) await base.lot(lot);
    return etatIa(acteur);
  }

  /**
   * Appel à l'API EXTERNE, compté et plafonné : la ligne `ia_appels` est écrite AVANT l'appel, puis on
   * compte les appels d'API du mois (elle comprise) ; au-delà du plafond, elle est retirée et l'appel refusé (429).
   */
  async function appelApi(genre, jeuCle, messages, options) {
    const t = maintenant();
    const id = nouvelId();
    await base.executer("INSERT INTO ia_appels (id, genre, jeu_cle, statut, fournisseur, modele, cree_le) VALUES (?, ?, ?, 'en_cours', ?, ?, ?)", [id, genre, jeuCle ?? null, config.fournisseur, config.modele, iso(t)]);
    const { quotaAppels } = await reglagesIa();
    const n = await base.premier(SQL_APPELS_API, [debutMois(t)]);
    if (Number(n?.n ?? 0) > quotaAppels) {
      await base.executer('DELETE FROM ia_appels WHERE id = ?', [id]);
      throw echec(429, 'quota-ia', 'Plafond mensuel d’appels à l’IA atteint (réglable dans Administration › IA).');
    }
    return suivre(id, t, () => connecteur.discuter(messages, options));
  }

  /** Appel à l'IA LOCALE : noté (statistiques, dernier temps de réponse) mais pas plafonné au mois. */
  async function appelLocal(genre, jeuCle, messages, options) {
    const t = maintenant();
    const id = nouvelId();
    await base.executer("INSERT INTO ia_appels (id, genre, jeu_cle, statut, fournisseur, modele, cree_le) VALUES (?, ?, ?, 'en_cours', 'local', ?, ?)", [id, genre, jeuCle ?? null, local.info?.modele ?? null, iso(t)]);
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

  /**
   * Appel au modèle selon le mode : IA locale, API, ou locale d'abord puis l'API en secours si la locale
   * échoue (démarrage impossible, délai, occupée, réponse illisible…). `options.cible` (test de connexion)
   * force l'un des deux.
   */
  function appeleur(jeuCle) {
    return async (genre, messages, options = {}) => {
      const { cible, ...reste } = options;
      const d = await disponibilite();
      const moteurs = cible ? (ORDRE_MODE[cible] ? [cible].filter(f => (f === 'local' ? localPret() : connecteur.disponible())) : []) : d.moteurs;
      if (!moteurs.length) throw cible === 'local' || (!cible && d.mode !== 'api') ? indisponible({ mode: 'local' }) : indisponible({ mode: 'api' });
      for (let i = 0; i < moteurs.length; i++) {
        try {
          return await (moteurs[i] === 'local' ? appelLocal : appelApi)(genre, jeuCle, messages, reste);
        } catch (e) {
          const secours = moteurs[i] === 'local' && i < moteurs.length - 1 && (e?.statut ?? 500) >= 500;
          if (!secours) throw e;
          journal.warn?.(`[esport] IA locale en échec (${e?.code ?? 'erreur'}) : la clé d’API prend le relais.`);
        }
      }
      throw indisponible(d);
    };
  }

  /** Consignes compactes (petit modèle) dès que l'IA locale peut répondre. */
  const compactPour = d => d.moteurs.includes('local');

  async function testerIa(acteur, corps = {}) {
    exigerFondateur(acteur);
    const cible = ['local', 'api'].includes(corps?.cible) ? corps.cible : undefined;
    try {
      const r = await testerConnexion({ appeler: appeleur(null), cible });
      return { ok: true, reponse: r.reponse, dureeMs: r.dureeMs, ...(cible ? { cible } : {}), etat: await etatIa(acteur) };
    } catch (e) {
      if (e?.statut === 403 || e?.code === 'quota-ia' || e?.code === 'ia-non-configuree' || e?.code === 'ia-locale-absente') throw e;
      return { ok: false, erreur: erreurPublique(e), ...(cible ? { cible } : {}), etat: await etatIa(acteur) };
    }
  }

  // -------------------------------------------------------------- IA : travaux

  const travailPublic = (x, noms = {}) => ({
    id: x.id,
    genre: x.genre,
    jeu: x.jeu_cle ?? null,
    demande: jsonOu(x.demande, {}),
    statut: x.statut,
    declenchement: x.declenchement,
    resultat: jsonOu(x.resultat, null),
    sources: jsonOu(x.sources, []),
    incertitudes: jsonOu(x.incertitudes, []),
    avertissements: jsonOu(x.avertissements, []),
    erreur: jsonOu(x.erreur, null),
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
      try {
        await local.lancerTravailleur?.();
      } catch (e) {
        journal.error('[esport] IA locale : processus de fond', e?.message ?? e);
      }
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

  /** Exécute un travail en attente (une seule fois : il est « pris » par une mise à jour conditionnelle). */
  async function executerTravail(id) {
    const debut = maintenant();
    const pris = await base.executer("UPDATE ia_travaux SET statut = 'en_cours', maj_le = ? WHERE id = ? AND statut = 'attente'", [iso(debut), id]);
    if (pris.changements === 0) return;
    const x = await base.premier('SELECT * FROM ia_travaux WHERE id = ?', [id]);
    const demande = jsonOu(x.demande, {});
    const compact = compactPour(await disponibilite());
    try {
      if (x.genre === 'brouillon') {
        const existant = x.jeu_cle ? await base.premier('SELECT * FROM jeux WHERE cle = ?', [x.jeu_cle]) : null;
        const r = await preparerBrouillon(demande, { appeler: appeleur(x.jeu_cle), recherche: config?.recherche, ...optionsRecherche, existant: existant ? donneesDe(existant) : null, compact });
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
      const r = await verifierProfil({ nom: j.nom, donnees: donneesDe(j) }, { appeler: appeleur(j.cle), recherche: config?.recherche, ...optionsRecherche, compact });
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
    } catch (e) {
      const t = maintenant();
      await base.executer("UPDATE ia_travaux SET statut = 'echec', erreur = ?, maj_le = ?, fini_le = ? WHERE id = ?", [JSON.stringify(erreurPublique(e)), iso(t), iso(t), id]);
      // Une vérification ratée compte comme faite : pas de nouvel essai toutes les 5 minutes.
      if (x.genre === 'verification') await base.executer('UPDATE jeux SET derniere_verif_le = ? WHERE cle = ?', [iso(t), x.jeu_cle]);
      if (!e?.code) journal.error('[esport] travail IA', e);
    }
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
    // La liste reste légère : sans le brouillon complet.
    return { travaux: lignes.map(l => ({ ...travailPublic(l, noms), resultat: undefined })) };
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
      const { donnees } = validerDonnees(corps?.donnees ?? {});
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
   * Avec l'IA locale (mode « local » ou « local-api ») : le cron ne fait que le ménage et rend
   * `{ raison: 'ia-locale', aFaire }` ; c'est le PROCESSUS DE FOND (esport/serveur/ia-locale/travailleur.mjs,
   * `executionLocale: true`) qui exécute les travaux, sans attendre (`reprise` immédiate).
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
    if (locale && !executionLocale) {
      const attente = await base.premier("SELECT COUNT(*) AS n FROM ia_travaux WHERE statut = 'attente'", []);
      const aFaire = Number(attente?.n ?? 0) + Math.min(limite, (await candidatsDus()).length);
      return { n: 0, raison: 'ia-locale', aFaire };
    }
    if (!locale && executionLocale) return { n: 0, raison: 'mode-api' };
    const reprise = executionLocale ? iso(t + 1) : iso(t - ATTENTE_REPRISE_MS);
    const enAttente = await base.tous("SELECT id FROM ia_travaux WHERE statut = 'attente' AND cree_le < ? ORDER BY cree_le LIMIT 2", [reprise]);
    for (const { id } of enAttente) await executerTravail(id);
    if (!reglages.autoActif) return { n: executionLocale ? enAttente.length : 0, repris: enAttente.length, raison: 'auto-desactive' };
    let n = 0;
    for (const j of (await candidatsDus()).slice(0, limite)) {
      const occupe = await base.premier("SELECT id FROM ia_travaux WHERE genre = 'verification' AND jeu_cle = ? AND statut IN ('attente', 'en_cours')", [j.cle]);
      if (occupe) continue;
      let id;
      try {
        id = await creerVerification(j.cle, { declenchement: 'auto', sansPlafond: d.mode !== 'api' });
      } catch (e) {
        if (e?.code === 'quota-verifications') return { n: n + (executionLocale ? enAttente.length : 0), repris: enAttente.length, raison: 'quota' };
        throw e;
      }
      await executerTravail(id);
      n++;
    }
    return { n: n + (executionLocale ? enAttente.length : 0), repris: enAttente.length };
  }

  return {
    peutGerer,
    liste,
    detail,
    pourTeam,
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
