import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { IndicateurSynchro } from './IndicateurSynchro';
import { PageParametres } from './PageParametres';
import { REGLAGES, type IdReglage } from './recensement';
import { themeHub } from './themes';

const theme = themeHub('nuit');
const TOUS: IdReglage[] = REGLAGES.map(r => r.id);
const rendu = (id: IdReglage) => <Text testID={`contenu-${id}`}>contenu {id}</Text>;

function page(props: Partial<React.ComponentProps<typeof PageParametres>> = {}) {
  return (
    <PageParametres theme={theme} disponibles={TOUS} rendu={rendu} onFermer={() => undefined} {...props} />
  );
}

describe('page Paramètres', () => {
  it('montre les sections (plus de « Synchronisation » : tout est sur le serveur) et ouvre la première, Général', async () => {
    await render(page());
    expect(screen.queryByTestId('parametres-section-synchro')).toBeNull();
    for (const id of ['general', 'securite', 'portefeuille', 'administration', 'tsuzuku', 'nouveautes', 'apropos']) {
      expect(screen.getByTestId(`parametres-section-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('parametres-section-general').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('reglage-theme')).toBeTruthy();
    // Un réglage d'une autre section n'est pas affiché tant qu'on ne va pas la voir.
    expect(screen.queryByTestId('reglage-cours-intervalle')).toBeNull();
  });

  it('change de section, et s’ouvre directement sur la section demandée', async () => {
    await render(page({ section: 'securite' }));
    expect(screen.getByTestId('reglage-codes-recuperation')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('parametres-section-portefeuille'));
    expect(screen.getByTestId('reglage-cours-fournisseur')).toBeTruthy();
    expect(screen.queryByTestId('reglage-codes-recuperation')).toBeNull();
  });

  it('un changement de demande ramène la page sur la section voulue', async () => {
    const { rerender } = await render(page({ section: 'securite', n: 1 }));
    await rerender(page({ section: 'general', n: 2 }));
    // L'état de la connexion au serveur est dans Général.
    expect(screen.getByTestId('reglage-synchro-etat')).toBeTruthy();
  });

  it('ne montre ni section ni réglage qui ne sont pas disponibles pour ce compte ou cette plateforme', async () => {
    const amis = TOUS.filter(id => !['admin-panel', 'admin-reglages', 'admin-comptes', 'role-gestionnaire', 'synchro-etat', 'admin-tsuzuku-sources', 'admin-tsuzuku-cles'].includes(id));
    await render(page({ disponibles: amis }));
    expect(screen.queryByTestId('parametres-section-administration')).toBeNull();
    expect(screen.queryByTestId('parametres-section-synchro')).toBeNull();
    expect(screen.getByTestId('parametres-section-general')).toBeTruthy();
  });

  it('filtre tous les réglages par la recherche, sans accents, et regroupe par section', async () => {
    await render(page());
    await fireEvent.changeText(screen.getByTestId('parametres-recherche'), 'recuperation');
    expect(screen.getByTestId('reglage-codes-recuperation')).toBeTruthy();
    expect(screen.queryByTestId('reglage-theme')).toBeNull();
    expect(screen.getByTestId('parametres-nombre').props.children).toMatch(/2 réglages trouvés/);
    expect(screen.getByTestId('reglage-securite-coffre')).toBeTruthy();
    // Un réglage d'une autre section apparaît aussi, quelle que soit la section choisie avant.
    await fireEvent.changeText(screen.getByTestId('parametres-recherche'), 'excel');
    expect(screen.getByTestId('reglage-export-excel')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('parametres-recherche'), 'zzzzzz');
    expect(screen.getByTestId('parametres-nombre').props.children).toMatch(/Aucun réglage ne correspond/);
    await fireEvent.press(screen.getByTestId('parametres-recherche-effacer'));
    expect(screen.getByTestId('reglage-theme')).toBeTruthy();
  });

  it('ferme la page avec le bouton Retour', async () => {
    const onFermer = jest.fn();
    await render(page({ onFermer }));
    await fireEvent.press(screen.getByTestId('hub-parametres-fermer'));
    expect(onFermer).toHaveBeenCalled();
  });

  it('navigue au clavier dans les sections (flèches, Début, Fin)', async () => {
    await render(page());
    const nav = screen.getByLabelText('Sections des paramètres');
    await fireEvent(nav, 'keyDown', { key: 'ArrowDown', preventDefault: () => undefined });
    expect(screen.getByTestId('parametres-section-securite').props.accessibilityState.selected).toBe(true);
    await fireEvent(nav, 'keyDown', { key: 'End', preventDefault: () => undefined });
    expect(screen.getByTestId('parametres-section-apropos').props.accessibilityState.selected).toBe(true);
    await fireEvent(nav, 'keyDown', { key: 'ArrowDown', preventDefault: () => undefined });
    expect(screen.getByTestId('parametres-section-general').props.accessibilityState.selected).toBe(true);
    await fireEvent(nav, 'keyDown', { key: 'ArrowUp', preventDefault: () => undefined });
    expect(screen.getByTestId('parametres-section-apropos').props.accessibilityState.selected).toBe(true);
    await fireEvent(nav, 'keyDown', { key: 'Home', preventDefault: () => undefined });
    expect(screen.getByTestId('parametres-section-general').props.accessibilityState.selected).toBe(true);
  });

  it('la pastille de connexion au serveur de l’en-tête ouvre Général (état de la connexion)', async () => {
    await render(page({ section: 'securite', synchro: { vue: { enCours: false, enLigne: true }, onSynchroniser: jest.fn() } }));
    await fireEvent.press(screen.getByTestId('synchro-indicateur'));
    expect(screen.getByTestId('parametres-section-general').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('reglage-synchro-etat')).toBeTruthy();
  });
});

describe('pastille de synchro cliquable', () => {
  it('appelle onPress quand l’hôte le demande, et reste un simple texte sinon', async () => {
    const onPress = jest.fn();
    await render(<IndicateurSynchro theme={theme} synchro={{ vue: { enCours: false }, onSynchroniser: jest.fn() }} onPress={onPress} />);
    expect(screen.getByTestId('synchro-indicateur').props.accessibilityRole).toBe('button');
    await fireEvent.press(screen.getByTestId('synchro-indicateur'));
    expect(onPress).toHaveBeenCalled();
  });
});
