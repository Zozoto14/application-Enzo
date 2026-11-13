/**
 * Briques des barres de l'atelier de strats : portrait d'un agent ou icône d'une capacité (`IconeAsset` : image
 * importée, puis CDN officiel, puis initiales), rôles des agents, ordre des capacités (C, Q, E, X), curseur de
 * temps ; « Supprimer tout » ; assets des agents depuis le profil de jeu (portraits et icônes IMPORTÉS par le
 * serveur, adresse CDN gardée pour le document) ; « Importer agents et capacités ». Le dock, le rail d'outils et la
 * frise des étapes sont testés dans StratsAtelier.test.tsx.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { sourcesIcone, type AgentAsset } from './strats/assets';
import { Curseur, IconeAsset, ROLES_AGENTS, agentsDuRole, capacitesOrdonnees } from './ui/strats/Barres';
import { ImportAgents } from './ui/jeux/DetailsJeu';
import { assetsDepuisProfil, capacitesOfficielles, donneesVides } from './jeux/profil';
import { appliquer, documentVide, type ObjetStrat } from './strats/document';
import type { ProfilJeu } from './jeux/api';

const theme = themeHub('nuit');

const agent = (cle: string, roleCle: string, icone: string | null, capacites: AgentAsset['capacites'] = []): AgentAsset => ({ cle, nom: cle[0].toUpperCase() + cle.slice(1), role: roleCle, roleCle, icone, capacites });
const AGENTS: AgentAsset[] = [
  agent('jett', 'duelliste', 'https://media.valorant-api.com/agents/t/jett.png'),
  agent('sova', 'initiateur', 'https://media.valorant-api.com/agents/t/sova.png'),
  agent('viper', 'controleur', 'https://media.valorant-api.com/agents/t/viper.png', [
    { cle: 'Ultimate', nom: 'Viper’s Pit', icone: 'https://media.valorant-api.com/agents/t/x.png', touche: 'X' },
    { cle: 'Ability2', nom: 'Toxic Screen', icone: 'https://media.valorant-api.com/agents/t/e.png', touche: 'E' },
    { cle: 'Grenade', nom: 'Snake Bite', icone: null, touche: 'C' },
    { cle: 'Ability1', nom: 'Poison Cloud', icone: 'https://media.valorant-api.com/agents/t/q.png', touche: 'Q' },
  ]),
  agent('killjoy', 'sentinelle', null),
];

describe('portrait d’un agent, icône d’une capacité', () => {
  it('image quand elle existe, initiales en repli (image absente ou en échec)', async () => {
    await render(
      <>
        <IconeAsset theme={theme} url={sourcesIcone(AGENTS[0])} nom="Jett" testID="p-jett" />
        <IconeAsset theme={theme} url={sourcesIcone(AGENTS[1])} nom="Sova" testID="p-sova" />
        <IconeAsset theme={theme} url={sourcesIcone(AGENTS[3])} nom="Killjoy" testID="p-killjoy" />
      </>,
    );
    expect(screen.getByTestId('p-jett-image')).toBeTruthy();
    expect(screen.getByTestId('p-killjoy-initiales')).toBeTruthy();
    expect(screen.getByText('K')).toBeTruthy();
    await fireEvent(screen.getByTestId('p-sova-image'), 'error');
    expect(screen.getByTestId('p-sova-initiales')).toBeTruthy();
  });

  it('image importée en échec : le CDN officiel ensuite, puis les initiales ; `onEchec` quand tout a échoué', async () => {
    const signe = (c: string) => `https://esport.test/jeux/images/${c}?c=x&exp=1&sig=s`;
    const jett = { ...agent('jett', 'duelliste', signe('jett')), iconeDoc: 'https://media.valorant-api.com/agents/j/displayicon.png' };
    const sova = { ...agent('sova', 'initiateur', signe('sova')), iconeDoc: 'https://ailleurs.example/sova.png' };
    const onEchec = jest.fn();
    await render(
      <>
        <IconeAsset theme={theme} url={sourcesIcone(jett)} nom="Jett" testID="p-jett" onEchec={() => onEchec('jett')} />
        <IconeAsset theme={theme} url={sourcesIcone(sova)} nom="Sova" testID="p-sova" onEchec={() => onEchec('sova')} />
      </>,
    );
    expect(screen.getByTestId('p-jett-image').props.source).toEqual({ uri: signe('jett') });
    await fireEvent(screen.getByTestId('p-jett-image'), 'error');
    expect(screen.getByTestId('p-jett-image').props.source).toEqual({ uri: 'https://media.valorant-api.com/agents/j/displayicon.png' });
    expect(onEchec).not.toHaveBeenCalled();
    // Hôte hors liste : jamais essayé (initiales directement après l'échec du lien signé).
    await fireEvent(screen.getByTestId('p-sova-image'), 'error');
    expect(screen.getByTestId('p-sova-initiales')).toBeTruthy();
    expect(onEchec).toHaveBeenCalledWith('sova');
    await fireEvent(screen.getByTestId('p-jett-image'), 'error');
    expect(screen.getByTestId('p-jett-initiales')).toBeTruthy();
    expect(onEchec).toHaveBeenCalledWith('jett');
  });
});

describe('rôles, ordre des capacités, curseur de temps', () => {
  it('agents d’un rôle (Duellistes, Initiateurs, Contrôleurs, Sentinelles) ; null : tous', () => {
    expect(ROLES_AGENTS).toEqual(['duelliste', 'initiateur', 'controleur', 'sentinelle']);
    expect(agentsDuRole(AGENTS, 'initiateur').map(a => a.cle)).toEqual(['sova']);
    expect(agentsDuRole(AGENTS, null)).toHaveLength(4);
  });

  it('capacités dans l’ordre du jeu : C, Q, E, X', () => {
    expect(capacitesOrdonnees(AGENTS[2]).map(c => c.touche)).toEqual(['C', 'Q', 'E', 'X']);
  });

  it('curseur : toucher la piste, ou l’ajuster au clavier (accessibilité)', async () => {
    const onChanger = jest.fn();
    await render(<Curseur theme={theme} valeur={0} max={5} onChanger={onChanger} libelle="Temps" testID="curseur" />);
    const curseur = screen.getByTestId('curseur');
    await fireEvent(curseur, 'layout', { nativeEvent: { layout: { width: 200, height: 28, x: 0, y: 0 } } });
    await fireEvent(curseur, 'responderGrant', { nativeEvent: { locationX: 100 } });
    expect(onChanger).toHaveBeenLastCalledWith(2.5);
    await fireEvent(curseur, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChanger).toHaveBeenLastCalledWith(0.5);
  });

  it('« Supprimer tout » vide toutes les étapes (calques verrouillés gardés), annulable par l’historique', () => {
    let d = documentVide({ cle: 'ascent', nom: 'Ascent', image: null }, 'attaque', 'valorant', 'valorant');
    const pion = (id: string): ObjetStrat => ({ id, type: 'agent', x: 1, y: 1, agent: 'jett', nom: 'Jett', icone: null, joueur: 0, couleur: '#ffffff' });
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: pion('a') });
    d = appliquer(d, { type: 'ajouterEtape', apres: 0 });
    d = appliquer(d, { type: 'ajouter', etape: 1, objet: pion('b') });
    d = appliquer(d, { type: 'ajouter', etape: 1, objet: { id: 't', type: 'texte', x: 1, y: 1, texte: 'note', couleur: '#ffffff', taille: 20 } });
    d = appliquer(d, { type: 'calque', calque: 'texte', champs: { verrou: true } });
    const vide = appliquer(d, { type: 'viderTout' });
    expect(vide.etapes.map(e => e.objets.map(o => o.id))).toEqual([[], ['t']]);
    expect(appliquer(vide, { type: 'viderTout' })).toBe(vide);
  });
});

describe('assets des agents depuis le profil (images importées par le serveur)', () => {
  const profil = (): ProfilJeu =>
    ({
      cle: 'valorant',
      nom: 'Valorant',
      couleur: '#ff4655',
      icone: null,
      base: 'valorant',
      modeleStrat: 'valorant',
      statut: 'actif',
      version: 3,
      donnees: {
        ...donneesVides(),
        classes: [{ cle: 'controleur', nom: 'Contrôleur', fichier: 'r1' }],
        personnages: [
          {
            cle: 'viper',
            nom: 'Viper',
            classe: 'controleur',
            image: null,
            actif: true,
            fichier: 'p1',
            source: { fournisseur: 'valorant-api.com', url: 'https://media.valorant-api.com/agents/v/displayicon.png', aVerifier: false },
            officielles: [
              { touche: 'E', slot: 'Ability2', nom: 'Toxic Screen', description: 'Mur toxique.', fichier: 'i-e', url: 'https://media.valorant-api.com/agents/v/abilities/ability2/displayicon.png' },
              { touche: 'C', slot: 'Grenade', nom: 'Snake Bite', fichier: 'i-c', url: 'https://media.valorant-api.com/agents/v/abilities/grenade/displayicon.png' },
            ],
          },
          { cle: 'killjoy', nom: 'Killjoy', classe: null, image: null, actif: true },
        ],
      },
      images: { p1: { url: '/jeux/images/p1?sig=a', expire: '', largeur: 128, hauteur: 128 }, 'i-e': { url: '/jeux/images/ie?sig=b', expire: '', largeur: 128, hauteur: 128 } },
    }) as unknown as ProfilJeu;

  it('portrait = lien signé, adresse CDN gardée pour le document ; capacités officielles + caractéristiques pré-remplies (par la touche)', () => {
    const a = assetsDepuisProfil(profil(), undefined, 0);
    const viper = a.agents.find(x => x.cle === 'viper') as AgentAsset;
    expect(viper.icone).toBe('/jeux/images/p1?sig=a');
    expect(viper.iconeDoc).toBe('https://media.valorant-api.com/agents/v/displayicon.png');
    expect(viper.roleCle).toBe('controleur');
    const e = viper.capacites.find(c => c.touche === 'E');
    expect(e).toMatchObject({ cle: 'Ability2', nom: 'Toxic Screen', icone: '/jeux/images/ie?sig=b', iconeDoc: 'https://media.valorant-api.com/agents/v/abilities/ability2/displayicon.png', description: 'Mur toxique.' });
    expect(e?.donnees).toMatchObject({ forme: 'mur', longueur: 60, aVerifier: true });
    // Icône pas encore servie (lien absent) : adresse CDN en repli.
    expect(viper.capacites.find(c => c.touche === 'C')?.icone).toBe('https://media.valorant-api.com/agents/v/abilities/grenade/displayicon.png');
    // Agent sans import : initiales (icone null), capacités pré-remplies.
    const kj = a.agents.find(x => x.cle === 'killjoy') as AgentAsset;
    expect(kj.icone).toBeNull();
    expect(kj.capacites.length).toBe(4);
  });

  it('sans capacité importée : celles lues en direct sont gardées', () => {
    const riot = [{ cle: 'Grenade', nom: 'Morsure', icone: 'https://media.valorant-api.com/c.png', touche: 'C' }];
    expect(capacitesOfficielles([], riot, () => null)).toBe(riot);
  });
});

describe('Administration › Jeux : « Importer agents et capacités »', () => {
  it('lance l’import et affiche le compte rendu par agent', async () => {
    const importer = jest.fn().mockResolvedValue({
      inchange: false,
      rapport: [
        { agent: 'Viper', portrait: 'importee', capacites: 4 },
        { agent: 'Hush', portrait: 'importee', capacites: 4, ajoute: true },
        { agent: 'Harbor', portrait: 'inchangee', capacites: 0, erreur: 'import-http' },
      ],
    });
    const onFini = jest.fn();
    await render(<ImportAgents theme={theme} profil={{ version: 7 }} importer={importer} onFini={onFini} />);
    await fireEvent.press(screen.getByTestId('esport-jeu-import-agents-remplacer'));
    await fireEvent.press(screen.getByTestId('esport-jeu-import-agents-lancer'));
    await waitFor(() => expect(screen.getByTestId('esport-jeu-import-agents-rapport')).toBeTruthy());
    expect(importer).toHaveBeenCalledWith({ version: 7, remplacer: true });
    expect(onFini).toHaveBeenCalled();
    expect(screen.getByText(/3 agents, 2 portraits, 8 icônes/)).toBeTruthy();
    expect(screen.getByText(/Hush · portrait importé · 4 icônes · ajouté au profil/)).toBeTruthy();
    expect(screen.getByText(/Harbor .*échec \(import-http\)/)).toBeTruthy();
  });
});
