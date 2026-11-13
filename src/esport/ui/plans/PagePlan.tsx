/**
 * Page d'un plan de match : en-tête de résumé (adversaire, date, format, maps, liens), « Mon rôle » pour le joueur
 * qui lit, veto, une section par map (composition, strats par side et type de round, lineups clés, conditions de
 * victoire, tendances adverses, calls), checklist d'avant-match (cases cochées gardées avec le plan), notes.
 *
 * Le staff (`plans.editer`) change le statut (brouillon → prêt → joué), duplique, enregistre un modèle, lie le
 * résultat et planifie le debrief. Contenu tactique : aucun champ ne passe par l'assistant d'écriture.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChampDate } from '../../../ui/dates/Champs';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import { formaterDate } from '../../i18n';
import { trPm, type ClePm } from '../../i18n/plans';
import { agentDe } from '../../lineups/logique';
import type { ApiPlans, CartePlan, LiensPlan, LigneCompo, Plan } from '../../plans/api';
import { avancementChecklist, avecVeto, ligneRemplie, markdownPlan, monRole, nomLigne, stratsParSide } from '../../plans/logique';
import type { Assets } from '../../strats/assets';
import { BoutonConfirme, Retours, useAgir } from '../commun';
import { Badge, ESP, MenuActions, Pliable, attenue, rayonCarte, texte, titre } from '../design';
import { PastillesFiltre } from '../lineups/Filtres';
import { PucePersonnage, nomSide } from '../lineups/Puces';
import { imprimerNotes, impressionDisponible } from '../review/impression';
import { BadgeStatut, EtiquetteAction, EtiquetteCamp, Section, SousTitre, TexteLibre, jourPlan, quandPlan } from './blocs';

export interface PropsPagePlan {
  theme: ThemeHub;
  api: ApiPlans;
  teamId: string;
  plan: Plan;
  assets: Assets | undefined;
  large: boolean;
  onRetour(): void;
  onModifier(): void;
  /** Le plan a changé (statut, checklist, liens) : la liste se met à jour. */
  onChange(p: Plan): void;
  onSupprime(p: Plan): void;
  /** Une copie (ou un modèle) vient d'être créée. */
  onDuplique(copie: Plan, modele: boolean): void;
  onOuvrirStrat?(id: string): void;
  onOuvrirLineup?(id: string): void;
  onOuvrirEvenement?(evenementId: string, occurrence: string): void;
}

const nomSideOuTous = (side: string) => (side ? nomSide(side) : trPm('strats.side.'));

/** Ligne d'une composition : joueur, personnage, rôle (et l'équipement pour The Finals) ; la ligne du lecteur ressort. */
function LigneCompoLue({ theme, ligne, assets }: { theme: ThemeHub; ligne: LigneCompo; assets: Assets | undefined }) {
  const agent = agentDe(assets, ligne.personnage);
  const equipement = [ligne.arme, ligne.specialisation, ...ligne.gadgets].filter(Boolean);
  const reserve = ligne.reserve.filter(Boolean);
  return (
    <View
      testID={ligne.moi ? 'esport-plan-compo-moi' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, paddingVertical: 6, paddingHorizontal: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: ligne.moi ? theme.accent : 'transparent', backgroundColor: ligne.moi ? teinteTransparente(theme.accent, 0.1) : 'transparent', minWidth: 0 }}>
      {ligne.personnage ? <PucePersonnage agent={agent} nom={ligne.personnage.nom} taille={32} /> : <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.ligne }} />}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '700' }}>
          {nomLigne(ligne) || trPm('compo.joueur.aucun')}
          {ligne.moi ? <Text style={{ ...attenue(theme, 12), fontWeight: '600' }}>{`  (${trPm('compo.moi')})`}</Text> : null}
        </Text>
        <Text style={attenue(theme, 12)}>{[ligne.personnage?.nom, ...equipement].filter(Boolean).join(' · ') || trPm('compo.vide')}</Text>
        {reserve.length ? <Text style={attenue(theme, 12)}>{`${trPm('compo.reserve')} : ${reserve.join(', ')}`}</Text> : null}
        {ligne.note ? <Text style={attenue(theme, 12)}>{ligne.note}</Text> : null}
      </View>
      {ligne.role ? <Badge theme={theme} ton={ligne.moi ? 'accent' : 'neutre'} texte={ligne.role} /> : null}
    </View>
  );
}

/** Section d'une map : tout ce que la team doit savoir pour la jouer. */
function CarteLue({ theme, plan, carte, assets, large, onOuvrirStrat, onOuvrirLineup }: { theme: ThemeHub; plan: Plan; carte: CartePlan; assets: Assets | undefined; large: boolean; onOuvrirStrat?(id: string): void; onOuvrirLineup?(id: string): void }) {
  const compo = carte.compo.filter(ligneRemplie);
  const tendances = (plan.scouting?.tendances ?? []).filter(x => x.map.trim().toLowerCase() === carte.carte.nom.trim().toLowerCase() && (x.notes || x.tauxVictoire !== null));
  const blocTexte = (cle: 'conditions' | 'calls' | 'notes', valeur: string) =>
    valeur.trim() ? (
      <View style={{ gap: 4 }} testID={`esport-plan-${cle}`}>
        <SousTitre theme={theme}>{trPm(cle)}</SousTitre>
        <TexteLibre theme={theme}>{valeur}</TexteLibre>
      </View>
    ) : null;
  const colonneJeu = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      <View style={{ gap: 4 }} testID="esport-plan-compo">
        <SousTitre theme={theme}>{trPm('compo')}</SousTitre>
        {compo.length === 0 ? <Text style={attenue(theme, 13)}>{trPm('compo.vide')}</Text> : compo.map(l => <LigneCompoLue key={l.id} theme={theme} ligne={l} assets={assets} />)}
      </View>
      {blocTexte('calls', carte.calls)}
      {carte.lineups.length ? (
        <View style={{ gap: 6 }} testID="esport-plan-lineups">
          <SousTitre theme={theme}>{trPm('lineups')}</SousTitre>
          {carte.lineups.map(l => {
            const detail = [l.personnage, l.capacite, l.zone].filter(Boolean).join(' · ');
            const ouvrir = l.ouvrable && onOuvrirLineup ? () => onOuvrirLineup(l.id) : undefined;
            return (
              <Pressable
                key={l.id}
                testID={`esport-plan-lineup-${l.id}`}
                accessibilityRole={ouvrir ? 'button' : undefined}
                accessibilityLabel={ouvrir ? trPm('page.lineup.ouvrir', { titre: l.titre }) : undefined}
                disabled={!ouvrir}
                onPress={ouvrir}
                style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 44, paddingHorizontal: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: theme.ligne }}>
                <Icone nom="viseur" taille={16} couleur={theme.attenue} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '600' }}>
                    {l.titre}
                  </Text>
                  {detail ? (
                    <Text numberOfLines={1} style={attenue(theme, 12)}>
                      {detail}
                    </Text>
                  ) : null}
                </View>
                {ouvrir ? <Icone nom="chevron-droite" taille={16} couleur={theme.attenue} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
  const colonnePlan = (
    <View style={{ gap: ESP.m, flex: large ? 1.2 : undefined, minWidth: 0 }}>
      <View style={{ gap: 6 }} testID="esport-plan-strats">
        <SousTitre theme={theme}>{trPm('strats')}</SousTitre>
        {carte.strats.length === 0 ? <Text style={attenue(theme, 13)}>{trPm('strats.vide')}</Text> : null}
        {stratsParSide(carte.strats).map(g => (
          <View key={g.side || '*'} style={{ gap: 4 }}>
            {g.side || carte.strats.some(s => s.side) ? <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{nomSideOuTous(g.side)}</Text> : null}
            {g.strats.map((s, i) => {
              const cible = s.ouvrable ? s.strat : null;
              const ouvrir = cible && onOuvrirStrat ? () => onOuvrirStrat(cible) : undefined;
              return (
                <View key={s.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: ESP.xs, paddingVertical: 4 }}>
                  <Text style={{ ...attenue(theme, 12), width: 18, textAlign: 'right', marginTop: 3 }}>{`${i + 1}.`}</Text>
                  <View style={{ marginTop: 1 }}>
                    <Badge theme={theme} texte={trPm(`strats.type.${s.type}` as ClePm)} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text
                      testID={`esport-plan-strat-${s.id}`}
                      accessibilityRole={ouvrir ? 'link' : undefined}
                      accessibilityLabel={ouvrir ? trPm('page.strat.ouvrir', { titre: s.titre }) : undefined}
                      onPress={ouvrir}
                      style={{ ...texte(theme, 14), fontWeight: '600', textDecorationLine: ouvrir ? 'underline' : 'none' }}>
                      {s.titre}
                    </Text>
                    {s.note ? <Text style={attenue(theme, 12)}>{s.note}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {blocTexte('conditions', carte.conditions)}
      {carte.tendances.trim() || tendances.length ? (
        <View style={{ gap: 4 }} testID="esport-plan-tendances">
          <SousTitre theme={theme}>{trPm('tendances')}</SousTitre>
          {carte.tendances.trim() ? <TexteLibre theme={theme}>{carte.tendances}</TexteLibre> : null}
          {tendances.length ? (
            <View testID="esport-plan-tendances-scouting" style={{ gap: 4, padding: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: theme.ligne }}>
              <Text style={{ ...attenue(theme, 12), fontWeight: '700' }}>{trPm('page.scouting.map', { map: carte.carte.nom })}</Text>
              {tendances.map((x, i) => (
                <Text key={i} style={texte(theme, 13)}>
                  <Text style={{ fontWeight: '700' }}>{trPm(`page.scouting.side.${x.side}` as ClePm)}</Text>
                  {x.tauxVictoire !== null ? ` · ${trPm('page.scouting.taux', { n: x.tauxVictoire })}` : ''}
                  {x.notes ? ` : ${x.notes}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {blocTexte('notes', carte.notes)}
    </View>
  );
  return (
    <View testID={`esport-plan-carte-${carte.id}`} style={large ? { flexDirection: 'row', gap: ESP.xl, alignItems: 'flex-start' } : { gap: ESP.m }}>
      {colonneJeu}
      {colonnePlan}
    </View>
  );
}

export function PagePlan({ theme, api, teamId, plan, assets, large, onRetour, onModifier, onChange, onSupprime, onDuplique, onOuvrirStrat, onOuvrirLineup, onOuvrirEvenement }: PropsPagePlan) {
  const { enCours, erreur, avis, agir } = useAgir();
  const [carteId, setCarteId] = useState<string | undefined>(plan.contenu.cartes[0]?.id);
  const [liens, setLiens] = useState<LiensPlan | undefined>();
  const [debrief, setDebrief] = useState<{ date: string; heureDebut: string; heureFin: string } | undefined>();
  const editer = plan.moi.editer;
  const carte = plan.contenu.cartes.find(c => c.id === carteId) ?? plan.contenu.cartes[0];
  useEffect(() => {
    if (!plan.contenu.cartes.some(c => c.id === carteId)) setCarteId(plan.contenu.cartes[0]?.id);
  }, [plan.contenu.cartes, carteId]);
  // Résultats à lier : chargés seulement quand le plan est joué et sans résultat (staff).
  const aLier = editer && plan.statut === 'joue' && !plan.resultat && !plan.estModele;
  useEffect(() => {
    if (!aLier || liens) return;
    let vivant = true;
    api.liens(teamId).then(l => vivant && setLiens(l), () => undefined);
    return () => {
      vivant = false;
    };
  }, [aLier, liens, api, teamId]);

  const role = useMemo(() => monRole(plan), [plan]);
  const coches = useMemo(() => new Set(plan.coches), [plan.coches]);
  const avancement = avancementChecklist(plan.contenu, plan.coches);
  const quand = quandPlan(plan);

  const changerStatut = (statut: Plan['statut']) =>
    void agir('statut', async () => {
      onChange(await api.modifier(teamId, plan.id, { statut }));
      return statut === 'pret' ? trPm('page.pret.fait') : statut === 'joue' ? trPm('page.joue.fait') : undefined;
    });
  const cocher = (id: string) => {
    const suivantes = coches.has(id) ? plan.coches.filter(x => x !== id) : [...plan.coches, id];
    // Affiché tout de suite, corrigé si le serveur refuse.
    onChange({ ...plan, coches: suivantes });
    void agir('coche', async () => {
      try {
        onChange(await api.cocher(teamId, plan.id, suivantes));
      } catch (e) {
        onChange(plan);
        throw e;
      }
    });
  };
  const dupliquer = (modele: boolean) =>
    void agir('copie', async () => {
      const copie = await api.dupliquer(teamId, plan.id, { modele, titre: modele ? plan.titre : trPm('page.copie', { titre: plan.titre }) });
      onDuplique(copie, modele);
      return modele ? trPm('page.modele.fait') : undefined;
    });
  const imprimer = () =>
    void agir('impression', async () => {
      const md = markdownPlan(
        plan,
        {
          contre: nom => trPm('contre', { nom }),
          statut: s => trPm(`statut.${s}` as ClePm),
          format: f => trPm(`format.${f}` as ClePm),
          action: a => trPm(`veto.action.${a}` as ClePm),
          camp: c => trPm(`veto.camp.${c}` as ClePm),
          type: t => trPm(`strats.type.${t}` as ClePm),
          side: nomSideOuTous,
          titres: { veto: trPm('veto'), compo: trPm('compo'), strats: trPm('strats'), lineups: trPm('lineups'), conditions: trPm('conditions'), tendances: trPm('tendances'), calls: trPm('calls'), notes: trPm('notes'), checklist: trPm('checklist'), replis: trPm('imp.replis'), reserve: trPm('imp.reserve'), scouting: '' },
        },
        quand,
      );
      return (await imprimerNotes(plan.titre, md)) ? trPm('page.imprimer.ouvert') : trPm('page.imprimer.indisponible');
    });

  const actionPrincipale = !editer || plan.estModele ? null : plan.statut === 'brouillon' ? (
    <BoutonHub theme={theme} titre={trPm('page.pret')} variante="plein" icone="coche" desactive={Boolean(enCours)} onPress={() => changerStatut('pret')} testID="esport-plan-pret" />
  ) : plan.statut === 'pret' ? (
    <BoutonHub theme={theme} titre={trPm('page.joue')} variante="plein" icone="drapeau" desactive={Boolean(enCours)} onPress={() => changerStatut('joue')} testID="esport-plan-joue" />
  ) : null;
  const resultats = (liens?.resultats ?? []).map(r => ({ id: r.id, nom: `${formaterDate(`${r.date}T12:00:00.000Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${r.adversaire || '?'}`, detail: [r.issue ? trPm(`page.resultat.${r.issue}` as ClePm) : '', r.score].filter(Boolean).join(' ') }));

  return (
    <View testID="esport-plan" style={{ gap: ESP.m }}>
      <View style={{ flexDirection: 'row' }}>
        <BoutonHub theme={theme} titre={trPm('retour')} icone="chevron-gauche" onPress={onRetour} testID="esport-plan-retour" />
      </View>

      {/* En-tête de résumé */}
      <View testID="esport-plan-resume" style={{ gap: ESP.s, padding: large ? ESP.l : ESP.m, borderRadius: rayonCarte(theme), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1, minWidth: 0, gap: 4, flexBasis: large ? undefined : '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
              <BadgeStatut theme={theme} statut={plan.statut} testID="esport-plan-statut" />
              {plan.estModele ? <Badge theme={theme} ton="accent" texte={trPm('page.modele.badge')} /> : null}
              {plan.format ? <Badge theme={theme} texte={trPm(`format.${plan.format}` as ClePm)} /> : null}
            </View>
            <Text accessibilityRole="header" testID="esport-plan-titre" style={titre(theme, large ? 26 : 21)}>
              {plan.adversaire?.nom ? trPm('contre', { nom: plan.adversaire.nom }).replace(/^./, c => c.toUpperCase()) : plan.titre}
            </Text>
            {plan.adversaire?.nom ? <Text style={attenue(theme, 13)}>{plan.titre}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Icone nom="calendrier" taille={15} couleur={theme.attenue} />
              <Text testID="esport-plan-date" style={{ ...texte(theme, 14), fontWeight: '600' }}>
                {quand ?? trPm('sans_date')}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap', maxWidth: '100%' }}>
            {actionPrincipale}
            {editer ? <BoutonHub theme={theme} titre={trPm('page.modifier')} icone="crayon" onPress={onModifier} testID="esport-plan-modifier" /> : null}
            {!editer && impressionDisponible ? <BoutonHub theme={theme} titre={trPm('page.imprimer')} icone="document" onPress={imprimer} testID="esport-plan-imprimer" /> : null}
            {editer ? (
              <MenuActions
                theme={theme}
                testID="esport-plan-menu"
                actions={[
                  plan.statut !== 'brouillon' && !plan.estModele && { titre: trPm('page.brouillon'), onPress: () => changerStatut('brouillon'), testID: 'esport-plan-brouillon' },
                  plan.statut === 'joue' && !plan.estModele && { titre: trPm('page.pret'), onPress: () => changerStatut('pret'), testID: 'esport-plan-repret' },
                  { titre: trPm('page.dupliquer'), onPress: () => dupliquer(false), testID: 'esport-plan-dupliquer' },
                  !plan.estModele && { titre: trPm('page.modele'), onPress: () => dupliquer(true), testID: 'esport-plan-en-modele' },
                  impressionDisponible && { titre: trPm('page.imprimer'), onPress: imprimer, testID: 'esport-plan-imprimer' },
                ]}
              />
            ) : null}
          </View>
        </View>
        {plan.contenu.cartes.length ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} testID="esport-plan-maps">
            {plan.contenu.cartes.map((c, i) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: theme.ligne }}>
                <Text style={attenue(theme, 11)}>{i + 1}</Text>
                <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{c.carte.nom}</Text>
                {c.mode ? <Text style={attenue(theme, 12)}>{nomSide(c.mode)}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {editer && plan.statut === 'brouillon' && !plan.estModele ? (
          <Text testID="esport-plan-brouillon-aide" style={attenue(theme, 12)}>
            {`${trPm('page.lecture')} ${trPm('page.pret.aide')}`}
          </Text>
        ) : null}
        {plan.evenement || plan.tournoiMatch || plan.resultat || plan.debrief ? (
          <View style={{ flexDirection: 'row', gap: ESP.m, flexWrap: 'wrap', alignItems: 'center', paddingTop: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            {plan.evenement ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}>
                <Text style={attenue(theme, 12)}>{`${trPm('page.evenement')} : `}</Text>
                <Text style={{ ...texte(theme, 13), fontWeight: '600', flexShrink: 1 }}>{plan.evenement.titre}</Text>
                {onOuvrirEvenement ? <BoutonHub theme={theme} titre={trPm('page.evenement.ouvrir')} icone="calendrier" onPress={() => plan.evenement && onOuvrirEvenement(plan.evenement.id, plan.evenement.occurrence)} testID="esport-plan-evenement" /> : null}
              </View>
            ) : null}
            {plan.tournoiMatch ? <Text style={texte(theme, 13)}>{`${trPm('page.tournoi')} : ${[plan.tournoiMatch.tournoi, plan.tournoiMatch.tour].filter(Boolean).join(' · ')}`}</Text> : null}
            {plan.resultat ? (
              <View testID="esport-plan-resultat" style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
                <Text style={attenue(theme, 12)}>{`${trPm('page.resultat')} : `}</Text>
                {plan.resultat.issue ? <Badge theme={theme} ton={plan.resultat.issue === 'victoire' ? 'ok' : plan.resultat.issue === 'defaite' ? 'critique' : 'neutre'} texte={trPm(`page.resultat.${plan.resultat.issue}` as ClePm)} /> : null}
                {plan.resultat.score ? <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{plan.resultat.score}</Text> : null}
              </View>
            ) : null}
            {plan.debrief ? (
              <Text testID="esport-plan-debrief-prevu" style={texte(theme, 13)}>
                {trPm('page.debrief.prevu', { date: formaterDate(plan.debrief.debut, { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-plan" />

      {/* Après le match (staff) : résultat à lier, debrief à planifier */}
      {editer && plan.statut === 'joue' && !plan.estModele && (!plan.resultat || !plan.debrief) ? (
        <Section theme={theme} titre={trPm('statut.joue')} testID="esport-plan-apres">
          {!plan.resultat ? (
            resultats.length ? (
              <SelecteurRepliable theme={theme} libelle={trPm('page.resultat.choisir')} options={resultats} valeur={undefined} vide={trPm('page.resultat.lier')} onChoisir={id => void agir('resultat', async () => onChange(await api.modifier(teamId, plan.id, { resultatId: id })))} testID="esport-plan-resultat-choix" style={{ maxWidth: 520 }} />
            ) : (
              <Text style={attenue(theme, 13)}>{trPm('page.resultat.aucun')}</Text>
            )
          ) : null}
          {!plan.debrief && plan.moi.debrief ? (
            debrief ? (
              <View testID="esport-plan-debrief-formulaire" style={{ gap: ESP.xs }}>
                <Text style={attenue(theme, 12)}>{trPm('page.debrief.aide')}</Text>
                <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <ChampDate theme={theme} libelle={trPm('page.debrief.date')} valeur={debrief.date} onChanger={date => setDebrief(d => (d ? { ...d, date } : d))} effacable={false} style={{ flexGrow: 1, minWidth: 150, maxWidth: 240 }} testID="esport-plan-debrief-date" />
                  <Champ theme={theme} libelle={trPm('page.debrief.debut')} valeur={debrief.heureDebut} onChanger={v => setDebrief(d => (d ? { ...d, heureDebut: v } : d))} maxLength={5} style={{ width: 130 }} testID="esport-plan-debrief-debut" />
                  <Champ theme={theme} libelle={trPm('page.debrief.fin')} valeur={debrief.heureFin} onChanger={v => setDebrief(d => (d ? { ...d, heureFin: v } : d))} maxLength={5} style={{ width: 130 }} testID="esport-plan-debrief-fin" />
                </View>
                <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
                  <BoutonHub
                    theme={theme}
                    titre={trPm('page.debrief.ok')}
                    variante="plein"
                    desactive={Boolean(enCours) || !debrief.date}
                    onPress={() =>
                      void agir('debrief', async () => {
                        onChange(await api.debrief(teamId, plan.id, debrief));
                        setDebrief(undefined);
                        return trPm('page.debrief.fait');
                      })
                    }
                    testID="esport-plan-debrief-ok"
                  />
                  <BoutonHub theme={theme} titre={trPm('annuler')} onPress={() => setDebrief(undefined)} testID="esport-plan-debrief-annuler" />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row' }}>
                <BoutonHub theme={theme} titre={trPm('page.debrief.creer')} icone="calendrier" onPress={() => setDebrief({ date: '', heureDebut: '20:00', heureFin: '21:00' })} testID="esport-plan-debrief" />
              </View>
            )
          ) : null}
        </Section>
      ) : null}

      {/* Vue du joueur : ce qu'il joue, map par map */}
      {role.length ? (
        <Section theme={theme} titre={trPm('page.mon_role')} aide={trPm('page.mon_role.aide')} accent={theme.accent} testID="esport-plan-mon-role">
          <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
            {role.map((r, i) => (
              <Pressable key={`${r.carteId}-${i}`} accessibilityRole="button" accessibilityLabel={`${r.carte} : ${[r.personnage, r.role].filter(Boolean).join(', ')}`} onPress={() => setCarteId(r.carteId)} testID={`esport-plan-mon-role-${r.carteId}`} style={{ flexGrow: 1, flexBasis: 180, maxWidth: 320, gap: 2, padding: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.surface }}>
                <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{r.carte}</Text>
                <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{[r.personnage, r.role].filter(Boolean).join(' · ') || trPm('compo.vide')}</Text>
                {[r.arme, r.specialisation, ...r.gadgets].filter(Boolean).length ? <Text style={attenue(theme, 12)}>{[r.arme, r.specialisation, ...r.gadgets].filter(Boolean).join(' · ')}</Text> : null}
                {r.note ? <Text style={attenue(theme, 12)}>{r.note}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      {avecVeto(plan.modele) && plan.contenu.veto.length ? (
        <Section theme={theme} titre={trPm('veto')} testID="esport-plan-veto">
          <View style={{ gap: 6 }}>
            {plan.contenu.veto.map((v, i) => (
              <View key={v.id} testID={`esport-plan-veto-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
                <Text style={{ ...attenue(theme, 12), width: 18, textAlign: 'right' }}>{`${i + 1}.`}</Text>
                <EtiquetteCamp theme={theme} camp={v.camp} />
                <EtiquetteAction theme={theme} action={v.action} />
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{v.carte?.nom ?? trPm('veto.carte.libre')}</Text>
                {v.replis.length ? <Text style={attenue(theme, 12)}>{`${trPm('veto.replis')} : ${v.replis.map(r => r.nom).join(', ')}`}</Text> : null}
                {v.note ? <Text style={{ ...attenue(theme, 12), flexShrink: 1 }}>{v.note}</Text> : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Maps */}
      {plan.contenu.cartes.length === 0 ? (
        <Section theme={theme} titre={trPm('page.maps')} testID="esport-plan-sans-map">
          <Text style={attenue(theme, 13)}>{trPm('page.sans_map')}</Text>
        </Section>
      ) : carte ? (
        <Section
          theme={theme}
          titre={`${carte.carte.nom}${carte.mode ? ` · ${nomSide(carte.mode)}` : ''}`}
          testID="esport-plan-carte"
          action={
            plan.contenu.cartes.length > 1 ? (
              <PastillesFiltre theme={theme} libelle={trPm('page.maps')} valeur={carte.id} tout="" sansTout dense={large} options={plan.contenu.cartes.map(c => ({ id: c.id, nom: c.carte.nom }))} onChoisir={id => setCarteId(id)} testID="esport-plan-onglet" />
            ) : undefined
          }>
          <CarteLue theme={theme} plan={plan} carte={carte} assets={assets} large={large} onOuvrirStrat={onOuvrirStrat} onOuvrirLineup={onOuvrirLineup} />
        </Section>
      ) : null}

      {plan.contenu.checklist.length ? (
        <Section theme={theme} titre={trPm('checklist')} aide={trPm('page.checklist.avancement', avancement)} testID="esport-plan-checklist">
          <View style={{ gap: 2 }}>
            {plan.contenu.checklist.map(e => {
              const fait = coches.has(e.id);
              return (
                <Pressable
                  key={e.id}
                  testID={`esport-plan-coche-${e.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: fait, disabled: !editer }}
                  accessibilityLabel={trPm('page.checklist.cocher', { texte: e.texte })}
                  disabled={!editer}
                  onPress={() => cocher(e.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 44 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: fait ? theme.ok : theme.attenue, backgroundColor: fait ? teinteTransparente(theme.ok, 0.2) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{fait ? <Icone nom="coche" taille={14} couleur={theme.ok} /> : null}</View>
                  <Text style={{ ...texte(theme, 14), flex: 1, textDecorationLine: fait ? 'line-through' : 'none', opacity: fait ? 0.7 : 1 }}>{e.texte}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>
      ) : null}

      {plan.contenu.notes.trim() ? (
        <Section theme={theme} titre={trPm('notes.globales')} testID="esport-plan-notes">
          <TexteLibre theme={theme}>{plan.contenu.notes}</TexteLibre>
        </Section>
      ) : null}

      {plan.scouting?.notes.trim() ? (
        <Pliable theme={theme} titre={trPm('page.scouting', { nom: plan.scouting.nom })} testID="esport-plan-scouting-ouvrir">
          <View testID="esport-plan-scouting" style={{ gap: 4, padding: ESP.m, borderRadius: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
            <SousTitre theme={theme}>{trPm('page.scouting.notes')}</SousTitre>
            <TexteLibre theme={theme}>{plan.scouting.notes}</TexteLibre>
          </View>
        </Pliable>
      ) : null}

      <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={attenue(theme, 12)}>{trPm('page.maj', { date: formaterDate(plan.majLe, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</Text>
        {editer ? (
          <BoutonConfirme
            theme={theme}
            titre={trPm('page.supprimer')}
            confirmation={trPm('page.supprimer.confirmer')}
            desactive={Boolean(enCours)}
            onConfirme={() =>
              void agir('suppression', async () => {
                await api.supprimer(teamId, plan.id);
                onSupprime(plan);
              })
            }
            testID="esport-plan-supprimer"
          />
        ) : null}
      </View>
    </View>
  );
}

/** Jour d'un plan pour une carte de liste (« 14 nov. ») ; exporté pour l'accueil de la team. */
export const jourCourt = (dateMatch: string | null) => jourPlan(dateMatch, { day: 'numeric', month: 'short' });
