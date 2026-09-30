/**
 * Paramètres › Profils. L'administrateur ajoute un profil pour un ami, le
 * renomme ou le supprime ; il ne peut pas en lire le contenu. Un ami, lui,
 * ne voit que son profil et le bouton pour changer.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import type { OptionsNouveauProfil, Profil } from '../../profils/profils';
import type { PolitiqueHub } from '../../hub/admin/politique';
import type { IdentifiantsAmi } from '../../profils/identifiants';

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
  /** Session de l'administrateur sur le compte d'un ami : prénom de l'ami (bandeau). */
  sessionAdmin?: { nomCompte: string };
  /**
   * Compte ami : avertissement de transparence (l'administrateur peut y
   * accéder), avec la date de son dernier accès s'il y en a eu.
   */
  transparence?: { dernierAccesAdmin?: string; sequestreActif: boolean };
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
  onCreerCompte?(nom: string, apps: readonly string[], options?: OptionsNouveauProfil): Promise<IdentifiantsAmi>;
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
}

/** Texte de transparence montré à un ami (création du compte, Paramètres). */
export const AVERTISSEMENT_TRANSPARENCE =
  'L’administrateur peut accéder à ton compte. Chaque accès est inscrit à son journal, et la date du dernier accès s’affiche ici.';

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
              Ce profil a été créé par l’administrateur de cet appareil. Il reste sur cet appareil (pas de synchronisation). Aucun
              autre compte ne voit tes données, et tu ne vois pas les leurs.
            </SousTitre>
            <View style={[styles.profil, { borderColor: palette.accent }]} testID="transparence-admin">
              <Text style={{ color: palette.texte, flex: 1 }}>
                ⚠️ {AVERTISSEMENT_TRANSPARENCE}
                {controle.transparence?.dernierAccesAdmin
                  ? ` Dernier accès : ${new Date(controle.transparence.dernierAccesAdmin).toLocaleString('fr-FR')}.`
                  : ' Aucun accès de l’administrateur pour l’instant.'}
              </Text>
            </View>
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
