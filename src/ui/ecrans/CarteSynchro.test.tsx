import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CarteSynchro, imageQr } from './CarteSynchro';
import type { EtatSynchroApp } from '../../app/synchroApp';

const LIAISON = { relais: 'https://relais.exemple.workers.dev', jeton: 'jeton-0123456789abcdef', site: 'https://ab.pages.dev' };
const maintenant = new Date('2026-10-01T10:00:00Z');

const nonRelie: EtatSynchroApp = { configure: false, enCours: false, appareils: {}, moi: 'aaaa1111' };

describe('CarteSynchro', () => {
  it('relie le PC au relais installé par le script, sans code à recopier', async () => {
    const onRelier = jest.fn().mockResolvedValue(undefined);
    await render(
      <CarteSynchro synchro={nonRelie} liaisonDuPc={LIAISON} nomParDefaut="PC" onRelier={onRelier}
        onSynchroniser={jest.fn()} onDelier={jest.fn()} onOublier={jest.fn()} maintenant={maintenant} />,
    );
    expect(screen.getByTestId('relais-du-pc')).toBeTruthy();
    expect(screen.queryByTestId('champ-liaison')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('champ-mdp-synchro'), 'secret-commun');
    await fireEvent.changeText(screen.getByTestId('champ-mdp-synchro-confirmation'), 'secret-commun');
    await fireEvent.press(screen.getByTestId('bouton-relier'));
    expect(onRelier).toHaveBeenCalledWith(expect.stringMatching(/^AB1\./), 'secret-commun', 'PC');
  });

  it('sur le PC sans relais : explique comment l’installer', async () => {
    await render(
      <CarteSynchro synchro={{ ...nonRelie, plateforme: 'bureau' }} nomParDefaut="PC" onRelier={jest.fn()}
        onSynchroniser={jest.fn()} onDelier={jest.fn()} onOublier={jest.fn()} />,
    );
    expect(screen.getByTestId('relais-a-installer')).toBeTruthy();
    expect(screen.getByText(/npm run relais:deployer/)).toBeTruthy();
  });

  it('sur l’iPhone : dit où trouver le code', async () => {
    await render(
      <CarteSynchro synchro={{ ...nonRelie, plateforme: 'ios' }} nomParDefaut="iPhone" onRelier={jest.fn()}
        onSynchroniser={jest.fn()} onDelier={jest.fn()} onOublier={jest.fn()} />,
    );
    expect(screen.getByText('Où trouver le code de liaison ?')).toBeTruthy();
    expect(screen.getByText(/Relier un autre appareil/)).toBeTruthy();
  });

  it('refuse deux mots de passe différents', async () => {
    const onRelier = jest.fn();
    await render(
      <CarteSynchro synchro={nonRelie} nomParDefaut="iPhone" onRelier={onRelier}
        onSynchroniser={jest.fn()} onDelier={jest.fn()} onOublier={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByTestId('champ-liaison'), 'AB1.xxx');
    await fireEvent.changeText(screen.getByTestId('champ-mdp-synchro'), 'un');
    await fireEvent.changeText(screen.getByTestId('champ-mdp-synchro-confirmation'), 'deux');
    await fireEvent.press(screen.getByTestId('bouton-relier'));
    expect(onRelier).not.toHaveBeenCalled();
    expect(screen.getByText(/pas identiques/)).toBeTruthy();
  });

  it('montre l’iPhone, son expiration, et les QR codes de liaison', async () => {
    const relie: EtatSynchroApp = {
      configure: true,
      enCours: false,
      nom: 'PC',
      liaison: LIAISON,
      moi: 'aaaa1111',
      plateforme: 'bureau',
      derniere: '2026-10-01T09:58:00Z',
      appareils: {
        bbbb2222: { nom: 'iPhone', plateforme: 'ios', expireLe: '2026-10-02T20:00:00Z', vuLe: '2026-10-01T09:00:00Z' },
      },
    };
    const onOublier = jest.fn();
    await render(
      <CarteSynchro synchro={relie} nomParDefaut="PC" onRelier={jest.fn()}
        onSynchroniser={jest.fn()} onDelier={jest.fn()} onOublier={onOublier} maintenant={maintenant} />,
    );
    expect(screen.getByText(/il y a 2 min/)).toBeTruthy();
    expect(screen.getByText(/Expire demain/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bouton-montrer-liaison'));
    expect(screen.getByTestId('qr-app')).toBeTruthy();
    expect(screen.getByTestId('qr-site')).toBeTruthy();
    expect(screen.getByTestId('code-liaison').props.children).toMatch(/^AB1\./);
    await fireEvent.press(screen.getByTestId('oublier-bbbb2222'));
    expect(onOublier).toHaveBeenCalledWith('bbbb2222');
  });
});

describe('imageQr', () => {
  it('dessine en vectoriel sur le PC, à taille fixe', () => {
    const { uri, taille } = imageQr('https://ab.pages.dev/#liaison=AB1.xyz', true);
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(uri)).toContain('<svg');
    expect(taille).toBe(260);
  });

  it('en pixels ailleurs, à sa taille exacte pour rester net', () => {
    const { uri, taille } = imageQr('applibourse://liaison?code=AB1.xyz', false);
    expect(uri.startsWith('data:image/gif')).toBe(true);
    expect(taille % 4).toBe(0);
  });
});
