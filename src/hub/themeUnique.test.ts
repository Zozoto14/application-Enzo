import { DepotParametres } from '../db/depots';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { changerDEspace } from '../profils/espace';
import { CLE_THEME } from './personnalisation';
import {
  ANCIENS_THEMES,
  CLE_CACHE_AFFICHAGE,
  CLE_CACHE_FOND,
  CLE_CACHE_THEME,
  CLE_THEME_PORTEFEUILLE_ANCIEN,
  depuisAncienTheme,
  lireAffichageMemorise,
  lireThemeMemorise,
  memoriserAffichage,
  migrerThemeUnique,
  themeUnique,
} from './themeUnique';
import { THEMES_HUB } from './themes';
import { definirTheme, palettePour, paletteDepuisTheme, relireThemeMemorise, themeCourant } from '../ui/theme';

function baseDeTest() {
  const base = ouvrirBaseNode();
  migrer(base);
  const depot = new DepotParametres(base);
  return { depot, stockage: { lire: (c: string) => depot.lire(c), ecrire: (c: string, v: string) => depot.ecrire(c, v) } };
}

function faireStockageLocal(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return {
    valeurs,
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
  };
}

describe('un seul thème pour toute l’application', () => {
  it('traduit chacun des cinq anciens thèmes du portefeuille vers un thème du hub existant', () => {
    const ids = THEMES_HUB.map(t => t.id);
    for (const [ancien, nouveau] of Object.entries(ANCIENS_THEMES)) {
      expect(ids).toContain(nouveau);
      expect(depuisAncienTheme(ancien)).toBe(nouveau);
    }
    expect(Object.keys(ANCIENS_THEMES)).toHaveLength(5);
    expect(depuisAncienTheme('inconnu')).toBeUndefined();
    expect(depuisAncienTheme('__proto__')).toBeUndefined();
  });

  it('le thème du hub l’emporte sur l’ancien thème du portefeuille', () => {
    expect(themeUnique('terminal', 'sauge')).toBe('terminal');
    expect(themeUnique(undefined, 'sauge')).toBe('sauge');
    expect(themeUnique('n-importe-quoi', 'ivoire')).toBe('ivoire-couleur');
    expect(themeUnique(undefined, undefined)).toBe('nuit');
  });
});

describe('migration idempotente vers le thème unique', () => {
  it('le portefeuille adopte le thème du hub, sans toucher à l’ancien réglage', () => {
    const { depot, stockage } = baseDeTest();
    depot.ecrire(CLE_THEME, 'blocs');
    depot.ecrire(CLE_THEME_PORTEFEUILLE_ANCIEN, 'sauge');
    expect(migrerThemeUnique(stockage)).toEqual({ theme: 'blocs', migre: false });
    expect(depot.lire(CLE_THEME)).toBe('blocs');
  });

  it('sans thème du hub, reprend l’ancien thème du portefeuille, une seule fois', () => {
    const { depot, stockage } = baseDeTest();
    depot.ecrire(CLE_THEME_PORTEFEUILLE_ANCIEN, 'nuit-editoriale');
    expect(migrerThemeUnique(stockage)).toEqual({ theme: 'nuit-editoriale', migre: true });
    expect(depot.lire(CLE_THEME)).toBe('nuit-editoriale');
    // Rappeler la migration ne change plus rien, même si l'ancien réglage bouge ensuite
    // (un appareil pas à jour peut encore l'envoyer par la synchro).
    depot.ecrire(CLE_THEME_PORTEFEUILLE_ANCIEN, 'sauge');
    expect(migrerThemeUnique(stockage)).toEqual({ theme: 'nuit-editoriale', migre: false });
    expect(migrerThemeUnique(stockage)).toEqual({ theme: 'nuit-editoriale', migre: false });
    expect(depot.lire(CLE_THEME)).toBe('nuit-editoriale');
  });

  it('un profil sans aucun réglage reste sur Nuit et n’écrit rien', () => {
    const { depot, stockage } = baseDeTest();
    expect(migrerThemeUnique(stockage)).toEqual({ theme: 'nuit', migre: false });
    expect(depot.lire(CLE_THEME)).toBeUndefined();
  });

  it('ne lève jamais quand le stockage est illisible', () => {
    const casse = { lire: () => { throw new Error('base fermée'); }, ecrire: () => undefined };
    expect(migrerThemeUnique(casse)).toEqual({ theme: 'nuit', migre: false });
  });
});

describe('cache de démarrage : thème lu avant le déverrouillage', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    changerDEspace('principal');
    definirTheme('nuit');
  });

  it('lit de façon synchrone le dernier thème appliqué, y compris un ancien identifiant', () => {
    expect(lireThemeMemorise(faireStockageLocal({ [CLE_CACHE_THEME]: 'ivoire' }), CLE_CACHE_THEME)).toBe('ivoire');
    // Cache écrit avant la fusion : « classique » devient « nuit », « sauge » reste « sauge ».
    expect(lireThemeMemorise(faireStockageLocal({ [CLE_CACHE_THEME]: 'classique' }), CLE_CACHE_THEME)).toBe('nuit');
    expect(lireThemeMemorise(faireStockageLocal({ [CLE_CACHE_THEME]: 'sauge' }), CLE_CACHE_THEME)).toBe('sauge');
    expect(lireThemeMemorise(faireStockageLocal(), CLE_CACHE_THEME)).toBe('nuit');
    expect(lireThemeMemorise(undefined, CLE_CACHE_THEME)).toBe('nuit');
  });

  it('le thème courant est celui du cache dès le premier appel, sans rien déverrouiller', () => {
    (globalThis as { localStorage?: unknown }).localStorage = faireStockageLocal({ [CLE_CACHE_THEME]: 'ivoire' });
    relireThemeMemorise(); // démarrage à froid : rien n'est encore en mémoire
    expect(themeCourant()).toBe('ivoire');
    expect(palettePour().fond).toBe('#F6F3EC');
    expect(palettePour().sombre).toBe(false);
  });

  it('chaque profil a son thème mémorisé : l’écran de connexion d’un ami est à son thème', () => {
    (globalThis as { localStorage?: unknown }).localStorage = faireStockageLocal({
      [CLE_CACHE_THEME]: 'ivoire',
      [`${CLE_CACHE_THEME}@lea`]: 'terminal',
    });
    changerDEspace('principal');
    relireThemeMemorise();
    expect(themeCourant()).toBe('ivoire');
    changerDEspace('lea');
    expect(themeCourant()).toBe('terminal');
    changerDEspace('principal');
    expect(themeCourant()).toBe('ivoire');
  });

  it('définir un thème le mémorise (avec son fond) pour le prochain lancement', () => {
    const local = faireStockageLocal();
    (globalThis as { localStorage?: unknown }).localStorage = local;
    definirTheme('terminal');
    expect(local.valeurs.get(CLE_CACHE_THEME)).toBe('terminal');
    expect(local.valeurs.get(CLE_CACHE_FOND)).toBe('#0A0A0A');
    // Un identifiant inconnu ne casse rien : retour au thème par défaut.
    definirTheme('n-importe-quoi');
    expect(themeCourant()).toBe('nuit');
  });

  it('mémorise et relit la disposition et la densité du hub', () => {
    const local = faireStockageLocal();
    memoriserAffichage(local, CLE_CACHE_AFFICHAGE, { densite: 'compact', disposition: 'liste' });
    expect(lireAffichageMemorise(local, CLE_CACHE_AFFICHAGE)).toEqual({ densite: 'compact', disposition: 'liste' });
    expect(lireAffichageMemorise(faireStockageLocal({ [CLE_CACHE_AFFICHAGE]: '{pas du json' }), CLE_CACHE_AFFICHAGE)).toBeUndefined();
    expect(lireAffichageMemorise(undefined, CLE_CACHE_AFFICHAGE)).toBeUndefined();
  });
});

describe('palette du portefeuille déduite du thème unique', () => {
  it('reprend les couleurs du thème, et garde son identité par l’accent du portefeuille', () => {
    for (const theme of THEMES_HUB) {
      const palette = paletteDepuisTheme(theme);
      expect(palette.fond).toBe(theme.fond);
      expect(palette.surface).toBe(theme.surface);
      expect(palette.texte).toBe(theme.texte);
      expect(palette.bordure).toBe(theme.ligne);
      expect(palette.sombre).toBe(theme.sombre);
      expect(palette.series[0]).toBe(theme.teintes.portefeuille);
      expect(new Set(palette.series.map(c => c.toLowerCase())).size).toBe(palette.series.length);
      expect(palette.series.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('change avec le thème : une palette par thème du hub, toutes distinctes', () => {
    const fonds = new Set<string>();
    for (const theme of THEMES_HUB) {
      definirTheme(theme.id);
      expect(themeCourant()).toBe(theme.id);
      expect(palettePour().accent).toBe(theme.accent);
      fonds.add(`${palettePour().fond}|${palettePour().accent}|${palettePour().texteSecondaire}|${palettePour().series[0]}`);
    }
    expect(fonds.size).toBe(THEMES_HUB.length);
  });
});
