/**
 * Paramètres › Profils. L'administrateur ajoute un profil pour un ami, le
 * renomme ou le supprime ; il ne peut pas en lire le contenu. Un ami, lui,
 * ne voit que son profil et le bouton pour changer.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import type { Profil } from '../../profils/profils';

export interface ControleProfils {
  actuel: Profil;
  tous: readonly Profil[];
  /** Revenir à « Qui utilise AppliBourse ? ». */
  onChanger(): void;
  onAjouter(nom: string): Promise<void>;
  onSupprimer(id: string): Promise<void>;
  onRenommer(id: string, nom: string): Promise<void>;
}

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
      <Titre>Profils</Titre>
      <Carte testID="carte-profils">
        <Text style={{ color: palette.texte, fontWeight: '700' }}>
          Profil ouvert : {actuel.nom} {actuel.admin ? '· administrateur' : ''}
        </Text>
        {actuel.admin ? (
          <SousTitre>
            Un ami veut suivre son portefeuille ici ? Ajoutez-lui un profil : au démarrage, AppliBourse demandera qui
            l’utilise, et il créera son propre mot de passe et son code. Ses données sont chiffrées à part — vous ne
            pouvez pas les lire, lui non plus les vôtres. La synchronisation avec l’iPhone reste réservée à votre profil.
          </SousTitre>
        ) : (
          <SousTitre>
            Ce profil a été créé par l’administrateur de cet appareil. Il reste sur cet appareil (pas de synchronisation).
          </SousTitre>
        )}

        <View style={styles.ligne}>
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
        </View>

        {actuel.admin ? (
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

        {tous.length > 1 ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton titre="Changer de profil" variante="discret" onPress={controle.onChanger} testID="changer-profil" />
          </View>
        ) : null}
      </Carte>
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
