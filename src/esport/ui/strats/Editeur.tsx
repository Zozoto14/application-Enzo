/**
 * Strat sur l'app iOS native (sans WebView, donc sans canevas Konva) : la
 * miniature enregistrée et les notes de chaque étape, en LECTURE SEULE.
 * L'éditeur complet est sur le site et l'app PC (Editeur.web.tsx).
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police } from '../../../hub/themes';
import type { Strat } from '../../strats/api';
import { LIBELLES_SIDE, LIBELLES_TYPE_STRAT } from '../../strats/libelles';
import { Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import { NoteMarkdown } from '../review/Note';
import { Etiquette, MentionRiot, Miniature } from './commun';
import type { PropsEditeur } from './types';
import { tr } from '../../i18n';

export type { PropsEditeur };

export function Editeur({ theme, api, teamId, stratId, onRetour }: PropsEditeur) {
  const [strat, setStrat] = useState<Strat | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setStrat(await api.detail(teamId, stratId)));
  }, [agir, api, teamId, stratId]);
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 12 }} testID="esport-strat-lecture">
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={tr('strats.editeur.strats')} onPress={onRetour} testID="esport-strat-retour" />
      </View>
      <Retours theme={theme} erreur={erreur} prefixe="esport-strat-lecture" />
      {strat ? (
        <>
          <TitreSection theme={theme} titre={strat.titre} sous={tr('strats.editeur.lecture_seule_sur_iphone')} />
          <View style={[styles.ligne, { gap: 4 }]}>
            <Etiquette theme={theme} texte={strat.carte.nom} />
            <Etiquette theme={theme} texte={LIBELLES_SIDE[strat.side]} />
            <Etiquette theme={theme} texte={LIBELLES_TYPE_STRAT[strat.type]} />
          </View>
          <Miniature theme={theme} url={strat.miniature?.url} carte={strat.carte.nom} taille={220} testID="esport-strat-lecture-miniature" />
          {strat.notes ? <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{strat.notes}</Text> : null}
          {strat.donnees?.etapes.map((e, i) => (
            <Panneau key={e.id} theme={theme} testID="esport-strat-lecture-etape">
              <Intertitre theme={theme}>{`${i + 1}. ${e.titre}`}</Intertitre>
              {e.note ? <NoteMarkdown theme={theme} source={e.note} /> : <Text style={attenue}>{tr('strats.editeur.pas_de_note')}</Text>}
            </Panneau>
          ))}
          <MentionRiot theme={theme} jeu={strat.jeu} />
        </>
      ) : null}
    </View>
  );
}
