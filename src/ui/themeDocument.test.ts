/**
 * Le thème posé sur le document (site et bureau) : même quand l'utilisateur n'a jamais choisi de
 * thème, les polices du thème et la couleur de la barre du navigateur doivent être posées.
 */

import { themeHub } from '../hub/themes';
import { assurerThemeDocument, definirTheme } from './theme';

function fauxDocument() {
  const proprietes = new Map<string, string>();
  const meta = { content: '#000000', setAttribute: (_n: string, v: string) => void (meta.content = v) };
  let ecritures = 0;
  return {
    proprietes,
    meta,
    ecritures: () => ecritures,
    document: {
      documentElement: {
        style: {
          setProperty: (n: string, v: string) => {
            ecritures++;
            proprietes.set(n, v);
          },
          removeProperty: (n: string) => void proprietes.delete(n),
        },
      },
      body: { style: { backgroundColor: '', colorScheme: '' } },
      querySelectorAll: (selecteur: string) => (selecteur === 'meta[name="theme-color"]' ? [meta] : []),
    },
  };
}

const global = globalThis as { document?: unknown };

afterEach(() => {
  delete global.document;
});

it('pose les polices (liste complète, avec repli) et la couleur de barre du thème par défaut, une seule fois', () => {
  const faux = fauxDocument();
  global.document = faux.document;
  const nuit = themeHub('nuit');
  assurerThemeDocument('nuit');
  expect(faux.proprietes.get('--police-texte')).toBe(nuit.policeTexte);
  // « Sora » n'est pas embarquée : le titre doit retomber sur Manrope, pas sur la police du système.
  expect(faux.proprietes.get('--police-titre')).toBe(nuit.policeTitre);
  expect(faux.proprietes.get('--police-titre')).toContain('Manrope');
  expect(faux.meta.content).toBe(nuit.fond);
  expect(faux.document.body.style.colorScheme).toBe('dark');
  const avant = faux.ecritures();
  assurerThemeDocument('nuit');
  expect(faux.ecritures()).toBe(avant);
});

it('un changement de thème met à jour la couleur de barre et le schéma de couleurs', () => {
  const faux = fauxDocument();
  global.document = faux.document;
  definirTheme('ivoire');
  expect(faux.meta.content).toBe(themeHub('ivoire').fond);
  expect(faux.document.body.style.colorScheme).toBe('light');
  expect(faux.proprietes.get('--police-titre')).toBe(themeHub('ivoire').policeTitre);
});
