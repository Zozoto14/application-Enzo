/**
 * Liste de présence d'une occurrence : ses CONVOQUÉS (et eux seuls), leurs
 * réponses et, pour le staff (attendance.mark), le marquage de la présence
 * réelle (présent, en retard, absent, excusé).
 *
 * Chaque appui ENREGISTRE aussitôt (avant, il fallait un bouton
 * « Enregistrer la présence » plus bas : un appui sur « Présent » sans ce
 * bouton ne comptait pas, et les statistiques restaient à « non marqué »).
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { ApiPlanning, PresenceOccurrence, Reel } from '../../planning/api';
import { LIBELLES_REEL, LIBELLES_RSVP } from '../../planning/libelles';
import { Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import { tr } from '../../i18n';

const marquesPresence = (): ReadonlyArray<readonly [Reel, string]> => [
  ['present', tr('planning.libelles.present')],
  ['retard', tr('planning.listePresence.retard')],
  ['absent', tr('planning.libelles.absent')],
  ['excuse', tr('planning.libelles.excuse')],
];

export function ListePresence({ theme, api, evenementId, cle, marquer, onMarque }: { theme: ThemeHub; api: ApiPlanning; evenementId: string; cle: string; marquer: boolean; onMarque?(): void }) {
  const [presence, setPresence] = useState<PresenceOccurrence | undefined>();
  const [marques, setMarques] = useState<Record<string, Reel>>({});
  const { erreur, avis, agir } = useAgir();
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
      <Intertitre theme={theme}>{tr('planning.listePresence.presence')}</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-presence" />
      {presence && presence.lignes.length === 0 ? <Text style={attenue}>{tr('planning.listePresence.personne_n_est_convoque')}</Text> : null}
      {marquer && presence?.lignes.length ? <Text style={attenue}>{tr('planning.listePresence.un_appui_enregistre_la')}</Text> : null}
      {presence?.lignes.map(l => (
        <View key={l.compte} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-presence-${l.compte}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={[texte, { fontWeight: '700' }]}>{l.pseudo}</Text>
            <Text style={attenue}>
              {tr('planning.listePresence.reponse', { reponse: LIBELLES_RSVP[l.rsvp] })}
              {marquer ? '' : ` · ${LIBELLES_REEL[l.reel]}`}
            </Text>
          </View>
          {marquer ? (
            <Segments
              theme={theme}
              libelle={tr('planning.listePresence.presence_de', { pseudo: l.pseudo })}
              valeur={marques[l.compte] ?? 'inconnu'}
              options={marquesPresence()}
              onChoisir={v => {
                const avant = marques[l.compte] ?? 'inconnu';
                setMarques(m => ({ ...m, [l.compte]: v }));
                void agir('presence', async () => {
                  try {
                    setPresence(await api.marquer(evenementId, cle, [{ compte: l.compte, reel: v }]));
                  } catch (e) {
                    setMarques(m => ({ ...m, [l.compte]: avant }));
                    throw e;
                  }
                  onMarque?.();
                  return tr('planning.listePresence.enregistre', { pseudo: l.pseudo, v: LIBELLES_REEL[v].toLowerCase() });
                });
              }}
              testID={`esport-marque-${l.compte}`}
            />
          ) : null}
        </View>
      ))}
    </Panneau>
  );
}
