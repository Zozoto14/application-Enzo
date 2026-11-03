/**
 * Alertes d'événements sur vos valeurs : au-delà du cours.
 *
 * - **Résultats** : la veille et le jour de la publication.
 * - **Dividende** : la veille et le jour du détachement — il faut détenir
 *   l'action la veille au soir pour le toucher.
 * - **Grosse actualité** : une information rapportée par au moins trois
 *   médias différents en deux jours. Une rumeur relayée par un seul site ne
 *   déclenche rien ; c'est le recoupement qui fait l'importance.
 *
 * Chaque alerte a un identifiant stable : elle ne part qu'une fois.
 */

import { regrouper } from '../podcast/episode';
import { memeSource, type ArticleMedia } from '../podcast/medias';

export interface ValeurSuivie {
  nom: string;
  /** Symbole de cotation : un clic sur l'alerte ouvre sa fiche. */
  symbole?: string;
  prochainsResultats?: string;
  detachement?: string;
  /** Articles récents sur la valeur, tous médias confondus. */
  articles?: readonly ArticleMedia[];
}

export interface AlerteEvenement {
  identifiant: string;
  titre: string;
  corps: string;
  /** Page ouverte au clic. */
  destination: string;
}

export const SOURCES_POUR_GROSSE_ACTU = 3;

function joursEntre(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000);
}

function cle(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** « de Nvidia », mais « d’Air Liquide ». */
function de(nom: string): string {
  return /^[AEIOUYÉÈÊÀÂÎÔaeiouyéèêàâîô]/.test(nom) ? `d’${nom}` : `de ${nom}`;
}

function listeParlee(noms: readonly string[]): string {
  return noms.length <= 1 ? noms[0] ?? '' : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

export function alertesEvenements(
  valeurs: readonly ValeurSuivie[],
  aujourdhui: string,
  dejaEnvoyees: ReadonlySet<string>,
): AlerteEvenement[] {
  const alertes: AlerteEvenement[] = [];
  for (const valeur of valeurs) {
    const destination = valeur.symbole ? `symbole:${valeur.symbole}` : 'watchlist';
    const ajouter = (alerte: Omit<AlerteEvenement, 'destination'>) => {
      if (!dejaEnvoyees.has(alerte.identifiant)) alertes.push({ ...alerte, destination });
    };
    if (valeur.prochainsResultats) {
      const ecart = joursEntre(aujourdhui, valeur.prochainsResultats);
      if (ecart === 0 || ecart === 1) {
        ajouter({
          identifiant: `evt-resultats-${cle(valeur.nom)}-${valeur.prochainsResultats}-${ecart}`,
          titre: `${valeur.nom} publie ses résultats ${ecart === 0 ? 'aujourd’hui' : 'demain'}`,
          corps: 'Le cours peut bouger fortement à l’annonce. Les chiffres attendus sont dans l’onglet Résultats de la fiche.',
        });
      }
    }
    if (valeur.detachement) {
      const ecart = joursEntre(aujourdhui, valeur.detachement);
      if (ecart === 0 || ecart === 1) {
        ajouter({
          identifiant: `evt-dividende-${cle(valeur.nom)}-${valeur.detachement}-${ecart}`,
          titre: `Dividende ${de(valeur.nom)} détaché ${ecart === 0 ? 'aujourd’hui' : 'demain'}`,
          corps:
            ecart === 0
              ? 'Le cours baisse mécaniquement du montant du dividende ce matin : ce n’est pas une perte.'
              : 'Pour le toucher, il faut détenir l’action ce soir à la clôture.',
        });
      }
    }

    // Grosse actualité : une même information, trois médias, deux jours.
    const recents = (valeur.articles ?? []).filter(
      article => article.date && joursEntre(article.date, aujourdhui) <= 1 && joursEntre(article.date, aujourdhui) >= 0,
    );
    for (const groupe of regrouper(recents)) {
      const sources: string[] = [];
      for (const article of groupe) {
        if (article.source && !sources.some(source => memeSource(source, article.source))) sources.push(article.source);
      }
      if (sources.length < SOURCES_POUR_GROSSE_ACTU) continue;
      const principal = groupe.find(article => article.resume) ?? groupe[0];
      ajouter({
        identifiant: `evt-actu-${cle(valeur.nom)}-${cle(principal.titre)}`,
        titre: `${valeur.nom} : ${principal.titre}`,
        corps: `✓ Information recoupée par ${listeParlee(sources.slice(0, 3))}${sources.length > 3 ? ` et ${sources.length - 3} autre(s)` : ''}.`,
      });
      break; // Une grosse actualité par valeur et par passage suffit.
    }
  }
  return alertes;
}

/** Garde les derniers identifiants envoyés, pour ne rien répéter. */
export function retenirEvenements(deja: readonly string[], nouveaux: readonly string[], garder = 200): string[] {
  return [...deja, ...nouveaux].slice(-garder);
}
