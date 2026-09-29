import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LierCompte } from './LierCompte';

describe('LierCompte', () => {
  it('avec un code déjà connu, lie d’un seul bouton', async () => {
    const onLier = jest.fn().mockResolvedValue(undefined);
    await render(<LierCompte codeConnu="AB1.abc" onLier={onLier} />);
    expect(screen.getByTestId('code-connu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bouton-lier-compte'));
    expect(onLier).toHaveBeenCalledWith('AB1.abc');
  });

  it('sinon, demande le code et affiche l’erreur du relais', async () => {
    const onLier = jest.fn().mockRejectedValue(new Error('Aucun compte sur ce relais pour l’instant'));
    await render(<LierCompte onLier={onLier} remplace />);
    expect(screen.getByText(/sera remplacé/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('champ-code-lier'), ' AB1.xyz ');
    await fireEvent.press(screen.getByTestId('bouton-lier-compte'));
    expect(onLier).toHaveBeenCalledWith('AB1.xyz');
    expect(await screen.findByText(/Aucun compte sur ce relais/)).toBeTruthy();
  });
});
