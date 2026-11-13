/**
 * Couleur d'accent des agents (strat réglée sur « Couleur : agent ») : pré-remplie « à vérifier », modifiable dans
 * Administration › Jeux (personnage et capacité), reprise par les assets de l'éditeur ; composant `CarteJeu`
 * (version native : image sur le fond du thème, contenu posé dans le repère de 1000 unités).
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { CapaciteJeu, PersonnageJeu, ProfilJeu } from './jeux/api';
import { accentPrerempli } from './jeux/modeles';
import { assetsDepuisProfil, donneesVides } from './jeux/profil';
import { contraste, couleurAffichee, PLATEAU } from './strats/plateau';
import CarteJeu from './ui/cartes/CarteJeu';
import { CapacitesPersonnage } from './ui/jeux/DetailsJeu';

const theme = themeHub('nuit');
const capacite = (plus: Partial<CapaciteJeu> = {}): CapaciteJeu => ({ cle: 'cover', nom: 'Dark Cover', touche: 'E', categorie: 'basique', forme: 'cercle', rayon: 4.1, aVerifier: true, ...plus });

describe('accent des agents', () => {
  it('pré-rempli pour Valorant (à vérifier), lisible sur le plateau ; aucun pour les autres modèles', () => {
    expect(accentPrerempli('valorant', { cle: 'viper' })).toBe('#22c55e');
    expect(accentPrerempli('valorant', { cle: 'KAY/O' })).toBe(accentPrerempli('valorant', { cle: 'kay-o' }));
    expect(accentPrerempli('valorant', { cle: 'agent-inconnu' })).toBeUndefined();
    expect(accentPrerempli('thefinals', { cle: 'heavy' })).toBeUndefined();
    for (const cle of ['astra', 'breach', 'brimstone', 'chamber', 'clove', 'cypher', 'deadlock', 'fade', 'gekko', 'harbor', 'iso', 'jett', 'kay-o', 'killjoy', 'neon', 'omen', 'phoenix', 'raze', 'reyna', 'sage', 'skye', 'sova', 'viper', 'vyse', 'yoru']) {
      const c = accentPrerempli('valorant', { cle }) as string;
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
      // Anneau et zone visibles sur le fond sombre du plateau et sur la puce de la capacité.
      expect(contraste(c, PLATEAU.themes.tactique.sol)).toBeGreaterThanOrEqual(2.2);
      expect(contraste(c, PLATEAU.puce)).toBeGreaterThanOrEqual(3);
    }
  });

  it('assets de l’éditeur : accent du profil d’abord, sinon le pré-rempli ; une capacité peut avoir le sien', () => {
    const profil = {
      cle: 'valorant',
      nom: 'Valorant',
      couleur: '#ff4655',
      icone: null,
      base: 'valorant',
      modeleStrat: 'valorant',
      statut: 'actif',
      version: 1,
      donnees: {
        ...donneesVides(),
        personnages: [
          { cle: 'omen', nom: 'Omen', classe: null, image: null, actif: true, couleur: '#123456', capacites: [capacite({ couleur: '#abcdef' }), capacite({ cle: 'step', nom: 'Shrouded Step', touche: 'C', forme: 'point' })] },
          { cle: 'viper', nom: 'Viper', classe: null, image: null, actif: true },
        ],
      },
      images: {},
    } as unknown as ProfilJeu;
    const a = assetsDepuisProfil(profil, undefined, 0);
    const omen = a.agents.find(x => x.cle === 'omen');
    expect(omen?.couleur).toBe('#123456');
    expect(omen?.capacites.find(c => c.touche === 'E')?.couleur).toBe('#abcdef');
    expect(omen?.capacites.find(c => c.touche === 'C')?.couleur ?? null).toBeNull();
    expect(a.agents.find(x => x.cle === 'viper')?.couleur).toBe('#22c55e');
    // Dans une strat : la couleur du joueur par défaut, l'accent quand la strat le demande.
    expect(couleurAffichee('#ef4444', undefined, omen?.couleur)).toBe('#ef4444');
    expect(couleurAffichee('#ef4444', 'agent', omen?.capacites.find(c => c.touche === 'E')?.couleur ?? omen?.couleur)).toBe('#abcdef');
    expect(couleurAffichee('#ef4444', 'agent', omen?.capacites.find(c => c.touche === 'C')?.couleur ?? omen?.couleur)).toBe('#123456');
  });

  it('Administration › Jeux : accent pré-rempli signalé « à vérifier », corrigé à la main, vidé ; accent d’une capacité', async () => {
    const etat: { p: PersonnageJeu } = { p: { cle: 'viper', nom: 'Viper', classe: null, image: null, actif: true, capacites: [capacite()] } };
    const onCouleur = jest.fn((c: string | undefined) => {
      etat.p = c ? { ...etat.p, couleur: c } : (({ couleur: _c, ...reste }) => reste)(etat.p);
    });
    const onCapacites = jest.fn((c: CapaciteJeu[] | undefined) => {
      etat.p = { ...etat.p, capacites: c };
    });
    const rendu = () => <CapacitesPersonnage theme={theme} personnage={etat.p} modele="valorant" onCapacites={onCapacites} onCouleur={onCouleur} testID="caps" />;
    const vue = await render(rendu());
    expect(screen.getByTestId('caps-accent-a-verifier')).toBeTruthy();
    expect(screen.getByTestId('caps-accent-pastille').props.accessibilityLabel).toBe('#22c55e');
    // Saisie incomplète : rien n'est enregistré ; couleur complète (avec ou sans dièse) : gardée en minuscules.
    await fireEvent.changeText(screen.getByTestId('caps-accent'), '#12');
    expect(onCouleur).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('caps-accent'), '1FA2B3');
    expect(onCouleur).toHaveBeenLastCalledWith('#1fa2b3');
    await vue.rerender(rendu());
    expect(screen.queryByTestId('caps-accent-a-verifier')).toBeNull();
    expect(screen.getByTestId('caps-accent-pastille').props.accessibilityLabel).toBe('#1fa2b3');
    await fireEvent.changeText(screen.getByTestId('caps-0-accent'), '#ff8800');
    expect(onCapacites).toHaveBeenLastCalledWith([expect.objectContaining({ cle: 'cover', couleur: '#ff8800' })]);
    await fireEvent.changeText(screen.getByTestId('caps-accent'), '');
    expect(onCouleur).toHaveBeenLastCalledWith(undefined);
  });

  it('sans `onCouleur` (anciens écrans) : pas de champ d’accent', async () => {
    await render(<CapacitesPersonnage theme={theme} personnage={{ cle: 'viper', nom: 'Viper', classe: null, image: null, actif: true }} modele="valorant" onCapacites={jest.fn()} testID="caps" />);
    expect(screen.queryByTestId('caps-accent')).toBeNull();
  });
});

describe('CarteJeu (composant réutilisable)', () => {
  it('image de la map sur le fond du thème, source suivante si elle ne charge pas ; contenu posé dans le repère de 1000 unités', async () => {
    const carte = { nom: 'Ascent', minimap: 'https://media.valorant-api.com/maps/a/displayicon.png' };
    await render(
      <CarteJeu theme={theme} carte={carte} taille={300} themeCarte="clair">
        {({ px, taille }) => <Text testID="pin" style={{ position: 'absolute', left: px(500), top: px(250) }}>{`${taille}`}</Text>}
      </CarteJeu>,
    );
    const racine = screen.getByTestId('esport-carte-jeu');
    expect(racine.props.accessibilityLabel).toBe('Ascent');
    expect(racine.props.style).toMatchObject({ width: 300, height: 300, backgroundColor: PLATEAU.themes.clair.fond });
    expect(screen.getByTestId('esport-carte-jeu-image').props.source).toEqual({ uri: carte.minimap });
    expect(screen.getByTestId('pin').props.style).toMatchObject({ left: 150, top: 75 });
    expect(screen.getByText('300')).toBeTruthy();
    // L'image ne charge pas : le nom de la map en filigrane.
    await fireEvent(screen.getByTestId('esport-carte-jeu-image'), 'error');
    expect(screen.queryByTestId('esport-carte-jeu-image')).toBeNull();
    expect(screen.getByText('Ascent')).toBeTruthy();
  });

  it('adresse hors liste (ni stockage du serveur ni CDN officiel) : jamais chargée', async () => {
    await render(<CarteJeu theme={theme} carte={{ nom: 'Monaco', minimap: null }} image="https://ailleurs.example/monaco.png" taille={120} />);
    expect(screen.queryByTestId('esport-carte-jeu-image')).toBeNull();
    expect(screen.getByText('Monaco')).toBeTruthy();
  });
});
