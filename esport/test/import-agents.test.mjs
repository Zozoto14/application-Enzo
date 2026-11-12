/**
 * Import des agents de Valorant (Administration › Jeux › « Importer agents et capacités ») : réponse RÉELLE de
 * valorant-api.com abrégée (esport/test/donnees/valorant-api-agents.json, JSON seulement, aucune image), portraits
 * et icônes téléchargés par le serveur (faux web), rangés dans le stockage, cités par le profil, liens signés ;
 * idempotent ; caractéristiques des capacités jamais touchées ; mur tracé et mur double dans le document.
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { agentValorant, URL_AGENTS_VALORANT } from '../noyau/jeux/import.mjs';
import { imagesCitees } from '../noyau/jeux/images.mjs';
import { donneesPourIa, reporterChampsLocaux, validerDonnees } from '../noyau/jeux/schema.mjs';
import { documentVide, validerDocument } from '../noyau/strats/document.mjs';
import { svgEtape } from '../noyau/strats/svg.mjs';

/** Réponse réelle de https://valorant-api.com/v1/agents?isPlayableCharacter=true (abrégée : 5 agents ; 2026-11-12). */
const AGENTS = JSON.parse(readFileSync(new URL('./donnees/valorant-api-agents.json', import.meta.url), 'utf8')).data;

function png(l = 128, h = 128) {
  const o = new Uint8Array(64);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(o.buffer).setUint32(16, l);
  new DataView(o.buffer).setUint32(20, h);
  return o;
}

/** Faux web : la liste des agents, et une image PNG distincte pour chaque adresse media.valorant-api.com. */
function fauxWeb(agents, { refuser = [] } = {}) {
  const demandes = [];
  const fetchImport = async (url, init) => {
    demandes.push({ url, redirect: init?.redirect });
    if (url === URL_AGENTS_VALORANT) return new Response(JSON.stringify({ status: 200, data: agents }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    if (url.startsWith('https://media.valorant-api.com/') && !refuser.includes(url)) {
      const o = png();
      o[40] = url.length % 251; // contenu distinct par adresse (empreintes différentes)
      o[41] = url.charCodeAt(url.length - 15);
      return new Response(o, { headers: { 'content-type': 'image/png' } });
    }
    return new Response('introuvable', { status: 404 });
  };
  return { fetchImport, demandes };
}

test('valorant-api.com réel : agent → portrait, rôle et icône, capacités C Q E X (passive ignorée)', () => {
  const agents = AGENTS.map(agentValorant).filter(Boolean);
  assert.deepEqual(agents.map(a => a.cle), ['viper', 'harbor', 'neon', 'kay-o', 'hush']);
  const viper = agents[0];
  assert.match(viper.portrait, /^https:\/\/media\.valorant-api\.com\/agents\/[0-9a-f-]+\/displayicon(small)?\.png$/);
  assert.deepEqual({ cle: viper.role.cle, nom: viper.role.nom }, { cle: 'controleur', nom: 'Contrôleur' });
  assert.match(viper.role.icone, /^https:\/\/media\.valorant-api\.com\/agents\/roles\//);
  assert.deepEqual(viper.capacites.map(c => c.touche), ['C', 'Q', 'E', 'X']);
  assert.equal(viper.capacites.find(c => c.touche === 'E').nom, 'Toxic Screen', 'nom officiel = celui des données pré-remplies (rapprochées par la touche)');
  assert.ok(viper.capacites.every(c => c.description.length > 10 && c.description.length <= 300));
  assert.equal(agents.find(a => a.cle === 'neon').role.cle, 'duelliste');
  assert.equal(agentValorant({ displayName: 'X', isPlayableCharacter: false }), null);
  assert.equal(agentValorant({ displayName: 'Piège', displayIcon: 'https://exemple.invalid/x.png', abilities: [{ slot: 'Grenade', displayName: 'A', displayIcon: 'javascript:alert(1)' }] }).portrait, null, 'hors CDN : refusé');
});

test('import des agents : portraits, icônes des capacités et des rôles dans le stockage, cités par le profil, liens signés ; idempotent', async () => {
  const piege = { ...AGENTS[0], displayName: 'Nouvel Agent', displayIconSmall: 'https://exemple.invalid/p.png', displayIcon: 'https://exemple.invalid/p.png' };
  const web = fauxWeb([...AGENTS, piege], { refuser: [AGENTS[1].abilities.find(a => a.slot === 'Ultimate').displayIcon] });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const f = await b.session('principal', 'Fondateur');
  const team = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  assert.equal((await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: team.sessions.lea12345, corps: {} })).statut, 403, 'gestionnaire seulement');
  // Caractéristiques déjà saisies pour Viper : jamais touchées.
  const avant = (await b.appel('/jeux/valorant', { jeton: f })).corps;
  const d0 = structuredClone(avant.donnees);
  d0.personnages.find(p => p.cle === 'viper').capacites = [{ nom: 'Toxic Screen', touche: 'E', categorie: 'signature', forme: 'mur', longueur: 60, largeur: 1, aVerifier: false }];
  let r = await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: avant.version, donnees: d0 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  r = await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: f, corps: { version: r.corps.version } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const lignes = Object.fromEntries(r.corps.rapport.map(l => [l.agent, l]));
  assert.deepEqual(lignes.Viper, { agent: 'Viper', portrait: 'importee', capacites: 4 });
  assert.equal(lignes.Harbor.capacites, 3, 'une icône refusée par le site');
  assert.equal(lignes.Harbor.erreur, 'import-http');
  assert.equal(lignes.Hush.ajoute, true, 'agent absent du profil : ajouté');
  assert.equal(lignes['Nouvel Agent'].portrait, 'absente', 'portrait hors CDN : écarté, jamais demandé');
  assert.ok(!web.demandes.some(x => x.url.includes('exemple.invalid')), 'aucune requête hors de la liste autorisée');
  assert.ok(web.demandes.every(x => x.redirect === 'error'), 'jamais de redirection suivie');
  const jeu = r.corps.jeu;
  const viper = jeu.donnees.personnages.find(p => p.cle === 'viper');
  assert.ok(viper.fichier && jeu.images[viper.fichier].url, 'portrait : lien signé');
  assert.equal(viper.source.fournisseur, 'valorant-api.com');
  assert.deepEqual(viper.officielles.map(o => o.touche), ['C', 'Q', 'E', 'X']);
  assert.ok(viper.officielles.every(o => o.fichier && jeu.images[o.fichier] && /^https:\/\/media\.valorant-api\.com\//.test(o.url)));
  assert.deepEqual(viper.capacites.map(c => [c.nom, c.longueur, c.aVerifier]), [['Toxic Screen', 60, false]], 'caractéristiques intactes');
  const hush = jeu.donnees.personnages.find(p => p.cle === 'hush');
  assert.equal(hush.actif, true);
  assert.ok(hush.classe, 'rôle repris');
  const controleur = jeu.donnees.classes.find(c => c.cle === 'controleur');
  assert.ok(controleur.fichier && jeu.images[controleur.fichier], 'icône du rôle');
  const ids = imagesCitees(jeu.donnees);
  const n = Number((await b.base.premier('SELECT COUNT(*) AS n FROM jeu_images WHERE jeu_cle = ?', ['valorant'])).n);
  assert.equal(n, ids.length, 'chaque image importée est citée');
  // Lecture par un membre de la team : lien signé servi.
  const pourTeam = (await b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 })).corps;
  const img = await b.brut(pourTeam.images[viper.fichier].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // Second import : rien de nouveau dans le stockage, profil inchangé.
  r = await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: f, corps: { version: jeu.version } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.rapport.find(l => l.agent === 'Viper').portrait, 'inchangee');
  assert.ok(r.corps.rapport.filter(l => l.agent !== 'Harbor').every(l => l.capacites === 0));
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM jeu_images WHERE jeu_cle = ?', ['valorant'])).n), n, 'aucune nouvelle image (l’icône refusée est réessayée, et refusée encore)');
  // Version conflictuelle : refusée ; profil d'un autre modèle : refusé.
  assert.equal((await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: f, corps: { version: 1 } })).statut, 409);
});

test('import des agents : réseau absent → erreur claire ; profil non Valorant refusé', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  let r = await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.statut, 502);
  assert.equal(r.corps.code, 'import-reseau');
  r = await b.appel('/jeux/autre/importer-agents', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'import-modele');
});

test('schéma : portrait, source, capacités officielles et icône de rôle validés, propres au club (jamais proposés par l’IA)', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const d = validerDonnees({
    classes: [{ nom: 'Contrôleur', cle: 'controleur', fichier: id }],
    personnages: [{ nom: 'Viper', classe: 'controleur', fichier: id, source: { fournisseur: 'valorant-api.com', url: 'https://media.valorant-api.com/agents/x/displayicon.png' }, officielles: [{ touche: 'E', slot: 'Ability2', nom: 'Toxic Screen', description: 'Mur.', fichier: id, url: 'https://media.valorant-api.com/agents/x/abilities/ability2/displayicon.png' }] }],
  }).donnees;
  assert.equal(d.classes[0].fichier, id);
  assert.equal(d.personnages[0].officielles[0].nom, 'Toxic Screen');
  assert.throws(() => validerDonnees({ personnages: [{ nom: 'V', fichier: '../x' }] }), /profil/i);
  assert.throws(() => validerDonnees({ personnages: [{ nom: 'V', officielles: [{ touche: 'E', nom: 'A' }, { touche: 'E', nom: 'B' }] }] }), /profil/i, 'une capacité officielle par touche');
  const ia = donneesPourIa(d);
  assert.equal(ia.personnages[0].fichier, undefined);
  assert.equal(ia.personnages[0].officielles, undefined);
  assert.equal(ia.classes[0].fichier, undefined);
  const reporte = reporterChampsLocaux(d, { ...d, personnages: [{ ...ia.personnages[0] }], classes: [{ ...ia.classes[0] }] });
  assert.equal(reporte.personnages[0].fichier, id, 'réponse de l’IA : champs locaux reportés');
  assert.equal(reporte.classes[0].fichier, id);
  assert.deepEqual(imagesCitees(d), [id]);
  assert.equal(validerDonnees({ personnages: [{ nom: 'Neon', capacites: [{ nom: 'Fast Lane', touche: 'C', forme: 'mur', double: true }] }] }).donnees.personnages[0].capacites[0].double, true);
});

test('document : mur tracé (High Tide) et mur double (Fast Lane) validés et dessinés sur la page de partage', () => {
  const doc = documentVide({ carte: { cle: 'ascent', nom: 'Ascent', image: null }, modele: 'valorant' });
  doc.carte.echelle = 10;
  doc.etapes[0].objets.push(
    { id: 'o1', type: 'capacite', x: 100, y: 100, agent: 'harbor', capacite: 'Ability2', nom: 'High Tide', icone: null, joueur: 0, couleur: '#22c55e', zone: { forme: 'mur', angle: 0, longueur: 30, largeur: 1.5, courbure: 0, trace: [10, 0, 20, 10, 25, 25] } },
    { id: 'o2', type: 'capacite', x: 300, y: 300, agent: 'neon', capacite: 'Grenade', nom: 'Fast Lane', icone: null, joueur: 1, couleur: '#3b82f6', zone: { forme: 'mur', angle: 90, longueur: 30, largeur: 4.5, courbure: 0, double: true } },
  );
  const v = validerDocument(doc);
  assert.deepEqual(v.etapes[0].objets[0].zone.trace, [10, 0, 20, 10, 25, 25]);
  assert.equal(v.etapes[0].objets[1].zone.double, true);
  assert.equal(v.etapes[0].objets[1].zone.trace, undefined, 'champs absents : document identique');
  const svg = svgEtape(v, 0);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 3, 'un tracé + deux lignes du mur double');
  const trop = structuredClone(doc);
  trop.etapes[0].objets[0].zone.trace = Array.from({ length: 34 }, () => 1);
  assert.throws(() => validerDocument(trop), /tracé du mur/);
});
