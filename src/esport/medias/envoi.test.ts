/**
 * Envoi par morceaux côté app : découpe, SHA-256 de chaque morceau et du fichier entier (identiques à
 * ceux du serveur), nouvel essai après une coupure, reprise après fermeture (identifiant gardé sur
 * l'appareil, empreinte recalculée sur ce qui est déjà parti), recalage sur le serveur, annulation.
 * Le serveur est simulé (même protocole que esport/noyau/medias/service.mjs).
 */

import { ErreurEsport, type ClientEsport } from '../client';
import { cleReprise, envoyerFichier, tailleMedia, type EtatEnvoi, type FichierLocal, type MemoireEnvois } from './envoi';
import { ajouter, exporterEtat, importerEtat, nouvelEtat, sha256Hex, terminer } from './sha256';

const subtle = (globalThis as unknown as { crypto: { subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto.subtle;
/** Référence : SHA-256 de WebCrypto. */
const sha = async (o: Uint8Array) => Array.from(new Uint8Array(await subtle.digest('SHA-256', o)), x => x.toString(16).padStart(2, '0')).join('');

function fichierDe(octets: Uint8Array, nom = 'match.mp4'): FichierLocal & { lectures: number } {
  const f = { nom, taille: octets.length, type: 'video/mp4', derniereModif: 1, lectures: 0, lire: async (a: number, b: number) => (f.lectures++, octets.slice(a, b)) };
  return f;
}

function memoire(): MemoireEnvois & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return { donnees, lire: c => donnees.get(c), ecrire: (c, v) => void donnees.set(c, v), oublier: c => void donnees.delete(c) };
}

/** Faux serveur : mêmes contrôles que le vrai (ordre, taille, SHA-256 du morceau, puis du fichier). */
function fauxServeur(tailleMorceau = 1000) {
  const envois = new Map<string, EtatEnvoi & { parts: Uint8Array[] }>();
  const s = { envois, coupures: 0, appels: [] as string[], supprimes: [] as string[], fin: undefined as string | undefined };
  let n = 0;
  const public_ = (e: EtatEnvoi & { parts: Uint8Array[] }): EtatEnvoi => {
    const reste: Partial<typeof e> = { ...e };
    delete reste.parts;
    return { ...(reste as EtatEnvoi), octetsRecus: Math.min(e.taille, e.recus * e.tailleMorceau) };
  };
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    requete: async (chemin: string, methode = 'GET', corps?: Record<string, unknown>) => {
      s.appels.push(`${methode} ${chemin}`);
      const m = /\/envois(?:\/([^/]+))?(\/fin)?$/.exec(chemin)!;
      if (!m[1] && methode === 'POST') {
        const taille = Number(corps!.taille);
        const e = { id: `e${++n}`, usage: 'review' as const, nom: String(corps!.nom), taille, tailleMorceau, morceaux: Math.ceil(taille / tailleMorceau), recus: 0, octetsRecus: 0, statut: 'en_cours' as const, rattache: false, media: null, parts: [] };
        envois.set(e.id, e);
        return public_(e);
      }
      const e = envois.get(m[1]);
      if (!e) throw new ErreurEsport('Envoi introuvable', 404, 'envoi-introuvable');
      if (methode === 'DELETE') {
        envois.delete(e.id);
        s.supprimes.push(e.id);
        return { ok: true };
      }
      if (m[2]) {
        const tout = new Uint8Array(e.parts.reduce((a, p) => a + p.length, 0));
        let i = 0;
        for (const p of e.parts) {
          tout.set(p, i);
          i += p.length;
        }
        s.fin = String(corps!.sha256);
        if ((await sha(tout)) !== corps!.sha256) throw new ErreurEsport('SHA différent', 422, 'empreinte-fichier');
        e.statut = 'termine';
        return public_(e);
      }
      return public_(e);
    },
    binaire: async (chemin: string, _m: string, octets: Uint8Array, entetes: Record<string, string>) => {
      const [, id, i] = /\/envois\/([^/]+)\/morceaux\/(\d+)$/.exec(chemin)!;
      const e = envois.get(id)!;
      if (s.coupures > 0) {
        s.coupures--;
        throw new ErreurEsport('Le serveur Esport est injoignable.', 0, 'injoignable');
      }
      const indice = Number(i);
      if (indice > e.recus) {
        const err = new ErreurEsport('Morceau hors ordre', 409, 'morceau-hors-ordre', { attendu: e.recus });
        throw err;
      }
      if (indice < e.recus) return public_(e);
      if ((await sha(octets)) !== entetes['X-Sha256']) throw new ErreurEsport('Morceau abîmé', 422, 'empreinte-morceau');
      e.parts[indice] = octets;
      e.recus++;
      return public_(e);
    },
  };
  return { s, client: client as unknown as ClientEsport };
}

const donnees = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
const sansAttente = async () => undefined;

test('SHA-256 incrémental : identique à WebCrypto, état sérialisable', async () => {
  const o = donnees(10_001);
  expect(sha256Hex(o)).toBe(await sha(o));
  let e = nouvelEtat();
  for (let i = 0; i < o.length; i += 333) e = importerEtat(exporterEtat(ajouter(e, o.subarray(i, i + 333))));
  expect(terminer(e)).toBe(await sha(o));
});

test('envoi complet : morceaux dans l’ordre, empreinte du fichier, progression jusqu’à 100 %', async () => {
  const { s, client } = fauxServeur(1000);
  const octets = donnees(3500);
  const progres: number[] = [];
  const { etat, oublier } = await envoyerFichier({ client, teamId: 't1', section: 'review', fichier: fichierDe(octets), memoire: memoire(), attendre: sansAttente, onProgression: p => progres.push(p.octets) });
  expect(etat.statut).toBe('termine');
  expect(etat.morceaux).toBe(4);
  expect(s.fin).toBe(await sha(octets));
  expect(progres[progres.length - 1]).toBe(3500);
  expect(progres).toEqual([...progres].sort((a, b) => a - b));
  oublier();
});

test('coupure réseau : nouvel essai (avec attente croissante) puis réussite ; trop d’échecs : erreur', async () => {
  const { s, client } = fauxServeur(1000);
  s.coupures = 2;
  const attentes: number[] = [];
  const essais: number[] = [];
  const { etat } = await envoyerFichier({ client, teamId: 't1', section: 'review', fichier: fichierDe(donnees(2500)), memoire: memoire(), attendre: async ms => void attentes.push(ms), onProgression: p => p.essai && essais.push(p.essai) });
  expect(etat.statut).toBe('termine');
  expect(attentes).toEqual([1000, 2000]);
  expect(essais).toEqual([1, 2]);
  const autre = fauxServeur(1000);
  autre.s.coupures = 99;
  await expect(envoyerFichier({ client: autre.client, teamId: 't1', section: 'review', fichier: fichierDe(donnees(2500)), memoire: memoire(), attendre: sansAttente })).rejects.toMatchObject({ code: 'injoignable' });
});

test('reprise après fermeture : même fichier → même envoi, on repart du morceau attendu', async () => {
  const { s, client } = fauxServeur(1000);
  const octets = donnees(4200);
  const m = memoire();
  // Première tentative : coupure définitive au 3e morceau.
  const f1 = fichierDe(octets);
  let appelsBinaire = 0;
  const binaire = client.binaire.bind(client);
  (client as { binaire: unknown }).binaire = async (...a: Parameters<typeof binaire>) => {
    appelsBinaire++;
    if (appelsBinaire === 3) throw new ErreurEsport('refus', 400, 'taille-morceau');
    return binaire(...a);
  };
  await expect(envoyerFichier({ client, teamId: 't1', section: 'review', fichier: f1, memoire: m, attendre: sansAttente })).rejects.toMatchObject({ code: 'taille-morceau' });
  expect(m.donnees.get(cleReprise(client, 't1', 'review', f1))).toBe('e1');
  // Réouverture du même fichier : reprise au morceau 2 (les 2 premiers ne repartent pas).
  (client as { binaire: unknown }).binaire = binaire;
  const envoyes: number[] = [];
  (client as { binaire: unknown }).binaire = async (chemin: string, ...reste: unknown[]) => {
    envoyes.push(Number(/(\d+)$/.exec(chemin)![1]));
    return (binaire as (...x: unknown[]) => Promise<unknown>)(chemin, ...reste);
  };
  const { etat, oublier } = await envoyerFichier({ client, teamId: 't1', section: 'review', fichier: fichierDe(octets), memoire: m, attendre: sansAttente });
  expect(etat.id).toBe('e1');
  expect(envoyes).toEqual([2, 3, 4]);
  expect(s.fin).toBe(await sha(octets));
  oublier();
  expect(m.donnees.size).toBe(0);
});

test('recalage : le serveur attend un autre morceau (réponse perdue) → on se cale sur lui', async () => {
  const { s, client } = fauxServeur(1000);
  const octets = donnees(3000);
  const binaire = client.binaire.bind(client);
  let premier = true;
  (client as { binaire: unknown }).binaire = async (chemin: string, m: string, o: Uint8Array, e: Record<string, string>) => {
    const r = await binaire(chemin, m, o, e);
    if (premier && chemin.endsWith('/0')) {
      premier = false;
      // Réponse perdue : l'app croit que le morceau 0 a échoué.
      throw new ErreurEsport('Le serveur Esport est injoignable.', 0, 'injoignable');
    }
    return r;
  };
  const { etat } = await envoyerFichier({ client, teamId: 't1', section: 'review', fichier: fichierDe(octets), memoire: memoire(), attendre: sansAttente });
  expect(etat.statut).toBe('termine');
  expect(s.fin).toBe(await sha(octets));
});

test('annulation : la requête s’arrête, l’envoi est effacé sur le serveur et oublié ici', async () => {
  const { s, client } = fauxServeur(1000);
  const m = memoire();
  const controle = { aborted: false };
  const f = fichierDe(donnees(5000));
  const lire = f.lire;
  f.lire = async (a, b) => {
    if (a >= 2000) controle.aborted = true;
    return lire(a, b);
  };
  await expect(envoyerFichier({ client, teamId: 't1', section: 'review', fichier: f, memoire: m, signal: controle, attendre: sansAttente })).rejects.toMatchObject({ code: 'annule' });
  expect(s.supprimes).toEqual(['e1']);
  expect(m.donnees.size).toBe(0);
});

test('tailles lisibles', () => {
  expect(tailleMedia(1536)).toBe('1,5 Ko');
  expect(tailleMedia(10 * 1024 ** 3)).toBe('10,0 Go');
  expect(tailleMedia(500 * 1024 ** 2, 'en')).toBe('500 MB');
  expect(tailleMedia(12)).toBe('12 o');
});
