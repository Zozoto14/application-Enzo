/**
 * Migration du Fondateur par le VRAI pont HTTP du serveur Node (esport/serveur/commun.mjs, celui de
 * Passenger chez o2switch), directement ET derrière un intermédiaire qui perd le corps des PUT :
 * publication de l'accès (identifiant « admin »), de l'A2F, puis connexion avec mot de passe + code.
 * Un refus affiche la raison réelle.
 */
import { aleatoireDeterministe } from '../src/securite/aleatoire';
import type { ParametresKdf } from '../src/securite/kdf';
import { codeTotp, genererSecretTotp } from '../src/securite/totp';
import { genererCodeRecuperation } from '../src/securite/codes-recuperation';
import { activerA2f, lireSelAcces, ouvrirAccesRelais, publierAcces } from '../src/sync/relais/connexionAmis';
import { empreinteIdentifiant, preuveAcces } from '../src/profils/invitation';
import { publierAccesFondateur } from './connexionAmis';

/* eslint-disable @typescript-eslint/no-var-requires */
const { traiterRequete } = require('../relais/relais.mjs') as {
  traiterRequete(r: Request, env: unknown, ctx: unknown): Promise<Response>;
};
const { coffresMemoire } = require('../relais/coffres.mjs') as { coffresMemoire(): unknown };
const { creerServeurHttp, ecouter } = require('../esport/serveur/commun.mjs') as {
  creerServeurHttp(t: (r: Request) => Promise<Response>, o?: unknown): { close(f: () => void): void; closeAllConnections(): void };
  ecouter(s: unknown, o: { port: number; hote: string }): Promise<string>;
};

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const JETON = 'jeton-maitre-transmission-0123456789';
jest.setTimeout(60_000);

describe('migration du Fondateur : relais direct et intermédiaire qui perd le corps', () => {
  const serveurs: Array<{ close(f: () => void): void; closeAllConnections(): void }> = [];
  let direct = '';
  let sansCorps = '';
  const donnees = new Map<string, string>();
  const env = {
    JETON,
    COFFRES: coffresMemoire(),
    BOITE: { get: async (c: string) => donnees.get(c) ?? null, put: async (c: string, v: string) => void donnees.set(c, v), delete: async (c: string) => void donnees.delete(c) },
  };
  beforeAll(async () => {
    const s1 = creerServeurHttp(r => traiterRequete(r, env, {}), { journal: { error: () => undefined } });
    direct = await ecouter(s1, { port: 0, hote: '127.0.0.1' });
    // Intermédiaire d'hébergement qui PERD le corps des PUT (cause possible du « 400 » de la migration).
    const s3 = creerServeurHttp(
      async r => (r.method === 'PUT' ? traiterRequete(new Request(r.url, { method: 'PUT', headers: r.headers }), env, {}) : traiterRequete(r, env, {})),
      { journal: { error: () => undefined } },
    );
    sansCorps = await ecouter(s3, { port: 0, hote: '127.0.0.1' });
    serveurs.push(s1, s3);
  });
  afterAll(async () => {
    for (const s of serveurs) {
      s.closeAllConnections();
      await new Promise<void>(ok => s.close(() => ok()));
    }
  });

  it.each(['direct', 'sans-corps'])('par le relais %s : accès « admin » + A2F publiés, connexion avec mot de passe puis code', async mode => {
    const relais = mode === 'direct' ? direct : sansCorps;
    const maitre = { relais, jeton: JETON };
    const alea = aleatoireDeterministe(mode.length);
    const secret = genererSecretTotp(alea);
    const codes = Array.from({ length: 10 }, () => genererCodeRecuperation(alea));
    const reste = 30_000 - (Date.now() % 30_000);
    if (reste < 5_000) await new Promise(ok => setTimeout(ok, reste + 50));
    donnees.delete('a2f:principal');
    await activerA2f(maitre, 'principal', secret, codeTotp(secret, Date.now()));
    const identifiant = mode === 'direct' ? 'admin' : `admin-${mode}`;
    // Le mot de passe ACTUEL est gardé (pas de nouveau mot de passe) : c'est lui qui publie l'accès.
    await publierAccesFondateur({ maitre, identifiant, motDePasse: 'mot de passe actuel du PC', codes, kdf: KDF });
    // Connexion (même chemin que connecterParIdentifiant ; la charge, scellée, nomme une adresse https que ce test n'a pas).
    const h = empreinteIdentifiant(` ${identifiant.toUpperCase()} `);
    const { sel, kdf } = await lireSelAcces(relais, h);
    const { preuve } = preuveAcces('mot de passe actuel du PC', sel, kdf);
    await expect(ouvrirAccesRelais(relais, h, preuve)).rejects.toMatchObject({ code: 'a2f-requis' });
    await expect(ouvrirAccesRelais(relais, h, preuve, undefined, 'ouvrir', '000000')).rejects.toMatchObject({ code: expect.stringMatching(/a2f-code/) });
    const ouvert = await ouvrirAccesRelais(relais, h, preuve, undefined, 'ouvrir', codeTotp(secret, Date.now() + 30_000));
    expect(ouvert.compte).toBe('principal');
    expect(ouvert.jeton).toMatch(/^s1\./);
    // Relancer la migration ne casse rien (idempotent) : même compte, accès remplacé.
    await publierAccesFondateur({ maitre, identifiant, motDePasse: 'mot de passe actuel du PC', codes, kdf: KDF });
  });

  it('un dépôt illisible : la raison réelle (champ fautif) est affichée, pas seulement « 400 »', async () => {
    const maitre = { relais: direct, jeton: JETON };
    const depot = { compte: 'principal', sel: 'a'.repeat(32), kdf: { ...KDF, longueurCle: 16 }, verif: 'b'.repeat(64), charge: 'cc' };
    await expect(publierAcces(maitre, 'e'.repeat(64), depot as never)).rejects.toThrow(/champ « kdf »/);
  });
});
