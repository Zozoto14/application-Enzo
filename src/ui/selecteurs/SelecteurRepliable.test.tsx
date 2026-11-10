import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { SelecteurRepliable, optionsRoles, optionsSalons, resumeChoix, type OptionSelecteur } from './SelecteurRepliable';

const theme = themeHub('nuit');
const ROLES = optionsRoles([
  { id: 'r1', nom: 'Membre', couleur: null, position: 1 },
  { id: 'r2', nom: 'Staff', couleur: '#3498db', position: 9 },
  { id: 'r3', nom: 'Coach', couleur: '#e67e22', position: 5 },
  { id: 'r4', nom: 'Joueur', couleur: '#2ecc71', position: 3 },
  { id: 'r5', nom: 'Capitaine', couleur: null, position: 4 },
  { id: 'r6', nom: 'Caster', couleur: null, position: 2 },
  { id: 'r7', nom: 'Équipe A', couleur: null, position: 6 },
]);
const SALONS = [
  { id: 'c2', nom: 'Vocal', type: 'categorie', parent: null, position: 2 },
  { id: 'v3', nom: 'Squad 2', type: 'vocal', parent: 'c2', position: 1 },
  { id: 'c1', nom: 'Général', type: 'categorie', parent: null, position: 1 },
  { id: 't1', nom: 'annonces', type: 'texte', parent: 'c1', position: 1 },
  { id: 'v2', nom: 'Squad 1', type: 'vocal', parent: 'c2', position: 0 },
  { id: 'v0', nom: 'Accueil', type: 'vocal', parent: null, position: 0 },
  { id: 'v1', nom: 'Salon détente', type: 'vocal', parent: 'c1', position: 2 },
];

function Multi({ initial = [], max, surChangement }: { initial?: string[]; max?: number; surChangement?: (v: string[]) => void }) {
  const [v, setV] = useState<string[]>(initial);
  return (
    <SelecteurRepliable
      theme={theme}
      multiple
      nature="role"
      libelle="Rôles du staff"
      valeurs={v}
      options={ROLES}
      max={max}
      onChanger={x => {
        setV(x);
        surChangement?.(x);
      }}
      testID="s"
    />
  );
}

describe('SelecteurRepliable', () => {
  it('replié par défaut : résumé sur une ligne et bouton « Modifier »', async () => {
    await render(<Multi initial={['r2', 'r3', 'r4']} />);
    expect(screen.queryByTestId('s-liste')).toBeNull();
    expect(screen.queryByTestId('s-r2')).toBeNull();
    expect(screen.getByTestId('s-resume')).toHaveTextContent('3 rôles choisis : Staff, Coach, +1');
    expect(screen.getByTestId('s-modifier')).toHaveTextContent(/Modifier/);
  });

  it('« Aucun » sans choix, « Choisir » pour commencer', async () => {
    await render(<Multi />);
    expect(screen.getByTestId('s-resume')).toHaveTextContent('Aucun');
    expect(screen.getByTestId('s-modifier')).toHaveTextContent(/Choisir/);
  });

  it('déplié : rôles dans l’ordre de la hiérarchie, coche, « Tout » et « Aucun »', async () => {
    const vu = jest.fn();
    await render(<Multi surChangement={vu} />);
    await fireEvent.press(screen.getByTestId('s-modifier'));
    const ids = within(screen.getByTestId('s-liste'))
      .getAllByRole('checkbox')
      .map(e => e.props.testID);
    expect(ids).toEqual(['s-r2', 's-r7', 's-r3', 's-r5', 's-r4', 's-r6', 's-r1']);
    await fireEvent.press(screen.getByTestId('s-r3'));
    expect(vu).toHaveBeenLastCalledWith(['r3']);
    expect(screen.getByTestId('s-r3').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('s-tout'));
    expect(vu).toHaveBeenLastCalledWith(['r2', 'r7', 'r3', 'r5', 'r4', 'r6', 'r1']);
    await fireEvent.press(screen.getByTestId('s-aucun'));
    expect(vu).toHaveBeenLastCalledWith([]);
    // Replier : le résumé suit, rien n'est perdu.
    await fireEvent.press(screen.getByTestId('s-r1'));
    await fireEvent.press(screen.getByTestId('s-modifier'));
    expect(screen.queryByTestId('s-liste')).toBeNull();
    expect(screen.getByTestId('s-resume')).toHaveTextContent('1 rôle choisi : Membre');
  });

  it('recherche sans accents ni casse', async () => {
    await render(<Multi />);
    await fireEvent.press(screen.getByTestId('s-modifier'));
    await fireEvent.changeText(screen.getByTestId('s-recherche'), 'equipe');
    expect(screen.getByTestId('s-r7')).toBeTruthy();
    expect(screen.queryByTestId('s-r2')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('s-recherche'), 'zzz');
    expect(screen.getByText('Aucun résultat')).toBeTruthy();
  });

  it('plafond : au-delà de max, les autres sont grisés et « Tout » disparaît', async () => {
    await render(<Multi initial={['r1', 'r2']} max={2} />);
    await fireEvent.press(screen.getByTestId('s-modifier'));
    expect(screen.queryByTestId('s-tout')).toBeNull();
    expect(screen.getByTestId('s-r3').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('s-r1').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('choix unique : salons groupés par catégorie dans l’ordre de Discord ; choisir replie', async () => {
    const options = optionsSalons(SALONS, ['vocal']);
    expect(options.map(o => [o.id, o.groupe])).toEqual([
      ['v0', ''],
      ['v1', 'Général'],
      ['v2', 'Vocal'],
      ['v3', 'Vocal'],
    ]);
    const vu = jest.fn();
    function Unique() {
      const [v, setV] = useState<string | undefined>();
      return (
        <SelecteurRepliable
          theme={theme}
          nature="salon"
          libelle="Salon vocal du hub"
          valeur={v}
          options={options}
          onChoisir={x => {
            setV(x);
            vu(x);
          }}
          testID="u"
        />
      );
    }
    await render(<Unique />);
    await fireEvent.press(screen.getByTestId('u-modifier'));
    expect(screen.getByText('SANS CATÉGORIE')).toBeTruthy();
    expect(screen.getByText('GÉNÉRAL')).toBeTruthy();
    expect(within(screen.getByTestId('u-groupe-Vocal')).getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByTestId('u-tout')).toBeNull();
    await fireEvent.press(screen.getByTestId('u-v2'));
    expect(vu).toHaveBeenCalledWith('v2');
    expect(screen.queryByTestId('u-liste')).toBeNull();
    expect(screen.getByTestId('u-resume')).toHaveTextContent('Squad 1');
  });

  it('résumés', () => {
    expect(resumeChoix([], 'salon', 'fr')).toBe('Aucun');
    expect(resumeChoix(['#annonces'], 'salon', 'fr')).toBe('1 salon choisi : #annonces');
    expect(resumeChoix(['A', 'B'], 'categorie', 'fr')).toBe('2 catégories choisies : A, B');
    expect(resumeChoix(['A', 'B', 'C', 'D'], 'role', 'en')).toBe('4 roles selected: A, B, +2');
    const sansPosition: OptionSelecteur[] = optionsRoles([
      { id: 'b', nom: 'B' },
      { id: 'a', nom: 'A' },
    ]);
    expect(sansPosition.map(o => o.id)).toEqual(['b', 'a']);
  });
});
