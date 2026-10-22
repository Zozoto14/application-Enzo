import { utf8ToBytes } from '@noble/hashes/utils.js';
import { systemeMemoire } from '../fichiers/systeme';
import { GestionnaireMiseAJour } from './application';
import { genererClesSignature, signerPaquet } from './manifeste';
import { telechargerMiseAJour } from './telechargement';

const CLES = genererClesSignature();
const SITE = 'https://ab.exemple.org';

function siteAvec(fichiers: Record<string, Uint8Array | string>) {
  return (async (url: string) => {
    const chemin = url.slice(SITE.length);
    const contenu = fichiers[chemin];
    if (contenu === undefined) {
      return { ok: false, status: 404 } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(String(contenu)),
      arrayBuffer: async () => (typeof contenu === 'string' ? utf8ToBytes(contenu) : contenu).slice().buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('mise à jour téléchargée depuis le site', () => {
  const paquet = utf8ToBytes('var app = 3;');

  it('télécharge, vérifie et installe une version plus récente', async () => {
    const fichiers = systemeMemoire();
    const gestionnaire = new GestionnaireMiseAJour(fichiers, CLES.publique);
    const manifeste = signerPaquet(paquet, { version: 3, date: '2026-09-26', clePrivee: CLES.privee, notes: 'Synchro' });
    const requete = siteAvec({ '/maj/manifeste.json': JSON.stringify(manifeste), '/maj/main.jsbundle': paquet });

    const resultat = await telechargerMiseAJour({ site: SITE, gestionnaire, fichiers, requete });
    expect(resultat).toEqual({ etat: 'installee', version: 3, notes: 'Synchro' });
    expect((await gestionnaire.etat()).version).toBe(3);

    const ensuite = await telechargerMiseAJour({ site: SITE, gestionnaire, fichiers, requete });
    expect(ensuite).toEqual({ etat: 'a-jour', version: 3 });
  });

  it('refuse un paquet qui n’est pas signé par la bonne clé', async () => {
    const fichiers = systemeMemoire();
    const gestionnaire = new GestionnaireMiseAJour(fichiers, CLES.publique);
    const pirate = genererClesSignature();
    const manifeste = signerPaquet(paquet, { version: 9, date: '2026-09-26', clePrivee: pirate.privee });
    const requete = siteAvec({ '/maj/manifeste.json': JSON.stringify(manifeste), '/maj/main.jsbundle': paquet });

    const resultat = await telechargerMiseAJour({ site: SITE, gestionnaire, fichiers, requete });
    expect(resultat.etat).toBe('refusee');
    expect((await gestionnaire.etat()).miseAJourActive).toBe(false);
  });

  it('ne dit rien de grave quand le site ne publie pas de mise à jour', async () => {
    const fichiers = systemeMemoire();
    const resultat = await telechargerMiseAJour({
      site: SITE,
      gestionnaire: new GestionnaireMiseAJour(fichiers, CLES.publique),
      fichiers,
      requete: siteAvec({}),
    });
    expect(resultat.etat).toBe('refusee');
  });
});
