/**
 * La lecture du podcast, commune à toute l'application.
 *
 * Elle vit hors des écrans : quitter la page Podcast ne coupe pas la voix,
 * et un petit lecteur flottant permet de mettre en pause ou d'arrêter
 * depuis n'importe quel écran. Les écrans s'abonnent à cet état.
 */

import { phrases, type Episode } from './episode';
import { creerLecteur, type Lecteur, type PhraseALire, type VoixDisponible } from './lecteur';

export interface PhraseDeChapitre extends PhraseALire {
  chapitre: number;
}

export interface EtatLecture {
  episode?: Episode;
  file: PhraseDeChapitre[];
  etat: 'arret' | 'lecture' | 'pause';
  courante: number;
  vitesse: number;
  voixChoisie?: string;
  voix: VoixDisponible[];
  avertissement?: string;
}

export function fileDe(episode: Episode | undefined): PhraseDeChapitre[] {
  return (episode?.chapitres ?? []).flatMap((chapitre, rang) =>
    chapitre.segments.flatMap(segment =>
      phrases(segment.texte).map(texte => ({ texte, langue: segment.langue, chapitre: rang })),
    ),
  );
}

export function creerLecture(lecteur: Lecteur = creerLecteur()) {
  let etat: EtatLecture = { file: [], etat: 'arret', courante: 0, vitesse: 1, voix: lecteur.voix() };
  const abonnes = new Set<() => void>();
  const changer = (partiel: Partial<EtatLecture>) => {
    etat = { ...etat, ...partiel };
    abonnes.forEach(rappel => rappel());
  };
  lecteur.surChangementVoix(() => changer({ voix: lecteur.voix() }));

  const lireDepuis = (index: number) => {
    changer({ courante: index, etat: 'lecture', avertissement: undefined });
    lecteur.lire(
      etat.file,
      index,
      { vitesse: etat.vitesse, voixFrancaise: etat.voixChoisie ?? etat.voix[0]?.id },
      {
        surPhrase: courante => changer({ courante }),
        surErreur: avertissement => changer({ avertissement }),
        surFin: () => changer({ etat: 'arret', courante: 0 }),
      },
    );
  };

  const debutChapitre = (rang: number) => Math.max(0, etat.file.findIndex(phrase => phrase.chapitre === rang));

  return {
    lecteur,
    etat: () => etat,
    abonner(rappel: () => void): () => void {
      abonnes.add(rappel);
      return () => abonnes.delete(rappel);
    },
    /** Un nouvel épisode arrête l'ancien ; le même épisode ne change rien. */
    charger(episode: Episode | undefined) {
      if (episode === etat.episode) return;
      lecteur.arreter();
      changer({ episode, file: fileDe(episode), etat: 'arret', courante: 0 });
    },
    basculer() {
      if (etat.etat === 'lecture') {
        lecteur.pause();
        changer({ etat: 'pause' });
      } else if (etat.etat === 'pause') {
        lecteur.reprendre();
        changer({ etat: 'lecture' });
      } else if (etat.file.length > 0) {
        lireDepuis(etat.courante);
      }
    },
    lireDepuis,
    placer(index: number) {
      if (etat.etat === 'arret') changer({ courante: index });
      else lireDepuis(index);
    },
    allerAuChapitre(rang: number) {
      const index = debutChapitre(rang);
      if (etat.etat === 'arret') changer({ courante: index });
      else lireDepuis(index);
    },
    chapitreSuivant(sens: 1 | -1) {
      const actuel = etat.file[etat.courante]?.chapitre ?? 0;
      const dernier = (etat.episode?.chapitres.length ?? 1) - 1;
      this.allerAuChapitre(Math.min(dernier, Math.max(0, actuel + sens)));
    },
    arreter() {
      lecteur.arreter();
      changer({ etat: 'arret' });
    },
    changerVitesse(vitesse: number) {
      changer({ vitesse });
      if (etat.etat === 'lecture') lireDepuis(etat.courante);
    },
    changerVoix(voixChoisie: string) {
      changer({ voixChoisie });
      if (etat.etat === 'lecture') lireDepuis(etat.courante);
    },
  };
}

export type Lecture = ReturnType<typeof creerLecture>;

let partagee: Lecture | undefined;

/** La lecture de l'application, créée au premier usage. */
export function lecturePartagee(): Lecture {
  partagee ??= creerLecture();
  return partagee;
}
