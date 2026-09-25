/**
 * Lecteur vocal du bureau : la synthèse vocale du navigateur intégré, qui
 * s'appuie sur les voix installées dans Windows.
 *
 * On lit phrase par phrase plutôt que d'un bloc : c'est ce qui permet de
 * suivre l'avancement, de sauter un chapitre et de reprendre où l'on en
 * était — et Chromium coupe d'office les énoncés trop longs.
 */

import type { Lecteur, VoixDisponible } from './lecteurTypes';

export type * from './lecteurTypes';

export function creerLecteur(): Lecteur {
  const synthese = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  // Chaque lecture a son numéro : les rappels d'une lecture arrêtée sont ignorés.
  let generation = 0;

  const toutes = () => synthese?.getVoices() ?? [];

  return {
    disponible: Boolean(synthese),
    voix: (): VoixDisponible[] =>
      toutes()
        .filter(voix => voix.lang.toLowerCase().startsWith('fr'))
        .map(voix => ({ id: voix.voiceURI, nom: voix.name, langue: voix.lang })),
    surChangementVoix: rappel => {
      synthese?.addEventListener('voiceschanged', rappel);
      return () => synthese?.removeEventListener('voiceschanged', rappel);
    },
    lire: (file, depuis, options, rappels) => {
      if (!synthese) {
        rappels.surFin();
        return;
      }
      synthese.cancel();
      const numero = ++generation;
      const voixFr =
        toutes().find(voix => voix.voiceURI === options.voixFrancaise) ??
        toutes().find(voix => voix.lang.toLowerCase().startsWith('fr') && /natural|online|neural/i.test(voix.name)) ??
        toutes().find(voix => voix.lang.toLowerCase().startsWith('fr'));
      const voixEn =
        toutes().find(voix => voix.lang.toLowerCase().startsWith('en') && /natural|online|neural/i.test(voix.name)) ??
        toutes().find(voix => voix.lang.toLowerCase().startsWith('en'));

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
    },
    pause: () => synthese?.pause(),
    reprendre: () => synthese?.resume(),
    arreter: () => {
      generation++;
      synthese?.cancel();
    },
  };
}
