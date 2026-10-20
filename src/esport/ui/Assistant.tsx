/**
 * Assistant de création d'une team, en 3 étapes : informations → jeu et
 * preset → modules. Ensuite, la page de la team s'ouvre sur « Membres et
 * rôles » pour inviter les premiers membres.
 */

import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Panneau } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { Choix, Retours, TitreSection, styles, useAgir } from './commun';

const ETAPES = ['Informations', 'Jeu et preset', 'Modules'] as const;

export function modulesDuPreset(preset: string, choisis: readonly string[]): string[] {
  const p = CATALOGUE.presets.find(x => x.cle === preset);
  return p?.modules ? [...p.modules] : [...choisis];
}

export function Assistant({ theme, client, onCreee, onAnnuler }: { theme: ThemeHub; client: ClientEsport; onCreee(d: DetailTeam): void; onAnnuler(): void }) {
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
      setErreur('Donnez un nom à la team (2 caractères au moins).');
      return;
    }
    setErreur(undefined);
    setEtape(e => Math.min(ETAPES.length - 1, e + 1));
  };

  const choisirPreset = (p: string) => {
    setPreset(p);
    if (p !== 'personnalise') setChoisis(modulesDuPreset(p, choisis));
  };

  const creer = () =>
    agir('Création', async () => {
      const d = await client.creerTeam({ nom: nom.trim(), jeu, description: description.trim(), preset, modules: preset === 'personnalise' ? choisis : undefined });
      onCreee(d);
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' }} testID="esport-assistant">
      <TitreSection theme={theme} titre="Créer une team" sous={`Étape ${etape + 1} sur 3 : ${ETAPES[etape]}`} />
      <View style={styles.ligne} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: etape + 1 }}>
        {ETAPES.map((e, i) => (
          <View key={e} style={{ flex: 1, minWidth: 80, height: 6, borderRadius: 3, backgroundColor: i <= etape ? theme.accent : theme.ligne }} />
        ))}
      </View>
      <Panneau theme={theme}>
        {etape === 0 ? (
          <>
            <Champ theme={theme} libelle="Nom de la team" valeur={nom} onChanger={setNom} maxLength={60} placeholder="Ex. Faucons Valorant" testID="esport-assistant-nom" />
            <Champ theme={theme} libelle="Description (facultative)" valeur={description} onChanger={setDescription} maxLength={500} multiligne testID="esport-assistant-description" />
          </>
        ) : null}
        {etape === 1 ? (
          <>
            <Choix theme={theme} libelle="Jeu" valeur={jeu} options={CATALOGUE.jeux.map(j => ({ id: j.cle, nom: j.nom }))} onChoisir={setJeu} testID="esport-assistant-jeu" />
            <Choix theme={theme} libelle="Preset de modules" valeur={preset} options={CATALOGUE.presets.map(p => ({ id: p.cle, nom: p.nom }))} onChoisir={choisirPreset} testID="esport-assistant-preset" />
            <Text style={attenue}>{CATALOGUE.presets.find(p => p.cle === preset)?.description}</Text>
          </>
        ) : null}
        {etape === 2 ? (
          <>
            <Text style={attenue}>Les modules se réactivent ou se désactivent plus tard (Paramètres de la team), sans perte de données. Les modules des prochaines versions apparaissent « bientôt ».</Text>
            {CATALOGUE.modules.map(m => {
              const coche = choisis.includes(m.cle);
              return (
                <View key={m.cle} style={[styles.ligne, { flexWrap: 'nowrap' }]}>
                  <Case
                    theme={theme}
                    coche={coche}
                    libelle={m.nom}
                    onChanger={v => {
                      setPreset('personnalise');
                      setChoisis(l => (v ? [...l, m.cle] : l.filter(x => x !== m.cle)));
                    }}
                    testID={`esport-assistant-module-${m.cle}`}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[texte, { fontWeight: '600' }]}>
                      {m.nom}
                      {m.phase > 1 ? <Text style={attenue}>  · bientôt</Text> : null}
                    </Text>
                    <Text style={attenue}>{m.description}</Text>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-assistant" />
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={etape === 0 ? 'Annuler' : '← Retour'} onPress={etape === 0 ? onAnnuler : () => setEtape(e => e - 1)} testID="esport-assistant-retour" />
        {etape < 2 ? (
          <BoutonHub theme={theme} titre="Suivant →" variante="plein" onPress={suivant} testID="esport-assistant-suivant" />
        ) : (
          <BoutonHub theme={theme} titre={enCours ? 'Création…' : 'Créer la team'} variante="plein" desactive={Boolean(enCours)} onPress={() => void creer()} testID="esport-assistant-creer" />
        )}
      </View>
    </ScrollView>
  );
}
