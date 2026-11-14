/**
 * Document d'une strat, côté serveur (pur) : validation stricte, forme
 * canonique, migration de version, taille maximale, rendu SVG échappé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAPES_MAX,
  OBJETS_MAX,
  TAILLE_MAX_DOCUMENT,
  VERSION_DOCUMENT,
  calqueDe,
  documentVide,
  migrerDocument,
  resumeDocument,
  validerDocument,
} from '../noyau/strats/document.mjs';
import { MENTION_RIOT, pageStrat, svgEtape } from '../noyau/strats/svg.mjs';
import { ASCENT, docExemple } from './strats-aide.mjs';


test('document vide : version courante, cinq joueurs colorés, une étape, calques visibles', () => {
  const d = documentVide({ carte: ASCENT, side: 'defense' });
  assert.equal(d.version, VERSION_DOCUMENT);
  assert.equal(d.format, 'esport-strat');
  assert.equal(d.joueurs.length, 5);
  assert.deepEqual(Object.keys(d.calques), ['fond', 'callouts', 'utilitaires', 'vision', 'marqueurs', 'dessins', 'texte']);
  assert.equal(d.modele, 'valorant');
  assert.equal(d.etapes[0].duree, 5);
  assert.ok(Object.values(d.calques).every(c => c.visible && !c.verrou));
  assert.equal(d.etapes.length, 1);
  assert.equal(d.side, 'defense');
});

test('validation : forme canonique (champs inconnus jetés, couleurs en minuscules), idempotente', () => {
  const brut = docExemple();
  brut.etapes[0].objets[0].script = '<script>alert(1)</script>';
  brut.inconnu = 42;
  const v = validerDocument(brut);
  assert.equal(v.inconnu, undefined);
  assert.equal(v.etapes[0].objets[0].script, undefined);
  assert.equal(v.etapes[0].objets[2].couleur, '#ef4444');
  assert.deepEqual(validerDocument(v), v, 'valider deux fois ne change rien');
  assert.deepEqual(resumeDocument(v), { etapes: 1, objets: 4, agents: ['omen'] });
  assert.equal(calqueDe(v.etapes[0].objets[1]), 'utilitaires');
  assert.equal(calqueDe(v.etapes[0].objets[2]), 'dessins');
  assert.equal(calqueDe(v.etapes[0].objets[3]), 'texte');
});

test('validation : refus explicites (400) des valeurs dangereuses ou hors bornes', () => {
  const refuse = (modif, code = 'strat-invalide') => {
    const d = docExemple();
    modif(d);
    assert.throws(() => validerDocument(d), e => e.code === code && e.statut === 400, String(modif));
  };
  refuse(d => (d.carte.image = 'https://exemple.com/carte.png'));
  refuse(d => (d.carte.image = 'javascript:alert(1)'));
  refuse(d => (d.etapes[0].objets[0].icone = 'data:image/png;base64,AAAA'));
  refuse(d => (d.etapes[0].objets[0].icone = 'esport-assets/../../secret'));
  refuse(d => (d.side = 'milieu'));
  refuse(d => (d.etapes[0].objets[0].x = Number.NaN));
  refuse(d => (d.etapes[0].objets[0].x = 1e9));
  refuse(d => (d.etapes[0].objets[0].couleur = 'red'));
  refuse(d => (d.etapes[0].objets[0].joueur = 7));
  refuse(d => (d.etapes[0].objets[2].points = [1, 2, 3]));
  refuse(d => (d.etapes[0].objets[1].zone = { forme: 'triangle' }));
  refuse(d => (d.etapes[0].objets[3].texte = '   '));
  refuse(d => (d.etapes[0].objets[1].id = d.etapes[0].objets[0].id));
  refuse(d => d.etapes[0].objets.push({ id: 'z', type: 'video' }));
  refuse(d => (d.etapes = []));
  refuse(d => (d.etapes = Array.from({ length: ETAPES_MAX + 1 }, (_, i) => ({ id: `e${i}`, titre: '', note: '', objets: [] }))));
  refuse(d => (d.etapes[0].objets = Array.from({ length: OBJETS_MAX + 1 }, (_, i) => ({ id: `t${i}`, type: 'texte', x: 1, y: 1, texte: 'x', couleur: '#ffffff' }))));
  refuse(d => (d.version = 99), 'strat-version');
});

test('taille maximale : un document de plus de 384 Ko est refusé (413)', () => {
  const d = docExemple();
  d.etapes[0].note = 'x'.repeat(TAILLE_MAX_DOCUMENT);
  assert.throws(() => validerDocument(d), e => e.statut === 413 && e.code === 'strat-trop-grosse');
});

test('migration : un document version 1 (une seule frame) devient une étape de la version courante', () => {
  const v1 = {
    version: 1,
    carte: 'bind',
    side: 'defense',
    notes: 'Retake B',
    objets: [{ id: 'a', type: 'agent', x: 10, y: 20, agent: 'sage', nom: 'Sage', couleur: '#22c55e' }],
  };
  const m = migrerDocument(v1);
  assert.equal(m.version, 3);
  assert.equal(m.etapes.length, 1);
  const v = validerDocument(v1);
  assert.equal(v.version, VERSION_DOCUMENT);
  assert.equal(v.carte.cle, 'bind');
  assert.equal(v.etapes[0].note, 'Retake B');
  assert.equal(v.etapes[0].objets[0].agent, 'sage');
  assert.equal(v.joueurs.length, 5);
});

test('page de partage Valorant : image d\u2019origine de la map, sans filtre « plateau »', () => {
  const d = validerDocument(docExemple());
  const v = svgEtape({ ...d, modele: 'valorant' }, 0);
  assert.ok(!v.includes('url(#plateau)') && !v.includes('id="plateau"'), 'Valorant : image telle quelle');
  assert.match(v, /<image href="https:\/\/media\.valorant-api\.com\/maps\//);
  assert.match(svgEtape({ ...d, modele: 'thefinals' }, 0), /filter="url\(#plateau\)"/);
});

test('rendu SVG et page publique : textes échappés, images Riot seules, mention Riot', () => {
  const d = validerDocument(docExemple());
  d.etapes[0].objets[3].texte = '<img src=x onerror=alert(1)>';
  d.etapes[0].note = '<b>gras</b>';
  const svg = svgEtape(d, 0);
  assert.match(svg, /^<svg /);
  assert.ok(!svg.includes('<img'), 'texte échappé');
  assert.match(svg, /&lt;img src=x/);
  assert.match(svg, /https:\/\/media\.valorant-api\.com\/maps\//);
  assert.match(svg, /marker-end="url\(#pointe-ef4444\)"/);
  // Calque masqué : absent du rendu.
  d.calques.texte.visible = false;
  assert.ok(!svgEtape(d, 0).includes('&lt;img'));
  const page = pageStrat({ titre: 'Exec "A"', type: 'execute', notes: '', doc: d, libelleType: 'Exécution' });
  assert.ok(page.includes('Exec &quot;A&quot;'));
  assert.ok(!page.includes('<b>gras</b>'));
  assert.ok(page.includes('Legal Jibber Jabber'));
  assert.match(MENTION_RIOT, /Riot Games does not endorse or sponsor this project\./);
});
