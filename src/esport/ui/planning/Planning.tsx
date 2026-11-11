/**
 * Planning d'une team : vues mois, semaine et liste ; filtres par type et par
 * membre ; création et modification (une date ou toute la série), annulation ;
 * réponse (RSVP) et marquage de la présence ; export iCal et abonnement.
 *
 * Les boutons n'apparaissent que si le serveur les permet (`droits`), mais
 * c'est lui qui décide : un appel direct sans droit reçoit 403.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { Membre } from '../../client';
import { apiPlanning, type AbonnementIcal, type Annonce, type ApiPlanning, type Convocation, type DetailEvenement, type DroitsPlanning, type ListePlanning, type MembreConvocable, type Occurrence, type SaisieEvenement, type TypeEvenement } from '../../planning/api';
import { CONVOCATION_DEFAUT, memeConvocation } from '../../planning/convocations';
import {
  joursCourts,
  TYPES_EVENEMENT,
  ajouterJours,
  aujourdhui,
  dateLongue,
  dateValide,
  grilleMois,
  heureValide,
  jourSemaine,
  lundiDe,
  moisVoisin,
  nomMois,
  resumeRecurrence,
  typeEvenement,
} from '../../planning/libelles';
import { BoutonConfirme, Choix, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import { EnTetePage, EtatVide, Pliable, Volet } from '../design';
import type { PropsModule } from '../modules';
import { BoutonsRsvp, CarteOccurrence, Pastille, PastilleType, SelecteurConvocation, SelecteurFuseau, useFuseau } from './commun';
import { FeuilleAppel } from './FeuilleAppel';
import { tr, trn } from '../../i18n';
import { Icone } from '../../../ui/icones';
import { useTempsReel } from '../../tempsReel/hooks';
import { ChampDate, ChampHeure } from '../../../ui/dates';
import { ZoneEcriture } from '../ecriture/ZoneEcriture';

type Vue = 'mois' | 'semaine' | 'liste';
type Formulaire = { mode: 'creer' } | { mode: 'serie'; id: string } | { mode: 'occurrence'; id: string; cle: string };

const vuesPlanning = (): ReadonlyArray<readonly [Vue, string]> => [
  ['mois', tr('planning.planning.mois')],
  ['semaine', tr('planning.planning.semaine')],
  ['liste', tr('objectifs.liste')],
];

function plage(vue: Vue, ref: string): { debut: string; fin: string; titre: string } {
  if (vue === 'mois') {
    const g = grilleMois(ref);
    return { debut: g[0], fin: ajouterJours(g[41], 1), titre: nomMois(ref) };
  }
  if (vue === 'semaine') {
    const l = lundiDe(ref);
    return { debut: l, fin: ajouterJours(l, 7), titre: tr('planning.disponibilites.semaine_du', { v: dateLongue(l) }) };
  }
  return { debut: ref, fin: ajouterJours(ref, 31), titre: tr('planning.planning.a_partir_du', { v: dateLongue(ref) }) };
}

async function copier(texte: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

export function Planning({ theme, client, detail, large, brouillon, onExporter }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiPlanning(client, teamId), [client, teamId]);
  const f = useFuseau(detail.team.fuseau);
  const [vue, setVue] = useState<Vue>(large ? 'mois' : 'liste');
  const [ref, setRef] = useState(() => aujourdhui(f.fuseau));
  const [types, setTypes] = useState<TypeEvenement[]>([]);
  const [membre, setMembre] = useState('');
  const [donnees, setDonnees] = useState<ListePlanning | undefined>();
  const [membres, setMembres] = useState<Membre[]>([]);
  const [adversaires, setAdversaires] = useState<Array<{ id: string; nom: string }>>([]);
  const [selection, setSelection] = useState<Occurrence | undefined>();
  const [formulaire, setFormulaire] = useState<{ f: Formulaire; initial: Partial<SaisieEvenement> } | undefined>(brouillon ? { f: { mode: 'creer' }, initial: brouillon } : undefined);
  const [jourChoisi, setJourChoisi] = useState<string | undefined>();
  const { erreur, avis, agir } = useAgir();
  const p = plage(vue, ref);

  const charger = useCallback(async () => {
    const d = await api.liste({ debut: p.debut, fin: p.fin, fuseau: f.fuseau, types, membre: membre || undefined });
    setDonnees(d);
    setSelection(s => (s ? (d.occurrences.find(o => o.evenementId === s.evenementId && o.cle === s.cle) ?? s) : s));
  }, [api, p.debut, p.fin, f.fuseau, types, membre]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : un autre a changé le planning ou une présence → relu en moins d'une seconde.
  useTempsReel(client, [`team:${teamId}:planning`, `team:${teamId}:attendance`], () => void charger().catch(() => undefined));
  useEffect(() => {
    if (detail.moi.permissions.includes('members.view')) client.membres(teamId).then(m => setMembres(m.filter(x => x.statut === 'actif')), () => undefined);
  }, [client, teamId, detail.moi.permissions]);
  // Sélecteur d'adversaire (scouting) : seulement pour qui voit le scouting, module activé.
  const voitScouting = detail.moi.permissions.includes('scouting.view') && detail.modules.some(m => m.cle === 'scouting' && m.active);
  useEffect(() => {
    if (voitScouting) api.adversaires().then(setAdversaires, () => undefined);
  }, [api, voitScouting]);

  const droits = donnees?.droits;
  // Membres convocables (staff) et noms pour le détail.
  const [convocables, setConvocables] = useState<MembreConvocable[]>([]);
  useEffect(() => {
    if (donnees?.membres) setConvocables(donnees.membres);
  }, [donnees]);
  const noms = useMemo(() => Object.fromEntries([...membres.map(m => [m.compte, m.pseudo] as const), ...convocables.map(m => [m.compte, m.pseudo] as const)]), [membres, convocables]);
  const repondre = (o: Occurrence) => async (r: 'oui' | 'non' | 'peut_etre') => {
    await api.repondre(o.evenementId, o.cle, r);
    setDonnees(d => (d ? { ...d, occurrences: d.occurrences.map(x => (x.evenementId === o.evenementId && x.cle === o.cle ? { ...x, monRsvp: r } : x)) } : d));
  };
  /** Retard prévu ou motif d'absence, envoyés avec la réponse (facultatif). */
  const annoncer = (o: Occurrence) => async (r: 'oui' | 'non' | 'peut_etre', a: Partial<Annonce>) => {
    const rep = await api.repondre(o.evenementId, o.cle, r, a);
    const maReponse = { retardPrevu: rep.retardPrevu ?? null, motif: rep.motif ?? '' };
    setDonnees(d => (d ? { ...d, occurrences: d.occurrences.map(x => (x.evenementId === o.evenementId && x.cle === o.cle ? { ...x, monRsvp: r, maReponse } : x)) } : d));
    setSelection(x => (x && x.evenementId === o.evenementId && x.cle === o.cle ? { ...x, monRsvp: r, maReponse } : x));
  };
  const avecRsvp = Boolean(donnees?.modules.presence && droits?.rsvp);
  const deplacer = (sens: number) => setRef(r => (vue === 'mois' ? moisVoisin(r, sens) : ajouterJours(r, sens * (vue === 'semaine' ? 7 : 31))));
  const parJour = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of donnees?.occurrences ?? []) m.set(o.jour, [...(m.get(o.jour) ?? []), o]);
    return m;
  }, [donnees]);
  const auj = aujourdhui(f.fuseau);

  // Formulaire et détail : volet latéral sur PC (le calendrier reste visible), plein écran sur iPhone.
  const volet = formulaire ? (
      <FormulaireEvenement
        theme={theme}
        api={api}
        membres={convocables}
        adversaires={adversaires}
        fuseau={f.fuseau}
        formulaire={formulaire.f}
        initial={formulaire.initial}
        onFini={async message => {
          setFormulaire(undefined);
          setSelection(undefined);
          await agir('', async () => {
            await charger();
            return message;
          });
        }}
      />
  ) : selection && droits ? (
      <DetailOccurrence
        theme={theme}
        api={api}
        o={selection}
        droits={droits}
        presenceActive={Boolean(donnees?.modules.presence)}
        adversaires={adversaires}
        noms={noms}
        onRepondre={avecRsvp ? repondre(selection) : undefined}
        onAnnoncer={avecRsvp ? annoncer(selection) : undefined}
        onRetour={() => setSelection(undefined)}
        onModifier={(mode, initial) => setFormulaire({ f: mode === 'serie' ? { mode: 'serie', id: selection.evenementId } : { mode: 'occurrence', id: selection.evenementId, cle: selection.cle }, initial })}
        onSupprime={async message => {
          setSelection(undefined);
          await agir('', async () => {
            await charger();
            return message;
          });
        }}
        fuseau={f.fuseau}
      />
  ) : undefined;
  if (volet && !large) return volet;
  const fermerVolet = () => (formulaire ? setFormulaire(undefined) : setSelection(undefined));

  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const ouvrir = (o: Occurrence) => setSelection(o);
  const carte = (o: Occurrence, avecDate = true) => (
    <CarteOccurrence
      key={`${o.evenementId}-${o.cle}`}
      theme={theme}
      o={o}
      avecDate={avecDate}
      onOuvrir={() => ouvrir(o)}
      onRepondre={avecRsvp ? repondre(o) : undefined}
      onAnnoncer={avecRsvp ? annoncer(o) : undefined}
      testID={`esport-occ-${o.evenementId.slice(0, 8)}-${o.jour}`}
    />
  );

  return (
    <View style={{ gap: 16 }} testID="esport-planning">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('planning.accueilPlanning.planning')}
        sous={p.titre}
        action={
          droits?.creer ? (
            <BoutonHub
              theme={theme}
              titre={tr('planning.planning.nouvel_evenement')}
              variante="plein"
              onPress={() => setFormulaire({ f: { mode: 'creer' }, initial: { date: jourChoisi ?? (ref >= auj ? ref : auj) } })}
              testID="esport-planning-nouveau"
            />
          ) : undefined
        }
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-planning" />
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Segments theme={theme} libelle={tr('planning.planning.vue')} valeur={vue} options={vuesPlanning()} onChoisir={v => setVue(v as Vue)} testID="esport-planning-vue" />
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre="‹" libelle={tr('planning.planning.precedent')} onPress={() => deplacer(-1)} testID="esport-planning-precedent" />
          <BoutonHub theme={theme} titre={tr('planning.planning.aujourd_hui')} onPress={() => setRef(auj)} testID="esport-planning-aujourdhui" />
          <BoutonHub theme={theme} titre="›" libelle={tr('planning.planning.suivant')} onPress={() => deplacer(1)} testID="esport-planning-suivant" />
        </View>
      </View>
      <Pliable
        theme={theme}
        titre={tr('planning.planning.filtres')}
        resume={[types.length ? trn('planning.planning.types_filtre', types.length) : '', membre === 'moi' ? tr('planning.planning.mes_convocations') : membre ? (membres.find(m => m.compte === membre)?.pseudo ?? tr('planning.planning.1_membre')) : '', f.choix === 'appareil' ? tr('planning.planning.mon_heure') : ''].filter(Boolean).join(' · ') || tr('planning.planning.filtre_aucun')}
        testID="esport-planning-filtres-ouvrir">
        <View style={styles.ligne} testID="esport-planning-filtres">
          {TYPES_EVENEMENT.map(t => (
            <Pastille
              key={t.cle}
              theme={theme}
              actif={types.includes(t.cle)}
              libelle={t.nom}
              couleur={t.couleur}
              role="checkbox"
              onPress={() => setTypes(l => (l.includes(t.cle) ? l.filter(x => x !== t.cle) : [...l, t.cle]))}
              testID={`esport-filtre-type-${t.cle}`}
            />
          ))}
        </View>
        <View style={styles.ligne} accessibilityLabel={tr('planning.planning.mes_convocations_2')}>
          <Pastille
            theme={theme}
            actif={membre === 'moi'}
            libelle={tr('planning.planning.ou_je_suis_convoque')}
            role="checkbox"
            onPress={() => setMembre(membre === 'moi' ? '' : 'moi')}
            testID="esport-filtre-mes-convocations"
          />
        </View>
        {membres.length > 0 ? (
          <View style={styles.ligne} accessibilityLabel={tr('planning.planning.filtrer_par_membre_convoque')}>
            <Text style={attenue}>{tr('planning.planning.membre')}</Text>
            <Pastille theme={theme} actif={!membre} libelle={tr('journal.tous')} onPress={() => setMembre('')} role="radio" testID="esport-filtre-membre-tous" />
            {membres.map(m => (
              <Pastille key={m.compte} theme={theme} actif={membre === m.compte} libelle={m.pseudo} onPress={() => setMembre(membre === m.compte ? '' : m.compte)} role="radio" testID={`esport-filtre-membre-${m.compte}`} />
            ))}
          </View>
        ) : null}
        <SelecteurFuseau theme={theme} fuseauTeam={detail.team.fuseau} f={f} />
      </Pliable>

      {vue === 'mois' ? (
        <View style={{ gap: 12 }}>
          <GrilleMois
            theme={theme}
            ref_={ref}
            aujourdhui={auj}
            parJour={parJour}
            large={large}
            choisi={jourChoisi}
            onJour={j => setJourChoisi(j === jourChoisi ? undefined : j)}
            onOccurrence={ouvrir}
          />
          {jourChoisi ? (
            <View style={{ gap: 8 }} testID="esport-planning-jour">
              <Intertitre theme={theme}>{dateLongue(jourChoisi)}</Intertitre>
              {(parJour.get(jourChoisi) ?? []).length === 0 ? <Text style={attenue}>{tr('planning.planning.rien_ce_jour_la')}</Text> : null}
              {(parJour.get(jourChoisi) ?? []).map(o => carte(o, false))}
            </View>
          ) : null}
        </View>
      ) : vue === 'semaine' ? (
        <View style={large ? { flexDirection: 'row', gap: 8, alignItems: 'flex-start' } : { gap: 12 }} testID="esport-planning-semaine">
          {Array.from({ length: 7 }, (_, i) => ajouterJours(lundiDe(ref), i)).map(j => (
            <View key={j} style={large ? { flex: 1, gap: 6, minWidth: 0 } : { gap: 6 }}>
              <Text style={{ color: j === auj ? theme.accent : theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{large ? `${joursCourts()[jourSemaine(j) - 1]} ${j.slice(8)}` : dateLongue(j)}</Text>
              {(parJour.get(j) ?? []).map(o =>
                large ? <PuceOccurrence key={`${o.evenementId}-${o.cle}`} theme={theme} o={o} onPress={() => ouvrir(o)} /> : carte(o, false),
              )}
              {!large && !(parJour.get(j) ?? []).length ? <Text style={attenue}>—</Text> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: 12 }} testID="esport-planning-liste">
          {donnees && donnees.occurrences.length === 0 ? (
            <EtatVide
              theme={theme}
              glyphe="◷"
              titre={tr('planning.planning.aucun_evenement_sur_cette')}
              texte={droits?.creer ? tr('planning.planning.planifiez_un_entrainement_un') : tr('planning.planning.le_staff_n_a')}
            />
          ) : null}
          {[...parJour.entries()].map(([j, liste]) => (
            <View key={j} style={{ gap: 8 }}>
              <Intertitre theme={theme}>{`${dateLongue(j)}${j === auj ? tr('planning.planning.aujourd_hui_2') : ''}`}</Intertitre>
              {liste.map(o => carte(o, false))}
            </View>
          ))}
        </View>
      )}

      <PanneauIcal theme={theme} api={api} adresse={client.config.adresse} onExporter={onExporter} />
      <Volet theme={theme} visible={Boolean(volet)} titre={formulaire ? tr('planning.planning.evenement') : tr('planning.planning.detail')} onFermer={fermerVolet} testID="esport-planning-volet">
        {volet}
      </Volet>
    </View>
  );
}

// ------------------------------------------------------------------ Grille du mois

function GrilleMois({
  theme,
  ref_,
  aujourdhui: auj,
  parJour,
  large,
  choisi,
  onJour,
  onOccurrence,
}: {
  theme: ThemeHub;
  ref_: string;
  aujourdhui: string;
  parJour: Map<string, Occurrence[]>;
  large: boolean;
  choisi?: string;
  onJour(j: string): void;
  onOccurrence(o: Occurrence): void;
}) {
  const jours = grilleMois(ref_);
  const mois = ref_.slice(0, 7);
  return (
    <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12), overflow: 'hidden' }} testID="esport-planning-mois">
      <View style={{ flexDirection: 'row' }}>
        {joursCourts().map((j, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', paddingVertical: 6, color: theme.attenue, fontSize: 12, fontWeight: '700', ...police(theme.policeTexte) }}>
            {j}
          </Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, s) => (
        <View key={s} style={{ flexDirection: 'row' }}>
          {jours.slice(s * 7, s * 7 + 7).map(j => {
            const liste = parJour.get(j) ?? [];
            const dehors = j.slice(0, 7) !== mois;
            return (
              <Pressable
                key={j}
                testID={`esport-mois-${j}`}
                accessibilityRole="button"
                accessibilityLabel={tr('planning.planning.evenement_s', { v: dateLongue(j), evenements: trn('planning.planning.evenements', liste.length) })}
                onPress={() => onJour(j)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: large ? 92 : 52,
                  padding: 4,
                  gap: 2,
                  borderTopWidth: 1,
                  borderLeftWidth: 1,
                  borderColor: theme.ligne,
                  backgroundColor: j === choisi ? teinteTransparente(theme.accent, 0.14) : dehors ? teinteTransparente(theme.attenue, 0.06) : theme.surface,
                }}>
                <Text
                  style={{
                    alignSelf: large ? 'flex-start' : 'center',
                    color: j === auj ? theme.accent : dehors ? theme.attenue : theme.texte,
                    fontWeight: j === auj ? '800' : '500',
                    fontSize: 12,
                    ...police(theme.policeChiffres),
                  }}>
                  {Number(j.slice(8))}
                </Text>
                {large ? (
                  <>
                    {liste.slice(0, 3).map(o => (
                      <PuceOccurrence key={`${o.evenementId}-${o.cle}`} theme={theme} o={o} onPress={() => onOccurrence(o)} compacte />
                    ))}
                    {liste.length > 3 ? <Text style={{ color: theme.attenue, fontSize: 11 }}>+{liste.length - 3}</Text> : null}
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                    {liste.slice(0, 4).map(o => (
                      <View key={`${o.evenementId}-${o.cle}`} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: typeEvenement(o.type).couleur }} />
                    ))}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function PuceOccurrence({ theme, o, onPress, compacte }: { theme: ThemeHub; o: Occurrence; onPress(): void; compacte?: boolean }) {
  const t = typeEvenement(o.type);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${o.heureDebut} ${o.titre} (${t.nom})`}
      onPress={onPress}
      testID={`esport-puce-${o.evenementId.slice(0, 8)}-${o.jour}`}
      style={{ borderLeftWidth: 3, borderLeftColor: t.couleur, backgroundColor: teinteTransparente(t.couleur, 0.16), borderRadius: 4, paddingHorizontal: 4, paddingVertical: compacte ? 1 : 4 }}>
      <Text numberOfLines={compacte ? 1 : 2} style={{ color: theme.texte, fontSize: 11, ...police(theme.policeTexte) }}>
        <Text style={{ fontWeight: '700' }}>{o.heureDebut}</Text> {o.titre}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Détail d'une occurrence

function DetailOccurrence({
  theme,
  api,
  o,
  droits,
  presenceActive,
  onRepondre,
  onAnnoncer,
  onRetour,
  onModifier,
  onSupprime,
  fuseau,
  adversaires,
  noms = {},
}: {
  theme: ThemeHub;
  api: ApiPlanning;
  o: Occurrence;
  droits: DroitsPlanning;
  presenceActive: boolean;
  onRepondre?(r: 'oui' | 'non' | 'peut_etre'): Promise<unknown>;
  onAnnoncer?(r: 'oui' | 'non' | 'peut_etre', a: Partial<Annonce>): Promise<unknown>;
  onRetour(): void;
  onModifier(mode: 'serie' | 'occurrence', initial: Partial<SaisieEvenement>): void;
  onSupprime(message: string): Promise<void>;
  fuseau: string;
  adversaires?: Array<{ id: string; nom: string }>;
  noms?: Record<string, string>;
}) {
  const [evenement, setEvenement] = useState<DetailEvenement | undefined>();
  const { erreur, avis, agir } = useAgir();
  const voirPresence = presenceActive && (droits.voirPresences || droits.marquer);

  useEffect(() => {
    void agir('', async () => setEvenement(await api.detail(o.evenementId)));
  }, [agir, api, o.evenementId]);

  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const initialOccurrence: Partial<SaisieEvenement> = { type: o.type, titre: o.titre, description: o.description, lieu: o.lieu, date: o.jour, heureDebut: o.heureDebut, heureFin: o.heureFin, fuseau, convocation: o.convocation };
  const convoques = o.convoques ?? o.concernes;
  return (
    <View style={{ gap: 14 }} testID="esport-evenement">
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={tr('planning.planning.planning')} onPress={onRetour} testID="esport-evenement-retour" />
      </View>
      <Panneau theme={theme} style={{ borderLeftWidth: 4, borderLeftColor: typeEvenement(o.type).couleur }}>
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text accessibilityRole="header" style={[texte, { fontSize: 20, fontWeight: '800', flex: 1 }]} testID="esport-evenement-titre">
            {o.titre}
          </Text>
          <PastilleType theme={theme} type={o.type} />
        </View>
        <Text style={texte}>
          {dateLongue(o.jour)} · {o.heureDebut}–{o.heureFin}
          {o.jourFin !== o.jour ? tr('planning.planning.lendemain') : ''}
        </Text>
        {o.lieu ? (
              <Text style={texte}>
                <Icone nom="lieu" /> {o.lieu}
              </Text>
            ) : null}
        {o.description ? <Text style={attenue}>{o.description}</Text> : null}
        {o.adversaireId && adversaires?.some(a => a.id === o.adversaireId) ? (
          <Text style={texte} testID="esport-evenement-adversaire">
            {tr('planning.planning.adversaire', { nom: adversaires.find(a => a.id === o.adversaireId)?.nom })}</Text>
        ) : null}
        {evenement ? <Text style={attenue}>{resumeRecurrence(evenement.recurrence)}{o.modifiee ? tr('planning.planning.cette_date_a_ete') : ''}</Text> : null}
        <Text style={attenue} testID="esport-evenement-convoques">
          {convoques.length
            ? tr('planning.planning.convoques', { n: convoques.length, noms: convoques.map(c => noms[c] ?? '…').join(', '), propre: o.convocationPropre ? tr('planning.planning.liste_propre_a_cette') : '' })
            : tr('planning.planning.personne_n_est_convoque')}
        </Text>
        {o.convoqueMoi === false ? (
          <Text style={attenue} testID="esport-evenement-non-convoque">
            {tr('planning.planning.vous_n_etes_pas')}</Text>
        ) : null}
      </Panneau>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-evenement" />

      {onRepondre && o.concerneMoi !== false && !o.termine && o.monRsvp !== null && o.monRsvp !== undefined ? (
        <Panneau theme={theme} testID="esport-evenement-rsvp">
          <Intertitre theme={theme}>{tr('planning.planning.serez_vous_la')}</Intertitre>
          <BoutonsRsvp theme={theme} valeur={o.monRsvp} onRepondre={onRepondre} annonce={o.maReponse} onAnnoncer={onAnnoncer} testID="esport-evenement-rsvp-boutons" />
        </Panneau>
      ) : null}

      {voirPresence ? (
        <Panneau theme={theme} testID="esport-evenement-presence">
          <Intertitre theme={theme}>{tr('planning.listePresence.presence')}</Intertitre>
          <FeuilleAppel key={o.cle} rechargement={o.monRsvp ?? ''} theme={theme} api={api} evenementId={o.evenementId} cle={o.cle} marquer={droits.marquer} />
        </Panneau>
      ) : null}

      {droits.modifier || droits.supprimer ? (
        <Panneau theme={theme} testID="esport-evenement-actions">
          <Intertitre theme={theme}>{tr('planning.planning.gerer')}</Intertitre>
          <View style={styles.ligne}>
            {droits.modifier ? (
              <>
                <BoutonHub theme={theme} titre={o.recurrent ? tr('planning.planning.modifier_cette_date') : tr('membresRoles.modifier')} onPress={() => onModifier(o.recurrent ? 'occurrence' : 'serie', initialOccurrence)} testID="esport-evenement-modifier" />
                {o.recurrent ? <BoutonHub theme={theme} titre={tr('planning.planning.modifier_la_serie')} onPress={() => onModifier('serie', {})} testID="esport-evenement-modifier-serie" /> : null}
              </>
            ) : null}
          </View>
          {droits.supprimer ? (
            <View style={styles.ligne}>
              {o.recurrent ? (
                <>
                  <BoutonConfirme
                    theme={theme}
                    titre={tr('planning.planning.annuler_cette_date')}
                    confirmation={tr('planning.planning.oui_annuler_cette_date')}
                    onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimer(o.evenementId, 'occurrence', o.cle);
                    await onSupprime(tr('planning.planning.date_annulee'));
                  })
                }
                    testID="esport-evenement-annuler-date"
                  />
                  <BoutonConfirme
                    theme={theme}
                    titre={tr('planning.planning.cette_date_et_les')}
                    confirmation={tr('planning.planning.oui_arreter_la_serie')}
                    onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimer(o.evenementId, 'suivantes', o.cle);
                    await onSupprime(tr('planning.planning.serie_arretee'));
                  })
                }
                    testID="esport-evenement-annuler-suivantes"
                  />
                </>
              ) : null}
              <BoutonConfirme
                theme={theme}
                titre={o.recurrent ? tr('planning.planning.toute_la_serie') : tr('discord.supprimer')}
                confirmation={tr('planning.planning.oui_supprimer')}
                onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimer(o.evenementId, 'serie');
                    await onSupprime(tr('planning.planning.evenement_supprime'));
                  })
                }
                testID="esport-evenement-supprimer"
              />
            </View>
          ) : null}
        </Panneau>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Formulaire

function FormulaireEvenement({
  theme,
  api,
  membres,
  adversaires = [],
  fuseau,
  formulaire,
  initial,
  onFini,
}: {
  theme: ThemeHub;
  api: ApiPlanning;
  membres: MembreConvocable[];
  adversaires?: Array<{ id: string; nom: string }>;
  fuseau: string;
  formulaire: Formulaire;
  initial: Partial<SaisieEvenement>;
  onFini(message?: string): Promise<void>;
}) {
  const [s, setS] = useState<SaisieEvenement>({
    type: initial.type ?? 'training',
    titre: initial.titre ?? '',
    description: initial.description ?? '',
    lieu: initial.lieu ?? '',
    date: initial.date ?? aujourdhui(fuseau),
    heureDebut: initial.heureDebut ?? '20:00',
    heureFin: initial.heureFin ?? '22:00',
    fuseau: initial.fuseau ?? fuseau,
    convocation: initial.convocation ?? CONVOCATION_DEFAUT,
    adversaireId: initial.adversaireId ?? null,
  });
  // Liste d'origine d'une date (pour n'en faire une liste propre que si elle change).
  const [convocationOrigine] = useState<Convocation | null | undefined>(initial.convocation);
  const [repeter, setRepeter] = useState(false);
  const [jours, setJours] = useState<number[]>([]);
  const [intervalle, setIntervalle] = useState<'1' | '2'>('1');
  const [jusqua, setJusqua] = useState('');
  const [pret, setPret] = useState(formulaire.mode !== 'serie');
  const { enCours, erreur, agir, setErreur } = useAgir();
  const serie = formulaire.mode !== 'occurrence';

  // Modifier la série : on part de l'événement (horaire dans SON fuseau).
  useEffect(() => {
    if (formulaire.mode !== 'serie') return;
    void agir('', async () => {
      const d = await api.detail(formulaire.id);
      setS({ type: d.type, titre: d.titre, description: d.description, lieu: d.lieu, date: d.date, heureDebut: d.heureDebut, heureFin: d.heureFin, fuseau: d.fuseau, convocation: d.convocation ?? CONVOCATION_DEFAUT, adversaireId: d.adversaireId });
      if (d.recurrence) {
        setRepeter(true);
        setJours(d.recurrence.jours);
        setIntervalle(d.recurrence.intervalle === 2 ? '2' : '1');
        setJusqua(d.recurrence.jusqua ?? '');
      }
      setPret(true);
    });
  }, [agir, api, formulaire]);

  const maj = (champ: Partial<SaisieEvenement>) => setS(x => ({ ...x, ...champ }));
  const titre = formulaire.mode === 'creer' ? tr('planning.planning.nouvel_evenement_2') : formulaire.mode === 'serie' ? tr('planning.planning.modifier_la_serie') : tr('planning.planning.modifier_cette_date');
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  const enregistrer = () =>
    agir('enregistrer', async () => {
      if (s.titre.trim().length < 2) throw new Error(tr('review.formulaireRepere.titre_2_caracteres_au'));
      if (!dateValide(s.date)) throw new Error(tr('planning.planning.date_aaaa_mm_jj_2'));
      if (!heureValide(s.heureDebut) || !heureValide(s.heureFin)) throw new Error(tr('planning.planning.heures_hh_mm'));
      if (repeter && jusqua && !dateValide(jusqua)) throw new Error(tr('planning.planning.fin_de_la_serie'));
      const recurrence = repeter ? { freq: 'hebdo' as const, intervalle: Number(intervalle), jours: jours.length ? jours : [jourSemaine(s.date)], jusqua: jusqua || null } : null;
      const corps = { ...s, titre: s.titre.trim() };
      if (formulaire.mode === 'creer') await api.creer({ ...corps, recurrence });
      else if (formulaire.mode === 'serie') await api.modifier(formulaire.id, { ...corps, recurrence });
      else
        await api.modifierOccurrence(formulaire.id, formulaire.cle, {
          titre: corps.titre,
          description: corps.description,
          lieu: corps.lieu,
          date: corps.date,
          heureDebut: corps.heureDebut,
          heureFin: corps.heureFin,
          fuseau: corps.fuseau,
          // Une liste propre à cette date, seulement si elle a changé.
          ...(corps.convocation && !memeConvocation(corps.convocation, convocationOrigine) ? { convocation: corps.convocation } : {}),
        });
      await onFini(formulaire.mode === 'creer' ? tr('planning.planning.evenement_cree') : tr('planning.planning.modification_enregistree'));
    });

  return (
    <View style={{ gap: 14 }} testID="esport-formulaire">
      <TitreSection theme={theme} titre={titre} sous={formulaire.mode === 'serie' ? tr('planning.planning.changer_l_horaire_ou') : undefined} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-formulaire" />
      {!pret ? <Text style={attenue}>{tr('journal.chargement')}</Text> : null}
      <Panneau theme={theme}>
        {serie ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{tr('resumes.type')}</Text>
            <View style={styles.ligne}>
              {TYPES_EVENEMENT.map(t => (
                <Pastille key={t.cle} theme={theme} actif={s.type === t.cle} libelle={t.nom} couleur={t.couleur} role="radio" onPress={() => maj({ type: t.cle })} testID={`esport-formulaire-type-${t.cle}`} />
              ))}
            </View>
          </View>
        ) : null}
        <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={s.titre} onChanger={titre => maj({ titre })} maxLength={80} placeholder={tr('planning.planning.scrim_vs')} testID="esport-formulaire-titre" />
        <View style={styles.ligne}>
          <ChampDate theme={theme} libelle={tr('planning.planning.date_aaaa_mm_jj')} valeur={s.date} onChanger={date => maj({ date })} style={{ flexGrow: 1, minWidth: 140 }} testID="esport-formulaire-date" />
          <ChampHeure theme={theme} libelle={tr('planning.planning.debut')} valeur={s.heureDebut} onChanger={heureDebut => maj({ heureDebut })} style={{ width: 140 }} testID="esport-formulaire-debut" />
          <ChampHeure theme={theme} libelle={tr('planning.planning.fin')} valeur={s.heureFin} onChanger={heureFin => maj({ heureFin })} style={{ width: 140 }} testID="esport-formulaire-fin" />
        </View>
        <Text style={attenue}>{tr('planning.planning.heures_de_une_fin', { fuseau: s.fuseau })}</Text>
        <Champ theme={theme} libelle={tr('planning.planning.lieu_ou_lien')} valeur={s.lieu ?? ''} onChanger={lieu => maj({ lieu })} maxLength={200} testID="esport-formulaire-lieu" />
        <ZoneEcriture theme={theme} champ="planning.description" valeur={s.description ?? ''} onChanger={description => maj({ description })} maxLength={2000} testID="esport-formulaire-description-ecriture">
          <Champ theme={theme} libelle={tr('pageTeam.description')} valeur={s.description ?? ''} onChanger={description => maj({ description })} maxLength={2000} multiligne testID="esport-formulaire-description" />
        </ZoneEcriture>
        {serie && adversaires.length > 0 ? (
          <Choix
            theme={theme}
            libelle={tr('planning.planning.adversaire_scouting')}
            valeur={s.adversaireId ?? ''}
            options={[{ id: '', nom: tr('objectifs.aucun') }, ...adversaires.map(a => ({ id: a.id, nom: a.nom }))]}
            onChoisir={v => maj({ adversaireId: v || null })}
            testID="esport-formulaire-adversaire"
          />
        ) : null}
        {serie ? (
          <>
            <View style={[styles.ligne, { flexWrap: 'nowrap' }]}>
              <Case theme={theme} coche={repeter} libelle={tr('planning.planning.repeter_chaque_semaine')} onChanger={setRepeter} testID="esport-formulaire-repeter" />
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{tr('planning.planning.repeter_chaque_semaine')}</Text>
            </View>
            {repeter ? (
              <View style={{ gap: 8 }}>
                <View style={styles.ligne}>
                  {joursCourts().map((j, i) => (
                    <Pastille
                      key={i}
                      theme={theme}
                      actif={jours.includes(i + 1) || (!jours.length && jourSemaine(s.date) === i + 1)}
                      libelle={j}
                      role="checkbox"
                      onPress={() => setJours(l => (l.includes(i + 1) ? l.filter(x => x !== i + 1) : [...(l.length ? l : [jourSemaine(s.date)]), i + 1]))}
                      testID={`esport-formulaire-jour-${i + 1}`}
                    />
                  ))}
                </View>
                <Segments theme={theme} libelle={tr('planning.planning.rythme')} valeur={intervalle} options={[['1', tr('planning.libelles.chaque_semaine')], ['2', tr('planning.planning.une_semaine_sur_deux')]]} onChoisir={v => setIntervalle(v === '2' ? '2' : '1')} testID="esport-formulaire-intervalle" />
                <ChampDate theme={theme} libelle={tr('planning.planning.jusqu_au_facultatif_aaaa')} valeur={jusqua} onChanger={setJusqua} testID="esport-formulaire-jusqua" />
              </View>
            ) : null}
          </>
        ) : null}
        {membres.length ? (
          <SelecteurConvocation theme={theme} membres={membres} valeur={s.convocation ?? CONVOCATION_DEFAUT} onChange={convocation => maj({ convocation })} testID="esport-formulaire-convocation" />
        ) : null}
        {!serie && membres.length ? <Text style={attenue}>{tr('planning.planning.cette_liste_ne_vaut')}</Text> : null}
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={enCours ? tr('membresRoles.enregistrement') : tr('discord.enregistrer')} variante="plein" desactive={Boolean(enCours) || !pret} onPress={() => void enregistrer()} testID="esport-formulaire-enregistrer" />
          <BoutonHub
            theme={theme}
            titre={tr('assistant.annuler')}
            onPress={() => {
              setErreur(undefined);
              void onFini();
            }}
            testID="esport-formulaire-annuler"
          />
        </View>
      </Panneau>
    </View>
  );
}

// ------------------------------------------------------------------ iCal

function PanneauIcal({ theme, api, adresse, onExporter }: { theme: ThemeHub; api: ApiPlanning; adresse: string; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const [abonnements, setAbonnements] = useState<AbonnementIcal[] | undefined>();
  const [nouveau, setNouveau] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const charger = useCallback(async () => setAbonnements(await api.abonnements()), [api]);
  return (
    <Panneau theme={theme} testID="esport-ical">
      <Intertitre theme={theme}>{tr('planning.planning.calendrier_ical')}</Intertitre>
      <Text style={attenue}>{tr('planning.planning.exportez_le_planning_ics')}</Text>
      <View style={styles.ligne}>
        {onExporter ? (
          <BoutonHub
            theme={theme}
            titre={tr('planning.planning.exporter_ics')}
            onPress={() =>
              void agir('export', async () => {
                const f = await api.exportIcs();
                return (await onExporter(f.nom, f.contenu, 'text/calendar')) ? tr('planning.planning.calendrier_exporte') : undefined;
              })
            }
            testID="esport-ical-exporter"
          />
        ) : null}
        <BoutonHub
          theme={theme}
          titre={tr('planning.planning.creer_un_lien_d')}
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('abonnement', async () => {
              const r = await api.creerAbonnement(tr('planning.planning.mon_calendrier'));
              setNouveau(`${adresse}${r.chemin}`);
              await charger();
              return tr('planning.planning.lien_cree_il_ne');
            })
          }
          testID="esport-ical-creer"
        />
        {abonnements === undefined ? <BoutonHub theme={theme} titre={tr('planning.planning.mes_abonnements')} onPress={() => void agir('', charger)} testID="esport-ical-liste" /> : null}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ical" />
      {nouveau ? (
        <View style={{ gap: 6 }}>
          <Text selectable style={{ color: theme.texte, fontSize: 12, ...police(theme.policeChiffres) }} testID="esport-ical-url">
            {nouveau}
          </Text>
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={tr('planning.planning.copier')} onPress={() => void copier(nouveau)} testID="esport-ical-copier" />
            <Text selectable style={attenue}>
              {tr('planning.planning.sur_iphone', { lien: nouveau.replace(/^https?:/, 'webcal:') })}
            </Text>
          </View>
        </View>
      ) : null}
      {abonnements?.map(a => (
        <View key={a.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ color: a.revoque ? theme.attenue : theme.texte, ...police(theme.policeTexte) }}>
            {a.libelle} · {a.revoque ? tr('planning.planning.revoque') : a.dernierAcces ? tr('planning.planning.lu_le', { v: a.dernierAcces.slice(0, 10) }) : tr('planning.planning.jamais_lu')}
          </Text>
          {!a.revoque ? (
            <BoutonHub
              theme={theme}
              titre={tr('planning.planning.revoquer')}
              variante="danger"
              onPress={() =>
                void agir('revocation', async () => {
                  await api.revoquerAbonnement(a.id);
                  await charger();
                  return tr('planning.planning.abonnement_revoque_le_lien');
                })
              }
              testID={`esport-ical-revoquer-${a.id}`}
            />
          ) : null}
        </View>
      ))}
    </Panneau>
  );
}

