/**
 * Éditeur de strats : barre d'agents (portraits importés, repli en initiales, filtre par rôle, camp allié /
 * ennemi), barre de capacités (C, Q, E, X avec icônes, un clic arme la pose), barre des étapes (1 à N, lecture,
 * curseur, « Supprimer tout / l'étape »), grille d'outils ; assets des agents depuis le profil de jeu (portraits
 * et icônes IMPORTÉS par le serveur, adresse CDN gardée pour le document) ; « Importer agents et capacités ».
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { AgentAsset } from './strats/assets';
import { BarreAgents, BarreCapacites, BarreEtapes, GrilleOutils, agentsDuRole, capacitesOrdonnees, type Camp } from './ui/strats/Barres';
import { ImportAgents } from './ui/jeux/DetailsJeu';
import { assetsDepuisProfil, capacitesOfficielles, donneesVides } from './jeux/profil';
import { appliquer, documentVide, type ObjetStrat } from './strats/document';
import type { ProfilJeu } from './jeux/api';

const theme = themeHub('nuit');

const agent = (cle: string, roleCle: string, icone: string | null, capacites: AgentAsset['capacites'] = []): AgentAsset => ({ cle, nom: cle[0].toUpperCase() + cle.slice(1), role: roleCle, roleCle, icone, capacites });
const AGENTS: AgentAsset[] = [
  agent('jett', 'duelliste', 'https://exemple.test/jett.png'),
  agent('sova', 'initiateur', 'https://exemple.test/sova.png'),
  agent('viper', 'controleur', 'https://exemple.test/viper.png', [
    { cle: 'Ultimate', nom: 'Viper’s Pit', icone: 'https://exemple.test/x.png', touche: 'X' },
    { cle: 'Ability2', nom: 'Toxic Screen', icone: 'https://exemple.test/e.png', touche: 'E' },
    { cle: 'Grenade', nom: 'Snake Bite', icone: null, touche: 'C' },
    { cle: 'Ability1', nom: 'Poison Cloud', icone: 'https://exemple.test/q.png', touche: 'Q' },
  ]),
  agent('killjoy', 'sentinelle', null),
];

function Agents({ initial = 'allie' as Camp, onAgent = jest.fn() }) {
  const [role, setRole] = React.useState<string | null>(null);
  const [camp, setCamp] = React.useState<Camp>(initial);
  return <BarreAgents theme={theme} agents={AGENTS} agentCle="jett" onAgent={onAgent} role={role} onRole={setRole} camp={camp} onCamp={setCamp} />;
}

describe('barre d’agents', () => {
  it('portraits importés, initiales en repli (image absente ou en échec)', async () => {
    await render(<Agents />);
    expect(screen.getByTestId('esport-agent-jett-portrait-image')).toBeTruthy();
    expect(screen.getByTestId('esport-agent-killjoy-portrait-initiales')).toBeTruthy();
    expect(screen.getByText('K')).toBeTruthy();
    // Une image qui ne charge pas : repli en initiales.
    await fireEvent(screen.getByTestId('esport-agent-sova-portrait-image'), 'error');
    expect(screen.getByTestId('esport-agent-sova-portrait-initiales')).toBeTruthy();
    expect(screen.queryByTestId('esport-agents-sans-images')).toBeNull();
  });

  it('sans aucun portrait importé : message vers « Importer agents et capacités »', async () => {
    await render(<BarreAgents theme={theme} agents={AGENTS.map(a => ({ ...a, icone: null }))} agentCle={undefined} onAgent={jest.fn()} role={null} onRole={jest.fn()} camp="allie" onCamp={jest.fn()} />);
    expect(screen.getByTestId('esport-agents-sans-images')).toBeTruthy();
  });

  it('filtre par rôle (Duellistes, Initiateurs, Contrôleurs, Sentinelles), retour à « Tous »', async () => {
    await render(<Agents />);
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/)).toHaveLength(4);
    await fireEvent.press(screen.getByTestId('esport-agents-role-controleur'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/).map(e => e.props.testID)).toEqual(['esport-agent-viper']);
    await fireEvent.press(screen.getByTestId('esport-agents-role-controleur'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/)).toHaveLength(4);
    await fireEvent.press(screen.getByTestId('esport-agents-role-sentinelle'));
    await fireEvent.press(screen.getByTestId('esport-agents-role-tous'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/)).toHaveLength(4);
    expect(agentsDuRole(AGENTS, 'initiateur').map(a => a.cle)).toEqual(['sova']);
  });

  it('camp allié / ennemi, choix d’un agent', async () => {
    const onAgent = jest.fn();
    await render(<Agents onAgent={onAgent} />);
    expect(screen.getByTestId('esport-agents-camp-allie').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-agents-camp-ennemi'));
    expect(screen.getByTestId('esport-agents-camp-ennemi').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-agent-viper'));
    expect(onAgent).toHaveBeenCalledWith(expect.objectContaining({ cle: 'viper' }));
  });
});

describe('barre de capacités', () => {
  it('C, Q, E, X dans l’ordre du jeu, icônes (initiales sans icône) ; un clic arme la pose', async () => {
    const onCapacite = jest.fn();
    const viper = AGENTS[2];
    expect(capacitesOrdonnees(viper).map(c => c.touche)).toEqual(['C', 'Q', 'E', 'X']);
    const { rerender } = await render(<BarreCapacites theme={theme} agent={viper} capaciteCle={undefined} armee={false} onCapacite={onCapacite} />);
    expect(screen.getAllByTestId(/^esport-capacite-[A-Za-z0-9]+$/).map(e => e.props.testID)).toEqual(['esport-capacite-Grenade', 'esport-capacite-Ability1', 'esport-capacite-Ability2', 'esport-capacite-Ultimate']);
    expect(screen.getByTestId('esport-capacite-Ability2-icone-image')).toBeTruthy();
    expect(screen.getByTestId('esport-capacite-Grenade-icone-initiales')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-capacite-Ability2'));
    expect(onCapacite).toHaveBeenCalledWith(expect.objectContaining({ cle: 'Ability2', nom: 'Toxic Screen' }));
    await rerender(<BarreCapacites theme={theme} agent={viper} capaciteCle="Ability2" armee onCapacite={onCapacite} />);
    expect(screen.getByTestId('esport-capacite-Ability2').props.accessibilityState.selected).toBe(true);
  });
});

describe('barre des étapes et grille d’outils', () => {
  it('étapes 1 à N, ajout, lecture, curseur ; supprimer tout ou l’étape', async () => {
    const f = { onEtape: jest.fn(), onAjouter: jest.fn(), onLire: jest.fn(), onPause: jest.fn(), onTemps: jest.fn(), onSupprimerTout: jest.fn(), onSupprimerEtape: jest.fn() };
    await render(<BarreEtapes theme={theme} n={3} etape={1} peutAjouter duree={5} temps={undefined} enLecture={false} modifiable {...f} />);
    expect(screen.getByTestId('esport-etape-num-1').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-etape-num-2'));
    expect(f.onEtape).toHaveBeenCalledWith(2);
    await fireEvent.press(screen.getByTestId('esport-etape-num-ajouter'));
    await fireEvent.press(screen.getByTestId('esport-barre-lecture'));
    expect(f.onAjouter).toHaveBeenCalled();
    expect(f.onLire).toHaveBeenCalled();
    const curseur = screen.getByTestId('esport-barre-curseur');
    await fireEvent(curseur, 'layout', { nativeEvent: { layout: { width: 200, height: 28, x: 0, y: 0 } } });
    await fireEvent(curseur, 'responderGrant', { nativeEvent: { locationX: 100 } });
    expect(f.onTemps).toHaveBeenLastCalledWith(2.5);
    await fireEvent(curseur, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(f.onTemps).toHaveBeenLastCalledWith(0.5);
    await fireEvent.press(screen.getByTestId('esport-supprimer-tout'));
    await fireEvent.press(screen.getByTestId('esport-supprimer-etape'));
    expect(f.onSupprimerTout).toHaveBeenCalled();
    expect(f.onSupprimerEtape).toHaveBeenCalled();
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

  it('outils en grille, icônes monochromes, choix', async () => {
    const onOutil = jest.fn();
    await render(<GrilleOutils theme={theme} outils={[{ id: 'selection', icone: 'selection', libelle: 'Sélection', raccourci: 'V' }, { id: 'gomme', icone: 'gomme', libelle: 'Gomme', raccourci: 'E' }]} actif="selection" onOutil={onOutil} />);
    expect(screen.getByLabelText('Gomme (E)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-outil-gomme'));
    expect(onOutil).toHaveBeenCalledWith('gomme');
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
