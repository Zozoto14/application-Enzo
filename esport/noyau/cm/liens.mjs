/**
 * Liens utiles de l'équipe CM (migration 0044, onglet DATA › Ressources de l'espace CM ; docs/esport/cm.md, partie
 * « Ressources »). Portée : le club, avec un rattachement facultatif à une team. Le module « Ressources » des teams
 * (esport/noyau/ressources/) est lié à une team, à ses rôles et à sa file de validation : on n'en réutilise que la
 * validation d'adresse protégée (apercu.mjs : adresses publiques seulement), pas ses tables.
 *
 * Liaisons (plusieurs-à-plusieurs, `cm_lien_liaisons`) : un lien se lie à des cartes des tableaux CM et à des dossiers du
 * Drive CM. On ne voit (et on ne compte) que les cibles accessibles ; lier ou délier demande `cm.editer` du club et le droit
 * d'écrire sur la cible (`cm.editer` de la portée du tableau ; envoyer ou gérer dans le Drive).
 *
 * Droits (aucune nouvelle permission) :
 *  - lire : `cm.voir` (club ou d'une team) ; un lien rattaché à une team n'est visible que de qui a `cm.voir` du
 *    club ou de cette team ; un lien du club l'est de tout lecteur ;
 *  - ajouter, modifier, épingler, ordonner : `cm.editer` du club ;
 *  - supprimer : `cm.gerer` du club.
 * Qui voit la ressource (migration 0048, liensAcces.mjs) : « toute l'équipe CM » (défaut) ou RESTREINTE aux personnes et
 * rôles choisis (« peut voir » : lecture seule ; « peut modifier » : les permissions ci-dessus) ; le créateur et le Fondateur
 * la voient toujours. Réglage (`/cm/liens/:id/acces`) : le créateur, `cm.gerer` (au niveau « peut modifier ») et le
 * Fondateur. « Partager avec… » (`/cm/liens/:id/partage`) : donne l'accès aux personnes choisies, les notifie et affiche
 * « Nouveau » chez elles jusqu'à l'ouverture (`cm_lien_partages.vu_le`). Contrôlé partout : liste, « où est-il lié »,
 * cartes et dossiers liés, écritures, état (compteur), journal, notifications (acces.mjs, centre.mjs) ; une ressource
 * restreinte supprimée est effacée du fil, des notifications et des détails du journal.
 * Une adresse est toujours en https, sans identifiants, vers un hôte public ; elle est enregistrée normalisée.
 * Aucun aperçu n'est récupéré (pas de requête sortante) : le domaine s'affiche, l'icône est locale.
 *
 * FICHIERS (migration 0051, `genre` 'fichier') : une ressource peut être un fichier, au lieu d'une adresse. Le stockage
 * est celui du Drive (drive/service.mjs) :
 *  - envoyé depuis Ressources (`source` 'envoi', portée d'envoi « ressources », `cm.editer` du club) : rangé dans le
 *    dossier système « Ressources » du Drive du club (restreint) et marqué comme appartenant à la ressource ; seuls ceux
 *    qui voient la ressource le voient (dans le Drive aussi) ; versions, quota et corbeille du Drive ;
 *  - choisi dans un Drive (`source` 'drive') : simple référence, rien n'est copié ; la ressource suit sa source : qui la
 *    voit sans voir le fichier dans son Drive lit « Fichier d'un Drive auquel vous n'avez pas accès » (ni nom, ni lien).
 * Aperçu et téléchargement par lien signé (`/cm/liens/contenu/<ressource>.<version>`, 2 h) : chaque lecture revérifie la
 * visibilité de la ressource ET l'accès au fichier source. Suppression d'une ressource ouverte : son fichier envoyé part à
 * la corbeille du Drive ; d'une ressource restreinte : il est effacé tout de suite.
 */

import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { cheminSigne, verifierLien } from '../fichiers.mjs';
import { reponseFichierStocke } from '../medias/lecture.mjs';
import { DUREE_LIEN_DRIVE_MS, VIGNETTE_TAILLE_MAX } from './drive/regles.mjs';
import { verifierAdresse } from '../ressources/apercu.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { GENRES_ACCES, MAX_REGLES_ACCES, NIVEAUX_ACCES, lecteurTableaux, permissionsAuNiveau } from './acces.mjs';
import { ACCES_LIEN, lecteurLiens, lienRestreint, niveauxLien, voitPortee } from './liensAcces.mjs';
import { MODULE_CM, PORTEE_CLUB, comptesClubAvec, comptesTeamAvec, contexteCm, exiger, exigerUuid, permissionsSur, porteesDe } from './commun.mjs';

export const LIENS_MAX = 500;
export const TITRE_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const CATEGORIE_MAX = 40;
export const URL_MAX = 2048;
export const GENRES_LIAISON = Object.freeze(['carte', 'dossier']);
export const PARTAGE_MAX = 50;
const AUTORISES_AFFICHES = 6;
export const GENRES_RESSOURCE = Object.freeze(['lien', 'fichier']);
/** Formats affichés en vignette (balise <img>) : comme le Drive. */
const FORMATS_VIGNETTE = ['png', 'jpeg', 'gif', 'webp', 'svg', 'avif'];
const MOTIF_CONTENU = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,6})$/;

/** Adresse saisie → `{ url, hote }` (https, hôte public, sans identifiants) ou erreur 400 `url`. */
export function validerLien(brut) {
  const refus = () => echec(400, 'url', 'Adresse invalide : un lien https vers un site public est attendu.');
  const texte = String(brut ?? '').trim();
  if (!texte || texte.length > URL_MAX) throw refus();
  let url;
  try {
    url = verifierAdresse(texte);
  } catch {
    throw refus();
  }
  if (url.protocol !== 'https:') throw refus();
  url.hash = url.hash === '#' ? '' : url.hash;
  return { url: url.href, hote: url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') };
}

const publier = (l, teams) => ({
  id: l.id,
  genre: l.genre === 'fichier' ? 'fichier' : 'lien',
  titre: l.titre,
  url: l.genre === 'fichier' ? '' : l.url,
  hote: l.genre === 'fichier' ? '' : l.hote,
  description: l.description ?? '',
  categorie: l.categorie ?? null,
  epingle: Number(l.epingle) === 1,
  position: Number(l.position),
  team: l.team_id ? (teams.get(l.team_id) ?? null) : null,
  acces: lienRestreint(l) ? 'restreint' : 'tous',
  creeLe: l.cree_le,
  majLe: l.maj_le,
});

/** `drive` : service du Drive (dossiers et fichiers que le compte voit, stockage des fichiers des ressources). */
export function servicesLiensCm({ base, maintenant = () => Date.now(), drive, cleSession, stockage }) {
  /** Lecture : `cm.voir` du club ou d'une team ; rend ce que le compte voit. */
  async function lecture(acteur) {
    const x = await porteesDe(base, acteur);
    const equipes = new Set([...x.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id));
    const club = x.club.has('cm.voir');
    if (!club && !equipes.size) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return { acteur, club, equipes, editer: x.club.has('cm.editer'), gerer: x.club.has('cm.gerer'), noms: x.noms, portees: x, lecteur: lecteurLiens(base, acteur) };
  }

  /** Niveau de lecture d'une ressource ('modifier', 'voir') ou null : lecture de base (portée), puis restriction. */
  const niveauVu = async (c, l) => (voitPortee(c.portees, l) ? c.lecteur.niveau(l) : null);
  const fondateur = c => Boolean(c.acteur?.superAdmin) || c.acteur?.compte === 'principal';
  /** Droits du compte sur une ressource qu'il voit (`niveau`). */
  const droitsLien = (c, l, niveau) => {
    const modifier = niveau === 'modifier';
    const acces = fondateur(c) || (modifier && (c.gerer || (Boolean(l.cree_par) && l.cree_par === c.acteur.compte)));
    return { modifier: c.editer && modifier, supprimer: c.gerer && modifier, acces, partager: acces || (!lienRestreint(l) && c.editer) };
  };

  async function ecriture(acteur, permission) {
    const ctx = await contexteCm(base, acteur, PORTEE_CLUB);
    exiger(ctx, permission);
    return ctx;
  }

  /** Team de rattachement : une team existante (non supprimée) dont le module CM est actif, ou null. */
  async function teamValide(v) {
    if (v === null || v === undefined || v === '') return null;
    exigerUuid(v, 'team');
    const t = await base.premier("SELECT t.id FROM teams t JOIN team_modules m ON m.team_id = t.id AND m.module = 'cm' AND m.active = 1 WHERE t.id = ? AND t.supprimee_le IS NULL", [v]);
    if (!t) throw echec(404, 'team-introuvable', 'Team introuvable.');
    return t.id;
  }

  const titreDe = v => {
    const titre = texteNettoye(v, TITRE_MAX);
    if (!titre) throw echec(400, 'titre', 'Titre : obligatoire.');
    return titre;
  };
  const descriptionDe = v => String(v ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  const categorieDe = v => texteNettoye(v, CATEGORIE_MAX) || null;

  /** Ressources visibles parmi des lignes de `cm_liens`, avec leur `niveau`. */
  async function filtrer(c, lignes) {
    const sortie = [];
    for (const l of lignes) {
      const niveau = await niveauVu(c, l);
      if (niveau) sortie.push({ ...l, niveau });
    }
    return sortie;
  }

  /** Partages reçus par le compte : `Map(lienId → { vu })`. */
  async function partagesDe(compte) {
    return new Map((await base.tous('SELECT lien_id, vu_le FROM cm_lien_partages WHERE compte_id = ?', [compte])).map(p => [p.lien_id, { vu: Boolean(p.vu_le) }]));
  }

  /**
   * Personnes qui lisent DATA › Ressources pour une ressource du club (`teamId` null : CM du club ou d'une team) ou
   * d'une team : `[{ compte, pseudo }]`, Fondateur compris. Mémorisé par appel (`cache`).
   */
  async function personnesPortee(teamId, cache = new Map()) {
    const cle = teamId ?? '';
    if (cache.has(cle)) return cache.get(cle);
    const comptes = teamId ? await comptesTeamAvec(base, teamId, 'cm.voir') : await comptesClubAvec(base, 'cm.voir');
    if (!teamId) for (const t of await base.tous("SELECT t.id FROM teams t JOIN team_modules m ON m.team_id = t.id AND m.module = ? AND m.active = 1 WHERE t.supprimee_le IS NULL", [MODULE_CM])) for (const x of await comptesTeamAvec(base, t.id, 'cm.voir')) comptes.add(x);
    const noms = await pseudosDe(base, [...comptes]);
    const sortie = [...comptes].filter(x => noms[x]).map(x => ({ compte: x, pseudo: noms[x] })).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
    cache.set(cle, sortie);
    return sortie;
  }

  /** Personnes qui voient une ressource restreinte aujourd'hui (hors Fondateur) : `[{ compte, pseudo, niveau }]`. */
  async function autorisesDe(l, cache) {
    const niveaux = await niveauxLien(base, l);
    return (await personnesPortee(l.team_id ?? null, cache)).filter(p => niveaux.has(p.compte) && p.compte !== 'principal').map(p => ({ ...p, niveau: niveaux.get(p.compte) }));
  }

  // ---------------------------------------------------------------- Fichiers (migration 0051)

  /**
   * Fichier d'une ressource 'fichier' que l'acteur peut LIRE : `{ f, modifier }` (ligne du Drive), ou `{ etat }` :
   * 'inaccessible' (choisi dans un Drive que le compte ne voit pas, ou dans un dossier qui lui est fermé), 'supprime'
   * (à la corbeille ou effacé). `lisibles` : résultat de `drive.fichiersLisibles` déjà calculé (liste).
   */
  async function fichierDe(acteur, l, lisibles = null) {
    if (!drive || !l.element_id) return { etat: 'supprime' };
    if (l.source === 'envoi') {
      // Envoyé depuis Ressources : il appartient à la ressource, qui en règle seule la visibilité.
      const f = await drive.ligneFichier(l.element_id);
      return f && f.ressource_id === l.id ? { f, modifier: true } : { etat: 'supprime' };
    }
    const x = (lisibles ?? (await drive.fichiersLisibles(acteur, [l.element_id]))).get(l.element_id);
    if (x) return x;
    return (await drive.ligneFichier(l.element_id)) ? { etat: 'inaccessible' } : { etat: 'supprime' };
  }

  const signer = (compte, l, version, telecharger = false) => cheminSigne(cleSession, { fichierId: `${l.id}.${version}`, compte, maintenant: maintenant(), duree: DUREE_LIEN_DRIVE_MS, telecharger, genre: 'ressource' });

  /** Partie publique du fichier d'une ressource (nom, taille, type, vignette…) ; jamais rien d'un fichier inaccessible. */
  async function fichierPublic(acteur, l, droits, { lisibles = null, origine = '' } = {}) {
    const x = await fichierDe(acteur, l, lisibles);
    const source = l.source === 'drive' ? 'drive' : 'envoi';
    if (!x.f) return { source, etat: x.etat };
    const { f } = x;
    const meta = drive.metaPublique(f);
    const vignette = FORMATS_VIGNETTE.includes(meta.format) && Number(f.taille) <= VIGNETTE_TAILLE_MAX && cleSession ? `${origine}${(await signer(acteur.compte, l, Number(f.version))).chemin}` : null;
    return {
      source,
      etat: 'ok',
      id: f.id,
      nom: f.nom,
      genre: f.genre,
      type: f.type_mime,
      taille: Number(f.taille),
      version: Number(f.version),
      meta,
      majLe: f.maj_le,
      vignette,
      // Choisi dans un Drive : de quel Drive (le compte le voit).
      portee: source === 'drive' ? f.portee : null,
      // Remplacer (nouvelle version) : modifier la ressource ET, pour un fichier choisi dans un Drive, le fichier source.
      remplacer: Boolean(droits?.modifier && x.modifier),
    };
  }

  /** Fichiers publics de plusieurs ressources : `Map(lienId → fichier)`. */
  async function fichiersPublics(acteur, lignes, droitsDe, origine = '') {
    const sortie = new Map();
    const fichiers = lignes.filter(l => l.genre === 'fichier');
    if (!fichiers.length) return sortie;
    const lisibles = drive ? await drive.fichiersLisibles(acteur, fichiers.filter(l => l.source === 'drive' && l.element_id).map(l => l.element_id)) : new Map();
    for (const l of fichiers) sortie.set(l.id, await fichierPublic(acteur, l, droitsDe(l), { lisibles, origine }));
    return sortie;
  }

  /** `GET /cm/liens` : les liens visibles (épinglés d'abord, puis ordre manuel), les étiquettes en usage, les teams proposables. */
  async function lister(acteur, { origine = '' } = {}) {
    const c = await lecture(acteur);
    const lignes = await filtrer(c, await base.tous('SELECT * FROM cm_liens ORDER BY epingle DESC, position, cree_le, id LIMIT ?', [LIENS_MAX]));
    const teams = new Map([...c.noms].map(([id, t]) => [id, { id, nom: t.nom }]));
    const categories = [...new Set(lignes.map(l => l.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const liaisons = await liaisonsVisibles(acteur, c, lignes.map(l => l.id));
    const partages = await partagesDe(acteur.compte);
    const cache = new Map();
    const fichiers = await fichiersPublics(acteur, lignes, l => droitsLien(c, l, l.niveau), origine);
    const liens = [];
    for (const l of lignes) {
      const v = liaisons.get(l.id) ?? { cartes: [], dossiers: [] };
      const p = partages.get(l.id);
      const autorises = lienRestreint(l) ? await autorisesDe(l, cache) : null;
      liens.push({
        ...publier(l, teams),
        ...(fichiers.has(l.id) ? { fichier: fichiers.get(l.id) } : {}),
        liaisons: v.cartes.length + v.dossiers.length,
        // Restreinte : cadenas et premières personnes autorisées (le Fondateur voit toujours, il n'est pas listé).
        autorises: autorises ? { total: autorises.length, personnes: autorises.slice(0, AUTORISES_AFFICHES).map(x => ({ compte: x.compte, pseudo: x.pseudo })) } : null,
        partageAvecMoi: Boolean(p),
        nouveau: Boolean(p && !p.vu),
        droits: droitsLien(c, l, l.niveau),
      });
    }
    return {
      liens,
      categories,
      nouveaux: liens.filter(l => l.nouveau).length,
      teams: c.editer ? [...teams.values()] : [],
      droits: { editer: c.editer, gerer: c.gerer },
      max: LIENS_MAX,
    };
  }

  /** Ressource relue après une écriture (avec son fichier, tel que l'acteur le voit). */
  async function relire(id, acteur, origine = '') {
    const l = await base.premier('SELECT * FROM cm_liens WHERE id = ?', [id]);
    const teams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, { id: t.id, nom: t.nom }]));
    if (l.genre !== 'fichier') return publier(l, teams);
    const c = await lecture(acteur);
    const niveau = await niveauVu(c, l);
    return { ...publier(l, teams), fichier: await fichierPublic(acteur, l, niveau ? droitsLien(c, l, niveau) : null, { origine }) };
  }

  const evt = (type, acteur, l, t, extra = {}) =>
    evenement(type, { teamId: l.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_lien', entiteId: l.id, charge: { titre: l.titre, hote: l.hote, portee: PORTEE_CLUB, ...(l.genre === 'fichier' ? { genre: 'fichier' } : {}), ...extra }, maintenant: t });

  /**
   * `POST /cm/liens { genre?, titre, url, description?, categorie?, teamId?, epingle?, acces?, regles? }` (cm.editer). `acces`
   * 'restreint' : visible des seules personnes et rôles de `regles` (et du créateur) ; les personnes nommées sont
   * prévenues (« X a partagé une ressource avec vous ») et la voient « Nouveau ».
   * Fichier (`genre` 'fichier', migration 0051) : `envoi` (envoi terminé, portée d'envoi « ressources ») OU `elementId`
   * (fichier d'un Drive que l'acteur voit, jamais copié) ; `titre` facultatif (par défaut, le nom du fichier).
   */
  async function creer(acteur, corps, { origine = '' } = {}) {
    await ecriture(acteur, 'cm.editer');
    const genre = corps?.genre ?? 'lien';
    if (!GENRES_RESSOURCE.includes(genre)) throw echec(400, 'genre', 'Ressource : lien ou fichier.');
    const fichier = genre === 'fichier';
    const titreSaisi = fichier ? texteNettoye(corps?.titre, TITRE_MAX) : titreDe(corps?.titre);
    const { url, hote } = fichier ? { url: '', hote: '' } : validerLien(corps?.url);
    const teamId = await teamValide(corps?.teamId);
    const acces = corps?.acces ?? 'tous';
    if (!ACCES_LIEN.includes(acces)) throw echec(400, 'acces', 'Accès : tous ou restreint.');
    const regles = acces === 'restreint' ? await reglesValides(teamId, corps?.regles) : [];
    const { n, haut } = (await base.premier('SELECT COUNT(*) AS n, MAX(position) AS haut FROM cm_liens', [])) ?? {};
    if (Number(n ?? 0) >= LIENS_MAX) throw echec(409, 'trop-de-liens', `${LIENS_MAX} liens au plus.`);
    const id = nouvelId();
    // Fichier : envoyé (rangé dans le dossier « Ressources », il appartient à la ressource) ou choisi dans un Drive.
    let source = null;
    let elementId = null;
    let nomFichier = '';
    const rangement = [];
    if (fichier) {
      if (!drive) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      if (corps?.envoi !== undefined && corps?.envoi !== null) {
        const r = await drive.preparerFichierRessource(acteur, { envoi: corps.envoi, ressourceId: id });
        rangement.push(...r.instructions);
        [source, elementId, nomFichier] = ['envoi', r.elementId, r.nom];
      } else if (typeof corps?.elementId === 'string') {
        const f = await drive.fichierPourIntegration(acteur, corps.elementId);
        [source, elementId, nomFichier] = ['drive', f.elementId, f.nom];
      } else throw echec(400, 'fichier', 'Fichier : un envoi ou un fichier du Drive est attendu.');
    }
    const titre = fichier ? titreSaisi || texteNettoye(nomFichier, TITRE_MAX) || 'Fichier' : titreSaisi;
    const ligne = { id, team_id: teamId, titre, url, hote, acces, cree_par: acteur.compte, genre, element_id: elementId, source };
    const tt = maintenant();
    const t = iso(tt);
    const nommes = regles.filter(r => r.genre === 'compte' && r.cible !== acteur.compte).map(r => r.cible);
    await base.lot([
      ...rangement,
      {
        sql: 'INSERT INTO cm_liens (id, team_id, titre, url, hote, description, categorie, epingle, position, cree_par, cree_le, maj_par, maj_le, acces, genre, element_id, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [ligne.id, teamId, titre, url, hote, descriptionDe(corps?.description) || null, categorieDe(corps?.categorie), corps?.epingle === true ? 1 : 0, Number(haut ?? 0) + 1024, acteur.compte, t, acteur.compte, t, acces, genre, elementId, source],
      },
      ...regles.map(r => ({ sql: 'INSERT INTO cm_lien_acces (lien_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?, ?)', params: [ligne.id, r.genre, r.cible, r.niveau, acteur.compte, t] })),
      evt('cm.lien_cree', acteur, ligne, tt, acces === 'restreint' ? { acces } : {}),
      ...instructionsPartage(acteur, ligne, nommes, tt),
    ]);
    if (source === 'envoi') await drive.apresEnvoi();
    return { lien: await relire(ligne.id, acteur, origine) };
  }

  /** Partage : lignes « Nouveau » (remises à neuf) et événement de notification des personnes (`comptes`, sans l'auteur). */
  function instructionsPartage(acteur, l, comptes, tt) {
    const qui = [...new Set(comptes)].filter(x => x && x !== acteur.compte);
    if (!qui.length) return [];
    return [
      ...qui.map(x => ({
        sql: 'INSERT INTO cm_lien_partages (lien_id, compte_id, partage_par, partage_le, vu_le) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (lien_id, compte_id) DO UPDATE SET partage_par = excluded.partage_par, partage_le = excluded.partage_le, vu_le = NULL',
        params: [l.id, x, acteur.compte, iso(tt)],
      })),
      evt('cm.lien_partage', acteur, l, tt, { comptes: qui }),
    ];
  }

  /** Ressource que le compte voit (404 sinon, même si elle existe) : `{ c, l, niveau, droits }`. */
  async function lienVisible(acteur, id) {
    const c = await lecture(acteur);
    exigerUuid(id, 'lien');
    const l = await base.premier('SELECT * FROM cm_liens WHERE id = ?', [id]);
    const niveau = l ? await niveauVu(c, l) : null;
    if (!niveau) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    return { c, l, niveau, droits: droitsLien(c, l, niveau) };
  }

  const refus = () => echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');

  /** `PATCH /cm/liens/:id { titre?, url?, description?, categorie?, teamId?, epingle? }` (cm.editer). */
  async function modifier(acteur, id, corps, { origine = '' } = {}) {
    await ecriture(acteur, 'cm.editer');
    const { l, droits } = await lienVisible(acteur, id);
    // « Peut voir » une ressource restreinte : lecture seule.
    if (!droits.modifier) throw refus();
    const champs = {};
    if (corps?.titre !== undefined) champs.titre = titreDe(corps.titre);
    if (corps?.url !== undefined) {
      // Un fichier n'a pas d'adresse : il se remplace (nouvelle version), il ne devient pas un lien.
      if (l.genre === 'fichier') throw echec(400, 'url', 'Une ressource fichier n’a pas d’adresse : remplacez le fichier.');
      Object.assign(champs, validerLien(corps.url));
    }
    if (corps?.description !== undefined) champs.description = descriptionDe(corps.description) || null;
    if (corps?.categorie !== undefined) champs.categorie = categorieDe(corps.categorie);
    if (corps?.teamId !== undefined) champs.team_id = await teamValide(corps.teamId);
    if (corps?.epingle !== undefined) champs.epingle = corps.epingle === true ? 1 : 0;
    const cles = Object.keys(champs);
    if (cles.length) {
      const tt = maintenant();
      const apres = { ...l, ...champs };
      await base.lot([
        { sql: `UPDATE cm_liens SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(tt), l.id] },
        evt('cm.lien_modifie', acteur, apres, tt, champs.epingle !== undefined && Number(l.epingle) !== champs.epingle ? { epingle: champs.epingle === 1 } : {}),
      ]);
    }
    return { lien: await relire(l.id, acteur, origine) };
  }

  /**
   * `POST /cm/liens/:id/fichier { envoi, version? }` : remplace le fichier d'une ressource (nouvelle version, l'ancienne
   * reste dans l'historique du Drive). Droit de modifier la ressource ; fichier choisi dans un Drive : aussi le droit de
   * le modifier dans son Drive. `version` : version attendue (conflit si le fichier a changé entre-temps).
   */
  async function remplacerFichier(acteur, id, corps, { origine = '' } = {}) {
    await ecriture(acteur, 'cm.editer');
    const { l, droits } = await lienVisible(acteur, id);
    if (l.genre !== 'fichier') throw echec(400, 'genre', 'Cette ressource est un lien, pas un fichier.');
    if (!droits.modifier) throw refus();
    if (!drive) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    const r = await drive.versionRessource(acteur, { elementId: l.element_id, ressourceId: l.id, source: l.source, envoi: corps?.envoi, version: corps?.version });
    const tt = maintenant();
    await base.lot([{ sql: 'UPDATE cm_liens SET maj_par = ?, maj_le = ? WHERE id = ?', params: [acteur.compte, iso(tt), l.id] }, evt('cm.lien_version', acteur, l, tt, { version: r.version })]);
    return { lien: await relire(l.id, acteur, origine) };
  }

  /** Fichier d'une ressource que l'acteur lit (404 / 403 sinon) : `{ l, f }`. */
  async function fichierLisible(acteur, id) {
    const { l } = await lienVisible(acteur, id);
    if (l.genre !== 'fichier') throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const x = await fichierDe(acteur, l);
    if (x.etat === 'inaccessible') throw echec(403, 'drive-inaccessible', 'Fichier d’un Drive auquel vous n’avez pas accès.');
    if (!x.f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé du Drive).');
    return { l, f: x.f };
  }

  /** `POST /cm/liens/:id/fichier/lien { telecharger?, version? }` : lien signé (2 h) vers le fichier (aperçu ou téléchargement). */
  async function lienFichier(acteur, id, corps) {
    const { l, f } = await fichierLisible(acteur, id);
    const version = corps?.version === undefined || corps?.version === null ? Number(f.version) : Number(corps.version);
    if (!Number.isSafeInteger(version) || !(await drive.versionStockee(f.id, version))) throw echec(404, 'version-introuvable', 'Version introuvable.');
    return signer(acteur.compte, l, version, corps?.telecharger === true);
  }

  /**
   * `GET /cm/liens/contenu/<ressource>.<version>?c&exp&sig` (sans session) : le fichier. Signature, PUIS visibilité de la
   * ressource ET accès au fichier source revérifiés pour le compte du lien (retrait immédiat : 403).
   */
  async function servirContenu(cle, params, requete) {
    const m = MOTIF_CONTENU.exec(String(cle));
    if (!m) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const { compte, telecharger } = await verifierLien(cleSession, cle, params, maintenant(), { genre: 'ressource' });
    let f;
    try {
      f = (await fichierLisible({ compte, superAdmin: compte === 'principal' }, m[1])).f;
    } catch {
      throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    }
    const v = await drive.versionStockee(f.id, Number(m[2]));
    if (!v) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const reponse = await reponseFichierStocke({ stockage, f: v.f, requete, telecharger, nom: Number(v.version.version) === Number(f.version) ? f.nom : v.version.nom });
    if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return reponse;
  }

  /** `PUT /cm/liens/ordre { ids }` (cm.editer) : nouvel ordre manuel (les liens non cités gardent leur rang, après). */
  async function ordonner(acteur, corps, { origine = '' } = {}) {
    await ecriture(acteur, 'cm.editer');
    const ids = Array.isArray(corps?.ids) ? corps.ids : null;
    if (!ids || ids.length > LIENS_MAX || new Set(ids).size !== ids.length) throw echec(400, 'ordre', 'Liste d’identifiants invalide.');
    for (const i of ids) exigerUuid(i, 'lien');
    // Seulement des ressources que le compte voit (une restreinte dont il n'est pas : introuvable).
    const c = await lecture(acteur);
    const connus = new Set((await filtrer(c, await lignesParIds(base, 'SELECT * FROM cm_liens WHERE id', ids))).map(l => l.id));
    if (ids.some(i => !connus.has(i))) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    const tt = maintenant();
    await base.lot([
      ...ids.map((i, k) => ({ sql: 'UPDATE cm_liens SET position = ?, maj_par = ?, maj_le = ? WHERE id = ?', params: [(k + 1) * 1024, acteur.compte, iso(tt), i] })),
    ]);
    return lister(acteur, { origine });
  }


  // ---------------------------------------------------------------- Liaisons (cartes et dossiers du Drive)

  /**
   * Cartes (hors carte supprimée ou tableau supprimé) dont le compte voit le tableau (`cm.voir` de sa portée) parmi
   * `ids` : `Map(id → { id, titre, tableauId, tableau, portee, modifier })`. Tableau RESTREINT (migration 0046) :
   * seulement s'il en est (« peut voir » : sans droit de lier).
   */
  async function cartesAccessibles(acteur, c, ids) {
    const sortie = new Map();
    const lecteur = lecteurTableaux(base, acteur);
    const lignes = await lignesParIds(base, 'SELECT c.id, c.titre, c.tableau_id, t.nom, t.cle_defaut, t.portee, t.team_id, t.acces FROM cm_cartes c JOIN cm_tableaux t ON t.id = c.tableau_id WHERE c.supprime_le IS NULL AND t.supprime_le IS NULL AND c.id', ids);
    for (const l of lignes) {
      const niveau = await lecteur.niveau({ id: l.tableau_id, portee: l.portee, team_id: l.team_id, acces: l.acces });
      if (!niveau) continue;
      const p = permissionsAuNiveau(permissionsSur(c.portees, l.portee), niveau);
      if (!p.has('cm.voir')) continue;
      sortie.set(l.id, { id: l.id, titre: l.titre, tableauId: l.tableau_id, tableau: l.nom ?? l.cle_defaut ?? null, portee: l.portee, modifier: p.has('cm.editer') });
    }
    return sortie;
  }

  /** Liaisons visibles de chaque lien : `Map(lienId → { cartes: [...], dossiers: [...] })` (cibles que le compte voit). */
  async function liaisonsVisibles(acteur, c, lienIds) {
    const sortie = new Map();
    if (!lienIds.length) return sortie;
    const lignes = await lignesParIds(base, 'SELECT lien_id, genre, cible_id FROM cm_lien_liaisons WHERE lien_id', lienIds);
    const cartes = await cartesAccessibles(acteur, c, lignes.filter(l => l.genre === 'carte').map(l => l.cible_id));
    const dossiers = drive ? await drive.dossiersAccessibles(acteur, lignes.filter(l => l.genre === 'dossier').map(l => l.cible_id)) : new Map();
    for (const l of lignes) {
      const cible = l.genre === 'carte' ? cartes.get(l.cible_id) : dossiers.get(l.cible_id);
      if (!cible) continue;
      if (!sortie.has(l.lien_id)) sortie.set(l.lien_id, { cartes: [], dossiers: [] });
      sortie.get(l.lien_id)[l.genre === 'carte' ? 'cartes' : 'dossiers'].push(cible);
    }
    return sortie;
  }

  /** `GET /cm/liens/:id/liaisons` : où le lien est lié (cartes et dossiers que le compte voit). */
  async function liaisons(acteur, id) {
    const { c, l, droits } = await lienVisible(acteur, id);
    const v = (await liaisonsVisibles(acteur, c, [l.id])).get(l.id) ?? { cartes: [], dossiers: [] };
    return { cartes: v.cartes, dossiers: v.dossiers, droits: { editer: droits.modifier } };
  }

  /** Cible visible : `{ cible, modifier }` ou 404 ; `modifier` : le compte a le droit d'y lier ou délier un lien. */
  async function cibleVisible(acteur, c, genre, cibleId) {
    if (!GENRES_LIAISON.includes(genre)) throw echec(400, 'genre', 'Genre de liaison inconnu : carte ou dossier.');
    exigerUuid(cibleId, genre);
    const cible = (genre === 'carte' ? await cartesAccessibles(acteur, c, [cibleId]) : drive ? await drive.dossiersAccessibles(acteur, [cibleId]) : new Map()).get(cibleId);
    if (!cible) throw echec(404, `${genre}-introuvable`, genre === 'carte' ? 'Carte introuvable.' : 'Dossier introuvable.');
    return cible;
  }

  /** `POST /cm/liens/:id/liaisons { genre, cibleId }` : lie le lien à une carte ou un dossier (cm.editer du club ET droit d'écriture sur la cible). */
  async function lier(acteur, id, corps) {
    await ecriture(acteur, 'cm.editer');
    const { c, l, droits } = await lienVisible(acteur, id);
    const cible = await cibleVisible(acteur, c, corps?.genre, corps?.cibleId);
    if (!cible.modifier || !droits.modifier) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const tt = maintenant();
    await base.lot([
      { sql: 'INSERT INTO cm_lien_liaisons (lien_id, genre, cible_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', params: [l.id, corps.genre, cible.id, acteur.compte, iso(tt)] },
      evt('cm.lien_lie', acteur, l, tt, { genre: corps.genre }),
    ]);
    return liaisons(acteur, l.id);
  }

  /** `DELETE /cm/liens/:id/liaisons/:genre/:cibleId` : délie (mêmes droits que `lier`). */
  async function delier(acteur, id, genre, cibleId) {
    await ecriture(acteur, 'cm.editer');
    const { c, l, droits } = await lienVisible(acteur, id);
    const cible = await cibleVisible(acteur, c, genre, cibleId);
    if (!cible.modifier || !droits.modifier) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const tt = maintenant();
    await base.lot([{ sql: 'DELETE FROM cm_lien_liaisons WHERE lien_id = ? AND genre = ? AND cible_id = ?', params: [l.id, genre, cible.id] }, evt('cm.lien_delie', acteur, l, tt, { genre })]);
    return liaisons(acteur, l.id);
  }

  /** `GET /cm/liens/cible/:genre/:id` : liens liés à une carte ou à un dossier que le compte voit (et peut-il en lier). */
  async function liensDe(acteur, genre, cibleId, { origine = '' } = {}) {
    const c = await lecture(acteur);
    const cible = await cibleVisible(acteur, c, genre, cibleId);
    // Ressource restreinte : seulement pour qui la voit (accès à la ressource ET à la cible).
    const lignes = await filtrer(c, await base.tous('SELECT l.* FROM cm_liens l JOIN cm_lien_liaisons x ON x.lien_id = l.id WHERE x.genre = ? AND x.cible_id = ? ORDER BY l.epingle DESC, l.position, l.cree_le, l.id', [genre, cible.id]));
    const teams = new Map([...c.noms].map(([i, t]) => [i, { id: i, nom: t.nom }]));
    const partages = await partagesDe(acteur.compte);
    const fichiers = await fichiersPublics(acteur, lignes, l => droitsLien(c, l, l.niveau), origine);
    return {
      liens: lignes.map(l => ({ ...publier(l, teams), ...(fichiers.has(l.id) ? { fichier: fichiers.get(l.id) } : {}), nouveau: Boolean(partages.get(l.id) && !partages.get(l.id).vu), droits: droitsLien(c, l, l.niveau) })),
      droits: { lier: c.editer && cible.modifier, creer: c.editer },
    };
  }

  /**
   * `DELETE /cm/liens/:id` (cm.gerer, au niveau « peut modifier ») : le lien est délié partout. Ressource restreinte :
   * effacée aussi du fil et des notifications, et ses entrées du journal perdent leurs détails (titre, domaine).
   */
  async function supprimer(acteur, id) {
    await ecriture(acteur, 'cm.gerer');
    const { l, droits } = await lienVisible(acteur, id);
    if (!droits.supprimer) throw refus();
    const restreint = lienRestreint(l);
    // Fichier envoyé depuis Ressources : à la corbeille du Drive (ressource ouverte), effacé (restreinte).
    const retrait = l.genre === 'fichier' && l.source === 'envoi' && drive ? await drive.retraitFichierRessource(acteur, { elementId: l.element_id, ressourceId: l.id, definitif: restreint }) : { instructions: [], fichiers: [] };
    const tt = maintenant();
    await base.lot([
      ...retrait.instructions,
      { sql: 'DELETE FROM cm_lien_liaisons WHERE lien_id = ?', params: [l.id] },
      { sql: 'DELETE FROM cm_lien_acces WHERE lien_id = ?', params: [l.id] },
      { sql: 'DELETE FROM cm_lien_partages WHERE lien_id = ?', params: [l.id] },
      { sql: 'DELETE FROM notifications WHERE cm_lien_id = ?', params: [l.id] },
      ...(restreint
        ? [
            { sql: "DELETE FROM notifs_centre WHERE entite_type = 'cm_lien' AND entite_id = ?", params: [l.id] },
            { sql: "UPDATE journal SET meta = ? WHERE entite_type = 'cm_lien' AND entite_id = ?", params: [JSON.stringify({ acces: 'restreint' }), l.id] },
          ]
        : []),
      { sql: 'DELETE FROM cm_liens WHERE id = ?', params: [l.id] },
      restreint
        ? evenement('cm.lien_supprime', { teamId: l.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_lien', entiteId: l.id, charge: { acces: 'restreint', portee: PORTEE_CLUB }, maintenant: tt })
        : evt('cm.lien_supprime', acteur, l, tt),
    ]);
    if (retrait.fichiers.length) await drive.effacerOctetsRessource(retrait.fichiers);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Qui voit la ressource (migration 0048)

  /** Rôles proposés : rôles CM, du club, et de team (celle de la ressource, sinon les teams au module CM). */
  async function rolesProposes(teamId) {
    const rolesCm = await base.tous('SELECT id, nom, couleur FROM cm_roles ORDER BY position, nom, id', []);
    const rolesClub = await base.tous('SELECT id, nom, couleur FROM roles_globaux ORDER BY position, nom, id', []);
    const condition = teamId ? 'AND r.team_id = ?' : 'AND EXISTS (SELECT 1 FROM team_modules m WHERE m.team_id = t.id AND m.module = ? AND m.active = 1)';
    const rolesTeam = await base.tous(`SELECT r.id, r.nom, r.couleur, r.team_id, t.nom AS team_nom FROM roles r JOIN teams t ON t.id = r.team_id WHERE t.supprimee_le IS NULL ${condition} ORDER BY t.nom, r.position, r.nom, r.id`, [teamId ?? MODULE_CM]);
    return {
      rolesCm: rolesCm.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur })),
      rolesClub: rolesClub.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur })),
      rolesTeam: rolesTeam.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, team: { id: r.team_id, nom: r.team_nom } })),
    };
  }

  async function optionsAcces(teamId) {
    return { personnes: await personnesPortee(teamId), ...(await rolesProposes(teamId)) };
  }

  /** Règles reçues → `[{ genre, cible, niveau }]` vérifiées (personne qui lit les Ressources de la portée, rôle existant). */
  async function reglesValides(teamId, brutes = []) {
    if (!Array.isArray(brutes ?? []) || (brutes ?? []).length > MAX_REGLES_ACCES) throw echec(400, 'regles', `${MAX_REGLES_ACCES} personnes ou rôles au plus.`);
    const vues = new Map();
    for (const r of brutes ?? []) {
      if (!r || typeof r !== 'object' || !GENRES_ACCES.includes(r.genre) || typeof r.cible !== 'string' || !r.cible || r.cible.length > 64 || !NIVEAUX_ACCES.includes(r.niveau ?? 'voir')) throw echec(400, 'regles', 'Personnes ou rôles illisibles.');
      vues.set(`${r.genre}|${r.cible}`, { genre: r.genre, cible: r.cible, niveau: r.niveau ?? 'voir' });
    }
    const regles = [...vues.values()];
    if (!regles.length) return regles;
    const o = await optionsAcces(teamId);
    const ids = { compte: new Set(o.personnes.map(p => p.compte)), role_cm: new Set(o.rolesCm.map(r => r.id)), role_club: new Set(o.rolesClub.map(r => r.id)), role_team: new Set(o.rolesTeam.map(r => r.id)) };
    for (const r of regles) if (!ids[r.genre].has(r.cible)) throw echec(400, 'regle-inconnue', r.genre === 'compte' ? 'Cette personne n’a pas accès aux ressources du CM.' : 'Rôle inconnu.');
    return regles;
  }

  /** `GET /cm/liens/acces?team=` : personnes et rôles proposables pour une nouvelle ressource (cm.editer). */
  async function optionsNouveau(acteur, teamId) {
    await ecriture(acteur, 'cm.editer');
    const t = await teamValide(teamId || null);
    return { lien: null, acces: 'tous', regles: [], effectifs: null, options: await optionsAcces(t), moi: acteur.compte };
  }

  /** `GET /cm/liens/:id/acces` : réglage (créateur, cm.gerer au niveau « peut modifier », Fondateur ; 403 sinon). */
  async function accesLien(acteur, id) {
    const { l, droits } = await lienVisible(acteur, id);
    if (!droits.acces) throw refus();
    const regles = await base.tous('SELECT genre, cible, niveau FROM cm_lien_acces WHERE lien_id = ? ORDER BY genre, cible', [l.id]);
    const options = await optionsAcces(l.team_id ?? null);
    const pseudos = new Map(options.personnes.map(p => [p.compte, p.pseudo]));
    const noms = new Map([...options.rolesCm.map(r => [`role_cm|${r.id}`, r.nom]), ...options.rolesClub.map(r => [`role_club|${r.id}`, r.nom]), ...options.rolesTeam.map(r => [`role_team|${r.id}`, r.team?.nom ? `${r.nom} (${r.team.nom})` : r.nom])]);
    const effectifs = lienRestreint(l) ? await autorisesDe(l) : null;
    const fondateurLa = options.personnes.find(p => p.compte === 'principal');
    return {
      lien: { id: l.id, titre: l.titre, creePar: l.cree_par ?? null, team: l.team_id ?? null },
      acces: lienRestreint(l) ? 'restreint' : 'tous',
      regles: regles.filter(r => (r.genre === 'compte' ? pseudos.has(r.cible) : noms.has(`${r.genre}|${r.cible}`))).map(r => ({ genre: r.genre, cible: r.cible, niveau: r.niveau, nom: r.genre === 'compte' ? (pseudos.get(r.cible) ?? null) : (noms.get(`${r.genre}|${r.cible}`) ?? null) })),
      // Qui voit la ressource aujourd'hui (restreinte) : créateur et personnes retenues par les règles, et le Fondateur.
      effectifs: effectifs ? [...(fondateurLa ? [{ ...fondateurLa, niveau: 'modifier' }] : []), ...effectifs] : null,
      options,
      moi: acteur.compte,
    };
  }

  /**
   * `PUT /cm/liens/:id/acces { acces, regles }`. Hors Fondateur et créateur (qui la voient toujours), on ne se retire pas
   * soi-même le niveau « peut modifier ». Personnes nouvellement nommées : notifiées, « Nouveau » chez elles.
   */
  async function changerAcces(acteur, id, corps) {
    const { l, droits } = await lienVisible(acteur, id);
    if (!droits.acces) throw refus();
    const acces = corps?.acces;
    if (!ACCES_LIEN.includes(acces)) throw echec(400, 'acces', 'Accès : tous ou restreint.');
    const regles = await reglesValides(l.team_id ?? null, corps?.regles ?? []);
    const createur = Boolean(l.cree_par) && l.cree_par === acteur.compte;
    if (acces === 'restreint' && !acteur.superAdmin && !createur && (await niveauxLien(base, l, regles)).get(acteur.compte) !== 'modifier') throw echec(409, 'acces-soi-meme', 'Vous ne pouvez pas vous retirer l’accès « peut modifier » à cette ressource.');
    const avant = new Set((await base.tous("SELECT cible FROM cm_lien_acces WHERE lien_id = ? AND genre = 'compte'", [l.id])).map(r => r.cible));
    const nommes = acces === 'restreint' ? regles.filter(r => r.genre === 'compte' && (!avant.has(r.cible) || !lienRestreint(l)) && r.cible !== l.cree_par).map(r => r.cible) : [];
    const tt = maintenant();
    const t = iso(tt);
    await base.lot([
      { sql: 'DELETE FROM cm_lien_acces WHERE lien_id = ?', params: [l.id] },
      ...regles.map(r => ({ sql: 'INSERT INTO cm_lien_acces (lien_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?, ?)', params: [l.id, r.genre, r.cible, r.niveau, acteur.compte, t] })),
      { sql: 'UPDATE cm_liens SET acces = ?, maj_par = ?, maj_le = ? WHERE id = ?', params: [acces, acteur.compte, t, l.id] },
      // Jamais la liste des personnes dans la charge (le fil la montrerait).
      evt('cm.lien_acces', acteur, l, tt, { acces, regles: regles.length }),
      ...instructionsPartage(acteur, l, nommes, tt),
    ]);
    return accesLien(acteur, l.id);
  }

  /**
   * `POST /cm/liens/:id/partage { comptes, niveau? }` : « Partager avec… ». Ressource restreinte : les personnes reçoivent
   * l'accès (`niveau`, « peut voir » par défaut ; jamais rétrogradées) — réservé à qui règle l'accès. Ouverte à tous : un
   * éditeur peut aussi la signaler. Elles sont notifiées et la voient « Nouveau ».
   */
  async function partager(acteur, id, corps) {
    const { l, droits } = await lienVisible(acteur, id);
    if (!droits.partager) throw refus();
    const comptes = corps?.comptes;
    const niveau = corps?.niveau ?? 'voir';
    if (!Array.isArray(comptes) || !comptes.length || comptes.length > PARTAGE_MAX || comptes.some(x => typeof x !== 'string') || !NIVEAUX_ACCES.includes(niveau)) throw echec(400, 'partage', 'Personnes illisibles.');
    const personnes = new Set((await personnesPortee(l.team_id ?? null)).map(p => p.compte));
    const qui = [...new Set(comptes)].filter(x => x !== acteur.compte);
    if (qui.some(x => !personnes.has(x))) throw echec(400, 'regle-inconnue', 'Cette personne n’a pas accès aux ressources du CM.');
    if (!qui.length) throw echec(400, 'partage', 'Personnes illisibles.');
    const tt = maintenant();
    const t = iso(tt);
    const instructions = [];
    if (lienRestreint(l)) {
      if (!droits.acces) throw refus();
      const existantes = new Map((await base.tous("SELECT cible, niveau FROM cm_lien_acces WHERE lien_id = ? AND genre = 'compte'", [l.id])).map(r => [r.cible, r.niveau]));
      for (const x of qui) {
        if (x === l.cree_par || existantes.get(x) === 'modifier' || existantes.get(x) === niveau) continue;
        instructions.push({ sql: 'INSERT INTO cm_lien_acces (lien_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (lien_id, genre, cible) DO UPDATE SET niveau = excluded.niveau', params: [l.id, 'compte', x, niveau, acteur.compte, t] });
      }
      if (instructions.length) instructions.push({ sql: 'UPDATE cm_liens SET maj_le = ? WHERE id = ?', params: [t, l.id] });
    }
    await base.lot([...instructions, ...instructionsPartage(acteur, l, qui, tt)]);
    return { ok: true, partages: qui.length };
  }

  /** `POST /cm/liens/:id/vu` : la pastille « Nouveau » disparaît (et la notification de partage passe en lue). */
  async function vu(acteur, id) {
    const { l } = await lienVisible(acteur, id);
    const t = iso(maintenant());
    await base.lot([
      { sql: 'UPDATE cm_lien_partages SET vu_le = ? WHERE lien_id = ? AND compte_id = ? AND vu_le IS NULL', params: [t, l.id, acteur.compte] },
      { sql: 'UPDATE notifications SET lue_le = ? WHERE compte_id = ? AND cm_lien_id = ? AND lue_le IS NULL', params: [t, acteur.compte, l.id] },
    ]);
    return { ok: true };
  }

  /** Nouvelles ressources partagées avec le compte, pas encore ouvertes, qu'il voit encore (pastille de l'onglet). */
  async function nouvelles(acteur) {
    let c;
    try {
      c = await lecture(acteur);
    } catch {
      return 0;
    }
    const lignes = await base.tous('SELECT l.* FROM cm_liens l JOIN cm_lien_partages p ON p.lien_id = l.id WHERE p.compte_id = ? AND p.vu_le IS NULL', [acteur.compte]);
    return (await filtrer(c, lignes)).length;
  }

  return { lister, creer, modifier, ordonner, supprimer, liaisons, lier, delier, liensDe, optionsNouveau, accesLien, changerAcces, partager, vu, nouvelles, remplacerFichier, lienFichier, servirContenu };
}
