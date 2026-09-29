/**
 * App « Administration » du hub, réservée au profil administrateur.
 *
 * Six sections : Tableau de bord · Utilisateurs · Applications · Sécurité ·
 * Journal · Réglages (`admin/ui/`). Cet écran les assemble et leur fournit
 * les outils communs (`OutilsAdmin`) :
 *
 *  - les **données de l'Administration** (réglages, notes, journal) vivent
 *    dans la base chiffrée de l'administrateur (`admin/donnees.ts`) ;
 *  - toute modification des comptes passe par l'hôte (`ControleProfils`),
 *    qui revalide et chiffre l'annuaire, puis est **journalisée** ;
 *  - le panneau se **verrouille** après un délai sans activité, et les
 *    actions sensibles redemandent mot de passe + code (`Session.verifierIdentite`,
 *    mêmes temporisations qu'au déverrouillage) ;
 *  - les connexions des amis survenues depuis la dernière visite sont
 *    reportées au journal à l'ouverture.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Profil } from '../profils/profils';
import { RetourHub } from './Hub';
import { nouvellesConnexions } from './admin/comptes';
import { avecEvenement, chargerDonnees, donneesVides, enregistrerDonnees, evaluerRobustesse, type DonneesAdmin } from './admin/donnees';
import type { EvenementAudit } from './admin/journal';
import { apresVerification, confianceValide, doitVerrouiller, etatInitial, noterActivite, verrouiller, type EtatVerrouPanel } from './admin/verrouillage';
import { Applications } from './admin/ui/Applications';
import { Avis, BoutonHub, Champ, Panneau, styleTitre, type IdSection, type OutilsAdmin } from './admin/ui/commun';
import { Journal } from './admin/ui/Journal';
import { Reglages } from './admin/ui/Reglages';
import { Securite } from './admin/ui/Securite';
import { Tableau } from './admin/ui/Tableau';
import { Utilisateurs } from './admin/ui/Utilisateurs';
import { police, teinteTransparente, type ThemeHub } from './themes';
import type { PropsRacineApp } from './types';
import { ecouterActivite } from './web';

const SECTIONS: ReadonlyArray<readonly [IdSection, string, string]> = [
  ['tableau', '◧', 'Tableau de bord'],
  ['utilisateurs', '👥', 'Utilisateurs'],
  ['applications', '▦', 'Applications'],
  ['securite', '🛡', 'Sécurité'],
  ['journal', '☰', 'Journal'],
  ['reglages', '⚙', 'Réglages'],
];

/** Laisse l'indicateur s'afficher avant Argon2id, qui bloque le fil un instant. */
function apresRendu<T>(action: () => Promise<T>): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    setTimeout(() => {
      action().then(resoudre, rejeter);
    }, 30);
  });
}

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

type Demande = { raison: string; action: () => void };

export function Administration({ contexte, theme, registre, onRetour, onTheme }: PropsRacineApp) {
  const controle = contexte.profils;
  const services = contexte.admin;
  const { width } = useWindowDimensions();
  const large = width >= 900;
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const [section, setSection] = useState<IdSection>('tableau');
  const [cible, setCible] = useState<string | undefined>();
  const [enCours, setEnCours] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [demande, setDemande] = useState<Demande | undefined>();
  const donneesRef = useRef<DonneesAdmin>(services ? chargerDonnees(services.stockage) : donneesVides());
  const [donnees, setDonnees] = useState<DonneesAdmin>(donneesRef.current);
  const [verrou, setVerrou] = useState<EtatVerrouPanel>(() => etatInitial(maintenant()));
  const verrouRef = useRef(verrou);
  verrouRef.current = verrou;

  const majDonnees = useCallback(
    (changer: (d: DonneesAdmin) => DonneesAdmin) => {
      const suivantes = changer(donneesRef.current);
      donneesRef.current = suivantes;
      if (services) {
        enregistrerDonnees(services.stockage, suivantes);
      }
      setDonnees(suivantes);
    },
    [services],
  );
  const journaliser = useCallback(
    (evenement: Omit<EvenementAudit, 'date'>) => majDonnees(d => avecEvenement(d, evenement, maintenant())),
    [majDonnees, maintenant],
  );

  // Connexions des amis depuis la dernière visite : reportées au journal.
  const tous = controle?.tous ?? [];
  const signatureConnexions = tous.map(p => `${p.id}:${p.connexions ?? 0}`).join(',');
  useEffect(() => {
    const nouvelles = nouvellesConnexions(tous, donneesRef.current.connexionsVues);
    if (nouvelles.length === 0) {
      return;
    }
    majDonnees(d => {
      let suivant = d;
      for (const { profil, nombre } of nouvelles) {
        suivant = avecEvenement(
          suivant,
          { type: 'connexion', cible: profil.id, nomCible: profil.nom, action: `${profil.nom} a ouvert son compte${nombre > 1 ? ` (${nombre} fois)` : ''}`, date: profil.derniereConnexion } as Omit<EvenementAudit, 'date'>,
          maintenant(),
        );
      }
      return { ...suivant, connexionsVues: { ...suivant.connexionsVues, ...Object.fromEntries(nouvelles.map(({ profil }) => [profil.id, profil.connexions ?? 0])) } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la signature des compteurs compte.
  }, [signatureConnexions]);

  // Verrouillage sur inactivité.
  const activite = useCallback(() => setVerrou(v => noterActivite(v, maintenant())), [maintenant]);
  useEffect(() => ecouterActivite(activite), [activite]);
  useEffect(() => {
    const minuterie = setInterval(() => {
      if (doitVerrouiller(verrouRef.current, maintenant(), donneesRef.current.reglages.verrouMinutes)) {
        setVerrou(v => verrouiller(v));
        setDemande(undefined);
        journaliser({ type: 'securite', action: `Panneau verrouillé après ${donneesRef.current.reglages.verrouMinutes} min sans activité` });
      }
    }, 5_000);
    return () => clearInterval(minuterie);
  }, [maintenant, journaliser]);

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  // Défense en profondeur : le hub ne propose pas cette app à un ami, mais
  // l'écran refuse aussi de s'afficher pour lui.
  if (!controle || (contexte.profil && !contexte.profil.admin) || !controle.actuel.admin || controle.sessionAdmin) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond, padding: 24 }]}>
        <RetourHub theme={theme} onRetour={onRetour} />
        <Text style={[styleTitre(theme), { fontSize: 28, marginTop: 24 }]}>Réservé à l’administrateur</Text>
      </View>
    );
  }

  const agir = (libelle: string, action: () => Promise<string | void>) => {
    setErreur(undefined);
    setAvis(undefined);
    setEnCours(libelle);
    apresRendu(action)
      .then(resultat => {
        if (resultat) setAvis(resultat);
      })
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(undefined));
  };

  const exigerIdentite = (raison: string, action: () => void, forcer = false) => {
    if (!services) {
      action();
      return;
    }
    if (!forcer && confianceValide(verrouRef.current, maintenant(), donneesRef.current.reglages.confianceMinutes)) {
      action();
      return;
    }
    setDemande({ raison, action });
  };

  const outils: OutilsAdmin = {
    theme,
    registre,
    controle,
    tous,
    maintenant,
    donnees,
    majDonnees,
    journaliser,
    agir,
    enCours,
    exigerIdentite,
    modifierProfils: (changer, evenements, texteAvis) => {
      if (!controle.onModifierProfils) {
        setErreur('Modification des comptes indisponible sur cette plateforme.');
        return;
      }
      agir('Enregistrement…', async () => {
        await controle.onModifierProfils!(changer(controle.tous as Profil[]));
        for (const evenement of evenements) {
          journaliser(evenement);
        }
        return texteAvis;
      });
    },
    services,
    onTheme,
    allerA: (id, choisi) => {
      setSection(id);
      setCible(choisi);
    },
    large,
  };

  const verifier = (motDePasse: string, code: string, raison: string, suite: () => void) =>
    agir('Vérification…', async () => {
      try {
        services!.verifierIdentite(motDePasse, code);
      } catch (e) {
        journaliser({ type: 'securite', action: `Échec de vérification d’identité (${raison})` });
        throw e;
      }
      const niveau = evaluerRobustesse(motDePasse);
      majDonnees(d => ({ ...d, robustesse: { niveau, le: new Date(maintenant()).toISOString() } }));
      setVerrou(v => apresVerification(v, maintenant()));
      journaliser({ type: 'securite', action: `Identité vérifiée : ${raison}` });
      setDemande(undefined);
      suite();
    });

  if (verrou.verrouille) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="admin-verrouille">
        <ScrollView contentContainerStyle={styles.page}>
          <RetourHub theme={theme} onRetour={onRetour} />
          <Text style={[styleTitre(theme), styles.h1]}>🔒 Panneau verrouillé</Text>
          <Text style={[attenue, styles.lead]}>Aucune activité depuis un moment : confirmez votre identité pour continuer.</Text>
          {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-erreur" /> : null}
          <FormulaireIdentite theme={theme} raison="Déverrouiller le panneau d’administration" enCours={Boolean(enCours)} onValider={(m, c) => verifier(m, c, 'déverrouillage du panneau', () => undefined)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-administration" onTouchStart={activite}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <RetourHub theme={theme} onRetour={onRetour} />
        <Text style={[styleTitre(theme), styles.h1]} accessibilityRole="header">
          Administration
        </Text>
        <Text style={[attenue, styles.lead]}>Comptes, accès aux apps, sécurité et journal de ce hub.</Text>

        <View style={styles.onglets} accessibilityRole="tablist">
          {SECTIONS.map(([id, icone, libelle]) => {
            const actif = section === id;
            return (
              <Pressable
                key={id}
                testID={`admin-onglet-${id}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                onPress={() => {
                  setSection(id);
                  setCible(undefined);
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
                  {id === 'utilisateurs' ? ` ${tous.length}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {enCours ? <Text style={[attenue, { marginBottom: 12 }]}>{enCours}</Text> : null}
        {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-erreur" /> : null}
        {avis ? <Avis theme={theme} genre="ok" texte={avis} testID="admin-avis" /> : null}
        {demande ? (
          <FormulaireIdentite
            theme={theme}
            raison={demande.raison}
            enCours={Boolean(enCours)}
            onAnnuler={() => setDemande(undefined)}
            onValider={(m, c) => verifier(m, c, demande.raison, demande.action)}
          />
        ) : null}

        <View style={{ marginTop: 12 }}>
          {section === 'tableau' ? <Tableau outils={outils} /> : null}
          {section === 'utilisateurs' ? <Utilisateurs key={cible ?? 'liste'} outils={outils} cible={cible} /> : null}
          {section === 'applications' ? <Applications outils={outils} /> : null}
          {section === 'securite' ? (
            <Securite
              outils={outils}
              onVerrouiller={() => {
                setVerrou(v => verrouiller(v));
                journaliser({ type: 'securite', action: 'Panneau verrouillé à la main' });
              }}
            />
          ) : null}
          {section === 'journal' ? <Journal outils={outils} /> : null}
          {section === 'reglages' ? <Reglages outils={outils} /> : null}
        </View>
        <Text style={[texte, { fontSize: 12, marginTop: 24, color: theme.attenue }]}>
          Aucun secret n’est conservé ni journalisé : mots de passe, clés et codes de récupération ne s’affichent qu’une fois.
        </Text>
      </ScrollView>
    </View>
  );
}

/** Redemande mot de passe + code TOTP de l'administrateur. */
function FormulaireIdentite({
  theme,
  raison,
  enCours,
  onValider,
  onAnnuler,
}: {
  theme: ThemeHub;
  raison: string;
  enCours: boolean;
  onValider(motDePasse: string, code: string): void;
  onAnnuler?(): void;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  return (
    <Panneau theme={theme} testID="admin-identite" style={{ borderColor: theme.teintes.admin, backgroundColor: teinteTransparente(theme.teintes.admin, 0.06), marginVertical: 8 }}>
      <Text style={[styleTitre(theme), { fontSize: 18 }]}>Vérification d’identité</Text>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>
        {raison} : saisissez votre mot de passe et le code de votre application d’authentification (mêmes vérifications qu’au déverrouillage).
      </Text>
      <Champ theme={theme} libelle="Mot de passe" valeur={motDePasse} onChanger={setMotDePasse} secret testID="admin-identite-mdp" />
      <Champ theme={theme} libelle="Code à 6 chiffres" valeur={code} onChanger={v => setCode(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={6} testID="admin-identite-code" />
      <View style={styles.actions}>
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre={enCours ? 'Vérification…' : 'Confirmer'}
          desactive={enCours || !motDePasse || code.length !== 6}
          onPress={() => {
            onValider(motDePasse, code);
            setMotDePasse('');
            setCode('');
          }}
          testID="admin-identite-valider"
        />
        {onAnnuler ? <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} testID="admin-identite-annuler" /> : null}
      </View>
    </Panneau>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  h1: { fontSize: 44, letterSpacing: -1, marginTop: 24 },
  lead: { marginTop: 12, fontSize: 17 },
  onglets: { flexDirection: 'row', gap: 6, marginTop: 28, marginBottom: 12, flexWrap: 'wrap' },
  onglet: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, minHeight: 38, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
