/**
 * Assistant de création d'une team, en 3 étapes : informations → jeu et
 * preset → modules. Ensuite, la page de la team s'ouvre sur « Membres et
 * rôles » pour inviter les premiers membres.
 *
 * Le jeu est OBLIGATOIRE : un des profils de jeu actifs (formats, score, maps, personnages… configurés
 * avant par le Fondateur, page Jeux). Serveur sans profils de jeu : les jeux du catalogue.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { CATALOGUE, type ClientEsport, type DetailTeam, nomModule, descriptionModule, nomJeu, nomPreset, descriptionPreset } from '../client';
import { Choix, Retours, styles, useAgir, Panneau } from './commun';
import { ESP, EnTetePage } from './design';
import { tr } from '../i18n';
import { apiJeux, type JeuListe } from '../jeux/api';

const etapes = (): string[] => [tr('assistant.etape_informations'), tr('assistant.etape_jeu'), tr('assistant.etape_modules')];

export function modulesDuPreset(preset: string, choisis: readonly string[]): string[] {
  const p = CATALOGUE.presets.find(x => x.cle === preset);
  return p?.modules ? [...p.modules] : [...choisis];
}

/** Jeux proposés : profils actifs du serveur ; à défaut, ceux du catalogue (serveur ancien). */
function useJeuxProposes(client: ClientEsport): JeuListe[] | undefined {
  const [jeux, setJeux] = useState<JeuListe[] | undefined>();
  useEffect(() => {
    let vivant = true;
    Promise.resolve()
      .then(() => apiJeux(client).liste())
      .then(l => (Array.isArray(l?.jeux) ? l.jeux.filter(j => j.statut === 'actif') : Promise.reject(new Error('liste'))))
      .catch(() =>
        CATALOGUE.jeux.map(j => ({ cle: j.cle, nom: j.nom, couleur: '#8b8b9a', icone: null, base: j.cle === 'valorant' ? 'valorant' : null, statut: 'actif' as const, version: 0, resume: { formats: [], score: null, roster: null, cartes: 0, cartesActives: 0, personnages: 0, modes: 0 } })),
      )
      .then(l => {
        if (vivant) setJeux(l);
      });
    return () => {
      vivant = false;
    };
  }, [client]);
  return jeux;
}

/** Résumé d'un profil sous son nom : formats, maps du pool, roster. */
export function resumeJeu(j: JeuListe): string {
  const r = j.resume;
  return [
    r.formats.length ? r.formats.map(f => f.libelle).join(' · ') : '',
    r.cartes ? tr('assistant.jeu_maps', { n: r.cartesActives, total: r.cartes }) : '',
    r.personnages ? tr('assistant.jeu_personnages', { n: r.personnages }) : '',
    r.roster ? tr('assistant.jeu_roster', { titulaires: r.roster.titulaires, remplacants: r.roster.remplacants }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function Assistant({ theme, client, large = true, onCreee, onAnnuler, onJeux }: { theme: ThemeHub; client: ClientEsport; large?: boolean; onCreee(d: DetailTeam): void; onAnnuler(): void; onJeux?(): void }) {
  const [etape, setEtape] = useState(0);
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  // Aucun jeu choisi d'avance : le choix est obligatoire.
  const [jeu, setJeu] = useState('');
  const jeux = useJeuxProposes(client);
  const jeuChoisi = useMemo(() => jeux?.find(j => j.cle === jeu), [jeux, jeu]);
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
    if (etape === 1 && !jeuChoisi) {
      setErreur(tr('assistant.choisissez_le_jeu'));
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
            <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>{tr('assistant.jeu_obligatoire')}</Text>
            <View style={{ gap: ESP.xs }} accessibilityRole="radiogroup" accessibilityLabel={tr('assistant.jeu')} testID="esport-assistant-jeu">
              {jeux === undefined ? <Text style={attenue}>{tr('assistant.jeux_chargement')}</Text> : null}
              {jeux?.map(j => {
                const actif = j.cle === jeu;
                return (
                  <Pressable
                    key={j.cle}
                    testID={`esport-assistant-jeu-${j.cle}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: actif }}
                    accessibilityLabel={`${tr('assistant.jeu')} : ${nomJeu(j.cle, j.nom)}`}
                    onPress={() => {
                      setJeu(j.cle);
                      setErreur(undefined);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 52, padding: ESP.xs, borderWidth: 2, borderRadius: Math.min(theme.rayonMoyen, 12), borderColor: actif ? theme.accent : theme.ligne, backgroundColor: theme.surface }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: j.couleur }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[texte, { fontWeight: actif ? '700' : '600' }]}>{nomJeu(j.cle, j.nom)}</Text>
                      {resumeJeu(j) ? <Text style={attenue} numberOfLines={2}>{resumeJeu(j)}</Text> : null}
                    </View>
                    <Text style={{ color: actif ? theme.accent : theme.attenue, fontSize: 16 }}>{actif ? '●' : '○'}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={attenue}>{tr('assistant.jeu_absent')}</Text>
            {onJeux ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={tr('assistant.configurer_un_jeu')} onPress={onJeux} testID="esport-assistant-jeux" />
              </View>
            ) : null}
            <Choix theme={theme} libelle={tr('assistant.preset_de_modules')} valeur={preset} options={CATALOGUE.presets.map(p => ({ id: p.cle, nom: p.cle === 'valorant_complet' && jeuChoisi && jeuChoisi.base !== 'valorant' ? tr('assistant.preset_complet') : nomPreset(p) }))} onChoisir={choisirPreset} testID="esport-assistant-preset" />
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
