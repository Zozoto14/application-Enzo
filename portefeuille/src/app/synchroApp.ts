/**
 * Synchronisation automatique par le relais : un tour à l'ouverture, puis
 * toutes les deux minutes, et quand l'application passe en arrière-plan.
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { expirationSignature, programmerRappelsExpiration } from '../natif/signature';
import type { Session } from '../session/session';
import { identifiantAppareil } from '../sync/identite';
import { decoderLiaison, type Liaison } from '../sync/relais/liaison';
import type { InfoAppareil } from '../sync/relais/moteur';
import {
  ecrireConfigRelais,
  lireConfigRelais,
  lireEtatSynchro,
  oublierAppareil,
  synchroniser,
  testerLiaison,
} from '../sync/relais/synchroniser';
import { definirRelaisActif, liaisonEnAttente } from '../sync/relais/actif';
import { chargerModule } from '../natif/modules';
import { systemeDepuisRnfs } from '../fichiers/systeme';
import { GestionnaireMiseAJour } from '../maj/application';
import { telechargerMiseAJour } from '../maj/telechargement';

export const INTERVALLE_SYNCHRO_MS = 2 * 60_000;
/** L'app iPhone regarde s'il y a une nouvelle version au plus toutes les 6 heures. */
const INTERVALLE_MAJ_MS = 6 * 3_600_000;

export interface EtatSynchroApp {
  configure: boolean;
  nom?: string;
  liaison?: Liaison;
  enCours: boolean;
  derniere?: string;
  message?: string;
  erreur?: string;
  appareils: Record<string, InfoAppareil>;
  moi: string;
  plateforme?: string;
  /** Expiration de la signature de cet appareil (iPhone AltStore). */
  expireLe?: string;
  /** Nouvelle version téléchargée, en attente de réouverture. */
  maj?: string;
}

type PontRelais = { relais?: { config?(): Promise<Liaison | undefined> } };

/** Plateforme lisible, pour la liste des appareils. */
export function plateformeActuelle(): string {
  if ((globalThis as { applibourse?: { bureau?: boolean } }).applibourse?.bureau) {
    return 'bureau';
  }
  return Platform.OS === 'web' ? 'site' : Platform.OS;
}

export function nomParDefaut(plateforme: string): string {
  return plateforme === 'bureau' ? 'PC' : plateforme === 'ios' ? 'iPhone' : plateforme === 'site' ? 'Site de secours' : 'Téléphone';
}

export function useSynchro({
  session,
  deverrouille,
  rafraichir,
}: {
  session: Session;
  deverrouille: boolean;
  rafraichir(): void;
}) {
  const plateforme = plateformeActuelle();
  const [etat, setEtat] = useState<Omit<EtatSynchroApp, 'configure' | 'moi' | 'nom' | 'liaison' | 'appareils' | 'derniere'>>({
    enCours: false,
  });
  const [version, setVersion] = useState(0);
  const [liaisonDuPc, setLiaisonDuPc] = useState<Liaison | undefined>();
  const enCours = useRef(false);
  const derniereVerificationMaj = useRef(0);
  const expireLe = useRef<string | undefined>(undefined);

  const base = deverrouille ? session.base() : undefined;
  const config = base ? lireConfigRelais(base) : undefined;
  const moi = base ? identifiantAppareil(new DepotParametres(base), PARAMETRES.identifiantAppareil) : '';

  // Le relais sert aussi de passerelle vers Yahoo pour le site de secours.
  useEffect(() => {
    definirRelaisActif(config ? { relais: config.relais, jeton: config.jeton } : undefined);
  }, [config?.relais, config?.jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relais déjà connu : installé par le script sur le PC, ou apporté par le
  // QR code (lien du site, ou applibourse://liaison?code=… pour l'app iPhone).
  useEffect(() => {
    const pont = (globalThis as { applibourse?: PontRelais }).applibourse?.relais;
    let trouve = false;
    const chercher = () =>
      pont?.config?.()
        .then(liaison => {
          if (liaison) {
            trouve = true;
            setLiaisonDuPc(liaison);
          }
        })
        .catch(() => undefined);
    void chercher();
    // Relais installé pendant que l'application tourne : il apparaît seul.
    const minuterie = pont?.config ? setInterval(() => !trouve && void chercher(), 5_000) : undefined;
    const depuisLien = (url: string | null | undefined) => {
      const liaison = url ? decoderLiaison(url) : undefined;
      if (liaison) {
        setLiaisonDuPc(liaison);
      }
    };
    Linking.getInitialURL?.().then(depuisLien).catch(() => undefined);
    const abonnement = Linking.addEventListener?.('url', ({ url }) => depuisLien(url));
    return () => {
      abonnement?.remove?.();
      if (minuterie) {
        clearInterval(minuterie);
      }
    };
  }, []);

  // Sur l'iPhone : date d'expiration de la signature, et rappels programmés.
  useEffect(() => {
    void expirationSignature().then(date => {
      expireLe.current = date;
      if (date) {
        setEtat(courant => ({ ...courant, expireLe: date }));
        void programmerRappelsExpiration(date).catch(() => undefined);
      }
    });
  }, []);

  /**
   * Sur l'iPhone : nouvelle version JavaScript publiée avec le site ? Elle
   * est téléchargée, vérifiée, et s'appliquera à la prochaine ouverture.
   */
  const verifierMiseAJourDuSite = useCallback(async (): Promise<string | undefined> => {
    const site = lireConfigRelais(session.base())?.site;
    if (plateforme !== 'ios' || !site || Date.now() - derniereVerificationMaj.current < INTERVALLE_MAJ_MS) {
      return undefined;
    }
    derniereVerificationMaj.current = Date.now();
    const fichiers = systemeDepuisRnfs(chargerModule<unknown>('react-native-fs').module);
    if (!fichiers) {
      return undefined;
    }
    try {
      const resultat = await telechargerMiseAJour({ site, gestionnaire: new GestionnaireMiseAJour(fichiers), fichiers });
      return resultat.etat === 'installee'
        ? `🆕 Nouvelle version téléchargée${resultat.notes ? ` (${resultat.notes})` : ''} : fermez et rouvrez l’application pour l’avoir.`
        : undefined;
    } catch {
      return undefined;
    }
  }, [session, plateforme]);

  const tour = useCallback(async () => {
    if (!deverrouille || enCours.current || !lireConfigRelais(session.base())) {
      return;
    }
    enCours.current = true;
    setEtat(courant => ({ ...courant, enCours: true }));
    try {
      const resultat = await synchroniser({
        pilote: session.base(),
        appareil: identifiantAppareil(new DepotParametres(session.base()), PARAMETRES.identifiantAppareil),
        moi: { plateforme, expireLe: expireLe.current },
        // Déposé pour qu'un nouvel appareil puisse se « Lier » avec le même compte.
        coffre: session.coffreActuel(),
      });
      const changes = resultat.bilan.ajoutes + resultat.bilan.modifies + resultat.bilan.supprimes;
      if (changes > 0) {
        rafraichir();
      }
      const nouvelleVersion = await verifierMiseAJourDuSite();
      setEtat(courant => ({
        ...courant,
        erreur: resultat.erreurs[0],
        maj: nouvelleVersion ?? courant.maj,
        message:
          changes > 0
            ? `${changes} changement${changes > 1 ? 's' : ''} reçu${changes > 1 ? 's' : ''} des autres appareils.`
            : courant.message,
      }));
    } catch (erreur) {
      setEtat(courant => ({ ...courant, erreur: erreur instanceof Error ? erreur.message : String(erreur) }));
    } finally {
      enCours.current = false;
      setEtat(courant => ({ ...courant, enCours: false }));
      setVersion(v => v + 1);
    }
  }, [deverrouille, session, plateforme, rafraichir, verifierMiseAJourDuSite]);

  const tourRef = useRef(tour);
  tourRef.current = tour;

  useEffect(() => {
    if (!deverrouille || !config) {
      return;
    }
    void tourRef.current();
    const minuterie = setInterval(() => void tourRef.current(), INTERVALLE_SYNCHRO_MS);
    // En quittant l'application (ou en changeant d'onglet), on dépose tout de suite.
    const abonnement = AppState.addEventListener?.('change', statut => {
      if (statut !== 'active') {
        void tourRef.current();
      }
    });
    return () => {
      clearInterval(minuterie);
      abonnement?.remove?.();
    };
  }, [deverrouille, Boolean(config)]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Relie cet appareil : la clé de synchronisation est tirée de la clé
   * maîtresse du coffre, commune à tous les appareils liés — pas d'autre mot
   * de passe à retenir.
   */
  const relier = useCallback(
    async (code: string, nom: string) => {
      const liaison = decoderLiaison(code);
      if (!liaison) {
        throw new Error('Code de liaison illisible : recopiez-le depuis le PC (il commence par AB1.).');
      }
      await testerLiaison(liaison);
      ecrireConfigRelais(session.base(), {
        ...liaison,
        cle: session.cleDerivee('synchro'),
        nom: nom.trim() || nomParDefaut(plateforme),
      });
      setEtat(courant => ({ ...courant, message: 'Appareil relié.', erreur: undefined }));
      setVersion(v => v + 1);
    },
    [session, plateforme],
  );

  /**
   * À chaque ouverture : la clé suit le coffre (ancienne clé tirée d'un mot
   * de passe de synchronisation → remplacée), et un appareil qui connaît le
   * relais (script du PC, lien scanné, « Lier ») mais dont la configuration
   * s'est perdue se relie tout seul. C'est ce qui garde le téléphone relié.
   */
  useEffect(() => {
    if (!deverrouille) {
      return;
    }
    const pilote = session.base();
    const cle = session.cleDerivee('synchro');
    const actuelle = lireConfigRelais(pilote);
    if (actuelle && actuelle.cle !== cle) {
      ecrireConfigRelais(pilote, { ...actuelle, cle });
      const parametres = new DepotParametres(pilote);
      const suivi = lireEtatSynchro(pilote);
      parametres.ecrire(PARAMETRES.etatSynchro, JSON.stringify({ ...suivi, dernierEnvoi: undefined, lus: {} }));
      setVersion(v => v + 1);
      return;
    }
    const connue = liaisonDuPc ?? decoderLiaison(liaisonEnAttente() ?? '');
    if (!actuelle && connue) {
      ecrireConfigRelais(pilote, { ...connue, cle, nom: nomParDefaut(plateforme) });
      setEtat(courant => ({ ...courant, message: 'Appareil relié automatiquement.' }));
      setVersion(v => v + 1);
    }
  }, [deverrouille, session, liaisonDuPc, plateforme]);

  const delier = useCallback(() => {
    ecrireConfigRelais(session.base(), undefined);
    setEtat({ enCours: false, message: 'Synchronisation désactivée sur cet appareil.' });
    setVersion(v => v + 1);
  }, [session]);

  const oublier = useCallback(
    async (autre: string) => {
      await oublierAppareil(session.base(), autre);
      setVersion(v => v + 1);
    },
    [session],
  );

  const suivi = base ? lireEtatSynchro(base) : undefined;
  const vue: EtatSynchroApp = {
    ...etat,
    configure: Boolean(config),
    nom: config?.nom,
    liaison: config ? { relais: config.relais, jeton: config.jeton, site: config.site } : undefined,
    derniere: suivi?.derniereSynchro,
    appareils: suivi?.appareils ?? {},
    moi,
    plateforme,
  };
  void version;

  return { synchro: vue, liaisonDuPc, plateforme, relier, delier, oublier, synchroniserMaintenant: tour };
}
