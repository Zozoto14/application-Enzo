/**
 * « Qui voit la ressource » (menu ⋯ d'une ressource de DATA › Ressources, migration 0048, docs/esport/cm.md) : toute
 * l'équipe CM (défaut) ou RESTREINTE aux personnes et rôles choisis (« peut voir » / « peut modifier »), avec « Qui
 * voit aujourd'hui ». Son créateur et le Fondateur la voient toujours. Réservé au créateur, à cm.gerer et au Fondateur
 * (le serveur refuse le reste, et de se retirer soi-même). Mêmes composants que « Accès au tableau » (ChoixAcces.tsx).
 * « Partager avec… » : choix rapide de personnes, prévenues et « Nouveau » chez elles.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { NiveauAcces } from '../../../cm/api';
import type { AccesLien, ApiLiens, LienCm, ReglageAccesLien } from '../../../cm/liens';
import { trLi, trnLi } from '../../../i18n/liens';
import { trCm } from '../../../i18n/cm';
import { Retours, styles, useAgir } from '../../commun';
import { ESP, attenue } from '../../design';
import { Aide } from '../commun';
import { ChoixAcces, EffectifsAcces, niveauxDe, reglesDe } from '../ChoixAcces';

/** Choix « Toute l'équipe CM » / « Restreint » (et, restreint, des personnes et rôles) : sert aussi à la création. */
export function ChoixVisibilite({
  theme,
  reglage,
  acces,
  onAcces,
  niveaux,
  onNiveaux,
  testID,
}: {
  theme: ThemeHub;
  reglage: ReglageAccesLien;
  acces: AccesLien;
  onAcces(a: AccesLien): void;
  niveaux: Map<string, NiveauAcces>;
  onNiveaux(n: Map<string, NiveauAcces>): void;
  testID: string;
}) {
  const exclus = ['principal', reglage.lien?.creePar ?? reglage.moi].filter(Boolean) as string[];
  return (
    <>
      <Segments<AccesLien>
        theme={theme}
        libelle={trLi('acces.titre')}
        valeur={acces}
        options={[
          ['tous', trLi('acces.tous')],
          ['restreint', trLi('acces.restreint')],
        ]}
        onChoisir={onAcces}
        testID={`${testID}-mode`}
      />
      {acces === 'restreint' ? (
        <>
          <ChoixAcces theme={theme} options={reglage.options} niveaux={niveaux} onChanger={onNiveaux} exclus={exclus} testID={testID} />
          <Text style={attenue(theme, 13)}>{trLi('acces.toujours')}</Text>
        </>
      ) : null}
    </>
  );
}

export function AccesRessource({ theme, api, lien, onChange, testID = 'esport-cm-lien-acces' }: { theme: ThemeHub; api: ApiLiens; lien: LienCm; onChange(): unknown; testID?: string }) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [reglage, setReglage] = useState<ReglageAccesLien | undefined>();
  const [acces, setAcces] = useState<AccesLien>('tous');
  const [niveaux, setNiveaux] = useState<Map<string, NiveauAcces>>(new Map());
  const appliquer = useCallback((r: ReglageAccesLien) => {
    setReglage(r);
    setAcces(r.acces);
    setNiveaux(niveauxDe(r.regles));
  }, []);
  useEffect(() => {
    void agir('', async () => appliquer(await api.acces(lien.id)));
  }, [agir, api, appliquer, lien.id]);
  if (!reglage) return <Retours theme={theme} erreur={erreur} prefixe={testID} />;
  const enregistrer = () =>
    agir('acces', async () => {
      appliquer(await api.changerAcces(lien.id, acces, reglesDe(niveaux)));
      await onChange();
      return trLi('acces.enregistre');
    });
  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      <Aide theme={theme}>{trLi('acces.aide')}</Aide>
      <ChoixVisibilite theme={theme} reglage={reglage} acces={acces} onAcces={setAcces} niveaux={niveaux} onNiveaux={setNiveaux} testID={testID} />
      {reglage.effectifs && reglage.acces === 'restreint' ? <EffectifsAcces theme={theme} titre={trLi('acces.effectifs')} effectifs={reglage.effectifs} testID={`${testID}-effectifs`} /> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={testID} />
      <BoutonHub theme={theme} titre={trCm('c.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID={`${testID}-enregistrer`} />
    </View>
  );
}

/** « Partager avec… » : une ou plusieurs personnes en un clic ; ressource restreinte : elles reçoivent aussi l'accès. */
export function PartageRessource({ theme, api, lien, onChange, testID = 'esport-cm-lien-partage' }: { theme: ThemeHub; api: ApiLiens; lien: LienCm; onChange(): unknown; testID?: string }) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [personnes, setPersonnes] = useState<Array<{ compte: string; pseudo: string }> | undefined>();
  const [choisis, setChoisis] = useState<string[]>([]);
  const [niveau, setNiveau] = useState<NiveauAcces>('voir');
  const [local, setLocal] = useState<string | undefined>();
  useEffect(() => {
    void agir('', async () => {
      const o = await api.optionsAcces(lien.team?.id ?? null);
      setPersonnes(o.options.personnes.filter(p => p.compte !== o.moi));
    });
  }, [agir, api, lien.team?.id]);
  const restreint = lien.acces === 'restreint';
  const basculer = (compte: string) => setChoisis(c => (c.includes(compte) ? c.filter(x => x !== compte) : [...c, compte]));
  const envoyer = () => {
    if (!choisis.length) return setLocal(trLi('partage.aucun_choix'));
    setLocal(undefined);
    void agir('partage', async () => {
      const r = await api.partager(lien.id, choisis, niveau);
      setChoisis([]);
      await onChange();
      return trnLi('partage.fait', r.partages);
    });
  };
  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      <Aide theme={theme}>{restreint ? `${trLi('partage.aide')} ${trLi('partage.aide_restreint')}` : trLi('partage.aide')}</Aide>
      {personnes && !personnes.length ? <Text style={attenue(theme, 14)}>{trLi('partage.vide')}</Text> : null}
      {personnes?.length ? (
        <View style={[styles.ligne, { gap: ESP.xxs, flexWrap: 'wrap' }]} testID={`${testID}-personnes`}>
          {personnes.map(p => (
            <BoutonHub key={p.compte} theme={theme} titre={p.pseudo} libelle={trLi('partage.choisir', { nom: p.pseudo })} variante={choisis.includes(p.compte) ? 'plein' : undefined} onPress={() => basculer(p.compte)} testID={`${testID}-${p.compte}`} />
          ))}
        </View>
      ) : null}
      {restreint ? (
        <Segments<NiveauAcces>
          theme={theme}
          libelle={trLi('partage.niveau')}
          valeur={niveau}
          options={[
            ['voir', trCm('acces.niveau.voir')],
            ['modifier', trCm('acces.niveau.modifier')],
          ]}
          onChoisir={setNiveau}
          testID={`${testID}-niveau`}
        />
      ) : null}
      <Retours theme={theme} erreur={local ?? erreur} avis={avis} prefixe={testID} />
      <BoutonHub theme={theme} titre={trLi('partage.envoyer')} variante="plein" desactive={Boolean(enCours) || !personnes?.length} onPress={envoyer} testID={`${testID}-envoyer`} />
    </View>
  );
}
