/**
 * « Accès au tableau » (menu ⋯ du tableau, migration 0046, docs/esport/cm.md) : tous ceux qui ont accès au CM
 * (défaut), ou RESTREINT aux personnes et aux rôles choisis (rôles CM, du club, de team), chacun « peut voir » ou
 * « peut modifier ». Le Fondateur voit toujours tout. Réservé à cm.gerer et au créateur du tableau ; le serveur
 * refuse un tableau sans personne pour le gérer, et de se retirer soi-même. Choix des personnes et rôles : ChoixAcces.tsx
 * (partagé avec « Qui voit la ressource » de DATA › Ressources).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { AccesTableau as Acces, ApiCm, NiveauAcces, ReglageAcces } from '../../cm/api';
import { trCm } from '../../i18n/cm';
import { Retours, useAgir } from '../commun';
import { ESP, attenue } from '../design';
import { Aide } from './commun';
import { ChoixAcces, EffectifsAcces, niveauxDe, reglesDe } from './ChoixAcces';

export function AccesTableau({ theme, api, tableauId, onChange, testID = 'esport-cm-acces' }: { theme: ThemeHub; api: ApiCm; tableauId: string; onChange(): unknown; testID?: string }) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [reglage, setReglage] = useState<ReglageAcces | undefined>();
  const [acces, setAcces] = useState<Acces>('tous');
  const [niveaux, setNiveaux] = useState<Map<string, NiveauAcces>>(new Map());

  const appliquer = useCallback((r: ReglageAcces) => {
    setReglage(r);
    setAcces(r.acces);
    setNiveaux(niveauxDe(r.regles));
  }, []);
  useEffect(() => {
    void agir('', async () => appliquer(await api.accesTableau(tableauId)));
  }, [agir, api, appliquer, tableauId]);

  if (!reglage) return <Retours theme={theme} erreur={erreur} prefixe={testID} />;
  const defaut = Boolean(reglage.tableau.cleDefaut);
  const enregistrer = () =>
    agir('acces', async () => {
      appliquer(await api.changerAccesTableau(tableauId, acces, reglesDe(niveaux)));
      await onChange();
      return trCm('acces.enregistre');
    });

  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      <Aide theme={theme}>{trCm('acces.aide')}</Aide>
      <Segments<Acces>
        theme={theme}
        libelle={trCm('acces.titre')}
        valeur={acces}
        options={(defaut ? [['tous', trCm('acces.tous')]] : [['tous', trCm('acces.tous')], ['restreint', trCm('acces.restreint')]]) as ReadonlyArray<readonly [Acces, string]>}
        onChoisir={v => setAcces(v)}
        testID={`${testID}-mode`}
      />
      {defaut ? <Text style={attenue(theme, 13)}>{trCm('acces.defaut')}</Text> : null}
      {acces === 'restreint' ? (
        <>
          <ChoixAcces theme={theme} options={reglage.options} niveaux={niveaux} onChanger={setNiveaux} testID={testID} />
          <Text style={attenue(theme, 13)}>{trCm('acces.fondateur')}</Text>
        </>
      ) : null}
      {reglage.effectifs && reglage.acces === 'restreint' ? <EffectifsAcces theme={theme} titre={trCm('acces.effectifs')} effectifs={reglage.effectifs} testID={`${testID}-effectifs`} /> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={testID} />
      <BoutonHub theme={theme} titre={trCm('c.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID={`${testID}-enregistrer`} />
    </View>
  );
}
