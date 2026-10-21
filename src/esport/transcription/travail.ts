/**
 * Travail de transcription d'une réunion, DANS LE NAVIGATEUR : extraction de l'audio (segments de 30 s,
 * 16 kHz mono), Whisper segment par segment, enregistrements partiels réguliers sur le serveur (reprise
 * après une coupure ou une fermeture de l'onglet), puis enregistrement final (le serveur génère le PDF).
 *
 * Pause, reprise et arrêt à tout moment (entre deux segments). Le travail vit HORS des écrans (registre
 * `travaux`) : on peut changer d'écran dans l'onglet, il continue en arrière-plan ; un bandeau le suit.
 *
 * Indépendant de la plateforme et du modèle : la source audio, le transcripteur et l'enregistrement sont
 * injectés (tests Jest avec un faux transcripteur ; site : extraction.web.ts et whisper.web.ts).
 */

import { fusionner, segmentsDepuisWhisper, type MorceauWhisper, type SegmentAudio, type SegmentTexte } from './audio';

export interface SourceAudio {
  /** Durée totale (secondes), 0 si inconnue. */
  duree: number;
  /** Segments de 30 s à partir de `depuis` secondes. */
  segments(depuis: number): AsyncIterable<SegmentAudio>;
  /** Mise en pause de la lecture (source en flux) pendant une pause du travail. */
  suspendre?(): void;
  fermer(): void;
}

export interface Transcripteur {
  /** Nom affiché et enregistré (« Whisper base (navigateur, WebGPU) »). */
  nom: string;
  transcrire(pcm: Float32Array): Promise<MorceauWhisper[]>;
  liberer?(): void;
}

export interface CorpsTranscription {
  segments: SegmentTexte[];
  langue: string;
  moteur: string;
  duree?: number;
  partielle: boolean;
  progression: number;
}

export interface DependancesTravail {
  ouvrirSource(): Promise<SourceAudio>;
  creerTranscripteur(onChargement: (fraction: number) => void): Promise<Transcripteur>;
  sauver(corps: CorpsTranscription): Promise<void>;
  maintenant?(): number;
}

export type PhaseTravail = 'chargement-modele' | 'extraction' | 'transcription' | 'pause' | 'enregistrement' | 'termine' | 'erreur' | 'annule';

export interface EtatTravail {
  reunionId: string;
  teamId: string;
  titre: string;
  phase: PhaseTravail;
  /** 0 à 1. */
  progression: number;
  /** Chargement du modèle (premier usage : téléchargement, puis cache), 0 à 1. */
  chargementModele: number;
  secondes: number;
  duree: number;
  segments: number;
  moteur?: string;
  erreur?: string;
}

export interface OptionsTravail {
  reunionId: string;
  teamId: string;
  titre: string;
  langue: string;
  /** Segments déjà transcrits (reprise) et instant de reprise. */
  existants?: SegmentTexte[];
  depuis?: number;
  /** Enregistrement partiel tous les `n` segments (5 par défaut, soit 2 min 30 de réunion). */
  sauverTous?: number;
}

export class TravailTranscription {
  etat: EtatTravail;
  private abonnes = new Set<(e: EtatTravail) => void>();
  private enPause = false;
  private reveil: (() => void) | undefined;
  private arrete = false;
  private source: SourceAudio | undefined;
  private fin: Promise<EtatTravail> | undefined;

  constructor(
    readonly options: OptionsTravail,
    private readonly dep: DependancesTravail,
  ) {
    this.etat = { reunionId: options.reunionId, teamId: options.teamId, titre: options.titre, phase: 'chargement-modele', progression: 0, chargementModele: 0, secondes: options.depuis ?? 0, duree: 0, segments: options.existants?.length ?? 0 };
  }

  abonner(f: (e: EtatTravail) => void): () => void {
    this.abonnes.add(f);
    f(this.etat);
    return () => {
      this.abonnes.delete(f);
    };
  }

  private maj(p: Partial<EtatTravail>) {
    this.etat = { ...this.etat, ...p };
    for (const f of [...this.abonnes]) f(this.etat);
  }

  pause(): void {
    if (this.enPause || ['termine', 'erreur', 'annule'].includes(this.etat.phase)) return;
    this.enPause = true;
    this.source?.suspendre?.();
    this.maj({ phase: 'pause' });
  }

  reprendre(): void {
    if (!this.enPause) return;
    this.enPause = false;
    this.maj({ phase: 'transcription' });
    this.reveil?.();
  }

  annuler(): void {
    this.arrete = true;
    this.enPause = false;
    this.reveil?.();
  }

  get enCours(): boolean {
    return !['termine', 'erreur', 'annule'].includes(this.etat.phase);
  }

  /** Lance le travail (une seule fois) ; rend l'état final. */
  demarrer(): Promise<EtatTravail> {
    this.fin ??= this.executer();
    return this.fin;
  }

  private async attendreReprise() {
    while (this.enPause && !this.arrete) await new Promise<void>(ok => (this.reveil = ok));
    this.reveil = undefined;
  }

  private async executer(): Promise<EtatTravail> {
    const { langue, sauverTous = 5 } = this.options;
    const depuis = this.options.depuis ?? 0;
    let segments: SegmentTexte[] = (this.options.existants ?? []).filter(s => s.debut < depuis);
    let transcripteur: Transcripteur | undefined;
    try {
      transcripteur = await this.dep.creerTranscripteur(f => this.maj({ chargementModele: Math.max(0, Math.min(1, f)) }));
      this.maj({ moteur: transcripteur.nom, chargementModele: 1, phase: this.enPause ? 'pause' : 'extraction' });
      this.source = await this.dep.ouvrirSource();
      const duree = this.source.duree;
      this.maj({ duree, phase: this.enPause ? 'pause' : 'transcription', progression: duree > 0 ? Math.min(1, depuis / duree) : 0 });
      let depuisSauvegarde = 0;
      let derniere = depuis;
      for await (const seg of this.source.segments(depuis)) {
        await this.attendreReprise();
        if (this.arrete) break;
        const morceaux = await transcripteur.transcrire(seg.pcm);
        if (this.arrete) break;
        segments = fusionner(segments, segmentsDepuisWhisper(morceaux, seg), Infinity);
        derniere = seg.fin;
        const total = duree || seg.fin;
        this.maj({ secondes: seg.fin, progression: total > 0 ? Math.min(1, seg.fin / total) : 0, segments: segments.length, phase: this.enPause ? 'pause' : 'transcription' });
        depuisSauvegarde++;
        if (depuisSauvegarde >= sauverTous) {
          depuisSauvegarde = 0;
          // Enregistrement partiel : si l'onglet se ferme, on reprendra d'ici.
          await this.dep.sauver({ segments, langue, moteur: transcripteur.nom, duree: duree || undefined, partielle: true, progression: seg.fin }).catch(() => undefined);
        }
      }
      if (this.arrete) {
        // Arrêt : ce qui est fait reste sur le serveur (reprise possible plus tard).
        await this.dep.sauver({ segments, langue, moteur: transcripteur.nom, duree: duree || undefined, partielle: true, progression: derniere }).catch(() => undefined);
        this.maj({ phase: 'annule' });
        return this.etat;
      }
      this.maj({ phase: 'enregistrement', progression: 1 });
      await this.dep.sauver({ segments, langue, moteur: transcripteur.nom, duree: duree || derniere || undefined, partielle: false, progression: duree || derniere });
      this.maj({ phase: 'termine', progression: 1 });
    } catch (e) {
      this.maj({ phase: 'erreur', erreur: e instanceof Error ? e.message : String(e) });
    } finally {
      this.source?.fermer();
      transcripteur?.liberer?.();
    }
    return this.etat;
  }
}

// ------------------------------------------------------------------ Registre (arrière-plan dans l'onglet)

const registre = new Map<string, TravailTranscription>();
const abonnesRegistre = new Set<() => void>();
const prevenir = () => {
  for (const f of [...abonnesRegistre]) f();
};

export const travaux = {
  /** Lance (ou rend, s'il tourne déjà) le travail d'une réunion. */
  lancer(options: OptionsTravail, dep: DependancesTravail): TravailTranscription {
    const deja = registre.get(options.reunionId);
    if (deja?.enCours) return deja;
    const t = new TravailTranscription(options, dep);
    registre.set(options.reunionId, t);
    t.abonner(prevenir);
    void t.demarrer();
    prevenir();
    return t;
  },
  de(reunionId: string): TravailTranscription | undefined {
    return registre.get(reunionId);
  },
  tous(): TravailTranscription[] {
    return [...registre.values()];
  },
  /** Retire un travail fini de la liste (bandeau). */
  retirer(reunionId: string): void {
    const t = registre.get(reunionId);
    if (t && !t.enCours) {
      registre.delete(reunionId);
      prevenir();
    }
  },
  abonner(f: () => void): () => void {
    abonnesRegistre.add(f);
    return () => {
      abonnesRegistre.delete(f);
    };
  },
  /** Tests. */
  vider(): void {
    for (const t of registre.values()) t.annuler();
    registre.clear();
    prevenir();
  },
};
