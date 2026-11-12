/**
 * Modèles de strat choisis par le profil de jeu (migration 0075) : échelle et calibrage, migration des
 * profils et des strats existants, strat créée selon le modèle du jeu de la team (Valorant, The Finals,
 * générique), détails des maps et des capacités dans les profils (CRUD, champs propres au club protégés
 * de l'IA), images de maps déposées (lien signé, droits).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { ECHELLE_DEFAUT, calibrer, echelleEffective, joueursDuModele, metresVersUnites, modeleDuJeu, unitesVersMetres } from '../noyau/strats/modeles.mjs';
import { documentVide, validerDocument } from '../noyau/strats/document.mjs';
import { svgEtape } from '../noyau/strats/svg.mjs';
import { appliquerChangement, normaliserChangements } from '../noyau/jeux/differences.mjs';
import { donneesPourIa, reporterChampsLocaux, validerDonnees } from '../noyau/jeux/schema.mjs';
import { verifierImageJeu } from '../noyau/jeux/images.mjs';

/** Une « image » PNG minimale (en-tête IHDR correct) de `l` × `h` pixels, en base64. */
function pngBase64(l = 512, h = 512) {
  const o = new Uint8Array(64);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(o.buffer).setUint32(16, l);
  new DataView(o.buffer).setUint32(20, h);
  return Buffer.from(o).toString('base64');
}

const ASCENT = { cle: 'ascent', nom: 'Ascent', image: null };

// ------------------------------------------------------------------ Échelle

test('échelle : mètres ↔ unités du repère, calibrage par deux points, repli par défaut', () => {
  assert.equal(echelleEffective(undefined), ECHELLE_DEFAUT);
  assert.equal(echelleEffective(0), ECHELLE_DEFAUT, 'échelle absurde : repli');
  assert.equal(metresVersUnites(4, 10), 40);
  assert.equal(unitesVersMetres(40, 10), 4);
  assert.equal(metresVersUnites(5, null), 5 * ECHELLE_DEFAUT);
  assert.equal(calibrer([100, 100, 400, 500], 50), 10, '500 unités pour 50 m : 10 unités par mètre');
  assert.equal(calibrer([10, 10, 11, 10], 1), null, 'points presque confondus');
  assert.equal(calibrer([0, 0, 100, 0], 0), null);
  assert.equal(modeleDuJeu('thefinals', 'x'), 'thefinals');
  assert.equal(modeleDuJeu(undefined, 'valorant'), 'valorant');
  assert.equal(modeleDuJeu('n-importe', 'lol'), 'generique');
  assert.equal(joueursDuModele('thefinals'), 3);
  assert.equal(joueursDuModele('generique', [{ joueursParEquipe: 6 }]), 6);
  assert.equal(joueursDuModele('generique', [{ joueursParEquipe: 40 }]), 10, 'plafond du générique');
});

// ------------------------------------------------------------------ Document par modèle

test('document v3 : The Finals à trois joueurs, phases et économie propres au modèle, nouvelles zones et objets', () => {
  const d = documentVide({ carte: ASCENT, jeu: 'the-finals', modele: 'thefinals' });
  assert.equal(d.modele, 'thefinals');
  assert.equal(d.joueurs.length, 3);
  d.etapes[0].phase = 'prise';
  d.etapes[0].duree = 12;
  d.etapes[0].objets.push(
    { id: 'm1', type: 'marqueur', x: 500, y: 500, genre: 'cashout', etiquette: 'Cashout 1', couleur: '#22C55E', niveau: 2 },
    { id: 'm2', type: 'marqueur', x: 200, y: 300, genre: 'ennemi', etiquette: '', couleur: '#ef4444', equipe: 2 },
    { id: 'm3', type: 'marqueur', x: 250, y: 300, genre: 'destruction-sol', etiquette: 'Casser', couleur: '#f97316', niveau: 1 },
    { id: 'v1', type: 'vision', x: 400, y: 400, angle: -45, ouverture: 90, portee: 25, joueur: 0, couleur: '#ef4444' },
    { id: 'c1', type: 'capacite', x: 410, y: 420, agent: 'heavy', capacite: 'dome-shield', nom: 'Dome Shield', joueur: 2, couleur: '#22c55e', zone: { forme: 'cercle', rayon: 3 }, ordre: 1, t: 4 },
    { id: 'f1', type: 'fleche', points: [10, 10, 100, 100], couleur: '#ffffff', joueur: 1, t0: 0, t1: 6 },
  );
  const v = validerDocument(d);
  assert.equal(v.etapes[0].phase, 'prise');
  assert.equal(v.etapes[0].objets[0].niveau, 2);
  assert.equal(v.etapes[0].objets[1].equipe, 2);
  assert.deepEqual(validerDocument(v), v, 'idempotent');
  const refuse = modif => {
    const x = structuredClone(v);
    modif(x);
    assert.throws(() => validerDocument(x), e => e.statut === 400, String(modif));
  };
  refuse(x => (x.etapes[0].phase = 'post-plant'), 'phase Valorant dans une strat The Finals');
  refuse(x => (x.economie = 'eco'), 'pas d’économie dans The Finals');
  refuse(x => x.joueurs.push({ nom: 'Quatre', couleur: '#ffffff' }), 'quatre joueurs');
  refuse(x => (x.etapes[0].objets[0].genre = 'licorne'));
  refuse(x => (x.etapes[0].objets[4].zone = { forme: 'cercle', rayon: 500 }), 'rayon en mètres borné');
  refuse(x => (x.etapes[0].duree = 0));
  const val = documentVide({ carte: ASCENT, modele: 'valorant' });
  val.economie = 'full';
  val.etapes[0].phase = 'post-plant';
  val.etapes[0].objets.push({ id: 'w', type: 'capacite', x: 500, y: 500, agent: 'phoenix', capacite: 'blaze', nom: 'Blaze', couleur: '#ef4444', zone: { forme: 'mur', angle: 30, longueur: 18, largeur: 1, courbure: 0.4 } });
  const vv = validerDocument(val);
  assert.equal(vv.economie, 'full');
  assert.equal(vv.etapes[0].objets[0].zone.courbure, 0.4);
  // Rendu SVG (page de partage) : zones à l'échelle de la map (instantané `carte.echelle`).
  vv.carte.echelle = 10;
  assert.match(svgEtape(vv, 0), /<path d="M 500 500 Q/);
  vv.etapes[0].objets[0].zone = { forme: 'cercle', rayon: 4 };
  assert.match(svgEtape(vv, 0), /r="40\.0"/, '4 m à 10 unités par mètre');
});

test('migration v2 → v3 : zones converties en mètres (dessin inchangé sans calibrage), strat The Finals à trois joueurs', () => {
  const v2 = {
    format: 'esport-strat',
    version: 2,
    jeu: 'autre',
    carte: { cle: 'monaco', nom: 'Monaco', image: null },
    side: 'attaque',
    joueurs: ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'].map((c, i) => ({ nom: `J${i + 1}`, couleur: c, agent: null })),
    calques: { fond: { visible: true, verrou: false }, utilitaires: { visible: false, verrou: false }, dessins: { visible: true, verrou: true }, texte: { visible: true, verrou: false } },
    etapes: [
      {
        id: 'e1',
        titre: 'Départ',
        note: '',
        objets: [
          { id: 'c1', type: 'capacite', x: 100, y: 100, agent: 'x', capacite: 'Ability1', nom: 'Smoke', icone: null, joueur: 4, couleur: '#a855f7', zone: { forme: 'cercle', rayon: 40 } },
          { id: 'c2', type: 'capacite', x: 100, y: 100, agent: 'x', capacite: 'Ability2', nom: 'Mur', icone: null, joueur: 1, couleur: '#3b82f6', zone: { forme: 'mur', dx: 0, dy: 80, epaisseur: 8 } },
          { id: 'c3', type: 'capacite', x: 100, y: 100, agent: 'x', capacite: 'Grenade', nom: 'Flash', icone: null, joueur: 0, couleur: '#ef4444', zone: { forme: 'cone', rayon: 160, angle: -90, ouverture: 60 } },
        ],
      },
    ],
  };
  const v = validerDocument(v2, { modele: 'thefinals' });
  assert.equal(v.version, 3);
  assert.equal(v.modele, 'thefinals');
  assert.equal(v.joueurs.length, 3);
  const [c1, c2, c3] = v.etapes[0].objets;
  assert.equal(c1.joueur, null, 'le joueur 5 n’existe plus');
  assert.deepEqual(c1.zone, { forme: 'cercle', rayon: 40 / ECHELLE_DEFAUT });
  assert.deepEqual(c2.zone, { forme: 'mur', angle: 90, longueur: 10, largeur: 1, courbure: 0 });
  assert.deepEqual(c3.zone, { forme: 'cone', angle: -90, ouverture: 60, portee: 20 });
  assert.equal(v.calques.utilitaires.visible, false, 'calques gardés');
  assert.equal(v.calques.dessins.verrou, true);
  assert.equal(v.calques.callouts.visible, true, 'nouveaux calques visibles');
  assert.equal(v.etapes[0].duree, 5);
  assert.equal(validerDocument(v2).modele, 'generique', 'sans modèle connu : déduit du jeu');
});

// ------------------------------------------------------------------ Migration 0075 sur une base existante

test('migration 0075 : profils rattachés à leur modèle, strats existantes migrées et lisibles', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0075'));
  const t = '2026-10-01T10:00:00.000Z';
  const vide = JSON.stringify(validerDonnees({}).donnees);
  await base.executer("INSERT INTO jeux (cle, nom, couleur, statut, donnees, version, cree_le, maj_le) VALUES ('the-finals', 'The Finals', '#d31f3c', 'actif', ?, 1, ?, ?)", [vide, t, t]);
  await base.executer("INSERT INTO jeux (cle, nom, couleur, statut, donnees, version, cree_le, maj_le) VALUES ('rocket-league', 'Rocket League', '#0088ff', 'actif', ?, 1, ?, ?)", [vide, t, t]);
  for (const [id, jeu] of [['t-valo', 'valorant'], ['t-tf', 'the-finals'], ['t-rl', 'rocket-league']]) {
    await base.executer('INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, id, id, jeu, 'principal', t, t]);
  }
  const strat = (id, team, jeu) =>
    base.executer(
      "INSERT INTO strats (id, team_id, jeu, titre, carte, carte_nom, side, type, donnees, version_document, revision, tags, notes, visibilite, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, 'S', 'm', 'M', 'attaque', 'default', '{}', 2, 1, '[]', '', 'team', 'principal', ?, 'principal', ?)",
      [id, team, jeu, t, t],
    );
  await strat('s-valo', 't-valo', 'valorant');
  await strat('s-tf', 't-tf', 'autre');
  await strat('s-rl', 't-rl', 'autre');
  assert.deepEqual(await appliquerMigrations(base, toutes), toutes.filter(m => m.nom >= '0075').map(m => m.nom));
  const modeles = Object.fromEntries((await base.tous('SELECT cle, modele_strat FROM jeux', [])).map(j => [j.cle, j.modele_strat]));
  assert.equal(modeles.valorant, 'valorant');
  assert.equal(modeles['the-finals'], 'thefinals');
  assert.equal(modeles['rocket-league'], 'generique');
  assert.equal(modeles.autre, 'generique');
  const strats = Object.fromEntries((await base.tous('SELECT id, jeu, modele FROM strats', [])).map(s => [s.id, s]));
  assert.deepEqual(strats['s-valo'], { id: 's-valo', jeu: 'valorant', modele: 'valorant' });
  assert.deepEqual(strats['s-tf'], { id: 's-tf', jeu: 'the-finals', modele: 'thefinals' });
  assert.deepEqual(strats['s-rl'], { id: 's-rl', jeu: 'rocket-league', modele: 'generique' });
  await base.fermer?.();
});

// ------------------------------------------------------------------ Par l'API

async function avecJeu(b, f, cle, corps) {
  const r = await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { cle, ...corps } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
}

test('strat créée selon le modèle du jeu de la team : Valorant (5), The Finals (3), générique (format du profil)', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  await avecJeu(b, f, 'the-finals', { nom: 'The Finals', modeleStrat: 'thefinals', donnees: { formats: [{ nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] }], cartes: [{ nom: 'Monaco' }] } });
  await avecJeu(b, f, 'rocket-league', { nom: 'Rocket League', donnees: { formats: [{ nom: '2v2', equipes: 2, joueursParEquipe: 2, bo: [5] }], cartes: [{ nom: 'DFH Stadium' }] } });
  const tf = await teamAvecMembres(b, { nom: 'The Final LZ0', jeu: 'the-finals' });
  const rl = await teamAvecMembres(b, { nom: 'RL', jeu: 'rocket-league' });
  const valo = await teamAvecMembres(b, { nom: 'Valorant LZ0' });
  const creer = (teamId, carte) => b.appel(`/teams/${teamId}/strats`, { methode: 'POST', jeton: f, corps: { titre: 'Plan', carte, side: 'attaque' } });
  let r = await creer(tf.teamId, { cle: 'monaco', nom: 'Monaco' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.modele, 'thefinals');
  assert.equal(r.corps.jeu, 'the-finals');
  assert.equal(r.corps.donnees.joueurs.length, 3);
  const idTf = r.corps.id;
  // Le modèle d'une strat ne change pas, même si l'app envoie autre chose.
  const doc = { ...r.corps.donnees, modele: 'valorant', etapes: [{ ...r.corps.donnees.etapes[0], phase: 'vol' }] };
  r = await b.appel(`/teams/${tf.teamId}/strats/${idTf}`, { methode: 'PUT', jeton: f, corps: { revision: 1, donnees: doc } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.donnees.modele, 'thefinals');
  assert.equal(r.corps.donnees.etapes[0].phase, 'vol');
  r = await b.appel(`/teams/${tf.teamId}/strats/${idTf}`, { methode: 'PUT', jeton: f, corps: { revision: 2, donnees: { ...doc, economie: 'full' } } });
  assert.equal(r.statut, 400, 'économie refusée dans The Finals');
  r = await creer(rl.teamId, { cle: 'dfh-stadium', nom: 'DFH Stadium' });
  assert.equal(r.corps.modele, 'generique');
  assert.equal(r.corps.donnees.joueurs.length, 2, 'joueurs du format du profil');
  r = await creer(valo.teamId, { cle: 'ascent', nom: 'Ascent' });
  assert.equal(r.corps.modele, 'valorant');
  assert.equal(r.corps.donnees.joueurs.length, 5);
  // Listes séparées par team (chaque team son modèle), duplication : même modèle.
  assert.deepEqual((await b.appel(`/teams/${tf.teamId}/strats`, { jeton: f })).corps.strats.map(s => s.modele), ['thefinals']);
  const copie = await b.appel(`/teams/${tf.teamId}/strats/${idTf}/dupliquer`, { methode: 'POST', jeton: f, corps: {} });
  assert.equal(copie.corps.modele, 'thefinals');
  // Changer le modèle du profil (Administration › Jeux) : les nouvelles strats suivent, les anciennes gardent le leur.
  const jeu = (await b.appel('/jeux/rocket-league', { jeton: f })).corps;
  r = await b.appel('/jeux/rocket-league', { methode: 'PATCH', jeton: f, corps: { version: jeu.version, modeleStrat: 'valorant' } });
  assert.equal(r.corps.modeleStrat, 'valorant');
  assert.equal((await b.appel('/jeux/rocket-league', { methode: 'PATCH', jeton: f, corps: { version: r.corps.version, modeleStrat: 'echecs' } })).corps.code, 'profil-invalide');
  assert.equal((await creer(rl.teamId, { cle: 'dfh-stadium', nom: 'DFH Stadium' })).corps.modele, 'valorant');
  assert.equal((await b.appel(`/teams/${rl.teamId}/jeu`, { jeton: f })).corps.modeleStrat, 'valorant');
  const versions = (await b.appel('/jeux/rocket-league/versions', { jeton: f })).corps.versions;
  assert.equal(versions[0].resume.modeleStrat, true, 'historique du profil');
});

test('profil : détails des maps (calibrage, callouts, repères, étages) et capacités des personnages, validés', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  const valo = (await b.appel('/jeux/valorant', { jeton: f })).corps;
  const d = structuredClone(valo.donnees);
  const ascent = d.cartes.find(c => c.cle === 'ascent');
  ascent.echelle = { points: [100, 100, 100, 600], distance: 50 };
  ascent.zones = [{ nom: 'A Main', points: [100, 100, 200, 100, 200, 200, 100, 200] }, { nom: 'Mid', points: [400, 400, 600, 400, 500, 600], couleur: '#22C55E' }];
  ascent.reperes = [{ nom: 'Site A', type: 'site', x: 150, y: 150 }, { nom: 'Spawn attaque', type: 'spawn-attaque', x: 500, y: 950 }];
  const omen = d.personnages.find(p => p.cle === 'omen');
  omen.capacites = [{ nom: 'Dark Cover', touche: 'E', categorie: 'signature', forme: 'cercle', rayon: 4.1, duree: 15, charges: 2, cout: 150, aVerifier: true }];
  let r = await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: valo.version, donnees: d } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const a = r.corps.donnees.cartes.find(c => c.cle === 'ascent');
  assert.equal(a.echelle.pxParMetre, 10, 'unités par mètre recalculées par le serveur');
  assert.deepEqual(a.zones.map(z => z.cle), ['a-main', 'mid']);
  assert.equal(a.zones[1].couleur, '#22c55e');
  assert.equal(a.reperes[1].type, 'spawn-attaque');
  assert.deepEqual(r.corps.donnees.personnages.find(p => p.cle === 'omen').capacites[0], { cle: 'dark-cover', nom: 'Dark Cover', touche: 'E', categorie: 'signature', forme: 'cercle', rayon: 4.1, duree: 15, charges: 2, cout: 150, aVerifier: true });
  assert.equal(r.corps.donnees.cartes.find(c => c.cle === 'bind').zones, undefined, 'champs vides absents');
  const resume = (await b.appel('/jeux?tous=1', { jeton: f })).corps.jeux.find(j => j.cle === 'valorant');
  assert.equal(resume.modeleStrat, 'valorant');
  assert.deepEqual([resume.resume.cartesCalibrees, resume.resume.cartesImages, resume.resume.capacites, resume.resume.capacitesAVerifier], [1, 0, 1, 1], 'ce qu’il reste à préparer');
  const invalide = async (modif, chemin) => {
    const x = structuredClone(r.corps.donnees);
    modif(x);
    const rep = await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: r.corps.version, donnees: x } });
    assert.equal(rep.statut, 400, chemin);
    assert.equal(rep.corps.details.chemin, chemin);
  };
  const iAscent = r.corps.donnees.cartes.findIndex(c => c.cle === 'ascent');
  const iOmen = r.corps.donnees.personnages.findIndex(p => p.cle === 'omen');
  await invalide(x => (x.cartes[iAscent].zones[0].points = [1, 2, 3, 4]), `cartes.${iAscent}.zones.0.points`);
  await invalide(x => (x.cartes[iAscent].echelle = { points: [0, 0, 1, 0], distance: 10 }), `cartes.${iAscent}.echelle.distance`);
  await invalide(x => (x.cartes[iAscent].fichier = '../../etc/passwd'), `cartes.${iAscent}.fichier`);
  await invalide(x => (x.personnages[iOmen].capacites[0].rayon = 1000), `personnages.${iOmen}.capacites.0.rayon`);
  await invalide(x => x.personnages[iOmen].capacites.push({ ...x.personnages[iOmen].capacites[0] }), `personnages.${iOmen}.capacites.1.cle`);
});

test('IA : les champs propres au club (images, calibrages, callouts, capacités) ne sont ni envoyés ni écrasés', () => {
  const { donnees } = validerDonnees({
    cartes: [{ nom: 'Ascent', fichier: '0f8e2d3c-1111-4222-8333-944455556666', echelle: { points: [0, 0, 0, 100], distance: 10 }, zones: [{ nom: 'A', points: [0, 0, 10, 0, 10, 10] }] }],
    personnages: [{ nom: 'Omen', capacites: [{ nom: 'Dark Cover', forme: 'cercle', rayon: 4 }] }],
  });
  const ia = donneesPourIa(donnees);
  assert.equal(ia.cartes[0].zones, undefined);
  assert.equal(ia.cartes[0].fichier, undefined);
  assert.equal(ia.personnages[0].capacites, undefined);
  // Proposition de l'IA : la map sort du pool, et elle tente de vider les callouts.
  const { changements } = normaliserChangements(donnees, [{ section: 'cartes', operation: 'modification', cle: 'ascent', valeur: { nom: 'Ascent', actif: false, zones: [] } }]);
  assert.equal(changements.length, 1);
  const apres = appliquerChangement(donnees, changements[0]);
  assert.equal(apres.cartes[0].actif, false);
  assert.equal(apres.cartes[0].zones.length, 1, 'callouts gardés');
  assert.equal(apres.cartes[0].fichier, '0f8e2d3c-1111-4222-8333-944455556666');
  // Brouillon validé (préparé sans eux) : reportés.
  const brouillon = validerDonnees({ cartes: [{ nom: 'Ascent' }, { nom: 'Abyss' }], personnages: [{ nom: 'Omen', classe: 'controleur' }] }).donnees;
  const fusion = reporterChampsLocaux(donnees, brouillon);
  assert.equal(fusion.cartes[0].echelle.pxParMetre, 10);
  assert.equal(fusion.personnages[0].capacites[0].rayon, 4);
  assert.equal(fusion.cartes[1].zones, undefined);
});

test('images de maps : dépôt (gestionnaire), vérifiées aux octets, lien signé pour la team, purge avec le profil', async () => {
  assert.throws(() => verifierImageJeu({ type: 'image/png', donnees: Buffer.from('<svg/>').toString('base64') }), e => e.code === 'image-format');
  assert.throws(() => verifierImageJeu({ type: 'image/gif', donnees: pngBase64() }), e => e.code === 'image-format');
  assert.throws(() => verifierImageJeu({ type: 'image/png', donnees: pngBase64(9000, 10) }), e => e.code === 'image-dimensions');
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  const team = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const lea = team.sessions.lea12345;
  assert.equal((await b.appel('/jeux/valorant/images', { methode: 'POST', jeton: lea, corps: { type: 'image/png', donnees: pngBase64() } })).statut, 403);
  let r = await b.appel('/jeux/valorant/images', { methode: 'POST', jeton: f, corps: { type: 'image/png', donnees: pngBase64(1024, 768), nom: 'ascent.png' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.largeur, 1024);
  assert.equal(r.corps.hauteur, 768);
  assert.match(r.corps.url, /\/jeux\/images\/[0-9a-f-]{36}\?/);
  const idImage = r.corps.id;
  const valo = (await b.appel('/jeux/valorant', { jeton: f })).corps;
  const d = structuredClone(valo.donnees);
  d.cartes.find(c => c.cle === 'ascent').fichier = idImage;
  r = await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: valo.version, donnees: d } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.images[idImage].largeur, 1024);
  // Un membre de la team lit le profil de son jeu, avec le lien signé de l'image.
  const pourTeam = (await b.appel(`/teams/${team.teamId}/jeu`, { jeton: lea })).corps;
  const lien = pourTeam.images[idImage].url;
  assert.ok(lien.startsWith('http'), 'lien absolu');
  const img = await b.brut(lien);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await b.brut(lien.replace(/sig=[^&]+/, 'sig=faux'))).status, 403, 'signature vérifiée');
  // Suppression d'un profil (sans team) : ses images partent avec lui.
  await avecJeu(b, f, 'jeu-test', { nom: 'Jeu test' });
  const autre = await b.appel('/jeux/jeu-test/images', { methode: 'POST', jeton: f, corps: { type: 'image/png', donnees: pngBase64() } });
  assert.equal((await b.base.premier('SELECT COUNT(*) AS n FROM jeu_images WHERE jeu_cle = ?', ['jeu-test'])).n, 1);
  assert.equal((await b.appel('/jeux/jeu-test', { methode: 'DELETE', jeton: f })).statut, 200);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM jeu_images WHERE jeu_cle = ?', ['jeu-test'])).n), 0);
  assert.ok(autre.corps.id);
});
