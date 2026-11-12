/**
 * Maps proposées (Administration › Jeux › « Maps proposées ») : The Finals depuis le wiki communautaire
 * (réponses JSON réelles enregistrées, abrégées : esport/test/donnees/wiki-thefinals.json), Valorant depuis
 * valorant-api.com (donnees/valorant-api-maps.json). Jamais de réseau réel ; images simulées (PNG générés).
 */

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { arenesDuWiki, imagesArene, variantesArenes } from '../noyau/jeux/wiki-thefinals.mjs';

const WIKI = JSON.parse(readFileSync(new URL('./donnees/wiki-thefinals.json', import.meta.url), 'utf8')).reponses;
const VALORANT = JSON.parse(readFileSync(new URL('./donnees/valorant-api-maps.json', import.meta.url), 'utf8'));
const URL_MONACO = 'https://www.thefinals.wiki/w/images/c/c1/MonacoOverview_Hi-Res.jpg';
const URL_NOZOMI = 'https://www.thefinals.wiki/w/images/d/dd/NozomiCitadel_Overview.png';
const URL_LVS = 'https://www.thefinals.wiki/w/images/f/fa/Loading_Screen_Las_Vegas_Stadium_Afternoon.jpg';

/** PNG minimal (en-tête IHDR correct) de `l` × `h` pixels : des tailles différentes donnent des empreintes différentes. */
function png(l = 512, h = 512) {
  const o = new Uint8Array(64);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(o.buffer).setUint32(16, l);
  new DataView(o.buffer).setUint32(20, h);
  return o;
}

/** Faux web : réponses JSON enregistrées et images simulées ; note chaque requête. */
function fauxWeb({ json = WIKI, images = {} } = {}) {
  const demandes = [];
  const fetchImport = async (url, init) => {
    demandes.push({ url, redirect: init?.redirect });
    if (json[url]) return new Response(JSON.stringify(json[url]), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    const img = images[url];
    if (!img) return new Response('introuvable', { status: 404 });
    return new Response(img, { headers: { 'content-type': 'image/png' } });
  };
  return { fetchImport, demandes, images };
}

const imagesWiki = () => ({ [URL_MONACO]: png(2751, 2646), [URL_NOZOMI]: png(2048, 2048), [URL_LVS]: png(2500, 1406) });

async function jeuTheFinals(b, f, donnees = { cartes: [{ nom: 'Monaco', actif: true }] }) {
  const r = await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { cle: 'the-finals', nom: 'The Finals', modeleStrat: 'thefinals', donnees } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
}

const nImages = async b => Number((await b.base.premier('SELECT COUNT(*) AS n FROM jeu_images', [])).n);
const parCle = l => Object.fromEntries(l.cartes.map(c => [c.cle, c]));

test('wiki The Finals (réponses réelles) : arènes de Cashout, vue de dessus préférée, licence lue sur le wiki', async () => {
  const web = fauxWeb();
  const r = await arenesDuWiki(web.fetchImport);
  assert.equal(r.site, 'THE FINALS Wiki');
  assert.deepEqual(r.licence, { texte: 'Creative Commons Attribution-ShareAlike', url: 'https://creativecommons.org/licenses/by-sa/4.0/' });
  // Las Vegas (remplacée par Las Vegas Stadium), Starlight Hollow (sans Cashout) et Practice Range : écartées.
  assert.deepEqual(r.arenes.map(a => a.nom), ['Las Vegas Stadium', 'Monaco', 'NOZOMI/CITADEL']);
  const [lvs, monaco, nozomi] = r.arenes;
  assert.deepEqual([monaco.cle, monaco.image.url, monaco.image.vueDessus], ['monaco', URL_MONACO, true]);
  assert.deepEqual(monaco.variantes, ['Standard Issue', 'Suspended Structures', 'Duck and Cover']);
  assert.equal(monaco.competitive, true, 'Ranked Cashout');
  assert.equal(monaco.page, 'https://www.thefinals.wiki/wiki/Monaco');
  assert.equal(monaco.echelle.methode, 'approx');
  assert.deepEqual(monaco.reperes, [], 'aucune coordonnée de repère sur le wiki');
  assert.match(monaco.attribution, /THE FINALS Wiki \(wiki\.gg\).*Creative Commons Attribution-ShareAlike/);
  assert.equal(nozomi.cle, 'nozomi-citadel');
  assert.equal(nozomi.image.url, URL_NOZOMI, 'image provisoire de l’infobox ignorée, vue de dessus prise');
  assert.equal(lvs.image.vueDessus, false, 'pas de vue de dessus (icône 404 ignorée) : illustration de l’arène');
  assert.equal(lvs.image.url, URL_LVS);
  assert.ok(web.demandes.every(d => d.url.startsWith('https://www.thefinals.wiki/w/api.php?') && d.redirect === 'error'));
  // Analyse du wikitexte.
  assert.deepEqual(imagesArene('{{Infobox Arena| image=A b.png| x=1}}\n==Overview==\n{{Infographic\n|Image=Nama-404_Icon.png\n}}[[File:Arena_Minimap.webp|thumb]]'), { illustration: 'A b.png', vuesDessus: ['Arena Minimap.webp'] });
  assert.deepEqual(variantesArenes('{{Arenas\n|Arena=X\n|Variant=V1\n|Gamemodes=Cashout, TDM\n}}{{Arenas\n|Arena=X\n|Variant=V2\n|Gamemodes=Cashout\n}}'), { X: { variantes: ['V1', 'V2'], modes: ['Cashout', 'TDM'] } });
});

test('maps proposées The Finals : préparer (rien appliqué), revue, remplacer l’image, calibrer, rejeter, valider, re-préparer', async () => {
  const web = fauxWeb({ images: imagesWiki() });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const f = await b.session('principal', 'Fondateur');
  const team = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const jeu = await jeuTheFinals(b, f);
  const lea = team.sessions.lea12345;
  assert.equal((await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: lea, corps: {} })).statut, 403);
  assert.equal((await b.appel('/jeux/the-finals/cartes-proposees', { jeton: lea })).statut, 403);

  let r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.rapport.map(l => [l.carte, l.statut]), [['Las Vegas Stadium', 'nouvelle'], ['Monaco', 'nouvelle'], ['NOZOMI/CITADEL', 'nouvelle']]);
  assert.equal(await nImages(b), 3, 'images rangées dans le stockage dès la préparation');
  let c = parCle(r.corps);
  assert.ok(Object.values(c).every(x => x.statut === 'a-valider'));
  assert.equal(c.monaco.dansProfil, true);
  assert.deepEqual(c.monaco.changements, { nouvelle: false, image: 'ajout', echelle: 'ajout', reperes: 0 });
  assert.equal(c['nozomi-citadel'].changements.nouvelle, true);
  assert.equal(c.monaco.echelle.methode, 'approx');
  assert.equal(c.monaco.licence.texte, 'Creative Commons Attribution-ShareAlike');
  assert.equal(c.monaco.page, 'https://www.thefinals.wiki/wiki/Monaco');
  assert.equal(c['las-vegas-stadium'].vueDessus, false);
  assert.equal(r.corps.images[c.monaco.fichier].largeur, 2751);
  assert.match(r.corps.images[c.monaco.fichier].url, /^http.*\/jeux\/images\/[0-9a-f-]{36}\?/);
  // Rien n'est appliqué au profil.
  let profil = (await b.appel('/jeux/the-finals', { jeton: f })).corps;
  assert.equal(profil.version, jeu.version);
  assert.equal(profil.donnees.cartes.length, 1);
  assert.equal(profil.donnees.cartes[0].fichier, undefined);

  // Re-préparer : idempotent (aucune nouvelle image).
  r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.deepEqual(r.corps.rapport.map(l => l.statut), ['rafraichie', 'rafraichie', 'rafraichie']);
  assert.equal(await nImages(b), 3);

  // Remplacer l'image (fichier déposé) ; adresse http refusée ; calibrer ; ces choix survivent à une nouvelle préparation.
  r = await b.appel('/jeux/the-finals/cartes-proposees/las-vegas-stadium/image', { methode: 'POST', jeton: f, corps: { type: 'image/png', donnees: Buffer.from(png(1500, 1500)).toString('base64'), nom: 'lvs.png' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(parCle(r.corps)['las-vegas-stadium'].imageManuelle, true);
  const fichierManuel = parCle(r.corps)['las-vegas-stadium'].fichier;
  r = await b.appel('/jeux/the-finals/cartes-proposees/monaco/image', { methode: 'POST', jeton: f, corps: { url: 'http://exemple.org/monaco.png' } });
  assert.equal(r.corps.code, 'import-adresse');
  r = await b.appel('/jeux/the-finals/cartes-proposees/monaco/echelle', { methode: 'PUT', jeton: f, corps: { points: [100, 500, 900, 500], distance: 160 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(parCle(r.corps).monaco.echelle.pxParMetre, 5);
  assert.equal((await b.appel('/jeux/the-finals/cartes-proposees/monaco/echelle', { methode: 'PUT', jeton: f, corps: { points: [1, 1, 2, 1], distance: 200 } })).corps.code, 'echelle-invalide');
  r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  c = parCle(r.corps);
  assert.equal(c['las-vegas-stadium'].fichier, fichierManuel, 'image remplacée gardée');
  assert.equal(c.monaco.echelleManuelle, true, 'calibrage de la proposition gardé');

  // Rejeter une map, valider une map, puis toutes les autres.
  r = await b.appel('/jeux/the-finals/cartes-proposees/rejeter', { methode: 'POST', jeton: f, corps: { cartes: ['nozomi-citadel'] } });
  assert.equal(parCle(r.corps)['nozomi-citadel'].statut, 'rejetee');
  r = await b.appel('/jeux/the-finals/cartes-proposees/valider', { methode: 'POST', jeton: f, corps: { cartes: ['monaco'] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.validees, ['monaco']);
  let monaco = r.corps.jeu.donnees.cartes.find(x => x.cle === 'monaco');
  assert.equal(monaco.fichier, c.monaco.fichier);
  assert.equal(monaco.echelle.pxParMetre, 5, 'calibrage de la proposition');
  assert.equal(monaco.source.fournisseur, 'thefinals.wiki');
  assert.equal(monaco.source.url, URL_MONACO);
  assert.equal(monaco.source.page, 'https://www.thefinals.wiki/wiki/Monaco');
  assert.equal(monaco.source.licence, 'Creative Commons Attribution-ShareAlike');
  assert.equal(monaco.source.licenceUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(monaco.source.attribution, /^Source : THE FINALS Wiki \(wiki\.gg\)/);
  assert.equal(monaco.source.aVerifier, true);
  assert.ok(r.corps.jeu.images[monaco.fichier].url);
  assert.equal(r.corps.jeu.donnees.cartes.some(x => x.cle === 'nozomi-citadel'), false, 'rejetée : pas dans le profil');
  assert.equal((await b.appel('/jeux/the-finals/cartes-proposees/valider', { methode: 'POST', jeton: f, corps: { cartes: ['nozomi-citadel'] } })).corps.code, 'proposition-aucune');
  r = await b.appel('/jeux/the-finals/cartes-proposees/valider', { methode: 'POST', jeton: f, corps: { toutes: true } });
  assert.deepEqual(r.corps.validees, ['las-vegas-stadium']);
  const lvs = r.corps.jeu.donnees.cartes.find(x => x.cle === 'las-vegas-stadium');
  assert.equal(lvs.actif, true, 'pool compétitif suggéré (Ranked Cashout)');
  assert.equal(lvs.fichier, fichierManuel);
  assert.equal(lvs.echelle.methode, 'approx');
  const versionValidee = r.corps.jeu.version;
  assert.equal((await b.base.premier("SELECT motif FROM jeu_versions WHERE jeu_cle = 'the-finals' AND version = ?", [versionValidee])).motif, 'cartes-proposees');

  // Re-préparer : les maps validées et rejetées ne bougent pas, le profil non plus.
  r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.deepEqual(r.corps.rapport.map(l => [l.carte, l.statut]), [['Las Vegas Stadium', 'deja-validee'], ['Monaco', 'deja-validee'], ['NOZOMI/CITADEL', 'deja-rejetee']]);
  profil = (await b.appel('/jeux/the-finals', { jeton: f })).corps;
  assert.equal(profil.version, versionValidee);
  // L'image de Monaco change sur le wiki : de nouveau à valider ; le profil garde l'image validée.
  web.images[URL_MONACO] = png(2700, 2700);
  r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.corps.rapport.find(l => l.carte === 'Monaco').statut, 'mise-a-jour');
  c = parCle(r.corps);
  assert.equal(c.monaco.statut, 'a-valider');
  assert.equal(c.monaco.changements.image, 'remplacement');
  assert.equal(c.monaco.changements.echelle, 'gardee', 'le calibrage validé (à la main) restera');
  profil = (await b.appel('/jeux/the-finals', { jeton: f })).corps;
  assert.equal(profil.version, versionValidee);
  monaco = profil.donnees.cartes.find(x => x.cle === 'monaco');
  assert.equal(monaco.echelle.pxParMetre, 5);

  // Suppression du profil : ses propositions partent avec lui.
  const n = async () => Number((await b.base.premier("SELECT COUNT(*) AS n FROM jeu_cartes_proposees WHERE jeu_cle = 'the-finals'", [])).n);
  assert.equal(await n(), 3);
  assert.equal((await b.appel('/jeux/the-finals', { methode: 'DELETE', jeton: f })).statut, 200);
  assert.equal(await n(), 0);
});

test('maps proposées : hôtes autorisés seulement (image hors du wiki refusée sans requête), erreurs par map, réseau absent', async () => {
  // Réponse imageinfo trafiquée : l'image de Monaco pointe hors du wiki.
  const json = structuredClone(WIKI);
  for (const [url, rep] of Object.entries(json)) {
    if (!url.includes('prop=imageinfo')) continue;
    for (const p of rep.query.pages) if (p.imageinfo?.[0]?.url === URL_MONACO) p.imageinfo[0].url = 'https://images.exemple.org/monaco.png';
  }
  const images = imagesWiki();
  delete images[URL_NOZOMI];
  const web = fauxWeb({ json, images });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const f = await b.session('principal', 'Fondateur');
  await jeuTheFinals(b, f);
  const r = await b.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const l = Object.fromEntries(r.corps.rapport.map(x => [x.carte, x]));
  assert.equal(l.Monaco.erreur, 'import-adresse');
  assert.equal(l['NOZOMI/CITADEL'].erreur, 'import-http');
  assert.equal(l['Las Vegas Stadium'].erreur, undefined);
  assert.ok(!web.demandes.some(d => d.url.includes('exemple.org')), 'aucune requête hors de la liste autorisée');
  const c = parCle(r.corps);
  assert.equal(c.monaco.fichier, null);
  assert.equal(c.monaco.erreur, 'import-adresse', 'proposée quand même : « Remplacer l’image »');
  // Jeu générique : refusé ; réseau absent : erreur claire.
  await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { cle: 'rl', nom: 'Rocket League' } });
  assert.equal((await b.appel('/jeux/rl/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} })).corps.code, 'import-modele');
  const b2 = await banc();
  const f2 = await b2.session('principal', 'Fondateur');
  await jeuTheFinals(b2, f2);
  const r2 = await b2.appel('/jeux/the-finals/cartes-proposees/preparer', { methode: 'POST', jeton: f2, corps: {} });
  assert.equal(r2.statut, 502);
  assert.equal(r2.corps.code, 'import-reseau');
});

test('maps proposées Valorant : ce qui changera avant d’appliquer (image, échelle, callouts), puis validation', async () => {
  const ascent = VALORANT.data.find(m => m.displayName === 'Ascent');
  const haven = VALORANT.data.find(m => m.displayName === 'Haven');
  const web = fauxWeb({ json: { 'https://valorant-api.com/v1/maps': VALORANT }, images: { [ascent.displayIcon]: png(1024, 1024), [haven.displayIcon]: png(1024, 1023) } });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const f = await b.session('principal', 'Fondateur');
  const avant = (await b.appel('/jeux/valorant', { jeton: f })).corps;
  let r = await b.appel('/jeux/valorant/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.rapport.map(l => l.carte).sort(), ['Ascent', 'Haven']);
  const c = parCle(r.corps);
  assert.deepEqual(c.ascent.changements, { nouvelle: false, image: 'ajout', echelle: 'ajout', reperes: 7 });
  assert.equal(c.ascent.echelle.pxParMetre, 7);
  assert.equal(c.ascent.echelle.methode, 'import');
  assert.equal(c.ascent.fournisseur, 'valorant-api.com');
  assert.equal((await b.appel('/jeux/valorant', { jeton: f })).corps.version, avant.version, 'rien appliqué');
  r = await b.appel('/jeux/valorant/cartes-proposees/valider', { methode: 'POST', jeton: f, corps: { toutes: true, version: avant.version } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const a = r.corps.jeu.donnees.cartes.find(x => x.cle === 'ascent');
  assert.equal(a.echelle.pxParMetre, 7);
  assert.equal(a.reperes.filter(x => x.importe).length, 7);
  assert.equal(a.source.aVerifier, false);
  assert.equal(a.actif, avant.donnees.cartes.find(x => x.cle === 'ascent').actif, 'pool inchangé');
  // Plus rien à proposer de neuf : la revue montre tout « validé », sans changement.
  r = await b.appel('/jeux/valorant/cartes-proposees/preparer', { methode: 'POST', jeton: f, corps: {} });
  assert.ok(r.corps.rapport.every(l => l.statut === 'deja-validee'));
  assert.deepEqual(parCle(r.corps).ascent.changements, { nouvelle: false, image: 'identique', echelle: 'identique', reperes: 7 });
});
