/**
 * Liste de présence d'une occurrence : réponses des joueurs et, pour le staff
 * (attendance.mark), marquage de la présence réelle (présent, en retard,
 * absent, excusé) en un écran.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Intertitre, Panneau, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { ApiPlanning, PresenceOccurrence, Reel } from '../../planning/api';
import { LIBELLES_REEL, LIBELLES_RSVP } from '../../planning/libelles';
import { Retours, styles, useAgir } from '../commun';

const MARQUES: ReadonlyArray<readonly [Reel, string]> = [
  ['present', 'Présent'],
  ['retard', 'Retard'],
  ['absent', 'Absent'],
  ['excuse', 'Excusé'],
];

export function ListePresence({ theme, api, evenementId, cle, marquer, onMarque }: { theme: ThemeHub; api: ApiPlanning; evenementId: string; cle: string; marquer: boolean; onMarque?(): void }) {
  const [presence, setPresence] = useState<PresenceOccurrence | undefined>();
  const [marques, setMarques] = useState<Record<string, Reel>>({});
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const pr = await api.presence(evenementId, cle);
      setPresence(pr);
      setMarques(Object.fromEntries(pr.lignes.map(l => [l.compte, l.reel])));
    });
  }, [agir, api, evenementId, cle]);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-presence-liste">
      <Intertitre theme={theme}>Présence</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-presence" />
      {presence && presence.lignes.length === 0 ? <Text style={attenue}>Personne dans la liste de présence.</Text> : null}
      {presence?.lignes.map(l => (
        <View key={l.compte} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-presence-${l.compte}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={[texte, { fontWeight: '700' }]}>{l.pseudo}</Text>
            <Text style={attenue}>
              Réponse : {LIBELLES_RSVP[l.rsvp]}
              {marquer ? '' : ` · ${LIBELLES_REEL[l.reel]}`}
            </Text>
          </View>
          {marquer ? (
            <Segments
              theme={theme}
              libelle={`Présence de ${l.pseudo}`}
              valeur={marques[l.compte] ?? 'inconnu'}
              options={MARQUES}
              onChoisir={v => setMarques(m => ({ ...m, [l.compte]: v }))}
              testID={`esport-marque-${l.compte}`}
            />
          ) : null}
        </View>
      ))}
      {marquer && presence?.lignes.length ? (
        <BoutonHub
          theme={theme}
          titre={enCours === 'Présence' ? 'Enregistrement…' : 'Enregistrer la présence'}
          variante="plein"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('Présence', async () => {
              const liste = Object.entries(marques)
                .filter(([, r]) => r !== 'inconnu')
                .map(([compte, reel]) => ({ compte, reel }));
              if (!liste.length) return 'Choisissez au moins une présence.';
              setPresence(await api.marquer(evenementId, cle, liste));
              onMarque?.();
              return 'Présence enregistrée.';
            })
          }
          testID="esport-presence-enregistrer"
        />
      ) : null}
    </Panneau>
  );
}
