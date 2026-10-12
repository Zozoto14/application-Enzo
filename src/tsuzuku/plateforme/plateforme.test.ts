import { DepotBibliotheque } from '../moteur/bibliotheque';
import { ErreurMoteur } from '../moteur/erreurs';
import { creerClient, type RequeteReseau } from '../moteur/reseau';
import { choisirReseau } from './reseau';
import { pontElectron, reseauElectron, type PontTsuzuku } from './reseauElectron';
import { reseauNatif } from './reseauNatif';
import { HOTES_CATALOGUE, MESSAGE_SITE, reseauWeb } from './reseauWeb';
import { CLES, stockageDepuisBase, type BasePrefs } from './stockage';

const requete = (url: string, plus: Partial<RequeteReseau> = {}): RequeteReseau => ({ url, methode: 'GET', entetes: {}, delaiMs: 5000, tailleMax: 1_000_000, ...plus });

describe('adaptateur Electron (IPC simulé)', () => {
  it('transmet la requête telle quelle au pont et rend statut, en-têtes et corps', async () => {
    const vues: RequeteReseau[] = [];
    const pont: PontTsuzuku = {
      requete: async r => {
        vues.push(r);
        return { statut: 200, entetes: { 'content-type': 'application/json' }, corps: '{"ok":true}' };
      },
    };
    const reseau = reseauElectron(pont);
    const r = await reseau.requete(requete('https://api.jikan.moe/v4/anime/1'));
    expect(r).toEqual({ statut: 200, entetes: { 'content-type': 'application/json' }, corps: '{"ok":true}' });
    expect(vues[0].url).toBe('https://api.jikan.moe/v4/anime/1');
    expect(vues[0].methode).toBe('GET');
    // Le contrat : ni cookie ni identifiant n'est ajouté par l'adaptateur.
    expect(Object.keys(vues[0].entetes)).toEqual([]);
  });

  it('le moteur passe par ce pont, redirections comprises (chaque saut re-vérifié)', async () => {
    const urls: string[] = [];
    const pont: PontTsuzuku = {
      requete: async r => {
        urls.push(r.url);
        const entetes: Record<string, string> = r.url.includes('depart') ? { location: 'http://192.168.1.1/admin' } : {};
        return { statut: r.url.includes('depart') ? 302 : 200, entetes, corps: 'x' };
      },
    };
    const client = creerClient(reseauElectron(pont));
    await expect(client.texte('https://exemple.fr/depart')).rejects.toMatchObject({ code: 'garde' });
    expect(urls).toEqual(['https://exemple.fr/depart']);
  });

  it('nettoie l’enveloppe d’erreur d’Electron et classe un refus de garde', async () => {
    const pont: PontTsuzuku = {
      requete: async () => {
        throw new Error("Error invoking remote method 'tsuzuku:requete': Error: Adresse non publique refusée.");
      },
    };
    const err = await reseauElectron(pont).requete(requete('https://exemple.fr/')).catch(e => e);
    expect(err).toBeInstanceOf(ErreurMoteur);
    expect(err.message).toBe('Adresse non publique refusée.');
    expect(err.code).toBe('garde');
    const autre = await reseauElectron({ requete: async () => Promise.reject(new Error('Délai dépassé (1000 ms).')) }).requete(requete('https://exemple.fr/')).catch(e => e);
    expect(autre.code).toBe('reseau');
  });

  it('refuse une réponse mal formée', async () => {
    const pont = { requete: async () => ({ statut: 'x' }) } as unknown as PontTsuzuku;
    await expect(reseauElectron(pont).requete(requete('https://exemple.fr/'))).rejects.toThrow(/illisible/);
  });

  it('détecte le pont du préchargement, et lui seul', () => {
    expect(pontElectron({})).toBeUndefined();
    expect(pontElectron({ applibourse: { bureau: true } })).toBeUndefined();
    const pont = { requete: async () => ({ statut: 200, entetes: {}, corps: '' }) };
    expect(pontElectron({ applibourse: { tsuzuku: pont } })).toBe(pont);
  });
});

describe('adaptateur du site (navigateur)', () => {
  const fetchFictif = (corps: string) => {
    const appels: string[] = [];
    const fn = jest.fn(async (url: string, init: { credentials: string; redirect: string }) => {
      appels.push(url);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      return { status: 200, headers: { forEach: (cb: (v: string, n: string) => void) => cb('application/json', 'content-type') }, text: async () => corps };
    });
    return { fn, appels };
  };

  it('ne joint que les catalogues (Jikan, AniList, TMDB)', async () => {
    const { fn, appels } = fetchFictif('{"data":[]}');
    const reseau = reseauWeb(fn as never);
    for (const hote of HOTES_CATALOGUE) {
      expect((await reseau.requete(requete(`https://${hote}/x`))).statut).toBe(200);
    }
    expect(appels).toHaveLength(3);
  });

  it('refuse une page tierce avec le message annoncé, sans aucune requête', async () => {
    const { fn } = fetchFictif('x');
    const reseau = reseauWeb(fn as never);
    for (const url of ['https://mediatheque-exemple.fr/recherche?q=a', 'http://api.jikan.moe/v4/x', 'https://api.jikan.moe.exemple.fr/']) {
      const err = await reseau.requete(requete(url)).catch(e => e);
      expect(err).toBeInstanceOf(ErreurMoteur);
      expect(err.message).toBe(MESSAGE_SITE);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('le message annoncé dit quoi faire : relier le compte Fondateur au relais, sinon l’app PC/iPhone', () => {
    expect(MESSAGE_SITE).toMatch(/app PC\/iPhone/);
    expect(MESSAGE_SITE).toMatch(/relais/);
    expect(MESSAGE_SITE).toMatch(/Fondateur/);
    expect(MESSAGE_SITE).not.toMatch(/bientôt/);
  });
});

describe('adaptateur du téléphone (fetch natif)', () => {
  const rep = (url: string, corps = 'ok') => ({ status: 200, url, headers: { forEach: () => undefined }, text: async () => corps });

  it('lit la réponse, sans cookie', async () => {
    const fn = jest.fn(async (url: string, init: { credentials: string }) => {
      expect(init.credentials).toBe('omit');
      return rep(url, 'salut');
    });
    expect((await reseauNatif(fn as never).requete(requete('https://exemple.fr/a'))).corps).toBe('salut');
  });

  it('jette une réponse dont l’adresse finale (après redirection du système) n’est pas publique', async () => {
    const fn = jest.fn(async () => rep('http://192.168.1.1/routeur', 'secret'));
    const err = await reseauNatif(fn as never).requete(requete('https://exemple.fr/a')).catch(e => e);
    expect(err.code).toBe('garde');
    expect(err.message).not.toContain('secret');
    // Redirection vers une autre adresse publique : acceptée.
    const ok = jest.fn(async () => rep('https://autre-exemple.fr/b'));
    await expect(reseauNatif(ok as never).requete(requete('https://exemple.fr/a'))).resolves.toMatchObject({ statut: 200 });
  });
});

describe('choix de l’adaptateur', () => {
  const pont = { requete: async () => ({ statut: 200, entetes: {}, corps: '' }) };
  it('PC si le préchargement est là, site sur le web, téléphone sinon', () => {
    expect(choisirReseau({ applibourse: { tsuzuku: pont } }, 'web')).toMatchObject({ plateforme: 'pc', lectureSources: true });
    expect(choisirReseau({}, 'web')).toMatchObject({ plateforme: 'site', lectureSources: false });
    expect(choisirReseau({}, 'ios')).toMatchObject({ plateforme: 'mobile', lectureSources: true });
  });
});

describe('stockage = base du profil courant', () => {
  const base = (): BasePrefs & { donnees: Map<string, string> } => {
    const donnees = new Map<string, string>();
    return { donnees, lire: c => donnees.get(c), ecrire: (c, v) => void donnees.set(c, v), supprimer: c => void donnees.delete(c) };
  };

  it('deux profils = deux bases : la bibliothèque n’est jamais partagée', async () => {
    const baseAdmin = base();
    const baseAmi = base();
    const depotAdmin = new DepotBibliotheque(stockageDepuisBase(baseAdmin), CLES.bibliotheque);
    const depotAmi = new DepotBibliotheque(stockageDepuisBase(baseAmi), CLES.bibliotheque);
    await depotAdmin.modifier(db => {
      db.anime.push({ id: '1', kind: 'anime', title: 'Secret de l’admin' } as never);
    });
    expect((await depotAmi.lire()).anime).toEqual([]);
    expect([...baseAmi.donnees.keys()]).toEqual([]);
    expect([...baseAdmin.donnees.keys()]).toEqual([CLES.bibliotheque]);
    expect(baseAdmin.donnees.get(CLES.bibliotheque)).toContain('Secret de l’admin');
    expect(baseAmi.donnees.get(CLES.bibliotheque)).toBeUndefined();
  });

  it('n’écrit que sous le préfixe tsuzuku. (aucune autre clé du profil n’est touchable)', async () => {
    const b = base();
    b.donnees.set('hub.theme', 'nuit');
    const st = stockageDepuisBase(b);
    await expect(st.lire('hub.theme')).rejects.toThrow(/invalide/);
    await expect(st.ecrire('hub.theme', 'x')).rejects.toThrow();
    await expect(st.supprimer('coffre')).rejects.toThrow();
    expect(b.donnees.get('hub.theme')).toBe('nuit');
  });

  it('une valeur vide vaut « absente », et la suppression retire la clé', async () => {
    const b = base();
    const st = stockageDepuisBase(b);
    await st.ecrire('tsuzuku.x', '');
    expect(await st.lire('tsuzuku.x')).toBeNull();
    await st.ecrire('tsuzuku.x', 'v');
    await st.supprimer('tsuzuku.x');
    expect(b.donnees.has('tsuzuku.x')).toBe(false);
    // Sans `supprimer` natif : on vide.
    const sans: BasePrefs = { lire: c => b.donnees.get(c), ecrire: (c, v) => void b.donnees.set(c, v) };
    await stockageDepuisBase(sans).ecrire('tsuzuku.y', 'v');
    await stockageDepuisBase(sans).supprimer('tsuzuku.y');
    expect(await stockageDepuisBase(sans).lire('tsuzuku.y')).toBeNull();
  });
});
