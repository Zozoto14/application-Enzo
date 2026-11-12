/**
 * Disponibilités de l'équipe CM : mes créneaux hebdomadaires (heures murales dans mon fuseau), mes absences et congés,
 * et la grille superposée de l'équipe (nombre de membres libres par créneau, réunions déjà prévues déduites).
 *
 * Source unique (migration 0081) : ce sont les disponibilités de la team CM du club. Cet écran est l'entrée
 * « Disponibilités » du groupe Équipe pour un membre de l'équipe CM qui n'est PAS membre de la team CM du club
 * (correspondant d'une team) ; un membre de la team CM du club y trouve l'onglet Disponibilités de la team
 * (semaine type, semaine par semaine, exceptions, heatmap), qui écrit les mêmes données.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { dateValide, heureValide, lundiDe, murale, plusJours, type ApiReunions, type GrilleEquipe, type MesDispos, type RegleDispo, type TypeException } from '../../../cm/reunions';
import { joursCourts, joursSemaine } from '../../../planning/libelles';
import { trRe, type CleRe } from '../../../i18n/reunions';
import { Retours, styles, useAgir } from '../../commun';
import { Carte, ESP, TitreCarte, attenue, texte, type EtatPresse } from '../../design';
import { ChoixBoutons, jourCourt } from './commun';
import { ChampHeure, ChampPeriode } from '../../../../ui/dates';

export function DisposCm({ theme, api, large, fuseau, onFuseau }: { theme: ThemeHub; api: ApiReunions; large: boolean; fuseau: string; onFuseau(): void }) {
  const [mes, setMes] = useState<MesDispos | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setMes(await api.mesDispos(fuseau)));
  }, [agir, api, fuseau]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-reunions-dispos">
    <Text style={attenue(theme, 13)} testID="esport-cm-dispos-source">{trRe('dispos.source')}</Text>
    <View style={large ? { flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' } : { gap: ESP.m }}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reunions-dispos" />
      {mes ? (
        <View style={{ flex: 1, gap: ESP.m, minWidth: 0 }}>
          <MesCreneaux theme={theme} api={api} mes={mes} onChange={m => { setMes(m); onFuseau(); }} />
          <MesAbsences theme={theme} api={api} mes={mes} onChange={setMes} />
        </View>
      ) : null}
      <View style={{ flex: large ? 1.4 : undefined, minWidth: 0 }}>
        <Grille theme={theme} api={api} fuseau={fuseau} />
      </View>
    </View>
    </View>
  );
}

function MesCreneaux({ theme, api, mes, onChange }: { theme: ThemeHub; api: ApiReunions; mes: MesDispos; onChange(m: MesDispos): void }) {
  const [regles, setRegles] = useState<RegleDispo[]>(mes.regles);
  const [fz, setFz] = useState(mes.regles[0]?.fuseau ?? mes.fuseau);
  const [jours, setJours] = useState<number[]>([1, 2, 3, 4, 5]);
  const [debut, setDebut] = useState('14:00');
  const [fin, setFin] = useState('20:00');
  const [type, setType] = useState<'disponible' | 'indisponible'>('disponible');
  const { erreur, avis, agir } = useAgir();
  useEffect(() => setRegles(mes.regles), [mes.regles]);
  const noms = joursSemaine();
  return (
    <Carte theme={theme} testID="esport-cm-reunions-creneaux-moi">
      <TitreCarte theme={theme} titre={trRe('dispos.titre')} sous={trRe('dispos.aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunions-creneaux-moi" />
      <Champ theme={theme} libelle={trRe('dispos.fuseau')} valeur={fz} onChanger={setFz} maxLength={60} testID="esport-cm-reunions-fuseau" />
      {noms.map((n, i) => {
        const duJour = regles.filter(r => r.jour === i + 1).sort((a, b) => a.debut.localeCompare(b.debut));
        return (
          <View key={n} style={[styles.ligne, { flexWrap: 'nowrap', alignItems: 'flex-start', gap: ESP.xs }]}>
            <Text style={{ ...texte(theme, 13), width: 84, fontWeight: '600' }}>{n}</Text>
            <View style={[styles.ligne, { flex: 1, gap: ESP.xxs }]}>
              {!duJour.length ? <Text style={attenue(theme)}>{trRe('dispos.aucun')}</Text> : null}
              {duJour.map(r => (
                <Pressable key={`${r.jour}-${r.debut}-${r.fin}-${r.type}`} accessibilityRole="button" accessibilityLabel={trRe('dispos.retirer', { jour: n, debut: r.debut, fin: r.fin })} onPress={() => setRegles(l => l.filter(x => x !== r))} testID={`esport-cm-reunions-creneau-${r.jour}-${r.debut}`} style={{ borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minHeight: 32, justifyContent: 'center', borderColor: r.type === 'disponible' ? theme.ok : theme.critique, backgroundColor: teinteTransparente(r.type === 'disponible' ? theme.ok : theme.critique, 0.14) }}>
                  <Text style={texte(theme, 12)}>{`${r.type === 'indisponible' ? '✕ ' : ''}${r.debut}–${r.fin} ×`}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }}>
        <View style={[styles.ligne, { gap: ESP.xxs }]} accessibilityLabel={trRe('dispos.jours')}>
          {joursCourts().map((j, i) => (
            <BoutonHub key={j} theme={theme} titre={j} variante={jours.includes(i + 1) ? 'plein' : 'normal'} onPress={() => setJours(l => (l.includes(i + 1) ? l.filter(x => x !== i + 1) : [...l, i + 1]))} testID={`esport-cm-reunions-jour-choix-${i + 1}`} />
          ))}
        </View>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <ChampHeure theme={theme} libelle={trRe('dispos.debut')} valeur={debut} onChanger={setDebut} testID="esport-cm-reunions-creneau-debut" style={{ minWidth: 90, flexGrow: 1 }} />
          <ChampHeure theme={theme} libelle={trRe('dispos.fin')} valeur={fin} onChanger={setFin} testID="esport-cm-reunions-creneau-fin" style={{ minWidth: 90, flexGrow: 1 }} />
        </View>
        <ChoixBoutons theme={theme} libelle="" valeur={type} options={[['disponible', trRe('dispos.type.disponible')], ['indisponible', trRe('dispos.type.indisponible')]]} onChoisir={setType} testID="esport-cm-reunions-creneau-type" />
        <BoutonHub theme={theme} titre={trRe('dispos.ajouter')} desactive={!heureValide(debut) || !heureValide(fin) || !jours.length} onPress={() => setRegles(l => [...l, ...jours.map(jour => ({ jour, debut, fin, type }))])} testID="esport-cm-reunions-creneau-ajouter" />
        <BoutonHub theme={theme} titre={trRe('dispos.enregistrer')} variante="plein" onPress={() => void agir('regles', async () => { onChange(await api.remplacerRegles(regles.map(({ jour, debut: d, fin: f, type: t }) => ({ jour, debut: d, fin: f, type: t })), fz.trim())); return trRe('dispos.enregistrees'); })} testID="esport-cm-reunions-creneaux-ok" />
      </View>
    </Carte>
  );
}

function MesAbsences({ theme, api, mes, onChange }: { theme: ThemeHub; api: ApiReunions; mes: MesDispos; onChange(m: MesDispos): void }) {
  const aujourdhui = murale(new Date().toISOString(), mes.fuseau).date;
  const [type, setType] = useState<TypeException>('conge');
  const [du, setDu] = useState(aujourdhui);
  const [au, setAu] = useState(aujourdhui);
  const [note, setNote] = useState('');
  const { erreur, agir } = useAgir();
  return (
    <Carte theme={theme} testID="esport-cm-reunions-absences">
      <TitreCarte theme={theme} titre={trRe('absences.titre')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reunions-absences" />
      {!mes.exceptions.length ? <Text style={attenue(theme)}>{trRe('absences.vide')}</Text> : null}
      {mes.exceptions.map(x => (
        <View key={x.id} style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.xs }]} testID={`esport-cm-reunions-absence-${x.id}`}>
          <Text style={texte(theme, 13)}>{`${trRe('absences.periode', { type: trRe(`absences.type.${x.type}` as CleRe), du: jourCourt(x.local?.debut.date ?? x.debut.slice(0, 10)), au: jourCourt(x.local?.fin.heure === '00:00' ? plusJours(x.local.fin.date, -1) : (x.local?.fin.date ?? x.fin.slice(0, 10))) })}${x.note ? ` · ${x.note}` : ''}`}</Text>
          <BoutonHub theme={theme} titre={trRe('absences.supprimer')} variante="danger" onPress={() => void agir('', async () => onChange(await api.supprimerException(x.id)))} testID={`esport-cm-reunions-absence-${x.id}-suppr`} />
        </View>
      ))}
      <ChoixBoutons theme={theme} libelle="" valeur={type} options={(['conge', 'absence', 'disponible'] as const).map(t => [t, trRe(`absences.type.${t}`)] as const)} onChoisir={setType} testID="esport-cm-reunions-absence-type" />
      <ChampPeriode theme={theme} libelleDu={trRe('absences.du')} libelleAu={trRe('absences.au')} du={du} au={au} onDu={setDu} onAu={setAu} periodes={false} testIDDu="esport-cm-reunions-absence-du" testIDAu="esport-cm-reunions-absence-au" style={{ gap: ESP.xs }} />
      <Champ theme={theme} libelle={trRe('absences.note')} valeur={note} onChanger={setNote} maxLength={200} testID="esport-cm-reunions-absence-note" />
      <BoutonHub theme={theme} titre={trRe('absences.ajouter')} desactive={!dateValide(du) || !dateValide(au) || au < du} onPress={() => void agir('', async () => { onChange(await api.ajouterException({ type, jourDebut: du, jourFin: au, fuseau: mes.fuseau, note: note.trim() })); setNote(''); })} testID="esport-cm-reunions-absence-ajouter" />
    </Carte>
  );
}

function Grille({ theme, api, fuseau }: { theme: ThemeHub; api: ApiReunions; fuseau: string }) {
  const [semaine, setSemaine] = useState(() => lundiDe(murale(new Date().toISOString(), fuseau).date));
  const [g, setG] = useState<GrilleEquipe | undefined>();
  const [choisie, setChoisie] = useState<{ jour: number; c: number } | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setG(await api.grille(semaine, fuseau)), [api, semaine, fuseau]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const noms = joursCourts();
  // Heures de 8:00 à 23:00 (créneaux d'une heure).
  const lignes = g ? g.creneaux.map((h, i) => ({ h, i })).filter(x => Number(x.h.slice(0, 2)) >= 8 && Number(x.h.slice(0, 2)) < 23) : [];
  const cel = choisie && g ? g.cellules[choisie.jour]?.[choisie.c] : null;
  return (
    <Carte theme={theme} testID="esport-cm-reunions-grille-equipe">
      <TitreCarte theme={theme} titre={trRe('grille.titre')} sous={trRe('grille.aide')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reunions-grille-equipe" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre="‹" libelle={trRe('agenda.precedent')} onPress={() => setSemaine(plusJours(semaine, -7))} testID="esport-cm-reunions-grille-precedent" />
        <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trRe('grille.semaine_du', { date: jourCourt(semaine) })}</Text>
        <BoutonHub theme={theme} titre="›" libelle={trRe('agenda.suivant')} onPress={() => setSemaine(plusJours(semaine, 7))} testID="esport-cm-reunions-grille-suivant" />
      </View>
      {g ? (
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            <View style={{ width: 44 }} />
            {noms.map(n => (
              <Text key={n} style={{ ...attenue(theme, 11), flex: 1, textAlign: 'center', fontWeight: '700' }}>
                {n}
              </Text>
            ))}
          </View>
          {lignes.map(({ h, i }) => (
            <View key={h} style={{ flexDirection: 'row', gap: 2 }}>
              <Text style={{ ...attenue(theme, 11), width: 44 }}>{h}</Text>
              {g.cellules.map((jour, j) => {
                const c = jour[i];
                const part = c && g.total ? c.n / g.total : 0;
                return (
                  <Pressable
                    key={j}
                    accessibilityRole="button"
                    accessibilityLabel={trRe('grille.cellule', { jour: noms[j], heure: h, n: c?.n ?? 0, total: g.total })}
                    onPress={() => setChoisie({ jour: j, c: i })}
                    testID={`esport-cm-reunions-grille-${j}-${h}`}
                    style={(e: EtatPresse) => ({ flex: 1, height: 22, borderRadius: 4, backgroundColor: c ? teinteTransparente(theme.ok, 0.08 + part * 0.8) : theme.fond, borderWidth: choisie?.jour === j && choisie.c === i ? 2 : e.hovered ? 1 : 0, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center' })}>
                    {c?.n ? <Text style={{ ...texte(theme, 10), fontWeight: '700' }}>{String(c.n)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {choisie && g ? (
            <Text style={texte(theme, 13)} testID="esport-cm-reunions-grille-qui">
              {trRe('grille.qui', { jour: noms[choisie.jour], heure: g.creneaux[choisie.c], noms: cel?.comptes.length ? cel.comptes.map(x => g.noms[x] ?? x).join(', ') : trRe('grille.personne') })}
            </Text>
          ) : null}
          {g.sansCreneaux.length ? <Text style={attenue(theme, 12)}>{trRe('grille.sans_creneaux', { noms: g.sansCreneaux.map(x => g.noms[x] ?? x).join(', ') })}</Text> : null}
        </View>
      ) : null}
    </Carte>
  );
}
