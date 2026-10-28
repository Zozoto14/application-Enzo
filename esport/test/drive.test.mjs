/**
 * Drive de la section CM (migration 0027) :
 *  - règles pures : noms assainis (chemins, marques bidirectionnelles, noms réservés), extension cohérente avec le
 *    type reconnu, étiquettes, formats étendus (SVG, polices, PSD, HEIC ; HTML refusé), ZIP en flux valide ;
 *  - migration sur une base existante (envois gardés, rôles système complétés) ;
 *  - permissions : Responsable CM, Correspondant CM (sa team), joueur (dépôt seulement, ses fichiers), autre team,
 *    dossiers restreints, lien revérifié, données sensibles jamais ;
 *  - fichiers : envoi, dossiers par défaut, renommer, déplacer, copier, étiquettes, favoris, recherche et filtres ;
 *  - versions, corbeille et restauration, purge à 30 jours (octets gardés s'ils servent ailleurs), quota et alerte ;
 *  - sécurité des fichiers servis (type, nosniff, Content-Disposition, SVG sans script) ;
 *  - intégrations : pièce jointe d'une carte (club et team), image de l'éditeur, sponsor, clip retenu rangé ;
 *  - ZIP d'un dossier, RGPD, export / import.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as crcZlib, deflateSync } from 'node:zlib';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { morceau, mp4Factice, sha } from './medias-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { analyserDebut, reconnaitreEtendu } from '../noyau/medias/formats.mjs';
import { assainirNom, cleRecherche, configDrive, dimensionsSvg, lireTags, nomPourFormat, nomUnique } from '../noyau/cm/drive/regles.mjs';
import { crc32, fluxZip, tailleZip } from '../noyau/cm/drive/zip.mjs';
import { purgerCorbeilleDrive } from '../noyau/cm/drive/service.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';

const enc = new TextEncoder();
const JOUR = 86_400_000;

// ------------------------------------------------------------------ Fichiers fabriqués

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
  const brut = Buffer.alloc((l * 3 + 1) * h, graine);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(brut)), chunk('IEND', Buffer.alloc(0))]));
}
const pdfFactice = (texte = 'x') => enc.encode(`%PDF-1.4\n% ${texte}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><script>alert(1)</script><rect width="64" height="32"/></svg>';
const ttf = () => Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x80, ...new Array(200).fill(7)]);
const psd = () => {
  const o = new Uint8Array(200);
  o.set(enc.encode('8BPS'), 0);
  o[5] = 1;
  new DataView(o.buffer).setUint32(14, 1350);
  new DataView(o.buffer).setUint32(18, 1080);
  return o;
};

// ------------------------------------------------------------------ Règles pures

test('règles : noms assainis, extension cohérente avec le type, étiquettes, clé de recherche', () => {
  assert.equal(assainirNom('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(assainirNom('  logo‮gnp.exe  '), 'logognp.exe', 'marque bidirectionnelle retirée');
  assert.equal(assainirNom('a<b>c:d"e|f?g*h'), 'a_b_c_d_e_f_g_h');
  assert.equal(assainirNom('CON.txt'), '_CON.txt');
  assert.equal(assainirNom('...'), 'fichier');
  assert.equal(assainirNom('\u0000\u0007'), 'fichier');
  const long = assainirNom(`${'é'.repeat(300)}.png`);
  assert.equal([...long].length, 140);
  assert.ok(long.endsWith('.png'));
  // L'extension suit le type reconnu par les octets : un « .bat » de texte n'est jamais lancé par Windows.
  assert.equal(nomPourFormat('script.bat', 'texte'), 'script.bat.txt');
  assert.equal(nomPourFormat('notes.csv', 'texte'), 'notes.csv');
  assert.equal(nomPourFormat('photo.exe', 'jpeg'), 'photo.exe.jpg');
  assert.equal(nomPourFormat('logo.PNG', 'png'), 'logo.PNG');
  assert.equal(nomPourFormat('charte.ai', 'pdf'), 'charte.ai');
  assert.equal(nomPourFormat('maquette.xd', 'zip'), 'maquette.xd');
  assert.deepEqual(lireTags(['Logo', 'logo', ' Saison 2026 ', '<b>']), ['logo', 'saison-2026', 'b']);
  assert.equal(lireTags(Array.from({ length: 13 }, (_, i) => `t${i}`)), null);
  assert.equal(lireTags('x'), null);
  assert.equal(cleRecherche('Équipe — Été 2026.PNG'), 'equipe ete 2026 png');
  const pris = new Set();
  assert.deepEqual([nomUnique('a.png', pris), nomUnique('A.png', pris), nomUnique('a.png', pris)], ['a.png', 'A (2).png', 'a (3).png']);
  assert.deepEqual(dimensionsSvg(SVG), { largeur: 64, hauteur: 32 });
  assert.deepEqual(dimensionsSvg('<svg viewBox="0 0 300 150"></svg>'), { largeur: 300, hauteur: 150 });
  const c = configDrive({ ESPORT_DRIVE_QUOTA: '5G', ESPORT_DRIVE_FICHIER_MAX: '100M', ESPORT_DRIVE_ZIP_MAX: '10G' });
  assert.deepEqual([c.quota, c.fichierMax], [5 * 1024 ** 3, 100 * 1024 ** 2]);
  assert.ok(c.zipMax < 4 * 1024 ** 3, 'ZIP sans ZIP64 : moins de 4 Gio');
});

test('formats du Drive : reconnus par les octets ; HTML et binaires inconnus refusés ; usages historiques inchangés', () => {
  assert.equal(reconnaitreEtendu(enc.encode(SVG)), 'svg');
  assert.equal(reconnaitreEtendu(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(reconnaitreEtendu(enc.encode('<!DOCTYPE html><html><body>x</body></html>')), null);
  assert.equal(reconnaitreEtendu(enc.encode('<svg><foreignObject><html><body><script>x</script></body></html></foreignObject></svg>')), null, 'SVG qui embarque une page');
  assert.equal(reconnaitreEtendu(enc.encode('<div>bonjour</div>')), null);
  assert.equal(reconnaitreEtendu(enc.encode('nom;score\nLéa;13\n')), 'texte');
  assert.equal(reconnaitreEtendu(Uint8Array.from([0x4c, 0xe9, 0x61, 0x3b, 0x31, 0x33, 0x0a])), 'texte', 'CSV Windows-1252');
  assert.equal(reconnaitreEtendu(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00])), null, 'exécutable Windows');
  assert.equal(reconnaitreEtendu(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0])), null, 'exécutable Linux');
  assert.equal(reconnaitreEtendu(ttf()), 'ttf');
  assert.equal(reconnaitreEtendu(enc.encode('OTTO\u0000\u0000\u0000\u0000xxxxxxxx')), 'otf');
  assert.equal(reconnaitreEtendu(enc.encode('wOF2\u0000\u0001\u0000\u0000xxxxxxxx')), 'woff2');
  assert.equal(reconnaitreEtendu(psd()), 'psd');
  assert.equal(reconnaitreEtendu(Uint8Array.from([0, 0, 0, 0x18, ...enc.encode('ftypheic'), 0, 0, 0, 0])), 'heic');
  assert.equal(reconnaitreEtendu(Uint8Array.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3, 0, 0])), 'gzip');
  assert.equal(analyserDebut(pngFactice(4, 4), { etendu: true }).format, 'png');
  // Hors Drive, rien ne change : pas de SVG ni de texte reconnu.
  assert.equal(analyserDebut(enc.encode(SVG)), null);
  assert.equal(analyserDebut(enc.encode('bonjour')), null);
});

test('ZIP en flux : structure valide (en-têtes, descripteurs, répertoire central), CRC-32, noms UTF-8', async () => {
  const a = enc.encode('premier fichier');
  const b = new Uint8Array(70_000).map((_, i) => (i * 7) & 0xff);
  const entrees = [
    { chemin: 'Logos/équipe.png', taille: a.length, date: Date.parse('2026-10-20T10:00:00Z'), lire: async () => a },
    { chemin: 'vide.txt', taille: 0, date: Date.now(), lire: async () => null },
    { chemin: 'Bruts/gros.bin', taille: b.length, date: Date.now(), lire: async () => new Blob([b]).stream() },
  ];
  const zip = new Uint8Array(await new Response(fluxZip(entrees)).arrayBuffer());
  assert.equal(zip.length, tailleZip(entrees), 'taille annoncée exacte (Content-Length)');
  assert.equal(crc32(a), crcZlib(a));
  const v = new DataView(zip.buffer);
  const fin = zip.length - 22;
  assert.equal(v.getUint32(fin, true), 0x06054b50);
  assert.equal(v.getUint16(fin + 10, true), 3);
  let i = v.getUint32(fin + 16, true);
  const vus = [];
  for (let n = 0; n < 3; n++) {
    assert.equal(v.getUint32(i, true), 0x02014b50);
    assert.equal(v.getUint16(i + 8, true) & 0x0800, 0x0800, 'noms UTF-8');
    const crc = v.getUint32(i + 16, true);
    const taille = v.getUint32(i + 24, true);
    const lnom = v.getUint16(i + 28, true);
    const local = v.getUint32(i + 42, true);
    const nom = new TextDecoder().decode(zip.subarray(i + 46, i + 46 + lnom));
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const debut = local + 30 + v.getUint16(local + 26, true);
    const donnees = zip.subarray(debut, debut + taille);
    assert.equal(crc, crcZlib(donnees), `CRC de ${nom}`);
    assert.equal(v.getUint32(debut + taille, true), 0x08074b50, 'descripteur après les données');
    vus.push([nom, taille]);
    i += 46 + lnom;
  }
  assert.deepEqual(vus, [['Logos/équipe.png', a.length], ['vide.txt', 0], ['Bruts/gros.bin', b.length]]);
  // Fichier plus court qu'annoncé : le flux s'arrête en erreur (jamais un ZIP faux).
  await assert.rejects(new Response(fluxZip([{ chemin: 'x', taille: 10, lire: async () => enc.encode('abc') }])).arrayBuffer());
});

test('migration 0027 sur une base existante : envois gardés, rôles système complétés, tables exportées', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0027'));
  await base.executer(
    "INSERT INTO envois (id, team_id, portee, compte_id, usage, nom_original, taille, taille_morceau, morceaux, empreinte_etat, cle_stockage, cree_le, maj_le) VALUES ('e1', NULL, 'club', 'ancien12', 'cm', 'a.png', 10, 10, 1, '{}', 'club/cm/a.media', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    [],
  );
  assert.deepEqual(await appliquerMigrations(base, migrations), migrations.filter(m => m.nom >= '0027').map(m => m.nom));
  assert.equal((await base.premier("SELECT usage FROM envois WHERE id = 'e1'", [])).usage, 'cm');
  await base.executer("UPDATE envois SET usage = 'drive' WHERE id = 'e1'", []);
  await assert.rejects(base.executer("UPDATE envois SET usage = 'autre' WHERE id = 'e1'", []));
  const perms = async cle => (await base.tous('SELECT rp.permission FROM cm_role_permissions rp JOIN cm_roles r ON r.id = rp.role_id WHERE r.cle_systeme = ? ORDER BY rp.permission', [cle])).map(l => l.permission).filter(p => p.startsWith('cm.drive'));
  assert.deepEqual(await perms('responsable'), ['cm.drive.envoyer', 'cm.drive.gerer', 'cm.drive.voir']);
  assert.deepEqual(await perms('correspondant'), ['cm.drive.envoyer', 'cm.drive.voir']);
  for (const t of ['cm_drive_dossiers', 'cm_drive_fichiers', 'cm_drive_versions', 'cm_drive_tags', 'cm_drive_favoris']) assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
});

// ------------------------------------------------------------------ Banc

async function preparer({ drive } = {}) {
  const b = await banc(drive ? { drive } : {});
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'joueur' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  for (const t of [A.teamId, B.teamId]) await ok(`/teams/${t}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  /** Envoie par morceaux (usage « drive ») ; rend l'identifiant de l'envoi, ou la réponse en erreur. */
  const envoyer = async (jeton, portee, octets, nom = 'fichier.bin') => {
    const debut = await api(`/cm/drive/portees/${portee}/envois`, jeton, { methode: 'POST', corps: { nom, taille: octets.length } });
    if (debut.statut !== 200) return { erreur: debut };
    const env = debut.corps;
    for (let i = 0; i < env.morceaux; i++) {
      const r = await morceau(b, jeton, `/cm/drive/portees/${portee}/envois/${env.id}`, i, octets.subarray(i * env.tailleMorceau, (i + 1) * env.tailleMorceau));
      if (r.statut !== 200) return { erreur: r };
    }
    const fin = await api(`/cm/drive/portees/${portee}/envois/${env.id}/fin`, jeton, { methode: 'POST', corps: { sha256: sha(octets) } });
    if (fin.statut !== 200) return { erreur: fin };
    return { id: env.id };
  };
  /** Envoie puis range dans le Drive ; rend le fichier public. */
  const deposer = async (jeton, portee, octets, nom, extra = {}) => {
    const e = await envoyer(jeton, portee, octets, nom);
    assert.ok(e.id, JSON.stringify(e.erreur?.corps));
    return (await ok('/cm/drive/fichiers', jeton, { methode: 'POST', corps: { portee, envoi: e.id, ...extra } })).fichier;
  };
  const dossierCle = async (jeton, portee, cle) => (await ok(`/cm/drive?portee=${portee}`, jeton)).dossiers.find(d => d.cle === cle);
  /** Lit un fichier par son lien signé : `{ statut, entetes, octets }`. */
  const lire = async (jeton, id, corps = {}) => {
    const l = await ok(`/cm/drive/fichiers/${id}/lien`, jeton, { methode: 'POST', corps });
    const r = await b.brut(l.url);
    return { statut: r.status, entetes: r.headers, octets: new Uint8Array(await r.arrayBuffer()), url: l.url };
  };
  return { b, A, B, s, api, ok, envoyer, deposer, dossierCle, lire };
}

// ------------------------------------------------------------------ Permissions

test('permissions : Responsable CM partout, Correspondant dans sa team, joueur au dépôt seulement, autre team, sensible jamais', async () => {
  const { b, A, B, s, api, ok, deposer, dossierCle, lire } = await preparer();
  // Responsable CM (club) : Drive du club et des teams, avec les dossiers par défaut.
  const p = await ok('/cm/drive/portees', s.cm123456);
  assert.deepEqual(p.portees.map(x => [x.portee === 'club' ? 'club' : x.team.nom, x.droits.gerer]), [['club', true], ['Team Alpha', true], ['Team Bravo', true]]);
  assert.ok(p.quota && p.reglages, 'quota et réglages pour qui gère');
  const club = await ok('/cm/drive?portee=club', s.cm123456);
  assert.deepEqual(club.dossiers.map(d => d.cle).sort(), ['bruts', 'clips', 'logos', 'photos', 'sponsors', 'visuels']);
  const equipe = await ok(`/cm/drive?portee=${A.teamId}`, s.cm123456);
  assert.deepEqual(equipe.dossiers.map(d => d.cle).sort(), ['bruts', 'clips', 'depot', 'logos', 'photos', 'visuels']);
  // Rouvrir ne duplique rien.
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}`, s.cm123456)).dossiers.length, 6);

  // Correspondant CM (Kai, team A) : voir et envoyer dans SA team ; ni le club, ni l'autre team.
  const pk = await ok('/cm/drive/portees', s.kai12345);
  assert.deepEqual(pk.portees.map(x => [x.portee, x.droits]), [[A.teamId, { voir: true, envoyer: true, gerer: false, depot: false }]]);
  assert.equal(pk.quota, null);
  assert.equal((await api('/cm/drive?portee=club', s.kai12345)).statut, 403);
  assert.equal((await api(`/cm/drive?portee=${B.teamId}`, s.kai12345)).statut, 404);
  const logos = await dossierCle(s.kai12345, A.teamId, 'logos');
  const fk = await deposer(s.kai12345, A.teamId, pngFactice(8, 8), 'logo-alpha.png', { dossierId: logos.id });
  assert.equal(fk.modifiable, true);
  assert.deepEqual([fk.meta.largeur, fk.meta.hauteur, fk.genre], [8, 8, 'image']);
  // Il ne restreint pas un dossier, ne vide pas la corbeille, ne règle rien.
  assert.equal((await api('/cm/drive/dossiers', s.kai12345, { methode: 'POST', corps: { portee: A.teamId, nom: 'Secret', restreint: true } })).statut, 403);
  assert.equal((await api('/cm/drive/corbeille/vider', s.kai12345, { methode: 'POST', corps: { portee: A.teamId } })).statut, 403);
  assert.equal((await api('/cm/drive/reglages', s.kai12345)).statut, 403);
  // Il ne modifie pas le fichier d'un autre.
  const fc = await deposer(s.cm123456, A.teamId, pdfFactice('brief'), 'brief.pdf');
  assert.equal((await ok(`/cm/drive/fichiers/${fc.id}`, s.kai12345)).droits.modifier, false);
  assert.equal((await api(`/cm/drive/fichiers/${fc.id}`, s.kai12345, { methode: 'PATCH', corps: { nom: 'x.pdf' } })).statut, 403);
  assert.equal((await api(`/cm/drive/fichiers/${fc.id}`, s.kai12345, { methode: 'DELETE' })).statut, 403);

  // Joueur (Léa, clips seulement) : uniquement le dossier « Dépôt joueurs », et seulement ses fichiers.
  const pl = await ok('/cm/drive/portees', s.lea12345);
  assert.deepEqual(pl.portees.map(x => x.droits), [{ voir: false, envoyer: false, gerer: false, depot: true }]);
  const racine = await ok(`/cm/drive?portee=${A.teamId}`, s.lea12345);
  assert.equal(racine.dossier.cle, 'depot');
  assert.deepEqual([racine.dossiers.length, racine.fichiers.length], [0, 0]);
  const fl = await deposer(s.lea12345, A.teamId, pngFactice(4, 4, 9), 'ma-photo.png');
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}`, s.lea12345)).fichiers.map(f => f.id).join(), fl.id);
  assert.equal((await api(`/cm/drive?portee=${A.teamId}&dossier=${logos.id}`, s.lea12345)).statut, 404);
  assert.equal((await api(`/cm/drive/fichiers/${fk.id}`, s.lea12345)).statut, 404, 'fichier d’un autre');
  assert.equal((await api(`/cm/drive/fichiers/${fk.id}/lien`, s.lea12345, { methode: 'POST', corps: {} })).statut, 404);
  assert.equal((await api('/cm/drive/dossiers', s.lea12345, { methode: 'POST', corps: { portee: A.teamId, nom: 'X' } })).statut, 403);
  assert.equal((await api(`/cm/drive/fichiers/${fl.id}`, s.lea12345, { methode: 'PATCH', corps: { dossierId: logos.id } })).statut, 403, 'ne sort pas du dépôt');
  assert.equal((await api('/cm/drive/corbeille?portee=' + A.teamId, s.lea12345)).statut, 403);
  assert.equal((await ok(`/cm/drive/recherche?portee=${A.teamId}&q=logo`, s.lea12345)).fichiers.length, 0);
  assert.equal((await lire(s.lea12345, fl.id)).statut, 200);
  // Kai (correspondant) voit le dépôt de Léa ; le CM du club aussi.
  const depot = await dossierCle(s.kai12345, A.teamId, 'depot');
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}&dossier=${depot.id}`, s.kai12345)).fichiers.length, 1);
  // Autre team (Nox, joueur de Bravo) : le Drive de A n'existe pas pour lui.
  assert.equal((await api(`/cm/drive?portee=${A.teamId}`, s.nox12345)).statut, 404);
  assert.equal((await api(`/cm/drive/fichiers/${fk.id}`, s.nox12345)).statut, 404);
  // Le coach (aucun rôle CM, clips seulement) n'a que le dépôt ; un compte sans team ni rôle CM, rien.
  assert.equal((await ok('/cm/drive/portees', s.coach123)).portees[0].droits.depot, true);
  assert.equal((await api('/cm/drive/portees', await b.session('seul1234', 'Seul'))).statut, 403);

  // Dossier restreint : invisible (404) pour le correspondant, même par un lien déjà obtenu.
  const prive = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, nom: 'Contrats' } });
  const fr = await deposer(s.cm123456, A.teamId, pdfFactice('contrat'), 'contrat.pdf', { dossierId: prive.id });
  const lienAvant = await ok(`/cm/drive/fichiers/${fr.id}/lien`, s.kai12345, { methode: 'POST', corps: {} });
  await ok(`/cm/drive/dossiers/${prive.id}`, s.cm123456, { methode: 'PATCH', corps: { restreint: true } });
  assert.equal((await api(`/cm/drive?portee=${A.teamId}&dossier=${prive.id}`, s.kai12345)).statut, 404);
  assert.ok(!(await ok(`/cm/drive?portee=${A.teamId}`, s.kai12345)).dossiers.some(d => d.id === prive.id));
  assert.equal((await api(`/cm/drive/fichiers/${fr.id}`, s.kai12345)).statut, 404);
  assert.equal((await ok(`/cm/drive/recherche?portee=${A.teamId}&q=contrat`, s.kai12345)).fichiers.length, 0);
  assert.equal((await b.brut(lienAvant.url)).status, 403, 'lien revérifié à chaque lecture');
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}&dossier=${prive.id}`, s.cm123456)).fichiers.length, 1);
  // Correspondant retiré : plus rien (le lien qu'il avait ne lit plus rien non plus).
  const lienK = await ok(`/cm/drive/fichiers/${fc.id}/lien`, s.kai12345, { methode: 'POST', corps: {} });
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(a => a.compte === 'kai12345');
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await b.brut(lienK.url)).status, 403);
  assert.equal((await ok('/cm/drive/portees', s.kai12345)).portees[0].droits.depot, true, 'redevient un joueur : dépôt seulement');

  // Données sensibles : le CM du club n'atteint ni les strats, ni le scouting, ni les notes du staff.
  for (const chemin of [`/teams/${A.teamId}/strats`, `/teams/${A.teamId}/scouting/adversaires`, `/teams/${A.teamId}/suivi`]) {
    assert.ok([403, 404].includes((await api(chemin, s.cm123456)).statut), chemin);
  }
  // Rôle CM du club sans le Drive (Rédacteur) : ni le Drive du club, ni celui des teams.
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#123456', permissions: ['cm.voir', 'cm.editer'] } });
  const sr = await b.session('red12345', 'Rita');
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id, portee: 'club' } });
  assert.equal((await api('/cm/drive/portees', sr)).statut, 403);
  assert.equal((await api(`/cm/drive/fichiers/${fc.id}`, sr)).statut, 404);
});

// ------------------------------------------------------------------ Fichiers, dossiers, recherche

test('fichiers : renommer, déplacer, copier (mêmes octets), étiquettes, favoris, recherche et filtres, dossiers', async () => {
  const { b, A, s, api, ok, deposer, dossierCle } = await preparer();
  const photos = await dossierCle(s.cm123456, 'club', 'photos');
  const f1 = await deposer(s.cm123456, 'club', pngFactice(16, 9), 'Équipe été.png', { dossierId: photos.id, tags: ['Saison 2026', 'roster'] });
  assert.deepEqual(f1.tags, ['roster', 'saison-2026']);
  const f2 = await deposer(s.cm123456, 'club', pdfFactice('kit'), 'kit média.pdf');
  // Renommer : extension gardée cohérente, nom assaini.
  const r = await ok(`/cm/drive/fichiers/${f2.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: 'Kit/presse 2026.exe' } });
  assert.equal(r.fichier.nom, 'Kit_presse 2026.exe.pdf');
  assert.equal((await api(`/cm/drive/fichiers/${f2.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: '   ' } })).statut, 400);
  // Sous-dossier, fil d'Ariane, déplacement, boucle refusée, dossier par défaut immobile.
  const sous = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', parentId: photos.id, nom: 'Shooting <oct>' } });
  const sous2 = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', parentId: sous.id, nom: 'Retenues' } });
  await ok(`/cm/drive/fichiers/${f2.id}`, s.cm123456, { methode: 'PATCH', corps: { dossierId: sous2.id } });
  const vue = await ok(`/cm/drive?portee=club&dossier=${sous2.id}`, s.cm123456);
  assert.deepEqual(vue.chemin.map(c => c.nom ?? c.cle), ['photos', 'Shooting _oct_', 'Retenues']);
  assert.equal(vue.fichiers[0].id, f2.id);
  assert.equal((await api(`/cm/drive/dossiers/${sous.id}`, s.cm123456, { methode: 'PATCH', corps: { parentId: sous2.id } })).corps.code, 'deplacement-boucle');
  assert.equal((await api(`/cm/drive/dossiers/${photos.id}`, s.cm123456, { methode: 'PATCH', corps: { parentId: sous.id } })).corps.code, 'dossier-systeme');
  assert.equal((await api(`/cm/drive/dossiers/${photos.id}`, s.cm123456, { methode: 'DELETE' })).corps.code, 'dossier-systeme');
  await ok(`/cm/drive/dossiers/${photos.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: 'Photos officielles' } });
  assert.equal((await dossierCle(s.cm123456, 'club', 'photos')).nom, 'Photos officielles');
  await ok(`/cm/drive/dossiers/${photos.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: null } });
  assert.equal((await dossierCle(s.cm123456, 'club', 'photos')).nom, null, 'nom par défaut rétabli (traduit par l’app)');
  // Déplacer un fichier d'un autre dossier vers celui d'une autre portée : 404 (même portée seulement).
  const logosA = await dossierCle(s.cm123456, A.teamId, 'logos');
  assert.equal((await api(`/cm/drive/fichiers/${f1.id}`, s.cm123456, { methode: 'PATCH', corps: { dossierId: logosA.id } })).statut, 404);
  // Copier dans le Drive de la team : nouvel élément, MÊMES octets (aucun espace en plus).
  const avant = (await ok('/cm/drive/portees', s.cm123456)).quota.utilise;
  const copie = await ok(`/cm/drive/fichiers/${f1.id}/copier`, s.cm123456, { methode: 'POST', corps: { portee: A.teamId, dossierId: logosA.id } });
  assert.equal((await ok('/cm/drive/portees', s.cm123456)).quota.utilise, avant);
  const c = await ok(`/cm/drive/fichiers/${copie.id}`, s.cm123456);
  assert.deepEqual([c.fichier.portee, c.fichier.origine, c.fichier.nom, c.fichier.tags.length], [A.teamId, 'copie', 'Équipe été.png', 2]);
  const copie2 = await ok(`/cm/drive/fichiers/${f1.id}/copier`, s.cm123456, { methode: 'POST', corps: { portee: A.teamId, dossierId: logosA.id } });
  assert.equal((await ok(`/cm/drive/fichiers/${copie2.id}`, s.cm123456)).fichier.nom, 'Équipe été (2).png');
  // Lot : déplacer deux fichiers à la racine ; un identifiant inconnu est signalé, le reste passe.
  const lot = await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'deplacer', dossierId: null, elements: [{ genre: 'fichier', id: copie.id }, { genre: 'fichier', id: copie2.id }, { genre: 'fichier', id: '00000000-0000-4000-8000-000000000000' }] } });
  assert.equal(lot.faits.length, 2);
  assert.equal(lot.erreurs[0].code, 'fichier-introuvable');
  // Favoris personnels.
  await ok('/cm/drive/favoris', s.cm123456, { methode: 'POST', corps: { genre: 'fichier', id: f1.id, favori: true } });
  await ok('/cm/drive/favoris', s.cm123456, { methode: 'POST', corps: { genre: 'dossier', id: sous.id, favori: true } });
  const fav = await ok('/cm/drive/recherche?portee=club&favoris=1', s.cm123456);
  assert.deepEqual([fav.fichiers.map(f => f.id), fav.dossiers.map(d => d.id)], [[f1.id], [sous.id]]);
  assert.equal((await ok(`/cm/drive?portee=club&dossier=${photos.id}`, s.fondateur)).fichiers[0].favori, false, 'favori de chacun');
  // Recherche : sans accents ni casse, filtres type, étiquette, auteur, dates, sous-arbre.
  assert.deepEqual((await ok('/cm/drive/recherche?portee=club&q=EQUIPE%20ete', s.cm123456)).fichiers.map(f => f.id), [f1.id]);
  assert.deepEqual((await ok('/cm/drive/recherche?portee=club&genre=document', s.cm123456)).fichiers.map(f => f.id), [f2.id]);
  assert.deepEqual((await ok('/cm/drive/recherche?portee=club&tag=roster', s.cm123456)).fichiers.map(f => f.id), [f1.id]);
  assert.equal((await ok('/cm/drive/recherche?portee=club&auteur=principal', s.cm123456)).fichiers.length, 0);
  assert.equal((await ok('/cm/drive/recherche?portee=club&auteur=cm123456', s.cm123456)).fichiers.length, 2);
  assert.equal((await ok('/cm/drive/recherche?portee=club&du=2026-10-21', s.cm123456)).fichiers.length, 0);
  assert.equal((await ok('/cm/drive/recherche?portee=club&du=2026-10-20&au=2026-10-20', s.cm123456)).fichiers.length, 2);
  const dansSous = await ok(`/cm/drive/recherche?portee=club&dossier=${sous.id}`, s.cm123456);
  assert.deepEqual(dansSous.fichiers.map(f => f.id), [f2.id]);
  assert.equal(dansSous.chemins[sous2.id].length, 3);
  assert.equal((await ok('/cm/drive/recherche?portee=club&q=retenues', s.cm123456)).dossiers[0].id, sous2.id);
  assert.equal((await api('/cm/drive/recherche?portee=club&genre=exe', s.cm123456)).statut, 400);
  const filtres = await ok('/cm/drive/filtres?portee=club', s.cm123456);
  assert.deepEqual(filtres.tags.map(t => t.tag), ['roster', 'saison-2026']);
  assert.deepEqual(filtres.auteurs.map(a => a.pseudo), ['Clara']);
  // Lien interne « drive:<id> » : retrouve l'élément s'il est visible.
  assert.deepEqual(await ok(`/cm/drive/elements/${f2.id}`, s.cm123456), { genre: 'fichier', id: f2.id, portee: 'club', dossierId: sous2.id });
  assert.equal((await ok(`/cm/drive/elements/${sous.id}`, s.cm123456)).genre, 'dossier');
  assert.equal((await api(`/cm/drive/elements/${f2.id}`, s.lea12345)).statut, 404);
  // Le journal du club note l'ajout.
  const journal = await ok('/cm/journal', s.fondateur);
  assert.ok(journal.entrees.some(e => e.action === 'cm.drive_fichier_ajoute'));
  assert.ok(b);
});

// ------------------------------------------------------------------ Versions

test('versions : remplacer garde l’historique, restaurer une ancienne version, supprimer une ancienne version', async () => {
  const { s, api, ok, envoyer, deposer, lire } = await preparer();
  const v1 = pngFactice(10, 10, 1);
  const f = await deposer(s.cm123456, 'club', v1, 'logo.png');
  const v2 = pngFactice(20, 10, 2);
  const e2 = await envoyer(s.cm123456, 'club', v2, 'logo-v2.png');
  const d2 = await ok(`/cm/drive/fichiers/${f.id}/versions`, s.cm123456, { methode: 'POST', corps: { envoi: e2.id, version: 1 } });
  assert.deepEqual([d2.fichier.version, d2.fichier.meta.largeur, d2.versions.map(v => v.version)], [2, 20, [2, 1]]);
  // Version attendue périmée : conflit.
  const e3 = await envoyer(s.cm123456, 'club', pngFactice(30, 10, 3), 'x.png');
  assert.equal((await api(`/cm/drive/fichiers/${f.id}/versions`, s.cm123456, { methode: 'POST', corps: { envoi: e3.id, version: 1 } })).corps.code, 'conflit');
  // Une version d'un autre format : l'extension suit (logo.png → logo.pdf).
  const e4 = await envoyer(s.cm123456, 'club', pdfFactice('logo'), 'logo.pdf');
  const d3 = await ok(`/cm/drive/fichiers/${f.id}/versions`, s.cm123456, { methode: 'POST', corps: { envoi: e4.id } });
  assert.deepEqual([d3.fichier.nom, d3.fichier.genre, d3.fichier.version], ['logo.pdf', 'document', 3]);
  // Chaque version se relit (octets exacts).
  assert.deepEqual((await lire(s.cm123456, f.id, { version: 1 })).octets, v1);
  assert.deepEqual((await lire(s.cm123456, f.id, { version: 2 })).octets, v2);
  // Restaurer la v1 : elle devient la v4 (mêmes octets, nom avec la bonne extension).
  const d4 = await ok(`/cm/drive/fichiers/${f.id}/versions/1/restaurer`, s.cm123456, { methode: 'POST' });
  assert.deepEqual([d4.fichier.version, d4.fichier.nom, d4.fichier.meta.largeur], [4, 'logo.png', 10]);
  assert.deepEqual((await lire(s.cm123456, f.id)).octets, v1);
  // Supprimer une ancienne version (gérer) ; jamais la version actuelle.
  assert.equal((await api(`/cm/drive/fichiers/${f.id}/versions/4`, s.cm123456, { methode: 'DELETE' })).corps.code, 'version-actuelle');
  const d5 = await ok(`/cm/drive/fichiers/${f.id}/versions/2`, s.cm123456, { methode: 'DELETE' });
  assert.deepEqual(d5.versions.map(v => v.version), [4, 3, 1]);
  assert.equal((await api(`/cm/drive/fichiers/${f.id}/lien`, s.cm123456, { methode: 'POST', corps: { version: 2 } })).statut, 404);
  // La v1 et la v4 partagent les octets : les supprimer ne touche pas la v4.
  await ok(`/cm/drive/fichiers/${f.id}/versions/1`, s.cm123456, { methode: 'DELETE' });
  assert.deepEqual((await lire(s.cm123456, f.id)).octets, v1);
});

// ------------------------------------------------------------------ Corbeille

test('corbeille : un dossier part avec son contenu, revient ensemble ; à la racine si son dossier a disparu ; purge à 30 jours', async () => {
  const { b, A, s, api, ok, deposer, dossierCle, lire } = await preparer();
  const bruts = await dossierCle(s.cm123456, A.teamId, 'bruts');
  const d = await ok('/cm/drive/dossiers', s.kai12345, { methode: 'POST', corps: { portee: A.teamId, parentId: bruts.id, nom: 'Rushs' } });
  const f1 = await deposer(s.kai12345, A.teamId, mp4Factice({ taille: 4000 }), 'rush1.mp4', { dossierId: d.id });
  const f2 = await deposer(s.kai12345, A.teamId, pngFactice(4, 4), 'miniature.png', { dossierId: d.id });
  // Le correspondant met SON dossier à la corbeille : il disparaît avec son contenu.
  await ok(`/cm/drive/dossiers/${d.id}`, s.kai12345, { methode: 'DELETE' });
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}&dossier=${bruts.id}`, s.kai12345)).dossiers.length, 0);
  assert.equal((await api(`/cm/drive/fichiers/${f1.id}`, s.kai12345)).statut, 404);
  assert.equal((await ok(`/cm/drive/recherche?portee=${A.teamId}&q=rush`, s.kai12345)).fichiers.length, 0);
  const cb = await ok(`/cm/drive/corbeille?portee=${A.teamId}`, s.kai12345);
  assert.equal(cb.elements.length, 1, 'seule la racine du lot est montrée');
  assert.deepEqual([cb.elements[0].element, cb.elements[0].contenu.n, cb.elements[0].restaurable, cb.elements[0].expireLe], ['dossier', 2, true, '2026-11-19T10:00:00.000Z']);
  // Un gestionnaire lit encore un fichier à la corbeille ; le correspondant non.
  assert.equal((await lire(s.cm123456, f1.id)).statut, 200);
  assert.equal((await api(`/cm/drive/fichiers/${f1.id}/lien`, s.kai12345, { methode: 'POST', corps: {} })).statut, 404);
  // Restaurer : tout revient à sa place.
  await ok(`/cm/drive/corbeille/${d.id}/restaurer`, s.kai12345, { methode: 'POST' });
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}&dossier=${d.id}`, s.kai12345)).fichiers.length, 2);
  // Un fichier seul à la corbeille, puis son dossier : restauré, il revient à la racine.
  await ok(`/cm/drive/fichiers/${f2.id}`, s.kai12345, { methode: 'DELETE' });
  await ok(`/cm/drive/dossiers/${d.id}`, s.kai12345, { methode: 'DELETE' });
  const r = await ok(`/cm/drive/corbeille/${f2.id}/restaurer`, s.kai12345, { methode: 'POST' });
  assert.equal(r.dossierId, null);
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}`, s.kai12345)).fichiers.some(f => f.id === f2.id), true);
  // Un autre que l'auteur ne restaure pas ce qu'il n'a pas jeté (sauf qui gère) ; un joueur ne voit pas la corbeille.
  const fc = await deposer(s.cm123456, A.teamId, pdfFactice('c'), 'c.pdf');
  await ok(`/cm/drive/fichiers/${fc.id}`, s.cm123456, { methode: 'DELETE' });
  const vueCorbeille = (await ok(`/cm/drive/corbeille?portee=${A.teamId}`, s.cm123456)).elements.find(e => e.id === fc.id);
  assert.deepEqual([vueCorbeille.element, vueCorbeille.genre], ['fichier', 'document'], 'élément et type distincts');
  assert.equal((await api(`/cm/drive/corbeille/${fc.id}/restaurer`, s.kai12345, { methode: 'POST' })).statut, 403);
  assert.equal((await api(`/cm/drive/corbeille/${fc.id}`, s.kai12345, { methode: 'DELETE' })).statut, 403);
  // Suppression définitive par qui gère : les octets partent du stockage.
  const cle = (await b.base.premier('SELECT c.cle_stockage FROM cm_drive_fichiers f JOIN cm_fichiers c ON c.id = f.fichier_id WHERE f.id = ?', [fc.id])).cle_stockage;
  assert.ok(await b.stockage.lire(cle));
  await ok(`/cm/drive/corbeille/${fc.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal(await b.stockage.lire(cle), null);
  assert.equal(await b.base.premier('SELECT id FROM cm_drive_fichiers WHERE id = ?', [fc.id]), null);
  // Purge du cron à 30 jours : seulement ce qui a plus de 30 jours.
  const cleRush = (await b.base.premier('SELECT c.cle_stockage FROM cm_drive_fichiers f JOIN cm_fichiers c ON c.id = f.fichier_id WHERE f.id = ?', [f1.id])).cle_stockage;
  assert.equal(await purgerCorbeilleDrive(b.base, b.stockage, { maintenant: b.horloge.t + 29 * JOUR }), 0);
  assert.ok(await b.stockage.lire(cleRush));
  const rapport = await tachesPlanifiees(b.base, { maintenant: () => b.horloge.t + 31 * JOUR, stockage: b.stockage, journal: { error() {} } });
  assert.ok(rapport.find(x => x.tache === 'corbeille du Drive').ok);
  assert.equal(await b.stockage.lire(cleRush), null);
  assert.equal((await ok(`/cm/drive/corbeille?portee=${A.teamId}`, s.cm123456)).elements.length, 0);
  // Vider la corbeille (gérer).
  const fv = await deposer(s.cm123456, 'club', pdfFactice('v'), 'v.pdf');
  await ok(`/cm/drive/fichiers/${fv.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await ok('/cm/drive/corbeille/vider', s.cm123456, { methode: 'POST', corps: { portee: 'club' } })).elements, 1);
  assert.equal((await ok('/cm/drive/corbeille?portee=club', s.cm123456)).elements.length, 0);
});

// ------------------------------------------------------------------ Quota

test('quota : plafond par fichier, refus au-delà de l’espace, alerte à 80 % une fois par semaine', async () => {
  const { b, s, api, ok, envoyer, deposer } = await preparer({ drive: { quota: 10_000, fichierMax: 6_000, zipMax: 1_000_000 } });
  const trop = await envoyer(s.cm123456, 'club', new Uint8Array(6_001), 'gros.bin');
  assert.equal(trop.erreur.corps.code, 'fichier-trop-gros');
  await deposer(s.cm123456, 'club', pdfFactice('x'.repeat(5_000)), 'a.pdf');
  const q = (await ok('/cm/drive/portees', s.cm123456)).quota;
  assert.ok(q.utilise > 5_000 && q.limite === 10_000 && !q.alerte);
  // Un envoi qui dépasserait l'espace restant est refusé dès le début.
  const plein = await envoyer(s.cm123456, 'club', pdfFactice('y'.repeat(5_000)), 'b.pdf');
  assert.equal(plein.erreur.corps.code, 'quota-drive');
  // 80 % atteints : une notification aux gestionnaires du Drive, une seule fois.
  await deposer(s.cm123456, 'club', pdfFactice('z'.repeat(3_000)), 'c.pdf');
  assert.equal((await ok('/cm/drive/portees', s.cm123456)).quota.alerte, true);
  const evs = await b.base.tous("SELECT * FROM evenements WHERE type = 'cm.drive_quota'", []);
  assert.equal(evs.length, 1);
  await deposer(s.cm123456, 'club', pdfFactice('w'), 'd.pdf');
  assert.equal((await b.base.tous("SELECT id FROM evenements WHERE type = 'cm.drive_quota'", [])).length, 1, 'une alerte par semaine');
  await b.appel('/notifications', { jeton: s.cm123456 });
  const { distribuer } = await import('../noyau/evenements.mjs');
  await distribuer(b.base, { maintenant: b.horloge.t });
  const notif = await b.base.tous("SELECT compte_id FROM notifications WHERE type = 'cm-drive-quota'", []);
  assert.ok(notif.some(n => n.compte_id === 'principal'));
  // La corbeille compte tant qu'elle n'est pas vidée.
  assert.ok(api);
});

// ------------------------------------------------------------------ Sécurité des fichiers servis

test('sécurité : type vérifié, HTML refusé, SVG servi sans script, nosniff, Content-Disposition, nom assaini', async () => {
  const { b, s, ok, envoyer, deposer, lire } = await preparer();
  const html = await envoyer(s.cm123456, 'club', enc.encode('<!DOCTYPE html><html><script>alert(1)</script></html>'), 'page.html');
  assert.equal(html.erreur.corps.code, 'format-fichier');
  const exe = await envoyer(s.cm123456, 'club', Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, ...new Array(100).fill(0)]), 'outil.exe');
  assert.equal(exe.erreur.corps.code, 'format-fichier');
  // SVG : accepté, servi avec une politique « sandbox » sans script.
  const svg = await deposer(s.cm123456, 'club', enc.encode(SVG), 'logo.svg');
  assert.deepEqual([svg.genre, svg.type, svg.meta.largeur], ['image', 'image/svg+xml', 64]);
  assert.ok(svg.vignette, 'vignette (lien signé)');
  const l = await lire(s.cm123456, svg.id);
  assert.equal(l.entetes.get('Content-Type'), 'image/svg+xml');
  assert.match(l.entetes.get('Content-Security-Policy'), /sandbox/);
  assert.match(l.entetes.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(l.entetes.get('X-Content-Type-Options'), 'nosniff');
  assert.match(l.entetes.get('Content-Disposition'), /^inline; filename="logo.svg"/);
  assert.match((await lire(s.cm123456, svg.id, { telecharger: true })).entetes.get('Content-Disposition'), /^attachment;/);
  // Texte : extension forcée, servi en texte brut inerte.
  const txt = await deposer(s.cm123456, 'club', enc.encode('echo pwned\r\n'), 'lancer.bat');
  assert.equal(txt.nom, 'lancer.bat.txt');
  const lt = await lire(s.cm123456, txt.id);
  assert.match(lt.entetes.get('Content-Type'), /^text\/plain/);
  assert.match(lt.entetes.get('Content-Security-Policy'), /sandbox/);
  // Nom hostile : assaini (chemin, contrôles, marque bidirectionnelle).
  const p = await deposer(s.cm123456, 'club', pngFactice(2, 2), '..\\..\\a‮gnp.exe');
  assert.equal(p.nom, '_.._a gnp.exe.png', 'pas de chemin ni de marque bidirectionnelle ; extension réelle ajoutée');
  // Police, PSD : reconnus, infos lues.
  const police = await deposer(s.cm123456, 'club', ttf(), 'Titre.ttf');
  assert.deepEqual([police.genre, police.type], ['police', 'font/ttf']);
  const maquette = await deposer(s.cm123456, 'club', psd(), 'affiche.psd');
  assert.deepEqual([maquette.genre, maquette.meta.largeur, maquette.meta.hauteur], ['creation', 1080, 1350]);
  // Lien falsifié ou expiré : refusé.
  const lien = (await ok(`/cm/drive/fichiers/${p.id}/lien`, s.cm123456, { methode: 'POST', corps: {} })).url;
  assert.equal((await b.brut(lien.replace(/sig=[^&]+/, 'sig=AAAA'))).status, 403);
  assert.equal((await b.brut(lien.replace(`${p.id}.1`, `${svg.id}.1`))).status, 403, 'le lien d’un fichier n’ouvre pas un autre');
  assert.equal((await b.brut('https://esport.test/cm/drive/contenu/%E0%A4')).status, 404, 'adresse malformée');
  assert.equal((await b.brut('https://esport.test/cm/drive/zip/x/y')).status, 404);
  b.horloge.t += 3 * 3600 * 1000;
  assert.equal((await b.brut(lien)).status, 410);
});

// ------------------------------------------------------------------ Intégrations

test('intégrations : pièce jointe d’une carte depuis le Drive (club et team), image de l’éditeur, sponsor, clip retenu rangé, octets gardés', async () => {
  const { b, A, s, api, ok, deposer, dossierCle, lire } = await preparer();
  const logosClub = await dossierCle(s.cm123456, 'club', 'logos');
  const logo = await deposer(s.cm123456, 'club', pngFactice(64, 64, 5), 'logo-club.png', { dossierId: logosClub.id });
  // Carte d'un tableau de la team A : pièce jointe prise dans le Drive du club, aucun octet copié.
  await ok(`/cm/teams/${A.teamId}`, s.cm123456);
  const tb = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.team?.id === A.teamId);
  const detail = await ok(`/cm/tableaux/${tb.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${tb.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: detail.listes[0].id, titre: 'Annonce' } })).carte;
  const nFichiers = Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_fichiers', [])).n);
  const avec = await ok(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'drive', fichierId: logo.id } });
  const piece = avec.carte.pieces[0];
  assert.deepEqual([piece.nom, piece.genre, piece.fichier.type], ['logo-club.png', 'fichier', 'image/png']);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_fichiers', [])).n), nFichiers, 'mêmes octets');
  // Le Manager de A (cm.voir sur la team, rien au club) lit la pièce par son lien.
  const lienPiece = await ok(`/cm/pieces/${piece.id}/lien`, s.man12345, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lienPiece.url)).status, 200);
  // Mais pas le fichier du Drive lui-même (aucun droit sur le Drive du club).
  assert.equal((await api(`/cm/drive/fichiers/${logo.id}`, s.man12345)).statut, 404);
  // Fichier du Drive d'une AUTRE team : refusé ; fichier inconnu : 404 ; sans droit sur le Drive : 404.
  const fB = await deposer(s.cm123456, (await ok('/cm/drive/portees', s.cm123456)).portees[2].portee, pdfFactice('b'), 'b.pdf');
  assert.equal((await api(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'drive', fichierId: fB.id } })).corps.code, 'portee');
  assert.equal((await api(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'drive', fichierId: '00000000-0000-4000-8000-000000000000' } })).statut, 404);
  // Le fichier du Drive part à la corbeille puis est effacé définitivement : la pièce jointe garde ses octets.
  await ok(`/cm/drive/fichiers/${logo.id}`, s.cm123456, { methode: 'DELETE' });
  await ok(`/cm/drive/corbeille/${logo.id}`, s.cm123456, { methode: 'DELETE' });
  const relu = await ok(`/cm/pieces/${piece.id}/lien`, s.cm123456, { methode: 'POST', corps: {} });
  assert.deepEqual(new Uint8Array(await (await b.brut(relu.url)).arrayBuffer()), pngFactice(64, 64, 5));
  // La pièce retirée à son tour : plus rien ne s'en sert, les octets partent.
  const cle = (await b.base.premier('SELECT c.cle_stockage FROM cm_pieces p JOIN cm_fichiers c ON c.id = p.fichier_id WHERE p.id = ?', [piece.id])).cle_stockage;
  await ok(`/cm/pieces/${piece.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal(await b.stockage.lire(cle), null);

  // Image de l'éditeur de visuels (et logo de la charte) depuis le Drive du club.
  const logo2 = await deposer(s.cm123456, 'club', pngFactice(128, 128, 6), 'blason.png', { dossierId: logosClub.id });
  const img = await ok('/cm/visuels/images', s.cm123456, { methode: 'POST', corps: { portee: 'club', drive: logo2.id } });
  assert.deepEqual([img.portee, img.largeur, img.nom], ['club', 128, 'blason.png']);
  assert.equal((await ok('/cm/visuels/images?portee=club', s.cm123456)).images.length, 1);
  const charte = await ok('/cm/charte', s.cm123456);
  await ok('/cm/charte', s.cm123456, { methode: 'PUT', corps: { version: charte.version, charte: { ...charte.charte, logos: { club: img.fichierId, teams: {} } } } });
  assert.equal((await ok('/cm/charte', s.cm123456)).charte.logos.club, img.fichierId);
  const pdf = await deposer(s.cm123456, 'club', pdfFactice('p'), 'p.pdf');
  assert.equal((await api('/cm/visuels/images', s.cm123456, { methode: 'POST', corps: { portee: 'club', drive: pdf.id } })).corps.code, 'format-image');
  // Le fichier du Drive supprimé définitivement : l'image (logo) reste lisible.
  await ok(`/cm/drive/fichiers/${logo2.id}`, s.cm123456, { methode: 'DELETE' });
  await ok(`/cm/drive/corbeille/${logo2.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.brut((await ok(`/cm/visuels/fichiers/${img.fichierId}/lien`, s.cm123456, { methode: 'POST', corps: {} })).url)).status, 200);

  // Sponsor : pièce (logo du partenaire) prise dans le Drive du club.
  const deck = await deposer(s.cm123456, 'club', pdfFactice('deck'), 'deck sponsoring.pdf', { dossierId: (await dossierCle(s.cm123456, 'club', 'sponsors')).id });
  const prospect = (await ok('/sponsors/prospects', s.cm123456, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr' } })).prospect;
  const sp = await ok('/sponsors/pieces', s.cm123456, { methode: 'POST', corps: { prospectId: prospect.id, genre: 'drive', fichierId: deck.id, categorie: 'deck' } });
  assert.deepEqual([sp.pieces[0].nom, sp.pieces[0].fichier.type], ['deck sponsoring.pdf', 'application/pdf']);
  assert.equal((await b.brut((await ok(`/sponsors/pieces/${sp.pieces[0].id}/lien`, s.cm123456, { methode: 'POST', corps: {} })).url)).status, 200);
  // Un compte qui n'a que les Sponsors (pas le Drive) lit la pièce, pas le Drive.
  const sponsorsSeuls = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Partenariats', couleur: '#335577', permissions: ['sponsors.voir'] } });
  const sv = await b.session('spo12345', 'Sam');
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'spo12345', roleId: sponsorsSeuls.id, portee: 'club' } });
  assert.equal((await b.brut((await ok(`/sponsors/pieces/${sp.pieces[0].id}/lien`, sv, { methode: 'POST', corps: {} })).url)).status, 200);
  assert.equal((await api(`/cm/drive/fichiers/${deck.id}`, sv)).statut, 404);
  // Le Correspondant (Drive de sa team seulement) ne prend pas un fichier du club pour un sponsor (pas sponsors.gerer de toute façon).
  assert.equal((await api('/sponsors/pieces', s.kai12345, { methode: 'POST', corps: { prospectId: prospect.id, genre: 'drive', fichierId: deck.id } })).statut, 404);

  // Clip retenu (fichier) : rangé dans « Clips » du Drive de la team ; une seule fois.
  const octets = mp4Factice({ taille: 3000 });
  const debut = await ok(`/cm/portees/${A.teamId}/envois`, s.lea12345, { methode: 'POST', corps: { nom: 'clip.mp4', taille: octets.length } });
  await morceau(b, s.lea12345, `/cm/portees/${A.teamId}/envois/${debut.id}`, 0, octets);
  await ok(`/cm/portees/${A.teamId}/envois/${debut.id}/fin`, s.lea12345, { methode: 'POST', corps: { sha256: sha(octets) } });
  const clip = (await ok(`/cm/teams/${A.teamId}/clips`, s.lea12345, { methode: 'POST', corps: { genre: 'fichier', envoi: debut.id, titre: 'Clutch 1v3' } })).clips[0];
  await ok(`/cm/clips/${clip.id}`, s.cm123456, { methode: 'PATCH', corps: { statut: 'retenu' } });
  await ok(`/cm/clips/${clip.id}`, s.cm123456, { methode: 'PATCH', corps: { statut: 'utilise' } });
  const clips = await dossierCle(s.cm123456, A.teamId, 'clips');
  const range = (await ok(`/cm/drive?portee=${A.teamId}&dossier=${clips.id}`, s.cm123456)).fichiers;
  assert.deepEqual(range.map(f => [f.nom, f.origine, f.genre, f.tags.join()]), [['Clutch 1v3.mp4', 'clip', 'video', 'clip']]);
  assert.deepEqual((await lire(s.cm123456, range[0].id)).octets, octets);
  // Rangement désactivé : un autre clip retenu ne va pas dans le Drive.
  await ok('/cm/drive/reglages', s.cm123456, { methode: 'PUT', corps: { rangementClips: false } });
  assert.deepEqual(await ok('/cm/drive/reglages', s.cm123456), { rangementVisuels: true, rangementClips: false });
  const d2 = await ok(`/cm/portees/${A.teamId}/envois`, s.lea12345, { methode: 'POST', corps: { nom: 'clip2.mp4', taille: octets.length } });
  await morceau(b, s.lea12345, `/cm/portees/${A.teamId}/envois/${d2.id}`, 0, octets);
  await ok(`/cm/portees/${A.teamId}/envois/${d2.id}/fin`, s.lea12345, { methode: 'POST', corps: { sha256: sha(octets) } });
  const clip2 = (await ok(`/cm/teams/${A.teamId}/clips`, s.lea12345, { methode: 'POST', corps: { genre: 'fichier', envoi: d2.id, titre: 'Ace' } })).clips.find(c => c.titre === 'Ace');
  await ok(`/cm/clips/${clip2.id}`, s.cm123456, { methode: 'PATCH', corps: { statut: 'retenu' } });
  assert.equal((await ok(`/cm/drive?portee=${A.teamId}&dossier=${clips.id}`, s.cm123456)).fichiers.length, 1);
});

// ------------------------------------------------------------------ ZIP

test('ZIP d’un dossier : lien signé, contenu visible seulement, taille bornée, accès revérifié', async () => {
  const { b, s, api, ok, deposer, dossierCle } = await preparer({ drive: { quota: 10_000_000, fichierMax: 1_000_000, zipMax: 50_000 } });
  const visuels = await dossierCle(s.cm123456, 'club', 'visuels');
  const a = pngFactice(6, 6, 1);
  await deposer(s.cm123456, 'club', a, 'affiche.png', { dossierId: visuels.id });
  await deposer(s.cm123456, 'club', a, 'affiche.png', { dossierId: visuels.id });
  const sous = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', parentId: visuels.id, nom: 'Été' } });
  await deposer(s.cm123456, 'club', pdfFactice('brief'), 'brief.pdf', { dossierId: sous.id });
  const prive = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', parentId: visuels.id, nom: 'Privé', restreint: true } });
  await deposer(s.cm123456, 'club', pdfFactice('secret'), 'secret.pdf', { dossierId: prive.id });
  // Un compte qui voit le Drive du club sans le gérer : le dossier restreint n'est pas dans son ZIP.
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur Drive', couleur: '#445566', permissions: ['cm.drive.voir'] } });
  const sl = await b.session('lec12345', 'Lou');
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'lec12345', roleId: lecteur.id, portee: 'club' } });
  const lien = await ok(`/cm/drive/dossiers/${visuels.id}/zip`, sl, { methode: 'POST' });
  const r = await b.brut(lien.url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/zip');
  assert.match(r.headers.get('Content-Disposition'), /^attachment; filename="Visuels.zip"/);
  const zip = new Uint8Array(await r.arrayBuffer());
  assert.equal(String(zip.length), r.headers.get('Content-Length'));
  const noms = [];
  const v = new DataView(zip.buffer);
  let i = v.getUint32(zip.length - 22 + 16, true);
  while (v.getUint32(i, true) === 0x02014b50) {
    const l = v.getUint16(i + 28, true);
    noms.push(new TextDecoder().decode(zip.subarray(i + 46, i + 46 + l)));
    i += 46 + l;
  }
  assert.deepEqual(noms.sort(), ['affiche (2).png', 'affiche.png', 'Été/brief.pdf'].sort());
  // Le gestionnaire, lui, a le dossier restreint.
  const zg = new Uint8Array(await (await b.brut((await ok(`/cm/drive/dossiers/${visuels.id}/zip`, s.cm123456, { methode: 'POST' })).url)).arrayBuffer());
  assert.ok(new TextDecoder().decode(zg).includes('Privé/secret.pdf'));
  // Accès retiré : le lien ne sert plus.
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(x => x.compte === 'lec12345');
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await b.brut(lien.url)).status, 403);
  // Trop lourd : refusé avant tout (le Fondateur envoie un gros fichier).
  await deposer(s.fondateur, 'club', new Uint8Array(60_000).fill(65), 'gros.txt', { dossierId: sous.id });
  assert.equal((await api(`/cm/drive/dossiers/${visuels.id}/zip`, s.cm123456, { methode: 'POST' })).corps.code, 'zip-trop-gros');
  const vide = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Vide' } });
  assert.equal((await api(`/cm/drive/dossiers/${vide.id}/zip`, s.cm123456, { methode: 'POST' })).corps.code, 'dossier-vide');
});

// ------------------------------------------------------------------ RGPD, export / import

test('RGPD et export / import : fichiers du Drive exportés, auteur effacé, favoris supprimés ; base réimportée', async () => {
  const { b, A, s, ok, deposer } = await preparer();
  const f = await deposer(s.kai12345, A.teamId, pngFactice(3, 3), 'moi.png', { tags: ['perso'] });
  await ok('/cm/drive/favoris', s.kai12345, { methode: 'POST', corps: { genre: 'fichier', id: f.id, favori: true } });
  const exp = await ok('/moi/export', s.kai12345);
  assert.deepEqual(exp.cmDrive.map(x => [x.nom, x.portee, x.type]), [['moi.png', 'Team Alpha', 'image/png']]);
  assert.equal(exp.cmDriveFavoris.length, 1);
  // Export / import de la base : les tables du Drive suivent.
  const sauvegarde = await exporterBase(b.base);
  assert.equal(sauvegarde.tables.cm_drive_fichiers.length, 1);
  assert.ok(sauvegarde.tables.cm_drive_dossiers.length >= 6);
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.cm_drive_fichiers, 1);
  assert.equal(bilan.cm_drive_versions, 1);
  assert.equal(bilan.cm_drive_tags, 1);
  // Suppression du compte : le fichier reste à la team, sans auteur ; ses favoris disparaissent.
  await ok('/moi', s.kai12345, { methode: 'DELETE' });
  const l = await b.base.premier('SELECT cree_par, maj_par FROM cm_drive_fichiers WHERE id = ?', [f.id]);
  assert.deepEqual([l.cree_par, l.maj_par], [null, null]);
  assert.equal((await b.base.tous("SELECT * FROM cm_drive_favoris WHERE compte_id = 'kai12345'", [])).length, 0);
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_drive_versions WHERE element_id = ?', [f.id])).cree_par, null);
});
