/**
 * Sauvegardes : manuelles, automatiques chaque semaine, restauration et
 * fusion. Sur l'ordinateur, elles vont dans Documents par le pont
 * d'Electron ; sur le téléphone, par react-native-fs.
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { chargerModule } from '../natif/modules';
import { systemeDepuisRnfs } from '../fichiers/systeme';
import { systemeDepuisBureau, type PontSauvegardes } from '../fichiers/bureau';
import { SUFFIXE_AUTO, aElaguer, sauvegardeDue } from '../sauvegarde/automatique';
import { exporterDepuisBase, restaurerDansBase } from '../sauvegarde/depot';
import { ErreurFusion, fusionnerDansBase } from '../sync/application';
import { ouvrirArchive } from '../sauvegarde/archive';
import {
  ecrireSauvegarde,
  lireSauvegarde,
  listerSauvegardes,
  supprimerSauvegarde,
  type SauvegardeSurDisque,
} from '../sauvegarde/fichiers';
import { resumerFusion } from '../sync/fusion';
import type { Session } from '../session/session';

/** Laisse React peindre avant un calcul qui bloque le fil. */
function apresRendu(action: () => void): void {
  setTimeout(action, 0);
}

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useSauvegardes({
  session,
  aujourdhui,
  deverrouille,
  rafraichir,
  onRestaure,
}: {
  session: Session;
  aujourdhui?: () => string;
  deverrouille: boolean;
  rafraichir(): void;
  /** Après une restauration, on revient au portefeuille. */
  onRestaure?(): void;
}) {
  const [sauvegardes, setSauvegardes] = useState<SauvegardeSurDisque[]>([]);
  const [messageSauvegarde, setMessageSauvegarde] = useState<string | undefined>();
  const [erreurSauvegarde, setErreurSauvegarde] = useState<string | undefined>();
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false);

  /**
   * Systeme de fichiers de l'appareil, absent sur un binaire compile sans
   * react-native-fs et dans les tests. L'ecran de sauvegarde le dit plutot que
   * d'echouer silencieusement.
   */
  // Sur l'ordinateur, le pont d'Electron range les sauvegardes dans Documents.
  const pontSauvegardes = (globalThis as { applibourse?: { sauvegardes?: PontSauvegardes } }).applibourse
    ?.sauvegardes;
  const fichiers = useMemo(
    () => systemeDepuisBureau(pontSauvegardes) ?? systemeDepuisRnfs(chargerModule<unknown>('react-native-fs').module),
    [pontSauvegardes],
  );
  const [dossierSauvegardes, setDossierSauvegardes] = useState<string | undefined>();
  useEffect(() => {
    pontSauvegardes?.dossier().then(setDossierSauvegardes).catch(() => undefined);
  }, [pontSauvegardes]);

  const rafraichirSauvegardes = useCallback(() => {
    if (!fichiers) {
      return;
    }
    listerSauvegardes(fichiers)
      .then(setSauvegardes)
      .catch(() => setSauvegardes([]));
  }, [fichiers]);

  /**
   * Sauvegarde automatique : à l'ouverture puis toutes les heures, une
   * archive part si la dernière a une semaine ; les huit plus récentes
   * restent. Le mot de passe dort dans la base, elle-même chiffrée.
   */
  const sauvegardeAutoEnCours = useRef(false);
  const sauvegarderSiDu = useCallback(async () => {
    if (!fichiers || sauvegardeAutoEnCours.current) return;
    const parametres = new DepotParametres(session.base());
    const motDePasse = parametres.lire(PARAMETRES.sauvegardeAutoMotDePasse);
    const jour = (aujourdhui ?? dateDuJour)();
    if (!motDePasse || !sauvegardeDue(parametres.lire(PARAMETRES.sauvegardeAutoDerniere), jour)) return;
    sauvegardeAutoEnCours.current = true;
    try {
      const archive = exporterDepuisBase(session.base(), { motDePasse, date: jour });
      await ecrireSauvegarde(fichiers, archive, SUFFIXE_AUTO);
      parametres.ecrire(PARAMETRES.sauvegardeAutoDerniere, jour);
      for (const ancienne of aElaguer(await listerSauvegardes(fichiers))) {
        await supprimerSauvegarde(fichiers, ancienne.chemin);
      }
      rafraichirSauvegardes();
    } catch {
      // Réessayée à la prochaine heure ; l'écran Sauvegarde montre la date de la dernière réussie.
    } finally {
      sauvegardeAutoEnCours.current = false;
    }
  }, [fichiers, session, aujourdhui, rafraichirSauvegardes]);

  const activerSauvegardeAuto = useCallback(
    (motDePasse: string | undefined) => {
      const parametres = new DepotParametres(session.base());
      if (motDePasse) {
        parametres.ecrire(PARAMETRES.sauvegardeAutoMotDePasse, motDePasse);
        parametres.supprimer(PARAMETRES.sauvegardeAutoDerniere);
        setMessageSauvegarde('Sauvegarde automatique activée : une première archive est créée maintenant.');
        void sauvegarderSiDu();
      } else {
        parametres.supprimer(PARAMETRES.sauvegardeAutoMotDePasse);
        setMessageSauvegarde('Sauvegarde automatique désactivée. Les archives existantes sont conservées.');
      }
      rafraichir();
    },
    [session, sauvegarderSiDu, rafraichir],
  );

  const creerSauvegarde = useCallback(
    (motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      apresRendu(() => {
        try {
          const archive = exporterDepuisBase(session.base(), {
            motDePasse,
            date: (aujourdhui ?? dateDuJour)(),
          });
          ecrireSauvegarde(fichiers, archive)
            .then(ecrite => {
              setMessageSauvegarde(`Sauvegarde créée : ${ecrite.nom}`);
              rafraichirSauvegardes();
            })
            .catch((e: unknown) =>
              setErreurSauvegarde(e instanceof Error ? e.message : String(e)),
            )
            .finally(() => setSauvegardeEnCours(false));
        } catch (e) {
          setErreurSauvegarde(e instanceof Error ? e.message : String(e));
          setSauvegardeEnCours(false);
        }
      });
    },
    [fichiers, session, aujourdhui, rafraichirSauvegardes],
  );

  const fusionnerSauvegarde = useCallback(
    (chemin: string, motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      lireSauvegarde(fichiers, chemin)
        .then(archive => {
          const lecture = ouvrirArchive(archive, motDePasse);
          if (!lecture.ouverte) {
            setErreurSauvegarde(lecture.motif);
            return;
          }

          const fusion = fusionnerDansBase(session.base(), lecture.contenu);
          const resume = resumerFusion(fusion);
          const divergences =
            fusion.conflits.length === 0
              ? ''
              : ` ${fusion.conflits.length} divergence(s) : ${fusion.conflits
                  .map(conflit => `${conflit.nom} (${conflit.champs.join(', ')})`)
                  .join(' ; ')}. Votre version a été gardée.`;
          setMessageSauvegarde(`${resume.texte}${divergences}`);
        })
        .catch((e: unknown) =>
          setErreurSauvegarde(
            e instanceof ErreurFusion || e instanceof Error ? e.message : String(e),
          ),
        )
        .finally(() => {
          setSauvegardeEnCours(false);
          rafraichir();
        });
    },
    [fichiers, session, rafraichir],
  );

  const restaurerSauvegarde = useCallback(
    (chemin: string, motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      lireSauvegarde(fichiers, chemin)
        .then(archive => {
          const lecture = ouvrirArchive(archive, motDePasse);
          if (!lecture.ouverte) {
            setErreurSauvegarde(lecture.motif);
            return;
          }
          const rapport = restaurerDansBase(session.base(), lecture.contenu);
          setMessageSauvegarde(
            `Restauration terminée : ${rapport.comptes} compte(s), ${rapport.transactions} opération(s).`,
          );
          onRestaure?.();
          rafraichir();
        })
        .catch((e: unknown) =>
          setErreurSauvegarde(e instanceof Error ? e.message : String(e)),
        )
        .finally(() => setSauvegardeEnCours(false));
    },
    [fichiers, session, rafraichir, onRestaure],
  );


  useEffect(() => {
    if (!deverrouille || !fichiers) return;
    const premiere = setTimeout(() => void sauvegarderSiDu(), 20_000);
    const minuterie = setInterval(() => void sauvegarderSiDu(), 3_600_000);
    return () => {
      clearTimeout(premiere);
      clearInterval(minuterie);
    };
  }, [deverrouille, fichiers, sauvegarderSiDu]);

  return {
    fichiers,
    pontSauvegardes,
    dossierSauvegardes,
    sauvegardes,
    messageSauvegarde,
    setMessageSauvegarde,
    erreurSauvegarde,
    sauvegardeEnCours,
    rafraichirSauvegardes,
    activerSauvegardeAuto,
    creerSauvegarde,
    fusionnerSauvegarde,
    restaurerSauvegarde,
  };
}
