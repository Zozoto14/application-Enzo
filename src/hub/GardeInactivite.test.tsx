import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GardeInactivite, utiliserLectureEnCours } from './GardeInactivite';
import { themeHub } from './themes';

const theme = themeHub('nuit');
const MIN = 60_000;

function fausseCible() {
  const ecouteurs = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, f: () => void) => void (ecouteurs.get(type) ?? ecouteurs.set(type, new Set()).get(type)!).add(f),
    removeEventListener: (type: string, f: () => void) => void ecouteurs.get(type)?.delete(f),
    emettre: (type: string) => ecouteurs.get(type)?.forEach(f => f()),
    nombre: () => [...ecouteurs.values()].reduce((n, s) => n + s.size, 0),
  };
}

function Lecteur({ actif }: { actif: boolean }) {
  utiliserLectureEnCours(actif);
  return <Text>lecteur</Text>;
}

let maintenant = 1_000_000;
const horloge = () => maintenant;
const avancer = async (ms: number, pas = 1000) => {
  for (let t = 0; t < ms; t += pas) {
    maintenant += Math.min(pas, ms - t);
    await act(async () => {
      jest.advanceTimersByTime(Math.min(pas, ms - t));
    });
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  maintenant = 1_000_000;
});
afterEach(() => jest.useRealTimers());

describe('GardeInactivite', () => {
  it('verrouille à l’échéance, sans dialogue hors lecture', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    await render(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible}>
        <Text>contenu</Text>
      </GardeInactivite>,
    );
    await avancer(59_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
    await avancer(2000);
    expect(onVerrouiller).toHaveBeenCalledWith('inactivite');
    expect(screen.queryByTestId('presence-dialogue')).toBeNull();
  });

  it('un vrai événement (souris, clavier, toucher…) repousse l’échéance', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    await render(<GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible} />);
    await avancer(50_000);
    await act(async () => cible.emettre('mousemove'));
    await avancer(50_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
    await act(async () => cible.emettre('keydown'));
    await avancer(50_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
    await avancer(20_000);
    expect(onVerrouiller).toHaveBeenCalledTimes(1);
  });

  it('ne mesure rien (aucun écouteur) quand l’application est verrouillée, et jamais avec « Jamais »', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    const { rerender } = await render(<GardeInactivite theme={theme} actif={false} delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible} />);
    expect(cible.nombre()).toBe(0);
    await avancer(5 * MIN, 10_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
    await rerender(<GardeInactivite theme={theme} actif delaiMinutes={0} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible} />);
    await avancer(200 * MIN, 60_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
  });

  it('survit à la mise en veille : l’horloge saute, l’application se verrouille à la reprise', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    await render(<GardeInactivite theme={theme} actif delaiMinutes={45} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible} />);
    await avancer(5_000);
    maintenant += 3 * 60 * MIN; // la machine dort 3 h : aucune minuterie n'a tourné
    // La reprise arrive par un geste : il ne doit pas faire oublier le délai dépassé.
    await act(async () => cible.emettre('mousemove'));
    expect(onVerrouiller).toHaveBeenCalledWith('veille');
  });

  it('pendant une lecture : dialogue « Êtes-vous toujours là ? », « Je suis là » le ferme', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    await render(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible}>
        <Lecteur actif />
      </GardeInactivite>,
    );
    await avancer(61_000);
    expect(screen.getByTestId('presence-dialogue')).toBeTruthy();
    expect(screen.getByText('Êtes-vous toujours là ?')).toBeTruthy();
    expect(screen.getByTestId('presence-compte').props.children.join('')).toContain('Verrouillage dans');
    expect(onVerrouiller).not.toHaveBeenCalled();
    await avancer(20_000);
    await fireEvent.press(screen.getByTestId('presence-suis-la'));
    expect(screen.queryByTestId('presence-dialogue')).toBeNull();
    await avancer(50_000);
    expect(onVerrouiller).not.toHaveBeenCalled();
  });

  it('sans réponse au dialogue : verrouillage après 60 s ; « Verrouiller maintenant » verrouille tout de suite', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    await render(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible}>
        <Lecteur actif />
      </GardeInactivite>,
    );
    await avancer(61_000);
    expect(screen.getByTestId('presence-dialogue')).toBeTruthy();
    await avancer(61_000);
    expect(onVerrouiller).toHaveBeenCalledWith('presence');
    expect(screen.queryByTestId('presence-dialogue')).toBeNull();
  });

  it('« Verrouiller maintenant » du dialogue', async () => {
    const onVerrouiller = jest.fn();
    await render(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={fausseCible()}>
        <Lecteur actif />
      </GardeInactivite>,
    );
    await avancer(61_000);
    await fireEvent.press(screen.getByTestId('presence-verrouiller'));
    expect(onVerrouiller).toHaveBeenCalledWith('manuel');
  });

  it('un lecteur arrêté (ou démonté) ne retient plus le verrouillage', async () => {
    const onVerrouiller = jest.fn();
    const cible = fausseCible();
    const { rerender } = await render(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible}>
        <Lecteur actif />
      </GardeInactivite>,
    );
    await rerender(
      <GardeInactivite theme={theme} actif delaiMinutes={1} onVerrouiller={onVerrouiller} horloge={horloge} cible={cible}>
        <Lecteur actif={false} />
      </GardeInactivite>,
    );
    await avancer(62_000);
    expect(onVerrouiller).toHaveBeenCalledWith('inactivite');
    expect(screen.queryByTestId('presence-dialogue')).toBeNull();
  });
});
