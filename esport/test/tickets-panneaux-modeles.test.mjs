/**
 * Tickets : panneaux PAR DÉFAUT (modeles.mjs : PANNEAUX_DEFAUT ; Configuration › Panneaux › « Panneaux par défaut »)
 * et catégorie d'événement « Inscription The Nuke End » (jamais semée). Textes dans les limites de Discord (titre
 * d'embed ≤ 256, description ≤ 4096, libellé de bouton ≤ 80, options de menu ≤ 25, libellé et description d'option
 * ≤ 100, custom_id ≤ 100) ; création avec ou sans les catégories manquantes ; titre déjà pris renuméroté ; panneau
 * jamais publié à la création ; libellé propre « S'inscrire · Register » (migration 0057).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { CATEGORIES_DEFAUT, CLES_SEMEES, PANNEAUX_DEFAUT, corpsModele, textesPanneauModele } from '../noyau/tickets/modeles.mjs';
import { chargePanneau } from '../noyau/tickets/panneaux.mjs';
import { LIMITES } from '../noyau/tickets/reglages.mjs';
import { MODES_LANGUE } from '../noyau/tickets/textes.mjs';

const SALON = '710000000000000013';
const HORAIRES_PLEINS = { actif: true, fuseau: 'Europe/Paris', plages: Array.from({ length: LIMITES.plages }, (_, i) => ({ jour: (i % 7) + 1, debut: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, fin: '23:30' })) };

/** Catégories « publiques » factices tirées des modèles (noms et descriptions réels). */
const categoriesDe = cles =>
  cles.map((cle, i) => {
    const m = CATEGORIES_DEFAUT.find(x => x.cle === cle);
    return { id: `c${String(i).padStart(2, '0')}-${'x'.repeat(30)}`, nom: m.nom, description: m.description, actif: true };
  });

/** Vérifie une charge Discord contre les limites de l'API. */
function verifierCharge(c, quoi) {
  const e = c.embeds[0];
  assert.ok(e.title.length >= 1 && e.title.length <= 256, `${quoi} : titre ${e.title.length}`);
  assert.ok((e.description ?? '').length <= 4096, `${quoi} : description ${e.description?.length}`);
  assert.ok(c.components.length <= 5, `${quoi} : 5 rangées au plus`);
  for (const r of c.components) {
    assert.ok(r.components.length <= 5);
    for (const x of r.components) {
      assert.ok(x.custom_id.length <= 100, `${quoi} : custom_id`);
      if (x.type === 2) assert.ok(x.label.length >= 1 && x.label.length <= 80, `${quoi} : bouton ${x.label}`);
      if (x.type === 3) {
        assert.ok(x.options.length >= 1 && x.options.length <= 25);
        assert.ok(x.placeholder.length <= 150);
        for (const o of x.options) {
          assert.ok(o.label.length >= 1 && o.label.length <= 100, `${quoi} : option ${o.label}`);
          assert.ok(!o.description || o.description.length <= 100, `${quoi} : description d’option`);
          assert.ok(o.value.length <= 100);
        }
      }
    }
  }
}

test('panneaux par défaut : bilingues, sans emoji, dans les limites de Discord (tous modes de langue, horaires pleins)', () => {
  const cles = new Set();
  for (const m of PANNEAUX_DEFAUT) {
    assert.ok(!cles.has(m.cle), m.cle);
    cles.add(m.cle);
    assert.match(m.couleur, /^#[0-9a-f]{6}$/);
    assert.ok(['boutons', 'menu', 'auto'].includes(m.style));
    if (m.categories !== 'toutes') for (const k of m.categories) assert.ok(CATEGORIES_DEFAUT.some(x => x.cle === k), `${m.cle} → ${k}`);
    for (const l of ['fr', 'en']) {
      for (const v of [m.nom[l], m.description[l], m.titre[l], m.texte[l]]) {
        assert.ok(v && v.trim(), `${m.cle} ${l}`);
        assert.doesNotMatch(v, /\p{Extended_Pictographic}/u, `${m.cle} ${l} : pas d’emoji`);
      }
      if (m.libelleBouton) assert.ok(m.libelleBouton[l].length <= 80);
    }
    {
      for (const horaires of [null, HORAIRES_PLEINS]) {
        const t = textesPanneauModele(m, { evenement: 'E'.repeat(100), horaires });
        for (const l of ['fr', 'en']) {
          assert.ok(t.titre[l].length <= 256, `${m.cle} titre ${l}`);
          assert.ok(t.texte[l].length <= 1800, `${m.cle} texte ${l} : ${t.texte[l].length} (validerPanneau : 1800)`);
          assert.doesNotMatch(t.titre[l] + t.texte[l], /\{[a-z]+\}/, `${m.cle} : variables toutes remplies`);
        }
        if (horaires && m.texte.fr.includes('{horaires}')) assert.match(t.texte.fr, /Horaires du support/);
        else assert.doesNotMatch(t.texte.fr, /Horaires|horaires/);
        assert.match(t.texte.fr, /Écrivez et envoyez vos fichiers directement/);
        assert.doesNotMatch(t.texte.fr + t.texte.en, /Répondre|Reply/, 'plus de bouton « Répondre »');
        const cats = categoriesDe(m.categories === 'toutes' ? CLES_SEMEES : m.categories);
        const style = m.style === 'auto' ? (cats.length > 5 ? 'menu' : 'boutons') : m.style;
        const libelles = m.libelleBouton ? { [cats[0].id]: m.libelleBouton } : {};
        for (const mode of MODES_LANGUE) verifierCharge(chargePanneau({ ...t, couleur: m.couleur, style, libelles }, cats, { mode }), `${m.cle}/${mode}`);
      }
    }
  }
  for (const k of ['support', 'recrutement', 'partenariats', 'evenement', 'the-nuke-end']) assert.ok(cles.has(k), k);
  const support = PANNEAUX_DEFAUT.find(m => m.cle === 'support');
  assert.equal(support.categories, 'toutes');
  assert.deepEqual(PANNEAUX_DEFAUT.find(m => m.cle === 'recrutement').categories, ['recrutement', 'staff']);
  assert.deepEqual(PANNEAUX_DEFAUT.find(m => m.cle === 'partenariats').categories, ['partenariat']);
  assert.equal(textesPanneauModele(PANNEAUX_DEFAUT.find(m => m.cle === 'evenement'), { evenement: 'Coupe LZ' }).titre.fr, 'Inscription — Coupe LZ');
  assert.equal(textesPanneauModele(PANNEAUX_DEFAUT.find(m => m.cle === 'the-nuke-end')).titre.en, 'Registration — The Nuke End');
});

test('catégorie « Inscription The Nuke End » : événement jamais semé, formulaire dans les limites, TAG de 3 à 4 caractères', () => {
  const m = CATEGORIES_DEFAUT.find(x => x.cle === 'the-nuke-end');
  assert.equal(m.evenement, true);
  assert.ok(!CLES_SEMEES.includes('the-nuke-end'));
  assert.equal(m.fermetureAutoH, 0, 'jamais fermée automatiquement');
  assert.equal(m.fermetureStaffSeul, true);
  assert.ok(!m.prioriteDefaut || m.prioriteDefaut === 'moyen');
  assert.deepEqual(m.formulaire.map(c => [c.id, c.style, c.requis]), [
    ['equipe', 'court', true],
    ['tag', 'court', true],
    ['joueurs', 'long', true],
    ['coach', 'court', false],
    ['remplacants', 'long', false],
  ]);
  const tag = m.formulaire.find(c => c.id === 'tag');
  assert.deepEqual([tag.min, tag.max], [3, 4]);
  assert.ok(m.formulaire.find(c => c.id === 'equipe').max <= 50);
  for (const c of m.formulaire) {
    assert.ok(c.min >= 0 && c.min <= c.max && c.max <= 4000);
    for (const l of ['fr', 'en']) {
      assert.ok(c.libelle[l].length <= 45, `${c.id} libellé ${l}`);
      assert.ok(c.placeholder[l].length <= 100, `${c.id} exemple ${l} : ${c.placeholder[l].length}`);
    }
  }
  assert.match(m.formulaire.find(c => c.id === 'joueurs').placeholder.fr, /Discord ID — Embark ID/);
  for (const l of ['fr', 'en']) {
    assert.ok(m.accueil[l].length <= 1500);
    assert.match(m.accueil[l], /logo/);
    assert.doesNotMatch(m.accueil[l], /https?:|forms\./, 'aucun lien de formulaire externe');
  }
  const corps = corpsModele(m);
  assert.deepEqual(corps.accueil, m.accueil);
  assert.deepEqual([corps.rolesApp, corps.rolesDiscord], [[], []], 'qui traite : à configurer');
});

async function preparer({ general = {} } = {}) {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: '710000000000000010', actif: true, langue: 'auteur', ...general } });
  const creer = corps => k.api('/tickets/config/panneaux/defaut', undefined, { methode: 'POST', corps });
  return { k, creer };
}

test('création « Support LZ » : catégories manquantes ajoutées sur demande, menu au-delà de 5, jamais publié', async () => {
  const { k, creer } = await preparer();
  const conf = (await k.api('/tickets/config')).corps;
  assert.equal(conf.modelesPanneaux.length, PANNEAUX_DEFAUT.length, 'modèles rendus à l’app');
  // Une catégorie maison existe déjà : elle est gardée, en tête.
  await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Maison', en: 'House' } } });
  const r = await creer({ modele: 'support', ajouterManquantes: true });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.ajoutees, CLES_SEMEES);
  assert.deepEqual(r.corps.ignorees, []);
  assert.equal(r.corps.renomme, false);
  const p = r.corps.panneau;
  assert.equal(p.style, 'menu');
  assert.equal(p.categories.length, CLES_SEMEES.length + 1);
  assert.equal(p.categories[0], r.corps.categories[0].id, 'dans l’ordre des catégories');
  assert.deepEqual([p.salonId, p.messageId, p.publieLe], [null, null, null], 'pas publié');
  assert.equal(p.titre.fr, 'Centre d’aide LZ');
  assert.match(p.texte.fr, /Écrivez et envoyez vos fichiers directement dans votre ticket/, 'consigne : écrire directement');
  assert.doesNotMatch(p.texte.fr, /Répondre/);
  assert.equal(k.discord.appels.filter(a => a.methode === 'POST' && a.chemin.endsWith('/messages')).length, 0, 'rien posté sur Discord');
  const ap = (await k.api(`/tickets/config/panneaux/${p.id}/apercu`)).corps.charge;
  verifierCharge(ap, 'aperçu');
  assert.equal(ap.components[0].components[0].options.length, CLES_SEMEES.length + 1);
  // Deuxième fois : titre renuméroté, rien de rajouté.
  const r2 = await creer({ modele: 'support', ajouterManquantes: true });
  assert.equal(r2.corps.renomme, true);
  assert.equal(r2.corps.panneau.titre.fr, 'Centre d’aide LZ (2)');
  assert.equal(r2.corps.panneau.titre.en, 'LZ Help Center (2)');
  assert.deepEqual(r2.corps.ajoutees, []);
  assert.equal((await creer({ modele: 'support' })).corps.panneau.titre.fr, 'Centre d’aide LZ (3)');
});

test('création sans les catégories manquantes : laissées de côté et signalées ; horaires et réponses dans le salon', async () => {
  const { k, creer } = await preparer({ general: { reponsesAppSeules: false } });
  await k.api('/tickets/config/horaires', undefined, { methode: 'PUT', corps: { actif: true, fuseau: 'Europe/Paris', plages: [{ jour: 1, debut: '18:00', fin: '22:00' }] } });
  // « Candidature staff » existe (nom anglais, casse différente) ; « Recrutement joueur » non.
  const staff = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Staff', en: 'STAFF application' } } })).corps.id;
  const r = await creer({ modele: 'recrutement', ajouterManquantes: false });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.ajoutees, []);
  assert.deepEqual(r.corps.ignorees, ['recrutement']);
  assert.deepEqual(r.corps.panneau.categories, [staff]);
  assert.equal(r.corps.panneau.style, 'boutons');
  assert.match(r.corps.panneau.texte.fr, /Écrivez et envoyez vos fichiers directement/);
  assert.match(r.corps.panneau.texte.fr, /\*\*Horaires du support\*\* : lundi 18:00-22:00 \(Europe\/Paris\)/);
  assert.match(r.corps.panneau.texte.en, /Monday 18:00-22:00/);
  // Partenariats sans rien : panneau vide (publication refusée tant qu'aucune catégorie n'est choisie).
  const vide = await creer({ modele: 'partenariats' });
  assert.deepEqual(vide.corps.panneau.categories, []);
  assert.deepEqual(vide.corps.ignorees, ['partenariat']);
  await k.api(`/tickets/config/panneaux/${vide.corps.panneau.id}`, undefined, { methode: 'PATCH', corps: { salonId: SALON } });
  assert.equal((await k.api(`/tickets/config/panneaux/${vide.corps.panneau.id}/publier`, undefined, { methode: 'POST' })).statut, 400);
  // Erreurs : modèle inconnu, événement sans nom, catégorie inconnue, droits.
  assert.equal((await creer({ modele: 'inconnu' })).statut, 400);
  assert.equal((await creer({ modele: 'evenement', evenement: '  ' })).corps.code, 'evenement');
  assert.equal((await creer({ modele: 'evenement', evenement: 'x'.repeat(101) })).statut, 400);
  assert.equal((await creer({ modele: 'evenement', evenement: 'Coupe', categorieId: 'introuvable' })).statut, 400);
  const sans = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/tickets/config/panneaux/defaut', sans.jeton, { methode: 'POST', corps: { modele: 'support' } })).statut, 403);
});

test('« Tournoi / Événement » : nom et catégorie choisis, bouton « S’inscrire » ; « The Nuke End » : catégorie ajoutée, publication', async () => {
  const { k, creer } = await preparer();
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Coupe', en: 'Cup' } } })).corps.id;
  const ev = await creer({ modele: 'evenement', evenement: '  Coupe   LZ  ', categorieId: cat, ajouterManquantes: true });
  assert.equal(ev.statut, 200, JSON.stringify(ev.corps));
  assert.deepEqual(ev.corps.ajoutees, [], 'catégorie choisie : rien d’autre ajouté');
  assert.equal(ev.corps.panneau.titre.fr, 'Inscription — Coupe LZ');
  assert.deepEqual(ev.corps.panneau.categories, [cat]);
  assert.deepEqual(ev.corps.panneau.libelles, { [cat]: { fr: 'S’inscrire', en: 'Register' } });
  const ap = (await k.api(`/tickets/config/panneaux/${ev.corps.panneau.id}/apercu`)).corps.charge;
  assert.equal(ap.components[0].components[0].label, 'Register · S’inscrire');
  assert.equal(ap.components[0].components[0].custom_id, `tk:o:${cat}`);

  const ne = await creer({ modele: 'the-nuke-end', ajouterManquantes: true });
  assert.equal(ne.statut, 200, JSON.stringify(ne.corps));
  assert.deepEqual(ne.corps.ajoutees, ['the-nuke-end']);
  const nuke = ne.corps.categories.find(c => c.nom.fr === 'Inscription The Nuke End');
  assert.ok(nuke);
  assert.equal(nuke.fermetureAutoH, 0);
  assert.equal(nuke.fermetureStaffSeul, true);
  assert.equal(nuke.prioriteDefaut, 'moyen');
  assert.deepEqual([nuke.rolesApp, nuke.rolesDiscord], [[], []]);
  assert.match(nuke.accueil.fr, /logo/);
  assert.deepEqual(nuke.formulaire.find(c => c.id === 'tag'), { id: 'tag', libelle: { fr: 'TAG (3 à 4 lettres)', en: 'TAG (3 to 4 letters)' }, style: 'court', requis: true, placeholder: { fr: 'Ex. : LZ0', en: 'E.g. LZ0' }, min: 3, max: 4 });
  const p = ne.corps.panneau;
  assert.equal(p.titre.fr, 'Inscription — The Nuke End');
  assert.match(p.texte.fr, /3v3v3v3/);
  assert.match(p.texte.en, /Embark ID/);
  assert.deepEqual(p.categories, [nuke.id]);
  assert.equal(p.publieLe, null, 'pas publié');
  // Toujours modifiable : libellé changé, puis publication dans le salon choisi.
  const maj = await k.api(`/tickets/config/panneaux/${p.id}`, undefined, { methode: 'PATCH', corps: { salonId: SALON, libelles: { [nuke.id]: { fr: 'Inscrire mon équipe', en: 'Register my team' } } } });
  assert.equal(maj.statut, 200, JSON.stringify(maj.corps));
  const pub = await k.api(`/tickets/config/panneaux/${p.id}/publier`, undefined, { methode: 'POST' });
  assert.equal(pub.statut, 200, JSON.stringify(pub.corps));
  const post = k.discord.appels.find(a => a.methode === 'POST' && a.chemin === `/channels/${SALON}/messages`);
  assert.equal(post.corps.components[0].components[0].label, 'Register my team · Inscrire mon équipe');
  verifierCharge(post.corps, 'publication');
  // Libellés invalides refusés ; vides retirés.
  assert.equal((await k.api(`/tickets/config/panneaux/${p.id}`, undefined, { methode: 'PATCH', corps: { libelles: { [nuke.id]: { fr: 'x'.repeat(81) } } } })).statut, 400);
  assert.equal((await k.api(`/tickets/config/panneaux/${p.id}`, undefined, { methode: 'PATCH', corps: { libelles: [] } })).statut, 400);
  assert.deepEqual((await k.api(`/tickets/config/panneaux/${p.id}`, undefined, { methode: 'PATCH', corps: { libelles: { [nuke.id]: { fr: '', en: '' } } } })).corps.libelles, {});
  // Deuxième « The Nuke End » : la catégorie n'est pas recréée, le titre est renuméroté.
  const ne2 = await creer({ modele: 'the-nuke-end', ajouterManquantes: true });
  assert.deepEqual(ne2.corps.ajoutees, []);
  assert.equal(ne2.corps.renomme, true);
  assert.equal(ne2.corps.categories.filter(c => c.nom.fr === 'Inscription The Nuke End').length, 1);
});

test('limite de 20 panneaux respectée par les modèles', async () => {
  const { k, creer } = await preparer();
  for (let i = 0; i < LIMITES.panneaux; i++) assert.equal((await k.api('/tickets/config/panneaux', undefined, { methode: 'POST', corps: { titre: { fr: `P${i}`, en: `P${i}` } } })).statut, 200);
  assert.equal((await creer({ modele: 'partenariats', ajouterManquantes: true })).statut, 409);
  assert.equal((await k.api('/tickets/config')).corps.categories.length, 0, 'aucune catégorie ajoutée pour rien');
});
