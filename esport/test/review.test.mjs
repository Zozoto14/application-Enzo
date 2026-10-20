/**
 * Review vidéo (phase 5) : extraction des identifiants YouTube, nettoyage XSS
 * des notes, export Markdown, droits (le Joueur commente mais ne supprime pas),
 * isolation entre teams, module désactivé, bus (review.created), migration 0005.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseSqlite, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { exporterMarkdown, formatTemps, nomFichierExport } from '../noyau/review/export.mjs';
import { COULEURS, lienSur, nettoyerNote, NOTE_MAX } from '../noyau/review/markdown.mjs';
import { adresseYoutube, extraireYoutube, idYoutubeValide, lienYoutubeA, secondesDe } from '../noyau/review/youtube.mjs';

const ID = 'dQw4w9WgXcQ';

test('YouTube : extraction de l’identifiant (watch, youtu.be, shorts, embed, live)', () => {
  const bons = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `http://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/v/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
  ];
  for (const u of bons) assert.equal(extraireYoutube(u)?.id, ID, u);
  assert.equal(extraireYoutube(`https://youtu.be/${ID}?t=90`).debut, 90);
  assert.equal(extraireYoutube(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`).debut, 3723);
  assert.equal(extraireYoutube(`https://www.youtube.com/watch?v=${ID}&t=42s`).debut, 42);
  assert.equal(extraireYoutube(`https://www.youtube.com/embed/${ID}?start=12`).debut, 12);
  assert.equal(extraireYoutube(`https://youtu.be/${ID}`).debut, undefined);

  const mauvais = [
    '',
    undefined,
    null,
    'pas une adresse',
    'https://www.youtube.com/',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=court',
    `https://www.youtube.com/watch?v=${ID}x`,
    'https://www.youtube.com/watch?v=<script>al',
    'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx',
    'https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx',
    `https://youtube.com.exemple.fr/watch?v=${ID}`,
    `https://exemple.fr/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://youtu.be.exemple.fr/${ID}`,
    `https://vimeo.com/${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    `data:text/html,https://youtu.be/${ID}`,
    `https://user:pass@youtu.be/${ID}`,
    `https://youtu.be/${'a'.repeat(3000)}`,
  ];
  for (const u of mauvais) assert.equal(extraireYoutube(u), null, String(u));
  assert.equal(idYoutubeValide(ID), true);
  assert.equal(idYoutubeValide('a b'), false);
  assert.equal(adresseYoutube(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(lienYoutubeA(ID, 83.9), `https://www.youtube.com/watch?v=${ID}&t=83s`);
  assert.equal(lienYoutubeA(ID, -4), `https://www.youtube.com/watch?v=${ID}&t=0s`);
  assert.equal(secondesDe('1m30s'), 90);
  assert.equal(secondesDe('abc'), undefined);
  assert.equal(secondesDe(''), undefined);
});

test('notes : nettoyage XSS (HTML neutralisé, liens http(s) seulement, images retirées)', () => {
  const dangereux = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">clic</a>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '&#60;script&#62;alert(1)&#60;/script&#62;',
    '&#x3C;img src=x onerror=alert(1)&#x3E;',
    '<<script>script>alert(1)<</script>/script>',
  ];
  for (const brut of dangereux) {
    const propre = nettoyerNote(brut);
    assert.doesNotMatch(propre, /<[a-z/!]/i, `balise restante : ${brut} → ${propre}`);
    assert.doesNotMatch(propre, /[<>]/, brut);
  }
  assert.equal(nettoyerNote('<b>gras</b>'), '&lt;b&gt;gras&lt;/b&gt;');
  // Liens : seuls http et https survivent ; sinon le texte reste.
  assert.equal(nettoyerNote('[voir](javascript:alert(1))'), 'voir');
  assert.equal(nettoyerNote('[voir](JaVaScRiPt:alert(1))'), 'voir');
  assert.equal(nettoyerNote('[voir](data:text/html;base64,AAAA)'), 'voir');
  assert.equal(nettoyerNote('[voir](vbscript:msgbox)'), 'voir');
  assert.equal(nettoyerNote('[voir]( javascript:alert(1))'), 'voir');
  assert.equal(nettoyerNote('[voir](//evil.example/x)'), 'voir');
  assert.equal(nettoyerNote('[voir](https://exemple.fr/a?b=1)'), '[voir](https://exemple.fr/a?b=1)');
  assert.equal(nettoyerNote('[voir](http://exemple.fr)'), '[voir](http://exemple.fr)');
  assert.equal(nettoyerNote('![logo](https://exemple.fr/x.png)'), 'logo');
  assert.equal(nettoyerNote('![x](javascript:alert(1))'), 'x');
  assert.equal(nettoyerNote('[x]: javascript:alert(1)\nTexte'), 'Texte');
  assert.equal(lienSur('https://exemple.fr/a'), true);
  assert.equal(lienSur('javascript:alert(1)'), false);
  assert.equal(lienSur('https://exemple.fr/a b'), false);
  // Le Markdown limité reste intact.
  const ok = '**Erreur** de placement\n\n- *premier* point\n- `code`\n\n1. un\n2. deux\n\n### Titre';
  assert.equal(nettoyerNote(ok), ok);
  // Contrôles et sens d'écriture retirés, retours Windows normalisés, longueur bornée.
  assert.equal(nettoyerNote('a\u0000b‮c\r\nd'), 'abc\nd');
  assert.equal(nettoyerNote('x'.repeat(9000)).length, NOTE_MAX);
  assert.equal(nettoyerNote(undefined), '');
  // Idempotent : repasser une note déjà nettoyée ne change rien.
  for (const brut of dangereux) assert.equal(nettoyerNote(nettoyerNote(brut)), nettoyerNote(brut), brut);
});

test('notes : nouveaux éléments (titres, listes, cases, citation, code, séparateur, barré, couleurs) conservés, sans HTML', () => {
  const riche = [
    '# Titre', '## Sous-titre', '### Petit', '',
    '1. un', '2. deux', '   - imbriqué', '',
    '- [ ] à faire', '- [x] fait', '',
    '> citation de **Kai**', '', '---', '',
    '~~barré~~ ==surligné== {{rouge|alerte}} {{vert|ok}} @Kai',
    '', '```', 'const x = 1;', '```', '', '`en ligne`',
  ].join('\n');
  assert.equal(nettoyerNote(riche), riche, 'le Markdown limité étendu reste intact');
  assert.equal(nettoyerNote(nettoyerNote(riche)), riche, 'idempotent');
  // Couleur hors liste ou syntaxe détournée : le texte seul.
  assert.equal(nettoyerNote('{{javascript|alerte}}'), 'alerte');
  assert.equal(nettoyerNote('{{rouge;background:url(x)|a}}'), 'a');
  assert.equal(nettoyerNote('{{rouge|ok}}'), '{{rouge|ok}}');
  assert.equal(COULEURS.length, 8);
  // Pas de HTML : dans la citation, le code, les titres, les cases et les couleurs.
  const piege = ['> <img src=x onerror=alert(1)>', '```', '<script>alert(1)</script>', '```', '# <b>t</b>', '- [ ] <i>x</i>', '{{rouge|<u>x</u>}}', '[x](javascript:alert(1))'].join('\n');
  const propre = nettoyerNote(piege);
  assert.ok(!/<[a-z/!]/i.test(propre), propre);
  assert.ok(propre.includes('> &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(propre.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!propre.includes('javascript:'));
  assert.equal(nettoyerNote(propre), propre, 'idempotent');
  // Dans un bloc de code, les liens ne sont pas réécrits (mais restent neutres) ; un bloc non fermé va jusqu'à la fin.
  assert.equal(nettoyerNote('```\n[a](javascript:x)\n```'), '```\n[a](javascript:x)\n```');
  assert.equal(nettoyerNote('```\n<b>x'), '```\n&lt;b&gt;x');
});

test('export Markdown : titre, repères triés, liens à l’instant, commentaires, rien de dangereux', () => {
  assert.equal(formatTemps(83.4), '01:23');
  assert.equal(formatTemps(3725), '1:02:05');
  assert.equal(formatTemps(-5), '00:00');
  const md = exporterMarkdown({
    review: { titre: 'Faucons vs <Nova>', url: adresseYoutube(ID), videoId: ID, reference: 'Match de ligue J4' },
    equipe: 'Faucons',
    exporteLe: '2026-10-20T10:00:00.000Z',
    reperes: [
      { debut: 12, fin: null, categorie: 'erreur', titre: 'Peek trop large', note: 'Il fallait **jouer le trade**.', cible: 'Léa', auteur: 'Zed', commentaires: [{ auteur: 'Kai', texte: 'Je confirme <b>fort</b>', creeLe: '2026-10-20T11:00:00.000Z' }] },
      { debut: 3725, fin: 3745, categorie: 'bonne_action', titre: 'Clutch 1v3', note: '', cible: null, auteur: null, commentaires: [] },
    ],
  });
  assert.match(md, /^# Faucons vs &lt;Nova&gt;$/m);
  assert.match(md, /^- Vidéo : https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ$/m);
  assert.match(md, /^- Référence : Match de ligue J4$/m);
  assert.match(md, /^### \[00:12\] Peek trop large$/m);
  assert.match(md, /^### \[1:02:05 → 1:02:25\] Clutch 1v3$/m);
  assert.match(md, /\*\*Erreur\*\* · \*\*Joueur : Léa\*\* · \*\*Auteur : Zed\*\*/);
  assert.match(md, /\[Ouvrir à 00:12\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=12s\)/);
  assert.match(md, /Il fallait \*\*jouer le trade\*\*\./);
  assert.match(md, /- Kai \(2026-10-20\) : Je confirme &lt;b&gt;fort&lt;\/b&gt;/);
  assert.doesNotMatch(md, /<[a-z]/i);
  assert.ok(md.endsWith('\n'));
  assert.match(exporterMarkdown({ review: { titre: 'Vide', url: adresseYoutube(ID), videoId: ID }, reperes: [] }), /Aucun repère/);
  assert.equal(nomFichierExport('Faucons/vs: "Nova"?'), 'Review - Faucons vs Nova.md');
  assert.equal(nomFichierExport(''), 'Review - sans titre.md');
});

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  rem12345: { pseudo: 'Rem', role: 'remplacant' },
  max12345: { pseudo: 'Max', role: 'manager' },
};
const URL_VIDEO = `https://youtu.be/${ID}`;

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const creerReview = async (jeton = A.sessions.coach123, team = A.teamId, corps = { titre: 'Faucons vs Nova', url: URL_VIDEO, reference: 'Match J4' }) =>
    api(`/teams/${team}/review`, jeton, { methode: 'POST', corps });
  return { b, A, B, api, creerReview, s: A.sessions };
}

test('review : création depuis une URL YouTube, validation, détail et liste', async () => {
  const { A, api, creerReview, s } = await preparer();
  for (const url of ['https://exemple.fr/video', 'https://youtube.com.evil.fr/watch?v=' + ID, '', 'javascript:alert(1)']) {
    const r = await creerReview(s.coach123, A.teamId, { titre: 'X vs Y', url });
    assert.equal(r.statut, 400, url);
    assert.equal(r.corps.code, 'url-youtube');
  }
  assert.equal((await creerReview(s.coach123, A.teamId, { titre: 'x', url: URL_VIDEO })).statut, 400, 'titre trop court');
  const r = await creerReview(s.coach123, A.teamId, { titre: '  Faucons   vs Nova  ', url: `https://www.youtube.com/shorts/${ID}`, reference: 'Match J4' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.titre, 'Faucons vs Nova');
  assert.equal(r.corps.videoId, ID);
  assert.equal(r.corps.url, adresseYoutube(ID), 'adresse canonique stockée');
  assert.equal(r.corps.creePar.pseudo, 'Coach Zed');
  const liste = await api(`/teams/${A.teamId}/review`, s.lea12345);
  assert.equal(liste.statut, 200);
  assert.equal(liste.corps.reviews.length, 1);
  assert.deepEqual(liste.corps.droits, { creer: false, annoter: true, supprimer: false, reagir: true });
  const detail = await api(`/teams/${A.teamId}/review/${r.corps.id}`, s.lea12345);
  assert.equal(detail.corps.review.reference, 'Match J4');
  assert.deepEqual(detail.corps.reperes, []);
  assert.ok(detail.corps.membres.some(m => m.pseudo === 'Léa'));
  assert.equal((await api(`/teams/${A.teamId}/review/${r.corps.id}`, s.coach123, { methode: 'PATCH', corps: { titre: 'Nouveau titre' } })).corps.titre, 'Nouveau titre');
  assert.equal((await api(`/teams/${A.teamId}/review/${r.corps.id}`, s.lea12345, { methode: 'PATCH', corps: { titre: 'Piraté' } })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/review/pas-un-uuid`, s.coach123)).statut, 404);
});

test('review : repères (validation, catégories, durée, joueur concerné) et notes nettoyées', async () => {
  const { A, api, creerReview, s } = await preparer();
  const id = (await creerReview()).corps.id;
  const ajouter = (corps, jeton = s.coach123) => api(`/teams/${A.teamId}/review/${id}/reperes`, jeton, { methode: 'POST', corps });
  const base = { debut: 83.46, categorie: 'erreur', titre: 'Peek trop large', note: 'Il fallait **trader**', cible: 'lea12345' };
  const r = await ajouter(base);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.debut, 83.5, 'arrondi au dixième');
  assert.equal(r.corps.fin, null);
  assert.equal(r.corps.cible.pseudo, 'Léa');
  assert.equal(r.corps.auteur.pseudo, 'Coach Zed');
  // Validation.
  for (const [corps, code] of [
    [{ ...base, categorie: 'autre' }, 'categorie'],
    [{ ...base, titre: 'x' }, 'titre'],
    [{ ...base, debut: -3 }, 'debut'],
    [{ ...base, debut: 'abc' }, 'debut'],
    [{ ...base, debut: 99999999 }, 'debut'],
    [{ ...base, fin: 80 }, 'fin'],
    [{ ...base, duree: 7200 }, 'fin'],
    [{ ...base, cible: 'inconnu12' }, 'cible'],
    [{ ...base, cible: 'bob12345' }, 'cible'], // membre d'une AUTRE team
  ]) {
    const e = await ajouter(corps);
    assert.equal(e.statut, 400, JSON.stringify(corps));
    assert.equal(e.corps.code, code);
  }
  // Durée : en secondes (duree) ou en instant (fin).
  assert.equal((await ajouter({ ...base, debut: 10, duree: 15, cible: null })).corps.fin, 25);
  assert.equal((await ajouter({ ...base, debut: 10, fin: 40, cible: null })).corps.fin, 40);
  // Notes : le HTML est neutralisé côté serveur.
  const xss = await ajouter({ ...base, debut: 5, note: '<script>alert(1)</script> [clic](javascript:alert(1)) <img src=x onerror=alert(2)>' });
  assert.equal(xss.statut, 200);
  assert.doesNotMatch(xss.corps.note, /[<>]/);
  assert.doesNotMatch(xss.corps.note, /javascript:/i);
  // Triés par instant.
  const detail = await api(`/teams/${A.teamId}/review/${id}`, s.coach123);
  assert.deepEqual(detail.corps.reperes.map(r => r.debut), [5, 10, 10, 83.5]);
  // Modification : l'instant bouge, la durée est gardée.
  const dur = detail.corps.reperes.find(r => r.fin === 25);
  const m = await api(`/teams/${A.teamId}/review/${id}/reperes/${dur.id}`, s.coach123, { methode: 'PATCH', corps: { debut: 20 } });
  assert.equal(m.corps.debut, 20);
  assert.equal(m.corps.fin, 35);
  const m2 = await api(`/teams/${A.teamId}/review/${id}/reperes/${dur.id}`, s.coach123, { methode: 'PATCH', corps: { duree: null, categorie: 'comms' } });
  assert.equal(m2.corps.fin, null);
  assert.equal(m2.corps.categorie, 'comms');
});

test('droits : un Joueur commente mais ne supprime pas ; le staff supprime', async () => {
  const { A, api, creerReview, s } = await preparer();
  const id = (await creerReview()).corps.id;
  const repere = (await api(`/teams/${A.teamId}/review/${id}/reperes`, s.coach123, { methode: 'POST', corps: { debut: 30, categorie: 'placement', titre: 'Mauvais angle' } })).corps;
  const r = (suite = '') => `/teams/${A.teamId}/review/${id}${suite}`;

  // Léa (Joueur) : lit, commente, mais ne crée ni ne supprime la review ni le travail d'un autre.
  const com = await api(r(`/reperes/${repere.id}/commentaires`), s.lea12345, { methode: 'POST', corps: { texte: 'Je prends note <b>merci</b>' } });
  assert.equal(com.statut, 200, JSON.stringify(com.corps));
  assert.equal(com.corps.commentaires.length, 1);
  assert.equal(com.corps.commentaires[0].auteur.pseudo, 'Léa');
  assert.doesNotMatch(com.corps.commentaires[0].texte, /<b>/);
  assert.equal(com.corps.commentaires[0].peutSupprimer, true, 'son propre commentaire');
  assert.equal((await api(r(), s.lea12345, { methode: 'DELETE' })).statut, 403, 'supprimer la review');
  assert.equal((await api(r(`/reperes/${repere.id}`), s.lea12345, { methode: 'DELETE' })).statut, 403, 'supprimer le repère d’un autre');
  assert.equal((await api(r(`/reperes/${repere.id}`), s.lea12345, { methode: 'PATCH', corps: { titre: 'Piraté' } })).statut, 403, 'modifier le repère d’un autre');
  assert.equal((await creerReview(s.lea12345)).statut, 403, 'créer une review');
  // Kai ne supprime pas le commentaire de Léa.
  const comLea = com.corps.commentaires[0].id;
  assert.equal((await api(r(`/reperes/${repere.id}/commentaires/${comLea}`), s.kai12345, { methode: 'DELETE' })).statut, 403);
  // Léa ajoute un repère à elle, qu'elle peut modifier et supprimer.
  const sien = (await api(r('/reperes'), s.lea12345, { methode: 'POST', corps: { debut: 50, categorie: 'bonne_action', titre: 'Bon trade' } })).corps;
  assert.equal(sien.peutModifier && sien.peutSupprimer, true);
  assert.equal((await api(r(`/reperes/${sien.id}`), s.lea12345, { methode: 'PATCH', corps: { titre: 'Très bon trade' } })).statut, 200);
  assert.equal((await api(r(`/reperes/${sien.id}`), s.lea12345, { methode: 'DELETE' })).statut, 200);
  // Le Remplaçant ne voit rien (pas de video_review.view) ; le Manager lit seulement.
  assert.equal((await api(`/teams/${A.teamId}/review`, s.rem12345)).statut, 403);
  assert.equal((await api(r(), s.rem12345)).statut, 403);
  assert.equal((await api(r(), s.max12345)).statut, 200);
  assert.equal((await api(r('/reperes'), s.max12345, { methode: 'POST', corps: { debut: 1, categorie: 'comms', titre: 'Essai' } })).statut, 403);
  assert.equal((await api(r(`/reperes/${repere.id}/commentaires`), s.max12345, { methode: 'POST', corps: { texte: 'Essai' } })).statut, 403);
  // Le Coach supprime le commentaire de Léa, puis la review (suppression logique : plus lisible).
  assert.equal((await api(r(`/reperes/${repere.id}/commentaires/${comLea}`), s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(r(), s.coach123)).corps.reperes[0].commentaires.length, 0);
  assert.equal((await api(r(), s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(r(), s.coach123)).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/review`, s.coach123)).corps.reviews.length, 0);
  // L'Analyste crée et annote mais ne supprime pas une review.
  const ana = (await creerReview(s.ana12345)).corps.id;
  assert.equal((await api(`/teams/${A.teamId}/review/${ana}`, s.ana12345, { methode: 'DELETE' })).statut, 403);
});

test('isolation : une autre team (ou un non-membre) ne lit ni n’écrit, même avec les bons identifiants', async () => {
  const { A, B, api, creerReview, s } = await preparer();
  const id = (await creerReview()).corps.id;
  const repere = (await api(`/teams/${A.teamId}/review/${id}/reperes`, s.coach123, { methode: 'POST', corps: { debut: 3, categorie: 'erreur', titre: 'Secret de la team A' } })).corps;
  const bob = B.sessions.bob12345;
  // Bob (Coach de B) : la team A n'existe pas pour lui.
  for (const [chemin, methode, corps] of [
    [`/teams/${A.teamId}/review`, 'GET'],
    [`/teams/${A.teamId}/review`, 'POST', { titre: 'Intrus', url: URL_VIDEO }],
    [`/teams/${A.teamId}/review/${id}`, 'GET'],
    [`/teams/${A.teamId}/review/${id}`, 'DELETE'],
    [`/teams/${A.teamId}/review/${id}/export.md`, 'GET'],
    [`/teams/${A.teamId}/review/${id}/reperes`, 'POST', { debut: 1, categorie: 'erreur', titre: 'Intrus' }],
  ]) {
    assert.equal((await api(chemin, bob, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  }
  // Avec SA team et l'identifiant d'une review de A : introuvable (jamais de fuite).
  for (const [chemin, methode, corps] of [
    [`/teams/${B.teamId}/review/${id}`, 'GET'],
    [`/teams/${B.teamId}/review/${id}`, 'DELETE'],
    [`/teams/${B.teamId}/review/${id}`, 'PATCH', { titre: 'Volé' }],
    [`/teams/${B.teamId}/review/${id}/export.md`, 'GET'],
    [`/teams/${B.teamId}/review/${id}/reperes`, 'POST', { debut: 1, categorie: 'erreur', titre: 'Intrus' }],
    [`/teams/${B.teamId}/review/${id}/reperes/${repere.id}`, 'DELETE'],
    [`/teams/${B.teamId}/review/${id}/reperes/${repere.id}/commentaires`, 'POST', { texte: 'Intrus' }],
  ]) {
    assert.equal((await api(chemin, bob, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  }
  assert.equal((await api(`/teams/${B.teamId}/review`, bob)).corps.reviews.length, 0);
  // La review de A est intacte.
  assert.equal((await api(`/teams/${A.teamId}/review/${id}`, s.coach123)).corps.reperes.length, 1);
});

test('module désactivé : la review répond 404 ; réactivé, les données sont intactes', async () => {
  const { A, api, creerReview, s } = await preparer();
  const id = (await creerReview()).corps.id;
  const modules = actifs => api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { video_review: actifs } } });
  assert.equal((await modules(false)).statut, 200);
  for (const jeton of [s.coach123, s.fondateur]) {
    assert.equal((await api(`/teams/${A.teamId}/review`, jeton)).statut, 404);
    assert.equal((await api(`/teams/${A.teamId}/review/${id}`, jeton)).statut, 404);
    assert.equal((await creerReview(jeton)).statut, 404);
  }
  await modules(true);
  assert.equal((await api(`/teams/${A.teamId}/review/${id}`, s.coach123)).statut, 200);
});

test('export Markdown de l’API : fichier brut ou enveloppe JSON, repères et commentaires', async () => {
  const { A, b, api, creerReview, s } = await preparer();
  const id = (await creerReview()).corps.id;
  const repere = (await api(`/teams/${A.teamId}/review/${id}/reperes`, s.coach123, { methode: 'POST', corps: { debut: 62, categorie: 'utilitaires', titre: 'Fumée trop tôt', note: '- sortir après le **contact**', cible: 'kai12345' } })).corps;
  await api(`/teams/${A.teamId}/review/${id}/reperes/${repere.id}/commentaires`, s.kai12345, { methode: 'POST', corps: { texte: 'Compris' } });
  const json = await api(`/teams/${A.teamId}/review/${id}/export.md?format=json`, s.lea12345);
  assert.equal(json.statut, 200);
  assert.equal(json.corps.nom, 'Review - Faucons vs Nova.md');
  assert.match(json.corps.type, /^text\/markdown/);
  assert.match(json.corps.contenu, /^# Faucons vs Nova$/m);
  assert.match(json.corps.contenu, /^### \[01:02\] Fumée trop tôt$/m);
  assert.match(json.corps.contenu, /\*\*Utilitaires\*\* · \*\*Joueur : Kai\*\* · \*\*Auteur : Coach Zed\*\*/);
  assert.match(json.corps.contenu, /- Kai \(2026-10-20\) : Compris/);
  assert.match(json.corps.contenu, /^- Équipe : Team Alpha$/m);
  // Le Remplaçant n'exporte pas.
  assert.equal((await api(`/teams/${A.teamId}/review/${id}/export.md`, s.rem12345)).statut, 403);
  // Brut : pièce jointe Markdown.
  const r = await b.brut(`https://esport.test/teams/${A.teamId}/review/${id}/export.md`);
  assert.equal(r.status, 401, 'sans session');
});

test('bus : « review créée » dans l’outbox, le journal et les notifications ; commentaire notifié à l’auteur du repère', async () => {
  const { A, b, api, creerReview, s } = await preparer();
  const r = await creerReview(s.coach123);
  const ev = await b.base.premier("SELECT * FROM evenements WHERE type = 'review.created'", []);
  assert.ok(ev, 'événement review.created dans l’outbox');
  assert.equal(ev.team_id, A.teamId);
  assert.equal(ev.entite_id, r.corps.id);
  assert.equal(JSON.parse(ev.charge).videoId, ID);
  assert.ok(ev.traite_le, 'distribué');
  const journal = await api(`/teams/${A.teamId}/journal?action=review`, s.fondateur);
  assert.ok(journal.corps.entrees.some(e => e.action === 'review.created'));
  // Notifications : les lecteurs de la review (pas l'auteur, pas le Remplaçant).
  const dest = (await b.base.tous("SELECT compte_id FROM notifications WHERE type = 'review-nouvelle'", [])).map(n => n.compte_id);
  assert.ok(dest.includes('lea12345') && dest.includes('max12345') && dest.includes('principal'));
  assert.ok(!dest.includes('coach123') && !dest.includes('rem12345'));
  // Commentaire : l'auteur du repère est prévenu.
  const repere = (await api(`/teams/${A.teamId}/review/${r.corps.id}/reperes`, s.coach123, { methode: 'POST', corps: { debut: 9, categorie: 'comms', titre: 'Appel tardif' } })).corps;
  await api(`/teams/${A.teamId}/review/${r.corps.id}/reperes/${repere.id}/commentaires`, s.lea12345, { methode: 'POST', corps: { texte: 'Oui' } });
  assert.equal((await b.base.tous("SELECT id FROM notifications WHERE type = 'review-commentaire' AND compte_id = 'coach123'", [])).length, 1);
  const types = (await b.base.tous('SELECT type FROM evenements WHERE traite_le IS NULL', [])).map(e => e.type);
  assert.deepEqual(types, [], 'tout est distribué');
});

test('migration 0005 : les rôles système des teams existantes reçoivent les permissions review et scouting', async () => {
  const base = await baseSqlite();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0005'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  }
  await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES ('perso', 't', NULL, 'Perso', '#000000', 0, 9, ?, ?)", [d, d]);
  const jusqua5 = migrations.filter(m => m.nom < '0006');
  assert.deepEqual(await appliquerMigrations(base, jusqua5), ['0005_review_scouting.sql']);
  assert.deepEqual(await appliquerMigrations(base, jusqua5), [], 'idempotente');
  const perms = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND (permission LIKE 'video_review.%' OR permission LIKE 'scouting.%') ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual(await perms('coach'), ['scouting.manage', 'scouting.view', 'video_review.annotate', 'video_review.create', 'video_review.delete', 'video_review.view']);
  assert.deepEqual(await perms('analyste'), ['scouting.manage', 'scouting.view', 'video_review.annotate', 'video_review.create', 'video_review.view']);
  assert.deepEqual(await perms('manager'), ['scouting.view', 'video_review.view']);
  assert.deepEqual(await perms('joueur'), ['video_review.annotate', 'video_review.view'], 'le Joueur commente, aucun scouting');
  assert.deepEqual(await perms('remplacant'), []);
  assert.deepEqual(await perms('perso'), [], 'rôle personnalisé inchangé');
});
