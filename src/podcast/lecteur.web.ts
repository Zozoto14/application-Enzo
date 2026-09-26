/**
 * Lecteur vocal du bureau.
 *
 * Deux sources de voix :
 * - les **voix naturelles** (neuronales, celles de la lecture à voix haute
 *   d'Edge), synthétisées par le processus principal et jouées en MP3 ;
 * - les **voix de Windows**, via la synthèse du navigateur intégré : plus
 *   robotiques, mais sans connexion. C'est le repli quand une voix
 *   naturelle ne répond pas.
 *
 * On lit phrase par phrase plutôt que d'un bloc : c'est ce qui permet de
 * suivre l'avancement, de sauter un chapitre et de reprendre où l'on en
 * était. Les phrases suivantes sont préparées pendant qu'on écoute, pour
 * qu'il n'y ait pas de blanc entre deux.
 */

import type { Lecteur, PhraseALire, VoixDisponible } from './lecteurTypes';

export type * from './lecteurTypes';

interface PontVoix {
  liste(): Promise<VoixDisponible[]>;
  synthetiser(texte: string, voix: string, vitesse: number): Promise<Uint8Array>;
}

const PREFIXE_NATURELLE = 'naturelle:';
/**
 * Le duo : deux animateurs qui se passent la parole à chaque chapitre, comme
 * dans un vrai podcast. Une seule voix pendant dix minutes lasse l'oreille ;
 * l'alternance relance l'attention.
 */
export const DUO = 'duo';
export const VOIX_DUO: readonly [string, string] = ['fr-FR-VivienneMultilingualNeural', 'fr-FR-RemyMultilingualNeural'];
/** Phrases préparées d'avance. */
const AVANCE = 2;
const CACHE_MAX = 300;

function pontVoix(): PontVoix | undefined {
  return (globalThis as { applibourse?: { voix?: PontVoix } }).applibourse?.voix;
}

export function creerLecteur(): Lecteur {
  const synthese = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const pont = pontVoix();
  // Chaque lecture a son numéro : les rappels d'une lecture arrêtée sont ignorés.
  let generation = 0;
  let naturelles: VoixDisponible[] = [];
  const abonnes = new Set<() => void>();
  let audio: HTMLAudioElement | undefined;
  const cache = new Map<string, Promise<Uint8Array>>();

  pont
    ?.liste()
    .then(liste => {
      const seules = liste.map(voix => ({
        id: `${PREFIXE_NATURELLE}${voix.id}`,
        nom: `${voix.nom} · voix naturelle`,
        langue: voix.langue,
        naturelle: true,
      }));
      const duoPossible = VOIX_DUO.every(id => liste.some(voix => voix.id === id));
      naturelles = duoPossible
        ? [
            {
              id: `${PREFIXE_NATURELLE}${DUO}`,
              nom: 'Duo Vivienne & Rémy · deux animateurs',
              langue: 'fr-FR',
              naturelle: true,
            },
            ...seules,
          ]
        : seules;
      abonnes.forEach(rappel => rappel());
    })
    .catch(() => undefined);

  const systeme = () => synthese?.getVoices() ?? [];

  const mp3 = (texte: string, voix: string, vitesse: number) => {
    const cle = `${voix}|${vitesse}|${texte}`;
    let promesse = cache.get(cle);
    if (!promesse) {
      if (cache.size >= CACHE_MAX) {
        cache.delete(cache.keys().next().value!);
      }
      promesse = pont!.synthetiser(texte, voix, vitesse);
      // Un échec n'est pas gardé : on retentera la prochaine fois.
      promesse.catch(() => cache.delete(cle));
      cache.set(cle, promesse);
    }
    return promesse;
  };

  /** Voix naturelle d'une phrase : les voix multilingues lisent aussi l'anglais. */
  const voixNaturelle = (choisie: string, phrase: PhraseALire) =>
    phrase.langue === 'en' && !/Multilingual/.test(choisie) ? 'en-US-AvaMultilingualNeural' : choisie;

  const lireSysteme = (
    numero: number,
    file: readonly PhraseALire[],
    depuis: number,
    options: { vitesse: number; voixFrancaise?: string },
    rappels: Parameters<Lecteur['lire']>[3],
  ) => {
    if (!synthese) {
      rappels.surFin();
      return;
    }
    synthese.cancel();
    const voixFr =
      systeme().find(voix => voix.voiceURI === options.voixFrancaise) ??
      systeme().find(voix => voix.lang.toLowerCase().startsWith('fr') && /natural|online|neural/i.test(voix.name)) ??
      systeme().find(voix => voix.lang.toLowerCase().startsWith('fr'));
    const voixEn =
      systeme().find(voix => voix.lang.toLowerCase().startsWith('en') && /natural|online|neural/i.test(voix.name)) ??
      systeme().find(voix => voix.lang.toLowerCase().startsWith('en'));

    const dire = (index: number) => {
      if (numero !== generation) {
        return;
      }
      if (index >= file.length) {
        rappels.surFin();
        return;
      }
      const phrase = file[index];
      const enonce = new SpeechSynthesisUtterance(phrase.texte);
      enonce.lang = phrase.langue === 'en' ? 'en-US' : 'fr-FR';
      const voix = phrase.langue === 'en' ? voixEn ?? voixFr : voixFr;
      if (voix) {
        enonce.voice = voix;
      }
      enonce.rate = options.vitesse;
      enonce.onstart = () => {
        if (numero === generation) {
          rappels.surPhrase(index);
        }
      };
      enonce.onend = () => dire(index + 1);
      enonce.onerror = evenement => {
        // « interrupted » et « canceled » viennent d'un arrêt voulu.
        if (evenement.error !== 'interrupted' && evenement.error !== 'canceled') {
          dire(index + 1);
        }
      };
      synthese.speak(enonce);
    };
    dire(depuis);
  };

  const couperAudio = () => {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audio = undefined;
    }
  };

  return {
    disponible: Boolean(synthese) || Boolean(pont),
    voix: (): VoixDisponible[] => [
      ...naturelles,
      ...systeme()
        .filter(voix => voix.lang.toLowerCase().startsWith('fr'))
        .map(voix => ({ id: voix.voiceURI, nom: voix.name, langue: voix.lang })),
    ],
    surChangementVoix: rappel => {
      abonnes.add(rappel);
      synthese?.addEventListener('voiceschanged', rappel);
      return () => {
        abonnes.delete(rappel);
        synthese?.removeEventListener('voiceschanged', rappel);
      };
    },
    lire: (file, depuis, options, rappels) => {
      const numero = ++generation;
      couperAudio();
      synthese?.cancel();

      const choisie =
        options.voixFrancaise ?? naturelles.find(voix => voix.langue.startsWith('fr'))?.id;
      if (!pont || !choisie?.startsWith(PREFIXE_NATURELLE)) {
        lireSysteme(numero, file, depuis, options, rappels);
        return;
      }
      const voix = choisie.slice(PREFIXE_NATURELLE.length);
      const voixDe = (phrase: PhraseALire) =>
        voix === DUO ? VOIX_DUO[phrase.interlocuteur ?? 0] : voixNaturelle(voix, phrase);
      const preparer = (index: number) => mp3(file[index].texte, voixDe(file[index]), options.vitesse);

      const jouer = (index: number) => {
        if (numero !== generation) {
          return;
        }
        if (index >= file.length) {
          rappels.surFin();
          return;
        }
        for (let suivante = index + 1; suivante <= index + AVANCE && suivante < file.length; suivante++) {
          preparer(suivante).catch(() => undefined);
        }
        preparer(index)
          .then(octets => {
            if (numero !== generation) {
              return;
            }
            if (octets.length === 0) {
              jouer(index + 1);
              return;
            }
            const element = new Audio(
              URL.createObjectURL(new Blob([octets as BlobPart], { type: 'audio/mpeg' })),
            );
            audio = element;
            element.onended = () => {
              couperAudio();
              jouer(index + 1);
            };
            element.onerror = () => {
              couperAudio();
              jouer(index + 1);
            };
            rappels.surPhrase(index);
            return element.play();
          })
          .catch((erreur: unknown) => {
            if (numero !== generation) {
              return;
            }
            // Pas de connexion, ou service indisponible : la lecture continue
            // avec une voix de Windows plutôt que de s'arrêter.
            rappels.surErreur?.(
              `Voix naturelle indisponible (${
                erreur instanceof Error ? erreur.message : String(erreur)
              }) : lecture avec une voix de Windows.`,
            );
            lireSysteme(numero, file, index, { vitesse: options.vitesse }, rappels);
          });
      };
      jouer(depuis);
    },
    pause: () => {
      if (audio) {
        audio.pause();
      } else {
        synthese?.pause();
      }
    },
    reprendre: () => {
      if (audio) {
        audio.play().catch(() => undefined);
      } else {
        synthese?.resume();
      }
    },
    arreter: () => {
      generation++;
      couperAudio();
      synthese?.cancel();
    },
  };
}
