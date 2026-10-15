/**
 * Parallélisme borné et annulation, en JavaScript pur (même comportement sous
 * Metro, Vite et Jest) : les recherches d'une source (variantes du titre) et
 * les sources entre elles partent ensemble au lieu de s'attendre, sans rien
 * changer à ce que le moteur RETIENT.
 *
 * - `courseOrdonnee` : les tâches partent par paquets, mais leurs résultats
 *   sont VALIDÉS DANS L'ORDRE ; dès qu'un résultat validé suffit, les suivantes
 *   sont annulées. Le résultat est exactement celui d'une boucle séquentielle,
 *   le temps d'attente des requêtes se recouvrant. La première tâche part seule
 *   et n'est doublée qu'au bout de `relaisMs` (ou dès sa fin) : un site qui
 *   répond vite (souvent la première variante suffit, ou le site bloque) ne
 *   reçoit pas de requêtes inutiles.
 * - `courseAvecPriorite` : sources dans leur ordre de priorité, en parallèle
 *   (la première seule pendant `relaisMs` : si elle trouve vite, les autres ne
 *   sont jamais interrogées) ; la première (dans l'ordre) qui trouve l'emporte. Une source moins
 *   prioritaire qui a trouvé n'attend une source plus prioritaire encore en
 *   cours que `graceMs` ; au-delà, elle l'emporte et les autres sont annulées.
 */

import { echec } from './erreurs';
import type { ClientSur } from './reseau';

/** Signal d'annulation minimal (AbortSignal n'est pas garanti partout). */
export interface SignalAnnulation {
  readonly annule: boolean;
  /** Appelle `fn` à l'annulation (tout de suite si déjà annulé) ; rend de quoi se désabonner. */
  surAnnulation(fn: () => void): () => void;
}

export interface Annulation {
  signal: SignalAnnulation;
  annuler(): void;
}

/** Une annulation, éventuellement liée à un signal parent (annulé avec lui). */
export function creerAnnulation(parent?: SignalAnnulation): Annulation {
  let annule = false;
  const ecouteurs = new Set<() => void>();
  const annuler = () => {
    if (annule) return;
    annule = true;
    for (const fn of [...ecouteurs]) {
      try {
        fn();
      } catch {
        // Un écouteur fautif n'empêche pas les autres.
      }
    }
    ecouteurs.clear();
  };
  parent?.surAnnulation(annuler);
  return {
    annuler,
    signal: {
      get annule() {
        return annule;
      },
      surAnnulation(fn) {
        if (annule) {
          fn();
          return () => undefined;
        }
        ecouteurs.add(fn);
        return () => ecouteurs.delete(fn);
      },
    },
  };
}

export const MESSAGE_ANNULE = 'Requête annulée (un autre résultat a suffi)';

/** Rejette dès l'annulation ; sinon la promesse telle quelle. */
export function sauf<T>(promesse: Promise<T>, signal?: SignalAnnulation): Promise<T> {
  if (!signal) return promesse;
  if (signal.annule) return Promise.reject(echec(MESSAGE_ANNULE, 'annule', 499));
  let desabonner = () => undefined as unknown;
  const arret = new Promise<never>((_, rejeter) => {
    desabonner = signal.surAnnulation(() => rejeter(echec(MESSAGE_ANNULE, 'annule', 499)));
  });
  return Promise.race([promesse, arret]).finally(() => desabonner());
}

export interface OptionsCourseOrdonnee {
  /** Tâches en vol au plus. */
  simultanees: number;
  /** La première tâche part seule pendant ce délai (ms) ; 0 : tout part ensemble. */
  relaisMs?: number;
  signal?: SignalAnnulation;
}

/**
 * Lance `taches` (parallélisme borné) et VALIDE leurs résultats dans l'ordre :
 * `valider(resultat, i)` est appelé pour 0, 1, 2… exactement comme dans une
 * boucle séquentielle ; s'il rend vrai, les tâches suivantes sont annulées
 * (jamais validées). Rend le nombre de résultats validés.
 */
export async function courseOrdonnee<T>(
  taches: ReadonlyArray<(signal: SignalAnnulation) => Promise<T>>,
  valider: (resultat: T, i: number) => boolean,
  o: OptionsCourseOrdonnee,
): Promise<{ valides: number; arrete: boolean }> {
  const n = taches.length;
  if (!n) return { valides: 0, arrete: false };
  const global = creerAnnulation(o.signal);
  const promesses: Array<Promise<{ ok: true; v: T } | { ok: false; e: unknown }>> = [];
  const reglees = new Set<number>();
  let lancees = 0;
  let enVol = 0;
  const simultanees = Math.max(1, o.simultanees);
  let premiereSeule = (o.relaisMs ?? 0) > 0;
  const lancer = () => {
    const i = lancees++;
    const a = creerAnnulation(global.signal);
    enVol += 1;
    promesses[i] = Promise.resolve()
      .then(() => taches[i](a.signal))
      .then(
        v => ({ ok: true as const, v }),
        e => ({ ok: false as const, e }),
      )
      .finally(() => {
        enVol -= 1;
        reglees.add(i);
      });
  };
  const remplir = () => {
    while (!global.signal.annule && lancees < n && enVol < (premiereSeule ? 1 : simultanees)) lancer();
  };
  remplir();
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  if (premiereSeule && n > 1) {
    minuteur = setTimeout(() => {
      premiereSeule = false;
      remplir();
    }, o.relaisMs);
  }
  try {
    for (let i = 0; i < n; i += 1) {
      if (i >= lancees) {
        // Toutes les tâches lancées sont validées : la suivante part (sauf annulation venue d'en haut).
        premiereSeule = false;
        remplir();
        if (i >= lancees) throw echec(MESSAGE_ANNULE, 'annule', 499);
      }
      const r = await promesses[i];
      // La tâche i est finie : la première n'est plus seule, les suivantes peuvent partir.
      premiereSeule = false;
      if (!r.ok) throw r.e;
      if (valider(r.v, i)) {
        return { valides: i + 1, arrete: true };
      }
      // La suivante a déjà répondu : on la valide avant d'en lancer d'autres (pas de requête inutile).
      if (!reglees.has(i + 1)) remplir();
    }
    return { valides: n, arrete: false };
  } finally {
    if (minuteur) clearTimeout(minuteur);
    // Rien ne reste en vol au-delà de ce qui a été validé.
    global.annuler();
  }
}

export interface IssueSource<T> {
  i: number;
  resultat?: T;
  erreur?: unknown;
  /** Annulée : une autre source l'a emporté avant sa fin. */
  interrompue?: boolean;
}

/**
 * Sources en parallèle (au plus `simultanees`), dans leur ordre de priorité :
 * `gagne(resultat)` dit si une source a trouvé. La gagnante est la première
 * DANS L'ORDRE qui a trouvé, une fois toutes les plus prioritaires finies ;
 * sinon, si une moins prioritaire a trouvé et que les plus prioritaires
 * tardent encore `graceMs` après elle, c'est elle (les autres sont annulées).
 * Rend une issue par source lancée, dans l'ordre, et l'indice gagnant.
 */
export async function courseAvecPriorite<T>(
  taches: ReadonlyArray<(signal: SignalAnnulation) => Promise<T>>,
  gagne: (resultat: T) => boolean,
  o: {
    simultanees: number;
    graceMs: number;
    relaisMs?: number;
    signal?: SignalAnnulation;
    /** Une source moins prioritaire a trouvé, les plus prioritaires cherchent encore : résultat provisoire. */
    surProvisoire?: (resultat: T, i: number) => void;
    /**
     * Temps TYPIQUE d'une page de la source i (mesuré sur l'appareil), s'il est
     * connu. Quand une moins prioritaire a trouvé et que TOUTES les plus
     * prioritaires encore en cours sont connues pour ne pas pouvoir finir dans
     * le délai de grâce (temps typique restant > 1,5 × `graceMs`, sans compter
     * leurs pages suivantes), attendre ne servirait à rien : la décision est
     * prise tout de suite (`abregee`).
     */
    dureeTypiqueMs?: (i: number) => number | undefined;
  },
): Promise<{ issues: IssueSource<T>[]; gagnante: number | null; abregee?: boolean }> {
  const n = taches.length;
  const issues: IssueSource<T>[] = [];
  if (!n) return { issues, gagnante: null };
  const global = creerAnnulation(o.signal);
  const finies = new Set<number>();
  let lancees = 0;
  let enVol = 0;
  let fin: ((g: number | null) => void) | null = null;
  const termine = new Promise<number | null>(ok => (fin = ok));
  let grace: ReturnType<typeof setTimeout> | undefined;
  let candidate: number | null = null;
  let abregee = false;
  const debuts: number[] = [];
  /** Les plus prioritaires que `c`, encore en cours, sont toutes connues pour être trop lentes pour finir dans le délai de grâce. */
  const attenteInutile = (c: number) => {
    if (!o.dureeTypiqueMs) return false;
    for (let j = 0; j < c; j += 1) {
      if (finies.has(j)) continue;
      if (j >= lancees) return false;
      let typique: number | undefined;
      try {
        typique = o.dureeTypiqueMs(j);
      } catch {
        typique = undefined;
      }
      if (typique === undefined || !Number.isFinite(typique)) return false;
      if (typique - (Date.now() - debuts[j]) <= o.graceMs * 1.5) return false;
    }
    return true;
  };
  const decider = (force = false) => {
    if (!fin) return;
    // Première source (dans l'ordre) qui a trouvé, si toutes celles d'avant sont finies.
    for (let i = 0; i < n; i += 1) {
      if (!finies.has(i)) {
        if (force && candidate != null && i < candidate) {
          const f = fin;
          fin = null;
          f(candidate);
          return;
        }
        break;
      }
      if (issues[i]?.resultat !== undefined && gagne(issues[i].resultat as T)) {
        const f = fin;
        fin = null;
        f(i);
        return;
      }
    }
    if (finies.size === n) {
      const f = fin;
      fin = null;
      f(null);
    }
  };
  const lancer = () => {
    const i = lancees++;
    const a = creerAnnulation(global.signal);
    enVol += 1;
    debuts[i] = Date.now();
    void Promise.resolve()
      .then(() => taches[i](a.signal))
      .then(
        v => (issues[i] = { i, resultat: v }),
        e => (issues[i] = { i, erreur: e }),
      )
      .finally(() => {
        enVol -= 1;
        finies.add(i);
        const r = issues[i]?.resultat;
        if (r !== undefined && gagne(r) && (candidate == null || i < candidate)) {
          candidate = i;
          if (!grace && o.graceMs >= 0) grace = setTimeout(() => decider(true), o.graceMs);
        }
        premiereSeule = false;
        decider();
        if (fin && candidate === i && attenteInutile(i)) {
          abregee = true;
          decider(true);
        }
        // Pas encore décidé : la meilleure trouvaille jusqu'ici peut déjà s'afficher.
        if (fin && candidate === i && o.surProvisoire) {
          try {
            o.surProvisoire(r as T, i);
          } catch {
            // L'affichage provisoire ne doit jamais casser la recherche.
          }
        }
        if (fin) remplir();
      });
  };
  // La première source part seule pendant `relaisMs` (ou jusqu'à sa fin) : une source prioritaire
  // qui répond vite ne fait partir aucune requête vers les autres.
  let premiereSeule = (o.relaisMs ?? 0) > 0;
  const remplir = () => {
    while (lancees < n && enVol < (premiereSeule ? 1 : Math.max(1, o.simultanees)) && !global.signal.annule) lancer();
  };
  remplir();
  const relais =
    premiereSeule && n > 1
      ? setTimeout(() => {
          premiereSeule = false;
          if (fin) remplir();
        }, o.relaisMs)
      : undefined;
  const gagnante = await termine;
  if (grace) clearTimeout(grace);
  if (relais) clearTimeout(relais);
  global.annuler();
  // Les sources lancées et pas finies (ou finies après la décision) sont dites interrompues.
  const sortie: IssueSource<T>[] = [];
  for (let i = 0; i < lancees; i += 1) {
    sortie.push(finies.has(i) && issues[i] ? issues[i] : { i, interrompue: true });
  }
  return { issues: sortie, gagnante, ...(abregee && gagnante != null ? { abregee: true } : {}) };
}

/**
 * Le même client, annulable : plus aucune requête ne part après l'annulation,
 * et celle en cours est abandonnée (sa réponse est ignorée).
 */
export function clientAnnulable(client: ClientSur, signal?: SignalAnnulation): ClientSur {
  if (!signal) return client;
  // Déjà annulé : la requête ne part pas du tout.
  const garde = <T>(appel: () => Promise<T>): Promise<T> => (signal.annule ? Promise.reject(echec(MESSAGE_ANNULE, 'annule', 499)) : sauf(appel(), signal));
  return {
    obtenir: (url, appel) => garde(() => client.obtenir(url, appel)),
    texte: (url, appel) => garde(() => client.texte(url, appel)),
    json: <T>(url: string, appel?: Parameters<ClientSur['json']>[1]) => garde(() => client.json<T>(url, appel)),
    envoyerJson: <T>(url: string, corps: unknown, appel?: Parameters<ClientSur['envoyerJson']>[2]) => garde(() => client.envoyerJson<T>(url, corps, appel)),
    envoyerFormulaire: (url, corps, appel) => garde(() => client.envoyerFormulaire(url, corps, appel)),
  };
}
