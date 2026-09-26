import { construireEpisode } from './episode';
import { creerLecture } from './lecture';
import type { Lecteur } from './lecteurTypes';

function faux() {
  const appels: string[] = [];
  let rappels: Parameters<Lecteur['lire']>[3] | undefined;
  const lecteur: Lecteur = {
    disponible: true,
    voix: () => [{ id: 'v1', nom: 'Vivienne', langue: 'fr-FR' }],
    surChangementVoix: () => () => undefined,
    lire: (_file, depuis, options, r) => {
      appels.push(`lire:${depuis}:${options.vitesse}`);
      rappels = r;
    },
    pause: () => appels.push('pause'),
    reprendre: () => appels.push('reprendre'),
    arreter: () => appels.push('arreter'),
  };
  return { lecteur, appels, rappels: () => rappels! };
}

const episode = construireEpisode({
  aujourdhui: '2026-09-25',
  valeurTotale: 1000,
  totalReturn: 50,
  totalReturnPct: 5,
  lignes: [],
  valeurs: [],
  indices: [],
  actualitesMarche: [],
});

describe('lecture partagée du podcast', () => {
  it('lit, met en pause, reprend et suit la phrase en cours', () => {
    const { lecteur, appels, rappels } = faux();
    const lecture = creerLecture(lecteur);
    lecture.charger(episode);
    expect(lecture.etat().file.length).toBeGreaterThan(2);

    lecture.basculer();
    expect(lecture.etat().etat).toBe('lecture');
    rappels().surPhrase(2);
    expect(lecture.etat().courante).toBe(2);

    lecture.basculer();
    expect(lecture.etat().etat).toBe('pause');
    lecture.basculer();
    expect(appels).toEqual(['arreter', 'lire:0:1', 'pause', 'reprendre']);

    rappels().surFin();
    expect(lecture.etat()).toMatchObject({ etat: 'arret', courante: 0 });
  });

  it('recharger le même épisode ne coupe pas la lecture ; un nouveau, si', () => {
    const { lecteur, appels } = faux();
    const lecture = creerLecture(lecteur);
    lecture.charger(episode);
    lecture.basculer();
    lecture.charger(episode);
    expect(lecture.etat().etat).toBe('lecture');
    lecture.charger({ ...episode, titre: 'Autre' });
    expect(lecture.etat().etat).toBe('arret');
    expect(appels.filter(appel => appel === 'arreter')).toHaveLength(2); // premier chargement, puis nouvel épisode
  });

  it('prévient ses abonnés et relance à la nouvelle vitesse', () => {
    const { lecteur, appels } = faux();
    const lecture = creerLecture(lecteur);
    let notifications = 0;
    const desabonner = lecture.abonner(() => (notifications += 1));
    lecture.charger(episode);
    lecture.basculer();
    lecture.changerVitesse(1.3);
    expect(appels.at(-1)).toBe('lire:0:1.3');
    expect(notifications).toBeGreaterThan(2);
    desabonner();
  });
});
