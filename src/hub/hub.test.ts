import type { Profil } from '../profils/profils';
import { appsAttribuables, appsVisibles, basculerApp, nombreUtilisateurs, peutOuvrir } from './permissions';
import {
  appliquerPrefs, basculerEpinglee, basculerMasquee, chargerPrefs, definirDensite, definirDisposition, definirTaille,
  deplacer, deplacerVers, empan, enregistrerPrefs, ecrirePrefs, lirePrefs, reinitialiser, sontParDefaut, CLE_PREFS,
} from './personnalisation';
import { REGISTRE, ID_ADMINISTRATION, ID_PORTEFEUILLE } from './registre';
import { THEMES_HUB, THEME_HUB_DEFAUT, themeHub } from './themes';
import type { AppHub, ContexteHub } from './types';

const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const ami = (apps: string[]): Profil => ({ id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps, actif: true });
const factice = (id: string, extra: Partial<AppHub> = {}): AppHub => ({ id, nom: id, categorie: 'x', description: '', icone: '*', teinte: 'quatre', ...extra });
const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];

describe('registre', () => {
  it('a des identifiants uniques et valides, avec le portefeuille et l’administration', () => {
    const ids = REGISTRE.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach(id => expect(id).toMatch(/^[a-z0-9-]{2,32}$/));
    expect(ids).toEqual(expect.arrayContaining([ID_PORTEFEUILLE, ID_ADMINISTRATION]));
    expect(REGISTRE.find(a => a.id === ID_ADMINISTRATION)?.adminSeulement).toBe(true);
  });
});

describe('permissions', () => {
  it('l’administrateur voit tout ; sans profil (appareil seul) aussi', () => {
    expect(appsVisibles(REGISTRE, { profil: admin, profils: controle }).map(a => a.id)).toEqual([ID_PORTEFEUILLE, 'tsuzuku', 'esport', ID_ADMINISTRATION, 'claude-office']);
    expect(peutOuvrir(factice('a'), undefined)).toBe(true);
  });

  it('un ami ne voit que ses apps, jamais l’administration, même retouchée', () => {
    const contexte = { profil: ami([ID_PORTEFEUILLE, ID_ADMINISTRATION]), profils: controle };
    expect(appsVisibles(REGISTRE, contexte).map(a => a.id)).toEqual([ID_PORTEFEUILLE]);
    expect(appsVisibles(REGISTRE, { profil: ami([]), profils: controle })).toEqual([]);
    // Tsuzuku : la tuile n'apparaît que si l'administrateur l'a ouverte à l'ami.
    expect(appsVisibles(REGISTRE, { profil: ami(['tsuzuku']), profils: controle }).map(a => a.id)).toEqual(['tsuzuku']);
    expect(appsVisibles(REGISTRE, { profil: ami([ID_PORTEFEUILLE]), profils: controle }).map(a => a.id)).not.toContain('tsuzuku');
  });

  it('respecte « disponible » et attribue seulement les apps non réservées', () => {
    expect(appsVisibles(REGISTRE, { profil: admin }).map(a => a.id)).toEqual([ID_PORTEFEUILLE, 'tsuzuku', 'esport', 'claude-office']);
    expect(appsAttribuables(REGISTRE).map(a => a.id)).toEqual([ID_PORTEFEUILLE, 'tsuzuku', 'taches', 'journal', 'esport']);
  });

  it('compte les utilisateurs actifs et bascule une autorisation', () => {
    const p = [admin, ami([ID_PORTEFEUILLE]), { ...ami([ID_PORTEFEUILLE]), id: 'zzzzzz9999', actif: false }];
    expect(nombreUtilisateurs(REGISTRE[0], p)).toBe(2);
    expect(basculerApp(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(basculerApp(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});

describe('personnalisation', () => {
  const apps = [factice('aa'), factice('bb'), factice('cc')];
  const ids = (p: ReturnType<typeof lirePrefs>) => appliquerPrefs(apps, p).map(t => t.app.id);

  it('retombe sur les défauts si le contenu est absent, corrompu ou retouché', () => {
    expect(sontParDefaut(lirePrefs(undefined))).toBe(true);
    expect(sontParDefaut(lirePrefs('{oups'))).toBe(true);
    expect(sontParDefaut(lirePrefs('[1]'))).toBe(true);
    const p = lirePrefs(JSON.stringify({ ordre: ['aa', 3, '../x'], tailles: { aa: 'énorme', bb: 'grande' }, densite: 'x', disposition: 'liste' }));
    expect(p).toMatchObject({ ordre: ['aa'], tailles: { bb: 'grande' }, densite: 'aere', disposition: 'liste' });
  });

  it('réordonne au clavier et par glisser-déposer', () => {
    let p = lirePrefs(undefined);
    p = deplacer(p, ['aa', 'bb', 'cc'], 'cc', -1);
    expect(ids(p)).toEqual(['aa', 'cc', 'bb']);
    p = deplacerVers(p, ['aa', 'cc', 'bb'], 'bb', 'aa');
    expect(ids(p)).toEqual(['bb', 'aa', 'cc']);
    expect(deplacer(p, ['bb', 'aa', 'cc'], 'bb', -1)).toBe(p);
  });

  it('épingle en premier, et un déplacement ne franchit pas le groupe', () => {
    let p = basculerEpinglee(lirePrefs(undefined), ['aa', 'bb', 'cc'], 'cc', true);
    expect(ids(p)).toEqual(['cc', 'aa', 'bb']);
    expect(deplacer(p, ['cc', 'aa', 'bb'], 'aa', -1)).toBe(p);
    p = basculerEpinglee(p, ['cc', 'aa', 'bb'], 'cc', false);
    expect(p.epinglees).toEqual([]);
  });

  it('taille, masquage, densité, disposition et réinitialisation', () => {
    let p = definirTaille(lirePrefs(undefined), 'aa', 'grande');
    p = basculerMasquee(p, 'bb', true);
    p = definirDisposition(definirDensite(p, 'compact'), 'liste');
    const t = appliquerPrefs(apps, p);
    expect(t[0].taille).toBe('grande');
    expect(t[1]).toMatchObject({ taille: 'moyenne', masquee: true });
    expect(sontParDefaut(p)).toBe(false);
    expect(sontParDefaut(reinitialiser())).toBe(true);
    expect(empan('grande', 3)).toBe(2);
    expect(empan('grande', 1)).toBe(1);
  });

  it('n’affiche jamais une app non autorisée, même citée dans les préférences', () => {
    const contexte = { profil: ami([ID_PORTEFEUILLE]), profils: controle };
    const p = basculerEpinglee(lirePrefs(undefined), [], ID_ADMINISTRATION, true);
    const tuiles = appliquerPrefs(appsVisibles(REGISTRE, contexte), p);
    expect(tuiles.map(t => t.app.id)).toEqual([ID_PORTEFEUILLE]);
  });

  it('mémorise via le stockage, et tolère un stockage en panne', () => {
    const m = new Map<string, string>();
    const stockage = { lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v) };
    const p = definirDensite(lirePrefs(undefined), 'compact');
    expect(enregistrerPrefs(stockage, p)).toBe(true);
    expect(m.get(CLE_PREFS)).toBe(ecrirePrefs(p));
    expect(chargerPrefs(stockage).densite).toBe('compact');
    const casse = { lire: () => { throw new Error('x'); }, ecrire: () => { throw new Error('x'); } };
    expect(chargerPrefs(casse).densite).toBe('aere');
    expect(enregistrerPrefs(casse, p)).toBe(false);
  });
});

describe('thèmes', () => {
  it('propose les 8 thèmes, Nuit par défaut, et retombe dessus si inconnu', () => {
    expect(THEMES_HUB).toHaveLength(8);
    expect(new Set(THEMES_HUB.map(t => t.id)).size).toBe(8);
    expect(themeHub(undefined).id).toBe(THEME_HUB_DEFAUT);
    expect(themeHub('nimporte').id).toBe('nuit');
    expect(THEMES_HUB.map(t => t.nom)).toEqual(expect.arrayContaining(['Nuit', 'Ivoire', 'Sauge', 'Terminal']));
  });
});
