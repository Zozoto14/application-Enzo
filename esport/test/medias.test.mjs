/**
 * Vidéos déposées sur le site et transcription des réunions (migration 0014) : envoi par morceaux
 * (reprise, SHA-256 de chaque morceau et du fichier, plafond, octets magiques), lecture par plages
 * (206) avec lien signé (expiré : 410), droits et isolation entre teams, ménage des envois inachevés,
 * espace utilisé, enregistrement de réunion, transcription enregistrée et PDF attaché, visibilité
 * staff, RGPD, API externe (simulée). Tourne sur SQLite et sur PostgreSQL (ESPORT_TEST_PG).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { envoyer, mkvFactice, morceau, mp4Factice, sha, wavFactice } from './medias-aide.mjs';
import { stockageDisque } from '../adaptateurs/stockage.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { analyserDebut, completerAvecFin, peuCompatibleIphone, reconnaitre } from '../noyau/medias/formats.mjs';
import { lirePlage } from '../noyau/medias/lecture.mjs';
import { couperLignes, misePage, pdfTranscription } from '../noyau/medias/pdf.mjs';
import { configMedias, lireTaille, nettoyerEnvois } from '../noyau/medias/service.mjs';
import { ajouter, exporterEtat, importerEtat, nouvelEtat, sha256Hex, terminer } from '../noyau/medias/sha256.mjs';
import { preResume, timecode, transcrireParApi, validerSegments } from '../noyau/medias/transcription.mjs';

const KIO = 1024;
const MEDIAS = { plafond: 600 * KIO, tailleMorceau: 64 * KIO };
const TYPE_STAFF = '00000000-0000-4000-8000-000000000004';
const TYPE_HEBDO = '00000000-0000-4000-8000-000000000001';

async function preparer(options = {}) {
  const b = await banc({ medias: MEDIAS, ...options });
  const A = await teamAvecMembres(b, {
    nom: 'Faucons',
    membres: {
      own12345: { pseudo: 'Owner', role: 'proprietaire' },
      coa12345: { pseudo: 'Coach', role: 'coach' },
      man12345: { pseudo: 'Manon', role: 'manager' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      tom12345: { pseudo: 'Tom', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'proprietaire' } } });
  return { b, A, B };
}

const brut = async (b, url, entetes = {}, methode = 'GET') => b.traiter(new Request(url, { method: methode, headers: entetes }));

// ------------------------------------------------------------------ Fonctions pures

test('SHA-256 incrémental : identique à node:crypto, état sérialisable entre deux morceaux', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
    const o = Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 0xff);
    assert.equal(sha256Hex(o), createHash('sha256').update(o).digest('hex'), `taille ${n}`);
  }
  const gros = Uint8Array.from({ length: 300_001 }, (_, i) => (i * 13) & 0xff);
  let e = nouvelEtat();
  for (let i = 0; i < gros.length; i += 7919) e = importerEtat(exporterEtat(ajouter(e, gros.subarray(i, i + 7919))));
  assert.equal(terminer(e), sha(gros));
  assert.throws(() => importerEtat('{"h":"x"}'));
});

test('formats : octets magiques (MP4, MOV, WebM, MKV, audio), codec et durée lus dans le moov, iPhone', () => {
  assert.equal(reconnaitre(mp4Factice()), 'mp4');
  assert.equal(reconnaitre(mp4Factice({ marque: 'qt  ' })), 'mov');
  assert.equal(reconnaitre(mp4Factice({ marque: 'M4A ' })), 'm4a');
  assert.equal(reconnaitre(mkvFactice()), 'mkv');
  assert.equal(reconnaitre(mkvFactice({ doc: 'webm' })), 'webm');
  assert.equal(reconnaitre(wavFactice(0.1)), 'wav');
  assert.equal(reconnaitre(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0])), 'mp3');
  assert.equal(reconnaitre(new TextEncoder().encode('%PDF-1.4 pas une vidéo')), null);
  assert.equal(reconnaitre(new Uint8Array(4)), null);
  const a = analyserDebut(mp4Factice({ codec: 'avc1', duree: 83.5 }));
  assert.equal(a.codecVideo, 'h264');
  assert.equal(a.duree, 83.5);
  assert.equal(peuCompatibleIphone(a), false);
  const h = analyserDebut(mp4Factice({ codec: 'hvc1' }));
  assert.equal(h.codecVideo, 'hevc');
  assert.equal(peuCompatibleIphone(h), true);
  assert.equal(peuCompatibleIphone(analyserDebut(mkvFactice())), true);
  // MP4 sans « faststart » : rien au début, le moov est lu dans la fin du fichier.
  const lent = mp4Factice({ codec: 'avc1', duree: 30, moovAuDebut: false, taille: 50_000 });
  const debut = analyserDebut(lent.subarray(0, 4096));
  assert.equal(debut.moovAuDebut, false);
  assert.equal(debut.codecVideo, undefined);
  const complet = completerAvecFin(debut, lent.subarray(lent.length - 2000));
  assert.equal(complet.codecVideo, 'h264');
  assert.equal(complet.duree, 30);
});

test('plages Range : formes acceptées, plafond par réponse, plages impossibles', () => {
  assert.equal(lirePlage(null, 100), null);
  assert.deepEqual(lirePlage('bytes=0-9', 100), { debut: 0, fin: 9 });
  assert.deepEqual(lirePlage('bytes=90-', 100), { debut: 90, fin: 99 });
  assert.deepEqual(lirePlage('bytes=-10', 100), { debut: 90, fin: 99 });
  assert.deepEqual(lirePlage('bytes=50-500', 100), { debut: 50, fin: 99 });
  assert.equal(lirePlage('bytes=100-', 100), 'invalide');
  assert.equal(lirePlage('bytes=5-2', 100), 'invalide');
  assert.equal(lirePlage('octets=0-1', 100), 'invalide');
  assert.deepEqual(lirePlage('bytes=0-', 200 * 1024 * 1024), { debut: 0, fin: 64 * 1024 * 1024 - 1 });
});

test('réglages : tailles lisibles (10G, 8M), morceaux bornés, 5 Mio au moins pour R2', () => {
  assert.equal(lireTaille('10G', 1), 10 * 1024 ** 3);
  assert.equal(lireTaille('500 Mo', 1), 500 * 1024 ** 2);
  assert.equal(lireTaille('abc', 7), 7);
  assert.deepEqual(configMedias({}), { plafond: 10 * 1024 ** 3, tailleMorceau: 8 * 1024 ** 2 });
  assert.equal(configMedias({ ESPORT_TAILLE_MORCEAU: '100M' }).tailleMorceau, 64 * 1024 ** 2);
  assert.equal(configMedias({ ESPORT_TAILLE_MORCEAU: '2M' }, { minimum: 5 * 1024 ** 2 }).tailleMorceau, 5 * 1024 ** 2);
});

test('transcription : segments validés et triés, timecodes, pré-résumé simple, PDF valide et paginé', () => {
  const s = validerSegments([{ debut: 5, fin: 9, texte: '  Bonjour   à tous ' }, [1, 2, 'Premier'], { debut: 3, fin: 1, texte: 'fin avant début' }, { debut: 4, texte: '   ' }]);
  assert.deepEqual(s, [[1, 2, 'Premier'], [3, 3, 'fin avant début'], [5, 9, 'Bonjour à tous']]);
  assert.throws(() => validerSegments('x'), /illisible/);
  assert.throws(() => validerSegments([{ debut: -1, texte: 'a' }]), /Segment invalide/);
  assert.equal(timecode(3725.9), '01:02:05');
  const longs = [];
  for (let i = 0; i < 300; i++) longs.push([i * 10, i * 10 + 9, `Phrase numéro ${i} : la rotation sur Ascent doit être plus rapide quand l’équipe adverse joue « lent ». Œuvre, €, naïveté.`]);
  const resume = preResume(longs);
  assert.ok(resume.length > 0 && resume.length <= 5);
  const { pages } = misePage({ titre: 'Réunion hebdo', team: 'Faucons', type: 'Hebdo', date: '2026-10-20', duree: 3000, langue: 'fr', moteur: 'Whisper base', genereLe: '2026-10-21T10:00:00.000Z' }, longs, resume);
  assert.ok(pages.length >= 5, `pages : ${pages.length}`);
  for (const p of pages) for (const e of p) if (!e.trait) assert.ok(e.y >= 60 - 0.01 && e.y <= 842, `ligne hors de la page : ${e.y}`);
  assert.deepEqual(couperLignes('a '.repeat(10), 1000, 10), ['a a a a a a a a a a']);
  assert.ok(couperLignes('x'.repeat(400), 100, 10).length > 3);
  const pdf = pdfTranscription({ titre: 'Réunion « hebdo »', team: 'Faucons', type: 'Hebdo', date: '2026-10-20', duree: 3000, langue: 'fr', moteur: 'Whisper', genereLe: '2026-10-21T10:00:00.000Z' }, longs, resume);
  const texte = Buffer.from(pdf).toString('latin1');
  assert.ok(texte.startsWith('%PDF-1.4'));
  assert.ok(texte.trimEnd().endsWith('%%EOF'));
  // Table xref : chaque position pointe bien sur « N 0 obj ».
  const xref = Number(/startxref\n(\d+)/.exec(texte)[1]);
  const lignes = texte.slice(xref).split('\n');
  const n = Number(lignes[1].split(' ')[1]);
  for (let i = 1; i < n; i++) {
    const pos = Number(lignes[2 + i].slice(0, 10));
    assert.ok(texte.startsWith(`${i} 0 obj`, pos), `objet ${i}`);
  }
  assert.match(texte, /\/Count \d+/);
  assert.match(texte, /\(00:00:10\) Tj/);
  // Accents en WinAnsi (é = \351), guillemets français (« = \253), œ (\234), € (\200).
  assert.match(texte, /num\\351ro/);
  assert.match(texte, /\\253/);
  assert.match(texte, /\\214uvre/);
  assert.match(texte, /\\200/);
});

// ------------------------------------------------------------------ Envoi par morceaux

test('envoi : morceaux dans l’ordre, reprise après coupure (état, renvoi idempotent), SHA-256 du fichier', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ codec: 'avc1', duree: 42, taille: 200 * KIO });
  // Coupure après 2 morceaux.
  const partiel = await envoyer(b, coach, A.teamId, video, { arreterA: 2 });
  assert.equal(partiel.debut.statut, 200, JSON.stringify(partiel.debut.corps));
  assert.equal(partiel.debut.corps.morceaux, 4);
  assert.equal(partiel.debut.corps.tailleMorceau, 64 * KIO);
  const chemin = `/teams/${A.teamId}/review/envois/${partiel.id}`;
  const etat = await b.appel(chemin, { jeton: coach });
  assert.equal(etat.corps.recus, 2);
  assert.equal(etat.corps.octetsRecus, 128 * KIO);
  assert.equal(etat.corps.media.codecVideo, 'h264');
  // Le morceau 1 renvoyé (réponse perdue) : accepté sans rien réécrire ; avec un autre contenu : 409.
  const m1 = video.subarray(64 * KIO, 128 * KIO);
  assert.equal((await morceau(b, coach, chemin, 1, m1)).statut, 200);
  const autre = Uint8Array.from(m1).fill(1, 0, 10);
  assert.equal((await morceau(b, coach, chemin, 1, autre)).corps.code, 'morceau-different');
  // Hors ordre : 409 et le numéro attendu.
  const hors = await morceau(b, coach, chemin, 3, video.subarray(192 * KIO));
  assert.equal(hors.statut, 409);
  assert.equal(hors.corps.details.attendu, 2);
  // SHA-256 faux, taille fausse, empreinte absente.
  const m2 = video.subarray(128 * KIO, 192 * KIO);
  const faux = await morceau(b, coach, chemin, 2, m2, { empreinte: 'a'.repeat(64) });
  assert.equal(faux.statut, 422);
  assert.equal(faux.corps.code, 'empreinte-morceau');
  assert.equal((await morceau(b, coach, chemin, 2, m2.subarray(0, 1000))).corps.code, 'taille-morceau');
  assert.equal((await morceau(b, coach, chemin, 2, m2, { empreinte: 'zz' })).corps.code, 'empreinte');
  // Fin trop tôt : il manque des morceaux.
  assert.equal((await b.appel(`${chemin}/fin`, { methode: 'POST', jeton: coach, corps: { sha256: sha(video) } })).corps.code, 'envoi-incomplet');
  // Reprise : morceaux 2 et 3, puis fin.
  assert.equal((await morceau(b, coach, chemin, 2, m2)).corps.recus, 3);
  assert.equal((await morceau(b, coach, chemin, 3, video.subarray(192 * KIO))).corps.recus, 4);
  const fin = await b.appel(`${chemin}/fin`, { methode: 'POST', jeton: coach, corps: { sha256: sha(video) } });
  assert.equal(fin.statut, 200, JSON.stringify(fin.corps));
  assert.equal(fin.corps.statut, 'termine');
  assert.equal(fin.corps.media.duree, 42);
  assert.equal(fin.corps.media.peuCompatibleIphone, false);
  // Le stockage a le fichier entier, identique.
  const ligne = await b.base.premier('SELECT * FROM envois WHERE id = ?', [partiel.id]);
  assert.deepEqual((await b.stockage.lire(ligne.cle_stockage)).octets, video);
  assert.match(ligne.cle_stockage, /^teams\/[0-9a-f-]+\/videos\/[0-9a-f-]+\.media$/);
});

test('envoi : SHA-256 final différent → refusé et effacé ; plafond (413) ; octets magiques (415)', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ taille: 100 * KIO });
  const mauvais = await envoyer(b, coach, A.teamId, video, { sha256: 'b'.repeat(64) });
  assert.equal(mauvais.fin.statut, 422);
  assert.equal(mauvais.fin.corps.code, 'empreinte-fichier');
  assert.equal((await b.appel(`/teams/${A.teamId}/review/envois/${mauvais.id}`, { jeton: coach })).statut, 404);
  assert.equal(b.stockage.envoisOuverts(), 0);
  // Plafond configurable (ici 600 Kio) : refusé dès le début, avec le plafond.
  const gros = await b.appel(`/teams/${A.teamId}/review/envois`, { methode: 'POST', jeton: coach, corps: { nom: 'gros.mp4', taille: 601 * KIO } });
  assert.equal(gros.statut, 413);
  assert.equal(gros.corps.details.plafond, 600 * KIO);
  assert.equal((await b.appel(`/teams/${A.teamId}/review/envois`, { methode: 'POST', jeton: coach, corps: { nom: 'x', taille: -1 } })).statut, 400);
  // Un PDF déguisé en .mp4 : refusé au premier morceau, envoi effacé.
  const pdf = new Uint8Array(70 * KIO);
  pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
  const faux = await envoyer(b, coach, A.teamId, pdf, { nom: 'film.mp4' });
  assert.equal(faux.morceaux[0].statut, 415);
  assert.equal(faux.morceaux[0].corps.code, 'format-video');
  assert.equal(await b.base.premier('SELECT id FROM envois WHERE id = ?', [faux.id]), null);
  // Un WAV : refusé pour une review, accepté pour une réunion ; un MKV : accepté (avertissement iPhone).
  assert.equal((await envoyer(b, coach, A.teamId, wavFactice(1))).morceaux[0].statut, 415);
  const audio = await envoyer(b, A.sessions.lea12345, A.teamId, wavFactice(1), { section: 'resumes', nom: 'reunion.wav' });
  assert.equal(audio.fin.statut, 200, JSON.stringify(audio.fin.corps));
  assert.equal(audio.fin.corps.media.format, 'wav');
  const mkv = await envoyer(b, coach, A.teamId, mkvFactice({ taille: 70 * KIO }), { nom: 'match.mkv' });
  assert.equal(mkv.fin.corps.media.peuCompatibleIphone, true);
});

test('droits : permission, module, envoi d’un autre membre ou d’une autre team introuvable, rattachement unique', async () => {
  const { b, A, B } = await preparer();
  const coach = A.sessions.coa12345;
  // Le Joueur n'a pas video_review.create : 403 ; il peut déposer une réunion (submit).
  const joueur = await b.appel(`/teams/${A.teamId}/review/envois`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { nom: 'a.mp4', taille: 10 } });
  assert.equal(joueur.statut, 403);
  const envoi = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 70 * KIO }));
  // Autre membre de la team, membre d'une autre team : introuvable.
  assert.equal((await b.appel(`/teams/${A.teamId}/review/envois/${envoi.id}`, { jeton: A.sessions.own12345 })).corps.code, 'envoi-introuvable');
  assert.equal((await b.appel(`/teams/${A.teamId}/review/envois/${envoi.id}`, { jeton: B.sessions.bob12345 })).corps.code, 'team-introuvable');
  assert.equal((await b.appel(`/teams/${B.teamId}/review/envois/${envoi.id}`, { jeton: B.sessions.bob12345 })).corps.code, 'envoi-introuvable');
  // La review de Bob ne peut pas utiliser l'envoi du Coach (autre team).
  assert.equal((await b.appel(`/teams/${B.teamId}/review`, { methode: 'POST', jeton: B.sessions.bob12345, corps: { titre: 'Vol', envoi: envoi.id } })).statut, 404);
  // Un envoi de review ne sert pas pour une réunion.
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: coach, corps: { titre: 'Réu', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: envoi.id } })).statut, 404);
  const r1 = await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Scrim maison', envoi: envoi.id } });
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  assert.equal(r1.corps.source, 'fichier');
  assert.equal(r1.corps.video.nom, 'match.mp4');
  const r2 = await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Encore', envoi: envoi.id } });
  assert.equal(r2.corps.code, 'envoi-rattache');
  // Lien de la vidéo : Joueur de la team oui (view) ; autre team : 404.
  assert.equal((await b.appel(`/teams/${A.teamId}/review/${r1.corps.id}/video/lien`, { methode: 'POST', jeton: A.sessions.lea12345 })).statut, 200);
  assert.equal((await b.appel(`/teams/${A.teamId}/review/${r1.corps.id}/video/lien`, { methode: 'POST', jeton: B.sessions.bob12345 })).statut, 404);
  // Module désactivé : 404 avant tout.
  await b.appel(`/teams/${A.teamId}/modules`, { methode: 'PUT', jeton: A.sessions.fondateur, corps: { modules: { video_review: false } } });
  assert.equal((await b.appel(`/teams/${A.teamId}/review/envois`, { methode: 'POST', jeton: coach, corps: { nom: 'a.mp4', taille: 10 } })).corps.code, 'module-desactive');
  assert.equal((await b.appel(`/teams/${A.teamId}/review/${r1.corps.id}/video/lien`, { methode: 'POST', jeton: coach })).corps.code, 'module-desactive');
  // Sans stockage : 503.
  const sans = await preparer({ sansStockage: true });
  assert.equal((await sans.b.appel(`/teams/${sans.A.teamId}/review/envois`, { methode: 'POST', jeton: sans.A.sessions.coa12345, corps: { nom: 'a.mp4', taille: 10 } })).statut, 503);
});

// ------------------------------------------------------------------ Lecture

test('lecture : lien signé, Range 206 (début, milieu, fin), 416, HEAD, lien expiré (410), falsifié (403), membre retiré', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ taille: 150 * KIO });
  const envoi = await envoyer(b, coach, A.teamId, video);
  const review = (await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Scrim', envoi: envoi.id } })).corps;
  const detail = await b.appel(`/teams/${A.teamId}/review/${review.id}`, { jeton: A.sessions.lea12345 });
  assert.equal(detail.corps.review.source, 'fichier');
  assert.equal(detail.corps.review.video.taille, video.length);
  assert.equal(detail.corps.review.video.media.codecVideo, 'h264');
  const lien = (await b.appel(`/teams/${A.teamId}/review/${review.id}/video/lien`, { methode: 'POST', jeton: A.sessions.lea12345 })).corps;
  assert.ok(Date.parse(lien.expire) - b.horloge.t >= 2 * 3600 * 1000 - 1000, 'lien valable 2 h');
  const debut = await brut(b, lien.url, { Range: 'bytes=0-99' });
  assert.equal(debut.status, 206);
  assert.equal(debut.headers.get('content-range'), `bytes 0-99/${video.length}`);
  assert.equal(debut.headers.get('accept-ranges'), 'bytes');
  assert.equal(debut.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await debut.arrayBuffer()), video.subarray(0, 100));
  const milieu = await brut(b, lien.url, { Range: 'bytes=70000-70009' });
  assert.deepEqual(new Uint8Array(await milieu.arrayBuffer()), video.subarray(70000, 70010));
  const fin = await brut(b, lien.url, { Range: 'bytes=-16' });
  assert.deepEqual(new Uint8Array(await fin.arrayBuffer()), video.subarray(video.length - 16));
  const ouvert = await brut(b, lien.url, { Range: 'bytes=100000-' });
  assert.equal(ouvert.headers.get('content-length'), String(video.length - 100000));
  const hors = await brut(b, lien.url, { Range: `bytes=${video.length}-` });
  assert.equal(hors.status, 416);
  assert.equal(hors.headers.get('content-range'), `bytes */${video.length}`);
  const entier = await brut(b, lien.url);
  assert.equal(entier.status, 200);
  assert.equal((await entier.arrayBuffer()).byteLength, video.length);
  const tete = await brut(b, lien.url, { Range: 'bytes=0-9' }, 'HEAD');
  assert.equal(tete.status, 206);
  assert.equal(await tete.text(), '');
  // Export Markdown d'une review sur fichier : pas de lien YouTube.
  const md = await b.appel(`/teams/${A.teamId}/review/${review.id}/export.md?format=json`, { jeton: coach });
  assert.match(md.corps.contenu, /fichier déposé sur le site \(match\.mp4\)/);
  assert.doesNotMatch(md.corps.contenu, /youtube/i);
  // Membre retiré : son lien encore valable ne lit plus rien.
  const lienTom = (await b.appel(`/teams/${A.teamId}/review/${review.id}/video/lien`, { methode: 'POST', jeton: A.sessions.tom12345 })).corps;
  await b.appel(`/teams/${A.teamId}/membres/${A.membres.tom12345.id}`, { methode: 'DELETE', jeton: A.sessions.fondateur });
  assert.equal((await brut(b, lienTom.url, { Range: 'bytes=0-9' })).status, 403);
  // Falsifié : 403 ; expiré (après 2 h) : 410.
  assert.equal((await brut(b, lien.url.replace(/sig=[^&]+/, 'sig=AAAA'))).status, 403);
  assert.equal((await brut(b, lien.url.replace(/c=[^&]+/, 'c=tom12345'))).status, 403);
  b.horloge.t += 2 * 3600 * 1000 + 1000;
  const expire = await brut(b, lien.url, { Range: 'bytes=0-9' });
  assert.equal(expire.status, 410);
});

test('stockage disque : morceaux écrits à leur place, lecture par plage EN FLUX, abandon', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'esport-medias-'));
  try {
    const st = await stockageDisque(dossier);
    const cle = 'teams/t/videos/v.media';
    const jeton = await st.debuterEnvoi(cle);
    const a = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
    await st.ecrireMorceau(cle, { jeton, indice: 0, decalage: 0, octets: a.subarray(0, 600) });
    await st.ecrireMorceau(cle, { jeton, indice: 1, decalage: 600, octets: a.subarray(600) });
    assert.equal(await st.tailleDe(cle), null, 'pas lisible avant la fin');
    await st.terminerEnvoi(cle, { jeton, type: 'video/mp4' });
    assert.equal(await st.tailleDe(cle), 1000);
    const t = await st.lireTranche(cle, 590, 609);
    assert.equal(t.taille, 1000);
    assert.ok(t.flux, 'lecture en flux');
    assert.deepEqual(new Uint8Array(await new Response(t.flux).arrayBuffer()), a.subarray(590, 610));
    const cle2 = 'teams/t/videos/w.media';
    await st.debuterEnvoi(cle2);
    await st.abandonnerEnvoi(cle2);
    assert.equal(await st.tailleDe(cle2), null);
    await st.supprimer(cle);
    assert.equal(await st.lireTranche(cle, 0, 1), null);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ Ménage et espace utilisé

test('cron : les envois inachevés (et jamais rattachés) de plus de 24 h sont effacés, octets compris', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ taille: 200 * KIO });
  const inacheve = await envoyer(b, coach, A.teamId, video, { arreterA: 2 });
  const orphelin = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 70 * KIO }));
  const utilise = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 70 * KIO }));
  await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Gardée', envoi: utilise.id } });
  const cleOrphelin = (await b.base.premier('SELECT cle_stockage FROM envois WHERE id = ?', [orphelin.id])).cle_stockage;
  assert.equal(b.stockage.envoisOuverts(), 1);
  // Moins de 24 h : rien.
  b.horloge.t += 23 * 3600 * 1000;
  assert.equal(await nettoyerEnvois(b.base, b.stockage, { maintenant: b.horloge.t }), 0);
  b.horloge.t += 2 * 3600 * 1000;
  const rapport = await tachesPlanifiees(b.base, { stockage: b.stockage, maintenant: () => b.horloge.t });
  assert.deepEqual(rapport.filter(r => !r.ok), []);
  assert.ok(rapport.some(r => r.tache === 'envois inachevés'));
  assert.equal(await b.base.premier('SELECT id FROM envois WHERE id = ?', [inacheve.id]), null);
  assert.equal(await b.base.premier('SELECT id FROM envois WHERE id = ?', [orphelin.id]), null);
  assert.ok(await b.base.premier('SELECT id FROM envois WHERE id = ?', [utilise.id]), 'l’envoi rattaché reste');
  assert.equal(b.stockage.envoisOuverts(), 0);
  assert.equal(await b.stockage.lire(cleOrphelin), null);
});

test('espace utilisé : total et liste (vidéos, enregistrements, PDF), réservé à team.manage, suppression selon le module', async () => {
  const { b, A, B } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ taille: 150 * KIO });
  const envoi = await envoyer(b, coach, A.teamId, video);
  const review = (await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Scrim', envoi: envoi.id } })).corps;
  const audio = wavFactice(1);
  const enr = await envoyer(b, A.sessions.lea12345, A.teamId, audio, { section: 'resumes', nom: 'hebdo.wav' });
  const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id } })).corps;
  await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: A.sessions.lea12345, corps: { segments: [{ debut: 0, fin: 2, texte: 'Bonjour' }], langue: 'fr', moteur: 'Whisper base (navigateur)' } });
  const inacheve = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 200 * KIO }), { arreterA: 1 });
  const e = await b.appel(`/teams/${A.teamId}/espace`, { jeton: A.sessions.own12345 });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  const v = e.corps.fichiers.find(f => f.nature === 'video');
  assert.equal(v.taille, video.length);
  assert.equal(v.cible.titre, 'Scrim');
  assert.equal(v.deposePar.pseudo, 'Coach');
  assert.equal(v.peutSupprimer, true);
  const enregistrement = e.corps.fichiers.find(f => f.nature === 'enregistrement');
  assert.equal(enregistrement.taille, audio.length);
  const pdf = e.corps.fichiers.find(f => f.nature === 'transcription');
  assert.ok(pdf.taille > 500);
  assert.equal(e.corps.envois.find(x => x.id === inacheve.id).octetsRecus, 64 * KIO);
  assert.equal(e.corps.total, video.length + audio.length + pdf.taille + 64 * KIO);
  // Réservé à team.manage ; autre team : 404.
  assert.equal((await b.appel(`/teams/${A.teamId}/espace`, { jeton: A.sessions.lea12345 })).statut, 403);
  assert.equal((await b.appel(`/teams/${A.teamId}/espace`, { jeton: B.sessions.bob12345 })).statut, 404);
  assert.equal((await b.appel(`/teams/${B.teamId}/espace/${v.id}`, { methode: 'DELETE', jeton: B.sessions.bob12345 })).statut, 404);
  // Le Joueur ne supprime pas la vidéo (video_review.delete).
  assert.equal((await b.appel(`/teams/${A.teamId}/espace/${v.id}`, { methode: 'DELETE', jeton: A.sessions.lea12345 })).statut, 403);
  const apres = await b.appel(`/teams/${A.teamId}/espace/${v.id}`, { methode: 'DELETE', jeton: A.sessions.own12345 });
  assert.equal(apres.statut, 200);
  assert.ok(!apres.corps.fichiers.some(f => f.id === v.id));
  assert.equal(await b.stockage.lire((await b.base.premier('SELECT cle_stockage FROM fichiers WHERE id = ?', [v.id])).cle_stockage), null);
  const d = await b.appel(`/teams/${A.teamId}/review/${review.id}`, { jeton: coach });
  assert.equal(d.corps.review.video.supprime, true);
  assert.equal((await b.appel(`/teams/${A.teamId}/review/${review.id}/video/lien`, { methode: 'POST', jeton: coach })).statut, 404);
  const journal = await b.base.premier("SELECT * FROM journal WHERE action = 'media.deleted'", []);
  assert.ok(journal, 'suppression journalisée');
  // Supprimer une review efface aussi les octets de sa vidéo.
  const envoi2 = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 70 * KIO }));
  const review2 = (await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Temporaire', envoi: envoi2.id } })).corps;
  await b.appel(`/teams/${A.teamId}/review/${review2.id}`, { methode: 'DELETE', jeton: A.sessions.own12345 });
  const f2 = await b.base.premier('SELECT * FROM fichiers WHERE entite_id = ?', [review2.id]);
  assert.ok(f2.supprime_le);
  assert.equal(await b.stockage.lire(f2.cle_stockage), null);
});

// ------------------------------------------------------------------ Réunions et transcription

test('réunion : enregistrement déposé (sans lien), transcription partielle puis complète → PDF attaché, notifications', async () => {
  const { b, A } = await preparer();
  const lea = A.sessions.lea12345;
  const audio = wavFactice(2);
  const enr = await envoyer(b, lea, A.teamId, audio, { section: 'resumes', nom: 'hebdo.wav' });
  // Ni lien ni enregistrement : refusé ; lien invalide avec un enregistrement : refusé.
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: lea, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20' } })).corps.code, 'lien');
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: lea, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id, lien: 'javascript:x' } })).corps.code, 'lien');
  const depot = await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: lea, corps: { titre: 'Réunion hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id } });
  assert.equal(depot.statut, 200, JSON.stringify(depot.corps));
  assert.equal(depot.corps.lien, '');
  assert.equal(depot.corps.enregistrement.nom, 'hebdo.wav');
  assert.equal(depot.corps.enregistrement.media.format, 'wav');
  assert.equal(depot.corps.transcription.statut, 'a_faire');
  assert.equal(depot.corps.transcription.peutTranscrire, true);
  const id = depot.corps.id;
  // L'enregistrement se lit par lien signé (Range).
  const lienEnr = (await b.appel(`/teams/${A.teamId}/resumes/${id}/enregistrement/lien`, { methode: 'POST', jeton: A.sessions.man12345 })).corps;
  const plage = await brut(b, lienEnr.url, { Range: 'bytes=0-43' });
  assert.equal(plage.status, 206);
  assert.equal(new TextDecoder().decode((await plage.arrayBuffer()).slice(0, 4)), 'RIFF');
  // Transcription partielle (reprise) : statut en_cours, pas de PDF, pas de notification.
  const t1 = await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { methode: 'PUT', jeton: lea, corps: { segments: [{ debut: 0, fin: 4, texte: 'Bonjour à tous.' }], langue: 'fr', moteur: 'Whisper base (navigateur)', partielle: true, progression: 30 } });
  assert.equal(t1.statut, 200, JSON.stringify(t1.corps));
  assert.equal(t1.corps.statut, 'en_cours');
  assert.equal(t1.corps.progression, 30);
  assert.equal(t1.corps.pdf, null);
  // Complète : PDF généré et attaché, statut prête, pré-résumé.
  const segments = [
    { debut: 0, fin: 4, texte: 'Bonjour à tous.' },
    { debut: 65, fin: 70, texte: 'Sur Ascent, la rotation vers B doit être plus rapide quand ils jouent lent.' },
    { debut: 3725, fin: 3730, texte: 'On revoit la rotation vers B jeudi, avec la VOD du scrim.' },
  ];
  const t2 = await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { methode: 'PUT', jeton: lea, corps: { segments, langue: 'fr', moteur: 'Whisper base (navigateur)', duree: 3731 } });
  assert.equal(t2.statut, 200, JSON.stringify(t2.corps));
  assert.equal(t2.corps.statut, 'prete');
  assert.equal(t2.corps.segments.length, 3);
  assert.ok(t2.corps.pdf.taille > 500);
  assert.ok(t2.corps.preResume.length >= 1);
  const lien = (await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription/lien`, { methode: 'POST', jeton: lea, corps: { telecharger: true } })).corps;
  const pdf = await brut(b, lien.url);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /^attachment; filename="Transcription - R_union hebdo\.pdf"/);
  const texte = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
  assert.ok(texte.startsWith('%PDF-'));
  assert.match(texte, /\(01:02:05\) Tj/);
  assert.match(texte, /\(Faucons\) Tj/);
  assert.match(texte, /\(Hebdo\) Tj/);
  assert.match(texte, /1 h 02 min/);
  // Le dépôt (résumé rédigé) garde son statut ; la transcription est distincte.
  const vue = await b.appel(`/teams/${A.teamId}/resumes/${id}`, { jeton: A.sessions.man12345 });
  assert.equal(vue.corps.statut, 'a_resumer');
  assert.equal(vue.corps.transcription.statut, 'prete');
  assert.equal(vue.corps.transcription.pdf, true);
  assert.equal(vue.corps.fichiers.length, 0, 'l’historique des PDF de résumé ne mélange pas la transcription');
  // Notifications : les rédacteurs (Manager, Propriétaire), pas la déposante (c'est elle qui a transcrit).
  const notif = async jeton => (await b.appel('/notifications', { jeton })).corps.liste.filter(n => n.type === 'transcription-prete');
  assert.equal((await notif(A.sessions.man12345)).length, 1);
  assert.equal((await notif(A.sessions.own12345)).length, 1);
  assert.equal((await notif(lea)).length, 0);
  // Correction par un rédacteur : nouveau PDF (l'ancien est effacé), la déposante n'est pas renotifiée (mise à jour).
  const ancien = (await b.base.premier('SELECT transcription_pdf_id FROM reunions WHERE id = ?', [id])).transcription_pdf_id;
  const t3 = await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { methode: 'PUT', jeton: A.sessions.man12345, corps: { segments: [...segments.slice(0, 2), { debut: 3725, fin: 3730, texte: 'On revoit la rotation B jeudi.' }], langue: 'fr', moteur: 'Whisper base (navigateur)' } });
  assert.equal(t3.corps.modifiePar.pseudo, 'Manon');
  assert.notEqual(t3.corps.pdf.id, ancien);
  assert.ok((await b.base.premier('SELECT supprime_le FROM fichiers WHERE id = ?', [ancien])).supprime_le);
  assert.ok(await b.base.premier("SELECT id FROM journal WHERE action = 'meeting.transcription_updated'", []));
  assert.equal((await notif(lea)).length, 0);
  // Un autre Joueur lit (réunion « team ») mais ne modifie pas.
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { jeton: A.sessions.tom12345 })).corps.peutModifier, false);
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { methode: 'PUT', jeton: A.sessions.tom12345, corps: { segments: [] } })).statut, 403);
  // Segments illisibles : 400.
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { methode: 'PUT', jeton: lea, corps: { segments: 'abc' } })).statut, 400);
  // Retrait du dépôt : l'enregistrement est effacé.
  await b.appel(`/teams/${A.teamId}/resumes/${id}`, { methode: 'DELETE', jeton: A.sessions.man12345 });
  assert.ok((await b.base.premier('SELECT supprime_le FROM fichiers WHERE id = ?', [depot.corps.enregistrement.id])).supprime_le);
});

test('visibilité staff : transcription et enregistrement d’une réunion staff invisibles pour un Joueur (404)', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const enr = await envoyer(b, coach, A.teamId, wavFactice(1), { section: 'resumes', nom: 'staff.wav' });
  const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: coach, corps: { titre: 'Point staff', typeId: TYPE_STAFF, dateReunion: '2026-10-20', envoi: enr.id } })).corps;
  await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: coach, corps: { segments: [{ debut: 0, fin: 3, texte: 'Sujet confidentiel.' }], langue: 'fr', moteur: 'test' } });
  for (const [methode, chemin] of [
    ['GET', 'transcription'],
    ['POST', 'transcription/lien'],
    ['POST', 'enregistrement/lien'],
    ['PUT', 'transcription'],
  ]) {
    const r = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/${chemin}`, { methode, jeton: A.sessions.lea12345, corps: methode === 'GET' ? undefined : { segments: [] } });
    assert.equal(r.statut, 404, `${methode} ${chemin}`);
  }
  assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.man12345 })).statut, 200);
  // La notification de transcription prête ne part qu'aux rédacteurs (qui voient le staff).
  const lea = (await b.appel('/notifications', { jeton: A.sessions.lea12345 })).corps.liste;
  assert.ok(!lea.some(n => n.type === 'transcription-prete'));
});

test('RGPD : vidéos, enregistrements et transcriptions dans l’export (liens signés) ; suppression du compte anonymise', async () => {
  const { b, A } = await preparer();
  const coach = A.sessions.coa12345;
  const video = mp4Factice({ taille: 70 * KIO });
  const envoi = await envoyer(b, coach, A.teamId, video);
  await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: coach, corps: { titre: 'Scrim', envoi: envoi.id } });
  const enr = await envoyer(b, coach, A.teamId, wavFactice(1), { section: 'resumes', nom: 'hebdo.wav' });
  const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: coach, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id } })).corps;
  await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: coach, corps: { segments: [{ debut: 0, fin: 3, texte: 'Bonjour à tous.' }], langue: 'fr', moteur: 'test' } });
  const encours = await envoyer(b, coach, A.teamId, mp4Factice({ taille: 200 * KIO }), { arreterA: 1 });
  const exp = await b.appel('/moi/export', { jeton: coach });
  assert.equal(exp.statut, 200);
  assert.equal(exp.corps.mediasDeposes.length, 2);
  const v = exp.corps.mediasDeposes.find(m => m.nature === 'video');
  assert.equal(v.nom, 'match.mp4');
  const lu = await brut(b, v.lien.url);
  assert.equal(lu.status, 200);
  assert.equal((await lu.arrayBuffer()).byteLength, video.length);
  assert.equal(exp.corps.transcriptions.length, 1);
  assert.equal(exp.corps.transcriptions[0].texte, 'Bonjour à tous.');
  assert.match(exp.corps.transcriptions[0].pdf.url, /\/fichiers\//);
  // Le Fondateur exporte les données du Coach : mêmes rubriques.
  const parFondateur = await b.appel('/admin/comptes/coa12345/export', { jeton: A.sessions.fondateur });
  assert.equal(parFondateur.corps.mediasDeposes.length, 2);
  // Suppression : la team garde les fichiers, sans auteur ; transcription anonymisée ; envoi inachevé confié au cron.
  assert.equal((await b.appel('/moi', { methode: 'DELETE', jeton: coach })).statut, 200);
  assert.equal((await b.base.tous("SELECT id FROM fichiers WHERE depose_par = 'coa12345'", [])).length, 0);
  const x = await b.base.premier('SELECT auteur_id, modifie_par FROM transcriptions WHERE reunion_id = ?', [depot.id]);
  assert.equal(x.auteur_id, null);
  assert.equal(x.modifie_par, null);
  await nettoyerEnvois(b.base, b.stockage, { maintenant: b.horloge.t });
  assert.equal(await b.base.premier('SELECT id FROM envois WHERE id = ?', [encours.id]), null);
});

test('API de transcription externe : désactivée par défaut (503) ; activée, faite par le cron (fetch simulé)', async () => {
  const off = await preparer();
  const enrOff = await envoyer(off.b, off.A.sessions.lea12345, off.A.teamId, wavFactice(1), { section: 'resumes', nom: 'a.wav' });
  const depOff = (await off.b.appel(`/teams/${off.A.teamId}/resumes`, { methode: 'POST', jeton: off.A.sessions.lea12345, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enrOff.id } })).corps;
  const r = await off.b.appel(`/teams/${off.A.teamId}/resumes/${depOff.id}/transcription/externe`, { methode: 'POST', jeton: off.A.sessions.lea12345, corps: {} });
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, 'transcription-externe-desactivee');

  const appels = [];
  const fetchTranscription = async (url, init) => {
    appels.push({ url, auth: init.headers.Authorization, modele: init.body.get('model'), langue: init.body.get('language'), fichier: init.body.get('file') });
    return new Response(JSON.stringify({ duration: 8, segments: [{ start: 0, end: 3.2, text: ' Bonjour.' }, { start: 3.2, end: 8, text: ' On commence la revue.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const transcriptionExterne = { actif: true, url: 'https://api.exemple.test/v1/audio/transcriptions', cle: 'sk-test', modele: 'whisper-1', tailleMax: 1024 * 1024 };
  const { b, A } = await preparer({ transcriptionExterne, fetchTranscription });
  const audio = wavFactice(1);
  const enr = await envoyer(b, A.sessions.lea12345, A.teamId, audio, { section: 'resumes', nom: 'hebdo.wav' });
  const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id } })).corps;
  const demande = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/externe`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { langue: 'fr' } });
  assert.equal(demande.statut, 200, JSON.stringify(demande.corps));
  assert.equal(demande.corps.statut, 'externe');
  const rapport = await tachesPlanifiees(b.base, { stockage: b.stockage, cleSession: 'x'.repeat(40), transcriptionExterne, fetchTranscription, maintenant: () => b.horloge.t });
  assert.deepEqual(rapport.filter(x => !x.ok), []);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].auth, 'Bearer sk-test');
  assert.equal(appels[0].langue, 'fr');
  assert.equal(appels[0].fichier.size, audio.length);
  const t = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 });
  assert.equal(t.corps.statut, 'prete');
  assert.deepEqual(t.corps.segments.map(s => s.texte), ['Bonjour.', 'On commence la revue.']);
  assert.match(t.corps.moteur, /whisper-1/);
  // Échec de l'API : statut « echec », message simple (jamais la clé).
  await assert.rejects(transcrireParApi({ octets: audio, config: transcriptionExterne, fetch: async () => new Response('', { status: 401 }) }), /HTTP 401/);
});
