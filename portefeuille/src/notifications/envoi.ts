/**
 * Envoi des notifications.
 *
 * Le contenu est décidé ailleurs (`briefing.ts`) ; ce module ne fait que le
 * remettre au système. La séparation permet d'éprouver tout le texte affiché
 * sans module natif, et de changer de bibliothèque sans toucher à la logique.
 *
 * Un identifiant stable accompagne chaque notification : un second briefing du
 * même jour **remplace** le premier au lieu de s'empiler. Trois notifications
 * identiques dans le centre de notifications, et l'utilisateur coupe tout.
 */

export interface Notification {
  identifiant: string;
  titre: string;
  corps: string;
}

export interface CanalNotifications {
  /** Faux si le module natif n'est pas dans le binaire. */
  disponible: boolean;
  /** Demande l'autorisation ; `false` si l'utilisateur refuse. */
  demanderPermission(): Promise<boolean>;
  afficher(notification: Notification): Promise<void>;
  annuler(identifiant: string): Promise<void>;
}

/** Identifiant du canal Android. Ignoré sur iOS, mais obligatoire côté Android. */
const CANAL_ANDROID = 'portefeuille';

/**
 * Adapte @notifee/react-native, s'il est présent dans le binaire.
 * Renvoie `undefined` sinon : l'interface doit pouvoir dire que les
 * notifications sont indisponibles plutôt que d'échouer en silence.
 */
export function canalDepuisNotifee(moduleNotifee: unknown): CanalNotifications | undefined {
  if (!moduleNotifee || typeof moduleNotifee !== 'object') {
    return undefined;
  }

  const brut = moduleNotifee as Record<string, any>;
  // Notifee s'exporte par défaut ; selon l'interopérabilité des modules, il
  // arrive sous `default` ou directement.
  const notifee = (brut.default ?? brut) as Record<string, any>;

  if (typeof notifee.displayNotification !== 'function') {
    return undefined;
  }

  let canalPret = false;

  return {
    disponible: true,

    async demanderPermission(): Promise<boolean> {
      const reponse = await notifee.requestPermission?.();
      // Sur iOS, `authorizationStatus` vaut 1 (autorisé) ou 2 (provisoire).
      // Une absence de réponse vaut acceptation : c'est le cas d'Android,
      // où l'autorisation n'est pas toujours demandée.
      const statut = reponse?.authorizationStatus;
      return statut === undefined || statut >= 1;
    },

    async afficher(notification: Notification): Promise<void> {
      if (!canalPret && typeof notifee.createChannel === 'function') {
        await notifee.createChannel({ id: CANAL_ANDROID, name: 'Portefeuille' });
        canalPret = true;
      }

      await notifee.displayNotification({
        id: notification.identifiant,
        title: notification.titre,
        body: notification.corps,
        android: { channelId: CANAL_ANDROID },
      });
    },

    async annuler(identifiant: string): Promise<void> {
      await notifee.cancelNotification?.(identifiant);
    },
  };
}

/** Canal en mémoire, pour les tests. */
export function canalMemoire(): CanalNotifications & {
  envoyees: Notification[];
  permissionAccordee: boolean;
} {
  const etat = {
    envoyees: [] as Notification[],
    permissionAccordee: true,
  };

  return {
    ...etat,
    get envoyees() {
      return etat.envoyees;
    },
    get permissionAccordee() {
      return etat.permissionAccordee;
    },
    set permissionAccordee(valeur: boolean) {
      etat.permissionAccordee = valeur;
    },
    disponible: true,
    demanderPermission: async () => etat.permissionAccordee,
    afficher: async notification => {
      // Même comportement que le système : un identifiant déjà présent
      // remplace au lieu de s'ajouter.
      const existante = etat.envoyees.findIndex(
        n => n.identifiant === notification.identifiant,
      );
      if (existante === -1) {
        etat.envoyees.push(notification);
      } else {
        etat.envoyees[existante] = notification;
      }
    },
    annuler: async identifiant => {
      etat.envoyees = etat.envoyees.filter(n => n.identifiant !== identifiant);
    },
  };
}

/** Canal inerte, quand le module natif manque. */
export const CANAL_INDISPONIBLE: CanalNotifications = {
  disponible: false,
  demanderPermission: async () => false,
  afficher: async () => undefined,
  annuler: async () => undefined,
};
