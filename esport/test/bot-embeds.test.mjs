/**
 * Embeds Discord (fonctions pures) : limites de Discord (25 champs, 1024
 * caractères par champ, 256 pour un titre, 4096 pour la description, 6000 au
 * total), couleurs et emojis par type, horodatages, convoqués, réponses,
 * boutons RSVP et pagination, carte Valorant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITES_EMBED,
  boutonsPagination,
  boutonsRsvp,
  bornerEmbed,
  bornerEmbeds,
  carteDans,
  embedEvenement,
  occurrenceCourte,
  occurrenceLongue,
  paginer,
  tailleEmbed,
  texteConvoques,
  texteReponses,
} from '../noyau/discord/embeds.mjs';

const DEBUT = Date.parse('2026-10-22T18:30:00Z');

test('limites : 25 champs, 1024 par valeur, 256 par nom et titre, 4096 de description, 6000 au total', () => {
  const e = bornerEmbed({
    title: 'T'.repeat(400),
    description: 'D'.repeat(5000),
    fields: Array.from({ length: 40 }, (_, i) => ({ name: `N${i}`.padEnd(300, 'n'), value: 'V'.repeat(2000) })),
    footer: { text: 'P'.repeat(3000) },
    author: { name: 'A'.repeat(300) },
  });
  assert.equal(e.title.length, LIMITES_EMBED.titre);
  assert.ok(e.description === undefined || e.description.length <= LIMITES_EMBED.description);
  assert.ok(e.fields.length <= 25);
  assert.ok(e.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
  assert.ok(e.footer.text.length <= 2048 && e.author.name.length <= 256);
  assert.ok(tailleEmbed(e) <= 6000, `total ${tailleEmbed(e)}`);
  // Petit embed : intact.
  const petit = { title: 'Ok', description: 'Court', fields: [{ name: 'a', value: 'b' }] };
  assert.deepEqual(bornerEmbed(petit), petit);
  // Plusieurs embeds : 6000 en tout, 10 au plus.
  const liste = bornerEmbeds(Array.from({ length: 12 }, () => ({ title: 'x', description: 'y'.repeat(1500) })));
  assert.ok(liste.length <= 10);
  assert.ok(liste.reduce((n, x) => n + tailleEmbed(x), 0) <= 6000);
  // Champs vides retirés (Discord les refuse).
  assert.equal(bornerEmbed({ fields: [{ name: 'a', value: '' }] }).fields, undefined);
});

test('embed d’événement : couleur et emoji du type, Quand en horodatages Discord, champs, miniature, pied, lien', () => {
  const types = { scrim: ['⚔️', 0x7c3aed], match: ['🏆', 0xdc2626], training: ['🎯', 0x2563eb], tournament: ['🏟️', 0xd97706], meeting: ['📋', 0x0891b2] };
  for (const [type, [emoji, couleur]] of Object.entries(types)) {
    const e = embedEvenement({ occurrence: { titre: 'Titre', type, debut: DEBUT }, team: { nom: 'Faucons' }, maintenant: DEBUT });
    assert.ok(e.title.startsWith(`${emoji} `), e.title);
    assert.equal(e.color, couleur);
  }
  const e = embedEvenement({
    genre: 'reminder_h1',
    occurrence: { titre: 'Match @everyone <@123>', type: 'match', debut: DEBUT, fin: DEBUT + 5_400_000, lieu: 'LAN' },
    team: { nom: 'Faucons', logo: 'https://exemple.fr/logo.png' },
    carte: carteDans('Match sur Bind'),
    adversaire: { nom: 'Les Aigles', logo: 'https://exemple.fr/aigles.png' },
    convoques: [{ pseudo: 'Léa', discordId: '800000000000000001' }, { pseudo: 'Max <@&1>', discordId: null }],
    reponses: { oui: 3, peut_etre: 1, non: 0, sans: 2 },
    texte: 'Ça commence bientôt',
    lien: 'https://app.exemple',
    maintenant: DEBUT - 3_600_000,
  });
  assert.equal(e.author.name, '⏳ Rappel : c’est dans moins d’une heure');
  assert.ok(!/@everyone/.test(e.title) && !/<@1/.test(e.title), e.title);
  const champ = nom => e.fields.find(f => f.name.includes(nom))?.value;
  assert.equal(champ('Quand'), `<t:${DEBUT / 1000}:F>\n<t:${DEBUT / 1000}:R>`);
  assert.equal(champ('Fin'), `<t:${(DEBUT + 5_400_000) / 1000}:t>`);
  assert.equal(champ('Map'), 'Bind');
  assert.equal(champ('Adversaire'), 'Les Aigles');
  assert.equal(champ('Convoqués'), '<@800000000000000001> · Max <​@&1>');
  assert.equal(champ('Réponses'), '✅ **3** Oui · 🤔 **1** Peut-être · ❌ **0** Non · ⏳ 2 sans réponse');
  assert.match(e.thumbnail.url, /maps\/2c9d57ec-.*\/listviewicon\.png$/, 'miniature : la carte d’abord');
  assert.deepEqual(e.footer, { text: 'Faucons · Esport', icon_url: 'https://exemple.fr/logo.png' });
  assert.equal(e.url, 'https://app.exemple');
  assert.equal(e.timestamp, new Date(DEBUT - 3_600_000).toISOString());
  assert.ok(e.fields.filter(f => f.inline).length >= 3, 'champs alignés');
  // Sans carte : logo de l'adversaire, puis de la team ; adresse non https ignorée.
  assert.equal(embedEvenement({ occurrence: { titre: 'x', type: 'scrim', debut: DEBUT }, adversaire: { nom: 'A', logo: 'https://a.fr/l.png' } }).thumbnail.url, 'https://a.fr/l.png');
  assert.equal(embedEvenement({ occurrence: { titre: 'x', type: 'scrim', debut: DEBUT }, team: { nom: 'T', logo: 'javascript:alert(1)' } }).thumbnail, undefined);
});

test('convoqués : 200 joueurs tiennent dans 1024 caractères (« et N autres »), réponses, liste vide', () => {
  const beaucoup = Array.from({ length: 200 }, (_, i) => ({ pseudo: `Joueur${i}`, discordId: i % 2 ? `8000000000000${String(i).padStart(5, '0')}` : null }));
  const t = texteConvoques(beaucoup);
  assert.ok(t.length <= 1024, String(t.length));
  assert.match(t, /et \d+ autres$/);
  assert.equal(texteConvoques([]), 'Toute la team');
  assert.equal(texteReponses({ oui: 1 }), '✅ **1** Oui · 🤔 **0** Peut-être · ❌ **0** Non');
  const e = embedEvenement({ occurrence: { titre: 'x', type: 'scrim', debut: DEBUT }, convoques: beaucoup, reponses: { oui: 0, peut_etre: 0, non: 0, sans: 200 } });
  assert.ok(tailleEmbed(e) <= 6000);
});

test('composants : boutons RSVP (vert, gris, rouge, emojis, identifiants ≤ 100), lien, pagination', () => {
  const ev = '6039e222-7104-44d3-8bd0-e8d1ca3de6aa';
  const occ = '2026-10-24T18:30:00.000Z';
  const [ligne] = boutonsRsvp(ev, occ, { lien: 'https://app.exemple' });
  assert.deepEqual(ligne.components.map(b => [b.style, b.label, b.emoji.name]), [[3, 'Oui', '✅'], [2, 'Peut-être', '🤔'], [4, 'Non', '❌'], [5, 'Ouvrir dans l’app', '📲']]);
  for (const b of ligne.components.slice(0, 3)) assert.ok(b.custom_id.length <= 100);
  assert.equal(ligne.components[0].custom_id, `r:${ev}:${occurrenceCourte(occ)}:o`);
  assert.equal(occurrenceLongue(occurrenceCourte(occ)), occ);
  assert.equal(boutonsRsvp(ev, occ)[0].components.length, 3, 'sans lien : trois boutons');
  assert.deepEqual(boutonsPagination('taches', 1, 1), []);
  const pg = boutonsPagination('planning.7', 2, 3)[0].components;
  assert.deepEqual(pg.map(b => [b.custom_id, b.disabled]), [['pg:planning.7:1', false], ['pg:noop:2', true], ['pg:planning.7:3', false]]);
  assert.deepEqual(paginer([1, 2, 3, 4, 5, 6, 7], 9, 3), { elements: [7], page: 3, pages: 3 });
  assert.deepEqual(paginer([], 1, 3), { elements: [], page: 1, pages: 1 });
});

test('cartes Valorant : détectées dans un texte, sans faux positif', () => {
  assert.equal(carteDans('Scrim Ascent vs X').nom, 'Ascent');
  assert.equal(carteDans('', 'Lieu : HAVEN').nom, 'Haven');
  assert.equal(carteDans('Splitting hairs'), null);
  assert.equal(carteDans(null, undefined), null);
});
