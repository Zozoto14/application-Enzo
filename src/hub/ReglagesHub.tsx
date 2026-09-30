/**
 * Contenu des réglages du hub dans la page Paramètres : thème unique,
 * disposition des tuiles, compte, version et mise à jour, nouveautés, rôle,
 * confidentialité, protection du coffre et réglages de l'Administration.
 *
 * Un composant par réglage du recensement (`recensement.ts`) : la page les
 * entoure de leur titre. Aucun ne dessine de carte.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BoutonHub } from './Hub';
import { DetailMiseAJour, type MiseAJour } from './ParametresHub';
import { avecEvenement, chargerDonnees, enregistrerDonnees, BORNES_REGLAGES, REGLAGES_DEFAUT, type ReglagesAdmin } from './admin/donnees';
import { avecReglagesPar } from './admin/actions';
import { Champ as ChampAdmin } from './admin/ui/commun';
import { FormulaireIdentite } from './Administration';
import type { PrefsHub } from './personnalisation';
import { definirDensite, definirDisposition, reinitialiser, sontParDefaut } from './personnalisation';
import { THEMES_HUB, police, teinteTransparente, type IdThemeHub, type ThemeHub } from './themes';
import type { EtatCoffre, ServicesAdmin } from './types';
import { versionApp } from './version';
import { texteTransparence } from './admin/roles';
import { ReglagesAbonnements } from './abonnements/ReglagesAbonnements';
import type { Profil } from '../profils/profils';

const rayonDe = (theme: ThemeHub) => Math.min(theme.rayonMoyen, 10);

function Texte({ theme, children, testID, fort }: { theme: ThemeHub; children: React.ReactNode; testID?: string; fort?: boolean }) {
  return (
    <Text testID={testID} style={{ color: fort ? theme.texte : theme.attenue, fontSize: 13, lineHeight: 19, fontWeight: fort ? '700' : '400', ...police(theme.policeTexte) }}>
      {children}
    </Text>
  );
}

/** Le thème, un seul pour toute l'application. */
export function ReglageTheme({ theme, onTheme }: { theme: ThemeHub; onTheme(id: IdThemeHub): void }) {
  const rayon = rayonDe(theme);
  return (
    <View style={{ gap: 10 }}>
      <Texte theme={theme}>
        Ce thème s’applique partout : hub, portefeuille, administration et futures apps. Le portefeuille garde son identité par la couleur d’accent du thème.
      </Texte>
      <View style={styles.themes} accessibilityRole="radiogroup" accessibilityLabel="Thème de l’application">
        {THEMES_HUB.map(candidat => {
          const choisi = candidat.id === theme.id;
          return (
            <Pressable
              key={candidat.id}
              testID={`parametres-theme-${candidat.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: choisi }}
              aria-checked={choisi}
              accessibilityLabel={`Thème ${candidat.nom}`}
              onPress={() => onTheme(candidat.id)}
              style={[styles.theme, { borderColor: choisi ? theme.accent : theme.ligne, borderRadius: rayon, backgroundColor: candidat.fond }, choisi && { borderWidth: 2 }]}>
              <View style={{ flexDirection: 'row', gap: 3 }}>
                {[candidat.accent, candidat.teintes.portefeuille, candidat.teintes.admin].map((c, i) => (
                  <View key={i} style={{ width: 10, height: 10, backgroundColor: c, borderRadius: 3 }} />
                ))}
              </View>
              <Text style={{ color: candidat.texte, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                {candidat.nom}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Segments<T extends string>({ theme, libelle, valeur, options, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: T; options: ReadonlyArray<readonly [T, string]>; onChoisir(v: T): void; testID: string }) {
  const rayon = rayonDe(theme);
  return (
    <View style={{ gap: 6 }}>
      <Texte theme={theme}>{libelle}</Texte>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup">
        {options.map(([cle, nom]) => {
          const actif = cle === valeur;
          return (
            <Pressable
              key={cle}
              testID={`${testID}-${cle}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              aria-checked={actif}
              accessibilityLabel={`${libelle} : ${nom}`}
              onPress={() => onChoisir(cle)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ReglageTuiles({ theme, prefs, onPrefs, onPersonnaliser }: { theme: ThemeHub; prefs: PrefsHub; onPrefs(p: PrefsHub): void; onPersonnaliser?(): void }) {
  return (
    <View style={{ gap: 12 }}>
      <Segments theme={theme} libelle="Disposition" valeur={prefs.disposition} options={[['grille', '▦ Grille'], ['liste', '☰ Liste']] as const} onChoisir={v => onPrefs(definirDisposition(prefs, v))} testID="parametres-disposition" />
      <Segments theme={theme} libelle="Densité" valeur={prefs.densite} options={[['aere', 'Aéré'], ['compact', 'Compact']] as const} onChoisir={v => onPrefs(definirDensite(prefs, v))} testID="parametres-densite" />
      <View style={styles.actions}>
        {onPersonnaliser ? <BoutonHub theme={theme} titre="✎ Personnaliser les tuiles" onPress={onPersonnaliser} testID="parametres-personnaliser" /> : null}
        <BoutonHub theme={theme} titre="Réinitialiser la disposition" desactive={sontParDefaut(prefs)} onPress={() => onPrefs(reinitialiser())} testID="parametres-reinitialiser" />
      </View>
    </View>
  );
}

export function ReglageLangue({ theme }: { theme: ThemeHub }) {
  return (
    <View style={{ gap: 4 }} testID="parametres-langue">
      <Texte theme={theme} fort>
        Français (France)
      </Texte>
      <Texte theme={theme}>Montants en euros (1 234,56 €), dates au format 31/12/2026. Ce réglage n’est pas modifiable pour l’instant.</Texte>
    </View>
  );
}

export function ReglageCompte({ theme, nomProfil, onChangerProfil, onVerrouiller }: { theme: ThemeHub; nomProfil?: string; onChangerProfil?(): void; onVerrouiller?(): void }) {
  return (
    <View style={{ gap: 10 }}>
      {nomProfil ? <Texte theme={theme}>Compte ouvert : {nomProfil}</Texte> : null}
      <View style={styles.actions}>
        {onChangerProfil ? <BoutonHub theme={theme} titre="Changer de compte" onPress={onChangerProfil} testID="parametres-changer-profil" /> : null}
        {onVerrouiller ? <BoutonHub theme={theme} titre="⏻ Verrouiller maintenant" onPress={onVerrouiller} testID="parametres-verrouiller" /> : null}
      </View>
    </View>
  );
}

export function ReglageVersion({ theme }: { theme: ThemeHub }) {
  return (
    <Text style={{ color: theme.texte, fontSize: 14, ...police(theme.policeTexte) }} testID="parametres-version">
      Version : <Text style={police(theme.policeChiffres)}>{versionApp()}</Text>
    </Text>
  );
}

export function ReglageMiseAJour({ theme, maj }: { theme: ThemeHub; maj: MiseAJour }) {
  return (
    <View style={{ gap: 10 }}>
      <Texte theme={theme}>
        {maj.plateforme === 'bureau'
          ? 'Mises à jour automatiques : l’application vérifie à chaque lancement puis toutes les heures, et propose d’installer.'
          : maj.plateforme === 'web'
            ? 'Site web : il prend la dernière version publiée à chaque chargement ; « Actualiser l’app » vide le cache.'
            : 'iPhone / iPad : les mises à jour signées s’installent d’elles-mêmes à la réouverture ; le bouton vérifie tout de suite.'}
      </Texte>
      <DetailMiseAJour theme={theme} maj={maj} testID="parametres-maj" />
    </View>
  );
}

export function ReglageNouveautes({ theme, onOuvrir }: { theme: ThemeHub; onOuvrir(): void }) {
  return (
    <View style={{ gap: 10 }}>
      <Texte theme={theme}>Ce qu’apporte chaque version, avec « Essayer » pour ouvrir la fonctionnalité.</Texte>
      <View style={styles.actions}>
        <BoutonHub theme={theme} titre="✨ Voir les nouveautés" onPress={onOuvrir} testID="parametres-nouveautes" />
      </View>
    </View>
  );
}

export function ReglageAdminPanel({ theme, onOuvrir }: { theme: ThemeHub; onOuvrir(): void }) {
  return (
    <View style={{ gap: 10 }}>
      <Texte theme={theme}>Comptes, accès aux apps, journal d’audit, sécurité : l’Administration reste une app, ses réglages sont ici.</Texte>
      <View style={styles.actions}>
        <BoutonHub theme={theme} titre="Administration →" onPress={onOuvrir} testID="parametres-administration" />
      </View>
    </View>
  );
}

export function BandeauRole({ theme, rang = 'gestionnaire' }: { theme: ThemeHub; rang?: Profil['role'] }) {
  const titre = rang === 'fondateur' ? 'Tu es Fondateur.' : rang === 'administrateur' ? 'Tu es Administrateur.' : 'Tu es gestionnaire.';
  const texte =
    rang === 'fondateur'
      ? 'Tu as tous les droits sur les Administrateurs, Gestionnaires et Amis : ouvrir leur compte avec tes propres codes d’accès, les promouvoir ou les rétrograder, nommer d’autres Fondateurs. Tu n’agis pas sur un autre Fondateur, et personne ne peut ouvrir ton compte.'
      : rang === 'administrateur'
        ? 'Tu as l’Administration complète sur les Gestionnaires et les Amis, y compris ouvrir leur compte avec TES propres codes d’accès (chaque accès est journalisé, et le compte ouvert le voit). Tu ne peux ni voir ni ouvrir un Fondateur ou un autre Administrateur, ni nommer quelqu’un Administrateur. Les fondateurs peuvent accéder à ton compte.'
        : 'Un Fondateur ou un Administrateur t’a confié une Administration limitée : tu peux créer des amis et gérer ceux que tu as créés (accès aux apps, activation, suspension, identifiants). Tu ne peux ouvrir le compte de personne, et tes actions sont inscrites à leur journal, avec ton nom. Retrouve-la dans la tuile « Administration ».';
  return (
    <View
      style={{ padding: 12, borderRadius: rayonDe(theme), borderLeftWidth: 4, borderLeftColor: theme.teintes.admin, backgroundColor: teinteTransparente(theme.teintes.admin, 0.14), gap: 4 }}
      testID="parametres-role-gestionnaire">
      <Texte theme={theme} fort testID="parametres-rang">
        {titre}
      </Texte>
      <Texte theme={theme}>{texte}</Texte>
    </View>
  );
}

export function BandeauConfidentialite({
  theme,
  transparence,
  rang,
}: {
  theme: ThemeHub;
  transparence: { dernierAccesAdmin?: string; sequestreActif: boolean; par?: string; rangPar?: string };
  rang?: Profil['role'];
}) {
  // Un Fondateur n'a personne au-dessus de lui : aucun bandeau.
  const qui = texteTransparence(rang === 'fondateur' ? 'fondateur' : rang === 'administrateur' ? 'administrateur' : 'ami');
  if (!qui) {
    return null;
  }
  return (
    <View
      style={{ padding: 12, borderRadius: rayonDe(theme), borderLeftWidth: 4, borderLeftColor: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.14), gap: 4 }}
      testID="parametres-transparence">
      <Texte theme={theme} fort testID="parametres-transparence-qui">
        {qui}
      </Texte>
      <Texte theme={theme}>
        Chacun d’eux peut ouvrir ton compte avec un code d’accès qui lui est propre, sans ton mot de passe. Chaque accès est inscrit à son journal d’audit et un bandeau reste affiché pendant qu’il est sur ton compte. Aucun autre compte ne voit tes données.
      </Texte>
      <Texte theme={theme} testID="parametres-dernier-acces-admin">
        {transparence.dernierAccesAdmin
          ? `Dernier accès : ${new Date(transparence.dernierAccesAdmin).toLocaleString('fr-FR')}${transparence.par ? `, par ${transparence.par}${transparence.rangPar ? ` (${transparence.rangPar})` : ''}` : ''}.`
          : 'Aucun accès à ce jour.'}
      </Texte>
    </View>
  );
}

/** État de la protection du coffre : lecture seule, rien de secret n'est affiché. */
export function ReglageCoffre({ theme, etat }: { theme: ThemeHub; etat?: EtatCoffre }) {
  return (
    <View style={{ gap: 6 }} testID="parametres-coffre">
      <Texte theme={theme}>Votre coffre est chiffré par votre mot de passe. Il n’est jamais affiché ni transmis ; un mot de passe oublié se remplace avec un code de récupération.</Texte>
      {etat ? (
        <>
          <Texte theme={theme} fort>
            Code d’authentification (TOTP) : {etat.totpActif ? 'actif' : 'non activé'}
          </Texte>
          <Texte theme={theme} fort>
            Codes de récupération restants : {etat.codesRecuperation}
          </Texte>
        </>
      ) : null}
    </View>
  );
}

const CHAMPS: ReadonlyArray<{ cle: keyof ReglagesAdmin; libelle: string; unite: string; aide: string }> = [
  { cle: 'retentionJours', libelle: 'Rétention du journal', unite: 'jours', aide: 'Les événements plus anciens sont effacés.' },
  { cle: 'tailleJournal', libelle: 'Taille maximale du journal', unite: 'entrées', aide: 'Au-delà, les plus anciennes sont effacées.' },
  { cle: 'verrouMinutes', libelle: 'Verrouillage du panneau après', unite: 'min d’inactivité (0 : jamais)', aide: 'Le désactiver redemande votre identité.' },
  { cle: 'confianceMinutes', libelle: 'Validité d’une vérification d’identité', unite: 'min', aide: 'Pour les actions sensibles.' },
  { cle: 'inactifJours', libelle: 'Compte signalé inactif après', unite: 'jours sans connexion', aide: 'Alerte du tableau de bord.' },
  { cle: 'invitationJours', libelle: 'Durée d’invitation par défaut', unite: 'jours', aide: 'Proposée à la création d’un compte.' },
];

/**
 * Réglages de l'Administration (journal, verrouillage, invitations), lus et
 * écrits dans les mêmes données chiffrées que le panneau ; chaque changement
 * est inscrit au journal. Couper le verrouillage automatique redemande l'identité.
 */
export function ReglagesAdministration({ theme, services, acteur, maintenant = Date.now }: { theme: ThemeHub; services: ServicesAdmin; acteur?: Parameters<typeof avecReglagesPar>[0]; maintenant?: () => number }) {
  const [donnees, setDonnees] = useState(() => chargerDonnees(services.stockage));
  const enTexte = (r: ReglagesAdmin) => Object.fromEntries(CHAMPS.map(c => [c.cle, String(r[c.cle])])) as Record<keyof ReglagesAdmin, string>;
  const [brouillon, setBrouillon] = useState(() => enTexte(donnees.reglages));
  const [message, setMessage] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [identite, setIdentite] = useState(false);

  const appliquer = () => {
    const changement: Partial<ReglagesAdmin> = {};
    for (const { cle } of CHAMPS) {
      const n = Number(brouillon[cle].replace(',', '.'));
      changement[cle] = Number.isFinite(n) && brouillon[cle].trim() !== '' ? n : donnees.reglages[cle];
    }
    const courantes = chargerDonnees(services.stockage);
    let suivantes = avecReglagesPar(acteur, courantes, changement, maintenant());
    const modifies = CHAMPS.filter(c => courantes.reglages[c.cle] !== suivantes.reglages[c.cle]).map(c => `${c.libelle.toLowerCase()} : ${suivantes.reglages[c.cle]} ${c.unite.split(' ')[0]}`);
    if (modifies.length > 0) {
      suivantes = avecEvenement(suivantes, { type: 'reglages', action: `Réglages modifiés (${modifies.join(' ; ')})` }, maintenant());
      enregistrerDonnees(services.stockage, suivantes);
    }
    setDonnees(suivantes);
    setBrouillon(enTexte(suivantes.reglages));
    setErreur(undefined);
    setMessage(modifies.length > 0 ? 'Réglages enregistrés (valeurs ramenées dans leurs bornes si besoin).' : 'Aucun changement.');
  };
  const enregistrer = () => {
    const coupe = Number(brouillon.verrouMinutes) === 0 && donnees.reglages.verrouMinutes !== 0;
    if (coupe) {
      setIdentite(true);
    } else {
      appliquer();
    }
  };

  return (
    <View style={{ gap: 12 }} testID="parametres-admin-reglages">
      <View style={styles.grille}>
        {CHAMPS.map(champ => (
          <View key={champ.cle} style={{ flexBasis: 240, flexGrow: 1, gap: 2 }}>
            <ChampAdmin
              theme={theme}
              libelle={`${champ.libelle} (${champ.unite})`}
              valeur={brouillon[champ.cle]}
              onChanger={v => setBrouillon(b => ({ ...b, [champ.cle]: v.replace(/[^\d]/g, '') }))}
              clavier="number-pad"
              maxLength={5}
              testID={`admin-reglage-${champ.cle}`}
            />
            <Texte theme={theme}>
              {champ.aide} Entre {BORNES_REGLAGES[champ.cle].min} et {BORNES_REGLAGES[champ.cle].max} (défaut {REGLAGES_DEFAUT[champ.cle]}).
            </Texte>
          </View>
        ))}
      </View>
      {identite ? (
        <View style={{ gap: 8 }}>
          <Texte theme={theme} fort>
            Désactiver le verrouillage automatique du panneau : confirmez votre identité.
          </Texte>
          <FormulaireIdentite
            theme={theme}
            raison="Désactiver le verrouillage automatique du panneau"
            enCours={false}
            onAnnuler={() => setIdentite(false)}
            onValider={(motDePasse, code) => {
              try {
                services.verifierIdentite(motDePasse, code);
                setIdentite(false);
                appliquer();
              } catch (e) {
                setErreur(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </View>
      ) : null}
      <View style={styles.actions}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer les réglages" onPress={enregistrer} testID="admin-reglages-enregistrer" />
      </View>
      {erreur ? (
        <Text style={{ color: theme.critique, fontSize: 13 }} testID="admin-reglages-erreur">
          {erreur}
        </Text>
      ) : null}
      {message ? (
        <Text style={{ color: theme.ok, fontSize: 13 }} accessibilityLiveRegion="polite" testID="admin-reglages-message">
          {message}
        </Text>
      ) : null}
      <ReglagesAbonnements theme={theme} services={services} acteur={acteur} maintenant={maintenant} />
    </View>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  theme: { width: 100, padding: 8, gap: 6, borderWidth: 1 },
  segments: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
