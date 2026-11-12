/**
 * « Maps proposées » (Administration › Jeux) : préparation, revue (aperçu, échelle, source et licence, pool
 * suggéré, changements), « Valider », « Valider toutes », « Rejeter », « Remplacer l'image », « Calibrer ».
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { CartesProposees, type ApiCartesProposees } from './ui/jeux/CartesProposees';
import type { CarteProposee, ListeCartesProposees } from './jeux/api';

jest.mock('./ui/jeux/EditeurCarte', () => {
  // Plan simulé : deux boutons touchent la map en des points connus.
  const { Pressable: P, Text: T, View: V } = require('react-native');
  return {
    __esModule: true,
    planDisponible: true,
    default: ({ onPoint }: { onPoint(x: number, y: number): void }) => (
      <V>
        <P testID="plan-a" onPress={() => onPoint(100, 500)}>
          <T>a</T>
        </P>
        <P testID="plan-b" onPress={() => onPoint(900, 500)}>
          <T>b</T>
        </P>
      </V>
    ),
  };
});

const theme = themeHub('nuit');
const ATTRIBUTION = 'Source : THE FINALS Wiki (wiki.gg), page « Monaco » ; textes sous licence Creative Commons Attribution-ShareAlike (https://creativecommons.org/licenses/by-sa/4.0/). Image : œuvre du jeu (Embark Studios) reproduite par le wiki.';

function proposee(cle: string, nom: string, x: Partial<CarteProposee> = {}): CarteProposee {
  return {
    cle,
    nom,
    statut: 'a-valider',
    fournisseur: 'thefinals.wiki',
    fichier: `img-${cle}`,
    vueDessus: true,
    imageManuelle: false,
    imageUrl: `https://www.thefinals.wiki/w/images/${cle}.png`,
    page: `https://www.thefinals.wiki/wiki/${nom}`,
    licence: { texte: 'Creative Commons Attribution-ShareAlike', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    attribution: ATTRIBUTION,
    echelle: { pxParMetre: 4, points: [0, 500, 400, 500], distance: 100, methode: 'approx' },
    echelleManuelle: false,
    competitive: true,
    horsCompetition: false,
    variantes: ['Standard Issue', 'Duck and Cover'],
    modes: ['Cashout', 'Ranked Cashout'],
    reperes: 0,
    erreur: null,
    dansProfil: false,
    changements: { nouvelle: true, image: 'ajout', echelle: 'ajout', reperes: 0 },
    majLe: '2026-11-12T10:00:00.000Z',
    decideLe: null,
    ...x,
  };
}

function liste(cartes: CarteProposee[]): ListeCartesProposees {
  const images = Object.fromEntries(cartes.filter(c => c.fichier).map(c => [c.fichier as string, { url: `https://serveur/jeux/images/${c.fichier}?sig=x`, expire: null, largeur: 2048, hauteur: 2048 }]));
  return { cleJeu: 'the-finals', version: 3, modele: 'thefinals', cartes, images };
}

function faussesApi(depart: CarteProposee[]) {
  let etat = depart;
  const rendre = () => liste(etat);
  const maj = (cles: string[], x: Partial<CarteProposee>) => {
    etat = etat.map(c => (cles.includes(c.cle) ? { ...c, ...x } : c));
  };
  const api: jest.Mocked<ApiCartesProposees> = {
    liste: jest.fn(async () => rendre()),
    preparer: jest.fn(async () => {
      etat = [proposee('monaco', 'Monaco'), proposee('las-vegas-stadium', 'Las Vegas Stadium', { vueDessus: false }), proposee('nozomi-citadel', 'NOZOMI/CITADEL', { fichier: null, erreur: 'import-http' })];
      return { ...rendre(), rapport: [{ carte: 'Monaco', statut: 'nouvelle' as const }, { carte: 'NOZOMI/CITADEL', statut: 'nouvelle' as const, erreur: 'import-http' }] };
    }),
    valider: jest.fn(async corps => {
      const cles = corps.toutes ? etat.filter(c => c.statut === 'a-valider').map(c => c.cle) : (corps.cartes ?? []);
      maj(cles, { statut: 'validee' });
      return { ...rendre(), validees: cles };
    }),
    rejeter: jest.fn(async cartes => (maj(cartes, { statut: 'rejetee' }), rendre())),
    remplacerImage: jest.fn(async (carte: string, _corps: Parameters<ApiCartesProposees['remplacerImage']>[1]) => (maj([carte], { fichier: `img-${carte}-2`, imageManuelle: true, erreur: null }), rendre())),
    calibrer: jest.fn(async (carte: string, _corps: Parameters<ApiCartesProposees['calibrer']>[1]) => (maj([carte], { echelle: { pxParMetre: 5, points: [100, 500, 900, 500], distance: 160 }, echelleManuelle: true }), rendre())),
  };
  return api;
}

describe('maps proposées', () => {
  it('préparer puis revoir : aperçu, échelle approximative, source et licence, pool suggéré, ce qui changera', async () => {
    const api = faussesApi([]);
    await render(<CartesProposees theme={theme} modele="thefinals" api={api} onApplique={jest.fn()} />);
    expect(await screen.findByTestId('esport-jeu-proposees-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-jeu-proposees-preparer'));
    expect(api.preparer).toHaveBeenCalled();
    expect(await screen.findByTestId('esport-jeu-proposee-monaco')).toBeTruthy();
    expect(screen.getByText('3 map(s) à valider')).toBeTruthy();
    expect(screen.getByTestId('esport-jeu-proposee-monaco-apercu').props.source).toEqual({ uri: 'https://serveur/jeux/images/img-monaco?sig=x' });
    expect(screen.getByTestId('esport-jeu-proposee-monaco-statut')).toBeTruthy();
    expect(screen.getAllByText('À valider').length).toBe(3);
    expect(screen.getByTestId('esport-jeu-proposee-monaco-echelle').props.children).toBe('Échelle : 4 px/m (environ 250 m de large) (approximative, à vérifier)');
    expect(screen.getByTestId('esport-jeu-proposee-monaco-attribution').props.children).toMatch(/THE FINALS Wiki \(wiki\.gg\).*Creative Commons Attribution-ShareAlike/);
    expect(screen.getByTestId('esport-jeu-proposee-monaco-source').props.children).toBe('Source : https://www.thefinals.wiki/wiki/Monaco');
    expect(screen.getByTestId('esport-jeu-proposee-monaco-pool').props.children).toBe('Pool compétitif suggéré');
    expect(screen.getByTestId('esport-jeu-proposee-monaco-changements').props.children).toBe('À la validation : nouvelle map, image ajoutée, échelle ajoutée');
    expect(screen.getByTestId('esport-jeu-proposee-las-vegas-stadium-pas-vue-dessus')).toBeTruthy();
    expect(screen.getByTestId('esport-jeu-proposee-nozomi-citadel-sans-image').props.children).toMatch(/import-http/);
    expect(screen.getByTestId('esport-jeu-proposees-rapport').props.children).toMatch(/NOZOMI\/CITADEL : nouvelle \(import-http\)/);
  });

  it('valider, rejeter, valider toutes : seule la validation recharge le profil', async () => {
    const api = faussesApi([proposee('monaco', 'Monaco'), proposee('seoul', 'Seoul'), proposee('kyoto', 'Kyoto')]);
    const onApplique = jest.fn();
    await render(<CartesProposees theme={theme} modele="thefinals" api={api} onApplique={onApplique} />);
    await fireEvent.press(await screen.findByTestId('esport-jeu-proposee-seoul-rejeter'));
    expect(api.rejeter).toHaveBeenCalledWith(['seoul']);
    expect(await screen.findByText('Rejetée')).toBeTruthy();
    expect(onApplique).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('esport-jeu-proposee-monaco-valider'));
    expect(api.valider).toHaveBeenCalledWith({ cartes: ['monaco'] });
    expect(await screen.findByTestId('esport-jeu-proposees-avis')).toBeTruthy();
    expect(screen.getByText('1 map(s) appliquée(s) au profil.')).toBeTruthy();
    expect(onApplique).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('esport-jeu-proposees-valider-toutes'));
    expect(api.valider).toHaveBeenLastCalledWith({ toutes: true });
    expect(await screen.findByText('1 map(s) appliquée(s) au profil.')).toBeTruthy();
    expect(screen.queryByTestId('esport-jeu-proposees-valider-toutes')).toBeNull();
    expect(screen.queryByTestId('esport-jeu-proposee-kyoto-valider')).toBeNull();
    expect(onApplique).toHaveBeenCalledTimes(2);
  });

  it('remplacer l’image (adresse https) et calibrer (deux points, distance réelle)', async () => {
    const api = faussesApi([proposee('monaco', 'Monaco')]);
    await render(<CartesProposees theme={theme} modele="thefinals" api={api} onApplique={jest.fn()} />);
    await fireEvent.press(await screen.findByTestId('esport-jeu-proposee-monaco-remplacer'));
    expect(screen.getByTestId('esport-jeu-proposee-monaco-url-envoyer').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('esport-jeu-proposee-monaco-url'), 'https://exemple.org/monaco.png');
    await fireEvent.press(screen.getByTestId('esport-jeu-proposee-monaco-url-envoyer'));
    expect(api.remplacerImage).toHaveBeenCalledWith('monaco', { url: 'https://exemple.org/monaco.png' });
    expect(await screen.findByText('Image remplacée par vous.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-jeu-proposee-monaco-calibrer'));
    await fireEvent.press(await screen.findByTestId('plan-a'));
    await fireEvent.press(screen.getByTestId('plan-b'));
    await fireEvent.changeText(screen.getByTestId('esport-jeu-proposee-monaco-distance'), '160');
    await fireEvent.press(screen.getByTestId('esport-jeu-proposee-monaco-calibrer-enregistrer'));
    expect(api.calibrer).toHaveBeenCalledWith('monaco', { points: [100, 500, 900, 500], distance: 160 });
    expect(await screen.findByText('Échelle : 5 px/m (environ 200 m de large) (calibrée à la main)')).toBeTruthy();
  });

  it('jeu générique : rien à proposer', async () => {
    const api = faussesApi([]);
    const vue = await render(<CartesProposees theme={theme} modele="generique" api={api} onApplique={jest.fn()} />);
    expect(vue.toJSON()).toBeNull();
  });
});
