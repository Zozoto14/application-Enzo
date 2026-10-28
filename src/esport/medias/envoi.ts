/**
 * Envoi d'un gros fichier (vidéo d'une review, enregistrement d'une réunion) PAR MORCEAUX, avec reprise
 * après coupure. Protocole maison (esport/noyau/medias/service.mjs) :
 *
 *   POST …/envois { nom, taille, type }       → { id, tailleMorceau, morceaux, recus }
 *   PUT  …/envois/:id/morceaux/:i (binaire)    en-tête X-Sha256 : SHA-256 du morceau
 *   POST …/envois/:id/fin { sha256 }           SHA-256 du fichier entier (calcul incrémental, sha256.ts)
 *
 * Reprise : l'identifiant de l'envoi est gardé sur l'appareil (par fichier : nom, taille, date) ; en
 * rouvrant le même fichier, l'app demande l'état au serveur et repart du morceau attendu. Un morceau
 * qui échoue (réseau, serveur occupé) est retenté plusieurs fois, avec une attente qui grandit.
 * Annulation : `signal` (AbortController) → la requête en cours s'arrête et l'envoi est effacé.
 *
 * Indépendant de la plateforme : le fichier est lu par `FichierLocal.lire` (site et PC : `File.slice`).
 */

import { ErreurEsport, type ClientEsport, type InfosMedia } from '../client';
import { tr } from '../i18n';
import { ajouter, nouvelEtat, sha256Hex, terminer, type EtatSha256 } from './sha256';

/**
 * Section de l'URL d'envoi ; « cm » : section CM, `teamId` est alors la portée (« club » ou une team) ;
 * « drive » : Drive de la section CM (même portée, formats étendus, quota).
 */
export type SectionEnvoi = 'review' | 'resumes' | 'ressources' | 'cm' | 'drive';

/** Un fichier de l'appareil, lu par tranches (jamais en entier). */
export interface FichierLocal {
  nom: string;
  taille: number;
  type: string;
  derniereModif?: number;
  /** Octets de `debut` (inclus) à `fin` (exclu). */
  lire(debut: number, fin: number): Promise<Uint8Array>;
}

export interface EtatEnvoi {
  id: string;
  usage: 'review' | 'reunion' | 'ressource' | 'cm' | 'drive';
  nom: string;
  taille: number;
  tailleMorceau: number;
  morceaux: number;
  recus: number;
  octetsRecus: number;
  statut: 'en_cours' | 'termine';
  rattache: boolean;
  media: InfosMedia | null;
}

export type PhaseEnvoi = 'preparation' | 'reprise' | 'envoi' | 'verification' | 'termine';

export interface Progression {
  phase: PhaseEnvoi;
  octets: number;
  total: number;
  morceau: number;
  morceaux: number;
  /** Octets par seconde (moyenne depuis le début de cet envoi), si connue. */
  debit?: number;
  /** Nouvel essai en cours après une erreur réseau (numéro de l'essai). */
  essai?: number;
}

/** Mémoire des envois en cours sur l'appareil (localStorage sur le site et le PC). */
export interface MemoireEnvois {
  lire(cle: string): string | undefined;
  ecrire(cle: string, id: string): void;
  oublier(cle: string): void;
}

export function memoireLocale(): MemoireEnvois {
  const stockage = (globalThis as { localStorage?: { getItem(c: string): string | null; setItem(c: string, v: string): void; removeItem(c: string): void } }).localStorage;
  const sur = <T>(f: () => T, repli: T): T => {
    try {
      return f();
    } catch {
      return repli;
    }
  };
  return {
    lire: cle => sur(() => stockage?.getItem(cle) ?? undefined, undefined),
    ecrire: (cle, id) => sur(() => stockage?.setItem(cle, id), undefined),
    oublier: cle => sur(() => stockage?.removeItem(cle), undefined),
  };
}

export const ESSAIS_MAX = 6;
const attendreDefaut = (ms: number) => new Promise<void>(ok => setTimeout(ok, ms));

/** Clé de reprise d'un fichier : même serveur, même team, même usage, même fichier. */
export function cleReprise(client: ClientEsport, teamId: string, section: SectionEnvoi, f: FichierLocal): string {
  return `esport-envoi|${client.config.adresse}|${teamId}|${section}|${f.nom}|${f.taille}|${f.derniereModif ?? 0}`;
}

/** SHA-256 d'un morceau (WebCrypto si possible, sinon le calcul maison). */
export async function empreinteMorceau(octets: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(algo: string, donnees: ArrayBuffer): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (subtle) {
    const d = new Uint8Array(await subtle.digest('SHA-256', octets as unknown as ArrayBuffer));
    return Array.from(d, x => x.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(octets);
}

const annule = () => new ErreurEsport(tr('client.envoi_annule'), 0, 'annule');
const reessayable = (e: unknown) => e instanceof ErreurEsport && (e.statut === 0 || e.statut >= 500 || e.statut === 429 || e.code === 'empreinte-morceau' || e.code === 'envoi-concurrent') && e.code !== 'annule';

export interface OptionsEnvoi {
  client: ClientEsport;
  teamId: string;
  section: SectionEnvoi;
  fichier: FichierLocal;
  onProgression?(p: Progression): void;
  signal?: { aborted: boolean };
  memoire?: MemoireEnvois;
  attendre?(ms: number): Promise<void>;
  maintenant?(): number;
}

/**
 * Envoie (ou reprend) un fichier ; rend l'état terminé (analyse du média comprise) et `oublier()`, à
 * appeler une fois le fichier rattaché (review créée, réunion déposée).
 */
export async function envoyerFichier({ client, teamId, section, fichier, onProgression, signal, memoire = memoireLocale(), attendre = attendreDefaut, maintenant = Date.now }: OptionsEnvoi): Promise<{ etat: EtatEnvoi; oublier(): void }> {
  const base =
    section === 'cm'
      ? `/cm/portees/${encodeURIComponent(teamId)}/envois`
      : section === 'drive'
        ? `/cm/drive/portees/${encodeURIComponent(teamId)}/envois`
        : `/teams/${encodeURIComponent(teamId)}/${section}/envois`;
  const cle = cleReprise(client, teamId, section, fichier);
  const oublier = () => memoire.oublier(cle);
  const verifierAnnulation = () => {
    if (signal?.aborted) throw annule();
  };
  const progres = (p: Omit<Progression, 'total'>) => onProgression?.({ ...p, total: fichier.taille });

  progres({ phase: 'preparation', octets: 0, morceau: 0, morceaux: 0 });
  let etat: EtatEnvoi | undefined;
  const connu = memoire.lire(cle);
  if (connu) {
    try {
      const lu = await client.requete<EtatEnvoi>(`${base}/${encodeURIComponent(connu)}`);
      if (lu.taille === fichier.taille && !lu.rattache) etat = lu;
      else oublier();
    } catch (e) {
      if (!(e instanceof ErreurEsport) || e.statut !== 404) throw e;
      oublier();
    }
  }
  if (etat?.statut === 'termine') {
    progres({ phase: 'termine', octets: fichier.taille, morceau: etat.morceaux, morceaux: etat.morceaux });
    return { etat, oublier };
  }
  if (!etat) {
    etat = await client.requete<EtatEnvoi>(base, 'POST', { nom: fichier.nom, taille: fichier.taille, type: fichier.type });
    memoire.ecrire(cle, etat.id);
  }
  const chemin = `${base}/${encodeURIComponent(etat.id)}`;
  const { tailleMorceau, morceaux } = etat;
  const tranche = (i: number) => fichier.lire(i * tailleMorceau, Math.min(fichier.taille, (i + 1) * tailleMorceau));

  try {
    // Empreinte du fichier entier : recalculée sur ce qui est déjà parti (reprise), sans rien renvoyer.
    let empreinte: EtatSha256 = nouvelEtat();
    const rattraper = async (jusqua: number) => {
      empreinte = nouvelEtat();
      for (let i = 0; i < jusqua; i++) {
        verifierAnnulation();
        ajouter(empreinte, await tranche(i));
        progres({ phase: 'reprise', octets: Math.min(fichier.taille, (i + 1) * tailleMorceau), morceau: i + 1, morceaux });
      }
    };
    let i = etat.recus;
    await rattraper(i);
    const debut = maintenant();
    const dejaLa = i * tailleMorceau;
    while (i < morceaux) {
      verifierAnnulation();
      const octets = await tranche(i);
      const sha = await empreinteMorceau(octets);
      let essai = 0;
      for (;;) {
        try {
          await client.binaire<EtatEnvoi>(`${chemin}/morceaux/${i}`, 'PUT', octets, { 'X-Sha256': sha }, { signal });
          break;
        } catch (e) {
          verifierAnnulation();
          if (e instanceof ErreurEsport && e.code === 'morceau-hors-ordre') {
            // Le serveur attend un autre morceau (réponse perdue) : on se recale sur lui.
            const attendu = Number((e.details as { attendu?: number } | undefined)?.attendu ?? (await client.requete<EtatEnvoi>(chemin)).recus);
            await rattraper(attendu);
            i = attendu - 1;
            break;
          }
          essai++;
          if (!reessayable(e) || essai >= ESSAIS_MAX) throw e;
          progres({ phase: 'envoi', octets: i * tailleMorceau, morceau: i, morceaux, essai });
          await attendre(Math.min(30_000, 1000 * 2 ** (essai - 1)));
        }
      }
      if (i >= 0 && i < morceaux) {
        // Morceau accepté : il entre dans l'empreinte du fichier.
        if (empreinte.longueur === i * tailleMorceau) ajouter(empreinte, octets);
      }
      i++;
      const envoyes = Math.min(fichier.taille, i * tailleMorceau);
      const duree = (maintenant() - debut) / 1000;
      progres({ phase: 'envoi', octets: envoyes, morceau: i, morceaux, debit: duree > 0.5 ? (envoyes - dejaLa) / duree : undefined });
    }
    verifierAnnulation();
    progres({ phase: 'verification', octets: fichier.taille, morceau: morceaux, morceaux });
    const fini = await client.requete<EtatEnvoi>(`${chemin}/fin`, 'POST', { sha256: terminer(empreinte) });
    progres({ phase: 'termine', octets: fichier.taille, morceau: morceaux, morceaux });
    return { etat: fini, oublier };
  } catch (e) {
    if (e instanceof ErreurEsport && e.code === 'annule') {
      // Annulation demandée : l'envoi est effacé sur le serveur (best effort) et oublié ici.
      await client.requete(chemin, 'DELETE').catch(() => undefined);
      oublier();
    }
    // Fichier refusé (format, empreinte du fichier) : l'envoi n'existe plus, rien à reprendre.
    if (e instanceof ErreurEsport && ['format-video', 'format-fichier', 'empreinte-fichier', 'envoi-introuvable', 'morceau-different'].includes(e.code)) oublier();
    throw e;
  }
}

/** Taille lisible : 1536 → « 1,5 Ko », 10 Go… (unités françaises ou anglaises). */
export function tailleMedia(octets: number, langue: 'fr' | 'en' = 'fr'): string {
  const unites = langue === 'en' ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['o', 'Ko', 'Mo', 'Go', 'To'];
  let n = Math.max(0, octets);
  let u = 0;
  while (n >= 1024 && u < unites.length - 1) {
    n /= 1024;
    u++;
  }
  const texte = u === 0 ? String(Math.round(n)) : n >= 100 ? n.toFixed(0) : n.toFixed(1);
  return `${langue === 'en' ? texte : texte.replace('.', ',')} ${unites[u]}`;
}
