/**
 * Paramètres › Administration › Comptes des proches. L'administrateur ajoute un profil pour un ami, le
 * renomme ou le supprime ; il ne peut pas en lire le contenu. Un ami, lui,
 * ne voit que son profil et le bouton pour changer.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import type { OptionsNouveauProfil, Profil } from '../../profils/profils';
import type { PolitiqueHub } from '../../hub/admin/politique';
import type { IdentifiantsAmi, InvitationAffichee } from '../../profils/identifiants';
import type { OptionsLier } from './LierCompte';
import type { DocsJuridiques } from '../../juridique/modele';
import { rangDe, texteTransparence } from '../../hub/admin/roles';
import { QrCode } from './CarteSynchro';

/** Options d'une invitation, réglées dans l'Administration (Fondateur). */
export interface OptionsInvitationHote {
  /** Politique du mot de passe que l'ami choisira (portée, scellée, par l'invitation). */
  politique?: import('../../profils/invitation').PolitiqueMdp;
}

export interface ControleProfils {
  actuel: Profil;
  /**
   * Profils visibles par le compte ouvert : la liste complète pour
   * l'administrateur, **lui seul** pour un ami (isolation des comptes).
   */
  tous: readonly Profil[];
  /** Vrai quand « Changer de compte » a un sens (plusieurs comptes, ou session administrateur). */
  peutChanger?: boolean;
  /** Politique des apps (activation, maintenance), lisible par le hub d'un ami. */
  politique?: PolitiqueHub;
  /** Textes légaux modifiés par un Fondateur (absent : modèle par défaut). Lisibles par tous les comptes. */
  juridique?: DocsJuridiques;
  /** Fondateur seulement : enregistre de nouveaux textes légaux (synchronisés avec l'annuaire). */
  onJuridique?(docs: DocsJuridiques): Promise<void>;
  /** Session d'un titulaire sur le compte d'un autre (séquestre) : prénom du compte ouvert, et qui l'a ouvert (bandeau). */
  sessionAdmin?: { nomCompte: string; par?: string; rang?: string };
  /**
   * Compte d'un rang inférieur à Fondateur : avertissement de transparence
   * (les rangs supérieurs peuvent y accéder), avec le dernier accès (date,
   * titulaire et son rang) s'il y en a eu. Absent pour un Fondateur.
   */
  transparence?: { dernierAccesAdmin?: string; sequestreActif: boolean; par?: string; rangPar?: string };
  /**
   * Changer le rang d'un compte (Fondateur, Administrateur, Gestionnaire,
   * Ami) : l'hôte revérifie la règle des rangs, met à jour le registre des
   * Fondateurs, crée la paire du promu et re-scelle (ou retire) les séquestres.
   * `enAttente` : la paire du promu sera créée à sa prochaine connexion.
   */
  onChangerRang?(id: string, rang: 'fondateur' | 'administrateur' | 'gestionnaire' | 'ami'): Promise<{ enAttente: boolean }>;
  /** Politique globale des apps, pour un Fondateur autre que le compte historique (qui passe par la liste). */
  onPolitique?(politique: PolitiqueHub): Promise<void>;
  /** Navigateur relié avec le code d'un titulaire : ce qui exige l'annuaire complet n'est pas disponible ici. */
  restreint?: boolean;
  /**
   * Fondateur (relais version 9) : identifiant et mot de passe de connexion (`identifiant` absent :
   * pas encore défini). `onConfigurer` ouvre l'écran qui les définit ou les change.
   */
  connexionServeur?: { identifiant?: string; onConfigurer(): void };
  /** Revenir à « Qui utilise AppDashboard ? ». */
  onChanger(): void;
  onAjouter(nom: string): Promise<void>;
  onSupprimer(id: string): Promise<void>;
  onRenommer(id: string, nom: string): Promise<void>;
  /**
   * Administration (app du hub). Absentes là où la plateforme ne sait pas
   * créer le coffre d'un autre profil.
   */
  /** Crée le compte d'un ami et rend ses identifiants, à montrer une fois. */
  onCreerCompte?(nom: string, apps: readonly string[], options?: OptionsNouveauProfil, envoi?: OptionsInvitationHote): Promise<IdentifiantsAmi>;
  /** Nouveau coffre pour l'ami : l'ancien, et le portefeuille qu'il scelle, sont effacés. */
  onRegenerer?(id: string): Promise<IdentifiantsAmi>;
  onAutoriser?(id: string, apps: readonly string[]): Promise<void>;
  onActiver?(id: string, actif: boolean): Promise<void>;
  /**
   * Enregistre une liste de profils modifiée par l'Administration (niveaux,
   * invitations, suspensions, politique des apps, actions groupées). L'hôte
   * n'accepte ni ajout ni retrait de profil par ce chemin, et revalide tout.
   */
  onModifierProfils?(suivants: readonly Profil[]): Promise<void>;
  /** Note l'ouverture (déverrouillage) du profil courant sur cet appareil. */
  onConnexion?(): void;
  /**
   * Gestionnaire seulement. `comptes` : les amis qu'il a lui-même créés (avec
   * le prénom qu'il a saisi) ; `apercu` : tous les comptes de l'appareil SANS
   * prénom, pour les chiffres du tableau de bord ; `autres` : combien de
   * comptes lui restent invisibles. Jamais fourni à un ami ni à l'administrateur.
   */
  gestion?: { comptes: readonly Profil[]; apercu: readonly Profil[]; autres: number };
  /** Gestionnaire : met une de ses actions en attente pour le journal de l'administrateur. */
  onJournalGestion?(evenement: { type: string; action: string; cible?: string; nomCible?: string; app?: string }): Promise<void>;
  /**
   * Accès administrateur aux comptes des amis (séquestre). Réservés à
   * l'administrateur déverrouillé ; jamais fournis à un ami.
   */
  onCodeAcces?(id: string): Promise<{ code: string; creeLe: string } | undefined>;
  onRegenererCode?(id: string): Promise<string>;
  onRevoquerAcces?(id: string): Promise<void>;
  onRetablirAcces?(id: string): Promise<void>;
  /** Ouvre le compte d'un ami avec son code d'accès (la session de l'administrateur se ferme). */
  onOuvrirCompte?(id: string, code: string): Promise<void>;
  /**
   * « Envoyer un code de connexion au site » : code de liaison PROPRE à cet
   * ami (jeton de profil, jamais le jeton maître), et le lien qui le porte.
   */
  onCodeSite?(id: string): Promise<{ code: string; lien?: string }>;
  /**
   * « Renvoyer une invitation » / « Réinitialiser l'accès » : nouveau mot de
   * passe temporaire posé par séquestre (l'ancien mot de passe et l'ancienne
   * invitation cessent de marcher), et nouveau lien à usage unique.
   */
  onInvitation?(id: string, jours: number, envoi?: OptionsInvitationHote): Promise<InvitationAffichee>;
  /**
   * Fondateur principal (jeton maître) : supprime le compte comme `onSupprimer`,
   * PUIS efface ses copies sur le relais (objets de son espace, accès par
   * identifiant) et révoque son jeton. Voir `nettoyerCompteRelais`
   * (`bureau/connexionAmis.ts`) ; chaque étape est tentée, le bilan dit ce qui reste.
   */
  onSupprimerAvecRelais?(id: string): Promise<{ objets: number; acces: boolean; revoque: boolean; restes: string[] }>;
  /** Révoque (ou rétablit) l'accès du compte sur le relais : son jeton n'y vaut plus rien. */
  onRevoquerConnexion?(id: string, revoque: boolean): Promise<void>;
  /** État de l'accès sur le relais (révoqué ?), pour la fiche. */
  etatConnexion?(id: string): Promise<{ revoque?: boolean }>;
  /**
   * Compte d'un ami ouvert sur un navigateur relié : de quoi connecter un AUTRE
   * appareil (lien à scanner, qui ne porte que l'accès à SON compte ; il faudra
   * encore son prénom et son mot de passe), et le lien de connexion par identifiant.
   */
  autreAppareil?: { lien: string; lienConnexion?: string };
  /**
   * « Lier à mon compte » fourni par l'hôte (site) : remplace celui de l'app,
   * pour tous les comptes. `suggererAutreCoffre` : après un échec de
   * déverrouillage, proposer de reprendre le coffre du compte relié.
   */
  lier?: OptionsLier & { suggererAutreCoffre?: boolean };
  /**
   * Écran de déverrouillage, fourni par l'hôte (site) : écart d'horloge avec
   * le relais (ms, positif = appareil en avance) et texte du diagnostic sans secret.
   */
  deverrouillage?: { ecartHorloge?(): Promise<number | undefined>; diagnostic?(): Promise<string> };
  /** Change quand la synchronisation des comptes a reçu quelque chose (Administration à relire). */
  versionComptes?: number;
  /** Sa propre ligne d'abonnement (mode, échéance, message de rappel), reçue du relais : jamais celle d'un autre. */
  abonnement?: import('../../hub/abonnements/abonnements').ProjectionAbo;
}

/** Texte de transparence montré à un ami (création du compte, Paramètres). */
export const AVERTISSEMENT_TRANSPARENCE =
  'Les administrateurs et fondateurs peuvent accéder à ton compte. Chaque accès est inscrit à leur journal, et le dernier accès s’affiche ici.';

export function CarteProfils({ controle }: { controle: ControleProfils }) {
  const palette = usePalette();
  const { actuel, tous } = controle;
  const [nom, setNom] = useState('');
  const [monNom, setMonNom] = useState(actuel.nom);
  const [aSupprimer, setASupprimer] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const agir = (action: Promise<void>, reussite: string) => {
    setErreur(undefined);
    action
      .then(() => setMessage(reussite))
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)));
  };

  return (
    <>
      <View style={{ gap: ESPACEMENT.s }} testID="carte-profils">
        <Text style={{ color: palette.texte, fontWeight: '700' }}>
          Profil ouvert : {actuel.nom} {actuel.admin ? '· administrateur' : ''}
        </Text>
        {actuel.admin && controle.onCreerCompte ? (
          <SousTitre>
            Chaque ami a son propre portefeuille, chiffré à part, et n’ouvre que les apps que vous lui autorisez. La
            synchronisation avec l’iPhone reste réservée à votre profil.
          </SousTitre>
        ) : actuel.admin ? (
          <SousTitre>
            Un ami veut suivre son portefeuille ici ? Ajoutez-lui un profil : au démarrage, AppDashboard demandera qui
            l’utilise, et il créera son propre mot de passe et son code. Ses données sont chiffrées à part — vous ne
            pouvez pas les lire, lui non plus les vôtres. La synchronisation avec l’iPhone reste réservée à votre profil.
          </SousTitre>
        ) : (
          <>
            <SousTitre>
              Ce profil a été créé par l’administrateur. Ton identifiant est ton prénom ; pour l’ouvrir sur un autre appareil, utilise
              le lien ci-dessous (ou « Se connecter » sur le site). Aucun autre compte ne voit tes données, et tu ne vois pas les leurs.
            </SousTitre>
            {controle.autreAppareil ? (
              <View style={[styles.profil, { borderColor: palette.bordure, flexDirection: 'column', alignItems: 'flex-start' }]} testID="autre-appareil">
                <Text style={{ color: palette.texte, fontWeight: '700' }}>📱 Connecter un autre appareil</Text>
                <Text style={{ color: palette.texteSecondaire }}>
                  Scanne ce QR code avec l’appareil photo de ton autre appareil (ou ouvre le lien), puis saisis ton prénom et ton mot de passe.
                  Ne le montre à personne d’autre.
                </Text>
                <QrCode texte={controle.autreAppareil.lien} legende="Mon compte AppDashboard" testID="autre-appareil-qr" />
                <Text selectable style={{ color: palette.texteSecondaire, fontSize: 12 }} testID="autre-appareil-lien">
                  {controle.autreAppareil.lien}
                </Text>
              </View>
            ) : null}
            {texteTransparence(rangDe(actuel)) ? (
              <View style={[styles.profil, { borderColor: palette.accent }]} testID="transparence-admin">
                <Text style={{ color: palette.texte, flex: 1 }}>
                  ⚠️ {texteTransparence(rangDe(actuel))} Chaque accès est inscrit à leur journal, et le dernier accès s’affiche ici.
                  {controle.transparence?.dernierAccesAdmin
                    ? ` Dernier accès : ${new Date(controle.transparence.dernierAccesAdmin).toLocaleString('fr-FR')}${controle.transparence.par ? ` (${controle.transparence.par}${controle.transparence.rangPar ? `, ${controle.transparence.rangPar}` : ''})` : ''}.`
                    : ' Aucun accès pour l’instant.'}
                </Text>
              </View>
            ) : null}
          </>
        )}

        {actuel.admin ? <View style={styles.ligne}>
          <View style={{ flex: 1 }}>
            <Champ etiquette="Nom de mon profil" value={monNom} onChangeText={setMonNom} testID="champ-mon-nom" />
          </View>
          <Bouton
            titre="Renommer"
            variante="discret"
            desactive={!monNom.trim() || monNom.trim() === actuel.nom}
            onPress={() => agir(controle.onRenommer(actuel.id, monNom), 'Profil renommé.')}
            testID="renommer-profil"
          />
        </View> : null}

        {actuel.admin && controle.onCreerCompte ? (
          <SousTitre>
            Les comptes de vos amis (création, identifiants, accès aux apps, désactivation) se gèrent dans l’app
            Administration du hub.
          </SousTitre>
        ) : actuel.admin ? (
          <>
            {tous
              .filter(profil => !profil.admin)
              .map(profil => (
                <View key={profil.id} style={[styles.profil, { borderColor: palette.bordure }]} testID={`ligne-profil-${profil.id}`}>
                  <Text style={{ color: palette.texte, flex: 1, fontWeight: '600' }}>👤 {profil.nom}</Text>
                  {aSupprimer === profil.id ? (
                    <>
                      <Text style={{ color: palette.baisse, fontSize: 13 }}>Tout son portefeuille sera effacé.</Text>
                      <Bouton
                        titre="Confirmer"
                        onPress={() => {
                          setASupprimer(undefined);
                          agir(controle.onSupprimer(profil.id), `Profil « ${profil.nom} » supprimé.`);
                        }}
                        testID={`confirmer-supprimer-${profil.id}`}
                      />
                      <Bouton titre="Annuler" variante="discret" onPress={() => setASupprimer(undefined)} />
                    </>
                  ) : (
                    <Bouton
                      titre="Supprimer"
                      variante="discret"
                      onPress={() => setASupprimer(profil.id)}
                      testID={`supprimer-${profil.id}`}
                    />
                  )}
                </View>
              ))}
            <View style={styles.ligne}>
              <View style={{ flex: 1 }}>
                <Champ etiquette="Prénom de l’ami" value={nom} onChangeText={setNom} testID="champ-nouveau-profil" />
              </View>
              <Bouton
                titre="Ajouter un profil"
                desactive={!nom.trim()}
                onPress={() => {
                  const choisi = nom;
                  setNom('');
                  agir(controle.onAjouter(choisi), `Profil « ${choisi.trim()} » ajouté : il apparaîtra au prochain démarrage, ou via « Changer de profil ».`);
                }}
                testID="ajouter-profil"
              />
            </View>
          </>
        ) : null}

        {message ? <Text style={{ color: palette.hausse, fontWeight: '600' }}>{message}</Text> : null}
        {erreur ? <Alerte message={erreur} /> : null}

        {controle.peutChanger ?? tous.length > 1 ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton titre="Changer de compte" variante="discret" onPress={controle.onChanger} testID="changer-profil" />
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'flex-end', gap: ESPACEMENT.s, flexWrap: 'wrap' },
  profil: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: RAYON.m,
    padding: ESPACEMENT.s + 2,
  },
});
