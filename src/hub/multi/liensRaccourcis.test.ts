import type { Profil } from '../../profils/profils';
import type { AppHub, ContexteHub } from '../types';
import { aSousRoute, adresseProfonde, decisionLienProfond, effacerLienProfond, fragmentApp, lireLienProfond } from './liensProfonds';
import { actionOnglet, enSaisie } from './raccourcis';

const app = (id: string, options: Partial<AppHub> = {}): AppHub => ({ id, nom: id[0].toUpperCase() + id.slice(1), categorie: 'Test', description: '', icone: '•', teinte: 'quatre', ...options });
const REGISTRE: AppHub[] = [
  app('portefeuille'),
  app('taches'),
  app('administration', { adminSeulement: true, gestionnaire: true, page: 'administration' }),
  app('abonnements', { adminSeulement: true, rangs: ['fondateur'], page: 'administration' }),
];
const ami = (apps: string[]): Profil => ({ id: 'abcdef1234', nom: 'Léa', admin: false, creeLe: '', apps, actif: true }) as Profil;

describe('liens profonds #/app/<id>', () => {
  it('lit l’app désignée, et rien d’autre', () => {
    expect(lireLienProfond('#/app/taches')).toBe('taches');
    expect(lireLienProfond('#/app/taches/')).toBe('taches');
    expect(lireLienProfond('#/app/taches?onglet=semaine')).toBe('taches');
    expect(lireLienProfond('#/app/TACHES')).toBe('taches');
    expect(lireLienProfond('#/app/claude-office')).toBe('claude-office');
    expect(lireLienProfond('#/app/../admin')).toBeUndefined();
    expect(lireLienProfond('#/app/%E0%A4%A')).toBeUndefined();
    expect(lireLienProfond('#liaison=AB1.xyz')).toBeUndefined();
    expect(lireLienProfond('')).toBeUndefined();
    expect(lireLienProfond(undefined)).toBeUndefined();
  });

  it('fabrique l’adresse d’une app à partir de l’adresse courante', () => {
    expect(fragmentApp('taches')).toBe('#/app/taches');
    expect(adresseProfonde('https://site.exemple/', 'taches')).toBe('https://site.exemple/#/app/taches');
    expect(adresseProfonde('https://site.exemple/#liaison=AB1.x', 'tsuzuku')).toBe('https://site.exemple/#/app/tsuzuku');
  });

  it('le lien ne donne aucun droit : un ami ne peut pas ouvrir une app interdite', () => {
    const contexte: ContexteHub = { profil: ami(['taches']) };
    expect(decisionLienProfond('taches', REGISTRE, contexte).genre).toBe('ouvrir');
    const interdite = decisionLienProfond('portefeuille', REGISTRE, contexte);
    expect(interdite).toMatchObject({ genre: 'refuse', motif: 'interdite' });
    const reservee = decisionLienProfond('administration', REGISTRE, contexte);
    expect(reservee).toMatchObject({ genre: 'refuse', motif: 'interdite' });
    // Une app inconnue et une app interdite disent la même chose : le lien n'apprend rien.
    const inconnue = decisionLienProfond('inconnue', REGISTRE, contexte);
    expect(inconnue).toMatchObject({ genre: 'refuse', motif: 'inconnue' });
    expect(inconnue.genre === 'refuse' && reservee.genre === 'refuse' && inconnue.message === reservee.message).toBe(true);
  });

  it('droits par rang : l’Administration s’ouvre à un gestionnaire, pas les Abonnements', () => {
    const gestionnaire: ContexteHub = { profil: { ...ami([]), role: 'gestionnaire' } as Profil };
    expect(decisionLienProfond('administration', REGISTRE, gestionnaire).genre).toBe('ouvrir');
    expect(decisionLienProfond('abonnements', REGISTRE, gestionnaire).genre).toBe('refuse');
    const fondateur: ContexteHub = {};
    expect(decisionLienProfond('abonnements', REGISTRE, fondateur).genre).toBe('ouvrir');
  });

  it('une app en maintenance ne s’ouvre pas pour un ami, même par lien', () => {
    const politique = { version: 1, apps: { taches: { active: true, defaut: 'complet' as const, maintenance: 'Mise à jour' } } };
    const contexte: ContexteHub = { profil: ami(['taches']), profils: { politique } as unknown as ContexteHub['profils'] };
    expect(decisionLienProfond('taches', REGISTRE, contexte)).toMatchObject({ genre: 'refuse', motif: 'maintenance' });
  });
});

describe('liens profonds vers un écran dans l’app (#/app/<id>/…)', () => {
  it('l’app est ouverte, et l’adresse de l’écran est gardée (rechargement au même endroit)', () => {
    expect(lireLienProfond('#/app/esport/c/ticket?ticket=t1')).toBe('esport');
    expect(aSousRoute('#/app/esport/c/ticket?ticket=t1')).toBe(true);
    expect(aSousRoute('#/app/esport')).toBe(false);
    expect(aSousRoute('#/app/esport?x')).toBe(false);
    const g = globalThis as unknown as { location?: unknown; history?: unknown };
    const avant = { location: g.location, history: g.history };
    const remplacements: string[] = [];
    try {
      g.history = { replaceState: (_e: unknown, _t: string, url: string) => remplacements.push(url) };
      g.location = { hash: '#/app/esport/c/ticket?ticket=t1', href: 'https://site.fr/#/app/esport/c/ticket?ticket=t1' };
      effacerLienProfond();
      expect(remplacements).toEqual([]);
      g.location = { hash: '#/app/esport', href: 'https://site.fr/#/app/esport' };
      effacerLienProfond();
      expect(remplacements).toEqual(['https://site.fr/']);
    } finally {
      g.location = avant.location;
      g.history = avant.history;
    }
  });
});

describe('raccourcis des onglets', () => {
  const touche = (key: string, options: Record<string, unknown> = {}) => ({ key, ctrlKey: true, ...options });
  it('Ctrl+Tab, Ctrl+Maj+Tab, Ctrl+W, Ctrl+1…9 (et ⌘ sur Mac)', () => {
    expect(actionOnglet(touche('Tab'))).toEqual({ genre: 'voisin', sens: 1 });
    expect(actionOnglet(touche('Tab', { shiftKey: true }))).toEqual({ genre: 'voisin', sens: -1 });
    expect(actionOnglet(touche('w'))).toEqual({ genre: 'fermer' });
    expect(actionOnglet(touche('3'))).toEqual({ genre: 'rang', rang: 3 });
    expect(actionOnglet({ key: '&', code: 'Digit1', ctrlKey: true })).toEqual({ genre: 'rang', rang: 1 });
    expect(actionOnglet({ key: '9', metaKey: true })).toEqual({ genre: 'rang', rang: 9 });
  });

  it('rien sans Ctrl, avec Alt, ou pour une autre touche', () => {
    expect(actionOnglet({ key: 'Tab' })).toBeUndefined();
    expect(actionOnglet(touche('w', { altKey: true }))).toBeUndefined();
    expect(actionOnglet(touche('0'))).toBeUndefined();
    expect(actionOnglet(touche('W', { shiftKey: true }))).toBeUndefined();
  });

  it('jamais pendant la saisie', () => {
    const champ = { tagName: 'INPUT' };
    expect(enSaisie(champ)).toBe(true);
    expect(enSaisie({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(enSaisie({ tagName: 'DIV', getAttribute: () => 'textbox' })).toBe(true);
    expect(enSaisie({ tagName: 'DIV', getAttribute: () => null })).toBe(false);
    expect(actionOnglet(touche('Tab', { target: champ }))).toBeUndefined();
    expect(actionOnglet(touche('w', { target: { tagName: 'TEXTAREA' } }))).toBeUndefined();
  });
});
