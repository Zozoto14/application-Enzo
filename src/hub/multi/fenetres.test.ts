import { HoteFenetres, bornesAnnexe, lireNomAnnexe, nomAnnexe, pageAnnexe, sessionPourAnnexe } from './fenetres';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const configuration = () => ({ session: { nom: 'session-ouverte' }, profils: () => ({ actuel: { id: 'principal' } }), verrouiller: jest.fn() });
const fausseFenetre = () => ({ closed: false, close: jest.fn(function (this: { closed: boolean }) { this.closed = true; }), focus: jest.fn() });

describe('fenêtres annexes : nom réservé', () => {
  it('nom fabriqué et relu ; tout autre nom refusé', () => {
    const nom = nomAnnexe('claude-office', 'abcdefghij12');
    expect(lireNomAnnexe(nom)).toEqual({ app: 'claude-office', jeton: 'abcdefghij12' });
    expect(lireNomAnnexe('appdashboard-annexe-taches')).toBeUndefined();
    expect(lireNomAnnexe('autre-fenetre')).toBeUndefined();
    expect(lireNomAnnexe(undefined)).toBeUndefined();
  });
});

describe('hôte des annexes (fenêtre principale)', () => {
  it('une annexe se rattache UNE fois, et seulement session ouverte', () => {
    const hote = new HoteFenetres();
    const nom = hote.preparer('taches', 'jeton0123456');
    expect(hote.rattacher(nom)).toBeUndefined(); // verrouillé : rien
    hote.configurer(configuration());
    const contexte = hote.rattacher(nom);
    expect(contexte?.app).toBe('taches');
    expect(contexte?.session).toEqual({ nom: 'session-ouverte' });
    expect(hote.rattacher(nom)).toBeUndefined(); // jeton déjà utilisé
    expect(hote.rattacher(nomAnnexe('taches', 'inconnu12345'))).toBeUndefined(); // jamais préparé
  });

  it('verrouiller ferme toutes les annexes', () => {
    const hote = new HoteFenetres();
    hote.configurer(configuration());
    const fenetre = fausseFenetre();
    const nom = hote.preparer('taches', 'jeton0123456');
    hote.ouverte(nom, fenetre);
    expect(hote.appsEnAnnexe()).toEqual(['taches']);
    hote.configurer(undefined);
    expect(fenetre.close).toHaveBeenCalled();
    expect(hote.appsEnAnnexe()).toEqual([]);
  });

  it('une app déjà dans une annexe : sa fenêtre passe au premier plan', () => {
    const hote = new HoteFenetres();
    hote.configurer(configuration());
    const fenetre = fausseFenetre();
    hote.ouverte(hote.preparer('tsuzuku', 'jeton0123456'), fenetre);
    expect(hote.montrer('tsuzuku')).toBe(true);
    expect(fenetre.focus).toHaveBeenCalled();
    expect(hote.montrer('taches')).toBe(false);
  });

  it('une fenêtre refusée par le système est oubliée ; une fenêtre fermée à la croix aussi', () => {
    const hote = new HoteFenetres();
    hote.configurer(configuration());
    hote.ouverte(hote.preparer('taches', 'jeton0123456'), null);
    expect(hote.appsEnAnnexe()).toEqual([]);
    const fenetre = fausseFenetre();
    hote.ouverte(hote.preparer('taches', 'jeton6543210'), fenetre);
    fenetre.closed = true;
    jest.advanceTimersByTime(2100);
    expect(hote.appsEnAnnexe()).toEqual([]);
  });

  it('chaque écriture fait relire les AUTRES fenêtres (jamais celle qui a écrit)', () => {
    const hote = new HoteFenetres();
    hote.configurer(configuration());
    const principal = jest.fn();
    hote.ecouterPrincipal(principal);
    const a = hote.rattacher(hote.preparer('taches', 'jetonaaaaaaa'))!;
    const b = hote.rattacher(hote.preparer('tsuzuku', 'jetonbbbbbbb'))!;
    const relireA = jest.fn();
    const relireB = jest.fn();
    a.ecouter(relireA);
    b.ecouter(relireB);

    // Écriture de l'annexe A : la principale et B relisent, pas A.
    a.ecrire(() => hote.ecritureLocale());
    jest.advanceTimersByTime(300);
    expect(principal).toHaveBeenCalledTimes(1);
    expect(relireB).toHaveBeenCalledTimes(1);
    expect(relireA).not.toHaveBeenCalled();

    // Écriture de la fenêtre principale : les annexes relisent, pas elle.
    hote.ecritureLocale();
    jest.advanceTimersByTime(300);
    expect(principal).toHaveBeenCalledTimes(1);
    expect(relireA).toHaveBeenCalledTimes(1);
    expect(relireB).toHaveBeenCalledTimes(2);
  });

  it('activité et lectures des annexes comptent pour le verrouillage unique ; verrouiller passe par la principale', () => {
    const config = configuration();
    const hote = new HoteFenetres();
    hote.configurer(config);
    const activite = jest.fn();
    hote.ecouterActivite(activite);
    const annexe = hote.rattacher(hote.preparer('tsuzuku', 'jeton0123456'))!;
    annexe.activite();
    expect(activite).toHaveBeenCalledTimes(1);
    annexe.lecture(true);
    expect(hote.lectures()).toBe(1);
    annexe.lecture(false);
    annexe.lecture(false);
    expect(hote.lectures()).toBe(0);
    annexe.verrouiller();
    expect(config.verrouiller).toHaveBeenCalled();
  });
});

describe('page et place de l’annexe', () => {
  it('reprend les styles et les modules de la page, rien d’autre', () => {
    const element = (tagName: string, outerHTML: string, attributs: Record<string, string> = {}, id?: string) => ({
      tagName,
      id,
      outerHTML,
      getAttribute: (n: string) => attributs[n] ?? null,
    });
    const page = pageAnnexe(
      {
        baseURI: 'file:///C:/AppDashboard/dist/index.html#/app/x',
        head: {
          children: [
            element('META', '<meta charset="utf-8">'),
            element('TITLE', '<title>AppDashboard</title>'),
            element('STYLE', '<style>html{}</style>'),
            element('STYLE', '<style id="react-native-stylesheet"></style>', {}, 'react-native-stylesheet'),
            element('LINK', '<link rel="stylesheet" href="./assets/a.css">', { rel: 'stylesheet' }),
            element('LINK', '<link rel="manifest" href="./m.json">', { rel: 'manifest' }),
            element('SCRIPT', '<script>alert(1)</script>'),
            element('SCRIPT', '<script type="module" src="./assets/index.js"></script>', { type: 'module' }),
          ],
        },
        querySelectorAll: () => [],
      },
      'Tâches <b>',
    );
    expect(page).toContain('<base href="file:///C:/AppDashboard/dist/index.html">');
    expect(page).toContain('<title>Tâches &lt;b> · AppDashboard</title>');
    expect(page).toContain('./assets/a.css');
    expect(page).toContain('./assets/index.js');
    expect(page).toContain('<div id="racine"></div>');
    expect(page).not.toContain('alert(1)');
    expect(page).not.toContain('manifest');
    expect(page).not.toContain('react-native-stylesheet');
  });

  it('taille et place : la dernière connue, toujours dans l’écran', () => {
    const ecran = { availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 };
    expect(bornesAnnexe(undefined, ecran)).toEqual({ x: 360, y: 90, largeur: 1200, hauteur: 860 });
    expect(bornesAnnexe({ x: 5000, y: -300, largeur: 300, hauteur: 9000 }, ecran)).toEqual({ x: 1760, y: 0, largeur: 720, hauteur: 1040 });
    // Deuxième annexe sans place connue : décalée, pour ne pas cacher la première.
    expect(bornesAnnexe(undefined, ecran, 1).x).toBe(392);
  });
});

describe('session vue de l’annexe', () => {
  it('écritures signées par l’annexe, base jamais fermée d’ici, verrouillage par la principale', () => {
    const executer = jest.fn((_sql: string, _parametres?: readonly unknown[]) => undefined);
    const fermer = jest.fn();
    const pilote = { executer, lire: jest.fn((_sql: string) => [{ a: 1 }]), transaction: <T,>(action: () => T) => action(), fermer };
    class FausseSession {
      private interne = 'ouverte';
      base() {
        return pilote;
      }
      statut() {
        return this.interne;
      }
      verrouiller() {
        this.interne = 'verrouillee';
      }
    }
    const session = new FausseSession();
    let ecritures = 0;
    const ecrire = <T,>(action: () => T): T => {
      ecritures++;
      return action();
    };
    const verrouiller = jest.fn();
    const vue = sessionPourAnnexe(session, { ecrire, verrouiller });
    expect(vue.statut()).toBe('ouverte');
    vue.base().executer('UPDATE x SET y = 1');
    expect(ecritures).toBe(1);
    expect(executer).toHaveBeenCalledWith('UPDATE x SET y = 1', undefined);
    expect(vue.base().lire('SELECT 1')).toEqual([{ a: 1 }]);
    expect(ecritures).toBe(1);
    vue.base().transaction(() => 3);
    expect(ecritures).toBe(2);
    vue.base().fermer();
    expect(fermer).not.toHaveBeenCalled();
    vue.verrouiller();
    expect(verrouiller).toHaveBeenCalled();
    expect(session.statut()).toBe('ouverte');
  });
});
