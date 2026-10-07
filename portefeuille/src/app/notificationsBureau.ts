/**
 * Notifications de l'application de bureau, vérifiées en tâche de fond.
 *
 * Tant qu'AppliBourse est ouverte (même réduite près de l'horloge) :
 * - chaque minute, briefings, alertes de cours, rappels du carnet et forte
 *   séance ;
 * - chaque heure en journée, les événements des valeurs (résultats,
 *   dividendes, grosses actualités) ;
 * - verrouillée, un simple rappel à l'heure d'un briefing, sans chiffre.
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Titre } from '../core/domain/types';
import { chargerEtat, DepotCours, DepotParametres, DepotWatchlist, PARAMETRES } from '../db/depots';
import { seanceEnCours } from '../cours/marche';
import { separerHistorique } from '../cours/indices';
import { chargerValeur, type DonneesValeur } from '../fondamentaux/yahoo';
import { planningDepuisJson } from '../notifications/planification';
import { executerReveil } from '../notifications/reveil';
import {
  alerteVariation,
  canalBureau,
  etatDepuisJson,
  seuilVariation,
  seuilsDepuisJson,
  variationSeance,
  type PontNotifications,
} from '../notifications/bureau';
import { rappelsDus, retenirRappels } from '../notifications/rappelVerrouille';
import { alertesEvenements, retenirEvenements, type ValeurSuivie } from '../notifications/evenements';
import { lireRechercheActualites, urlActualitesValeur } from '../podcast/medias';
import { rappelsCarnet, type LigneCarnet } from '../ui/vues/carnet';
import type { Session } from '../session/session';
import { lignesCibles } from './calculs';
import { repartirVersement } from '../ui/vues/objectifs';
import { identifiantVersement, messageVersement, reglageVersementDepuisJson, versementDu } from '../ui/vues/versementMensuel';

/** Copie du planning et rappels envoyés : hors du coffre, lisibles verrouillé. */
export const CLE_PLANNING_LOCAL = 'applibourse.planningBriefings';
const CLE_RAPPELS_LOCAL = 'applibourse.rappelsBriefing';
type StockageLocal = { getItem(cle: string): string | null; setItem(cle: string, valeur: string): void };
export function stockageLocal(): StockageLocal | undefined {
  try {
    return (globalThis as { localStorage?: StockageLocal }).localStorage;
  } catch {
    return undefined;
  }
}

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useNotificationsBureau({
  session,
  deverrouille,
  aujourdhui,
  chargementAutomatique,
  pontNotifications,
  fichesEnCache,
  lignesCarnet,
}: {
  session: Session;
  deverrouille: boolean;
  aujourdhui?: () => string;
  chargementAutomatique: boolean;
  pontNotifications: PontNotifications | undefined;
  fichesEnCache: MutableRefObject<Map<string, DonneesValeur>>;
  lignesCarnet(): LigneCarnet[];
}) {
  const verificationEnCours = useRef(false);
  const verifierNotificationsRef = useRef<() => Promise<void>>(async () => undefined);
  const [journalNotifications, setJournalNotifications] = useState<string | undefined>();
  const verifierNotifications = useCallback(async () => {
    if (!pontNotifications || verificationEnCours.current) {
      return;
    }
    verificationEnCours.current = true;
    try {
      const base = session.base();
      const parametres = new DepotParametres(base);
      const depot = new DepotCours(base);
      const canal = canalBureau(pontNotifications);
      const resultat = await executerReveil({
        maintenant: new Date(),
        planning: planningDepuisJson(parametres.lire(PARAMETRES.planningBriefings)),
        seuils: seuilsDepuisJson(parametres.lire(PARAMETRES.seuilsAlertes)),
        etatPersiste: etatDepuisJson(parametres.lire(PARAMETRES.etatNotifications)),
        canal,
        lirePortefeuille: async () => {
          const contenuActuel = chargerEtat(base);
          return { etat: contenuActuel.etat, titres: contenuActuel.titres };
        },
        // Les cours viennent d'être actualisés par la boucle des cours en direct.
        rafraichirCours: async () => depot.derniersCours(),
        enregistrer: async etat => parametres.ecrire(PARAMETRES.etatNotifications, JSON.stringify(etat)),
        // Sur l'ordinateur, le briefing part à l'heure dite, même sans mouvement.
        toujoursParler: true,
      });
      const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const envoyes = [...resultat.briefingsEnvoyes, ...resultat.alertesEnvoyees];
      if (resultat.echecs.length > 0) {
        setJournalNotifications(`${heure} — Windows a refusé la notification : ${resultat.echecs[0]}`);
      } else if (envoyes.length > 0) {
        setJournalNotifications(
          `${heure} — envoyé : ${envoyes
            .map(id => (id.endsWith('-matin') ? 'briefing du matin' : id.endsWith('-soir') ? 'briefing du soir' : 'alerte de cours'))
            .join(', ')}.`,
        );
      } else {
        setJournalNotifications(precedent => precedent ?? `${heure} — rien à envoyer pour l’instant.`);
      }

      // Carnet : la thèse relue quand le cours atteint l'objectif ou le seuil.
      let deja: string[] = [];
      try {
        deja = JSON.parse(parametres.lire(PARAMETRES.evenementsEnvoyes) ?? '[]');
      } catch {
        deja = [];
      }
      const rappelsEnvoyes: string[] = [];
      for (const rappel of rappelsCarnet(lignesCarnet(), new Set(deja))) {
        if (await pontNotifications.notifier(rappel.titre, rappel.corps, 'carnet').catch(() => false)) {
          rappelsEnvoyes.push(rappel.identifiant);
        }
      }
      // Versement du mois : une fois, le jour choisi, avec la répartition conseillée.
      const reglage = reglageVersementDepuisJson(parametres.lire(PARAMETRES.versementMensuel));
      const maintenant = new Date();
      if (versementDu(reglage, maintenant, new Set(deja))) {
        const contenuActuel = chargerEtat(base);
        const achats = repartirVersement(
          lignesCibles(contenuActuel, depot.derniersCours(), parametres.lire(PARAMETRES.repartitionCible)),
          reglage.montant,
        );
        const message = messageVersement(reglage, achats);
        if (await pontNotifications.notifier(message.titre, message.corps, 'objectifs').catch(() => false)) {
          rappelsEnvoyes.push(identifiantVersement(maintenant));
        }
      }
      if (rappelsEnvoyes.length > 0) {
        parametres.ecrire(PARAMETRES.evenementsEnvoyes, JSON.stringify(retenirEvenements(deja, rappelsEnvoyes)));
      }
      try {
        stockageLocal()?.setItem(CLE_PLANNING_LOCAL, parametres.lire(PARAMETRES.planningBriefings) ?? '');
      } catch {
        // Sans stockage local, pas de rappel verrouillé : rien de plus.
      }

      // Forte séance : une fois par jour et par sens.
      const etat = etatDepuisJson(parametres.lire(PARAMETRES.etatNotifications));
      const date = (aujourdhui ?? dateDuJour)();
      const alerte = alerteVariation(
        variationSeance(chargerEtat(base).etat, depot.derniersCours(), separerHistorique(depot.historique()).titres),
        seuilVariation(parametres.lire(PARAMETRES.seuilVariation)),
        date,
        new Set(etat.briefingsEnvoyes),
      );
      if (alerte && seanceEnCours()) {
        await canal.afficher(alerte);
        parametres.ecrire(
          PARAMETRES.etatNotifications,
          JSON.stringify({ ...etat, briefingsEnvoyes: [...etat.briefingsEnvoyes, alerte.identifiant] }),
        );
      }
    } catch {
      // Une notification manquée ne doit jamais gêner l'application.
    } finally {
      verificationEnCours.current = false;
    }
  }, [pontNotifications, session, aujourdhui, lignesCarnet]);
  verifierNotificationsRef.current = verifierNotifications;

  useEffect(() => {
    if (!deverrouille || !pontNotifications) {
      return;
    }
    const premiere = setTimeout(() => void verifierNotifications(), 15_000);
    const minuterie = setInterval(() => void verifierNotifications(), 60_000);
    return () => {
      clearTimeout(premiere);
      clearInterval(minuterie);
    };
  }, [deverrouille, pontNotifications, verifierNotifications]);

  // Événements sur vos valeurs (détenues et suivies) : résultats, dividende,
  // grosse actualité recoupée. Une fois par heure, en journée.
  const evenementsEnCours = useRef(false);
  const verifierEvenements = useCallback(async () => {
    if (!pontNotifications || !chargementAutomatique || evenementsEnCours.current) return;
    if (new Date().getHours() < 7) return;
    const parametres = new DepotParametres(session.base());
    if (parametres.lire(PARAMETRES.evenementsActifs) === '0') return;
    evenementsEnCours.current = true;
    try {
      const contenuActuel = chargerEtat(session.base());
      const titres = new Map(contenuActuel.titres.map(titre => [titre.id, titre]));
      const ids = [
        ...contenuActuel.etat.positions.map(position => position.titreId),
        ...new DepotWatchlist(session.base()).lister().map(ligne => ligne.titreId),
      ];
      const suivis = [...new Set(ids)]
        .map(id => titres.get(id))
        .filter((titre): titre is Titre => Boolean(titre?.ticker?.trim()))
        .slice(0, 12);
      const pontMedias = (globalThis as { applibourse?: { medias?: { flux(url: string): Promise<string> } } }).applibourse
        ?.medias;
      const valeurs: ValeurSuivie[] = await Promise.all(
        suivis.map(async titre => {
          const symbole = titre.ticker.trim();
          let donnees = fichesEnCache.current.get(symbole);
          if (!donnees) {
            donnees = await chargerValeur(symbole).catch(() => undefined);
            if (donnees) fichesEnCache.current.set(symbole, donnees);
          }
          const url = urlActualitesValeur(titre.nom);
          const articles =
            pontMedias && url ? await pontMedias.flux(url).then(lireRechercheActualites).catch(() => []) : [];
          return {
            nom: titre.nom,
            symbole,
            prochainsResultats: donnees?.fiche.resultats.prochaineDate,
            detachement: donnees?.fiche.dividende.dateDetachement,
            articles,
          };
        }),
      );
      let deja: string[] = [];
      try {
        deja = JSON.parse(parametres.lire(PARAMETRES.evenementsEnvoyes) ?? '[]');
      } catch {
        deja = [];
      }
      const alertes = alertesEvenements(valeurs, (aujourdhui ?? dateDuJour)(), new Set(deja));
      const envoyees: string[] = [];
      for (const alerte of alertes) {
        if (await pontNotifications.notifier(alerte.titre, alerte.corps, alerte.destination).catch(() => false)) {
          envoyees.push(alerte.identifiant);
        }
      }
      if (envoyees.length > 0) {
        parametres.ecrire(PARAMETRES.evenementsEnvoyes, JSON.stringify(retenirEvenements(deja, envoyees)));
      }
    } catch {
      // Une alerte manquée ne doit jamais gêner l'application.
    } finally {
      evenementsEnCours.current = false;
    }
  }, [pontNotifications, chargementAutomatique, session, aujourdhui, fichesEnCache]);

  useEffect(() => {
    if (!deverrouille || !pontNotifications || !chargementAutomatique) return;
    const premiere = setTimeout(() => void verifierEvenements(), 60_000);
    const minuterie = setInterval(() => void verifierEvenements(), 3_600_000);
    return () => {
      clearTimeout(premiere);
      clearInterval(minuterie);
    };
  }, [deverrouille, pontNotifications, chargementAutomatique, verifierEvenements]);

  // Verrouillée, l'application ne peut pas lire le portefeuille : à l'heure
  // d'un briefing, elle prévient seulement qu'il attend.
  useEffect(() => {
    if (deverrouille || !pontNotifications) {
      return;
    }
    const verifier = () => {
      const stockage = stockageLocal();
      if (!stockage) return;
      try {
        const deja: string[] = JSON.parse(stockage.getItem(CLE_RAPPELS_LOCAL) ?? '[]');
        const rappels = rappelsDus(stockage.getItem(CLE_PLANNING_LOCAL) ?? undefined, new Date(), deja);
        if (rappels.length === 0) return;
        stockage.setItem(CLE_RAPPELS_LOCAL, JSON.stringify(retenirRappels(deja, rappels.map(r => r.identifiant))));
        for (const rappel of rappels) {
          void pontNotifications.notifier(rappel.titre, rappel.corps, 'tableau').catch(() => undefined);
        }
      } catch {
        // Un rappel manqué ne doit jamais gêner l'écran de déverrouillage.
      }
    };
    const minuterie = setInterval(verifier, 60_000);
    return () => clearInterval(minuterie);
  }, [deverrouille, pontNotifications]);


  return { journalNotifications, verifierNotificationsRef };
}
