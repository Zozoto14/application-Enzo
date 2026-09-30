import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccueilSite, RemplacerDonnees } from './AccueilSite';
import { Deverrouillage } from '../src/ui/ecrans/Deverrouillage';

describe('premier lancement sur un navigateur', () => {
  it('propose d’abord de relier son compte ; créer un coffre ne vient qu’après un avertissement', async () => {
    const onRelier = jest.fn().mockResolvedValue(undefined);
    const onCreer = jest.fn();
    await render(<AccueilSite onRelier={onRelier} onCreer={onCreer} />);
    expect(screen.getByText(/J’ai déjà un compte \(le relier\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('champ-code-accueil'), ' AB1.abc ');
    await fireEvent.press(screen.getByTestId('bouton-relier-accueil'));
    expect(onRelier).toHaveBeenCalledWith('AB1.abc');

    await fireEvent.press(screen.getByTestId('accueil-creer'));
    expect(onCreer).not.toHaveBeenCalled();
    expect(screen.getByTestId('accueil-avertissement')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('accueil-creer-confirmer'));
    expect(onCreer).toHaveBeenCalled();
  });

  it('un lien #liaison= évite de recopier le code ; une erreur du relais s’affiche', async () => {
    const onRelier = jest.fn().mockRejectedValue(new Error('Votre compte n’est pas encore publié'));
    await render(<AccueilSite codeConnu="AB1.lien" onRelier={onRelier} onCreer={jest.fn()} />);
    expect(screen.getByTestId('accueil-code-connu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bouton-relier-accueil'));
    expect(onRelier).toHaveBeenCalledWith('AB1.lien');
    expect(await screen.findByText(/pas encore publié/)).toBeTruthy();
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
    expect(screen.getByText(/Ce navigateur contient un autre coffre/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reprendre-coffre'));
    await fireEvent.press(screen.getByTestId('bouton-lier-compte'));
    expect(onLier).toHaveBeenCalledWith('AB1.pc');
  });
});
