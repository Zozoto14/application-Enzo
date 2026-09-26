/**
 * Synchronisation automatique par le relais : un tour à l'ouverture, puis
 * toutes les deux minutes, et quand l'application passe en arrière-plan.
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { expirationSignature, programmerRappelsExpiration } from '../natif/signature';
import type { Session } from '../session/session';
import { deriverCleSynchro } from '../sync/relais/chiffrement';
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
import { definirRelaisActif } from '../sync/relais/actif';

export const INTERVALLE_SYNCHRO_MS = 2 * 60_000;

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

/** Laisse React peindre avant un calcul qui bloque le fil (Argon2). */
const apresRendu = () => new Promise<void>(resoudre => setTimeout(resoudre, 30));

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
  const expireLe = useRef<string | undefined>(undefined);

  const base = deverrouille ? session.base() : undefined;
  const config = base ? lireConfigRelais(base) : undefined;
  const moi = base ? identifiantAppareil(new DepotParametres(base), PARAMETRES.identifiantAppareil) : '';

  // Le relais sert aussi de passerelle vers Yahoo pour le site de secours.
  useEffect(() => {
    definirRelaisActif(config ? { relais: config.relais, jeton: config.jeton } : undefined);
  }, [config?.relais, config?.jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sur le PC : le relais installé par le script est proposé tel quel.
  useEffect(() => {
    const pont = (globalThis as { applibourse?: PontRelais }).applibourse?.relais;
    pont?.config?.().then(setLiaisonDuPc).catch(() => undefined);
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
      });
      const changes = resultat.bilan.ajoutes + resultat.bilan.modifies + resultat.bilan.supprimes;
      if (changes > 0) {
        rafraichir();
      }
      setEtat(courant => ({
        ...courant,
        erreur: resultat.erreurs[0],
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
  }, [deverrouille, session, plateforme, rafraichir]);

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

  const relier = useCallback(
    async (code: string, motDePasse: string, nom: string) => {
      const liaison = decoderLiaison(code);
      if (!liaison) {
        throw new Error('Code de liaison illisible : recopiez-le depuis le PC (il commence par AB1.).');
      }
      if (motDePasse.length < 8) {
        throw new Error('Le mot de passe de synchronisation doit faire au moins 8 caractères.');
      }
      await testerLiaison(liaison);
      setEtat(courant => ({ ...courant, enCours: true, message: 'Préparation de la clé…', erreur: undefined }));
      await apresRendu();
      const cle = deriverCleSynchro(motDePasse, liaison.jeton);
      ecrireConfigRelais(session.base(), { ...liaison, cle, nom: nom.trim() || nomParDefaut(plateforme) });
      setEtat(courant => ({ ...courant, enCours: false, message: 'Appareil relié.' }));
      setVersion(v => v + 1);
    },
    [session, plateforme],
  );

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
