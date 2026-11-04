/**
 * Fichiers dans DATA › Ressources (migration 0051, docs/esport/cm.md « Fichiers » et docs/esport/drive.md « Dossier
 * Ressources ») :
 *
 *  - envoi d'un et de plusieurs fichiers (une ressource par fichier) : rangés dans le dossier système « Ressources » du
 *    Drive du club (restreint, créé au premier envoi), titre par défaut, aperçu et téléchargement par lien signé, types
 *    dangereux refusés, quota du Drive ;
 *  - choix depuis un Drive : simple référence (rien n'est copié), la ressource suit sa source ;
 *  - ressource restreinte : aucun accès à son fichier pour un compte non autorisé, ni par le Drive (liste, recherche,
 *    détail, ZIP, corbeille, lien signé), ni par un lien signé forgé (ressource, Drive, fichier CM) ; retrait immédiat ;
 *  - le fichier ne se déplace, ne se copie, ne se joint ailleurs ni ne part à la corbeille que par sa ressource ;
 *  - remplacer (nouvelle version), suppression (corbeille du Drive ou effacement), export / import, RGPD.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as crcZlib, deflateSync } from 'node:zlib';
import { CLE, banc, teamAvecMembres } from './aide.mjs';
import { morceau, sha } from './medias-aide.mjs';
import { cheminSigne } from '../noyau/fichiers.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';

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
  const brut = Buffer.alloc((l * 3 + 1) * h, graine);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(brut)), chunk('IEND', Buffer.alloc(0))]));
}
const pdfFactice = (texte = 'x') => enc.encode(`%PDF-1.4\n% ${texte}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><script>alert(1)</script><rect width="64" height="32"/></svg>';
const contient = (valeur, ...aiguilles) => aiguilles.some(a => JSON.stringify(valeur).includes(a));

async function preparer({ drive } = {}) {
  const b = await banc(drive ? { drive } : {});
  const A = await teamAvecMembres(b, { membres: { kai12345: { pseudo: 'Kai', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.osc12345 = await b.session('osc12345', 'Oscar');
  s.lyn12345 = await b.session('lyn12345', 'Lyna');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Clara et Oscar : Responsables CM du club (Drive compris) ; Lyna : rédactrice (sans Drive) ; Vera : lectrice.
  for (const c of ['cm123456', 'osc12345']) await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: c, roleId: 'cm-role-responsable', portee: 'club' } });
  const redac = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédaction', couleur: '#335577', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'lyn12345', roleId: redac.id, portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecture', couleur: '#123456', permissions: ['cm.voir'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'vue12345', roleId: lecteur.id, portee: 'club' } });

  /** Envoi par morceaux (usage « drive ») vers `portee` (« ressources » : depuis DATA › Ressources). */
  const envoyer = async (jeton, portee, octets, nom) => {
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
  /** Ressource « fichier » envoyée depuis Ressources. */
  const ressourceEnvoyee = async (jeton, octets, nom, extra = {}) => {
    const e = await envoyer(jeton, 'ressources', octets, nom);
    assert.ok(e.id, JSON.stringify(e.erreur?.corps));
    return (await ok('/cm/liens', jeton, { methode: 'POST', corps: { genre: 'fichier', envoi: e.id, ...extra } })).lien;
  };
  /** Fichier rangé dans le Drive (`portee`, dossier facultatif). */
  const deposerDrive = async (jeton, portee, octets, nom, extra = {}) => {
    const e = await envoyer(jeton, portee, octets, nom);
    assert.ok(e.id, JSON.stringify(e.erreur?.corps));
    return (await ok('/cm/drive/fichiers', jeton, { methode: 'POST', corps: { portee, envoi: e.id, ...extra } })).fichier;
  };
  /** Lit le fichier d'une ressource par son lien signé : `{ statut, entetes, octets, url }`. */
  const lire = async (jeton, id, corps = {}) => {
    const l = await ok(`/cm/liens/${id}/fichier/lien`, jeton, { methode: 'POST', corps });
    const r = await b.brut(l.url);
    return { statut: r.status, entetes: r.headers, octets: new Uint8Array(await r.arrayBuffer()), url: l.url };
  };
  /** Lien signé FORGÉ (avec la clé du serveur) pour un compte, comme s'il l'avait obtenu. */
  const forge = async (genre, fichierId, compte) => `https://esport.test${(await cheminSigne(CLE, { fichierId, compte, maintenant: b.horloge.t, duree: 3600_000, genre })).chemin}`;
  const dossierRessources = () => b.base.premier("SELECT * FROM cm_drive_dossiers WHERE portee = 'club' AND cle = 'ressources'", []);
  return { b, A, s, api, ok, envoyer, ressourceEnvoyee, deposerDrive, lire, forge, dossierRessources };
}

test('envoi d’un et de plusieurs fichiers : une ressource par fichier, dossier « Ressources » restreint, aperçu, téléchargement, types refusés', async () => {
  const { b, s, api, ok, envoyer, ressourceEnvoyee, lire, dossierRessources } = await preparer();
  // Lyna (rédactrice, sans aucun droit sur le Drive) envoie deux fichiers d'un coup : deux ressources.
  const png = pngFactice(16, 9);
  const pdf = pdfFactice('charte');
  const r1 = await ressourceEnvoyee(s.lyn12345, png, 'Logo officiel.png', { categorie: 'Charte', epingle: true });
  const r2 = await ressourceEnvoyee(s.lyn12345, pdf, 'charte.pdf', { titre: 'Charte graphique 2026', description: 'À jour' });
  assert.deepEqual([r1.genre, r1.titre, r1.url, r1.hote, r1.categorie, r1.epingle], ['fichier', 'Logo officiel.png', '', '', 'Charte', true], 'titre par défaut : le nom du fichier');
  assert.deepEqual([r1.fichier.etat, r1.fichier.source, r1.fichier.nom, r1.fichier.genre, r1.fichier.taille, r1.fichier.meta.largeur, r1.fichier.remplacer], ['ok', 'envoi', 'Logo officiel.png', 'image', png.length, 16, true]);
  assert.ok(r1.fichier.vignette?.includes('/cm/liens/contenu/'), 'vignette par lien signé de la ressource');
  assert.deepEqual([r2.titre, r2.fichier.genre, r2.fichier.type], ['Charte graphique 2026', 'document', 'application/pdf']);
  const liste = await ok('/cm/liens', s.vue12345);
  assert.deepEqual(liste.liens.filter(l => l.genre === 'fichier').map(l => l.id).sort(), [r1.id, r2.id].sort(), 'Vera (lectrice) les voit');
  // Aperçu (inline) et téléchargement (attachment), octets exacts, nosniff.
  const vue = await lire(s.vue12345, r1.id);
  assert.equal(vue.statut, 200);
  assert.deepEqual(vue.octets, png);
  assert.equal(vue.entetes.get('X-Content-Type-Options'), 'nosniff');
  assert.match(vue.entetes.get('Content-Disposition'), /^inline; filename="Logo officiel.png"/);
  assert.match((await lire(s.vue12345, r2.id, { telecharger: true })).entetes.get('Content-Disposition'), /^attachment;/);
  // Rangés dans le dossier système « Ressources » du Drive du club : restreint, créé une seule fois.
  const d = await dossierRessources();
  assert.equal(Number(d.restreint), 1);
  assert.equal((await b.base.tous("SELECT id FROM cm_drive_dossiers WHERE cle = 'ressources'", [])).length, 1);
  const lignes = await b.base.tous('SELECT * FROM cm_drive_fichiers WHERE ressource_id IS NOT NULL ORDER BY cree_le', []);
  assert.deepEqual(lignes.map(f => [f.dossier_id, f.portee, f.origine]), [[d.id, 'club', 'ressource'], [d.id, 'club', 'ressource']]);
  assert.equal((await b.base.premier('SELECT portee FROM cm_fichiers WHERE id = ?', [lignes[0].fichier_id])).portee, 'club');
  // Un gestionnaire du Drive (Clara) les y voit ; le dossier ne s'ouvre pas à tous.
  const contenu = await ok(`/cm/drive?portee=club&dossier=${d.id}`, s.cm123456);
  assert.equal(contenu.fichiers.length, 2);
  assert.equal((await api(`/cm/drive/dossiers/${d.id}`, s.cm123456, { methode: 'PATCH', corps: { restreint: false } })).corps.code, 'dossier-systeme');
  assert.equal((await api(`/cm/drive/dossiers/${d.id}`, s.cm123456, { methode: 'DELETE' })).corps.code, 'dossier-systeme');
  // Vera (sans cm.editer) n'envoie rien ; Lyna n'envoie pas dans le Drive lui-même.
  assert.equal((await envoyer(s.vue12345, 'ressources', pdfFactice(), 'x.pdf')).erreur.statut, 403);
  assert.equal((await envoyer(s.lyn12345, 'club', pdfFactice(), 'x.pdf')).erreur.statut, 403);
  // Types dangereux refusés comme dans le Drive (HTML, exécutable) ; SVG servi sans script ; nom assaini.
  assert.equal((await envoyer(s.lyn12345, 'ressources', enc.encode('<!DOCTYPE html><html><script>alert(1)</script></html>'), 'page.html')).erreur.corps.code, 'format-fichier');
  assert.equal((await envoyer(s.lyn12345, 'ressources', Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, ...new Array(100).fill(0)]), 'outil.exe')).erreur.corps.code, 'format-fichier');
  const svg = await ressourceEnvoyee(s.lyn12345, enc.encode(SVG), '..\\logo.svg');
  assert.ok(!svg.fichier.nom.includes('\\') && !svg.fichier.nom.includes('/'));
  const ls = await lire(s.lyn12345, svg.id);
  assert.match(ls.entetes.get('Content-Security-Policy'), /sandbox/);
  // Un envoi déjà rattaché ne sert pas deux fois ; ni un envoi d'un autre compte.
  const e = await envoyer(s.lyn12345, 'ressources', pdfFactice('y'), 'y.pdf');
  await ok('/cm/liens', s.lyn12345, { methode: 'POST', corps: { genre: 'fichier', envoi: e.id } });
  assert.equal((await api('/cm/liens', s.lyn12345, { methode: 'POST', corps: { genre: 'fichier', envoi: e.id } })).statut, 409);
  const e2 = await envoyer(s.lyn12345, 'ressources', pdfFactice('z'), 'z.pdf');
  assert.equal((await api('/cm/liens', s.cm123456, { methode: 'POST', corps: { genre: 'fichier', envoi: e2.id } })).statut, 404);
  // Une ressource fichier n'a pas d'adresse.
  assert.equal((await api(`/cm/liens/${r1.id}`, s.lyn12345, { methode: 'PATCH', corps: { url: 'https://exemple.fr' } })).corps.code, 'url');
  assert.equal((await api('/cm/liens', s.lyn12345, { methode: 'POST', corps: { genre: 'fichier' } })).corps.code, 'fichier');
});

test('ressource restreinte : son fichier n’est exposé par aucune route (Drive, liens signés forgés) ; retrait immédiat', async () => {
  const { b, s, api, ok, ressourceEnvoyee, lire, forge, dossierRessources } = await preparer();
  const secret = pdfFactice('contrat secret');
  const r = await ressourceEnvoyee(s.cm123456, secret, 'Contrat-Sponsor-Secret.pdf', { acces: 'restreint', regles: [] });
  assert.equal(r.acces, 'restreint');
  const f = await b.base.premier('SELECT * FROM cm_drive_fichiers WHERE ressource_id = ?', [r.id]);
  const d = await dossierRessources();
  const secrets = ['Contrat-Sponsor-Secret', r.id, f.id];
  // Oscar gère tout le Drive et le CM, mais n'est pas de la ressource : rien, nulle part.
  assert.ok(!contient(await ok('/cm/liens', s.osc12345), ...secrets));
  const dossier = await ok(`/cm/drive?portee=club&dossier=${d.id}`, s.osc12345);
  assert.equal(dossier.fichiers.length, 0, 'liste du dossier « Ressources »');
  assert.ok(!contient(await ok('/cm/drive?portee=club', s.osc12345), ...secrets), 'racine (compteur du dossier compris)');
  assert.equal((await ok('/cm/drive?portee=club', s.osc12345)).dossiers.find(x => x.id === d.id)?.fichiers, 0);
  assert.equal((await ok('/cm/drive/recherche?portee=club&q=contrat', s.osc12345)).fichiers.length, 0, 'recherche');
  assert.ok(!contient(await ok('/cm/drive/filtres?portee=club', s.osc12345), 'cm123456'), 'filtres (auteurs)');
  for (const [chemin, methode, corps] of [
    [`/cm/drive/fichiers/${f.id}`, 'GET'],
    [`/cm/drive/fichiers/${f.id}/lien`, 'POST', {}],
    [`/cm/drive/fichiers/${f.id}`, 'PATCH', { nom: 'x.pdf' }],
    [`/cm/drive/fichiers/${f.id}`, 'DELETE'],
    [`/cm/drive/fichiers/${f.id}/copier`, 'POST', {}],
    [`/cm/drive/elements/${f.id}`, 'GET'],
    [`/cm/liens/${r.id}/fichier/lien`, 'POST', {}],
    [`/cm/liens/${r.id}/fichier`, 'POST', { envoi: '00000000-0000-4000-8000-000000000000' }],
  ]) {
    const x = await api(chemin, s.osc12345, { methode, corps });
    assert.equal(x.statut, 404, `${methode} ${chemin} : ${x.statut}`);
    assert.ok(!contient(x.corps, 'Contrat-Sponsor-Secret'), chemin);
  }
  assert.equal((await api(`/cm/drive/dossiers/${d.id}/zip`, s.osc12345, { methode: 'POST' })).corps.code, 'dossier-vide', 'ZIP');
  assert.equal((await ok('/cm/drive/favoris', s.osc12345, { methode: 'POST', corps: { genre: 'dossier', id: d.id, favori: true } })).ok, true);
  assert.equal((await api('/cm/drive/favoris', s.osc12345, { methode: 'POST', corps: { genre: 'fichier', id: f.id, favori: true } })).statut, 404);
  // Cartes : le fichier ne se joint pas, même par qui le voit.
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'Brief' } })).carte;
  assert.equal((await api(`/cm/cartes/${carte.id}/pieces`, s.osc12345, { methode: 'POST', corps: { genre: 'drive', fichierId: f.id } })).statut, 404);
  assert.equal((await api(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'drive', fichierId: f.id } })).corps.code, 'fichier-ressource');
  // Liens signés FORGÉS pour Oscar (ressource, version du Drive, fichier CM) : 403.
  assert.equal((await b.brut(await forge('ressource', `${r.id}.1`, 'osc12345'))).status, 403, 'lien de ressource forgé');
  assert.equal((await b.brut(await forge('drive', `${f.id}.1`, 'osc12345'))).status, 403, 'lien du Drive forgé');
  assert.equal((await b.brut(await forge('cm', f.fichier_id, 'osc12345'))).status, 403, 'lien de fichier CM forgé');
  assert.equal((await b.brut(await forge('ressource', `${r.id}.1`, 'vue12345'))).status, 403);
  // Le Fondateur et Clara (créatrice) le lisent ; le lien d'une ressource n'ouvre pas une autre.
  assert.deepEqual((await lire(s.fondateur, r.id)).octets, secret);
  const lc = await lire(s.cm123456, r.id);
  assert.equal(lc.statut, 200);
  assert.equal((await b.brut(await forge('drive', `${f.id}.1`, 'cm123456'))).status, 200, 'par le Drive aussi, pour qui la voit');
  // Notifications, journal : jamais le nom du fichier pour Oscar.
  assert.ok(!contient(await ok('/cm/journal', s.osc12345), ...secrets));
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.osc12345), ...secrets));
  // Partagée avec Oscar : il voit le fichier partout ; retirée : son lien déjà obtenu ne lit plus rien (retrait immédiat).
  await ok(`/cm/liens/${r.id}/partage`, s.cm123456, { methode: 'POST', corps: { comptes: ['osc12345'] } });
  assert.equal((await ok(`/cm/drive?portee=club&dossier=${d.id}`, s.osc12345)).fichiers.length, 1);
  const lo = await lire(s.osc12345, r.id);
  assert.equal(lo.statut, 200);
  const lienDrive = (await ok(`/cm/drive/fichiers/${f.id}/lien`, s.osc12345, { methode: 'POST', corps: {} })).url;
  await ok(`/cm/liens/${r.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [] } });
  assert.equal((await b.brut(lo.url)).status, 403, 'lien de la ressource');
  assert.equal((await b.brut(lienDrive)).status, 403, 'lien du Drive');
  assert.equal((await ok(`/cm/drive?portee=club&dossier=${d.id}`, s.osc12345)).fichiers.length, 0);
  // Ouverte à toute l'équipe CM : le dossier reste réservé aux gestionnaires du Drive (Lyna lit par la ressource seulement).
  await ok(`/cm/liens/${r.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'tous', regles: [] } });
  assert.equal((await lire(s.lyn12345, r.id)).statut, 200);
  assert.equal((await api(`/cm/drive/fichiers/${f.id}`, s.lyn12345)).statut, 404);
  assert.equal((await b.brut(await forge('drive', `${f.id}.1`, 'lyn12345'))).status, 403);
});

test('le fichier d’une ressource se gère par la ressource : ni déplacé, ni copié, ni à la corbeille par le Drive ; il se renomme ; aucun événement du Drive', async () => {
  const { b, s, api, ok, ressourceEnvoyee } = await preparer();
  const r = await ressourceEnvoyee(s.cm123456, pdfFactice('kit'), 'kit.pdf');
  const f = await b.base.premier('SELECT * FROM cm_drive_fichiers WHERE ressource_id = ?', [r.id]);
  const autre = (await ok('/cm/drive?portee=club', s.cm123456)).dossiers.find(x => x.cle === 'bruts');
  assert.equal((await api(`/cm/drive/fichiers/${f.id}`, s.cm123456, { methode: 'PATCH', corps: { dossierId: autre.id } })).corps.code, 'fichier-ressource');
  assert.equal((await api(`/cm/drive/fichiers/${f.id}/copier`, s.cm123456, { methode: 'POST', corps: { dossierId: autre.id } })).corps.code, 'fichier-ressource');
  assert.equal((await api(`/cm/drive/fichiers/${f.id}`, s.cm123456, { methode: 'DELETE' })).corps.code, 'fichier-ressource');
  const lot = await ok('/cm/drive/lot', s.cm123456, { methode: 'POST', corps: { action: 'corbeille', elements: [{ genre: 'fichier', id: f.id }] } });
  assert.equal(lot.erreurs[0].code, 'fichier-ressource');
  const n = await ok(`/cm/drive/fichiers/${f.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: 'kit média.pdf' } });
  assert.equal(n.fichier.nom, 'kit média.pdf');
  assert.equal((await ok('/cm/liens', s.cm123456)).liens.find(l => l.id === r.id).fichier.nom, 'kit média.pdf');
  // Aucun événement du Drive ne nomme un fichier de ressource.
  assert.equal((await b.base.tous("SELECT id FROM evenements WHERE (type LIKE 'cm.drive%' OR type = 'drive.ajout') AND entite_id = ?", [f.id])).length, 0);
});

test('choix depuis un Drive : référence sans copie ; la ressource suit sa source (« Fichier d’un Drive auquel vous n’avez pas accès »)', async () => {
  const { b, A, s, api, ok, deposerDrive, lire, forge } = await preparer();
  const contrats = await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Contrats', restreint: true } });
  const prive = await deposerDrive(s.cm123456, 'club', pdfFactice('nda'), 'NDA-Partenaire.pdf', { dossierId: contrats.id });
  const avant = Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_drive_fichiers', [])).n);
  const r = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { genre: 'fichier', elementId: prive.id, titre: 'Accord de confidentialité', categorie: 'Juridique' } })).lien;
  assert.deepEqual([r.genre, r.titre, r.fichier.source, r.fichier.etat, r.fichier.nom, r.fichier.portee], ['fichier', 'Accord de confidentialité', 'drive', 'ok', 'NDA-Partenaire.pdf', 'club']);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_drive_fichiers', [])).n), avant, 'rien n’est copié');
  assert.equal((await b.base.premier('SELECT element_id FROM cm_liens WHERE id = ?', [r.id])).element_id, prive.id);
  // Lyna et Vera voient la ressource (ouverte à tous), mais pas le fichier : ni nom, ni lien.
  for (const [compte, jeton] of [['lyn12345', s.lyn12345], ['vue12345', s.vue12345]]) {
    const l = (await ok('/cm/liens', jeton)).liens.find(x => x.id === r.id);
    assert.deepEqual(l.fichier, { source: 'drive', etat: 'inaccessible' }, compte);
    assert.ok(!contient(await ok('/cm/liens', jeton), 'NDA-Partenaire', prive.id), compte);
    const x = await api(`/cm/liens/${r.id}/fichier/lien`, jeton, { methode: 'POST', corps: {} });
    assert.deepEqual([x.statut, x.corps.code], [403, 'drive-inaccessible']);
    assert.equal((await b.brut(await forge('ressource', `${r.id}.1`, compte))).status, 403, 'lien forgé');
  }
  // Oscar (gère le Drive) le lit ; Clara aussi.
  assert.equal((await lire(s.osc12345, r.id)).statut, 200);
  // Lyna ne remplace pas le fichier source (elle peut modifier la ressource, pas le fichier dans son Drive).
  const e = await (async () => {
    const debut = await api('/cm/drive/portees/ressources/envois', s.lyn12345, { methode: 'POST', corps: { nom: 'v2.pdf', taille: pdfFactice('v2').length } });
    return debut.corps;
  })();
  assert.equal((await api(`/cm/liens/${r.id}/fichier`, s.lyn12345, { methode: 'POST', corps: { envoi: e.id } })).corps.code, 'drive-inaccessible');
  // Un fichier qu'on ne voit pas dans le Drive ne se choisit pas ; ni un fichier d'une ressource.
  assert.equal((await api('/cm/liens', s.lyn12345, { methode: 'POST', corps: { genre: 'fichier', elementId: prive.id } })).statut, 404);
  // Drive d'une team : Kai (correspondant de la team) n'est pas lecteur des Ressources ; la ressource du club suit sa source.
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  const fTeam = await deposerDrive(s.cm123456, A.teamId, pngFactice(4, 4), 'logo-team.png');
  const rt = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { genre: 'fichier', elementId: fTeam.id, titre: 'Logo de la team' } })).lien;
  assert.equal(rt.fichier.portee, A.teamId);
  assert.equal((await ok('/cm/liens', s.lyn12345)).liens.find(x => x.id === rt.id).fichier.etat, 'inaccessible');
  // Source à la corbeille : « supprimé » pour tous ; restaurée : de retour.
  await ok(`/cm/drive/fichiers/${fTeam.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await ok('/cm/liens', s.cm123456)).liens.find(x => x.id === rt.id).fichier.etat, 'supprime');
  assert.equal((await api(`/cm/liens/${rt.id}/fichier/lien`, s.cm123456, { methode: 'POST', corps: {} })).statut, 404);
  await ok(`/cm/drive/corbeille/${fTeam.id}/restaurer`, s.cm123456, { methode: 'POST' });
  assert.equal((await ok('/cm/liens', s.cm123456)).liens.find(x => x.id === rt.id).fichier.etat, 'ok');
  // Supprimer la ressource ne touche jamais au fichier source.
  await ok(`/cm/liens/${r.id}`, s.cm123456, { methode: 'DELETE' });
  assert.ok(await b.base.premier('SELECT id FROM cm_drive_fichiers WHERE id = ? AND supprime_le IS NULL', [prive.id]));
});

test('remplacer le fichier (nouvelle version), suppression : corbeille du Drive (ressource ouverte) ou effacement (restreinte)', async () => {
  const { b, s, api, ok, envoyer, ressourceEnvoyee, lire } = await preparer();
  const v1 = pngFactice(10, 10, 1);
  const r = await ressourceEnvoyee(s.lyn12345, v1, 'affiche.png');
  const v2 = pdfFactice('affiche v2');
  const e2 = await envoyer(s.lyn12345, 'ressources', v2, 'affiche-v2.pdf');
  const apres = (await ok(`/cm/liens/${r.id}/fichier`, s.lyn12345, { methode: 'POST', corps: { envoi: e2.id, version: 1 } })).lien;
  assert.deepEqual([apres.fichier.version, apres.fichier.nom, apres.fichier.genre], [2, 'affiche.pdf', 'document']);
  assert.deepEqual((await lire(s.lyn12345, r.id)).octets, v2);
  assert.deepEqual((await lire(s.lyn12345, r.id, { version: 1 })).octets, v1, 'l’ancienne version reste dans l’historique');
  const e3 = await envoyer(s.lyn12345, 'ressources', pdfFactice('v3'), 'v3.pdf');
  assert.equal((await api(`/cm/liens/${r.id}/fichier`, s.lyn12345, { methode: 'POST', corps: { envoi: e3.id, version: 1 } })).corps.code, 'conflit');
  // Vera (lectrice) ne remplace rien.
  assert.equal((await api(`/cm/liens/${r.id}/fichier`, s.vue12345, { methode: 'POST', corps: { envoi: e3.id } })).statut, 403);
  // Journal : l'événement de la ressource (pas du Drive).
  assert.ok((await b.base.tous("SELECT id FROM evenements WHERE type = 'cm.lien_version' AND entite_id = ?", [r.id])).length === 1);

  // Ressource ouverte supprimée (cm.gerer) : le fichier part à la corbeille du Drive (gestionnaires), restaurable.
  const f = await b.base.premier('SELECT * FROM cm_drive_fichiers WHERE ressource_id = ?', [r.id]);
  await ok(`/cm/liens/${r.id}`, s.cm123456, { methode: 'DELETE' });
  const cb = (await ok('/cm/drive/corbeille?portee=club', s.cm123456)).elements.find(x => x.id === f.id);
  assert.ok(cb, 'dans la corbeille du Drive');
  assert.equal(cb.restaurable, true);
  assert.equal((await b.base.premier('SELECT ressource_id FROM cm_drive_fichiers WHERE id = ?', [f.id])).ressource_id, null);
  await ok(`/cm/drive/corbeille/${f.id}/restaurer`, s.cm123456, { methode: 'POST' });
  assert.equal((await ok('/cm/drive/recherche?portee=club&q=affiche', s.cm123456)).fichiers.length, 1);

  // Ressource restreinte supprimée : fichier effacé tout de suite (lignes et octets), jamais dans la corbeille.
  const secret = await ressourceEnvoyee(s.cm123456, pdfFactice('secret'), 'secret.pdf', { acces: 'restreint', regles: [] });
  const fs = await b.base.premier('SELECT f.*, c.cle_stockage FROM cm_drive_fichiers f JOIN cm_fichiers c ON c.id = f.fichier_id WHERE f.ressource_id = ?', [secret.id]);
  assert.ok(await b.stockage.lire(fs.cle_stockage));
  await ok(`/cm/liens/${secret.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal(await b.base.premier('SELECT id FROM cm_drive_fichiers WHERE id = ?', [fs.id]), null);
  assert.equal(await b.stockage.lire(fs.cle_stockage), null);
  assert.ok(!(await ok('/cm/drive/corbeille?portee=club', s.osc12345)).elements.some(x => x.id === fs.id));
  assert.ok(!contient(await ok('/cm/drive/corbeille?portee=club', s.fondateur), 'secret.pdf'));
});

test('quota : un envoi depuis Ressources compte dans l’espace du Drive et est refusé au-delà', async () => {
  const { s, ok, envoyer, ressourceEnvoyee } = await preparer({ drive: { quota: 10_000, fichierMax: 6_000, zipMax: 1_000_000 } });
  assert.equal((await envoyer(s.lyn12345, 'ressources', new Uint8Array(6_001), 'gros.bin')).erreur.corps.code, 'fichier-trop-gros');
  await ressourceEnvoyee(s.lyn12345, pdfFactice('x'.repeat(5_000)), 'a.pdf');
  assert.ok((await ok('/cm/drive/portees', s.cm123456)).quota.utilise > 5_000, 'compté dans le Drive');
  assert.equal((await envoyer(s.lyn12345, 'ressources', pdfFactice('y'.repeat(5_000)), 'b.pdf')).erreur.corps.code, 'quota-drive');
});

test('cartes et dossiers liés, export / import, RGPD', async () => {
  const { b, s, ok, ressourceEnvoyee } = await preparer();
  const r = await ressourceEnvoyee(s.lyn12345, pdfFactice('brief'), 'brief.pdf');
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'Brief' } })).carte;
  await ok(`/cm/liens/${r.id}/liaisons`, s.cm123456, { methode: 'POST', corps: { genre: 'carte', cibleId: carte.id } });
  const lies = await ok(`/cm/liens/cible/carte/${carte.id}`, s.vue12345);
  assert.deepEqual(lies.liens.map(l => [l.genre, l.fichier?.nom]), [['fichier', 'brief.pdf']]);
  // Export / import : colonnes de la migration 0051 comprises.
  assert.ok(TABLES.some(([x]) => x === 'cm_liens'));
  const sauvegarde = await exporterBase(b.base);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  const l = await neuve.premier('SELECT genre, source, element_id FROM cm_liens WHERE id = ?', [r.id]);
  assert.equal(l.genre, 'fichier');
  assert.equal(l.source, 'envoi');
  assert.equal((await neuve.premier('SELECT ressource_id FROM cm_drive_fichiers WHERE id = ?', [l.element_id])).ressource_id, r.id);
  // RGPD : Lyna exporte sa ressource (genre, nom du fichier) ; effacée, la ressource reste au club sans auteur.
  const exp = await ok('/moi/export', s.lyn12345);
  assert.deepEqual(exp.cmLiens.map(x => [x.titre, x.genre, x.fichier]), [['brief.pdf', 'fichier', 'brief.pdf']]);
  await ok('/moi', s.lyn12345, { methode: 'DELETE' });
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_liens WHERE id = ?', [r.id])).cree_par, null);
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_drive_fichiers WHERE ressource_id = ?', [r.id])).cree_par, null);
});
