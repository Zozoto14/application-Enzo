/**
 * Drive (migration 0039) : déplacer à la souris (cycles interdits, permissions, déplacement groupé et annulation,
 * POST + X-Methode), nouveautés par compte (permissions, ses propres ajouts exclus, « vu » par dossier, tout marquer
 * comme vu, nouvelles versions, événement `drive.ajout` hors du journal), dossiers des visuels (dossiers par défaut,
 * rangement par genre, dossier choisi, déplacement, cycles, suppression qui fait remonter le contenu), RGPD et
 * export.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as crcZlib, deflateSync } from 'node:zlib';
import { banc, teamAvecMembres } from './aide.mjs';
import { morceau, sha } from './medias-aide.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { servicesDriveCm } from '../noyau/cm/drive/service.mjs';
import { distribuer } from '../noyau/evenements.mjs';

const enc = new TextEncoder();
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crcZlib(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
};
function pngFactice(l, h, graine = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((l * 3 + 1) * h, graine))), chunk('IEND', Buffer.alloc(0))]));
}
const pdf = (texte = 'x') => enc.encode(`%PDF-1.4\n% ${texte}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
    },
  });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps, entetes: o.entetes });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  // Chaque action avance l'horloge (les dates « vu » et d'ajout se comparent à la milliseconde).
  const tic = () => {
    b.horloge.t += 1000;
  };
  const deposer = async (jeton, portee, octets, nom, extra = {}) => {
    tic();
    const debut = (await ok(`/cm/drive/portees/${portee}/envois`, jeton, { methode: 'POST', corps: { nom, taille: octets.length } }));
    for (let i = 0; i < debut.morceaux; i++) {
      const r = await morceau(b, jeton, `/cm/drive/portees/${portee}/envois/${debut.id}`, i, octets.subarray(i * debut.tailleMorceau, (i + 1) * debut.tailleMorceau));
      assert.equal(r.statut, 200);
    }
    await ok(`/cm/drive/portees/${portee}/envois/${debut.id}/fin`, jeton, { methode: 'POST', corps: { sha256: sha(octets) } });
    return { envoi: debut.id, fichier: extra.versionDe ? null : (await ok('/cm/drive/fichiers', jeton, { methode: 'POST', corps: { portee, envoi: debut.id, ...extra } })).fichier };
  };
  const dossier = async (jeton, portee, nom, parentId = null, extra = {}) => {
    tic();
    return (await ok('/cm/drive/dossiers', jeton, { methode: 'POST', corps: { portee, nom, parentId, ...extra } })).id;
  };
  const dossierCle = async (jeton, portee, cle) => (await ok(`/cm/drive?portee=${portee}`, jeton)).dossiers.find(d => d.cle === cle);
  const parentDe = async id => (await b.base.premier('SELECT parent_id FROM cm_drive_dossiers WHERE id = ?', [id])).parent_id ?? null;
  const dossierDe = async id => (await b.base.premier('SELECT dossier_id FROM cm_drive_fichiers WHERE id = ?', [id])).dossier_id ?? null;
  return { b, A, s, api, ok, tic, deposer, dossier, dossierCle, parentDe, dossierDe };
}

// ------------------------------------------------------------------ Déplacer

test('déplacer : jamais dans lui-même ni un descendant, dossier par défaut à la racine, POST + X-Methode', async () => {
  const { A, s, api, ok, dossier, parentDe, dossierCle } = await preparer();
  const p = A.teamId;
  const a = await dossier(s.cm123456, p, 'Saison');
  const b1 = await dossier(s.cm123456, p, 'Semaine 1', a);
  const c = await dossier(s.cm123456, p, 'Jour 1', b1);
  for (const cible of [a, b1, c]) {
    const r = await api(`/cm/drive/dossiers/${a}`, s.cm123456, { methode: 'PATCH', corps: { parentId: cible } });
    assert.equal(r.statut, 409, `dans ${cible}`);
    assert.equal(r.corps.code, 'deplacement-boucle');
  }
  // En lot : l'erreur est rendue pour l'élément, le reste passe.
  const d = await dossier(s.cm123456, p, 'Divers');
  const lot = await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'deplacer', elements: [{ genre: 'dossier', id: a }, { genre: 'dossier', id: d }], dossierId: c } });
  assert.deepEqual(lot.faits, [d]);
  assert.deepEqual(lot.erreurs.map(e => [e.id, e.code]), [[a, 'deplacement-boucle']]);
  assert.deepEqual(lot.avant, { [d]: null }, 'emplacement d’avant des seuls éléments déplacés');
  assert.equal(await parentDe(d), c);
  // Un dossier par défaut reste à la racine.
  const logos = await dossierCle(s.cm123456, p, 'logos');
  assert.equal((await api(`/cm/drive/dossiers/${logos.id}`, s.cm123456, { methode: 'PATCH', corps: { parentId: a } })).corps.code, 'dossier-systeme');
  // L'hébergement bloque PATCH : POST + X-Methode est traité exactement pareil (l'app passe toujours par là).
  const r = await api(`/cm/drive/dossiers/${d}`, s.cm123456, { methode: 'POST', corps: { parentId: null }, entetes: { 'X-Methode': 'PATCH' } });
  assert.equal(r.statut, 200);
  assert.equal(await parentDe(d), null);
  const r2 = await api(`/cm/drive/dossiers/${a}`, s.cm123456, { methode: 'POST', corps: { parentId: b1 }, entetes: { 'X-Methode': 'PATCH' } });
  assert.equal(r2.corps.code, 'deplacement-boucle');
});

test('déplacer : permissions (fichiers des autres, dépôt des joueurs, dossier restreint invisible)', async () => {
  const { A, s, api, ok, deposer, dossier, dossierDe, dossierCle } = await preparer();
  const p = A.teamId;
  const fc = (await deposer(s.cm123456, p, pdf('cm'), 'brief.pdf')).fichier;
  const fk = (await deposer(s.kai12345, p, pdf('kai'), 'notes.pdf')).fichier;
  const dk = await dossier(s.kai12345, p, 'Kai');
  // Le correspondant déplace ses fichiers, pas ceux des autres.
  const lot = await ok('/cm/drive/lot', s.kai12345, { methode: 'POST', corps: { action: 'deplacer', elements: [{ genre: 'fichier', id: fk.id }, { genre: 'fichier', id: fc.id }], dossierId: dk } });
  assert.deepEqual(lot.faits, [fk.id]);
  assert.deepEqual(lot.erreurs.map(e => e.code), ['permission']);
  assert.equal(await dossierDe(fc.id), null);
  // Dossier restreint : n'existe pas pour lui (404), même comme destination.
  const prive = await dossier(s.cm123456, p, 'Contrats', null, { restreint: true });
  assert.equal((await api(`/cm/drive/fichiers/${fk.id}`, s.kai12345, { methode: 'PATCH', corps: { dossierId: prive } })).statut, 404);
  // Le gestionnaire, lui, y range tout.
  await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'deplacer', elements: [{ genre: 'fichier', id: fk.id }, { genre: 'dossier', id: dk }], dossierId: prive } });
  assert.equal(await dossierDe(fk.id), prive);
  // Un joueur (dépôt seulement) ne sort rien du dépôt.
  const depot = await dossierCle(s.cm123456, p, 'depot');
  const fl = (await deposer(s.lea12345, p, pngFactice(4, 4, 1), 'photo.png')).fichier;
  assert.equal(fl.dossierId, depot.id);
  const r = await ok('/cm/drive/lot', s.lea12345, { methode: 'POST', corps: { action: 'deplacer', elements: [{ genre: 'fichier', id: fl.id }], dossierId: null } });
  assert.deepEqual(r.erreurs.map(e => e.code), ['permission']);
});

test('déplacer : groupé (fichiers et dossiers de plusieurs endroits), puis « Annuler » remet chacun à sa place', async () => {
  const { A, s, ok, deposer, dossier, dossierDe, parentDe, dossierCle } = await preparer();
  const p = A.teamId;
  const logos = (await dossierCle(s.cm123456, p, 'logos')).id;
  const photos = (await dossierCle(s.cm123456, p, 'photos')).id;
  const f1 = (await deposer(s.cm123456, p, pngFactice(4, 4, 2), 'a.png', { dossierId: logos })).fichier;
  const f2 = (await deposer(s.cm123456, p, pngFactice(4, 4, 3), 'b.png', { dossierId: photos })).fichier;
  const d1 = await dossier(s.cm123456, p, 'Vieux', logos);
  const cible = await dossier(s.cm123456, p, 'Archive');
  const elements = [{ genre: 'fichier', id: f1.id }, { genre: 'fichier', id: f2.id }, { genre: 'dossier', id: d1 }];
  const r = await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'deplacer', elements, dossierId: cible } });
  assert.deepEqual(r.faits.sort(), [f1.id, f2.id, d1].sort());
  assert.deepEqual(r.avant, { [f1.id]: logos, [f2.id]: photos, [d1]: logos });
  assert.deepEqual([await dossierDe(f1.id), await dossierDe(f2.id), await parentDe(d1)], [cible, cible, cible]);
  // Annuler (ce que fait l'app) : un lot par emplacement d'origine.
  const parOrigine = new Map();
  for (const e of elements) {
    const o = r.avant[e.id];
    if (!parOrigine.has(o)) parOrigine.set(o, []);
    parOrigine.get(o).push(e);
  }
  for (const [o, els] of parOrigine) await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'deplacer', elements: els, dossierId: o } });
  assert.deepEqual([await dossierDe(f1.id), await dossierDe(f2.id), await parentDe(d1)], [logos, photos, logos]);
});

// ------------------------------------------------------------------ Nouveautés

test('nouveautés : par compte, ses propres ajouts exclus, versions, sous-dossiers, vu à l’ouverture, tout marquer comme vu', async () => {
  const { b, A, s, ok, tic, deposer, dossier, dossierCle } = await preparer();
  const p = A.teamId;
  const n = async (jeton, portee = p) => ok(`/cm/drive/nouveautes?portee=${portee}`, jeton);
  // Premier passage : rien n'est nouveau (ce qui existait avant n'encombre pas les pastilles).
  const logos = (await dossierCle(s.cm123456, p, 'logos')).id;
  const avant = (await deposer(s.cm123456, p, pdf('ancien'), 'ancien.pdf')).fichier;
  for (const j of [s.kai12345, s.cm123456, s.fondateur, s.lea12345]) assert.equal((await n(j)).total, 0);
  void avant;
  tic();

  // Clara (CM) ajoute un fichier dans Logos, un dossier à la racine, un fichier dans un sous-dossier de Logos.
  const f1 = (await deposer(s.cm123456, p, pngFactice(4, 4, 5), 'logo.png', { dossierId: logos })).fichier;
  const sous = await dossier(s.cm123456, p, 'Variantes', logos);
  await deposer(s.cm123456, p, pngFactice(4, 4, 6), 'logo-blanc.png', { dossierId: sous });
  await dossier(s.cm123456, p, 'Semaine 42');
  let k = await n(s.kai12345);
  // Logos : le fichier, le sous-dossier et le fichier du sous-dossier ; racine : le dossier « Semaine 42 ».
  assert.equal(k.total, 4);
  assert.equal(k.dossiers[logos], 3);
  assert.equal(k.dossiers[sous], 1);
  assert.equal(k.racine, 1);
  assert.equal((await n(s.cm123456)).total, 0, 'ses propres ajouts ne comptent pas');

  // Kai ouvre Logos (vu=1) : ce qui est DANS Logos est vu ; le sous-dossier garde sa nouveauté.
  tic();
  const ouvert = await ok(`/cm/drive?portee=${p}&dossier=${logos}&vu=1`, s.kai12345);
  assert.equal(ouvert.nouveautes.dossiers[logos], 1);
  assert.equal(ouvert.nouveautes.dossiers[sous], 1);
  k = await n(s.kai12345);
  assert.deepEqual([k.total, k.dossiers[logos], k.racine], [2, 1, 1]);
  tic();
  await ok('/cm/drive/vu', s.kai12345, { methode: 'POST', corps: { portee: p, dossierId: sous } });
  assert.equal((await n(s.kai12345)).dossiers[logos], undefined);

  // Nouvelle version par quelqu'un d'autre : nouveauté ; par soi-même : rien.
  tic();
  const fk = (await deposer(s.kai12345, p, pdf('kai'), 'plan.pdf', { dossierId: logos })).fichier;
  assert.equal((await n(s.kai12345)).dossiers[logos], undefined);
  const cmAvant = (await n(s.cm123456)).total;
  assert.equal(cmAvant, 1, 'le fichier de Kai est nouveau pour Clara');
  await ok(`/cm/drive?portee=${p}&dossier=${logos}&vu=1`, s.cm123456);
  assert.equal((await n(s.cm123456)).total, 0);
  const v = await deposer(s.cm123456, p, pdf('kai v2'), 'plan.pdf', { versionDe: fk.id });
  await ok(`/cm/drive/fichiers/${fk.id}/versions`, s.cm123456, { methode: 'POST', corps: { envoi: v.envoi } });
  assert.equal((await n(s.kai12345)).dossiers[logos], 1, 'nouvelle version de son fichier par Clara');
  assert.equal((await n(s.cm123456)).total, 0, 'sa propre version ne compte pas');
  void f1;

  // Tout marquer comme vu (toutes les portées).
  tic();
  await ok('/cm/drive/tout-vu', s.kai12345, { methode: 'POST', corps: {} });
  assert.equal((await n(s.kai12345)).total, 0);
  assert.equal((await b.base.tous("SELECT dossier FROM cm_drive_vus WHERE compte_id = 'kai12345'", [])).map(l => l.dossier).join(), '*', 'les autres marques deviennent inutiles');

  // Sans portée : un total par Drive visible (pastilles de la tuile et des onglets).
  tic();
  await deposer(s.kai12345, p, pdf('nouveau'), 'compte-rendu.pdf');
  const g = await ok('/cm/drive/nouveautes', s.cm123456);
  assert.equal(g.total, 1);
  assert.deepEqual(g.portees.find(x => x.portee === p).total, 1);
  assert.equal(g.portees.find(x => x.portee === 'club').total, 0);
});

test('nouveautés : seulement ce que le compte voit (dossier restreint, dépôt des joueurs) ; événement drive.ajout', async () => {
  const { b, A, s, ok, tic, deposer, dossier, dossierCle } = await preparer();
  const p = A.teamId;
  const n = async jeton => (await ok(`/cm/drive/nouveautes?portee=${p}`, jeton)).total;
  for (const j of [s.kai12345, s.fondateur, s.lea12345, s.cm123456]) assert.equal(await n(j), 0);
  tic();
  // Dossier restreint créé par Clara : le Fondateur (gère) le voit, Kai (correspondant) non.
  const prive = await dossier(s.cm123456, p, 'Contrats', null, { restreint: true });
  await deposer(s.cm123456, p, pdf('contrat'), 'contrat.pdf', { dossierId: prive });
  assert.equal(await n(s.kai12345), 0);
  assert.equal(await n(s.fondateur), 2);
  // Dépôt des joueurs : Léa ne voit que ses fichiers (ceux de Kai dans le dépôt ne comptent pas pour elle).
  const depot = (await dossierCle(s.cm123456, p, 'depot')).id;
  await deposer(s.kai12345, p, pngFactice(4, 4, 9), 'kai.png', { dossierId: depot });
  assert.equal(await n(s.lea12345), 0);
  await deposer(s.lea12345, p, pngFactice(4, 4, 8), 'lea.png');
  assert.equal(await n(s.lea12345), 0, 'ses propres dépôts ne comptent pas');
  assert.equal(await n(s.kai12345), 1, 'le dépôt de Léa est nouveau pour le correspondant');

  // Événement de bus `drive.ajout` : format simple ; hors du journal ; destinataires = ceux qui voient l'élément.
  const evs = await b.base.tous("SELECT * FROM evenements WHERE type = 'drive.ajout' ORDER BY cree_le, id", []);
  assert.equal(evs.length, 4);
  const charge = JSON.parse(evs[1].charge);
  assert.deepEqual(Object.keys(charge).sort(), ['auteur', 'dossierId', 'element', 'genre', 'nom', 'portee', 'type', 'version']);
  assert.deepEqual([charge.type, charge.auteur], ['fichier', 'cm123456']);
  assert.deepEqual([charge.element, charge.genre, charge.dossierId, charge.portee, evs[1].acteur_id, evs[1].team_id], ['fichier', 'ajout', prive, p, 'cm123456', p]);
  assert.equal(JSON.parse(evs[0].charge).element, 'dossier');
  const drive = servicesDriveCm({ base: b.base, maintenant: () => b.horloge.t });
  const dest = await drive.destinatairesAjout(evs[1]);
  assert.ok(dest.includes('principal'));
  assert.ok(!dest.includes('kai12345'), 'dossier restreint : pas le correspondant');
  assert.ok(!dest.includes('cm123456'), 'jamais l’auteur');
  assert.ok((await drive.destinatairesAjout(evs[3])).includes('kai12345'));
  assert.ok(!(await drive.destinatairesAjout(evs[3])).includes('lea12345'));
  await distribuer(b.base, { maintenant: b.horloge.t });
  assert.equal((await b.base.tous("SELECT id FROM journal WHERE action = 'drive.ajout'", [])).length, 0);
  assert.ok((await b.base.tous("SELECT id FROM journal WHERE action = 'cm.drive_fichier_ajoute'", [])).length >= 3);
});

test('nouveautés : RGPD (export, effacement) et export de la base', async () => {
  const { b, A, s, ok } = await preparer();
  await ok(`/cm/drive?portee=${A.teamId}&vu=1`, s.kai12345);
  assert.ok(TABLES.some(([t]) => t === 'cm_drive_vus'));
  assert.ok(TABLES.some(([t]) => t === 'cm_visuels_dossiers'));
  const { exportCm, effacementCm } = await import('../noyau/cm/rgpd.mjs');
  const e = await exportCm(b.base, 'kai12345');
  assert.deepEqual(e.cmDriveVus.map(v => v.dossier).sort(), ['*', 'racine']);
  await b.base.lot(await effacementCm(b.base, 'kai12345'));
  assert.equal((await b.base.tous("SELECT * FROM cm_drive_vus WHERE compte_id = 'kai12345'", [])).length, 0);
});

// ------------------------------------------------------------------ Dossiers des visuels

const docCarre = () => ({ format: 'carre', fond: { type: 'uni', couleur: 'charte:fond' }, calques: [{ id: 't1', type: 'texte', x: 80, y: 80, l: 900, h: 200, texte: 'X', police: 'charte:titre', taille: 96, graisse: 800, couleur: { type: 'uni', couleur: 'charte:primaire' } }] });

test('dossiers des visuels : par défaut, rangement par genre, dossier choisi, déplacer (cycles, annuler), supprimer, permissions', async () => {
  const { A, s, api, ok } = await preparer();
  const liste = await ok('/cm/visuels/dossiers?portee=club', s.cm123456);
  assert.deepEqual(liste.dossiers.map(d => d.cle).sort(), ['annonces', 'divers', 'programmes', 'recrues', 'resultats', 'sponsors']);
  assert.equal(liste.editer, true);
  const parCle = Object.fromEntries(liste.dossiers.map(d => [d.cle, d.id]));
  assert.equal((await ok('/cm/visuels/dossiers?portee=club', s.cm123456)).dossiers.length, 6, 'pas de doublon');

  // Un modèle créé sans dossier va dans celui de son genre ; une copie reste dans le dossier de l'original.
  const m = (await ok('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Score', type: 'resultat', documents: { carre: docCarre() } } })).modele;
  assert.equal(m.dossierId, parCle.resultats);
  // Un visuel (sans carte) dans un dossier choisi.
  const saison = (await ok('/cm/visuels/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Saison 2026' } })).id;
  const v = (await ok('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: 'club', modele: 'defaut:libre', format: 'carre', langue: 'fr', source: { genre: 'libre' }, dossierId: saison } })).visuel;
  assert.equal(v.dossierId, saison);
  const v2 = (await ok('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: 'club', modele: 'defaut:libre', format: 'carre', langue: 'fr', source: { genre: 'libre' } } })).visuel;
  assert.equal(v2.dossierId, parCle.divers);
  assert.equal((await api('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: 'club', modele: 'defaut:libre', format: 'carre', langue: 'fr', source: { genre: 'libre' }, dossierId: '00000000-0000-4000-8000-000000000000' } })).statut, 404);
  const copie = (await ok(`/cm/modeles/${m.id}/dupliquer`, s.cm123456, { methode: 'POST', corps: {} })).modele;
  assert.equal(copie.dossierId, parCle.resultats);

  // Déplacer (groupé) : modèle, visuel et dossier ; « avant » pour annuler.
  const sous = (await ok('/cm/visuels/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Playoffs', parentId: saison } })).id;
  const r = await ok('/cm/visuels/deplacer', s.cm123456, { methode: 'POST', corps: { elements: [{ genre: 'modele', id: m.id }, { genre: 'visuel', id: v2.id }], dossierId: sous } });
  assert.deepEqual(r.avant, { [m.id]: parCle.resultats, [v2.id]: parCle.divers });
  assert.equal((await ok(`/cm/modeles/${m.id}`, s.cm123456)).modele.dossierId, sous);
  // Cycles et dossiers par défaut refusés.
  const boucle = await ok('/cm/visuels/deplacer', s.cm123456, { methode: 'POST', corps: { elements: [{ genre: 'dossier', id: saison }, { genre: 'dossier', id: parCle.annonces }], dossierId: sous } });
  assert.deepEqual(boucle.erreurs.map(e => e.code), ['deplacement-boucle', 'dossier-systeme']);
  assert.equal((await api(`/cm/visuels/dossiers/${saison}`, s.cm123456, { methode: 'POST', corps: { parentId: saison }, entetes: { 'X-Methode': 'PATCH' } })).corps.code, 'deplacement-boucle');
  // Renommer (POST + X-Methode), puis supprimer « Saison 2026 » : son contenu remonte à la racine.
  await ok(`/cm/visuels/dossiers/${saison}`, s.cm123456, { methode: 'POST', corps: { nom: 'Saison 26' }, entetes: { 'X-Methode': 'PATCH' } });
  await ok(`/cm/visuels/dossiers/${saison}`, s.cm123456, { methode: 'DELETE' });
  const apres = (await ok('/cm/visuels/dossiers?portee=club', s.cm123456)).dossiers;
  assert.equal(apres.find(d => d.id === sous).parentId, null);
  assert.equal((await ok(`/cm/visuels/${v.id}`, s.cm123456)).visuel.dossierId, null);
  assert.equal(apres.find(d => d.id === sous).modeles, 1);
  assert.equal((await api(`/cm/visuels/dossiers/${parCle.divers}`, s.cm123456, { methode: 'DELETE' })).corps.code, 'dossier-systeme');

  // Permissions : le correspondant d'une team ne range rien au club ; une team a ses propres dossiers.
  assert.equal((await api('/cm/visuels/dossiers', s.kai12345, { methode: 'POST', corps: { portee: 'club', nom: 'X' } })).statut, 403);
  const dep = await ok('/cm/visuels/deplacer', s.kai12345, { methode: 'POST', corps: { elements: [{ genre: 'modele', id: m.id }], dossierId: null } });
  assert.equal(dep.erreurs[0].code, 'permission');
  const team = await ok(`/cm/visuels/dossiers?portee=${A.teamId}`, s.cm123456);
  assert.equal(team.dossiers.length, 6);
  assert.ok(team.dossiers.every(d => !apres.some(x => x.id === d.id)));
  // Un dossier d'une autre portée n'est pas une destination.
  const autre = await ok('/cm/visuels/deplacer', s.cm123456, { methode: 'POST', corps: { elements: [{ genre: 'modele', id: m.id }], dossierId: team.dossiers[0].id } });
  assert.equal(autre.erreurs[0].code, 'dossier-introuvable');
});

test('centre de notifications : drive.ajout (nom, type, dossier, portée, auteur) ; jamais pour qui ne voit pas un dossier restreint', async () => {
  const { b, A, s, ok, tic, deposer, dossier } = await preparer();
  const p = A.teamId;
  const centre = async jeton => (await ok('/notifications/centre?categories=drive', jeton)).liste.filter(n => (n.evenement ?? n.type) === 'drive.ajout');
  const ouvert = await dossier(s.cm123456, p, 'Saison');
  const prive = await dossier(s.cm123456, p, 'Contrats', null, { restreint: true });
  await deposer(s.cm123456, p, pdf('public'), 'planning.pdf', { dossierId: ouvert });
  const secret = (await deposer(s.cm123456, p, pdf('contrat'), 'contrat.pdf', { dossierId: prive })).fichier;
  tic();
  await distribuer(b.base, { maintenant: b.horloge.t });
  const kai = await centre(s.kai12345);
  assert.ok(kai.some(n => n.charge?.nom === 'planning.pdf'), 'le correspondant voit l’ajout public');
  assert.ok(!kai.some(n => ['contrat.pdf', 'Contrats'].includes(n.charge?.nom)), 'ni le fichier ni le dossier restreints');
  const f = await centre(s.fondateur);
  const n = f.find(x => x.charge?.nom === 'contrat.pdf');
  assert.ok(n, 'le Fondateur (gère le Drive) le voit');
  assert.deepEqual([n.charge.type, n.charge.dossierId, n.charge.portee, n.charge.auteur], ['fichier', prive, p, 'cm123456']);
  assert.ok(!(await centre(s.lea12345)).length, 'joueuse sans Drive : rien');
  // Dossier restreint APRÈS coup : les notifications déjà affichées se resserrent.
  await ok(`/cm/drive/dossiers/${ouvert}`, s.cm123456, { methode: 'PATCH', corps: { restreint: true } });
  assert.ok(!(await centre(s.kai12345)).some(x => x.charge?.nom === 'planning.pdf'));
  void secret;
});
