/**
 * App « Abonnements » du hub (page « Administration »), réservée aux
 * Fondateurs. Deux onglets : Suivi (`Suivi.tsx`) · Réglages
 * (`ReglagesAbonnements.tsx`).
 *
 * Extraite de l'Administration SANS changer les données : le suivi vit
 * toujours dans `DonneesAdmin.abonnements` (base chiffrée du Fondateur,
 * `admin/donnees.ts`), synchronisé et fusionné comme avant
 * (`admin/fusionDonnees.ts`), journalisé dans le même journal. Aucune
 * migration n'est donc nécessaire. Comme le panneau d'Administration, l'écran
 * se verrouille après le délai d'inactivité réglé dans l'Administration et
 * redemande alors mot de passe + code.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Profil } from '../../profils/profils';
import { FormulaireIdentite } from '../Administration';
import { RetourHub } from '../Hub';
import { avecEvenement, chargerDonnees, donneesVides, enregistrerDonnees, type DonneesAdmin } from '../admin/donnees';
import type { EvenementAudit } from '../admin/journal';
import { roleDe } from '../admin/roles';
import { Avis, styleTitre } from '../admin/ui/commun';
import { apresVerification, doitVerrouiller, etatInitial, noterActivite, verrouiller, type EtatVerrouPanel } from '../admin/verrouillage';
import { police } from '../themes';
import type { PropsRacineApp } from '../types';
import { ecouterActivite } from '../web';
import { useInfoOnglet } from '../multi/contexte';
import { peutVoirAbonnements } from './actionsAbo';
import { ReglagesAbonnements } from './ReglagesAbonnements';
import { SuiviAbonnements, type OutilsAbo } from './Suivi';

type Onglet = 'suivi' | 'reglages';

const ONGLETS: ReadonlyArray<readonly [Onglet, string, string]> = [
  ['suivi', '💳', 'Suivi'],
  ['reglages', '⚙', 'Réglages'],
];

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

export function AppAbonnements({ contexte, theme, onRetour }: PropsRacineApp) {
  const controle = contexte.profils;
  const services = contexte.admin;
  const acteur = controle?.actuel;
  const horsHistorique = Boolean(acteur && !acteur.admin && roleDe(acteur) !== 'ami');
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const [onglet, setOnglet] = useState<Onglet>('suivi');
  const [enCours, setEnCours] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const donneesRef = useRef<DonneesAdmin>(services ? chargerDonnees(services.stockage) : donneesVides());
  const [donnees, setDonnees] = useState<DonneesAdmin>(donneesRef.current);
  const [verrou, setVerrou] = useState<EtatVerrouPanel>(() => etatInitial(maintenant()));
  const verrouRef = useRef(verrou);
  verrouRef.current = verrou;

  const relire = useCallback(() => {
    if (services) {
      donneesRef.current = chargerDonnees(services.stockage);
      setDonnees(donneesRef.current);
    }
  }, [services]);
  // Données reçues d'un autre appareil (synchronisation) : relues, comme dans l'Administration.
  const versionComptes = controle?.versionComptes ?? 0;
  useEffect(() => {
    if (versionComptes > 0) relire();
  }, [relire, versionComptes]);

  const majDonnees = useCallback(
    (changer: (d: DonneesAdmin) => DonneesAdmin) => {
      // Toujours à partir de ce qui est enregistré : une réception entre-temps n'est pas écrasée.
      const suivantes = changer(services ? chargerDonnees(services.stockage) : donneesRef.current);
      donneesRef.current = suivantes;
      if (services) enregistrerDonnees(services.stockage, suivantes);
      setDonnees(suivantes);
    },
    [services],
  );
  const nomActeur = acteur?.nom;
  const journaliser = useCallback(
    (evenement: Omit<EvenementAudit, 'date'>) => {
      const complet = horsHistorique ? { ...evenement, acteur: nomActeur } : evenement;
      majDonnees(d => avecEvenement(d, complet, maintenant()));
    },
    [majDonnees, maintenant, horsHistorique, nomActeur],
  );

  // Verrouillage sur inactivité : même délai que le panneau d'Administration. Dans un onglet, seule
  // compte l'activité faite ici (masqué : rien n'est écouté ; côte à côte : pas celle de l'autre app).
  const infoOnglet = useInfoOnglet();
  const racine = useRef<unknown>(null);
  const activite = useCallback(
    () => setVerrou(v => (doitVerrouiller(v, maintenant(), donneesRef.current.reglages.verrouMinutes) ? verrouiller(v) : noterActivite(v, maintenant()))),
    [maintenant],
  );
  useEffect(() => ecouterActivite(activite, infoOnglet.partage ? { dans: () => racine.current } : {}), [activite, infoOnglet.partage]);
  useEffect(() => {
    const controler = () => {
      if (doitVerrouiller(verrouRef.current, maintenant(), donneesRef.current.reglages.verrouMinutes)) {
        setVerrou(v => verrouiller(v));
        journaliser({ type: 'securite', action: `Abonnements verrouillés après ${donneesRef.current.reglages.verrouMinutes} min sans activité` });
      }
    };
    // Aussi au retour de l'onglet à l'écran : le délai a pu passer pendant qu'il était masqué.
    controler();
    const minuterie = setInterval(controler, 5_000);
    return () => clearInterval(minuterie);
  }, [maintenant, journaliser]);
  const delaiPasse = !verrou.verrouille && doitVerrouiller(verrou, maintenant(), donnees.reglages.verrouMinutes);

  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  // Défense en profondeur : le hub ne propose cette app qu'aux Fondateurs ; l'écran le revérifie.
  if (!controle || !acteur || !services || controle.sessionAdmin || !peutVoirAbonnements(acteur)) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond, padding: 24 }]} testID="app-abonnements-refus">
        <RetourHub theme={theme} onRetour={onRetour} titre="Abonnements" />
        <Text style={[styleTitre(theme), { fontSize: 28, marginTop: 24 }]}>Réservé aux fondateurs</Text>
      </View>
    );
  }

  const agir = (libelle: string, action: () => Promise<string | void>) => {
    setErreur(undefined);
    setAvis(undefined);
    setEnCours(libelle);
    action()
      .then(resultat => {
        if (resultat) setAvis(resultat);
      })
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(undefined));
  };

  const tous = controle.tous ?? [];
  const outils: OutilsAbo = {
    theme,
    donnees,
    tous,
    acteur,
    maintenant,
    majDonnees,
    journaliser,
    agir,
    services,
    modifierProfils: (changer, evenements, texteAvis) => {
      if (!controle.onModifierProfils) {
        setErreur('Modification des comptes indisponible sur cette plateforme.');
        return;
      }
      agir('Enregistrement…', async () => {
        await controle.onModifierProfils!(changer(tous as Profil[]));
        for (const evenement of evenements) journaliser(evenement);
        return texteAvis;
      });
    },
  };

  if (verrou.verrouille || delaiPasse) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="abonnements-verrouille">
        <ScrollView contentContainerStyle={styles.page}>
          <RetourHub theme={theme} onRetour={onRetour} titre="Abonnements" />
          <Text style={[styleTitre(theme), styles.h1]}>🔒 Abonnements verrouillés</Text>
          <Text style={[attenue, styles.lead]}>Aucune activité depuis un moment : confirmez votre identité pour continuer.</Text>
          {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-erreur" /> : null}
          <FormulaireIdentite
            theme={theme}
            raison="Déverrouiller les abonnements"
            enCours={Boolean(enCours)}
            onValider={(motDePasse, code) =>
              agir('Vérification…', async () => {
                try {
                  services.verifierIdentite(motDePasse, code);
                } catch (e) {
                  journaliser({ type: 'securite', action: 'Échec de vérification d’identité (déverrouillage des abonnements)' });
                  throw e;
                }
                setVerrou(v => apresVerification(v, maintenant()));
                journaliser({ type: 'securite', action: 'Identité vérifiée : déverrouillage des abonnements' });
              })
            }
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View ref={racine as React.Ref<never>} style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-abonnements" onTouchStart={activite}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <RetourHub theme={theme} onRetour={onRetour} titre="Abonnements" />
        <Text style={[styleTitre(theme), styles.h1]} accessibilityRole="header">
          Abonnements
        </Text>
        <Text style={[attenue, styles.lead]}>Qui a payé, les prochaines échéances et les rappels. Suivi manuel : rien n’est prélevé ni coupé automatiquement.</Text>

        <View style={styles.onglets} accessibilityRole="tablist">
          {ONGLETS.map(([id, icone, libelle]) => {
            const actif = onglet === id;
            return (
              <Pressable
                key={id}
                testID={`abo-onglet-${id}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                onPress={() => {
                  relire();
                  setOnglet(id);
                  setErreur(undefined);
                  setAvis(undefined);
                }}
                style={[
                  styles.onglet,
                  {
                    backgroundColor: actif ? theme.teintes.admin : theme.surface,
                    borderColor: actif ? theme.teintes.admin : theme.ligne,
                    borderRadius: theme.rayonGrand ? 999 : 0,
                  },
                ]}>
                <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', ...police(theme.policeTexte) }}>
                  {icone} {libelle}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {enCours ? <Text style={[attenue, { marginBottom: 12 }]}>{enCours}</Text> : null}
        {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-erreur" /> : null}
        {avis ? <Avis theme={theme} genre="ok" texte={avis} testID="admin-avis" /> : null}

        <View style={{ marginTop: 12 }}>
          {onglet === 'suivi' ? <SuiviAbonnements outils={outils} onReglages={() => setOnglet('reglages')} /> : null}
          {onglet === 'reglages' ? <ReglagesAbonnements theme={theme} services={services} acteur={acteur} maintenant={maintenant} onEnregistre={relire} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  h1: { fontSize: 44, letterSpacing: -1, marginTop: 24 },
  lead: { marginTop: 12, fontSize: 17 },
  onglets: { flexDirection: 'row', gap: 6, marginTop: 28, marginBottom: 12, flexWrap: 'wrap' },
  onglet: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, minHeight: 44, justifyContent: 'center' },
});
