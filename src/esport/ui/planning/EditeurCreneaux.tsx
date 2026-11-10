/**
 * Éditeur de créneaux par jour de la semaine (disponible ou indisponible), commun à la semaine type (modèle) et
 * aux semaines personnalisées (« Semaine par semaine ») : un appui sur un créneau le retire, « Ajouter » pose le
 * même créneau sur les jours cochés, « Enregistrer » envoie la liste entière.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { RegleDispo } from '../../planning/api';
import { heureValide, joursCourts, joursSemaine } from '../../planning/libelles';
import { Retours, styles, useAgir } from '../commun';
import { Pastille } from './commun';
import { tr } from '../../i18n';
import { ChampHeure } from '../../../ui/dates';

export type TypeDispo = 'disponible' | 'indisponible';
export const typesDispo = (): ReadonlyArray<readonly [TypeDispo, string]> => [
  ['disponible', tr('planning.disponibilites.disponible')],
  ['indisponible', tr('planning.disponibilites.indisponible')],
];

const empreinte = (l: RegleDispo[]) => JSON.stringify(l.map(r => [r.jour, r.debut, r.fin, r.type]));

export function EditeurCreneaux({
  theme,
  regles: initiales,
  cle,
  libellesJours,
  prefixe = 'esport-creneau',
  titreEnregistrer,
  avisEnregistre,
  lectureSeule = false,
  toujoursEnregistrable = false,
  onEnregistrer,
}: {
  theme: ThemeHub;
  regles: RegleDispo[];
  /** Change quand la donnée relue change (autre semaine, autre membre, nouvelle version) : l'éditeur repart d'elle. */
  cle?: string;
  /** Libellé de chaque jour (lundi … dimanche) ; les noms des jours par défaut. */
  libellesJours?: string[];
  prefixe?: string;
  titreEnregistrer: string;
  avisEnregistre: string;
  lectureSeule?: boolean;
  /** Enregistrable même sans modification (une semaine qui suit le modèle devient personnalisée). */
  toujoursEnregistrable?: boolean;
  onEnregistrer(r: RegleDispo[]): Promise<void>;
}) {
  const [regles, setRegles] = useState<RegleDispo[]>(initiales);
  const [jours, setJours] = useState<number[]>([1]);
  const [debut, setDebut] = useState('19:00');
  const [fin, setFin] = useState('23:00');
  const [type, setType] = useState<TypeDispo>('disponible');
  const { enCours, erreur, avis, agir } = useAgir();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setRegles(initiales), [cle ?? initiales]);
  const modifie = empreinte(regles) !== empreinte(initiales);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const noms = libellesJours ?? joursSemaine();
  return (
    <View style={{ gap: 8 }}>
      {noms.map((nom, i) => {
        const duJour = regles.filter(r => r.jour === i + 1).sort((a, b) => a.debut.localeCompare(b.debut));
        return (
          <View key={nom} style={[styles.ligne, { flexWrap: 'nowrap', alignItems: 'flex-start' }]}>
            <Text style={{ width: 76, color: theme.texte, fontWeight: '600', ...police(theme.policeTexte) }}>{nom}</Text>
            <View style={[styles.ligne, { flex: 1 }]}>
              {duJour.length === 0 ? <Text style={attenue}>—</Text> : null}
              {duJour.map(r => (
                <Pressable
                  key={`${r.jour}-${r.debut}-${r.fin}-${r.type}`}
                  accessibilityRole="button"
                  accessibilityLabel={tr('planning.disponibilites.retirer', { nom, debut: r.debut, fin: r.fin })}
                  disabled={lectureSeule}
                  onPress={() => setRegles(l => l.filter(x => x !== r))}
                  testID={`${prefixe}-${r.jour}-${r.debut}`}
                  style={[
                    styles.pastille,
                    {
                      borderColor: r.type === 'disponible' ? theme.ok : theme.critique,
                      backgroundColor: teinteTransparente(r.type === 'disponible' ? theme.ok : theme.critique, 0.14),
                      borderRadius: 8,
                    },
                  ]}>
                  <Text style={{ color: theme.texte, fontSize: 12, ...police(theme.policeChiffres) }}>
                    {r.type === 'indisponible' ? '✕ ' : ''}
                    {r.debut}–{r.fin}
                    {lectureSeule ? '' : ' ×'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {lectureSeule ? null : (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10 }}>
          <View style={styles.ligne}>
            {joursCourts().map((j, i) => (
              <Pastille key={i} theme={theme} actif={jours.includes(i + 1)} libelle={j} role="checkbox" onPress={() => setJours(l => (l.includes(i + 1) ? l.filter(x => x !== i + 1) : [...l, i + 1]))} testID={`${prefixe}-jour-${i + 1}`} />
            ))}
          </View>
          <View style={styles.ligne}>
            <ChampHeure theme={theme} libelle={tr('planning.disponibilites.de')} valeur={debut} onChanger={setDebut} style={{ width: 140 }} testID={`${prefixe}-debut`} />
            <ChampHeure theme={theme} libelle={tr('planning.disponibilites.a')} valeur={fin} onChanger={setFin} style={{ width: 140 }} testID={`${prefixe}-fin`} />
            <Segments theme={theme} libelle={tr('resumes.type')} valeur={type} options={typesDispo()} onChoisir={v => setType(v as TypeDispo)} testID={`${prefixe}-type`} />
          </View>
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              titre={tr('ajoutTeams.ajouter')}
              onPress={() => {
                if (!heureValide(debut) || !heureValide(fin) || debut === fin || !jours.length) return;
                setRegles(l => [...l, ...jours.map(jour => ({ jour, debut, fin, type }))]);
              }}
              testID={`${prefixe}-ajouter`}
            />
            <BoutonHub
              theme={theme}
              titre={enCours ? tr('membresRoles.enregistrement') : titreEnregistrer}
              variante="plein"
              desactive={(!modifie && !toujoursEnregistrable) || Boolean(enCours)}
              onPress={() =>
                void agir('creneaux', async () => {
                  await onEnregistrer(regles.map(r => ({ jour: r.jour, debut: r.debut, fin: r.fin, type: r.type })));
                  return avisEnregistre;
                })
              }
              testID={`${prefixe}-enregistrer`}
            />
          </View>
          <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`${prefixe}s`} />
        </View>
      )}
    </View>
  );
}
