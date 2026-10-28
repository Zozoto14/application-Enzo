/**
 * Trombinoscope (page Membres › Trombinoscope, migration 0030) : fiches des joueurs pour le CM et le staff.
 *
 * QUI VOIT quoi :
 *  - `membres.trombi.voir` par une affectation CM « club » (Responsable / Correspondant CM) : tout le club ;
 *    par un rôle de team (staff : Manager, Coach, Analyste ; Propriétaire) ou une affectation CM de team : les
 *    membres de cette team ; le Fondateur : tout. Ce niveau (« staff ») lit les champs « membres » et « staff ».
 *  - Sans la permission, un membre voit les cartes des membres de SES teams, champs « membres » seulement.
 *  - Le joueur voit et modifie SA fiche, champs privés compris, et règle seul leur visibilité.
 *  - `membres.trombi.editer` (Manager, Responsable CM ; Fondateur) : compléter / corriger les fiches qu'il voit,
 *    sauf les champs que le joueur a rendus privés et sauf la visibilité.
 *
 * Le trombinoscope ne lit des tournois et résultats que ce qui est publiable (jamais un résultat réservé au staff).
 */

import { evenement } from '../evenements.mjs';
import { CLE_PROPRIETAIRE } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, sha256Hex, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { validerDonnees } from '../jeux/schema.mjs';
import {
  CHAMPS_VISIBILITE,
  PERMISSIONS_TROMBI,
  adresseImage,
  champsVisibles,
  lireElos,
  lirePalmares,
  lirePostes,
  lireReseaux,
  lireStructures,
  lireVisibilite,
  lireVisibiliteStockee,
  palmaresCalcule,
  texteFiche,
  verifierPhoto,
} from './regles.mjs';

const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;

/** Champs modifiables de la fiche (corps de PATCH) et le champ de visibilité qui les protège. */
const CHAMPS_FICHE = Object.freeze({ nomReel: 'nomReel', presentation: 'presentation', elos: 'elos', palmares: 'palmares', structures: 'structures', reseaux: 'reseaux', postes: null });

export function servicesTrombi({ base, maintenant = () => Date.now() }) {
  // ---------------------------------------------------------------- Droits

  /**
   * Droits de l'acteur : `{ tout, clubVoir, clubEditer, voir: Set<teamId>, editer: Set<teamId>, membre: Set<teamId> }`.
   * Une affectation CM de team ou un rôle de team ne vaut que tant que l'acteur est membre actif de la team.
   */
  async function droits(acteur) {
    if (acteur.superAdmin) return { tout: true, clubVoir: true, clubEditer: true, voir: new Set(), editer: new Set(), membre: new Set() };
    const club = new Set(
      (await base.tous(`SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee = 'club' AND rp.permission IN (?, ?)`, [acteur.compte, ...PERMISSIONS_TROMBI])).map(l => l.permission),
    );
    const membres = await base.tous(
      `SELECT m.team_id, r.cle_systeme, rp.permission FROM membres m JOIN teams t ON t.id = m.team_id AND t.supprimee_le IS NULL JOIN roles r ON r.id = m.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission IN (?, ?)
        WHERE m.compte_id = ? AND m.statut = 'actif'`,
      [...PERMISSIONS_TROMBI, acteur.compte],
    );
    const membre = new Set(membres.map(m => m.team_id));
    const voir = new Set();
    const editer = new Set();
    for (const m of membres) {
      if (m.cle_systeme === CLE_PROPRIETAIRE || m.permission === 'membres.trombi.editer') editer.add(m.team_id);
      if (m.cle_systeme === CLE_PROPRIETAIRE || m.permission) voir.add(m.team_id);
    }
    const aff = await base.tous(`SELECT a.portee, rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee <> 'club' AND rp.permission IN (?, ?)`, [acteur.compte, ...PERMISSIONS_TROMBI]);
    for (const a of aff) {
      if (!membre.has(a.portee)) continue;
      voir.add(a.portee);
      if (a.permission === 'membres.trombi.editer') editer.add(a.portee);
    }
    const clubEditer = club.has('membres.trombi.editer');
    return { tout: false, clubVoir: clubEditer || club.has('membres.trombi.voir'), clubEditer, voir, editer, membre };
  }

  /** Teams que l'acteur parcourt (club : toutes) ; null = toutes. */
  const teamsParcourues = d => (d.tout || d.clubVoir ? null : new Set([...d.voir, ...d.membre]));

  /** Niveau de l'acteur sur une fiche (voir regles.mjs) ; null s'il ne la voit pas. `teams` : teams actives du joueur. */
  function niveauSur(acteur, d, compte, teams) {
    if (d.tout || compte === acteur.compte) return 'moi';
    if (d.clubEditer || teams.some(t => d.editer.has(t))) return 'editeur';
    if (d.clubVoir || teams.some(t => d.voir.has(t))) return 'staff';
    if (teams.some(t => d.membre.has(t))) return 'membre';
    return null;
  }

  // ---------------------------------------------------------------- Lectures

  async function jeuxConnus() {
    const lignes = await base.tous('SELECT cle, nom, couleur, donnees FROM jeux', []);
    return new Map(
      lignes.map(j => {
        const d = validerDonnees(jsonOu(j.donnees, {}), { tolerant: true }).donnees;
        return [j.cle, { cle: j.cle, nom: j.nom, couleur: j.couleur, rolesJoueurs: d.rolesJoueurs.map(r => ({ cle: r.cle, nom: r.nom })), personnages: d.personnages.filter(p => p.actif !== false).map(p => ({ cle: p.cle, nom: p.nom })) }];
      }),
    );
  }

  /** Appartenances actives (teams non supprimées), filtrées par les teams parcourues ; `compte` : un seul joueur. */
  async function appartenances(teams, compte) {
    const lignes = await base.tous(
      `SELECT m.compte_id, m.team_id, m.poste_jeu, m.rejoint_le, r.nom AS role_nom, r.couleur AS role_couleur, r.cle_systeme, t.nom AS team_nom, t.slug, t.jeu, t.logo_url, t.archivee_le, c.pseudo, c.pseudo_cle
         FROM membres m JOIN teams t ON t.id = m.team_id AND t.supprimee_le IS NULL JOIN roles r ON r.id = m.role_id JOIN comptes c ON c.id = m.compte_id
        WHERE m.statut = 'actif' ${compte ? 'AND m.compte_id = ?' : ''} ORDER BY c.pseudo_cle, t.nom`,
      compte ? [compte] : [],
    );
    return teams ? lignes.filter(l => teams.has(l.team_id)) : lignes;
  }

  async function ficheLigne(compte) {
    return base.premier('SELECT * FROM trombi_fiches WHERE compte_id = ?', [compte]);
  }

  /** Fiche stockée lue (listes et visibilité), vide si absente. */
  function ficheDe(l) {
    return {
      nomReel: l?.nom_reel ?? '',
      presentation: l?.presentation ?? '',
      elos: jsonOu(l?.elos, []),
      palmares: jsonOu(l?.palmares, []),
      structures: jsonOu(l?.structures, []),
      reseaux: jsonOu(l?.reseaux, []),
      postes: jsonOu(l?.postes, {}),
      visibilite: lireVisibiliteStockee(jsonOu(l?.visibilite, {})),
      version: Number(l?.version ?? 0),
      majLe: l?.maj_le ?? null,
    };
  }

  /** Teams d'une carte : nom, jeu, rôle de team, postes et personnages (noms du profil du jeu de la team). */
  function teamsCarte(lignes, fiche, jeux) {
    return lignes.map(a => {
      const jeu = jeux.get(a.jeu);
      const p = fiche.postes[a.team_id] ?? { postes: [], personnages: [] };
      const nom = (liste, cle) => liste?.find(x => x.cle === cle)?.nom ?? cle;
      return {
        id: a.team_id,
        nom: a.team_nom,
        slug: a.slug,
        logoUrl: a.logo_url ?? null,
        jeu: a.jeu,
        jeuNom: jeu?.nom ?? a.jeu,
        role: { nom: a.role_nom, couleur: a.role_couleur, cle: a.cle_systeme ?? null },
        postes: (p.postes ?? []).map(c => ({ cle: c, nom: nom(jeu?.rolesJoueurs, c) })),
        personnages: (p.personnages ?? []).map(c => ({ cle: c, nom: nom(jeu?.personnages, c) })),
        // Poste saisi à l'arrivée dans la team (texte libre) : affiché tant qu'aucun poste du profil n'est choisi.
        posteLibre: a.poste_jeu ?? null,
        rejointLe: a.rejoint_le,
      };
    });
  }

  const avecNomJeu = (elos, jeux) => elos.map(e => ({ ...e, jeuNom: jeux.get(e.jeu)?.nom ?? e.jeu }));

  /** `GET /trombi` : cartes visibles, droits, teams et jeux (filtres). */
  async function liste(acteur) {
    const d = await droits(acteur);
    const lignes = await appartenances(teamsParcourues(d));
    const parCompte = new Map();
    for (const l of lignes) {
      if (!parCompte.has(l.compte_id)) parCompte.set(l.compte_id, []);
      parCompte.get(l.compte_id).push(l);
    }
    // Sa propre fiche, même sans team.
    const moi = acteur.compte && !parCompte.has(acteur.compte) ? await base.premier('SELECT id, pseudo FROM comptes WHERE id = ?', [acteur.compte]) : null;
    const comptes = [...parCompte.keys(), ...(moi ? [moi.id] : [])];
    const fiches = new Map((await lignesParIds(base, 'SELECT * FROM trombi_fiches WHERE compte_id', comptes)).map(f => [f.compte_id, ficheDe(f)]));
    const photos = new Map((await lignesParIds(base, 'SELECT compte_id, type, miniature, maj_le FROM trombi_photos WHERE compte_id', comptes)).map(p => [p.compte_id, p]));
    const jeux = await jeuxConnus();
    const teams = new Map();
    const cartes = [];
    for (const compte of comptes) {
      const ls = parCompte.get(compte) ?? [];
      for (const l of ls) teams.set(l.team_id, { id: l.team_id, nom: l.team_nom, slug: l.slug, jeu: l.jeu, jeuNom: jeux.get(l.jeu)?.nom ?? l.jeu, logoUrl: l.logo_url ?? null });
      const niveau = niveauSur(acteur, d, compte, ls.map(l => l.team_id));
      if (!niveau) continue;
      const fiche = fiches.get(compte) ?? ficheDe(null);
      const vis = champsVisibles(niveau, fiche.visibilite);
      const photo = photos.get(compte);
      const ts = teamsCarte(ls, fiche, jeux);
      // Elo de la carte : celui du jeu de sa première team, sinon le premier saisi.
      const elos = vis.has('elos') ? avecNomJeu(fiche.elos, jeux) : [];
      const elo = elos.find(e => ts.some(t => t.jeu === e.jeu)) ?? elos[0] ?? null;
      cartes.push({
        compte,
        pseudo: ls[0]?.pseudo ?? moi?.pseudo ?? compte,
        photo: vis.has('photo') && photo ? adresseImage(photo.type, photo.miniature) : null,
        teams: ts,
        elo,
        reseaux: vis.has('reseaux') ? fiche.reseaux.map(r => ({ reseau: r.reseau, url: r.url, libelle: r.libelle ?? '' })) : [],
        palmares: vis.has('palmares') ? fiche.palmares.length : 0,
        peutEditer: niveau === 'moi' || niveau === 'editeur',
        moi: compte === acteur.compte,
      });
    }
    return {
      droits: { voir: d.tout || d.clubVoir ? 'club' : d.voir.size ? 'teams' : 'equipe', editer: d.tout || d.clubEditer || d.editer.size > 0 },
      teams: [...teams.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
      jeux: [...jeux.values()].filter(j => [...teams.values()].some(t => t.jeu === j.cle)).map(j => ({ cle: j.cle, nom: j.nom, rolesJoueurs: j.rolesJoueurs })),
      fiches: cartes,
    };
  }

  /** Joueur demandé (« moi » : l'acteur) et son contexte : appartenances visibles, niveau (404 s'il ne le voit pas). */
  async function contexteFiche(acteur, id) {
    const compte = id === 'moi' ? acteur.compte : id;
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    const c = await base.premier('SELECT id, pseudo FROM comptes WHERE id = ?', [compte]);
    if (!c) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    const d = await droits(acteur);
    const toutes = await appartenances(null, compte);
    const niveau = niveauSur(acteur, d, compte, toutes.map(a => a.team_id));
    if (!niveau) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    // Teams montrées : celles que l'acteur parcourt (le club, le Fondateur et le joueur lui-même : toutes).
    const parcourues = niveau === 'moi' ? null : teamsParcourues(d);
    const visibles = parcourues ? toutes.filter(a => parcourues.has(a.team_id)) : toutes;
    return { compte, pseudo: c.pseudo, d, niveau, toutes, visibles };
  }

  /** Palmarès calculé (tournois et résultats publiables des teams visibles). */
  async function calcule(compte, teams) {
    const ids = teams.map(t => t.team_id);
    if (!ids.length) return palmaresCalcule({});
    const tn = await lignesParIds(
      base,
      `SELECT t.id, t.nom, t.team_id, t.jeu, t.debut, t.fin, t.statut, t.classement_final, t.participants, r.role
         FROM tournois t JOIN tournoi_roster r ON r.tournoi_id = t.id AND r.compte_id = ?
        WHERE t.supprime_le IS NULL AND t.publiable = 1 AND t.statut <> 'annule' AND t.team_id`,
      ids,
      { paramsAvant: [compte] },
    );
    const matchs = await lignesParIds(
      base,
      `SELECT r.id, r.tournoi_id, r.team_id, r.issue, r.mvp_id, (SELECT COUNT(*) FROM resultat_joueurs j WHERE j.resultat_id = r.id AND j.compte_id = ?) AS aligne
         FROM resultats r WHERE r.supprime_le IS NULL AND r.visibilite = 'team' AND r.publiable = 1 AND (r.mvp_id = ? OR EXISTS (SELECT 1 FROM resultat_joueurs j WHERE j.resultat_id = r.id AND j.compte_id = ?)) AND r.team_id`,
      ids,
      { paramsAvant: [compte, compte, compte] },
    );
    // Tournois où il a joué un match sans être au roster (remplaçant de dernière minute).
    const manquants = [...new Set(matchs.map(m => m.tournoi_id).filter(id => id && !tn.some(t => t.id === id)))];
    const autres = await lignesParIds(base, "SELECT id, nom, team_id, jeu, debut, fin, statut, classement_final, participants, NULL AS role FROM tournois WHERE supprime_le IS NULL AND publiable = 1 AND statut <> 'annule' AND id", manquants);
    const noms = new Map(teams.map(t => [t.team_id, t.team_nom]));
    const jeux = await jeuxConnus();
    return palmaresCalcule({
      tournois: [...tn, ...autres].map(t => ({
        id: t.id,
        nom: t.nom,
        teamId: t.team_id,
        teamNom: noms.get(t.team_id) ?? null,
        jeu: t.jeu,
        jeuNom: jeux.get(t.jeu)?.nom ?? t.jeu,
        debut: t.debut ?? null,
        fin: t.fin ?? null,
        statut: t.statut,
        placement: t.classement_final === null || t.classement_final === undefined ? null : Number(t.classement_final),
        participants: t.participants === null || t.participants === undefined ? null : Number(t.participants),
        role: t.role ?? null,
      })),
      matchs: matchs.map(m => ({ resultatId: m.id, tournoiId: m.tournoi_id ?? null, teamId: m.team_id, issue: m.issue ?? null, mvp: m.mvp_id === compte, aligne: Number(m.aligne) > 0 })),
    });
  }

  /** Fiche détaillée telle que l'acteur la voit. */
  async function detailDe(acteur, ctx) {
    const l = await ficheLigne(ctx.compte);
    const fiche = ficheDe(l);
    const vis = champsVisibles(ctx.niveau, fiche.visibilite);
    const jeux = await jeuxConnus();
    const photo = vis.has('photo') ? await base.premier('SELECT type, donnees, cote, maj_le FROM trombi_photos WHERE compte_id = ?', [ctx.compte]) : null;
    const moi = ctx.niveau === 'moi';
    const editeur = moi || ctx.niveau === 'editeur';
    const teams = teamsCarte(ctx.visibles, fiche, jeux);
    // Jeux proposés à la saisie (elo, palmarès, structures) ; profils des teams du joueur (postes, personnages).
    const profils = editeur ? ctx.toutes.map(a => ({ teamId: a.team_id, jeu: a.jeu, rolesJoueurs: jeux.get(a.jeu)?.rolesJoueurs ?? [], personnages: jeux.get(a.jeu)?.personnages ?? [] })) : undefined;
    return {
      compte: ctx.compte,
      pseudo: ctx.pseudo,
      niveau: ctx.niveau,
      peutEditer: editeur,
      peutRegler: moi,
      version: fiche.version,
      majLe: fiche.majLe,
      teams,
      photo: photo ? { url: adresseImage(photo.type, photo.donnees), type: photo.type, cote: Number(photo.cote), majLe: photo.maj_le } : null,
      champs: Object.fromEntries(CHAMPS_VISIBILITE.map(c => [c, vis.has(c)])),
      nomReel: vis.has('nomReel') ? fiche.nomReel : null,
      presentation: vis.has('presentation') ? fiche.presentation : null,
      elos: vis.has('elos') ? avecNomJeu(fiche.elos, jeux) : null,
      palmares: vis.has('palmares') ? fiche.palmares.map(p => ({ ...p, jeuNom: p.jeu ? (jeux.get(p.jeu)?.nom ?? p.jeu) : '' })) : null,
      calcule: vis.has('palmares') ? await calcule(ctx.compte, ctx.visibles) : null,
      structures: vis.has('structures') ? fiche.structures.map(s => ({ ...s, jeuNom: s.jeu ? (jeux.get(s.jeu)?.nom ?? s.jeu) : '' })) : null,
      reseaux: vis.has('reseaux') ? fiche.reseaux : null,
      ...(moi ? { visibilite: fiche.visibilite } : {}),
      ...(editeur ? { saisie: { jeux: [...jeux.values()].map(j => ({ cle: j.cle, nom: j.nom })), profils } } : {}),
    };
  }

  async function detail(acteur, id) {
    return detailDe(acteur, await contexteFiche(acteur, id));
  }

  // ---------------------------------------------------------------- Écritures

  /**
   * `PATCH /trombi/fiches/:compte` : champs fournis remplacés (listes entières). `versionAttendue` : 409 si la
   * fiche a changé entre-temps. Un éditeur ne touche ni aux champs privés ni à la visibilité (403).
   */
  async function modifier(acteur, id, corps) {
    const ctx = await contexteFiche(acteur, id);
    if (ctx.niveau !== 'moi' && ctx.niveau !== 'editeur') throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (!corps || typeof corps !== 'object') throw echec(400, 'corps', 'Requête illisible.');
    const l = await ficheLigne(ctx.compte);
    const actuelle = ficheDe(l);
    if (corps.versionAttendue !== undefined && Number(corps.versionAttendue) !== actuelle.version) throw echec(409, 'version', 'La fiche a été modifiée entre-temps : rechargez-la.');
    const vis = champsVisibles(ctx.niveau, actuelle.visibilite);
    const champs = Object.keys(CHAMPS_FICHE).filter(c => corps[c] !== undefined);
    for (const c of champs) if (CHAMPS_FICHE[c] && !vis.has(CHAMPS_FICHE[c])) throw echec(403, 'champ-prive', 'Ce champ est privé : seul le joueur le modifie.');
    if (corps.visibilite !== undefined && ctx.niveau !== 'moi') throw echec(403, 'visibilite', 'Seul le joueur règle la visibilité de sa fiche.');
    const t = maintenant();
    const jeux = await jeuxConnus();
    const cles = new Set(jeux.keys());
    const nouvelle = { ...actuelle };
    if (corps.nomReel !== undefined) nouvelle.nomReel = texteNettoye(corps.nomReel, 80);
    if (corps.presentation !== undefined) nouvelle.presentation = texteLong(corps.presentation, 500);
    if (corps.elos !== undefined) nouvelle.elos = lireElos(corps.elos, { jeux: cles, actuels: actuelle.elos, aujourdhui: iso(t).slice(0, 10) });
    if (corps.palmares !== undefined) nouvelle.palmares = lirePalmares(corps.palmares, { jeux: cles, nouvelId });
    if (corps.structures !== undefined) nouvelle.structures = lireStructures(corps.structures, { jeux: cles, nouvelId });
    if (corps.reseaux !== undefined) nouvelle.reseaux = lireReseaux(corps.reseaux);
    if (corps.postes !== undefined) {
      const profils = new Map(
        ctx.toutes.map(a => {
          const j = jeux.get(a.jeu);
          return [a.team_id, { postes: new Set((j?.rolesJoueurs ?? []).map(r => r.cle)), personnages: new Set((j?.personnages ?? []).map(p => p.cle)) }];
        }),
      );
      nouvelle.postes = lirePostes(corps.postes, { profils, actuels: actuelle.postes });
    }
    if (corps.visibilite !== undefined) nouvelle.visibilite = lireVisibilite(corps.visibilite, actuelle.visibilite);
    const modifies = [...champs, ...(corps.visibilite !== undefined ? ['visibilite'] : [])];
    const valeurs = [nouvelle.nomReel, nouvelle.presentation, JSON.stringify(nouvelle.elos), JSON.stringify(nouvelle.palmares), JSON.stringify(nouvelle.structures), JSON.stringify(nouvelle.reseaux), JSON.stringify(nouvelle.postes), JSON.stringify(nouvelle.visibilite)];
    const ecriture = l
      ? { sql: 'UPDATE trombi_fiches SET nom_reel = ?, presentation = ?, elos = ?, palmares = ?, structures = ?, reseaux = ?, postes = ?, visibilite = ?, version = version + 1, maj_par = ?, maj_le = ? WHERE compte_id = ? AND version = ?', params: [...valeurs, acteur.compte, iso(t), ctx.compte, actuelle.version] }
      : { sql: 'INSERT INTO trombi_fiches (compte_id, nom_reel, presentation, elos, palmares, structures, reseaux, postes, visibilite, version, maj_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING', params: [ctx.compte, ...valeurs, acteur.compte, iso(t), iso(t)] };
    const res = await base.lot([ecriture]);
    if (res[0].changements !== 1) throw echec(409, 'version', 'La fiche a été modifiée entre-temps : rechargez-la.');
    await base.lot([evenement('trombi.fiche_modifiee', { acteur: acteur.compte, entiteType: 'trombi_fiche', entiteId: ctx.compte, charge: { compte: ctx.compte, champs: modifies }, maintenant: t })]);
    return detailDe(acteur, ctx);
  }

  /** `PUT /trombi/fiches/:compte/photo` `{ type, donnees, miniature }` (base64, carrée, recadrée par l'app). */
  async function changerPhoto(acteur, id, corps) {
    const ctx = await contexteFiche(acteur, id);
    if (ctx.niveau !== 'moi' && ctx.niveau !== 'editeur') throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const fiche = ficheDe(await ficheLigne(ctx.compte));
    if (!champsVisibles(ctx.niveau, fiche.visibilite).has('photo')) throw echec(403, 'champ-prive', 'Ce champ est privé : seul le joueur le modifie.');
    const p = verifierPhoto(corps);
    const empreinte = await sha256Hex(p.donnees);
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO trombi_photos (compte_id, type, cote, taille, donnees, miniature, empreinte, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (compte_id) DO UPDATE SET type = excluded.type, cote = excluded.cote, taille = excluded.taille, donnees = excluded.donnees, miniature = excluded.miniature, empreinte = excluded.empreinte, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
        params: [ctx.compte, p.type, p.cote, p.taille, p.donnees, p.miniature, empreinte, acteur.compte, iso(t)],
      },
      evenement('trombi.photo_modifiee', { acteur: acteur.compte, entiteType: 'trombi_fiche', entiteId: ctx.compte, charge: { compte: ctx.compte }, maintenant: t }),
    ]);
    return detailDe(acteur, ctx);
  }

  async function supprimerPhoto(acteur, id) {
    const ctx = await contexteFiche(acteur, id);
    if (ctx.niveau !== 'moi' && ctx.niveau !== 'editeur') throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const fiche = ficheDe(await ficheLigne(ctx.compte));
    if (!champsVisibles(ctx.niveau, fiche.visibilite).has('photo')) throw echec(403, 'champ-prive', 'Ce champ est privé : seul le joueur le modifie.');
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM trombi_photos WHERE compte_id = ?', params: [ctx.compte] },
      evenement('trombi.photo_supprimee', { acteur: acteur.compte, entiteType: 'trombi_fiche', entiteId: ctx.compte, charge: { compte: ctx.compte }, maintenant: t }),
    ]);
    return detailDe(acteur, ctx);
  }

  /**
   * `GET /trombi/fiches/:compte/texte` : texte d'annonce en français ET en anglais (copier pour un post), avec
   * seulement les champs visibles de tous les membres (jamais le nom réel ni un champ réservé ou privé).
   */
  async function texte(acteur, id) {
    const ctx = await contexteFiche(acteur, id);
    const fiche = ficheDe(await ficheLigne(ctx.compte));
    const jeux = await jeuxConnus();
    const source = {
      pseudo: ctx.pseudo,
      teams: teamsCarte(ctx.visibles, fiche, jeux).map(t => ({ nom: t.nom, jeuNom: t.jeuNom, postes: t.postes.length ? t.postes.map(p => p.nom) : t.posteLibre ? [t.posteLibre] : [] })),
      elos: avecNomJeu(fiche.elos, jeux),
      palmares: fiche.palmares,
      calcule: await calcule(ctx.compte, ctx.visibles),
      structures: fiche.structures,
      reseaux: fiche.reseaux,
      visibilite: fiche.visibilite,
    };
    return { fr: texteFiche(source, 'fr'), en: texteFiche(source, 'en') };
  }

  return { droits, liste, detail, modifier, changerPhoto, supprimerPhoto, texte };
}

/**
 * Données de la fiche pour les visuels du CM (« Recrue », « Départ ») : postes du profil de jeu dans la team,
 * elo du jeu de la team, dernière ancienne structure — seulement ce que tous les membres peuvent voir.
 */
export async function trombiPourVisuel(base, teamId, compte) {
  const l = await base.premier('SELECT postes, elos, structures, visibilite FROM trombi_fiches WHERE compte_id = ?', [compte]);
  if (!l) return null;
  const team = await base.premier('SELECT jeu FROM teams WHERE id = ?', [teamId]);
  const j = team ? await base.premier('SELECT donnees FROM jeux WHERE cle = ?', [team.jeu]) : null;
  const roles = validerDonnees(jsonOu(j?.donnees, {}), { tolerant: true }).donnees.rolesJoueurs;
  const vis = lireVisibiliteStockee(jsonOu(l.visibilite, {}));
  const postes = (jsonOu(l.postes, {})[teamId]?.postes ?? []).map(c => roles.find(r => r.cle === c)?.nom ?? c);
  const elo = vis.elos === 'membres' ? jsonOu(l.elos, []).find(e => e.jeu === team?.jeu) : null;
  const structure = vis.structures === 'membres' ? jsonOu(l.structures, [])[0] : null;
  return { postes, elo: elo ? [elo.rang, elo.valeur].filter(Boolean).join(' · ') : '', ancienneStructure: structure?.structure ?? '' };
}
