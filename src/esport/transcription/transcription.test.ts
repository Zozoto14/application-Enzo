/**
 * Transcription (sans navigateur ni modèle : le transcripteur est SIMULÉ) : découpe de l'audio en
 * segments de 30 s à 16 kHz, accumulation en flux, résultats de Whisper → segments horodatés, travail
 * complet (pause, reprise, arrêt, reprise après coupure, enregistrements partiels), et formatage du PDF
 * (le générateur du serveur, esport/noyau/medias/pdf.mjs, sur les segments produits).
 */

import { Accumulateur, DUREE_SEGMENT, FREQUENCE, decouper, fusionner, nombreSegments, reechantillonner, repriseAlignee, segmentsDepuisWhisper, timecode, versMono, type SegmentAudio } from './audio';
import { TravailTranscription, travaux, type CorpsTranscription, type SourceAudio, type Transcripteur } from './travail';
// Générateur du PDF du serveur (module pur) : le même code produit le PDF attaché au dépôt.
import { misePage, pdfTranscription } from '../../../esport/noyau/medias/pdf.mjs';

const signal = (secondes: number, frequence = FREQUENCE) => Float32Array.from({ length: Math.round(secondes * frequence) }, (_, i) => Math.sin(i / 10));

describe('audio', () => {
  test('mono, rééchantillonnage à 16 kHz', () => {
    expect(Array.from(versMono([Float32Array.from([1, 0, 1]), Float32Array.from([0, 0, -1])]))).toEqual([0.5, 0, 0]);
    const a48 = signal(2, 48000);
    expect(reechantillonner(a48, 48000).length).toBe(32000);
    expect(reechantillonner(signal(1, 8000), 8000).length).toBe(16000);
    expect(reechantillonner(a48, 16000, 16000)).toBe(a48);
  });

  test('découpe en segments de 30 s (le dernier plus court), reprise à un instant', () => {
    const pcm = signal(75);
    const s = decouper(pcm);
    expect(s.map(x => [x.indice, x.debut, x.fin])).toEqual([
      [0, 0, 30],
      [1, 30, 60],
      [2, 60, 75],
    ]);
    expect(s[0].pcm.length).toBe(30 * FREQUENCE);
    expect(decouper(pcm, { depuis: 45 }).map(x => x.debut)).toEqual([30, 60]);
    expect(nombreSegments(75)).toBe(3);
    expect(nombreSegments(60)).toBe(2);
    expect(repriseAlignee(71.5)).toBe(60);
  });

  test('accumulateur (lecture en flux) : blocs de taille quelconque → segments complets, puis le reste', () => {
    const acc = new Accumulateur(FREQUENCE, DUREE_SEGMENT, 60);
    const sortie: SegmentAudio[] = [];
    for (let i = 0; i < 40; i++) sortie.push(...acc.ajouter(new Float32Array(4096 * 4).fill(i)));
    // 40 × 16384 = 655 360 échantillons = 40,96 s → un segment complet, 10,96 s en attente.
    expect(sortie.map(s => [s.indice, s.debut, s.fin])).toEqual([[2, 60, 90]]);
    expect(acc.secondesEnAttente).toBeCloseTo(10.96, 2);
    const dernier = acc.vider()!;
    expect(dernier.debut).toBe(90);
    expect(dernier.fin).toBeCloseTo(100.96, 2);
    expect(dernier.pcm[dernier.pcm.length - 1]).toBe(39);
  });

  test('résultats Whisper → segments de la réunion (décalage, fin manquante, hallucinations, répétitions)', () => {
    const r = segmentsDepuisWhisper(
      [
        { timestamp: [0, 4.2], text: ' Bonjour à tous. ' },
        { timestamp: [4.2, 9], text: 'Bonjour à tous.' },
        { timestamp: [9, null], text: ' On commence par la VOD.' },
        { timestamp: [29, 30], text: ' Sous-titrage réalisé par la communauté' },
        { timestamp: [12, 13], text: '   ' },
      ],
      { debut: 60, fin: 90 },
    );
    expect(r).toEqual([
      { debut: 60, fin: 64.2, texte: 'Bonjour à tous.' },
      { debut: 69, fin: 90, texte: 'On commence par la VOD.' },
    ]);
    expect(fusionner([{ debut: 0, fin: 1, texte: 'a' }, { debut: 40, fin: 41, texte: 'ancien' }], [{ debut: 30, fin: 31, texte: 'b' }], 30).map(s => s.texte)).toEqual(['a', 'b']);
    expect(timecode(3725.9)).toBe('01:02:05');
  });
});

// ------------------------------------------------------------------ Travail complet (transcripteur simulé)

function fauxSource(duree: number, ouvertures: number[] = []): SourceAudio {
  return {
    duree,
    async *segments(depuis: number) {
      ouvertures.push(depuis);
      for (const s of decouper(signal(duree, 100), { frequence: 100, depuis })) yield s;
    },
    fermer: () => undefined,
  };
}

function fauxTranscripteur(): Transcripteur & { appels: number } {
  const t = {
    nom: 'Faux Whisper (test)',
    appels: 0,
    async transcrire(pcm: Float32Array) {
      t.appels++;
      return [{ timestamp: [0, Math.min(5, pcm.length / 100)] as [number, number], text: ` Phrase ${t.appels}.` }];
    },
  };
  return t;
}

describe('travail de transcription', () => {
  afterEach(() => travaux.vider());

  test('du début à la fin : chargement, segments, enregistrements partiels puis final', async () => {
    const sauvegardes: CorpsTranscription[] = [];
    const tr = fauxTranscripteur();
    const travail = new TravailTranscription(
      { reunionId: 'r1', teamId: 't1', titre: 'Hebdo', langue: 'fr', sauverTous: 2 },
      {
        creerTranscripteur: async charge => {
          charge(0.5);
          charge(1);
          return tr;
        },
        ouvrirSource: async () => fauxSource(150),
        sauver: async c => void sauvegardes.push(c),
      },
    );
    const phases: string[] = [];
    travail.abonner(e => phases.push(e.phase));
    const fin = await travail.demarrer();
    expect(fin.phase).toBe('termine');
    expect(tr.appels).toBe(5);
    expect(fin.segments).toBe(5);
    expect(phases).toContain('chargement-modele');
    expect(phases).toContain('transcription');
    // Partiels après les segments 2 et 4, puis le final complet.
    expect(sauvegardes.map(s => [s.partielle, s.progression, s.segments.length])).toEqual([
      [true, 60, 2],
      [true, 120, 4],
      [false, 150, 5],
    ]);
    expect(sauvegardes[2].segments.map(s => s.debut)).toEqual([0, 30, 60, 90, 120]);
    expect(sauvegardes[2].moteur).toBe('Faux Whisper (test)');
    expect(sauvegardes[2].duree).toBe(150);
  });

  test('pause, reprise, arrêt (ce qui est fait est gardé), reprise après coupure depuis le serveur', async () => {
    const sauvegardes: CorpsTranscription[] = [];
    const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const tr = fauxTranscripteur();
    const lent: Transcripteur = { nom: tr.nom, transcrire: async pcm => (await dormir(15), tr.transcrire(pcm)) };
    const ouvertures: number[] = [];
    const travail = travaux.lancer(
      { reunionId: 'r2', teamId: 't1', titre: 'Débrief', langue: 'fr', sauverTous: 10 },
      { creerTranscripteur: async () => lent, ouvrirSource: async () => fauxSource(300, ouvertures), sauver: async c => void sauvegardes.push(c) },
    );
    // Déjà en cours : le même travail est rendu.
    expect(travaux.lancer({ reunionId: 'r2', teamId: 't1', titre: 'x', langue: 'fr' }, { creerTranscripteur: async () => lent, ouvrirSource: async () => fauxSource(1), sauver: async () => undefined })).toBe(travail);
    await dormir(20);
    travail.pause();
    expect(travail.etat.phase).toBe('pause');
    await dormir(20);
    const appelsEnPause = tr.appels;
    await dormir(60);
    // En pause : aucun nouveau segment.
    expect(tr.appels).toBe(appelsEnPause);
    travail.reprendre();
    await dormir(20);
    expect(tr.appels).toBeGreaterThan(appelsEnPause);
    travail.annuler();
    const fin = await travail.demarrer();
    expect(fin.phase).toBe('annule');
    const partiel = sauvegardes[sauvegardes.length - 1];
    expect(partiel.partielle).toBe(true);
    expect(partiel.segments.length).toBeGreaterThanOrEqual(1);
    expect(travaux.tous()).toHaveLength(1);
    travaux.retirer('r2');
    expect(travaux.tous()).toHaveLength(0);

    // Reprise (onglet fermé) : on repart du segment entamé, avec ce qui était fait.
    const final: CorpsTranscription[] = [];
    const reprise = new TravailTranscription(
      { reunionId: 'r2', teamId: 't1', titre: 'Débrief', langue: 'fr', existants: [{ debut: 0, fin: 5, texte: 'Déjà fait.' }, { debut: 61, fin: 62, texte: 'À refaire.' }], depuis: repriseAlignee(70) },
      { creerTranscripteur: async () => fauxTranscripteur(), ouvrirSource: async () => fauxSource(120, ouvertures), sauver: async c => void final.push(c) },
    );
    await reprise.demarrer();
    expect(ouvertures[ouvertures.length - 1]).toBe(60);
    expect(final[final.length - 1].segments.map(s => s.texte)).toEqual(['Déjà fait.', 'Phrase 1.', 'Phrase 2.']);
  });

  test('erreur (modèle introuvable) : phase erreur, message lisible', async () => {
    const t = new TravailTranscription(
      { reunionId: 'r3', teamId: 't1', titre: 'x', langue: 'fr' },
      {
        creerTranscripteur: async () => {
          throw new Error('Téléchargement de Whisper impossible (HTTP 503).');
        },
        ouvrirSource: async () => fauxSource(10),
        sauver: async () => undefined,
      },
    );
    const fin = await t.demarrer();
    expect(fin.phase).toBe('erreur');
    expect(fin.erreur).toMatch(/HTTP 503/);
  });
});

// ------------------------------------------------------------------ PDF (générateur du serveur)

describe('PDF de transcription', () => {
  const infos = { titre: 'Réunion « hebdo »', team: 'Faucons', type: 'Hebdo', date: '2026-10-20', duree: 3725, langue: 'fr', moteur: 'Faux Whisper (test)', genereLe: '2026-10-21T10:00:00.000Z' };

  test('mise en page : titre, fiche (team, type, date, durée), transcription horodatée, pages', () => {
    const segments: Array<[number, number, string]> = Array.from({ length: 120 }, (_, i) => [i * 31, i * 31 + 5, `Segment ${i} : on parle de la rotation vers B et des utilitaires à garder pour le retake.`]);
    const { pages } = misePage(infos, segments, [{ debut: 31, texte: 'Phrase clé.' }]);
    const textes = pages.flat().map((e: { texte?: string }) => e.texte).filter(Boolean);
    expect(textes[0]).toBe('Réunion « hebdo »');
    expect(textes).toEqual(expect.arrayContaining(['Team :', 'Faucons', 'Type :', 'Hebdo', 'Date :', '20/10/2026', 'Durée :', '1 h 02 min', 'Langue :', 'français']));
    expect(textes).toContain('Pré-résumé automatique (phrases clés, à vérifier)');
    expect(textes).toContain('• [00:00:31] Phrase clé.');
    expect(textes).toContain('Transcription horodatée');
    expect(textes).toContain('01:01:29');
    expect(pages.length).toBeGreaterThan(2);
    const anglais = misePage({ ...infos, langueDoc: 'en' }, segments.slice(0, 2));
    expect(anglais.pages.flat().map((e: { texte?: string }) => e.texte)).toEqual(expect.arrayContaining(['Duration :', '2026-10-20', 'Timestamped transcript']));
  });

  test('octets : PDF 1.4, polices standard, accents en WinAnsi, une page par écran de texte', () => {
    const octets: Uint8Array = pdfTranscription(infos, [[0, 4, 'Bonjour à tous, ça commence !']], []);
    const texte = Array.from(octets, c => String.fromCharCode(c)).join('');
    expect(texte.startsWith('%PDF-1.4')).toBe(true);
    expect(texte).toMatch(/\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
    expect(texte).toMatch(/\(Bonjour \\340 tous, \\347a commence !\) Tj/);
    expect(texte).toMatch(/\(00:00:00\) Tj/);
    expect(texte).toMatch(/\/Count 1 /);
    expect(texte.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
