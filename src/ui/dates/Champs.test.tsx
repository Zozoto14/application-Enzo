import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ChampDate, ChampDateHeure, ChampHeure, ChampPeriode, BoutonCalendrier } from './Champs';
import { definirLangueDates } from './langue';
import { formaterSaisie, type FormatDate } from './logique';

const theme = themeHub('nuit');
// Mardi 10 novembre 2026, 11 h à Paris.
const MAINTENANT = Date.parse('2026-11-10T10:00:00Z');

function Date_({ initial = '', format, min, max, desactive, surChangement }: { initial?: string; format?: FormatDate; min?: string; max?: string; desactive?: (j: string) => boolean; surChangement?: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <ChampDate
        theme={theme}
        libelle="Échéance"
        valeur={v}
        onChanger={x => {
          setV(x);
          surChangement?.(x);
        }}
        testID="d"
        format={format}
        min={min}
        max={max}
        desactive={desactive}
        fuseau="Europe/Paris"
        maintenant={MAINTENANT}
      />
    </>
  );
}

afterEach(() => definirLangueDates('fr'));

describe('ChampDate', () => {
  it('ouvre le calendrier sur le mois de la valeur, choisit un jour et ferme', async () => {
    const vu = jest.fn();
    await render(<Date_ initial="2026-12-03" surChangement={vu} />);
    expect(screen.getByTestId('d').props.value).toBe('03/12/2026');
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    expect(screen.getByTestId('d-calendrier-titre')).toHaveTextContent('décembre 2026');
    await fireEvent.press(screen.getByTestId('d-calendrier-jour-2026-12-24'));
    expect(vu).toHaveBeenLastCalledWith('2026-12-24');
    expect(screen.queryByTestId('d-bulle')).toBeNull();
    expect(screen.getByTestId('d').props.value).toBe('24/12/2026');
  });

  it('navigue de mois en mois et met aujourd’hui en évidence (fuseau du club)', async () => {
    await render(<Date_ />);
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    expect(screen.getByTestId('d-calendrier-titre')).toHaveTextContent('novembre 2026');
    await fireEvent.press(screen.getByTestId('d-calendrier-suivant'));
    expect(screen.getByTestId('d-calendrier-titre')).toHaveTextContent('décembre 2026');
    await fireEvent.press(screen.getByTestId('d-calendrier-precedent'));
    await fireEvent.press(screen.getByTestId('d-calendrier-precedent'));
    expect(screen.getByTestId('d-calendrier-titre')).toHaveTextContent('octobre 2026');
    // Semaine du lundi : la grille d'octobre 2026 commence le lundi 28 septembre.
    expect(screen.getByTestId('d-calendrier-jour-2026-09-28')).toBeTruthy();
    expect(screen.queryByTestId('d-calendrier-jour-2026-09-27')).toBeNull();
  });

  it.each([
    ['raccourci-aujourdhui', '2026-11-10'],
    ['raccourci-demain', '2026-11-11'],
    ['raccourci-lundi', '2026-11-16'],
    ['raccourci-semaine', '2026-11-17'],
  ])('raccourci %s', async (id, attendu) => {
    const vu = jest.fn();
    await render(<Date_ surChangement={vu} />);
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    await fireEvent.press(screen.getByTestId(`d-${id}`));
    expect(vu).toHaveBeenLastCalledWith(attendu);
  });

  it('« +1 semaine » part du jour déjà choisi ; « Effacer » vide le champ', async () => {
    const vu = jest.fn();
    await render(<Date_ initial="2026-12-01" surChangement={vu} />);
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    await fireEvent.press(screen.getByTestId('d-raccourci-semaine'));
    expect(vu).toHaveBeenLastCalledWith('2026-12-08');
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    await fireEvent.press(screen.getByTestId('d-effacer'));
    expect(vu).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('d').props.value).toBe('');
  });

  it.each([
    ['9/11', '2026-11-09'],
    ['9 nov', '2026-11-09'],
    ['09/11/2026', '2026-11-09'],
    ['2026-11-09', '2026-11-09'],
    ['demain', '2026-11-11'],
  ])('saisie « %s »', async (texte, attendu) => {
    const vu = jest.fn();
    await render(<Date_ surChangement={vu} />);
    await fireEvent.changeText(screen.getByTestId('d'), texte);
    expect(vu).toHaveBeenLastCalledWith(attendu);
    await fireEvent(screen.getByTestId('d'), 'blur');
    expect(screen.getByTestId('d').props.value).toBe(formaterSaisie(attendu));
  });

  it('format JJ/MM/AAAA conservé pour les écrans qui l’utilisent', async () => {
    const vu = jest.fn();
    await render(<Date_ format="fr" initial="19/10/2026" surChangement={vu} />);
    await fireEvent.changeText(screen.getByTestId('d'), '2026-10-20');
    expect(vu).toHaveBeenLastCalledWith('20/10/2026');
  });

  it('texte illisible : transmis tel quel (validation de l’écran) et signalé à la sortie du champ', async () => {
    const vu = jest.fn();
    await render(<Date_ surChangement={vu} />);
    await fireEvent.changeText(screen.getByTestId('d'), '31/02');
    expect(vu).toHaveBeenLastCalledWith('31/02');
    expect(screen.queryByTestId('d-erreur')).toBeNull();
    await fireEvent(screen.getByTestId('d'), 'blur');
    expect(screen.getByTestId('d-erreur')).toHaveTextContent(/Date illisible/);
  });

  it('bornes min/max et jours désactivés : non choisissables', async () => {
    const vu = jest.fn();
    await render(<Date_ min="2026-11-05" max="2026-11-20" desactive={j => j === '2026-11-12'} surChangement={vu} />);
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    expect(screen.getByTestId('d-calendrier-jour-2026-11-04').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('d-calendrier-jour-2026-11-12').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('d-calendrier-jour-2026-11-21').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('d-calendrier-jour-2026-11-04'));
    expect(vu).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('d-calendrier-jour-2026-11-05'));
    expect(vu).toHaveBeenLastCalledWith('2026-11-05');
    await fireEvent.changeText(screen.getByTestId('d'), '25/11/2026');
    await fireEvent(screen.getByTestId('d'), 'blur');
    expect(screen.getByTestId('d-erreur')).toHaveTextContent(/hors des limites/);
  });

  it('la valeur changée par l’écran réécrit le champ', async () => {
    function Externe() {
      const [v, setV] = useState('2026-11-09');
      return (
        <>
          <ChampDate theme={theme} libelle="Date" valeur={v} onChanger={setV} testID="d" maintenant={MAINTENANT} />
          <BoutonCalendrier theme={theme} libelle="Autre" onChoisir={setV} testID="b" />
        </>
      );
    }
    await render(<Externe />);
    await fireEvent.press(screen.getByTestId('b'));
    await fireEvent.press(screen.getByTestId('b-calendrier-jour-2026-11-26'));
    expect(screen.getByTestId('d').props.value).toBe('26/11/2026');
  });

  it('suit la langue de l’app (anglais)', async () => {
    await act(async () => definirLangueDates('en'));
    await render(<Date_ />);
    await fireEvent.press(screen.getByTestId('d-ouvrir'));
    expect(screen.getByTestId('d-calendrier-titre')).toHaveTextContent('November 2026');
    expect(screen.getByTestId('d-raccourci-lundi')).toHaveTextContent('Next Monday');
    expect(screen.getByTestId('d-calendrier-jour-2026-11-09').props.accessibilityLabel).toBe('Monday 9 November 2026');
  });
});

describe('ChampHeure', () => {
  function Heure({ surChangement }: { surChangement: (v: string) => void }) {
    const [v, setV] = useState('');
    return (
      <ChampHeure
        theme={theme}
        libelle="Début"
        valeur={v}
        pas={5}
        onChanger={x => {
          setV(x);
          surChangement(x);
        }}
        testID="h"
      />
    );
  }

  it('saisie libre (18h30, 1830) et choix au panneau (heure puis minutes)', async () => {
    const vu = jest.fn();
    await render(<Heure surChangement={vu} />);
    await fireEvent.changeText(screen.getByTestId('h'), '18h30');
    expect(vu).toHaveBeenLastCalledWith('18:30');
    await fireEvent.changeText(screen.getByTestId('h'), '0945');
    expect(vu).toHaveBeenLastCalledWith('09:45');
    await fireEvent.press(screen.getByTestId('h-ouvrir'));
    await fireEvent.press(screen.getByTestId('h-panneau-h-20'));
    expect(vu).toHaveBeenLastCalledWith('20:45');
    expect(screen.getByTestId('h-bulle')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('h-panneau-m-05'));
    expect(vu).toHaveBeenLastCalledWith('20:05');
    expect(screen.queryByTestId('h-bulle')).toBeNull();
    await fireEvent.press(screen.getByTestId('h-ouvrir'));
    await fireEvent.press(screen.getByTestId('h-panneau-raccourci-21:00'));
    expect(vu).toHaveBeenLastCalledWith('21:00');
  });

  it('heure illisible signalée', async () => {
    await render(<Heure surChangement={() => undefined} />);
    await fireEvent.changeText(screen.getByTestId('h'), '25:00');
    await fireEvent(screen.getByTestId('h'), 'blur');
    expect(screen.getByTestId('h-erreur')).toHaveTextContent(/Heure illisible/);
  });
});

describe('ChampDateHeure', () => {
  it('instant mural « AAAA-MM-JJ HH:MM » : saisie, calendrier et heure dans la même bulle', async () => {
    const vu = jest.fn();
    function Instant() {
      const [v, setV] = useState('');
      return (
        <ChampDateHeure
          theme={theme}
          libelle="Publier le"
          valeur={v}
          onChanger={x => {
            setV(x);
            vu(x);
          }}
          testID="i"
          maintenant={MAINTENANT}
          fuseau="Europe/Paris"
        />
      );
    }
    await render(<Instant />);
    await fireEvent.changeText(screen.getByTestId('i'), '2026-10-31 18:00');
    expect(vu).toHaveBeenLastCalledWith('2026-10-31 18:00');
    await fireEvent.changeText(screen.getByTestId('i'), '9/11 à 14h30');
    expect(vu).toHaveBeenLastCalledWith('2026-11-09 14:30');
    await fireEvent.press(screen.getByTestId('i-ouvrir'));
    await fireEvent.press(screen.getByTestId('i-calendrier-jour-2026-11-20'));
    expect(vu).toHaveBeenLastCalledWith('2026-11-20 14:30');
    await fireEvent.press(screen.getByTestId('i-panneau-raccourci-20:00'));
    expect(vu).toHaveBeenLastCalledWith('2026-11-20 20:00');
    expect(screen.getByTestId('i').props.value).toBe('20/11/2026 20:00');
  });
});

describe('ChampPeriode', () => {
  it('lie le début et la fin, met la période en évidence et propose des périodes toutes faites', async () => {
    const vus: Array<[string, string]> = [];
    function Periode() {
      const [du, setDu] = useState('2026-11-02');
      const [au, setAu] = useState('');
      vus.push([du, au]);
      return <ChampPeriode theme={theme} du={du} au={au} onDu={setDu} onAu={setAu} testIDDu="du" testIDAu="au" maintenant={MAINTENANT} fuseau="Europe/Paris" />;
    }
    await render(<Periode />);
    await fireEvent.press(screen.getByTestId('au-ouvrir'));
    // Le jour de fin ne peut précéder le début.
    expect(screen.getByTestId('au-calendrier-jour-2026-11-01').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('au-calendrier-jour-2026-11-06'));
    expect(vus.at(-1)).toEqual(['2026-11-02', '2026-11-06']);
    await fireEvent.press(screen.getByTestId('du-ouvrir'));
    expect(screen.getByTestId('du-calendrier-jour-2026-11-07').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('du-action-mois-precedent'));
    expect(vus.at(-1)).toEqual(['2026-10-01', '2026-10-31']);
    expect(screen.getByTestId('du').props.value).toBe('01/10/2026');
    expect(screen.getByTestId('au').props.value).toBe('31/10/2026');
  });
});
