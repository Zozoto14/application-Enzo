/**
 * Logique PURE de la transcription (testée par Jest, sans navigateur ni modèle) :
 *  - audio : mélange en mono, rééchantillonnage à 16 kHz (secours si l'OfflineAudioContext n'est pas
 *    disponible), découpe en segments de 30 s (taille d'entrée de Whisper) ;
 *  - accumulation en flux (gros fichiers lus en lecture accélérée) : blocs → segments de 30 s ;
 *  - résultats de Whisper → segments horodatés de la réunion (décalage du segment, nettoyage).
 */

export const FREQUENCE = 16000;
export const DUREE_SEGMENT = 30;

/** Mélange des canaux en mono (moyenne). */
export function versMono(canaux: readonly Float32Array[]): Float32Array {
  if (canaux.length === 0) return new Float32Array(0);
  if (canaux.length === 1) return canaux[0];
  const n = Math.min(...canaux.map(c => c.length));
  const sortie = new Float32Array(n);
  for (const c of canaux) for (let i = 0; i < n; i++) sortie[i] += c[i];
  for (let i = 0; i < n; i++) sortie[i] /= canaux.length;
  return sortie;
}

/**
 * Rééchantillonnage simple (moyenne par fenêtre en descente, interpolation linéaire en montée). Sert
 * de secours : le navigateur rééchantillonne lui-même (OfflineAudioContext à 16 kHz), en mieux.
 */
export function reechantillonner(pcm: Float32Array, de: number, vers: number = FREQUENCE): Float32Array {
  if (de === vers || pcm.length === 0) return pcm;
  const n = Math.max(1, Math.round((pcm.length * vers) / de));
  const sortie = new Float32Array(n);
  const rapport = de / vers;
  for (let i = 0; i < n; i++) {
    const debut = i * rapport;
    if (rapport > 1) {
      const a = Math.floor(debut);
      const b = Math.min(pcm.length, Math.max(a + 1, Math.floor(debut + rapport)));
      let s = 0;
      for (let j = a; j < b; j++) s += pcm[j];
      sortie[i] = s / (b - a);
    } else {
      const a = Math.floor(debut);
      const t = debut - a;
      sortie[i] = pcm[a] * (1 - t) + (pcm[Math.min(pcm.length - 1, a + 1)] ?? 0) * t;
    }
  }
  return sortie;
}

export interface SegmentAudio {
  indice: number;
  /** Début et fin dans la réunion (secondes). */
  debut: number;
  fin: number;
  pcm: Float32Array;
}

/** Nombre de segments de `duree` secondes pour une réunion de `total` secondes. */
export const nombreSegments = (total: number, duree: number = DUREE_SEGMENT): number => Math.max(0, Math.ceil(total / duree - 1e-9));

/** Découpe un signal mono 16 kHz en segments de 30 s, à partir de `depuis` secondes (reprise). */
export function decouper(pcm: Float32Array, { frequence = FREQUENCE, duree = DUREE_SEGMENT, depuis = 0 }: { frequence?: number; duree?: number; depuis?: number } = {}): SegmentAudio[] {
  const taille = Math.round(frequence * duree);
  const sortie: SegmentAudio[] = [];
  const premier = Math.floor(Math.max(0, depuis) / duree);
  for (let i = premier; i * taille < pcm.length; i++) {
    const a = i * taille;
    const b = Math.min(pcm.length, a + taille);
    sortie.push({ indice: i, debut: a / frequence, fin: b / frequence, pcm: pcm.subarray(a, b) });
  }
  return sortie;
}

/**
 * Accumulateur pour la lecture en flux : on lui donne des blocs (n'importe quelle taille), il rend
 * les segments de 30 s complets ; `vider()` rend le dernier, plus court.
 */
export class Accumulateur {
  private blocs: Float32Array[] = [];
  private enAttente = 0;
  private indice: number;
  constructor(
    private readonly frequence: number = FREQUENCE,
    private readonly duree: number = DUREE_SEGMENT,
    depuis = 0,
  ) {
    this.indice = Math.floor(depuis / duree);
  }
  private get taille() {
    return Math.round(this.frequence * this.duree);
  }
  ajouter(bloc: Float32Array): SegmentAudio[] {
    this.blocs.push(bloc);
    this.enAttente += bloc.length;
    const sortie: SegmentAudio[] = [];
    while (this.enAttente >= this.taille) sortie.push(this.extraire(this.taille));
    return sortie;
  }
  vider(): SegmentAudio | undefined {
    return this.enAttente > 0 ? this.extraire(this.enAttente) : undefined;
  }
  /** Secondes déjà accumulées dans le segment en cours. */
  get secondesEnAttente(): number {
    return this.enAttente / this.frequence;
  }
  private extraire(n: number): SegmentAudio {
    const pcm = new Float32Array(n);
    let i = 0;
    while (i < n) {
      const b = this.blocs[0];
      const pris = Math.min(b.length, n - i);
      pcm.set(b.subarray(0, pris), i);
      i += pris;
      if (pris === b.length) this.blocs.shift();
      else this.blocs[0] = b.subarray(pris);
    }
    this.enAttente -= n;
    const debut = this.indice * this.duree;
    this.indice++;
    return { indice: this.indice - 1, debut, fin: debut + n / this.frequence, pcm };
  }
}

/** Un morceau rendu par Whisper (transformers.js, `return_timestamps: true`). */
export interface MorceauWhisper {
  timestamp: [number, number | null];
  text: string;
}

export interface SegmentTexte {
  debut: number;
  fin: number;
  texte: string;
}

/** Phrases que Whisper « invente » sur du silence (à ignorer quand elles sont seules). */
const HALLUCINATIONS = [/^sous-titr(age|es) (r[ée]alis[ée]s? )?par/i, /^merci d'avoir regard[ée]/i, /^thanks? for watching/i, /^\[?(musique|music|silence|applaudissements)\]?\.?$/i, /^\.+$/];

/** Résultats Whisper d'un segment → segments de la réunion (décalés, nettoyés, bornés au segment). */
export function segmentsDepuisWhisper(morceaux: readonly MorceauWhisper[], segment: { debut: number; fin: number }): SegmentTexte[] {
  const sortie: SegmentTexte[] = [];
  for (const m of morceaux) {
    const texte = String(m.text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!texte || HALLUCINATIONS.some(h => h.test(texte))) continue;
    const a = Number.isFinite(m.timestamp?.[0]) ? Number(m.timestamp[0]) : 0;
    const b = m.timestamp?.[1] != null && Number.isFinite(m.timestamp[1]) ? Number(m.timestamp[1]) : segment.fin - segment.debut;
    const debut = Math.min(segment.fin, segment.debut + Math.max(0, a));
    const fin = Math.min(segment.fin, Math.max(debut, segment.debut + b));
    // Même phrase répétée à la suite (boucle de Whisper) : gardée une fois.
    if (sortie.length && sortie[sortie.length - 1].texte === texte) continue;
    sortie.push({ debut: Math.round(debut * 10) / 10, fin: Math.round(fin * 10) / 10, texte });
  }
  return sortie;
}

/** Ajoute des segments à une transcription (tri par début ; les segments déjà là après `depuis` sont remplacés). */
export function fusionner(existants: readonly SegmentTexte[], nouveaux: readonly SegmentTexte[], depuis = 0): SegmentTexte[] {
  return [...existants.filter(s => s.debut < depuis), ...nouveaux].sort((a, b) => a.debut - b.debut || a.fin - b.fin);
}

/** 83.4 → « 00:01:23 ». */
export function timecode(secondes: number): string {
  const s = Math.max(0, Math.floor(Number(secondes) || 0));
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

/** Début de reprise aligné sur un segment (on refait le segment entamé). */
export const repriseAlignee = (progression: number, duree: number = DUREE_SEGMENT): number => Math.floor(Math.max(0, progression) / duree) * duree;
