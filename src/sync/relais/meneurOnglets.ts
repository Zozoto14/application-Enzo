/**
 * Un seul onglet « meneur » par navigateur (et par appareil pour l'app de bureau : ses fenêtres
 * partagent la même origine) écoute le serveur ; il relaie ce qu'il apprend aux autres onglets.
 *
 * Avant : chaque onglet ouvert tenait sa propre connexion d'écoute (5 onglets = 5 connexions longues
 * vers le même serveur, depuis la même adresse : de quoi faire bannir l'adresse par le pare-feu d'un
 * hébergement mutualisé). Maintenant : au plus UNE par navigateur.
 *
 *  - Élection par Web Locks (`navigator.locks`, verrou exclusif nommé) : le premier onglet VISIBLE qui
 *    demande le verrou devient meneur ; les autres attendent en file. Un onglet masqué rend le verrou
 *    (`renoncer`) : le suivant visible prend la suite. Un onglet fermé ou planté le rend aussi (le
 *    navigateur libère les verrous de la page).
 *  - Messages par `BroadcastChannel` (même origine) : `version` (le meneur a appris une révision),
 *    `ecrit` (un onglet vient d'envoyer ses modifications : les autres relisent tout de suite, sans
 *    attendre le serveur).
 *  - Sans Web Locks (vieux navigateur, app iPhone) : l'onglet se croit seul et mène (comportement
 *    d'avant) ; sans BroadcastChannel : pas de relais, chaque onglet garde son tour de filet.
 */

export type MessageOnglets = { type: 'version'; rev: number } | { type: 'ecrit' };

/** Le strict nécessaire de `navigator.locks` (LockManager). */
export interface VerrousWeb {
  request(nom: string, options: { mode?: 'exclusive'; signal?: AbortSignal }, rappel: (verrou: unknown) => Promise<unknown>): Promise<unknown>;
}

/** Le strict nécessaire de `BroadcastChannel`. */
export interface CanalOnglets {
  postMessage(message: unknown): void;
  onmessage: ((evenement: { data: unknown }) => void) | null;
  close(): void;
}

export interface OptionsMeneur {
  /** Nom du verrou et du canal (un par relais et par compte). */
  nom: string;
  /** Message d'un autre onglet. */
  surMessage(message: MessageOnglets): void;
  /** `navigator.locks` ; `null` : pas de coordination (cet onglet mène seul). Défaut : celui du navigateur. */
  verrous?: VerrousWeb | null;
  /** Fabrique du canal ; défaut : `BroadcastChannel` du navigateur s'il existe. */
  creerCanal?: ((nom: string) => CanalOnglets | undefined) | null;
}

const globale = globalThis as unknown as { navigator?: { locks?: VerrousWeb }; BroadcastChannel?: new (nom: string) => CanalOnglets };

export const verrousDuNavigateur = (): VerrousWeb | null => {
  const v = globale.navigator?.locks;
  return v && typeof v.request === 'function' ? v : null;
};
export const canalDuNavigateur = (nom: string): CanalOnglets | undefined => {
  try {
    return typeof globale.BroadcastChannel === 'function' ? new globale.BroadcastChannel(nom) : undefined;
  } catch {
    return undefined;
  }
};

const estMessage = (d: unknown): d is MessageOnglets => {
  const m = d as { type?: unknown; rev?: unknown } | null;
  return !!m && ((m.type === 'version' && typeof m.rev === 'number' && Number.isFinite(m.rev)) || m.type === 'ecrit');
};

export class MeneurOnglets {
  private readonly verrous: VerrousWeb | null;
  private readonly canal: CanalOnglets | undefined;
  private candidat = false;
  private meneur = false;
  private controle: AbortController | undefined;
  private relacher: (() => void) | undefined;
  private arret: (() => void) | undefined;
  private ferme = false;

  constructor(private readonly o: OptionsMeneur) {
    this.verrous = o.verrous === undefined ? verrousDuNavigateur() : o.verrous;
    this.canal = o.creerCanal === null ? undefined : (o.creerCanal ?? canalDuNavigateur)(`appdashboard-synchro:${o.nom}`);
    if (this.canal) {
      this.canal.onmessage = e => {
        if (!this.ferme && estMessage(e.data)) o.surMessage(e.data);
      };
    }
  }

  /** Cet onglet mène-t-il (tient-il l'écoute du serveur) ? */
  get estMeneur(): boolean {
    return this.meneur;
  }

  /** Cet onglet attend-il ou tient-il le verrou ? */
  get estCandidat(): boolean {
    return this.candidat;
  }

  /**
   * Se porte candidat : `mener()` est appelé quand cet onglet devient meneur (tout de suite s'il est
   * seul) et rend la fonction qui arrête l'écoute, appelée à `renoncer()` ou `fermer()`.
   */
  briguer(mener: () => () => void): void {
    if (this.candidat || this.ferme) return;
    this.candidat = true;
    const prendre = () => {
      this.meneur = true;
      try {
        this.arret = mener();
      } catch {
        this.arret = undefined;
      }
    };
    if (!this.verrous) {
      prendre();
      return;
    }
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    this.controle = controle;
    this.verrous
      .request(`appdashboard-synchro:${this.o.nom}`, { mode: 'exclusive', signal: controle?.signal }, () => {
        if (!this.candidat || this.controle !== controle) return Promise.resolve();
        prendre();
        // Le verrou est tenu tant que cette promesse n'est pas résolue.
        return new Promise<void>(ok => {
          this.relacher = ok;
        });
      })
      .catch(() => undefined);
  }

  /** Rend la main (onglet masqué, verrouillé) : arrête l'écoute, libère le verrou ou quitte la file. */
  renoncer(): void {
    if (!this.candidat) return;
    this.candidat = false;
    const arret = this.arret;
    this.arret = undefined;
    this.meneur = false;
    try {
      arret?.();
    } catch {
      // Déjà arrêtée.
    }
    const relacher = this.relacher;
    this.relacher = undefined;
    if (relacher) relacher();
    else this.controle?.abort();
    this.controle = undefined;
  }

  /** Prévient les autres onglets (jamais soi-même). */
  diffuser(message: MessageOnglets): void {
    if (this.ferme) return;
    try {
      this.canal?.postMessage(message);
    } catch {
      // Canal fermé.
    }
  }

  fermer(): void {
    this.renoncer();
    this.ferme = true;
    try {
      this.canal?.close();
    } catch {
      // Déjà fermé.
    }
  }
}
