/**
 * Disponibilités : mes créneaux récurrents (par jour de la semaine) et mes
 * exceptions datées ; heatmap créneaux × jours du nombre de joueurs libres,
 * avec « Proposer un événement » là où l'effectif minimum (réglage de la
 * team) est libre.
 *
 * Stockage : exceptions en UTC ; créneaux récurrents en heure murale avec leur
 * fuseau (convertis date par date, changement d'heure compris). Affichage
 * dans le fuseau choisi (team par défaut, ou celui de l'appareil).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { apiPlanning, type CarteDispos, type CelluleCarte, type MesDispos, type RegleDispo } from '../../planning/api';
import { JOURS, JOURS_COURTS, ajouterJours, aujourdhui, dateCourteJour, dateLongue, dateValide, heureValide, lundiDe, nomFuseau } from '../../planning/libelles';
import { BoutonConfirme, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import type { PropsModule } from '../modules';
import { Pastille, SelecteurFuseau, useFuseau } from './commun';

type TypeDispo = 'disponible' | 'indisponible';
const TYPES: ReadonlyArray<readonly [TypeDispo, string]> = [
  ['disponible', 'Disponible'],
  ['indisponible', 'Indisponible'],
];

/** « HH:MM » + minutes. */
function plusMinutes(h: string, m: number): string {
  const [a, b] = h.split(':').map(Number);
  const t = (a * 60 + b + m) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function Disponibilites({ theme, client, detail, large, onAller }: PropsModule) {
  const api = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const f = useFuseau(detail.team.fuseau);
  const [mes, setMes] = useState<MesDispos | undefined>();
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const { erreur, agir } = useAgir();

  useEffect(() => {
    if (peut('availability.edit_own')) void agir('', async () => setMes(await api.mesDispos(f.fuseau)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, api, f.fuseau]);

  return (
    <View style={{ gap: 16 }} testID="esport-dispos">
      <TitreSection theme={theme} titre="Disponibilités" sous="Vos créneaux de la semaine, vos absences, et quand la team est au complet." />
      <SelecteurFuseau theme={theme} fuseauTeam={detail.team.fuseau} f={f} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-dispos" />
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        {mes ? (
          <View style={{ flex: 1, gap: 16, minWidth: 0 }}>
            <MesCreneaux theme={theme} mes={mes} fuseau={f.fuseau} onEnregistrer={async (regles, fuseau) => setMes(await api.remplacerRegles(regles, fuseau))} />
            <MesExceptions
              theme={theme}
              mes={mes}
              fuseau={f.fuseau}
              onAjouter={async x => setMes(await api.ajouterException(x))}
              onSupprimer={async id => setMes(await api.supprimerException(id))}
            />
          </View>
        ) : null}
        {peut('availability.view_all') ? (
          <View style={{ flex: large ? 1.4 : undefined, minWidth: 0 }}>
            <Heatmap theme={theme} api={api} fuseau={f.fuseau} peutCreer={peut('planning.create')} onProposer={b => onAller('module:planning', b)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Mes créneaux

function MesCreneaux({ theme, mes, fuseau, onEnregistrer }: { theme: ThemeHub; mes: MesDispos; fuseau: string; onEnregistrer(r: RegleDispo[], fuseau: string): Promise<void> }) {
  // On garde le fuseau de saisie des créneaux existants (sinon celui de l'affichage).
  const fuseauRegles = mes.regles[0]?.fuseau ?? fuseau;
  const [regles, setRegles] = useState<RegleDispo[]>(mes.regles);
  const [jours, setJours] = useState<number[]>([1]);
  const [debut, setDebut] = useState('19:00');
  const [fin, setFin] = useState('23:00');
  const [type, setType] = useState<TypeDispo>('disponible');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => setRegles(mes.regles), [mes.regles]);
  const modifie = JSON.stringify(regles.map(r => [r.jour, r.debut, r.fin, r.type])) !== JSON.stringify(mes.regles.map(r => [r.jour, r.debut, r.fin, r.type]));
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-dispos-creneaux">
      <Intertitre theme={theme}>Mes créneaux de la semaine</Intertitre>
      <Text style={attenue}>Heures de {nomFuseau(fuseauRegles)} ; elles suivent le changement d’heure.</Text>
      {JOURS.map((nom, i) => {
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
                  accessibilityLabel={`Retirer ${nom} ${r.debut}–${r.fin}`}
                  onPress={() => setRegles(l => l.filter(x => x !== r))}
                  testID={`esport-creneau-${r.jour}-${r.debut}`}
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
                    {r.debut}–{r.fin} ×
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10 }}>
        <View style={styles.ligne}>
          {JOURS_COURTS.map((j, i) => (
            <Pastille key={i} theme={theme} actif={jours.includes(i + 1)} libelle={j} role="checkbox" onPress={() => setJours(l => (l.includes(i + 1) ? l.filter(x => x !== i + 1) : [...l, i + 1]))} testID={`esport-creneau-jour-${i + 1}`} />
          ))}
        </View>
        <View style={styles.ligne}>
          <Champ theme={theme} libelle="De" valeur={debut} onChanger={setDebut} maxLength={5} style={{ width: 90 }} testID="esport-creneau-debut" />
          <Champ theme={theme} libelle="À" valeur={fin} onChanger={setFin} maxLength={5} style={{ width: 90 }} testID="esport-creneau-fin" />
          <Segments theme={theme} libelle="Type" valeur={type} options={TYPES} onChoisir={v => setType(v as TypeDispo)} testID="esport-creneau-type" />
        </View>
        <View style={styles.ligne}>
          <BoutonHub
            theme={theme}
            titre="Ajouter"
            onPress={() => {
              if (!heureValide(debut) || !heureValide(fin) || debut === fin || !jours.length) return;
              setRegles(l => [...l, ...jours.map(jour => ({ jour, debut, fin, type }))]);
            }}
            testID="esport-creneau-ajouter"
          />
          <BoutonHub
            theme={theme}
            titre={enCours ? 'Enregistrement…' : 'Enregistrer mes créneaux'}
            variante="plein"
            desactive={!modifie || Boolean(enCours)}
            onPress={() =>
              void agir('Créneaux', async () => {
                await onEnregistrer(
                  regles.map(r => ({ jour: r.jour, debut: r.debut, fin: r.fin, type: r.type })),
                  fuseauRegles,
                );
                return 'Créneaux enregistrés.';
              })
            }
            testID="esport-creneau-enregistrer"
          />
        </View>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-creneaux" />
      </View>
    </Panneau>
  );
}

// ------------------------------------------------------------------ Mes exceptions

function MesExceptions({
  theme,
  mes,
  fuseau,
  onAjouter,
  onSupprimer,
}: {
  theme: ThemeHub;
  mes: MesDispos;
  fuseau: string;
  onAjouter(x: { date: string; heureDebut: string; heureFin: string; fuseau: string; type: TypeDispo; note?: string }): Promise<void>;
  onSupprimer(id: string): Promise<void>;
}) {
  const [date, setDate] = useState(aujourdhui(fuseau));
  const [debut, setDebut] = useState('18:00');
  const [fin, setFin] = useState('23:59');
  const [type, setType] = useState<TypeDispo>('indisponible');
  const [note, setNote] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-dispos-exceptions">
      <Intertitre theme={theme}>Exceptions datées</Intertitre>
      <Text style={attenue}>Une absence ou une disponibilité ponctuelle passe avant vos créneaux de la semaine.</Text>
      {mes.exceptions.length === 0 ? <Text style={attenue}>Aucune exception à venir.</Text> : null}
      {mes.exceptions.map(x => (
        <View key={x.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ flex: 1, color: theme.texte, ...police(theme.policeTexte) }}>
            {x.type === 'indisponible' ? '✕' : '✓'} {dateCourteJour(x.jour)} {x.heureDebut}–{x.heureFin}
            {x.note ? ` · ${x.note}` : ''}
          </Text>
          <BoutonConfirme theme={theme} titre="Retirer" confirmation="Oui, retirer" onConfirme={() => void agir('Retrait', () => onSupprimer(x.id))} testID={`esport-exception-retirer-${x.id}`} />
        </View>
      ))}
      <View style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10 }]}>
        <Champ theme={theme} libelle="Date" valeur={date} onChanger={setDate} maxLength={10} style={{ width: 130 }} testID="esport-exception-date" />
        <Champ theme={theme} libelle="De" valeur={debut} onChanger={setDebut} maxLength={5} style={{ width: 80 }} testID="esport-exception-debut" />
        <Champ theme={theme} libelle="À" valeur={fin} onChanger={setFin} maxLength={5} style={{ width: 80 }} testID="esport-exception-fin" />
      </View>
      <Segments theme={theme} libelle="Type" valeur={type} options={TYPES} onChoisir={v => setType(v as TypeDispo)} testID="esport-exception-type" />
      <Champ theme={theme} libelle="Note (facultative)" valeur={note} onChanger={setNote} maxLength={120} testID="esport-exception-note" />
      <BoutonHub
        theme={theme}
        titre="Ajouter l’exception"
        variante="plein"
        desactive={Boolean(enCours) || !dateValide(date) || !heureValide(debut) || !heureValide(fin)}
        onPress={() =>
          void agir('Exception', async () => {
            await onAjouter({ date, heureDebut: debut, heureFin: fin, fuseau, type, note: note.trim() || undefined });
            setNote('');
            return 'Exception ajoutée.';
          })
        }
        testID="esport-exception-ajouter"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-exceptions" />
    </Panneau>
  );
}

// ------------------------------------------------------------------ Heatmap

function Heatmap({
  theme,
  api,
  fuseau,
  peutCreer,
  onProposer,
}: {
  theme: ThemeHub;
  api: ReturnType<typeof apiPlanning>;
  fuseau: string;
  peutCreer: boolean;
  onProposer(b: { type: 'scrim'; titre: string; date: string; heureDebut: string; heureFin: string; fuseau: string }): void;
}) {
  const [semaine, setSemaine] = useState(() => lundiDe(aujourdhui(fuseau)));
  const [pas, setPas] = useState<'60' | '30'>('60');
  const [journee, setJournee] = useState(false);
  const [carte, setCarte] = useState<CarteDispos | undefined>();
  const [choisie, setChoisie] = useState<{ jour: string; heure: string; c: CelluleCarte } | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => {
    setCarte(await api.carte({ semaine, fuseau, pas: pas === '30' ? 30 : 60 }));
    setChoisie(undefined);
  }, [api, semaine, fuseau, pas]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const lignes = carte ? carte.creneaux.map((h, i) => ({ h, i })).filter(({ h }) => journee || h >= '08:00') : [];
  const proposer = (jour: string, heureDebut: string, heureFin: string) => onProposer({ type: 'scrim', titre: 'Scrim', date: jour, heureDebut, heureFin, fuseau: carte?.fuseau ?? fuseau });
  return (
    <Panneau theme={theme} testID="esport-heatmap">
      <Intertitre theme={theme}>Qui est libre ?</Intertitre>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre="‹" libelle="Semaine précédente" onPress={() => setSemaine(s => ajouterJours(s, -7))} testID="esport-heatmap-precedente" />
          <Text style={{ color: theme.texte, fontWeight: '600', ...police(theme.policeTexte) }}>Semaine du {dateCourteJour(semaine)}</Text>
          <BoutonHub theme={theme} titre="›" libelle="Semaine suivante" onPress={() => setSemaine(s => ajouterJours(s, 7))} testID="esport-heatmap-suivante" />
        </View>
        <Segments theme={theme} libelle="Pas" valeur={pas} options={[['60', '1 h'], ['30', '30 min']]} onChoisir={v => setPas(v === '30' ? '30' : '60')} testID="esport-heatmap-pas" />
      </View>
      <Retours theme={theme} erreur={erreur} prefixe="esport-heatmap" />
      {carte ? (
        <Text style={attenue} testID="esport-heatmap-legende">
          Nombre de joueurs libres sur {carte.total} ({carte.renseignes} ont renseigné leurs créneaux) · effectif minimum : {carte.seuil} (cases cerclées)
        </Text>
      ) : null}
      {carte ? (
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            <View style={{ width: 44 }} />
            {carte.jours.map((j, d) => (
              <Text key={j} style={{ flex: 1, textAlign: 'center', color: theme.attenue, fontSize: 11, fontWeight: '700', ...police(theme.policeTexte) }}>
                {JOURS_COURTS[d]} {j.slice(8)}
              </Text>
            ))}
          </View>
          {lignes.map(({ h, i }) => (
            <View key={h} style={{ flexDirection: 'row', gap: 2 }}>
              <Text style={{ width: 44, color: theme.attenue, fontSize: 10, ...police(theme.policeChiffres) }}>{h}</Text>
              {carte.cellules.map((jour, d) => {
                const c = jour[i];
                if (!c) return <View key={d} style={{ flex: 1, height: 22 }} />;
                const ratio = carte.total ? c.n / carte.total : 0;
                const fort = ratio > 0.55;
                return (
                  <Pressable
                    key={d}
                    testID={`esport-heatmap-${carte.jours[d]}-${h}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${dateLongue(carte.jours[d])} ${h} : ${c.n} libre(s)${c.atteint ? ', effectif atteint' : ''}`}
                    onPress={() => setChoisie({ jour: carte.jours[d], heure: h, c })}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 4,
                      backgroundColor: c.n ? teinteTransparente(theme.accent, 0.1 + 0.8 * ratio) : teinteTransparente(theme.attenue, 0.06),
                      borderWidth: c.atteint ? 2 : 0,
                      borderColor: theme.ok,
                    }}>
                    <Text style={{ color: fort ? theme.surAccent : theme.texte, fontSize: 11, fontWeight: c.atteint ? '800' : '500', ...police(theme.policeChiffres) }}>{c.n || ''}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <BoutonHub theme={theme} titre={journee ? 'Masquer la nuit' : 'Toute la journée'} onPress={() => setJournee(j => !j)} testID="esport-heatmap-journee" />
        </View>
      ) : null}
      {choisie && carte ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID="esport-heatmap-choix">
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>
            {dateLongue(choisie.jour)} à {choisie.heure} : {choisie.c.n} libre(s)
          </Text>
          <Text style={attenue}>{choisie.c.comptes.map(c => carte.noms[c] ?? c).join(', ') || 'Personne'}</Text>
          {choisie.c.atteint && peutCreer ? (
            <BoutonHub theme={theme} titre="Proposer un événement" variante="plein" onPress={() => proposer(choisie.jour, choisie.heure, plusMinutes(choisie.heure, carte.pas))} testID="esport-heatmap-proposer" />
          ) : null}
        </View>
      ) : null}
      {carte?.plages.length ? (
        <View style={{ gap: 6 }} testID="esport-heatmap-plages">
          <Intertitre theme={theme}>Effectif minimum libre</Intertitre>
          {carte.plages.slice(0, 8).map(p => (
            <View key={p.debut} style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>
                {dateCourteJour(p.jour)} {p.heureDebut}–{p.heureFin} · {p.n} libres
              </Text>
              {peutCreer ? <BoutonHub theme={theme} titre="Proposer" onPress={() => proposer(p.jour, p.heureDebut, p.heureFin)} testID={`esport-heatmap-proposer-${p.jour}-${p.heureDebut}`} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Panneau>
  );
}
