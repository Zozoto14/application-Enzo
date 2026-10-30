/**
 * Fenêtre « Nouveautés » à l'entrée dans l'app Esport : le dernier devblog publié, s'il n'a pas encore été vu
 * par ce compte (GET /devblog/nouveautes), dans la langue du compte. « J'ai compris » le marque vu EN BASE
 * (POST /devblog/:id/vu : plus jamais réaffiché, sur aucun appareil) ; « Voir tous les devblogs » ouvre
 * l'historique (et marque aussi vu). Fermer par la croix ou Échap : réaffiché à la prochaine ouverture.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiDevblog, contenuDans, type EntreeDevblog } from '../../devblog/api';
import { langueCourante } from '../../i18n';
import { trDv } from '../../i18n/devblog';
import { ESP, attenue, ombre, rayonCarte, texte } from '../design';
import { VueDevblog } from './Contenu';

export function useNouveautes(client: ClientEsport | undefined, actif: boolean) {
  const [entree, setEntree] = useState<EntreeDevblog | null>(null);
  useEffect(() => {
    if (!client || !actif) return;
    let vivant = true;
    Promise.resolve()
      .then(() => apiDevblog(client).nouveautes())
      .then(r => {
        const e = r?.entree;
        if (vivant && e && typeof e.id === 'string' && e.fr) setEntree(e);
      })
      // Ancien serveur sans devblog, réseau : rien à montrer, jamais bloquant.
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [client, actif]);
  return { entree, fermer: () => setEntree(null) };
}

export function FenetreNouveautes({ theme, client, entree, onFermer, onVoirTous }: { theme: ThemeHub; client: ClientEsport; entree: EntreeDevblog; onFermer(): void; onVoirTous(): void }) {
  const { width, height } = useWindowDimensions();
  const telephone = width < 600;
  const langue = langueCourante();
  const marquerVu = () => {
    void Promise.resolve()
      .then(() => apiDevblog(client).vu(entree.id))
      .catch(() => undefined);
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onFermer}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: telephone ? 'flex-end' : 'center', padding: telephone ? 0 : ESP.xl }}>
        <View
          testID="esport-nouveautes"
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={trDv('nouveautes_titre')}
          style={{
            width: '100%',
            maxWidth: 680,
            maxHeight: telephone ? height * 0.92 : height * 0.86,
            backgroundColor: theme.fond,
            borderRadius: telephone ? 0 : rayonCarte(theme),
            borderTopLeftRadius: rayonCarte(theme),
            borderTopRightRadius: rayonCarte(theme),
            borderWidth: 1,
            borderColor: theme.ligne,
            overflow: 'hidden',
            ...ombre(theme, true),
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, paddingHorizontal: telephone ? ESP.m : ESP.xl, paddingTop: ESP.m, paddingBottom: ESP.s, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...texte(theme, 13), color: theme.accent, fontWeight: '800', letterSpacing: 1 }}>{`✨ ${trDv('nouveautes_titre').toUpperCase()}`}</Text>
              <Text style={attenue(theme, 13)}>{trDv('nouveautes_sous')}</Text>
            </View>
            <Pressable testID="esport-nouveautes-fermer" accessibilityRole="button" accessibilityLabel={trDv('fermer')} onPress={onFermer} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.texte, fontSize: 22 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: telephone ? ESP.m : ESP.xl }}>
            <VueDevblog theme={theme} contenu={contenuDans(entree, langue)} langue={langue} date={entree.date} version={entree.version} compact={telephone} testID="esport-nouveautes-contenu" />
          </ScrollView>
          <View style={{ flexDirection: telephone ? 'column-reverse' : 'row', alignItems: telephone ? 'stretch' : 'center', justifyContent: 'space-between', gap: ESP.s, paddingHorizontal: telephone ? ESP.m : ESP.xl, paddingVertical: ESP.m, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <Pressable
              testID="esport-nouveautes-tous"
              accessibilityRole="link"
              onPress={() => {
                marquerVu();
                onVoirTous();
              }}
              style={{ minHeight: 44, justifyContent: 'center', alignItems: telephone ? 'center' : 'flex-start' }}>
              <Text style={{ ...texte(theme, 15), color: theme.accent, fontWeight: '600' }}>{`${trDv('voir_tous')} ›`}</Text>
            </Pressable>
            <BoutonHub
              theme={theme}
              titre={trDv('compris')}
              variante="plein"
              onPress={() => {
                marquerVu();
                onFermer();
              }}
              testID="esport-nouveautes-compris"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
