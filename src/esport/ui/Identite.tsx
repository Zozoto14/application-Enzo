/**
 * Vérification d'identité du Fondateur avant une action sur les comptes du hub
 * faite depuis l'Esport (créer un compte, renvoyer ou révoquer une
 * invitation) : mot de passe + code à 6 chiffres, exactement comme les actions
 * sensibles de l'Administration (`ServicesAdmin.verifierIdentite`, mêmes
 * temporisations après échecs). Une vérification vaut pour la durée de
 * confiance réglée dans l'Administration (5 minutes par défaut).
 */

import React, { useCallback, useState } from 'react';
import { FormulaireIdentite } from '../../hub/Administration';
import { Avis } from '../../hub/admin/ui/commun';
import { chargerDonnees } from '../../hub/admin/donnees';
import type { ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';

/** Dernière vérification réussie sur cet appareil (mémoire seulement). */
let derniereVerification: number | undefined;

export function oublierVerification(): void {
  derniereVerification = undefined;
}

export function useIdentite(contexte: ContexteHub) {
  const [demande, setDemande] = useState<{ raison: string; action: () => void } | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();

  const exiger = useCallback(
    (raison: string, action: () => void) => {
      const services = contexte.admin;
      if (!services) {
        action();
        return;
      }
      const minutes = chargerDonnees(services.stockage).reglages.confianceMinutes || 5;
      const maintenant = contexte.maintenant ?? Date.now();
      if (derniereVerification !== undefined && maintenant - derniereVerification < minutes * 60_000) {
        action();
        return;
      }
      setErreur(undefined);
      setDemande({ raison, action });
    },
    [contexte.admin, contexte.maintenant],
  );

  /** Formulaire à afficher (fonction, pas composant : la saisie survit aux nouveaux rendus). */
  const rendu = (theme: ThemeHub) => {
    if (!demande) return null;
    return (
      <>
        <FormulaireIdentite
          theme={theme}
          raison={demande.raison}
          enCours={false}
          onValider={(motDePasse, code) => {
            try {
              contexte.admin!.verifierIdentite(motDePasse, code);
            } catch (e) {
              setErreur(e instanceof Error ? e.message : String(e));
              return;
            }
            derniereVerification = contexte.maintenant ?? Date.now();
            const suite = demande.action;
            setDemande(undefined);
            suite();
          }}
          onAnnuler={() => setDemande(undefined)}
        />
        {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="esport-identite-erreur" /> : null}
      </>
    );
  };

  return { exiger, rendu, enAttente: Boolean(demande) };
}
