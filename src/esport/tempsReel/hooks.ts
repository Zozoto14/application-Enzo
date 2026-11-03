/**
 * Hooks du temps réel (docs/esport/temps-reel.md), réutilisables par tous les écrans de l'Esport :
 *
 *  - `useTempsReel(client, sujets, surChangement)` : appelle `surChangement` (regroupé sur ~120 ms) quand un
 *    autre a modifié quelque chose dans ces sujets (`team:<id>:planning`, `cm`, `cm:drive`, `sponsors`,
 *    `trombi`, `compte`… ; `team:<id>:*` = toute la team). Rend l'état du canal (« En direct »…) ;
 *  - `useEtatTempsReel(client)` : l'état seul (indicateur) ;
 *  - `useRelectureSecours(etat, relire, ms)` : relecture lente (60 s) quand le canal n'est PAS en direct ;
 *  - `useVerrouOptimiste(client, chemin)` : « le premier qui enregistre a la main » sur une fiche ouverte :
 *    version lue (envoyée avec chaque modification), « X a modifié cet élément il y a N s », conflit 409,
 *    présence (« X est en train de modifier ») annoncée et reçue.
 *
 * Une seule connexion par navigateur quel que soit le nombre d'écrans ou d'onglets (transport.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErreurEsport, noterVersionLue, suivreVersions, versionLue, type ClientEsport } from '../client';
import { CanalEsport, appareilDuNavigateur, type EtatCanal, type LotTempsReel, type MessageTempsReel } from './transport';

/** Délai de regroupement des messages avant `surChangement` (une rafale de déplacements = une relecture). */
export const REGROUPEMENT_MS = 120;
/** Relecture de secours quand le canal n'est pas en direct. */
export const SECOURS_MS = 60_000;
/** Battement de la présence « en train de modifier » (le serveur l'oublie au bout de 45 s). */
export const BATTEMENT_PRESENCE_MS = 20_000;

/** Empreinte courte (FNV-1a) : nom du verrou et du canal sans jamais y mettre un jeton. */
function empreinte(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const canaux = new Map<string, { canal: CanalEsport; disponible?: Promise<boolean> }>();

/** Fabrique remplaçable par les tests. */
export const fabriqueCanal = {
  creer: (client: ClientEsport, cle: string): CanalEsport =>
    new CanalEsport({
      cle,
      appareil: appareilDuNavigateur(),
      source: { adresse: client.config.adresse, jeton: forcer => client.jetonSession!(forcer) },
    }),
};

/** Canal partagé de ce client (un par serveur et par compte), ou undefined si le client ne sait pas l'ouvrir. */
export function canalPour(client: ClientEsport | undefined): { canal: CanalEsport; disponible: Promise<boolean> } | undefined {
  if (!client?.jetonSession) return undefined;
  const cle = empreinte(`${client.config.adresse}|${client.config.jetonRelais}`);
  let e = canaux.get(cle);
  if (!e) {
    e = { canal: fabriqueCanal.creer(client, cle) };
    canaux.set(cle, e);
  }
  e.disponible ??= (client.tempsReelDisponible?.() ?? Promise.resolve(true)).catch(() => {
    if (e) e.disponible = undefined;
    return false;
  });
  return e as { canal: CanalEsport; disponible: Promise<boolean> };
}

/** Tests : oublie les canaux (fermés). */
export function oublierCanaux(): void {
  for (const { canal } of canaux.values()) canal.fermer();
  canaux.clear();
}

export type Sujets = string | readonly string[] | ((sujet: string, m: MessageTempsReel) => boolean);

/** Le message concerne-t-il ces sujets ? (`x:*` : x et tout ce qui commence par `x:`) */
export function concerne(sujets: Sujets, m: MessageTempsReel): boolean {
  if (typeof sujets === 'function') return sujets(m.sujet, m);
  const liste = typeof sujets === 'string' ? [sujets] : sujets;
  return liste.some(s => (s.endsWith(':*') ? m.sujet === s.slice(0, -2) || m.sujet.startsWith(s.slice(0, -1)) : m.sujet === s));
}

export interface OptionsTempsReel {
  actif?: boolean;
  /** Ignorer ses propres écritures (l'écran s'est déjà mis à jour) : compte de l'utilisateur. */
  moi?: string;
  regroupementMs?: number;
}

/** État du canal (indicateur « En direct » / « Reconnexion… »). */
export function useEtatTempsReel(client: ClientEsport | undefined): EtatCanal {
  const [etat, setEtat] = useState<EtatCanal>(() => canalPour(client)?.canal.etat ?? 'indisponible');
  useEffect(() => {
    const e = canalPour(client);
    if (!e) {
      setEtat('indisponible');
      return undefined;
    }
    setEtat(e.canal.etat);
    return e.canal.suivreEtat(setEtat);
  }, [client]);
  return etat;
}

/**
 * Appelle `surChangement(messages, reinitialiser)` quand quelque chose a changé dans ces sujets (messages
 * regroupés). Rend l'état du canal.
 */
export function useTempsReel(client: ClientEsport | undefined, sujets: Sujets, surChangement: (messages: MessageTempsReel[], reinitialiser: boolean) => void, options: OptionsTempsReel = {}): EtatCanal {
  const { actif = true, moi, regroupementMs = REGROUPEMENT_MS } = options;
  const rappel = useRef(surChangement);
  rappel.current = surChangement;
  const filtre = useRef(sujets);
  filtre.current = sujets;
  const etat = useEtatTempsReel(client);
  useEffect(() => {
    if (!actif) return undefined;
    const e = canalPour(client);
    if (!e) return undefined;
    let fini = false;
    let arreter: (() => void) | undefined;
    let tampon: MessageTempsReel[] = [];
    let reinit = false;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const vider = () => {
      minuterie = undefined;
      const lot = tampon;
      const r = reinit;
      tampon = [];
      reinit = false;
      if (!fini && (lot.length || r)) rappel.current(lot, r);
    };
    const surLot = (lot: LotTempsReel) => {
      const utiles = lot.messages.filter(m => m.type === 'maj' && concerne(filtre.current, m) && !(moi && m.acteur === moi));
      if (!utiles.length && !lot.reinitialiser) return;
      tampon.push(...utiles);
      reinit ||= lot.reinitialiser;
      if (minuterie === undefined) minuterie = setTimeout(vider, regroupementMs);
    };
    void e.disponible.then(ok => {
      if (ok && !fini) arreter = e.canal.ecouter(surLot);
    });
    return () => {
      fini = true;
      if (minuterie !== undefined) clearTimeout(minuterie);
      arreter?.();
    };
  }, [client, actif, moi, regroupementMs]);
  return etat;
}

/** Relecture lente de secours (60 s) tant que le canal n'est pas en direct (sondage, coupure, ancien serveur). */
export function useRelectureSecours(etat: EtatCanal, relire: () => void, ms: number = SECOURS_MS, actif = true): void {
  const rappel = useRef(relire);
  rappel.current = relire;
  useEffect(() => {
    if (!actif || etat === 'direct') return undefined;
    const id = setInterval(() => rappel.current(), ms);
    return () => clearInterval(id);
  }, [etat, ms, actif]);
}

// ------------------------------------------------------------------ Verrou optimiste et présence

export interface Editeur {
  compte: string;
  pseudo: string | null;
  jusqua?: string;
}

export interface ChangementDistant {
  pseudo: string | null;
  /** Instant de la modification (ms). */
  le: number;
  supprime: boolean;
  version?: number;
}

export interface VerrouOptimiste {
  /** Version lue (celle envoyée avec la prochaine modification). */
  version: number | undefined;
  /** Quelqu'un d'autre a enregistré depuis l'ouverture (bandeau « X a modifié cet élément il y a N s »). */
  distant: ChangementDistant | undefined;
  /** Dernier enregistrement refusé (409) : qui, quand. */
  conflit: ChangementDistant | undefined;
  /** Autres personnes en train de modifier (pastille). */
  presences: Editeur[];
  /** À appeler dans le `catch` d'un enregistrement : vrai si c'était un conflit (bandeau affiché). */
  signalerConflit(e: unknown): boolean;
  /** Après « Recharger » : la version du serveur devient la version lue ; bandeaux effacés. */
  recharger(): Promise<void>;
  /** Bandeau fermé sans recharger. */
  ignorer(): void;
}

/**
 * Verrou optimiste et présence d'un objet ouvert en édition (`chemin` : sa route, ex. `/cm/cartes/<id>`).
 * `undefined` : rien (fiche fermée, nouvel objet pas encore créé).
 */
export function useVerrouOptimiste(client: ClientEsport | undefined, chemin: string | undefined, { presence = true }: { presence?: boolean } = {}): VerrouOptimiste {
  const [version, setVersion] = useState<number | undefined>();
  const [distant, setDistant] = useState<ChangementDistant | undefined>();
  const [conflit, setConflit] = useState<ChangementDistant | undefined>();
  const [presences, setPresences] = useState<Editeur[]>([]);
  const info = useRef<{ cle?: string; moi?: string; derniere?: number }>({});
  const adresse = client?.config.adresse;

  const lire = useCallback(async () => {
    if (!client || !chemin || !adresse) return undefined;
    const v = await client.requete<{ cle: string; moi?: string; version: number; presences?: Editeur[] }>(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`);
    info.current = { cle: v.cle, moi: v.moi, derniere: v.version };
    noterVersionLue(adresse, chemin, v.version);
    setVersion(v.version);
    setPresences((v.presences ?? []).filter(p => p.compte !== v.moi));
    return v;
  }, [client, chemin, adresse]);

  // Ouverture : version lue ; fermeture : plus d'en-tête pour cette route.
  useEffect(() => {
    if (!client || !chemin || !adresse) return undefined;
    let fini = false;
    setDistant(undefined);
    setConflit(undefined);
    setPresences([]);
    lire().catch(() => {
      // Ancien serveur (404) ou objet invisible : pas de verrou, l'écran marche comme avant.
      if (!fini) setVersion(undefined);
    });
    const arreter = suivreVersions((cle, v) => {
      if (cle === `${adresse}${chemin}`) {
        info.current.derniere = Math.max(info.current.derniere ?? 0, v);
        setVersion(v);
      }
    });
    return () => {
      fini = true;
      arreter();
      noterVersionLue(adresse, chemin, undefined);
    };
  }, [client, chemin, adresse, lire]);

  // Présence : annoncée tout de suite puis toutes les 20 s (page visible), retirée à la fermeture.
  useEffect(() => {
    if (!client || !chemin || !presence) return undefined;
    let fini = false;
    const annoncer = (etat: 'edition' | 'fin') => client.requete('/temps-reel/presence', 'POST', { chemin, etat }).catch(() => undefined);
    const visible = () => (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState !== 'hidden';
    void annoncer('edition');
    const id = setInterval(() => {
      if (!fini && visible()) void annoncer('edition');
    }, BATTEMENT_PRESENCE_MS);
    return () => {
      fini = true;
      clearInterval(id);
      void annoncer('fin');
    };
  }, [client, chemin, presence]);

  // Messages : modification par un autre (bandeau), présence des autres (pastille).
  useEffect(() => {
    const e = canalPour(client);
    if (!e || !chemin) return undefined;
    let arreter: (() => void) | undefined;
    let fini = false;
    const surLot = (lot: LotTempsReel) => {
      for (const m of lot.messages) {
        if (!info.current.cle || m.cle !== info.current.cle) continue;
        if (m.type === 'presence') {
          if (m.acteur === info.current.moi || !m.acteur) continue;
          const qui = m.acteur;
          setPresences(liste => {
            const autres = liste.filter(p => p.compte !== qui);
            return m.etat === 'fin' ? autres : [...autres, { compte: qui, pseudo: m.pseudo ?? null, jusqua: m.jusqua }];
          });
          continue;
        }
        if (m.acteur && m.acteur === info.current.moi) continue;
        const lue = adresse ? versionLue(adresse, chemin) : undefined;
        if (m.version !== undefined && lue !== undefined && m.version <= lue) continue;
        info.current.derniere = Math.max(info.current.derniere ?? 0, m.version ?? 0);
        setDistant({ pseudo: m.pseudo ?? null, le: m.t ?? Date.now(), supprime: m.action === 'supprime', version: m.version });
      }
    };
    void e.disponible.then(ok => {
      if (ok && !fini) arreter = e.canal.ecouter(surLot);
    });
    return () => {
      fini = true;
      arreter?.();
    };
  }, [client, chemin, adresse]);

  // Présences expirées (navigateur fermé sans « fin ») : retirées seules.
  useEffect(() => {
    if (!presences.length) return undefined;
    const id = setInterval(() => setPresences(l => l.filter(p => !p.jusqua || Date.parse(p.jusqua) > Date.now())), 5_000);
    return () => clearInterval(id);
  }, [presences.length]);

  const signalerConflit = useCallback((e: unknown): boolean => {
    if (!(e instanceof ErreurEsport) || e.code !== 'conflit-version') return false;
    const d = (e.details ?? {}) as { par?: { pseudo?: string | null } | null; le?: string | null; version?: number };
    setConflit({ pseudo: d.par?.pseudo ?? null, le: d.le ? Date.parse(d.le) : Date.now(), supprime: false, version: d.version });
    return true;
  }, []);

  const recharger = useCallback(async () => {
    await lire().catch(() => undefined);
    setDistant(undefined);
    setConflit(undefined);
  }, [lire]);

  const ignorer = useCallback(() => setDistant(undefined), []);

  return { version, distant, conflit, presences, signalerConflit, recharger, ignorer };
}
