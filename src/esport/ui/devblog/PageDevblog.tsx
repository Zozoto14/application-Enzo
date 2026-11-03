/**
 * Page « Devblog » (ouverte depuis le bouton « Nouveautés » du Dashboard, ou « Voir tous les devblogs » de la
 * fenêtre Nouveautés) : l'historique des devblogs publiés, du plus récent au plus ancien, pour tous les membres,
 * dans la langue du compte. Pour le Fondateur (et la permission du club devblog.gerer) : les brouillons, « Nouveau
 * devblog », l'éditeur (EditeurDevblog.tsx : FR/EN, aperçus, IA, publication Discord, « Tout publier »,
 * programmation) et les réglages de la publication automatique (Automatique.tsx).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiDevblog, contenuDans, type EntreeDevblog } from '../../devblog/api';
import { dateLisible } from '../../devblog/rendu';
import { langueCourante } from '../../i18n';
import { trDv } from '../../i18n/devblog';
import { PageEsport } from '../CadreEsport';
import { Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, SqueletteCartes, attenue } from '../design';
import { VueDevblog } from './Contenu';
import { EditeurDevblog } from './EditeurDevblog';
import { ReglagesAutomatiques, dateHeureClub } from './Automatique';

export function PageDevblog({ theme, client, large, avant }: { theme: ThemeHub; client: ClientEsport; large: boolean; avant?: React.ReactNode }) {
  const [liste, setListe] = useState<{ entrees: EntreeDevblog[]; gestion: boolean } | undefined>();
  const [edition, setEdition] = useState<EntreeDevblog | 'nouveau' | null>(null);
  const [voirAuto, setVoirAuto] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setListe(await apiDevblog(client).liste()), [client]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const langue = langueCourante();

  if (edition) {
    return (
      <EditeurDevblog
        theme={theme}
        client={client}
        large={large}
        entree={edition === 'nouveau' ? null : edition}
        onRetour={() => {
          setEdition(null);
          void agir('', charger);
        }}
      />
    );
  }
  const gestion = Boolean(liste?.gestion);
  return (
    <PageEsport large={large} testID="esport-devblog" largeur={900}>
      <EnTetePage
        theme={theme}
        large={large}
        avant={avant}
        titre={trDv('page_titre')}
        sous={trDv('page_sous')}
        action={
          gestion ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
              <BoutonHub theme={theme} icone="reglages" titre={trDv('auto_bouton')} onPress={() => setVoirAuto(v => !v)} testID="esport-devblog-auto-ouvrir" />
              <BoutonHub theme={theme} titre={trDv('nouveau')} variante="plein" onPress={() => setEdition('nouveau')} testID="esport-devblog-nouveau" />
            </View>
          ) : undefined
        }
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog" />
      {gestion && voirAuto ? (
        <ReglagesAutomatiques
          theme={theme}
          client={client}
          onOuvrir={id =>
            void agir('', async () => {
              setEdition((await apiDevblog(client).detail(id)).entree);
            })
          }
        />
      ) : null}
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={2} large={false} /> : null}
      {liste && liste.entrees.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="fusee" titre={trDv('vide')} texte={trDv('vide_aide')} />
        </Carte>
      ) : null}
      {liste?.entrees.map(e => (
        <Carte key={e.id} theme={theme} testID={`esport-devblog-${e.id}`} accent={e.statut === 'brouillon' ? theme.attenue : theme.accent}>
          {gestion ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESP.xs, justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge theme={theme} texte={e.statut === 'publie' ? trDv('publie') : trDv('brouillon')} ton={e.statut === 'publie' ? 'ok' : 'alerte'} testID={`esport-devblog-${e.id}-statut`} />
                {e.publieLe ? <Text style={attenue(theme, 12)}>{trDv('publie_le', { date: dateLisible(e.publieLe.slice(0, 10), langue) })}</Text> : null}
                {e.origine === 'auto' ? <Badge theme={theme} icone="etincelles" texte={trDv('badge_auto')} /> : null}
                {e.programmation && e.statut === 'brouillon' ? <Badge theme={theme} icone="calendrier" texte={trDv('badge_programme', { date: dateHeureClub(e.programmation.le) })} ton="accent" testID={`esport-devblog-${e.id}-programme`} /> : null}
              </View>
              <Pressable accessibilityRole="button" onPress={() => setEdition(e)} testID={`esport-devblog-${e.id}-modifier`} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: ESP.xs }}>
                <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 15 }}>{`${trDv('modifier')} ›`}</Text>
              </Pressable>
            </View>
          ) : null}
          <VueDevblog theme={theme} contenu={contenuDans(e, langue)} langue={langue} date={e.date} version={e.version} compact={!large} />
        </Carte>
      ))}
    </PageEsport>
  );
}
