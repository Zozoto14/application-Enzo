/**
 * Diagnostic : chaque service dont l'application dépend, testé pour de vrai.
 *
 * Les tests automatiques tournent sans réseau ; ce diagnostic, lui, va
 * chercher un cours chez Yahoo, lit un flux de presse, fait parler une voix
 * et affiche une notification. Chaque vérification est indépendante et
 * bornée dans le temps : une panne n'empêche pas de tester le reste.
 */

export type Statut = 'ok' | 'echec' | 'absent';

export interface Verification {
  cle: string;
  libelle: string;
  statut: Statut;
  /** Ce qui a été obtenu, ou la raison de l'échec. */
  detail: string;
  dureeMs: number;
}

export interface Test {
  cle: string;
  libelle: string;
  /** Rend un court compte rendu ; lève en cas d'échec. Absent : service indisponible ici. */
  executer?: () => Promise<string>;
  /** Pourquoi le service n'est pas disponible ici. */
  motifAbsence?: string;
}

export const DELAI_TEST_MS = 20_000;

function avecDelai<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(() => rejeter(new Error(`pas de réponse en ${Math.round(delaiMs / 1000)} s`)), delaiMs);
    promesse.then(
      valeur => {
        clearTimeout(minuterie);
        resoudre(valeur);
      },
      erreur => {
        clearTimeout(minuterie);
        rejeter(erreur);
      },
    );
  });
}

export async function executerDiagnostic(
  tests: readonly Test[],
  surResultat?: (verification: Verification) => void,
  delaiMs = DELAI_TEST_MS,
  horloge: () => number = () => Date.now(),
): Promise<Verification[]> {
  return Promise.all(
    tests.map(async test => {
      const debut = horloge();
      let verification: Verification;
      if (!test.executer) {
        verification = {
          cle: test.cle,
          libelle: test.libelle,
          statut: 'absent',
          detail: test.motifAbsence ?? 'Indisponible ici.',
          dureeMs: 0,
        };
      } else {
        try {
          const detail = await avecDelai(test.executer(), delaiMs);
          verification = { cle: test.cle, libelle: test.libelle, statut: 'ok', detail, dureeMs: horloge() - debut };
        } catch (erreur) {
          verification = {
            cle: test.cle,
            libelle: test.libelle,
            statut: 'echec',
            detail: erreur instanceof Error ? erreur.message : String(erreur),
            dureeMs: horloge() - debut,
          };
        }
      }
      surResultat?.(verification);
      return verification;
    }),
  );
}

/** Rapport en texte, à copier pour le transmettre. */
export function rapportTexte(verifications: readonly Verification[], date: string): string {
  const icone = { ok: '✓', echec: '✕', absent: '–' } as const;
  return [
    `Diagnostic AppDashboard — ${date}`,
    ...verifications.map(
      verification =>
        `${icone[verification.statut]} ${verification.libelle} : ${verification.detail}${
          verification.statut === 'absent' ? '' : ` (${(verification.dureeMs / 1000).toFixed(1)} s)`
        }`,
    ),
  ].join('\n');
}
