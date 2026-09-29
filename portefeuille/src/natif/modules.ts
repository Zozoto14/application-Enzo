/**
 * Accès aux modules natifs, toujours optionnel.
 *
 * Contrainte qui gouverne tout ce fichier : **un seul build iOS sera possible**.
 * Ce qui n'est pas dans le binaire ce jour-là ne pourra plus y entrer. Tous les
 * modules natifs prévisibles sont donc embarqués dès maintenant, même si leur
 * fonctionnalité n'est pas encore écrite — le code qui les utilise, lui,
 * pourra arriver plus tard par mise à jour JavaScript.
 *
 * Chaque module est chargé paresseusement, dans un `try`. Trois raisons :
 *
 *  1. si l'un d'eux échoue à compiler pendant l'unique session Mac, les autres
 *     et l'application continuent de fonctionner ;
 *  2. les tests tournent sur PC, où aucun de ces modules n'existe ;
 *  3. une fonctionnalité indisponible doit se dégrader proprement et le dire,
 *     pas faire planter l'écran qui l'appelle.
 */

export type EtatModule = 'disponible' | 'absent';

interface ModuleCharge<T> {
  etat: EtatModule;
  module?: T;
  raison?: string;
}

const cache = new Map<string, ModuleCharge<unknown>>();

/**
 * Chargeurs, écrits un par un avec un chemin littéral.
 *
 * `require(variable)` serait plus court, mais **Metro refuse un require
 * dynamique** : il construit le graphe des dépendances statiquement et ne peut
 * pas résoudre un chemin calculé. L'application ne s'empaquetterait tout
 * simplement pas.
 *
 * Chaque entrée est donc une fonction à chemin littéral, appelée seulement
 * quand on en a besoin. Metro les voit, le module reste chargé paresseusement,
 * et un échec à l'exécution reste rattrapable.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const CHARGEURS: Record<string, () => unknown> = {
  '@op-engineering/op-sqlite': () => require('@op-engineering/op-sqlite'),
  'react-native-get-random-values': () => require('react-native-get-random-values'),
  'react-native-biometrics': () => require('react-native-biometrics'),
  'react-native-fs': () => require('react-native-fs'),
  '@notifee/react-native': () => require('@notifee/react-native'),
  'react-native-image-picker': () => require('react-native-image-picker'),
  'react-native-calendar-events': () => require('react-native-calendar-events'),
  'react-native-background-fetch': () => require('react-native-background-fetch'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Charge un module natif une seule fois, sans jamais lever. */
export function chargerModule<T>(nom: string): ModuleCharge<T> {
  const memorise = cache.get(nom);
  if (memorise) {
    return memorise as ModuleCharge<T>;
  }

  const chargeur = CHARGEURS[nom];
  let resultat: ModuleCharge<T>;

  if (!chargeur) {
    resultat = {
      etat: 'absent',
      raison: `Module inconnu : ${nom}. Ajoutez-le à CHARGEURS pour que Metro puisse le résoudre.`,
    };
  } else {
    try {
      resultat = { etat: 'disponible', module: chargeur() as T };
    } catch (erreur) {
      resultat = {
        etat: 'absent',
        raison: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }

  cache.set(nom, resultat as ModuleCharge<unknown>);
  return resultat;
}

/** Réinitialise le cache. Réservé aux tests. */
export function oublierModules(): void {
  cache.clear();
}

/**
 * Modules embarqués lors de l'unique build, avec ce qu'ils permettront.
 *
 * Cette liste est le contrat de la session Mac : elle dit ce qui devra
 * compiler ce jour-là, et ce que l'on renonce à faire si on l'omet.
 */
export const MODULES_NATIFS = [
  {
    nom: '@op-engineering/op-sqlite',
    usage: 'Base chiffrée SQLCipher',
    indispensable: true,
    sansLui: "L'application ne peut pas stocker de données.",
  },
  {
    nom: 'react-native-get-random-values',
    usage: 'Générateur aléatoire cryptographique',
    indispensable: true,
    sansLui: 'Aucune clé ne peut être générée : le coffre est impossible.',
  },
  {
    nom: 'react-native-biometrics',
    usage: 'Face ID en raccourci de réouverture',
    indispensable: false,
    sansLui: 'Le mot de passe et le code TOTP seront exigés à chaque ouverture.',
  },
  {
    nom: 'react-native-fs',
    usage: 'Lecture et écriture de fichiers : exports, synchronisation, mises à jour',
    indispensable: false,
    sansLui:
      'Pas de mise à jour hors Mac, pas de synchronisation Syncthing, pas d’export de fichier.',
  },
  {
    nom: '@notifee/react-native',
    usage: 'Notifications locales : briefings et alertes de cours',
    indispensable: false,
    sansLui: 'Aucune alerte ne pourra être affichée.',
  },
  {
    nom: 'react-native-image-picker',
    usage: 'Pièce justificative : capture de l’ordre exécuté jointe à une opération',
    indispensable: false,
    sansLui: 'Aucune pièce ne pourra être attachée à une transaction.',
  },
  {
    nom: 'react-native-calendar-events',
    usage: 'Ajout au calendrier Apple des détachements de dividende',
    indispensable: false,
    sansLui: 'Les dates de détachement resteront dans l’application seulement.',
  },
  {
    nom: 'react-native-background-fetch',
    usage: 'Réveil périodique : cours rafraîchis et briefings à jour',
    indispensable: false,
    sansLui:
      'Les briefings ne montreront que les valeurs connues à la dernière ouverture de l’application.',
  },
] as const;

export interface DiagnosticModule {
  nom: string;
  usage: string;
  indispensable: boolean;
  etat: EtatModule;
  consequence?: string;
}

/**
 * État réel des modules sur l'appareil.
 * Affiché dans les réglages : c'est le seul moyen de savoir, après coup, ce
 * que le build a réellement embarqué.
 */
export function diagnostiquerModules(): DiagnosticModule[] {
  return MODULES_NATIFS.map(entree => {
    const charge = chargerModule(entree.nom);
    return {
      nom: entree.nom,
      usage: entree.usage,
      indispensable: entree.indispensable,
      etat: charge.etat,
      consequence: charge.etat === 'absent' ? entree.sansLui : undefined,
    };
  });
}
