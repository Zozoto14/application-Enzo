/**
 * Site web → relais (`/tsuzuku/requete`) : décodage, redirections revérifiées
 * par le moteur, erreurs claires (relais pas à jour, non autorisé, débit), et
 * lecture des sources ouverte au SEUL Fondateur relié au relais.
 */

import { creerServices } from '../app/services';
import { stockageMemoire } from '../moteur/bibliotheque';
import { ErreurMoteur } from '../moteur/erreurs';
import { creerClient, type RequeteReseau } from '../moteur/reseau';
import { choisirReseau } from './reseau';
import { MESSAGES_RELAIS, decoderOctets, lireReponseRelais, reseauRelais, reseauSite, transportRelais, type DemandeRelais, type TransportRelais } from './reseauRelais';
import { MESSAGE_SITE } from './reseauWeb';

const requete = (url: string, plus: Partial<RequeteReseau> = {}): RequeteReseau => ({ url, methode: 'GET', entetes: {}, delaiMs: 5000, tailleMax: 1_000_000, ...plus });
const html = (texte: string, plus: Record<string, unknown> = {}) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, finalUrl: 'x', contentType: 'text/html', charset: 'utf-8', texte, tronque: false, ...plus });

/** Faux relais : `repondre(demande)` rend `{ statut, json }` ; chaque demande est retenue. */
function fauxTransport(repondre: (d: DemandeRelais) => { statut: number; json: unknown } | Promise<{ statut: number; json: unknown }>, disponible = true) {
  const demandes: DemandeRelais[] = [];
  const transport: TransportRelais = {
    disponible: () => disponible,
    envoyer: async d => {
      demandes.push(d);
      return repondre(d);
    },
  };
  return { transport, demandes };
}

describe('réponse du relais → format du moteur', () => {
  it('texte décodé par le Worker, en-têtes en minuscules, troncature signalée', () => {
    expect(lireReponseRelais(html('<p>Été</p>', { headers: { 'Content-Type': 'text/html', 'x-tsuzuku-cookie': '1' }, tronque: true }))).toEqual({
      statut: 200,
      entetes: { 'content-type': 'text/html', 'x-tsuzuku-cookie': '1', 'x-tsuzuku-tronque': '1' },
      corps: '<p>Été</p>',
    });
  });

  it('corps en base64 décodé selon le jeu de caractères (ISO-8859-1 → windows-1252), repli UTF-8', () => {
    // « Été éternel » en ISO-8859-1 (un octet par caractère), puis en UTF-8.
    const b64 = (binaire: string) => (globalThis as unknown as { btoa(s: string): string }).btoa(binaire);
    const latin = b64('\xc9t\xe9 \xe9ternel');
    expect(lireReponseRelais({ status: 200, headers: {}, charset: 'windows-1252', bodyBase64: latin }).corps).toBe('Été éternel');
    const utf8 = b64('Caf\xc3\xa9');
    expect(lireReponseRelais({ status: 200, headers: {}, charset: 'jeu-inconnu', bodyBase64: utf8 }).corps).toBe('Café');
    expect(decoderOctets(new Uint8Array([0x80]), 'windows-1252')).toBe('€');
  });

  it('refuse une réponse mal formée', () => {
    expect(() => lireReponseRelais({ statut: 200 })).toThrow(MESSAGES_RELAIS.illisible);
    expect(() => lireReponseRelais(null)).toThrow(ErreurMoteur);
  });
});

describe('réseau du site par le relais', () => {
  it('transmet URL, méthode, en-têtes et corps ; un seul saut par appel', async () => {
    const { transport, demandes } = fauxTransport(() => ({ statut: 200, json: html('ok') }));
    const r = await reseauRelais(transport).requete(requete('https://ajax-exemple.fr/ajax', { methode: 'POST', corps: 'terme=x', entetes: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(r.corps).toBe('ok');
    expect(demandes).toEqual([{ url: 'https://ajax-exemple.fr/ajax', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'terme=x' }]);
  });

  it('les redirections sont suivies par le moteur, chaque saut revérifié (réseau local refusé, 5 sauts au plus)', async () => {
    const vers = (location: string) => ({ statut: 200, json: { status: 302, headers: { location }, texte: '' } });
    // Saut relatif puis vers un autre domaine public : suivis, en repassant par le relais.
    const chaine = fauxTransport(d =>
      d.url === 'https://ancien-exemple.fr/recherche' ? vers('/v2/recherche') : d.url === 'https://ancien-exemple.fr/v2/recherche' ? vers('https://miroir-exemple.fr/v2/recherche') : { statut: 200, json: html('trouvé') },
    );
    const r = await creerClient(reseauSite(chaine.transport)).texte('https://ancien-exemple.fr/recherche');
    expect(r.corps).toBe('trouvé');
    expect(r.url).toBe('https://miroir-exemple.fr/v2/recherche');
    expect(chaine.demandes.map(d => d.url)).toEqual(['https://ancien-exemple.fr/recherche', 'https://ancien-exemple.fr/v2/recherche', 'https://miroir-exemple.fr/v2/recherche']);
    // Vers le réseau local : refus de la garde du moteur, AVANT tout nouvel appel au relais.
    for (const cible of ['http://192.168.1.1/admin', 'http://localhost:8080/', 'http://[::1]/', 'http://2130706433/', 'http://box.local/']) {
      const local = fauxTransport(() => vers(cible));
      await expect(creerClient(reseauSite(local.transport)).texte('https://site-exemple.fr/')).rejects.toMatchObject({ code: 'garde' });
      expect(local.demandes).toHaveLength(1);
    }
    // Boucle : arrêt après 5 redirections.
    let n = 0;
    const boucle = fauxTransport(() => vers(`https://site-exemple.fr/${++n}`));
    await expect(creerClient(reseauSite(boucle.transport)).texte('https://site-exemple.fr/0')).rejects.toMatchObject({ code: 'redirections' });
    expect(boucle.demandes).toHaveLength(6);
    // Boucle qui pose des cookies : expliquée.
    const cookies = fauxTransport(() => ({ statut: 200, json: { status: 302, headers: { location: 'https://site-exemple.fr/', 'x-tsuzuku-cookie': '1' }, texte: '' } }));
    await expect(creerClient(reseauSite(cookies.transport)).texte('https://site-exemple.fr/')).rejects.toMatchObject({ code: 'cookies' });
  });

  it('une adresse non publique n’est même pas envoyée au relais', async () => {
    const { transport, demandes } = fauxTransport(() => ({ statut: 200, json: html('x') }));
    await expect(creerClient(reseauSite(transport)).texte('http://10.0.0.1/')).rejects.toMatchObject({ code: 'garde' });
    expect(demandes).toHaveLength(0);
  });

  it('erreurs claires : relais pas à jour (404), jeton refusé (401), non autorisé (403), origine (403), débit (429), injoignable', async () => {
    const cas: Array<[number, unknown, RegExp]> = [
      [404, { erreur: 'Adresse inconnue.' }, /mettez à jour le relais/],
      [404, null, /relais:deployer/],
      [401, { erreur: 'x' }, /reliez-le de nouveau/],
      [403, { erreur: 'Réservé…', code: 'interdit' }, /réserve la lecture des sources au compte Fondateur/],
      [403, { erreur: 'Origine non autorisée.', code: 'origine' }, /ORIGINES_SITE/],
      [429, { erreur: 'Trop', code: 'debit' }, /Trop de requêtes vers le relais/],
      [502, { erreur: 'Le site est injoignable.', code: 'injoignable' }, /Le site est injoignable\. \(relais\)/],
      [504, { erreur: 'Délai dépassé (15 s).', code: 'delai' }, /Délai dépassé/],
    ];
    for (const [statut, json, motif] of cas) {
      const { transport } = fauxTransport(() => ({ statut, json }));
      const err = await reseauRelais(transport).requete(requete('https://site-exemple.fr/')).catch(e => e);
      expect(err).toBeInstanceOf(ErreurMoteur);
      expect(err.message).toMatch(motif);
    }
    const dns = await reseauRelais(fauxTransport(() => ({ statut: 400, json: { erreur: 'Le nom résout vers une adresse non publique.', code: 'dns' } })).transport).requete(requete('https://x-exemple.fr/')).catch(e => e);
    expect(dns.code).toBe('garde');
    const panne: TransportRelais = { disponible: () => true, envoyer: async () => Promise.reject(new TypeError('Failed to fetch')) };
    await expect(reseauRelais(panne).requete(requete('https://site-exemple.fr/'))).rejects.toThrow(MESSAGES_RELAIS.injoignable);
  });

  it('sans relais (ou relais sans le jeton du Fondateur) : message du site, aucune requête ; catalogues toujours en direct', async () => {
    const indisponible = fauxTransport(() => ({ statut: 200, json: html('x') }), false);
    for (const t of [undefined, indisponible.transport]) {
      const err = await reseauSite(t).requete(requete('https://spa-exemple.fr/recherche')).catch(e => e);
      expect(err.message).toBe(MESSAGE_SITE);
      expect(err.statut).toBe(501);
    }
    expect(indisponible.demandes).toHaveLength(0);
    const direct = jest.fn(async () => ({ status: 200, headers: { forEach: () => undefined }, text: async () => '{}' }));
    const relie = fauxTransport(() => ({ statut: 200, json: html('x') }));
    await reseauSite(relie.transport, direct as never).requete(requete('https://api.jikan.moe/v4/anime/1'));
    expect(direct).toHaveBeenCalledTimes(1);
    expect(relie.demandes).toHaveLength(0);
  });
});

describe('qui lit les sources sur le site', () => {
  it('choisirReseau : le site lit par le relais quand le transport est relié (relu à chaque fois)', () => {
    let relie = false;
    const transport: TransportRelais = { disponible: () => relie, envoyer: async () => ({ statut: 200, json: html('') }) };
    const choix = choisirReseau({ applibourse: { tsuzukuRelais: transport } }, 'web');
    expect(choix.plateforme).toBe('site');
    expect(choix.lectureSources).toBe(false);
    relie = true;
    expect(choix.lectureSources).toBe(true);
    expect(choix.viaRelais).toBe(true);
    // Le transport du site n'est jamais pris pour le pont du PC.
    expect(choisirReseau({ applibourse: { tsuzukuRelais: transport } }, 'web').pont).toBeUndefined();
    expect(transportRelais({ applibourse: { tsuzuku: { requete: async () => undefined } } })).toBeUndefined();
  });

  it('services : vrai pour le Fondateur seulement (ami, gestionnaire, administrateur : non)', () => {
    const transport: TransportRelais = { disponible: () => true, envoyer: async () => ({ statut: 200, json: html('') }) };
    const choix = choisirReseau({ applibourse: { tsuzukuRelais: transport } }, 'web');
    const pour = (rang: 'fondateur' | 'administrateur' | 'gestionnaire' | 'ami') => creerServices({ choix, stockage: stockageMemoire(), rang });
    expect(pour('fondateur')).toMatchObject({ lectureSources: true, viaRelais: true });
    for (const rang of ['administrateur', 'gestionnaire', 'ami'] as const) {
      expect(pour(rang)).toMatchObject({ lectureSources: false, viaRelais: false });
    }
    // Sur le PC, rien ne change.
    const pc = creerServices({ choix: { plateforme: 'pc', reseau: reseauSite(), lectureSources: true }, stockage: stockageMemoire(), rang: 'ami' });
    expect(pc).toMatchObject({ lectureSources: true, viaRelais: false });
  });
});
