/**
 * App « Administration » du hub, réservée au profil administrateur.
 *
 * Elle s'appuie entièrement sur le système de profils existant : chaque ami
 * est un profil, avec son coffre et son portefeuille chiffrés à part. Ce que
 * l'administrateur règle ici :
 *
 *  - la **création** d'un compte : l'app génère le mot de passe, le secret
 *    TOTP et les codes de récupération (mêmes mécanismes qu'au premier
 *    lancement), et les montre **une seule fois** ;
 *  - les **apps** ouvertes à l'ami (une case par app du registre) ;
 *  - la **régénération** des identifiants, la désactivation, la suppression.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { QrCode } from '../ui/ecrans/CarteSynchro';
import type { IdentifiantsAmi } from '../profils/identifiants';
import type { Profil } from '../profils/profils';
import { appsAttribuables, basculerApp, nombreUtilisateurs, peutOuvrir } from './permissions';
import { BoutonHub, RetourHub } from './Hub';
import { police, teinteTransparente, type ThemeHub } from './themes';
import type { AppHub, PropsRacineApp } from './types';

type Onglet = 'utilisateurs' | 'apps';
type Confirmation = { genre: 'regenerer' | 'supprimer'; id: string } | undefined;

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

export function Administration({ contexte, theme, registre, onRetour }: PropsRacineApp) {
  const controle = contexte.profils;
  const { width } = useWindowDimensions();
  const [onglet, setOnglet] = useState<Onglet>('utilisateurs');
  const [choisi, setChoisi] = useState<string | undefined>();
  const [creation, setCreation] = useState(false);
  const [identifiants, setIdentifiants] = useState<{ nom: string; valeurs: IdentifiantsAmi } | undefined>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [enCours, setEnCours] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const accent = theme.teintes.admin;
  const large = width >= 820;

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const titre = {
    color: theme.texte,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };

  // Défense en profondeur : le hub ne propose pas cette app à un ami, mais
  // l'écran refuse aussi de s'afficher pour lui.
  if (!controle || (contexte.profil && !contexte.profil.admin) || !controle.actuel.admin) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond, padding: 24 }]}>
        <RetourHub theme={theme} onRetour={onRetour} />
        <Text style={[titre, { fontSize: 28, marginTop: 24 }]}>Réservé à l’administrateur</Text>
      </View>
    );
  }

  const tous = controle.tous;
  const attribuables = appsAttribuables(registre);
  const selection = tous.find(profil => profil.id === choisi);

  const agir = (libelle: string, action: () => Promise<void>) => {
    setErreur(undefined);
    setAvis(undefined);
    setEnCours(libelle);
    apresRendu(action)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(undefined));
  };

  const pilule = (profil: Profil) =>
    profil.admin
      ? { texte: 'admin', couleur: accent }
      : profil.actif === false
        ? { texte: 'désactivé', couleur: theme.critique }
        : { texte: 'actif', couleur: theme.ok };

  const nomsApps = (profil: Profil) =>
    profil.admin
      ? 'Toutes'
      : registre.filter(app => peutOuvrir(app, profil)).map(app => app.nom).join(', ') || 'Aucune';

  const listeUtilisateurs = (
    <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, padding: 0 }, large && { flex: 1.5 }]}>
      {tous.map((profil, index) => {
        const etat = pilule(profil);
        const selectionne = profil.id === choisi && !creation;
        return (
          <Pressable
            key={profil.id}
            testID={`admin-ligne-${profil.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: selectionne }}
            onPress={() => {
              setCreation(false);
              setConfirmation(undefined);
              setChoisi(profil.id);
            }}
            style={(e: { pressed: boolean; hovered?: boolean }) => [
              styles.ligne,
              index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne },
              selectionne
                ? { backgroundColor: teinteTransparente(accent, 0.14) }
                : e.hovered
                  ? { backgroundColor: teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.04) }
                  : null,
            ]}>
            <View style={[styles.avatar, { backgroundColor: profil.admin ? accent : teinteTransparente(accent, 0.18), borderRadius: theme.rayonGrand ? 16 : 0 }]}>
              <Text style={{ color: profil.admin ? theme.surAccent : accent, fontWeight: '700' }}>{profil.nom.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[texte, { fontWeight: '600' }]} numberOfLines={1}>
                {profil.nom}
              </Text>
              <Text style={[attenue, { fontSize: 12 }]} numberOfLines={1}>
                {profil.creeLe ? `Créé le ${profil.creeLe} · ` : ''}Apps : {nomsApps(profil)}
              </Text>
            </View>
            <Text
              style={[
                styles.pilule,
                police(theme.policeChiffres),
                { color: etat.couleur, backgroundColor: teinteTransparente(etat.couleur, 0.16), borderRadius: theme.rayonGrand ? 999 : 0 },
              ]}>
              {etat.texte}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const panneauDetail = identifiants ? (
    <PanneauIdentifiants theme={theme} nom={identifiants.nom} valeurs={identifiants.valeurs} onTermine={() => setIdentifiants(undefined)} />
  ) : creation ? (
    <FormulaireCreation
      theme={theme}
      apps={attribuables}
      enCours={Boolean(enCours)}
      onAnnuler={() => setCreation(false)}
      onCreer={(nom, apps) =>
        agir('Création du compte…', async () => {
          const valeurs = await controle.onCreerCompte!(nom, apps);
          setCreation(false);
          setIdentifiants({ nom: nom.trim(), valeurs });
        })
      }
    />
  ) : selection ? (
    <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="admin-detail">
      <Text style={[titre, { fontSize: 20 }]}>{selection.nom}</Text>
      {selection.admin ? (
        <Text style={attenue}>Administrateur : accès à toutes les apps. Ce profil ne se désactive pas et ne se supprime pas.</Text>
      ) : (
        <>
          <Text style={[attenue, styles.intertitre]}>ACCÈS AUX APPS</Text>
          {attribuables.map((app, index) => {
            const ouverte = peutOuvrir(app, selection);
            return (
              <View key={app.id} style={[styles.ligneApp, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]}>
                <View style={[styles.carre, { backgroundColor: theme.teintes[app.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
                  <Text style={{ color: theme.surAccent, fontWeight: '700' }}>{app.icone}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[texte, { fontWeight: '600' }]}>{app.nom}</Text>
                  <Text style={[attenue, { fontSize: 12 }]}>{app.description}</Text>
                </View>
                <Switch
                  testID={`admin-app-${selection.id}-${app.id}`}
                  accessibilityLabel={`${app.nom} pour ${selection.nom}`}
                  value={ouverte}
                  disabled={Boolean(enCours) || !controle.onAutoriser}
                  trackColor={{ true: accent, false: theme.ligne }}
                  onValueChange={valeur =>
                    agir('Enregistrement…', () =>
                      controle.onAutoriser!(selection.id, basculerApp(selection.apps ?? [], app.id, valeur)),
                    )
                  }
                />
              </View>
            );
          })}
          <Text style={[attenue, styles.intertitre]}>COMPTE</Text>
          {confirmation?.id === selection.id ? (
            <View style={[styles.avis, { backgroundColor: teinteTransparente(theme.alerte, 0.16) }]}>
              <Text style={{ color: theme.alerte }}>
                {confirmation.genre === 'regenerer'
                  ? `De nouveaux identifiants remplacent les anciens. Le portefeuille actuel de ${selection.nom} est scellé par l’ancienne clé : il sera effacé. (S’il a seulement oublié son mot de passe, il peut plutôt utiliser « Mot de passe oublié ? » avec un code de récupération.)`
                  : `Le profil de ${selection.nom} et tout son portefeuille seront effacés de cet appareil.`}
              </Text>
              <View style={styles.actions}>
                <BoutonHub
                  theme={theme}
                  variante="danger"
                  titre={confirmation.genre === 'regenerer' ? 'Régénérer' : 'Supprimer'}
                  testID="admin-confirmer"
                  desactive={Boolean(enCours)}
                  onPress={() => {
                    const { genre, id } = confirmation;
                    setConfirmation(undefined);
                    if (genre === 'regenerer') {
                      agir('Génération des identifiants…', async () => {
                        const valeurs = await controle.onRegenerer!(id);
                        setIdentifiants({ nom: selection.nom, valeurs });
                      });
                    } else {
                      agir('Suppression…', async () => {
                        await controle.onSupprimer(id);
                        setChoisi(undefined);
                        setAvis(`Profil « ${selection.nom} » supprimé.`);
                      });
                    }
                  }}
                />
                <BoutonHub theme={theme} titre="Annuler" onPress={() => setConfirmation(undefined)} />
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              {controle.onRegenerer ? (
                <BoutonHub
                  theme={theme}
                  titre="Régénérer les identifiants"
                  testID="admin-regenerer"
                  desactive={Boolean(enCours)}
                  onPress={() => setConfirmation({ genre: 'regenerer', id: selection.id })}
                />
              ) : null}
              {controle.onActiver ? (
                <BoutonHub
                  theme={theme}
                  titre={selection.actif === false ? 'Réactiver' : 'Désactiver'}
                  testID="admin-activer"
                  desactive={Boolean(enCours)}
                  onPress={() =>
                    agir('Enregistrement…', async () => {
                      await controle.onActiver!(selection.id, selection.actif === false);
                      setAvis(selection.actif === false ? `${selection.nom} peut de nouveau ouvrir son profil.` : `${selection.nom} ne peut plus ouvrir son profil.`);
                    })
                  }
                />
              ) : null}
              <BoutonHub
                theme={theme}
                variante="danger"
                titre="Supprimer"
                testID="admin-supprimer"
                desactive={Boolean(enCours)}
                onPress={() => setConfirmation({ genre: 'supprimer', id: selection.id })}
              />
            </View>
          )}
        </>
      )}
    </View>
  ) : (
    <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]}>
      <Text style={attenue}>Sélectionnez un utilisateur pour régler ses accès, ou créez un compte pour un ami.</Text>
    </View>
  );

  return (
    <ScrollView style={[styles.racine, { backgroundColor: theme.fond }]} contentContainerStyle={styles.page} testID="app-administration">
      <RetourHub theme={theme} onRetour={onRetour} />
      <Text style={[titre, styles.h1]} accessibilityRole="header">
        Administration
      </Text>
      <Text style={[attenue, styles.lead]}>Comptes des amis, identifiants et accès aux apps de ce hub.</Text>

      <View style={styles.onglets} accessibilityRole="tablist">
        {(
          [
            ['utilisateurs', `Utilisateurs ${tous.length}`],
            ['apps', `Apps ${registre.length}`],
          ] as const
        ).map(([cle, libelle]) => {
          const actif = onglet === cle;
          return (
            <Pressable
              key={cle}
              testID={`admin-onglet-${cle}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: actif }}
              onPress={() => setOnglet(cle)}
              style={[
                styles.onglet,
                {
                  backgroundColor: actif ? accent : theme.surface,
                  borderColor: actif ? accent : theme.ligne,
                  borderRadius: theme.rayonGrand ? 999 : 0,
                },
              ]}>
              <Text style={{ color: actif ? theme.surAccent : theme.attenue, fontWeight: '600', ...police(theme.policeTexte) }}>{libelle}</Text>
            </Pressable>
          );
        })}
      </View>

      {enCours ? <Text style={[attenue, { marginBottom: 12 }]}>{enCours}</Text> : null}
      {erreur ? (
        <Text style={[styles.avis, { color: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.14) }]} testID="admin-erreur">
          {erreur}
        </Text>
      ) : null}
      {avis ? (
        <Text style={[styles.avis, { color: theme.ok, backgroundColor: teinteTransparente(theme.ok, 0.14) }]}>{avis}</Text>
      ) : null}

      {onglet === 'utilisateurs' ? (
        <>
          <View style={styles.barre}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Text style={[titre, { fontSize: 20 }]}>Utilisateurs</Text>
              <Text style={[attenue, { fontSize: 13, marginTop: 2 }]}>Sélectionnez une ligne pour modifier l’accès aux apps.</Text>
            </View>
            <BoutonHub
              theme={theme}
              variante="plein"
              couleur={accent}
              titre="Nouvel utilisateur"
              testID="admin-nouveau"
              desactive={Boolean(enCours) || Boolean(identifiants) || !controle.onCreerCompte}
              onPress={() => {
                setConfirmation(undefined);
                setCreation(true);
              }}
            />
          </View>
          <View style={[styles.partage, large && { flexDirection: 'row', alignItems: 'flex-start' }]}>
            {listeUtilisateurs}
            <View style={large ? { flex: 1, minWidth: 0 } : undefined}>{panneauDetail}</View>
          </View>
        </>
      ) : (
        <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]}>
          <Text style={[attenue, { fontSize: 13 }]}>Lecture seule : les apps viennent du registre (src/hub/registre.tsx).</Text>
          {registre.map((app, index) => (
            <View key={app.id} style={[styles.ligneApp, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]} testID={`admin-registre-${app.id}`}>
              <View style={[styles.carre, { backgroundColor: theme.teintes[app.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
                <Text style={{ color: theme.surAccent, fontWeight: '700' }}>{app.icone}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[texte, { fontWeight: '600' }]}>{app.nom}</Text>
                <Text style={[attenue, { fontSize: 12 }, police(theme.policeChiffres)]}>{app.id}</Text>
              </View>
              <Text style={[attenue, { fontSize: 13 }]}>
                {app.adminSeulement ? 'Administrateur seulement' : `${nombreUtilisateurs(app, tous)} utilisateur(s)`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function FormulaireCreation({
  theme,
  apps,
  enCours,
  onAnnuler,
  onCreer,
}: {
  theme: ThemeHub;
  apps: readonly AppHub[];
  enCours: boolean;
  onAnnuler(): void;
  onCreer(nom: string, apps: string[]): void;
}) {
  const [nom, setNom] = useState('');
  const [choisies, setChoisies] = useState<string[]>(apps.length > 0 ? [apps[0].id] : []);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  return (
    <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="admin-creation">
      <Text style={[texte, { fontSize: 20, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) }]}>Nouvel utilisateur</Text>
      <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Prénom de l’ami</Text>
      <TextInput
        testID="admin-nom"
        value={nom}
        onChangeText={setNom}
        placeholder="ex. Lucas"
        placeholderTextColor={theme.attenue}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={30}
        style={[styles.champ, texte, { backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}
      />
      <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Apps autorisées</Text>
      {apps.map(app => (
        <View key={app.id} style={styles.ligneApp}>
          <Text style={[texte, { flex: 1 }]}>
            {app.icone} {app.nom}
          </Text>
          <Switch
            testID={`admin-nouveau-app-${app.id}`}
            accessibilityLabel={`Autoriser ${app.nom}`}
            value={choisies.includes(app.id)}
            trackColor={{ true: theme.teintes.admin, false: theme.ligne }}
            onValueChange={valeur => setChoisies(liste => basculerApp(liste, app.id, valeur))}
          />
        </View>
      ))}
      <Text style={{ color: theme.attenue, fontSize: 12 }}>
        Un mot de passe, une clé d’authentification (TOTP) et des codes de récupération seront générés et affichés une seule fois.
      </Text>
      <View style={[styles.actions, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} />
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre="Créer et afficher les identifiants"
          testID="admin-creer"
          desactive={enCours || !nom.trim()}
          onPress={() => onCreer(nom, choisies)}
        />
      </View>
    </View>
  );
}

function PanneauIdentifiants({
  theme,
  nom,
  valeurs,
  onTermine,
}: {
  theme: ThemeHub;
  nom: string;
  valeurs: IdentifiantsAmi;
  onTermine(): void;
}) {
  const [transmis, setTransmis] = useState(false);
  const mono = police(theme.policeChiffres);
  const code = { color: theme.fond, ...mono, fontSize: 13.5, lineHeight: 23 };
  const cle = { color: theme.sombre ? '#555' : '#AAA', ...mono, fontSize: 13.5, lineHeight: 23 };
  return (
    <View style={[styles.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="admin-identifiants">
      <Text style={{ color: theme.texte, fontSize: 20, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) }}>Identifiants de {nom}</Text>
      <Text style={[styles.avis, { color: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.16) }]}>
        Affichés une seule fois : ils ne sont conservés nulle part en clair. Transmettez-les à {nom} de vive voix ou sur papier, puis
        ne les gardez pas.
      </Text>
      <View style={[styles.bloc, { backgroundColor: theme.texte, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
        <Text selectable style={code}>
          <Text style={cle}>Profil        </Text>
          {nom}
        </Text>
        <Text selectable style={code} testID="admin-mot-de-passe">
          <Text style={cle}>Mot de passe  </Text>
          {valeurs.motDePasse}
        </Text>
        <Text selectable style={code} testID="admin-secret-totp">
          <Text style={cle}>Clé TOTP      </Text>
          {valeurs.secretTotp}
        </Text>
      </View>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>
        À scanner dans son application d’authentification (le code à 6 chiffres est demandé à chaque ouverture, avec le mot de passe) :
      </Text>
      <View style={{ alignItems: 'flex-start' }}>
        <QrCode texte={valeurs.uriTotp} legende={`AppliBourse · ${nom}`} testID="admin-qr-totp" />
      </View>
      <Text style={{ color: theme.texte, fontWeight: '600' }}>Codes de récupération</Text>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>
        Chacun ouvre son profil une seule fois s’il perd son mot de passe (« Mot de passe oublié ? »), et lui fait choisir un
        nouveau mot de passe.
      </Text>
      <View style={styles.codes}>
        {valeurs.codesRecuperation.map(valeur => (
          <Text key={valeur} selectable style={[styles.code, mono, { color: theme.texte, borderColor: theme.ligne }]}>
            {valeur}
          </Text>
        ))}
      </View>
      <View style={styles.ligneApp}>
        <Text style={{ color: theme.texte, flex: 1 }}>J’ai transmis ces identifiants.</Text>
        <Switch
          testID="admin-transmis"
          value={transmis}
          onValueChange={setTransmis}
          trackColor={{ true: theme.teintes.admin, false: theme.ligne }}
          accessibilityLabel="J’ai transmis ces identifiants"
        />
      </View>
      <View style={[styles.actions, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Terminé" testID="admin-termine" desactive={!transmis} onPress={onTermine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  h1: { fontSize: 44, letterSpacing: -1, marginTop: 24 },
  lead: { marginTop: 16, fontSize: 18 },
  onglets: { flexDirection: 'row', gap: 6, marginTop: 32, marginBottom: 16, flexWrap: 'wrap' },
  onglet: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1 },
  barre: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  partage: { gap: 16 },
  panneau: { borderWidth: 1, padding: 16, gap: 12, minWidth: 0 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12 },
  avatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  pilule: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  intertitre: { fontSize: 11, fontWeight: '600', letterSpacing: 1, marginTop: 4 },
  ligneApp: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  carre: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  avis: { padding: 10, borderRadius: 8, fontSize: 13, gap: 10, marginBottom: 12, overflow: 'hidden' },
  champ: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10, fontSize: 15 },
  bloc: { padding: 14 },
  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  code: { fontSize: 14, letterSpacing: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
});
