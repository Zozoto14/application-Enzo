/**
 * Assistant de création d'une team, en 3 étapes : informations → jeu et
 * preset → modules. Ensuite, la page de la team s'ouvre sur « Membres et
 * rôles » pour inviter les premiers membres.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { CATALOGUE, type ClientEsport, type DetailTeam, nomModule, descriptionModule, nomJeu, nomPreset, descriptionPreset } from '../client';
import { Choix, Retours, styles, useAgir, Panneau } from './commun';
import { ESP, EnTetePage } from './design';
import { tr } from '../i18n';

const etapes = (): string[] => [tr('assistant.etape_informations'), tr('assistant.etape_jeu'), tr('assistant.etape_modules')];

export function modulesDuPreset(preset: string, choisis: readonly string[]): string[] {
  const p = CATALOGUE.presets.find(x => x.cle === preset);
  return p?.modules ? [...p.modules] : [...choisis];
}

export function Assistant({ theme, client, large = true, onCreee, onAnnuler }: { theme: ThemeHub; client: ClientEsport; large?: boolean; onCreee(d: DetailTeam): void; onAnnuler(): void }) {
  const [etape, setEtape] = useState(0);
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  const [jeu, setJeu] = useState('valorant');
  const [preset, setPreset] = useState('valorant_complet');
  const [choisis, setChoisis] = useState<string[]>(() => modulesDuPreset('valorant_complet', []));
  const { enCours, erreur, agir, setErreur } = useAgir();
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };

  const suivant = () => {
    if (etape === 0 && nom.trim().length < 2) {
      setErreur(tr('assistant.donnez_un_nom_a'));
      return;
    }
    setErreur(undefined);
    setEtape(e => Math.min(2, e + 1));
  };

  const choisirPreset = (p: string) => {
    setPreset(p);
    if (p !== 'personnalise') setChoisis(modulesDuPreset(p, choisis));
  };

  const creer = () =>
    agir('creation', async () => {
      const d = await client.creerTeam({ nom: nom.trim(), jeu, description: description.trim(), preset, modules: preset === 'personnalise' ? choisis : undefined });
      onCreee(d);
    });

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingVertical: large ? ESP.xl : ESP.m, gap: ESP.l, maxWidth: 760 + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }} testID="esport-assistant">
      <EnTetePage theme={theme} large={large} titre={tr('assistant.creer_une_team')} sous={tr('assistant.etape_sur_3', { v: etape + 1, v2: etapes()[etape] })} />
      <View style={{ flexDirection: 'row', gap: ESP.xs }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: etape + 1 }}>
        {etapes().map((e, i) => (
          <View key={e} style={{ flex: 1, gap: ESP.xxs }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: i <= etape ? theme.accent : theme.ligne }} />
            <Text style={{ color: i === etape ? theme.texte : theme.attenue, fontSize: 13, fontWeight: i === etape ? '700' : '500', ...police(theme.policeTexte) }} numberOfLines={1}>{`${i + 1}. ${e}`}</Text>
          </View>
        ))}
      </View>
      <Panneau theme={theme}>
        {etape === 0 ? (
          <>
            <Champ theme={theme} libelle={tr('assistant.nom_de_la_team')} valeur={nom} onChanger={setNom} maxLength={60} placeholder={tr('assistant.ex_faucons_valorant')} testID="esport-assistant-nom" />
            <Champ theme={theme} libelle={tr('assistant.description_facultative')} valeur={description} onChanger={setDescription} maxLength={500} multiligne testID="esport-assistant-description" />
          </>
        ) : null}
        {etape === 1 ? (
          <>
            <Choix theme={theme} libelle={tr('assistant.jeu')} valeur={jeu} options={CATALOGUE.jeux.map(j => ({ id: j.cle, nom: nomJeu(j.cle) }))} onChoisir={setJeu} testID="esport-assistant-jeu" />
            <Choix theme={theme} libelle={tr('assistant.preset_de_modules')} valeur={preset} options={CATALOGUE.presets.map(p => ({ id: p.cle, nom: nomPreset(p) }))} onChoisir={choisirPreset} testID="esport-assistant-preset" />
            <Text style={attenue}>{(() => { const p = CATALOGUE.presets.find(x => x.cle === preset); return p ? descriptionPreset(p) : ''; })()}</Text>
          </>
        ) : null}
        {etape === 2 ? (
          <>
            <Text style={attenue}>{tr('assistant.les_modules_se_reactivent')}</Text>
            {CATALOGUE.modules.map(m => {
              const coche = choisis.includes(m.cle);
              return (
                <Pressable
                  key={m.cle}
                  testID={`esport-assistant-module-${m.cle}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: coche }}
                  accessibilityLabel={nomModule(m.cle)}
                  onPress={() => {
                    setPreset('personnalise');
                    setChoisis(l => (!coche ? [...l, m.cle] : l.filter(x => x !== m.cle)));
                  }}
                  style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', minHeight: 44, paddingVertical: ESP.xxs }}>
                  <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: theme.id === 'terminal' ? 0 : 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', borderColor: coche ? theme.accent : theme.attenue, backgroundColor: coche ? theme.accent : 'transparent' }}>
                    <Text style={{ color: theme.surAccent, fontSize: 13, fontWeight: '800' }}>{coche ? '✓' : ''}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[texte, { fontWeight: '600' }]}>{nomModule(m.cle)}</Text>
                    <Text style={attenue}>{descriptionModule(m.cle)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-assistant" />
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <BoutonHub theme={theme} titre={etape === 0 ? tr('assistant.annuler') : tr('assistant.retour')} onPress={etape === 0 ? onAnnuler : () => setEtape(e => e - 1)} testID="esport-assistant-retour" />
        {etape < 2 ? (
          <BoutonHub theme={theme} titre={tr('assistant.suivant')} variante="plein" onPress={suivant} testID="esport-assistant-suivant" />
        ) : (
          <BoutonHub theme={theme} titre={enCours ? tr('assistant.creation_2') : tr('assistant.creer_la_team')} variante="plein" desactive={Boolean(enCours)} onPress={() => void creer()} testID="esport-assistant-creer" />
        )}
      </View>
    </ScrollView>
  );
}
