/**
 * Erreurs d'affichage attrapées par une GardeErreur (« Affichage impossible ») : signalées au serveur Esport, qui
 * les compte dans les statistiques d'usage et en écrit une ligne dans ~/logs/esport.log (docs/performance.md). Sans
 * ce relais, une erreur attrapée par React n'arrive jamais aux écouteurs globaux (`error`, `unhandledrejection`).
 *
 * Le hub ne dépend pas de l'Esport : l'Esport s'inscrit comme « signaleur » quand sa collecte démarre
 * (src/esport/usage). Avant cela, les 5 dernières erreurs attendent ici (une erreur du hub survenue avant
 * l'ouverture de l'Esport est envoyée à son ouverture). Aucun contenu saisi : un message technique seulement,
 * nettoyé par le serveur (adresses, e-mails, jetons, nombres longs retirés).
 */

export const ATTENTE_MAX = 5;

type Signaleur = (message: string) => void;

let signaleur: Signaleur | undefined;
const enAttente: string[] = [];

/** Inscrit (ou retire, avec undefined) le destinataire ; les erreurs en attente lui sont remises. */
export function definirSignaleur(f: Signaleur | undefined): void {
  signaleur = f;
  if (f) for (const m of enAttente.splice(0)) f(m);
}

export function signalerErreur(erreur: unknown, ou?: string): void {
  const brut = erreur instanceof Error ? `${erreur.name}: ${erreur.message}` : String(erreur ?? 'Error');
  const message = `${ou ? `[${ou}] ` : ''}${brut}`.slice(0, 300);
  if (signaleur) {
    try {
      signaleur(message);
    } catch {
      // Le signalement ne doit jamais casser l'écran d'erreur.
    }
    return;
  }
  enAttente.push(message);
  if (enAttente.length > ATTENTE_MAX) enAttente.shift();
}
