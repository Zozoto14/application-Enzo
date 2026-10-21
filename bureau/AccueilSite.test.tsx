import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccueilSite, RemplacerDonnees } from './AccueilSite';
import { Deverrouillage } from '../src/ui/ecrans/Deverrouillage';

const connexion = (o: Partial<Parameters<typeof AccueilSite>[0]['connexion']> = {}) => ({
  relaisConnu: true,
  onConnexion: jest.fn().mockResolvedValue(undefined),
  onInvitation: jest.fn().mockResolvedValue(undefined),
  ...o,
});

describe('premier lancement sur un navigateur (version 9 : identifiant + mot de passe pour tous)', () => {
  it('plus de carte « code de liaison » : on se connecte, ou on ouvre son invitation ; créer un coffre vient après un avertissement', async () => {
    const options = connexion();
    const onCreer = jest.fn();
    await render(<AccueilSite onCreer={onCreer} connexion={options} />);
    expect(screen.queryByText(/code de liaison/i)).toBeNull();
    expect(screen.queryByText(/AB1/)).toBeNull();
    expect(screen.queryByTestId('champ-code-accueil')).toBeNull();
    expect(screen.queryByTestId('bouton-relier-accueil')).toBeNull();
    expect(screen.getByText(/J’ai reçu une invitation/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('connexion-id-identifiant'), 'Enzo');
    await fireEvent.changeText(screen.getByTestId('connexion-id-mdp'), 'mon mot de passe');
    await fireEvent.press(screen.getByTestId('connexion-id-valider'));
    expect(options.onConnexion).toHaveBeenCalledWith('Enzo', 'mon mot de passe');

    await fireEvent.press(screen.getByTestId('accueil-creer'));
    expect(onCreer).not.toHaveBeenCalled();
    expect(screen.getByTestId('accueil-avertissement')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('accueil-creer-confirmer'));
    expect(onCreer).toHaveBeenCalled();
  });

  it('chaque lettre tapée dans l’identifiant est signalée (style du compte) ; une erreur s’affiche', async () => {
    const onIdentifiant = jest.fn();
    const options = connexion({ onIdentifiant, onConnexion: jest.fn().mockRejectedValue(new Error('Identifiant ou mot de passe incorrect.')) });
    await render(<AccueilSite onCreer={jest.fn()} connexion={options} />);
    await fireEvent.changeText(screen.getByTestId('connexion-id-identifiant'), 'Lé');
    expect(onIdentifiant).toHaveBeenLastCalledWith('Lé');
    await fireEvent.changeText(screen.getByTestId('connexion-id-mdp'), 'faux');
    await fireEvent.press(screen.getByTestId('connexion-id-valider'));
    expect(await screen.findByText(/Identifiant ou mot de passe incorrect/)).toBeTruthy();
  });

  it('mot de passe oublié : identifiant, code de récupération et nouveau mot de passe (deux fois)', async () => {
    const onSecours = jest.fn().mockResolvedValue(undefined);
    await render(<AccueilSite onCreer={jest.fn()} connexion={connexion({ onSecours })} />);
    await fireEvent.press(screen.getByTestId('connexion-oubli'));
    await fireEvent.changeText(screen.getByTestId('connexion-id-identifiant'), 'Enzo');
    await fireEvent.changeText(screen.getByTestId('connexion-secours-code'), 'ABCD-EFGH-JKMN-PQRS');
    await fireEvent.changeText(screen.getByTestId('connexion-secours-mdp'), 'Une nouvelle phrase 2026');
    await fireEvent.changeText(screen.getByTestId('connexion-secours-confirmation'), 'Une nouvelle phrase 2026');
    await fireEvent.press(screen.getByTestId('connexion-secours-valider'));
    expect(onSecours).toHaveBeenCalledWith('Enzo', 'ABCD-EFGH-JKMN-PQRS', 'Une nouvelle phrase 2026');
  });
});

describe('remplacement d’un ancien coffre local', () => {
  it('ne remplace qu’après la sauvegarde (ou le choix explicite de s’en passer)', async () => {
    const onExporter = jest.fn().mockResolvedValue(true);
    const onRemplacer = jest.fn().mockResolvedValue(undefined);
    await render(<RemplacerDonnees compte="votre compte du PC" onExporter={onExporter} onRemplacer={onRemplacer} onAnnuler={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('remplacer-confirmer'));
    expect(onRemplacer).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('remplacer-exporter'));
    expect(onExporter).toHaveBeenCalled();
    expect(await screen.findByText(/Sauvegarde téléchargée/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('remplacer-confirmer'));
    expect(onRemplacer).toHaveBeenCalled();
  });

  it('sans sauvegarde : il faut le cocher', async () => {
    const onRemplacer = jest.fn().mockResolvedValue(undefined);
    await render(<RemplacerDonnees compte="votre compte" onExporter={jest.fn()} onRemplacer={onRemplacer} onAnnuler={jest.fn()} />);
    await fireEvent(screen.getByTestId('remplacer-sans-sauvegarde'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('remplacer-confirmer'));
    expect(onRemplacer).toHaveBeenCalled();
  });

  it('après un échec de déverrouillage, propose de reprendre le coffre du compte relié', async () => {
    const onLier = jest.fn().mockResolvedValue(undefined);
    const vue = await render(
      <Deverrouillage onDeverrouiller={jest.fn()} lier={{ codeConnu: 'AB1.pc', onLier }} suggererAutreCoffre />,
    );
    expect(screen.queryByTestId('suggestion-autre-coffre')).toBeNull();
    await vue.rerender(
      <Deverrouillage onDeverrouiller={jest.fn()} lier={{ codeConnu: 'AB1.pc', onLier }} suggererAutreCoffre erreur="Mot de passe ou code incorrect" />,
    );
    expect(screen.getByText(/contient peut-être un autre coffre que celui de ton PC/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reprendre-coffre'));
    await fireEvent.press(screen.getByTestId('bouton-lier-compte'));
    expect(onLier).toHaveBeenCalledWith('AB1.pc');
  });
});
