import { creerClient, reseauDepuisFetch, type FonctionFetch } from './reseau';
import { fauxReseau, json } from './outilsTest';

describe('client reseau sur', () => {
  it('suit une redirection publique, en validant chaque saut', async () => {
    const r = fauxReseau({
      'https://a.exemple.fr/x': { statut: 302, entetes: { Location: '/y' } },
      'https://a.exemple.fr/y': { corps: 'fin' },
    });
    const rep = await creerClient(r).texte('https://a.exemple.fr/x');
    expect(rep.corps).toBe('fin');
    expect(rep.url).toBe('https://a.exemple.fr/y');
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://2130706433/',
    'http://nas.local/',
    'file:///etc/passwd',
  ])('refuse une redirection vers %s', async cible => {
    const r = fauxReseau({ 'https://a.exemple.fr/x': { statut: 301, entetes: { location: cible } } });
    await expect(creerClient(r).texte('https://a.exemple.fr/x')).rejects.toMatchObject({ code: expect.stringMatching(/garde|adresse|redirections/) });
    expect(r.urls()).toEqual(['https://a.exemple.fr/x']);
  });

  it('refuse d\'appeler une adresse privee des le depart (aucune requete emise)', async () => {
    const r = fauxReseau({});
    await expect(creerClient(r).texte('http://10.0.0.1/')).rejects.toMatchObject({ code: 'garde' });
    expect(r.appels).toHaveLength(0);
  });

  it('limite le nombre de redirections', async () => {
    const r = fauxReseau({ 'https://a.exemple.fr/': { statut: 302, entetes: { location: 'https://a.exemple.fr/' } } });
    await expect(creerClient(r, { redirectionsMax: 3 }).texte('https://a.exemple.fr/')).rejects.toMatchObject({ code: 'redirections' });
    expect(r.appels).toHaveLength(4);
  });

  it('refuse de rediriger un envoi POST', async () => {
    const r = fauxReseau({ 'https://a.exemple.fr/g': { statut: 307, entetes: { location: 'https://b.exemple.fr/' } } });
    await expect(creerClient(r).envoyerJson('https://a.exemple.fr/g', { a: 1 })).rejects.toMatchObject({ code: 'redirections' });
  });

  it('applique la taille maximale', async () => {
    const r = fauxReseau({ 'https://a.exemple.fr/': { corps: 'x'.repeat(2000) } });
    await expect(creerClient(r, { tailleMax: 1000 }).texte('https://a.exemple.fr/')).rejects.toMatchObject({ code: 'taille' });
  });

  it('applique le delai', async () => {
    const r = { requete: () => new Promise<never>(() => {}) };
    await expect(creerClient(r, { delaiMs: 20 }).texte('https://a.exemple.fr/')).rejects.toMatchObject({ code: 'delai' });
  });

  it('transmet delai et taille a la plateforme, et n\'envoie pas de cookie', async () => {
    const r = fauxReseau({ 'https://a.exemple.fr/': { corps: '{}' } });
    await creerClient(r, { delaiMs: 1234, tailleMax: 999 }).obtenir('https://a.exemple.fr/');
    expect(r.appels[0]).toMatchObject({ delaiMs: 1234, tailleMax: 999, methode: 'GET' });
    expect(Object.keys(r.appels[0].entetes)).not.toContain('cookie');
  });

  it('json : erreurs de statut et de format', async () => {
    const r = fauxReseau({
      'https://a.exemple.fr/ok': json({ a: 1 }),
      'https://a.exemple.fr/casse': { corps: '{pas du json' },
      'https://a.exemple.fr/500': { statut: 500 },
    });
    const c = creerClient(r);
    await expect(c.json('https://a.exemple.fr/ok')).resolves.toEqual({ a: 1 });
    await expect(c.json('https://a.exemple.fr/casse')).rejects.toMatchObject({ code: 'service' });
    await expect(c.json('https://a.exemple.fr/500')).rejects.toMatchObject({ code: 'service' });
    await expect(c.json('https://a.exemple.fr/inconnu')).rejects.toMatchObject({ code: 'introuvable', statut: 404 });
  });

  it('resolution DNS du reseau : un nom qui resout en interne est refuse', async () => {
    const r = fauxReseau({ 'https://piege.exemple.fr/': { corps: 'x' } }, { resoudre: async () => ['192.168.0.9'] });
    await expect(creerClient(r).texte('https://piege.exemple.fr/')).rejects.toMatchObject({ code: 'garde' });
  });

  it('erreur de la plateforme : Reseau indisponible', async () => {
    const r = { requete: async () => { throw new Error('coupure'); } };
    await expect(creerClient(r).texte('https://a.exemple.fr/')).rejects.toMatchObject({ code: 'reseau' });
  });
});

describe('reseauDepuisFetch', () => {
  const rep = (status: number, corps: string, headers: Record<string, string> = {}, type?: string) => ({
    status,
    type,
    headers: { forEach: (cb: (v: string, n: string) => void) => Object.entries(headers).forEach(([n, v]) => cb(v, n)) },
    text: async () => corps,
  });

  it('demande redirect manual, sans cookies, et renvoie les en-tetes en minuscules', async () => {
    const f = jest.fn(async () => rep(200, 'salut', { 'Content-Type': 'text/plain' })) as unknown as FonctionFetch;
    const reseau = reseauDepuisFetch(f, { creerControleur: () => ({ signal: 's', abort: () => {} }) });
    const r = await reseau.requete({ url: 'https://a.exemple.fr/', methode: 'GET', entetes: {}, delaiMs: 1000, tailleMax: 100 });
    expect(r).toEqual({ statut: 200, entetes: { 'content-type': 'text/plain' }, corps: 'salut' });
    expect((f as unknown as jest.Mock).mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });

  it('refuse une redirection opaque et un Content-Length trop grand', async () => {
    const opaque = reseauDepuisFetch((async () => rep(0, '', {}, 'opaqueredirect')) as unknown as FonctionFetch, { creerControleur: () => ({ signal: 0, abort() {} }) });
    await expect(opaque.requete({ url: 'https://a.exemple.fr/', methode: 'GET', entetes: {}, delaiMs: 1000, tailleMax: 100 })).rejects.toMatchObject({ code: 'redirections' });
    const gros = reseauDepuisFetch((async () => rep(200, 'x', { 'content-length': '5000' })) as unknown as FonctionFetch, { creerControleur: () => ({ signal: 0, abort() {} }) });
    await expect(gros.requete({ url: 'https://a.exemple.fr/', methode: 'GET', entetes: {}, delaiMs: 1000, tailleMax: 100 })).rejects.toMatchObject({ code: 'taille' });
  });
});
