/**
 * Les vérifications du diagnostic, branchées sur les vrais services.
 *
 * Tout passe par le pont d'Electron (`window.applibourse`) ou par `fetch`,
 * que l'application de bureau redirige vers le processus principal pour
 * Yahoo. Hors du bureau, chaque test se déclare indisponible au lieu
 * d'échouer.
 */

import { chargerValeur } from '../fondamentaux/yahoo';
import { lireScreener, requeteScreener } from '../fondamentaux/screener';
import { chargerTheses } from '../fondamentaux/theses';
import { MEDIAS, lireFlux, lireRechercheActualites, urlActualitesValeur } from '../podcast/medias';
import type { Test } from './verifications';

interface Pont {
  systeme?: {
    notifier?(titre: string, corps: string): Promise<boolean>;
    demarrage?(activer?: boolean): Promise<boolean>;
    plateau?(activer?: boolean): Promise<boolean>;
  };
  yahoo?: { screener?(corps: unknown): Promise<unknown> };
  medias?: { flux(url: string): Promise<string>; page?(url: string): Promise<string> };
  voix?: {
    liste(): Promise<Array<{ id: string; nom: string }>>;
    synthetiser(texte: string, voix: string, vitesse: number): Promise<Uint8Array>;
  };
  sauvegardes?: { dossier(): Promise<string>; lister(): Promise<string[]> };
  maj?: {
    verifier(): Promise<{ etat: string; motif?: string; commit?: string; nouveautes?: string[] }>;
    chercher?(): Promise<{ etat: string; motif?: string; commit?: string; nouveautes?: string[] }>;
  };
}

const HORS_BUREAU = 'Disponible dans l’application de bureau.';

export function pontBureau(): Pont | undefined {
  return (globalThis as { applibourse?: Pont }).applibourse;
}

export function testsDuBureau(pont: Pont | undefined = pontBureau()): Test[] {
  const nombre = (valeur: number) => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return [
    {
      cle: 'cours',
      libelle: 'Cours et fiches (Yahoo Finance)',
      executer: pont
        ? async () => {
            const donnees = await chargerValeur('AI.PA');
            const cours = donnees.fiche.cours;
            if (cours === null) throw new Error('réponse reçue, mais sans cours');
            return `Air Liquide à ${nombre(cours)} ${donnees.fiche.devise}, ${donnees.historique.cours.length} semaines d’historique.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'screener',
      libelle: 'Screener',
      executer: pont?.yahoo?.screener
        ? async () => {
            const resultat = lireScreener(await pont.yahoo!.screener!(requeteScreener('france', 'france')));
            if (resultat.actions.length === 0) throw new Error('aucune action renvoyée : critères refusés par Yahoo ?');
            return `${resultat.total.toLocaleString('fr-FR')} actions françaises, la première : ${resultat.actions[0].nom}.`;
          }
        : undefined,
      motifAbsence: pont ? 'Version du bureau trop ancienne : relancez l’application.' : HORS_BUREAU,
    },
    {
      cle: 'presse',
      libelle: 'Revue de presse (flux RSS)',
      executer: pont?.medias
        ? async () => {
            const resultats = await Promise.allSettled(
              MEDIAS.map(async media => lireFlux(await pont.medias!.flux(media.url), media).length),
            );
            const reussis = resultats.filter(resultat => resultat.status === 'fulfilled');
            if (reussis.length === 0) throw new Error('aucun média ne répond');
            const articles = reussis.reduce((total, resultat) => total + (resultat as PromiseFulfilledResult<number>).value, 0);
            return `${reussis.length} médias sur ${MEDIAS.length} répondent, ${articles} articles.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'actus',
      libelle: 'Actualités par valeur (Google Actualités)',
      executer: pont?.medias
        ? async () => {
            const articles = lireRechercheActualites(await pont.medias!.flux(urlActualitesValeur('Air Liquide')!));
            return `${articles.length} articles sur Air Liquide cette semaine.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'theses',
      libelle: 'Thèses (Seeking Alpha, Reddit)',
      executer: pont?.medias
        ? async () => {
            const resultat = await chargerTheses({ nom: 'NVIDIA Corporation', symbole: 'NVDA' }, url => pont.medias!.flux(url));
            if (resultat.echecs === resultat.sources) throw new Error('aucune source ne répond');
            return `${resultat.theses.length} thèses sur NVIDIA, ${resultat.sources - resultat.echecs} sources sur ${resultat.sources} répondent.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'articles',
      libelle: 'Lecture des articles (résumés du podcast)',
      executer: pont?.medias?.page
        ? async () => {
            const html = await pont.medias!.page!('https://www.lesechos.fr/');
            return `page reçue (${Math.round(html.length / 1024)} Ko).`;
          }
        : undefined,
      motifAbsence: pont ? 'Version du bureau trop ancienne : relancez l’application.' : HORS_BUREAU,
    },
    {
      cle: 'voix',
      libelle: 'Voix naturelles du podcast',
      executer: pont?.voix
        ? async () => {
            const voix = await pont.voix!.liste();
            const son = await pont.voix!.synthetiser('Bonjour.', voix[0]?.id ?? 'fr-FR-VivienneMultilingualNeural', 1);
            if (son.length === 0) throw new Error('aucun son renvoyé');
            return `${voix.length} voix, ${Math.round(son.length / 1024)} Ko de son pour « Bonjour ».`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'notifications',
      libelle: 'Notifications Windows',
      executer: pont?.systeme?.notifier
        ? async () => {
            const affichee = await pont.systeme!.notifier!('🩺 Diagnostic AppDashboard', 'Si vous lisez ceci, les notifications fonctionnent.');
            if (!affichee) throw new Error('Windows refuse les notifications : Paramètres › Système › Notifications.');
            const demarrage = await pont.systeme!.demarrage?.().catch(() => undefined);
            const plateau = await pont.systeme!.plateau?.().catch(() => undefined);
            return `envoyée — vérifiez qu’elle s’est affichée. Démarrage avec Windows : ${demarrage ? 'oui' : 'non'} ; reste près de l’horloge : ${plateau === false ? 'non' : 'oui'}.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
    {
      cle: 'sauvegardes',
      libelle: 'Dossier des sauvegardes',
      executer: pont?.sauvegardes
        ? async () => {
            const dossier = await pont.sauvegardes!.dossier();
            const fichiers = await pont.sauvegardes!.lister();
            return `${dossier} — ${fichiers.length} sauvegarde${fichiers.length > 1 ? 's' : ''}.`;
          }
        : undefined,
      motifAbsence: pont ? 'Version du bureau trop ancienne : relancez l’application.' : HORS_BUREAU,
    },
    {
      cle: 'maj',
      libelle: 'Mises à jour (GitHub)',
      executer: pont?.maj
        ? async () => {
            // GitHub interrogé maintenant quand la version le permet.
            const etat = await (pont.maj!.chercher ?? pont.maj!.verifier)();
            if (etat.etat === 'erreur') throw new Error(etat.motif ?? 'erreur inconnue');
            return etat.etat === 'a-jour'
              ? `à jour (${etat.commit?.slice(0, 7)}).`
              : etat.etat === 'disponible'
                ? `une mise à jour attend : ${etat.nouveautes?.length ?? 0} nouveauté(s).`
                : `état : ${etat.etat}.`;
          }
        : undefined,
      motifAbsence: HORS_BUREAU,
    },
  ];
}
