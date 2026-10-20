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
import { apiPlanning, type AbonnementIcal, type ApiPlanning, type Convocation, type DetailEvenement, type DroitsPlanning, type ListePlanning, type MembreConvocable, type Occurrence, type SaisieEvenement, type TypeEvenement } from '../../planning/api';
import { CONVOCATION_DEFAUT, memeConvocation } from '../../planning/convocations';
import {
  JOURS_COURTS,
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
import { ListePresence } from './ListePresence';

type Vue = 'mois' | 'semaine' | 'liste';
type Formulaire = { mode: 'creer' } | { mode: 'serie'; id: string } | { mode: 'occurrence'; id: string; cle: string };

const VUES: ReadonlyArray<readonly [Vue, string]> = [
  ['mois', 'Mois'],
  ['semaine', 'Semaine'],
  ['liste', 'Liste'],
];

function plage(vue: Vue, ref: string): { debut: string; fin: string; titre: string } {
  if (vue === 'mois') {
    const g = grilleMois(ref);
    return { debut: g[0], fin: ajouterJours(g[41], 1), titre: nomMois(ref) };
  }
  if (vue === 'semaine') {
    const l = lundiDe(ref);
    return { debut: l, fin: ajouterJours(l, 7), titre: `Semaine du ${dateLongue(l)}` };
  }
  return { debut: ref, fin: ajouterJours(ref, 31), titre: `À partir du ${dateLongue(ref)}` };
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
      testID={`esport-occ-${o.evenementId.slice(0, 8)}-${o.jour}`}
    />
  );

  return (
    <View style={{ gap: 16 }} testID="esport-planning">
      <EnTetePage
        theme={theme}
        large={large}
        titre="Planning"
        sous={p.titre}
        action={
          droits?.creer ? (
            <BoutonHub
              theme={theme}
              titre="+ Nouvel événement"
              variante="plein"
              onPress={() => setFormulaire({ f: { mode: 'creer' }, initial: { date: jourChoisi ?? (ref >= auj ? ref : auj) } })}
              testID="esport-planning-nouveau"
            />
          ) : undefined
        }
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-planning" />
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Segments theme={theme} libelle="Vue" valeur={vue} options={VUES} onChoisir={v => setVue(v as Vue)} testID="esport-planning-vue" />
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre="‹" libelle="Précédent" onPress={() => deplacer(-1)} testID="esport-planning-precedent" />
          <BoutonHub theme={theme} titre="Aujourd’hui" onPress={() => setRef(auj)} testID="esport-planning-aujourdhui" />
          <BoutonHub theme={theme} titre="›" libelle="Suivant" onPress={() => deplacer(1)} testID="esport-planning-suivant" />
        </View>
      </View>
      <Pliable
        theme={theme}
        titre="Filtres"
        resume={[types.length ? `${types.length} type${types.length > 1 ? 's' : ''}` : '', membre === 'moi' ? 'mes convocations' : membre ? (membres.find(m => m.compte === membre)?.pseudo ?? '1 membre') : '', f.choix === 'appareil' ? 'mon heure' : ''].filter(Boolean).join(' · ') || 'aucun'}
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
        <View style={styles.ligne} accessibilityLabel="Mes convocations">
          <Pastille
            theme={theme}
            actif={membre === 'moi'}
            libelle="Où je suis convoqué"
            role="checkbox"
            onPress={() => setMembre(membre === 'moi' ? '' : 'moi')}
            testID="esport-filtre-mes-convocations"
          />
        </View>
        {membres.length > 0 ? (
          <View style={styles.ligne} accessibilityLabel="Filtrer par membre convoqué">
            <Text style={attenue}>Membre :</Text>
            <Pastille theme={theme} actif={!membre} libelle="Tous" onPress={() => setMembre('')} role="radio" testID="esport-filtre-membre-tous" />
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
              {(parJour.get(jourChoisi) ?? []).length === 0 ? <Text style={attenue}>Rien ce jour-là.</Text> : null}
              {(parJour.get(jourChoisi) ?? []).map(o => carte(o, false))}
            </View>
          ) : null}
        </View>
      ) : vue === 'semaine' ? (
        <View style={large ? { flexDirection: 'row', gap: 8, alignItems: 'flex-start' } : { gap: 12 }} testID="esport-planning-semaine">
          {Array.from({ length: 7 }, (_, i) => ajouterJours(lundiDe(ref), i)).map(j => (
            <View key={j} style={large ? { flex: 1, gap: 6, minWidth: 0 } : { gap: 6 }}>
              <Text style={{ color: j === auj ? theme.accent : theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{large ? `${JOURS_COURTS[jourSemaine(j) - 1]} ${j.slice(8)}` : dateLongue(j)}</Text>
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
              titre="Aucun événement sur cette période"
              texte={droits?.creer ? 'Planifiez un entraînement, un scrim ou un match : il apparaîtra ici et chez chaque joueur.' : 'Le staff n’a encore rien prévu sur cette période.'}
            />
          ) : null}
          {[...parJour.entries()].map(([j, liste]) => (
            <View key={j} style={{ gap: 8 }}>
              <Intertitre theme={theme}>{`${dateLongue(j)}${j === auj ? ' · aujourd’hui' : ''}`}</Intertitre>
              {liste.map(o => carte(o, false))}
            </View>
          ))}
        </View>
      )}

      <PanneauIcal theme={theme} api={api} adresse={client.config.adresse} onExporter={onExporter} />
      <Volet theme={theme} visible={Boolean(volet)} titre={formulaire ? 'Événement' : 'Détail'} onFermer={fermerVolet} testID="esport-planning-volet">
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
        {JOURS_COURTS.map((j, i) => (
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
                accessibilityLabel={`${dateLongue(j)} : ${liste.length} événement(s)`}
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
        <BoutonHub theme={theme} titre="← Planning" onPress={onRetour} testID="esport-evenement-retour" />
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
          {o.jourFin !== o.jour ? ' (lendemain)' : ''}
        </Text>
        {o.lieu ? <Text style={texte}>📍 {o.lieu}</Text> : null}
        {o.description ? <Text style={attenue}>{o.description}</Text> : null}
        {o.adversaireId && adversaires?.some(a => a.id === o.adversaireId) ? (
          <Text style={texte} testID="esport-evenement-adversaire">
            Adversaire : {adversaires.find(a => a.id === o.adversaireId)?.nom}
          </Text>
        ) : null}
        {evenement ? <Text style={attenue}>{resumeRecurrence(evenement.recurrence)}{o.modifiee ? ' · cette date a été modifiée' : ''}</Text> : null}
        <Text style={attenue} testID="esport-evenement-convoques">
          {convoques.length
            ? `Convoqués (${convoques.length}) : ${convoques.map(c => noms[c] ?? '…').join(', ')}${o.convocationPropre ? ' · liste propre à cette date' : ''}`
            : 'Personne n’est convoqué.'}
        </Text>
        {o.convoqueMoi === false ? (
          <Text style={attenue} testID="esport-evenement-non-convoque">
            Vous n’êtes pas convoqué : vous voyez l’événement, sans y être attendu ni relancé.
          </Text>
        ) : null}
      </Panneau>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-evenement" />

      {onRepondre && o.concerneMoi !== false && !o.termine && o.monRsvp !== null && o.monRsvp !== undefined ? (
        <Panneau theme={theme} testID="esport-evenement-rsvp">
          <Intertitre theme={theme}>Serez-vous là ?</Intertitre>
          <BoutonsRsvp theme={theme} valeur={o.monRsvp} onRepondre={onRepondre} testID="esport-evenement-rsvp-boutons" />
        </Panneau>
      ) : null}

      {voirPresence ? <ListePresence key={`${o.cle}-${o.monRsvp ?? ''}`} theme={theme} api={api} evenementId={o.evenementId} cle={o.cle} marquer={droits.marquer} /> : null}

      {droits.modifier || droits.supprimer ? (
        <Panneau theme={theme} testID="esport-evenement-actions">
          <Intertitre theme={theme}>Gérer</Intertitre>
          <View style={styles.ligne}>
            {droits.modifier ? (
              <>
                <BoutonHub theme={theme} titre={o.recurrent ? 'Modifier cette date' : 'Modifier'} onPress={() => onModifier(o.recurrent ? 'occurrence' : 'serie', initialOccurrence)} testID="esport-evenement-modifier" />
                {o.recurrent ? <BoutonHub theme={theme} titre="Modifier la série" onPress={() => onModifier('serie', {})} testID="esport-evenement-modifier-serie" /> : null}
              </>
            ) : null}
          </View>
          {droits.supprimer ? (
            <View style={styles.ligne}>
              {o.recurrent ? (
                <>
                  <BoutonConfirme
                    theme={theme}
                    titre="Annuler cette date"
                    confirmation="Oui, annuler cette date"
                    onConfirme={() =>
                  void agir('Suppression', async () => {
                    await api.supprimer(o.evenementId, 'occurrence', o.cle);
                    await onSupprime('Date annulée.');
                  })
                }
                    testID="esport-evenement-annuler-date"
                  />
                  <BoutonConfirme
                    theme={theme}
                    titre="Cette date et les suivantes"
                    confirmation="Oui, arrêter la série ici"
                    onConfirme={() =>
                  void agir('Suppression', async () => {
                    await api.supprimer(o.evenementId, 'suivantes', o.cle);
                    await onSupprime('Série arrêtée.');
                  })
                }
                    testID="esport-evenement-annuler-suivantes"
                  />
                </>
              ) : null}
              <BoutonConfirme
                theme={theme}
                titre={o.recurrent ? 'Toute la série' : 'Supprimer'}
                confirmation="Oui, supprimer"
                onConfirme={() =>
                  void agir('Suppression', async () => {
                    await api.supprimer(o.evenementId, 'serie');
                    await onSupprime('Événement supprimé.');
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
  const titre = formulaire.mode === 'creer' ? 'Nouvel événement' : formulaire.mode === 'serie' ? 'Modifier la série' : 'Modifier cette date';
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  const enregistrer = () =>
    agir('Enregistrer', async () => {
      if (s.titre.trim().length < 2) throw new Error('Titre : 2 caractères au moins.');
      if (!dateValide(s.date)) throw new Error('Date : AAAA-MM-JJ.');
      if (!heureValide(s.heureDebut) || !heureValide(s.heureFin)) throw new Error('Heures : HH:MM.');
      if (repeter && jusqua && !dateValide(jusqua)) throw new Error('Fin de la série : AAAA-MM-JJ.');
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
      await onFini(formulaire.mode === 'creer' ? 'Événement créé.' : 'Modification enregistrée.');
    });

  return (
    <View style={{ gap: 14 }} testID="esport-formulaire">
      <TitreSection theme={theme} titre={titre} sous={formulaire.mode === 'serie' ? 'Changer l’horaire ou la règle remet à zéro les dates modifiées une à une.' : undefined} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-formulaire" />
      {!pret ? <Text style={attenue}>Chargement…</Text> : null}
      <Panneau theme={theme}>
        {serie ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>Type</Text>
            <View style={styles.ligne}>
              {TYPES_EVENEMENT.map(t => (
                <Pastille key={t.cle} theme={theme} actif={s.type === t.cle} libelle={t.nom} couleur={t.couleur} role="radio" onPress={() => maj({ type: t.cle })} testID={`esport-formulaire-type-${t.cle}`} />
              ))}
            </View>
          </View>
        ) : null}
        <Champ theme={theme} libelle="Titre" valeur={s.titre} onChanger={titre => maj({ titre })} maxLength={80} placeholder="Scrim vs …" testID="esport-formulaire-titre" />
        <View style={styles.ligne}>
          <Champ theme={theme} libelle="Date (AAAA-MM-JJ)" valeur={s.date} onChanger={date => maj({ date })} maxLength={10} style={{ flexGrow: 1, minWidth: 140 }} testID="esport-formulaire-date" />
          <Champ theme={theme} libelle="Début" valeur={s.heureDebut} onChanger={heureDebut => maj({ heureDebut })} maxLength={5} style={{ width: 90 }} testID="esport-formulaire-debut" />
          <Champ theme={theme} libelle="Fin" valeur={s.heureFin} onChanger={heureFin => maj({ heureFin })} maxLength={5} style={{ width: 90 }} testID="esport-formulaire-fin" />
        </View>
        <Text style={attenue}>Heures de {s.fuseau}. Une fin avant le début tombe le lendemain.</Text>
        <Champ theme={theme} libelle="Lieu ou lien" valeur={s.lieu ?? ''} onChanger={lieu => maj({ lieu })} maxLength={200} testID="esport-formulaire-lieu" />
        <Champ theme={theme} libelle="Description" valeur={s.description ?? ''} onChanger={description => maj({ description })} maxLength={2000} multiligne testID="esport-formulaire-description" />
        {serie && adversaires.length > 0 ? (
          <Choix
            theme={theme}
            libelle="Adversaire (scouting)"
            valeur={s.adversaireId ?? ''}
            options={[{ id: '', nom: 'Aucun' }, ...adversaires.map(a => ({ id: a.id, nom: a.nom }))]}
            onChoisir={v => maj({ adversaireId: v || null })}
            testID="esport-formulaire-adversaire"
          />
        ) : null}
        {serie ? (
          <>
            <View style={[styles.ligne, { flexWrap: 'nowrap' }]}>
              <Case theme={theme} coche={repeter} libelle="Répéter chaque semaine" onChanger={setRepeter} testID="esport-formulaire-repeter" />
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>Répéter chaque semaine</Text>
            </View>
            {repeter ? (
              <View style={{ gap: 8 }}>
                <View style={styles.ligne}>
                  {JOURS_COURTS.map((j, i) => (
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
                <Segments theme={theme} libelle="Rythme" valeur={intervalle} options={[['1', 'Chaque semaine'], ['2', 'Une semaine sur deux']]} onChoisir={v => setIntervalle(v === '2' ? '2' : '1')} testID="esport-formulaire-intervalle" />
                <Champ theme={theme} libelle="Jusqu’au (facultatif, AAAA-MM-JJ)" valeur={jusqua} onChanger={setJusqua} maxLength={10} testID="esport-formulaire-jusqua" />
              </View>
            ) : null}
          </>
        ) : null}
        {membres.length ? (
          <SelecteurConvocation theme={theme} membres={membres} valeur={s.convocation ?? CONVOCATION_DEFAUT} onChange={convocation => maj({ convocation })} testID="esport-formulaire-convocation" />
        ) : null}
        {!serie && membres.length ? <Text style={attenue}>Cette liste ne vaut que pour cette date : les autres gardent celle de la série.</Text> : null}
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={enCours ? 'Enregistrement…' : 'Enregistrer'} variante="plein" desactive={Boolean(enCours) || !pret} onPress={() => void enregistrer()} testID="esport-formulaire-enregistrer" />
          <BoutonHub
            theme={theme}
            titre="Annuler"
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
      <Intertitre theme={theme}>Calendrier (iCal)</Intertitre>
      <Text style={attenue}>Exportez le planning (.ics) ou abonnez votre calendrier (iPhone, Google, Outlook) à un lien privé, révocable à tout moment.</Text>
      <View style={styles.ligne}>
        {onExporter ? (
          <BoutonHub
            theme={theme}
            titre="Exporter (.ics)"
            onPress={() =>
              void agir('Export', async () => {
                const f = await api.exportIcs();
                return (await onExporter(f.nom, f.contenu, 'text/calendar')) ? 'Calendrier exporté.' : undefined;
              })
            }
            testID="esport-ical-exporter"
          />
        ) : null}
        <BoutonHub
          theme={theme}
          titre="Créer un lien d’abonnement"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('Abonnement', async () => {
              const r = await api.creerAbonnement('Mon calendrier');
              setNouveau(`${adresse}${r.chemin}`);
              await charger();
              return 'Lien créé : il ne sera plus affiché, copiez-le maintenant.';
            })
          }
          testID="esport-ical-creer"
        />
        {abonnements === undefined ? <BoutonHub theme={theme} titre="Mes abonnements" onPress={() => void agir('', charger)} testID="esport-ical-liste" /> : null}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ical" />
      {nouveau ? (
        <View style={{ gap: 6 }}>
          <Text selectable style={{ color: theme.texte, fontSize: 12, ...police(theme.policeChiffres) }} testID="esport-ical-url">
            {nouveau}
          </Text>
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre="Copier" onPress={() => void copier(nouveau)} testID="esport-ical-copier" />
            <Text selectable style={attenue}>
              Sur iPhone : {nouveau.replace(/^https?:/, 'webcal:')}
            </Text>
          </View>
        </View>
      ) : null}
      {abonnements?.map(a => (
        <View key={a.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ color: a.revoque ? theme.attenue : theme.texte, ...police(theme.policeTexte) }}>
            {a.libelle} · {a.revoque ? 'révoqué' : a.dernierAcces ? `lu le ${a.dernierAcces.slice(0, 10)}` : 'jamais lu'}
          </Text>
          {!a.revoque ? (
            <BoutonHub
              theme={theme}
              titre="Révoquer"
              variante="danger"
              onPress={() =>
                void agir('Révocation', async () => {
                  await api.revoquerAbonnement(a.id);
                  await charger();
                  return 'Abonnement révoqué : le lien ne marche plus.';
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

