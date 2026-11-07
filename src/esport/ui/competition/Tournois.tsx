/**
 * Module « Tournois » (section Compétition) : liste des tournois de la team, fiche (infos, inscription et
 * check-in, roster, parcours saisi à la main, classement final et gains) et formulaires. Tout suit le
 * profil du jeu de la team (formats, BO, taille du roster) ; le serveur valide et décide des droits.
 *
 * Un match daté passe au planning (événement « Tournoi » convoquant le roster) : réponses, rappels et
 * présence s'y font comme d'habitude. Le résultat d'un match se saisit en rapide ici, ou en détaillé
 * dans le module Résultats (« Saisir le résultat détaillé »).
 *
 * Tournoi organisé par le club (ex. The Nuke End) : « Équipes et rôles Discord » (EquipesDiscord.tsx) note les équipes
 * participantes, les importe des tickets d'inscription et crée un rôle Discord par équipe.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { apiCompetition, STATUTS_TOURNOI, TYPES_PHASE, type ApiCompetition, type DetailTournoi, type IssueRapide, type ListeTournois, type MatchTournoi, type SaisieMatch, type SaisieTournoi, type StatutTournoi, type TournoiListe, type TypePhase } from '../../competition/api';
import { demander, prendre } from '../../competition/intention';
import { nomStatutTournoi, ordinal } from '../../competition/libelles';
import { formaterDate, localeCourante } from '../../i18n';
import { trC, trnC } from '../../i18n/competition';
import { BoutonConfirme, Choix, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, Onglets, SqueletteCartes, TitreCarte, Volet, attenue, texte, type Ton } from '../design';
import type { PropsModule } from '../modules';
import { BadgeResultat, ChoixAdversaires, Info, LogoAdversaire, Pastille, instantSaisi, montant, murale, nomsAdversaires } from './commun';
import { useTempsReel } from '../../tempsReel/hooks';
import type { ClientEsport } from '../../client';
import { EquipesDiscord } from './EquipesDiscord';

type Filtre = 'actifs' | 'termines' | 'tous';
const TON_STATUT: Record<StatutTournoi, Ton> = { a_venir: 'neutre', inscrit: 'accent', en_cours: 'alerte', termine: 'ok', annule: 'critique' };
const ISSUES_RAPIDES: readonly IssueRapide[] = ['victoire', 'defaite', 'nul', 'forfait_pour', 'forfait_contre'];

const jourLisible = (d: string | null, fuseau = 'UTC'): string => (d ? formaterDate(`${d}T12:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric', timeZone: fuseau }) : '');
const instantLisible = (iso: string | null, fuseau: string): string => (iso ? formaterDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fuseau }) : '');
const dates = (t: { debut: string | null; fin: string | null }): string => (t.debut ? (t.fin && t.fin !== t.debut ? trC('t.du_au', { debut: jourLisible(t.debut), fin: jourLisible(t.fin) }) : jourLisible(t.debut)) : trC('t.dates_a_venir'));

export function Tournois({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const fuseau = detail.team.fuseau;
  const api = useMemo(() => apiCompetition(client), [client]);
  const [liste, setListe] = useState<ListeTournois | undefined>();
  const [filtre, setFiltre] = useState<Filtre>('actifs');
  const [ouvert, setOuvert] = useState<string | undefined>(() => prendre(teamId, 'tournoi')?.id);
  const [edition, setEdition] = useState<{ tournoi?: DetailTournoi['tournoi'] } | null>(null);
  const { erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setListe(await api.tournois(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  useTempsReel(client, `team:${teamId}:tournois`, () => void recharger().catch(() => undefined));
  const tournois = (liste?.tournois ?? []).filter(t => (filtre === 'tous' ? true : filtre === 'termines' ? t.statut === 'termine' || t.statut === 'annule' : t.statut !== 'termine' && t.statut !== 'annule'));
  const gerer = Boolean(liste?.droits.gerer);
  return (
    <View style={{ gap: ESP.l }} testID="esport-tournois">
      <EnTetePage
        theme={theme}
        large={large}
        titre={trC('t.titre')}
        sous={liste ? trC('t.sous', { jeu: liste.jeu.nom }) : undefined}
        action={gerer ? <BoutonHub theme={theme} titre={trC('t.nouveau')} variante="plein" onPress={() => setEdition({})} testID="esport-tournois-nouveau" /> : undefined}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tournois" />
      <Onglets
        theme={theme}
        prefixe="esport-tournois-filtre"
        testID="esport-tournois-filtres"
        actif={filtre}
        onChoisir={id => setFiltre(id as Filtre)}
        pleineLargeur={!large}
        entrees={[
          { id: 'actifs', libelle: trC('t.filtre.actifs') },
          { id: 'termines', libelle: trC('t.filtre.termines') },
          { id: 'tous', libelle: trC('t.filtre.tous') },
        ]}
      />
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && tournois.length === 0 ? (
        <Carte theme={theme} testID="esport-tournois-vide">
          <EtatVide theme={theme} glyphe="♛" titre={trC('t.vide.titre')} texte={gerer ? trC('t.vide.texte_gerer') : trC('t.vide.texte')} action={gerer ? { titre: trC('t.nouveau'), onPress: () => setEdition({}), testID: 'esport-tournois-vide-nouveau' } : undefined} />
        </Carte>
      ) : null}
      {tournois.length ? (
        <Grille min={large ? 320 : 280} testID="esport-tournois-liste">
          {tournois.map(t => (
            <CarteTournoi key={t.id} theme={theme} t={t} fuseau={fuseau} onOuvrir={() => setOuvert(t.id)} />
          ))}
        </Grille>
      ) : null}
      {ouvert ? (
        <FicheTournoi
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          id={ouvert}
          fuseau={fuseau}
          large={large}
          onFermer={() => setOuvert(undefined)}
          onChange={() => void recharger()}
          onModifier={t => {
            setOuvert(undefined);
            setEdition({ tournoi: t });
          }}
          onResultat={matchId => {
            demander({ genre: 'resultat-match', teamId, matchId });
            setOuvert(undefined);
            onAller('module:resultats');
          }}
          onPlanning={() => onAller('module:planning')}
        />
      ) : null}
      {edition && liste ? (
        <FormulaireTournoi
          theme={theme}
          api={api}
          teamId={teamId}
          liste={liste}
          fuseau={fuseau}
          large={large}
          existant={edition.tournoi}
          onFermer={() => setEdition(null)}
          onEnregistre={id => {
            setEdition(null);
            void recharger();
            setOuvert(id);
          }}
        />
      ) : null}
    </View>
  );
}

function CarteTournoi({ theme, t, fuseau, onOuvrir }: { theme: ThemeHub; t: TournoiListe; fuseau: string; onOuvrir(): void }) {
  return (
    <Carte theme={theme} dense onPress={onOuvrir} libelle={trC('t.ouvrir', { nom: t.nom })} testID={`esport-tournoi-${t.id}`} accent={t.statut === 'en_cours' ? theme.alerte : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.s, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
            {t.nom}
          </Text>
          <Text style={attenue(theme)} numberOfLines={1}>
            {[dates(t), t.organisateur].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Badge theme={theme} ton={TON_STATUT[t.statut]} texte={nomStatutTournoi(t.statut)} testID={`esport-tournoi-${t.id}-statut`} />
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {t.format ? <Badge theme={theme} texte={[t.format.libelle, t.bo ? `BO${t.bo}` : null].filter(Boolean).join(' · ')} /> : null}
        {t.roster.length ? <Badge theme={theme} texte={trnC('t.roster_n', t.roster.length)} /> : null}
        {t.bilan.joues ? <Badge theme={theme} texte={trC('t.bilan_court', { v: t.bilan.victoires, d: t.bilan.defaites })} /> : null}
        {t.classementFinal ? <Badge theme={theme} ton={t.classementFinal <= 3 ? 'ok' : 'neutre'} texte={t.participants ? trC('t.place_sur', { place: ordinal(t.classementFinal), n: t.participants }) : ordinal(t.classementFinal)} /> : null}
      </View>
      {t.prochainMatch ? (
        <Text style={texte(theme, 13)} numberOfLines={2}>
          {trC('t.prochain', { quand: instantLisible(t.prochainMatch.debut, fuseau), adversaire: nomsAdversaires(t.prochainMatch.adversaires) || trC('t.adversaire_a_venir') })}
        </Text>
      ) : null}
    </Carte>
  );
}

// ---------------------------------------------------------------- Fiche

function FicheTournoi({
  theme,
  client,
  api,
  teamId,
  id,
  fuseau,
  large,
  onFermer,
  onChange,
  onModifier,
  onResultat,
  onPlanning,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  api: ApiCompetition;
  teamId: string;
  id: string;
  fuseau: string;
  large: boolean;
  onFermer(): void;
  onChange(): void;
  onModifier(t: DetailTournoi['tournoi']): void;
  onResultat(matchId: string): void;
  onPlanning(): void;
}) {
  const [d, setD] = useState<DetailTournoi | undefined>();
  const [ajout, setAjout] = useState(false);
  const [rosterOuvert, setRosterOuvert] = useState(false);
  const [classementOuvert, setClassementOuvert] = useState(false);
  const { erreur, avis, agir, enCours } = useAgir();
  const recharger = useCallback(async () => setD(await api.tournoi(teamId, id)), [api, teamId, id]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Écrit, recharge la fiche ; un match gardé sans événement au planning le dit (module absent, permission).
  const faire = (cle: string, action: () => Promise<DetailTournoi>, message?: string) =>
    agir(cle, async () => {
      const r = await action();
      setD(r);
      onChange();
      const alerte = r.planning?.raison ? trC(`t.planning.${r.planning.raison}` as 't.planning.module') : r.avertissements?.length ? trC('t.planning.permission') : '';
      return [message, alerte].filter(Boolean).join(' ') || undefined;
    });
  const t = d?.tournoi;
  const gerer = Boolean(d?.droits.gerer);
  const phases = new Map((t?.phases ?? []).map(p => [p.cle, p]));
  const groupes = useMemo(() => {
    const g = new Map<string, MatchTournoi[]>();
    for (const m of d?.matchs ?? []) {
      const cle = m.phase ?? '';
      g.set(cle, [...(g.get(cle) ?? []), m]);
    }
    return [...g.entries()];
  }, [d]);
  return (
    <Volet theme={theme} visible titre={t?.nom ?? trC('t.titre')} onFermer={onFermer} testID="esport-tournoi-fiche" largeur={large ? 720 : 560}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tournoi" />
      {!t ? null : (
        <>
          <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'center' }]}>
            <Badge theme={theme} ton={TON_STATUT[t.statut]} texte={nomStatutTournoi(t.statut)} testID="esport-tournoi-statut" />
            {t.format ? <Badge theme={theme} texte={[t.format.libelle, t.bo ? `BO${t.bo}` : null].filter(Boolean).join(' · ')} /> : null}
            {t.checkin.faitLe ? <Badge theme={theme} ton="ok" texte={trC('t.checkin_fait')} testID="esport-tournoi-checkin-fait" /> : null}
            {!t.publiable ? <Badge theme={theme} texte={trC('t.non_publiable')} /> : null}
          </View>
          {gerer ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={trC('t.modifier')} onPress={() => onModifier(t)} testID="esport-tournoi-modifier" />
              {t.statut !== 'termine' && t.statut !== 'annule' ? (
                t.inscription.inscritLe ? (
                  <>
                    {!t.checkin.faitLe ? <BoutonHub theme={theme} titre={trC('t.checkin')} variante="plein" desactive={Boolean(enCours)} onPress={() => void faire('checkin', () => api.checkin(teamId, id), trC('t.checkin_ok'))} testID="esport-tournoi-checkin" /> : null}
                    <BoutonHub theme={theme} titre={trC('t.desinscrire')} desactive={Boolean(enCours)} onPress={() => void faire('inscription', () => api.inscrire(teamId, id, true))} testID="esport-tournoi-desinscrire" />
                  </>
                ) : (
                  <BoutonHub theme={theme} titre={trC('t.inscrire')} variante="plein" desactive={Boolean(enCours)} onPress={() => void faire('inscription', () => api.inscrire(teamId, id), trC('t.inscrit_ok'))} testID="esport-tournoi-inscrire" />
                )
              ) : null}
              {t.lien ? <BoutonHub theme={theme} titre={trC('t.ouvrir_lien')} onPress={() => void Linking.openURL(t.lien!)} testID="esport-tournoi-lien" /> : null}
            </View>
          ) : t.lien ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub theme={theme} titre={trC('t.ouvrir_lien')} onPress={() => void Linking.openURL(t.lien!)} testID="esport-tournoi-lien" />
            </View>
          ) : null}

          <Panneau theme={theme} testID="esport-tournoi-infos">
            <Info theme={theme} libelle={trC('t.champ.organisateur')} valeur={t.organisateur} />
            <Info theme={theme} libelle={trC('t.champ.dates')} valeur={dates(t)} />
            <Info theme={theme} libelle={trC('t.champ.lieu')} valeur={t.enLigne ? trC('t.en_ligne') : t.lieu} />
            <Info theme={theme} libelle={trC('t.champ.phases')} valeur={t.phases.map(p => `${p.nom || trC(`t.phase.${p.type}` as 't.phase.poules')}`).join(' → ')} />
            <Info theme={theme} libelle={trC('t.champ.frais')} valeur={montant(t.fraisCentimes, t.devise, localeCourante())} />
            <Info theme={theme} libelle={trC('t.champ.cashprize')} valeur={[montant(t.cashprizeCentimes, t.devise, localeCourante()), t.cashprizeDetails].filter(Boolean).join(' · ')} />
            <Info theme={theme} libelle={trC('t.champ.inscription_limite')} valeur={instantLisible(t.inscription.limite, fuseau)} testID="esport-tournoi-inscription-limite" />
            <Info theme={theme} libelle={trC('t.champ.checkin')} valeur={t.checkin.ouverture || t.checkin.limite ? `${instantLisible(t.checkin.ouverture, fuseau)} → ${instantLisible(t.checkin.limite, fuseau)}` : ''} />
            <Info theme={theme} libelle={trC('t.champ.classement')} valeur={t.classementFinal ? (t.participants ? trC('t.place_sur', { place: ordinal(t.classementFinal), n: t.participants }) : ordinal(t.classementFinal)) : ''} testID="esport-tournoi-classement" />
            <Info theme={theme} libelle={trC('t.champ.gains')} valeur={[montant(t.gainsCentimes, t.devise, localeCourante()), t.gainsNotes].filter(Boolean).join(' · ')} />
            {t.notes ? <Text style={texte(theme, 14)}>{t.notes}</Text> : null}
          </Panneau>

          <Carte theme={theme} dense testID="esport-tournoi-roster">
            <TitreCarte
              theme={theme}
              titre={trC('t.roster')}
              sous={trC('t.roster_regle', { min: d!.rosterTaille.titulairesMin, max: d!.rosterTaille.titulairesMax, rempl: d!.rosterTaille.remplacantsMax })}
              droite={gerer ? <BoutonHub theme={theme} titre={rosterOuvert ? trC('t.fermer') : trC('t.modifier_roster')} onPress={() => setRosterOuvert(v => !v)} testID="esport-tournoi-roster-modifier" /> : undefined}
            />
            {rosterOuvert && d ? (
              <EditeurRoster
                theme={theme}
                d={d}
                onEnregistrer={(tit, rem) =>
                  void faire('roster', () => api.roster(teamId, id, tit, rem), trC('t.roster_ok')).then(ok => ok && setRosterOuvert(false))
                }
              />
            ) : t.roster.length ? (
              <View style={[styles.ligne, { gap: ESP.xxs }]}>
                {t.roster.map(r => (
                  <Badge key={r.compte} theme={theme} ton={r.role === 'titulaire' ? 'accent' : 'neutre'} texte={`${r.pseudo ?? trC('t.compte_supprime')}${r.role === 'remplacant' ? ` (${trC('t.remplacant_court')})` : ''}`} />
                ))}
              </View>
            ) : (
              <Text style={attenue(theme, 13)}>{trC('t.roster_vide')}</Text>
            )}
          </Carte>

          <Carte theme={theme} dense testID="esport-tournoi-parcours">
            <TitreCarte
              theme={theme}
              titre={trC('t.parcours')}
              sous={d!.bilan.joues ? trC('t.bilan', { v: d!.bilan.victoires, d: d!.bilan.defaites, n: d!.bilan.nuls }) : undefined}
              droite={gerer ? <BoutonHub theme={theme} titre={ajout ? trC('t.fermer') : trC('t.ajouter_match')} onPress={() => setAjout(v => !v)} testID="esport-tournoi-ajouter-match" /> : undefined}
            />
            {ajout && d ? (
              <FormulaireMatch
                theme={theme}
                api={api}
                teamId={teamId}
                d={d}
                onEnregistrer={corps =>
                  void faire('match', () => api.ajouterMatch(teamId, id, corps), d.modules.planning ? trC('t.match_ok_planning') : trC('t.match_ok')).then(ok => ok && setAjout(false))
                }
              />
            ) : null}
            {groupes.length === 0 ? <Text style={attenue(theme, 13)}>{trC('t.parcours_vide')}</Text> : null}
            {groupes.map(([cle, matchs]) => (
              <View key={cle || 'sans'} style={{ gap: ESP.xs }}>
                {cle ? <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{phases.get(cle)?.nom || trC(`t.phase.${phases.get(cle)?.type ?? 'libre'}` as 't.phase.libre')}</Text> : null}
                {matchs.map(m => (
                  <LigneMatch
                    key={m.id}
                    theme={theme}
                    m={m}
                    d={d!}
                    fuseau={fuseau}
                    onRapide={(issue, scoreTexte) => void faire(`match-${m.id}`, () => api.modifierMatch(teamId, id, m.id, { issue, scoreTexte }))}
                    onAnnuler={() => void faire(`match-${m.id}`, () => api.modifierMatch(teamId, id, m.id, { statut: m.statut === 'annule' ? 'a_jouer' : 'annule' }))}
                    onSupprimer={() => void faire(`match-${m.id}`, () => api.supprimerMatch(teamId, id, m.id))}
                    onResultat={() => onResultat(m.id)}
                    onPlanning={onPlanning}
                  />
                ))}
              </View>
            ))}
          </Carte>

          {gerer ? (
            <Carte theme={theme} dense testID="esport-tournoi-final">
              <TitreCarte theme={theme} titre={trC('t.classement_final')} droite={<BoutonHub theme={theme} titre={classementOuvert ? trC('t.fermer') : trC('t.saisir')} onPress={() => setClassementOuvert(v => !v)} testID="esport-tournoi-final-ouvrir" />} />
              {classementOuvert ? <FormulaireClassement theme={theme} t={t} onEnregistrer={corps => void faire('final', () => api.modifierTournoi(teamId, id, corps), trC('t.enregistre')).then(ok => ok && setClassementOuvert(false))} /> : null}
            </Carte>
          ) : null}

          {/* Équipes participantes et rôles Discord (tournoi organisé par le club : inscriptions par tickets). */}
          {gerer ? <EquipesDiscord theme={theme} client={client} teamId={teamId} tournoiId={id} /> : null}

          {gerer ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonConfirme
                theme={theme}
                titre={trC('t.supprimer')}
                confirmation={trC('t.supprimer_confirmer')}
                onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimerTournoi(teamId, id);
                    onChange();
                    onFermer();
                  })
                }
                testID="esport-tournoi-supprimer"
              />
            </View>
          ) : null}
        </>
      )}
    </Volet>
  );
}

function LigneMatch({
  theme,
  m,
  d,
  fuseau,
  onRapide,
  onAnnuler,
  onSupprimer,
  onResultat,
  onPlanning,
}: {
  theme: ThemeHub;
  m: MatchTournoi;
  d: DetailTournoi;
  fuseau: string;
  onRapide(issue: IssueRapide | null, score: string): void;
  onAnnuler(): void;
  onSupprimer(): void;
  onResultat(): void;
  onPlanning(): void;
}) {
  const [rapide, setRapide] = useState(false);
  const [issue, setIssue] = useState<IssueRapide | ''>(m.issueRapide ?? '');
  const [score, setScore] = useState(m.scoreTexte);
  const gerer = d.droits.gerer;
  const adv = m.adversaires;
  return (
    <View style={{ gap: ESP.xs, padding: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, opacity: m.statut === 'annule' ? 0.6 : 1 }} testID={`esport-match-${m.id}`}>
      <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'center', flexWrap: 'wrap' }}>
        {adv[0] ? <LogoAdversaire theme={theme} nom={adv[0].nom} url={adv[0].logoUrl} /> : null}
        <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={2}>
            {[m.tour || trC('t.match'), nomsAdversaires(adv) ? trC('t.contre', { adversaire: nomsAdversaires(adv) }) : null].filter(Boolean).join(' · ')}
          </Text>
          <Text style={attenue(theme, 12)}>{[instantLisible(m.debut, fuseau) || trC('t.sans_date'), m.bo ? `BO${m.bo}` : null, m.evenementId ? trC('t.au_planning') : null].filter(Boolean).join(' · ')}</Text>
        </View>
        {m.statut === 'annule' ? <Badge theme={theme} ton="critique" texte={trC('t.match_annule')} /> : <BadgeResultat theme={theme} issue={m.issue} place={m.place} score={m.scoreTexte} testID={`esport-match-${m.id}-resultat`} />}
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {d.droits.saisirResultats && d.modules.resultats && !m.aResultat && m.statut !== 'annule' ? <BoutonHub theme={theme} titre={trC('t.resultat_detaille')} onPress={onResultat} testID={`esport-match-${m.id}-detaille`} /> : null}
        {m.evenementId && d.droits.planning ? <BoutonHub theme={theme} titre={trC('t.voir_planning')} onPress={onPlanning} testID={`esport-match-${m.id}-planning`} /> : null}
        {gerer && !m.aResultat && m.statut !== 'annule' ? <BoutonHub theme={theme} titre={trC('t.resultat_rapide')} onPress={() => setRapide(v => !v)} testID={`esport-match-${m.id}-rapide`} /> : null}
        {gerer ? <BoutonHub theme={theme} titre={m.statut === 'annule' ? trC('t.retablir') : trC('t.annuler_match')} onPress={onAnnuler} testID={`esport-match-${m.id}-annuler`} /> : null}
        {gerer ? <BoutonConfirme theme={theme} titre={trC('t.retirer')} confirmation={trC('t.retirer_confirmer')} onConfirme={onSupprimer} testID={`esport-match-${m.id}-supprimer`} /> : null}
      </View>
      {rapide ? (
        <View style={{ gap: ESP.xs }}>
          <Choix<IssueRapide | ''> theme={theme} libelle={trC('t.resultat')} valeur={issue} options={[{ id: '', nom: trC('t.pas_encore') }, ...ISSUES_RAPIDES.map(i => ({ id: i, nom: trC(`t.issue.${i}` as 't.issue.victoire') }))]} onChoisir={setIssue} testID={`esport-match-${m.id}-issue`} />
          <Champ theme={theme} libelle={trC('t.score_texte')} valeur={score} onChanger={setScore} maxLength={20} placeholder="2-1" testID={`esport-match-${m.id}-score`} />
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={trC('t.enregistrer')}
              variante="plein"
              onPress={() => {
                onRapide(issue || null, score);
                setRapide(false);
              }}
              testID={`esport-match-${m.id}-rapide-enregistrer`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function EditeurRoster({ theme, d, onEnregistrer }: { theme: ThemeHub; d: DetailTournoi; onEnregistrer(titulaires: string[], remplacants: string[]): void }) {
  const [roles, setRoles] = useState<Record<string, 'titulaire' | 'remplacant' | ''>>(() => Object.fromEntries(d.tournoi.roster.map(r => [r.compte, r.role])));
  const tit = Object.entries(roles).filter(([, r]) => r === 'titulaire').map(([c]) => c);
  const rem = Object.entries(roles).filter(([, r]) => r === 'remplacant').map(([c]) => c);
  const taille = d.rosterTaille;
  const suivant = (r: string) => (r === '' ? 'titulaire' : r === 'titulaire' ? 'remplacant' : '');
  return (
    <View style={{ gap: ESP.xs }} testID="esport-roster-editeur">
      <Text style={attenue(theme, 13)}>{trC('t.roster_aide')}</Text>
      <View style={[styles.ligne, { gap: ESP.xxs }]}>
        {d.jeu.membres.map(m => {
          const r = roles[m.compte] ?? '';
          return (
            <Pastille
              key={m.compte}
              theme={theme}
              libelle={r ? `${m.pseudo} · ${r === 'titulaire' ? trC('t.titulaire_court') : trC('t.remplacant_court')}` : m.pseudo}
              actif={Boolean(r)}
              couleur={r === 'remplacant' ? theme.attenue : undefined}
              onPress={() => setRoles(x => ({ ...x, [m.compte]: suivant(r) as 'titulaire' | 'remplacant' | '' }))}
              testID={`esport-roster-${m.compte}`}
            />
          );
        })}
      </View>
      <Text style={{ ...texte(theme, 13), color: tit.length > taille.titulairesMax || rem.length > taille.remplacantsMax ? theme.critique : theme.texte }} testID="esport-roster-compte">
        {trC('t.roster_compte', { t: tit.length, tmax: taille.titulairesMax, r: rem.length, rmax: taille.remplacantsMax })}
      </Text>
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} titre={trC('t.enregistrer')} variante="plein" desactive={tit.length > taille.titulairesMax || rem.length > taille.remplacantsMax} onPress={() => onEnregistrer(tit, rem)} testID="esport-roster-enregistrer" />
      </View>
    </View>
  );
}

function FormulaireMatch({ theme, api, teamId, d, onEnregistrer }: { theme: ThemeHub; api: ApiCompetition; teamId: string; d: DetailTournoi; onEnregistrer(corps: SaisieMatch): void }) {
  const [phase, setPhase] = useState<string>(d.tournoi.phases[0]?.cle ?? '');
  const [tour, setTour] = useState('');
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('20:00');
  const [duree, setDuree] = useState('90');
  const [adversaires, setAdversaires] = useState<Array<{ id?: string; nom?: string }>>([]);
  const [fiches, setFiches] = useState<Array<{ id: string; nom: string }>>([]);
  const [creer, setCreer] = useState(false);
  useEffect(() => {
    let vivant = true;
    api
      .adversaires(teamId)
      .then(r => {
        if (!vivant) return;
        setFiches(r.adversaires);
        setCreer(r.droits.creer);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [api, teamId]);
  const format = d.tournoi.format;
  const max = format && format.equipes > 2 ? format.equipes - 1 : 1;
  return (
    <Panneau theme={theme} testID="esport-match-formulaire">
      {d.tournoi.phases.length ? <Choix<string> theme={theme} libelle={trC('t.champ.phase')} valeur={phase} options={[...d.tournoi.phases.map(p => ({ id: p.cle, nom: p.nom || trC(`t.phase.${p.type}` as 't.phase.poules') })), { id: '', nom: trC('t.sans_phase') }]} onChoisir={setPhase} testID="esport-match-phase" /> : null}
      <Champ theme={theme} libelle={trC('t.champ.tour')} valeur={tour} onChanger={setTour} maxLength={60} placeholder={trC('t.tour_exemple')} testID="esport-match-tour" />
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.date')} valeur={date} onChanger={setDate} maxLength={10} placeholder="2026-11-08" testID="esport-match-date" style={{ width: 150 }} />
        <Champ theme={theme} libelle={trC('t.champ.heure')} valeur={heure} onChanger={setHeure} maxLength={5} placeholder="20:00" testID="esport-match-heure" style={{ width: 110 }} />
        <Champ theme={theme} libelle={trC('t.champ.duree')} valeur={duree} onChanger={setDuree} maxLength={4} clavier="number-pad" testID="esport-match-duree" style={{ width: 130 }} />
      </View>
      <Text style={attenue(theme, 12)}>{d.modules.planning ? trC('t.aide_planning') : trC('t.aide_sans_planning')}</Text>
      <ChoixAdversaires
        theme={theme}
        fiches={fiches}
        valeur={adversaires}
        max={max}
        onChanger={setAdversaires}
        onCreer={
          creer
            ? async nom => {
                const r = await api.creerAdversaire(teamId, nom);
                setFiches(f => (f.some(x => x.id === r.adversaire.id) ? f : [...f, r.adversaire]));
                return r.adversaire;
              }
            : undefined
        }
        testID="esport-match-adversaires"
      />
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub
          theme={theme}
          titre={trC('t.ajouter')}
          variante="plein"
          onPress={() => onEnregistrer({ phase: phase || null, tour, ...(date.trim() ? { date: date.trim(), heure: heure.trim() || '20:00', dureeMin: Number(duree) || 90 } : {}), adversaires })}
          testID="esport-match-enregistrer"
        />
      </View>
    </Panneau>
  );
}

function FormulaireClassement({ theme, t, onEnregistrer }: { theme: ThemeHub; t: DetailTournoi['tournoi']; onEnregistrer(corps: SaisieTournoi): void }) {
  const [place, setPlace] = useState(t.classementFinal ? String(t.classementFinal) : '');
  const [participants, setParticipants] = useState(t.participants ? String(t.participants) : '');
  const [gains, setGains] = useState(t.gainsCentimes !== null ? String(t.gainsCentimes / 100) : '');
  const [notes, setNotes] = useState(t.gainsNotes);
  const [terminer, setTerminer] = useState(t.statut !== 'termine');
  return (
    <View style={{ gap: ESP.s }} testID="esport-final-formulaire">
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.place_finale')} valeur={place} onChanger={setPlace} clavier="number-pad" maxLength={5} testID="esport-final-place" style={{ width: 140 }} />
        <Champ theme={theme} libelle={trC('t.champ.participants')} valeur={participants} onChanger={setParticipants} clavier="number-pad" maxLength={6} testID="esport-final-participants" style={{ width: 160 }} />
        <Champ theme={theme} libelle={trC('t.champ.gains_montant', { devise: t.devise })} valeur={gains} onChanger={setGains} maxLength={12} testID="esport-final-gains" style={{ width: 160 }} />
      </View>
      <Champ theme={theme} libelle={trC('t.champ.gains_notes')} valeur={notes} onChanger={setNotes} maxLength={300} testID="esport-final-notes" />
      {t.statut !== 'termine' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
          <Interrupteur theme={theme} libelle={trC('t.marquer_termine')} valeur={terminer} onChanger={setTerminer} testID="esport-final-terminer" />
          <Text style={texte(theme, 14)}>{trC('t.marquer_termine')}</Text>
        </View>
      ) : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub
          theme={theme}
          titre={trC('t.enregistrer')}
          variante="plein"
          onPress={() =>
            onEnregistrer({
              classementFinal: place.trim() ? Number(place) : null,
              participants: participants.trim() ? Number(participants) : null,
              gains: gains.trim() || null,
              gainsNotes: notes,
              ...(terminer && t.statut !== 'termine' ? { statut: 'termine' as const } : {}),
            })
          }
          testID="esport-final-enregistrer"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Formulaire du tournoi

function FormulaireTournoi({
  theme,
  api,
  teamId,
  liste,
  fuseau,
  large,
  existant,
  onFermer,
  onEnregistre,
}: {
  theme: ThemeHub;
  api: ApiCompetition;
  teamId: string;
  liste: ListeTournois;
  fuseau: string;
  large: boolean;
  existant?: DetailTournoi['tournoi'];
  onFermer(): void;
  onEnregistre(id: string): void;
}) {
  const formats = liste.jeu.formats;
  const [nom, setNom] = useState(existant?.nom ?? '');
  const [organisateur, setOrganisateur] = useState(existant?.organisateur ?? '');
  const [lien, setLien] = useState(existant?.lien ?? '');
  const [formatCle, setFormatCle] = useState<string>(existant?.formatCle ?? formats[0]?.cle ?? '');
  const format = formats.find(f => f.cle === formatCle);
  const [bo, setBo] = useState<string>(existant?.bo ? String(existant.bo) : format?.bo[0] ? String(format.bo[0]) : '');
  const [debut, setDebut] = useState(existant?.debut ?? '');
  const [fin, setFin] = useState(existant?.fin ?? '');
  const [enLigne, setEnLigne] = useState(existant?.enLigne ?? true);
  const [lieu, setLieu] = useState(existant?.lieu ?? '');
  const [phases, setPhases] = useState<Array<{ cle?: string; type: TypePhase; nom: string }>>(existant?.phases ?? []);
  const [frais, setFrais] = useState(existant?.fraisCentimes !== null && existant?.fraisCentimes !== undefined ? String(existant.fraisCentimes / 100) : '');
  const [cashprize, setCashprize] = useState(existant?.cashprizeCentimes !== null && existant?.cashprizeCentimes !== undefined ? String(existant.cashprizeCentimes / 100) : '');
  const [devise, setDevise] = useState(existant?.devise ?? 'EUR');
  const [cashprizeDetails, setCashprizeDetails] = useState(existant?.cashprizeDetails ?? '');
  const ins = murale(existant?.inscription.limite, fuseau);
  const ckO = murale(existant?.checkin.ouverture, fuseau);
  const ckL = murale(existant?.checkin.limite, fuseau);
  const [insDate, setInsDate] = useState(ins.date);
  const [insHeure, setInsHeure] = useState(ins.heure || '23:59');
  const [ckODate, setCkODate] = useState(ckO.date);
  const [ckOHeure, setCkOHeure] = useState(ckO.heure);
  const [ckLDate, setCkLDate] = useState(ckL.date);
  const [ckLHeure, setCkLHeure] = useState(ckL.heure);
  const [statut, setStatut] = useState<StatutTournoi>(existant?.statut ?? 'a_venir');
  const [publiable, setPubliable] = useState(existant?.publiable ?? true);
  const [notes, setNotes] = useState(existant?.notes ?? '');
  const { erreur, agir, enCours } = useAgir();
  const corps = (): SaisieTournoi => ({
    nom: nom.trim(),
    organisateur,
    lien: lien.trim() || null,
    formatCle: formatCle || null,
    bo: bo ? Number(bo) : null,
    debut: debut.trim() || null,
    fin: fin.trim() || null,
    enLigne,
    lieu,
    phases,
    frais: frais.trim() || null,
    cashprize: cashprize.trim() || null,
    devise: devise.trim() || 'EUR',
    cashprizeDetails,
    inscriptionLimite: instantSaisi(insDate, insHeure),
    checkinOuverture: instantSaisi(ckODate, ckOHeure),
    checkinLimite: instantSaisi(ckLDate, ckLHeure),
    ...(existant ? { statut } : {}),
    publiable,
    notes,
  });
  return (
    <Volet theme={theme} visible titre={existant ? trC('t.modifier_titre') : trC('t.nouveau_titre')} onFermer={onFermer} testID="esport-tournoi-formulaire" largeur={large ? 640 : 560}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-tournoi-formulaire" />
      <Champ theme={theme} libelle={trC('t.champ.nom')} valeur={nom} onChanger={setNom} maxLength={80} testID="esport-tournoi-nom" />
      <Champ theme={theme} libelle={trC('t.champ.organisateur')} valeur={organisateur} onChanger={setOrganisateur} maxLength={80} testID="esport-tournoi-organisateur" />
      <Champ theme={theme} libelle={trC('t.champ.lien')} valeur={lien} onChanger={setLien} maxLength={500} placeholder="https://…" testID="esport-tournoi-lien-champ" />
      {formats.length ? (
        <Choix<string>
          theme={theme}
          libelle={trC('t.champ.format')}
          valeur={formatCle}
          options={formats.map(f => ({ id: f.cle, nom: f.nom === f.libelle ? f.nom : `${f.nom} (${f.libelle})` }))}
          onChoisir={v => {
            setFormatCle(v);
            const f = formats.find(x => x.cle === v);
            if (f && !f.bo.includes(Number(bo))) setBo(String(f.bo[0] ?? ''));
          }}
          testID="esport-tournoi-format"
        />
      ) : (
        <Text style={attenue(theme, 13)}>{trC('t.aucun_format')}</Text>
      )}
      {format && format.equipes <= 2 ? <Choix<string> theme={theme} libelle={trC('t.champ.bo')} valeur={bo} options={format.bo.map(b => ({ id: String(b), nom: `BO${b}` }))} onChoisir={setBo} testID="esport-tournoi-bo" /> : null}
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.debut')} valeur={debut} onChanger={setDebut} maxLength={10} placeholder="2026-11-08" testID="esport-tournoi-debut" style={{ width: 160 }} />
        <Champ theme={theme} libelle={trC('t.champ.fin')} valeur={fin} onChanger={setFin} maxLength={10} placeholder="2026-11-09" testID="esport-tournoi-fin" style={{ width: 160 }} />
      </View>
      <Choix<'1' | '0'> theme={theme} libelle={trC('t.champ.lieu')} valeur={enLigne ? '1' : '0'} options={[{ id: '1', nom: trC('t.en_ligne') }, { id: '0', nom: trC('t.sur_place') }]} onChoisir={v => setEnLigne(v === '1')} testID="esport-tournoi-en-ligne" />
      {!enLigne ? <Champ theme={theme} libelle={trC('t.champ.adresse')} valeur={lieu} onChanger={setLieu} maxLength={200} testID="esport-tournoi-lieu" /> : null}
      <View style={{ gap: ESP.xs }} testID="esport-tournoi-phases">
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trC('t.champ.phases')}</Text>
        {phases.map((p, i) => (
          <View key={i} style={{ gap: ESP.xxs, padding: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 8 }}>
            <Choix<TypePhase> theme={theme} libelle={trC('t.phase_n', { n: i + 1 })} valeur={p.type} options={TYPES_PHASE.map(x => ({ id: x, nom: trC(`t.phase.${x}` as 't.phase.poules') }))} onChoisir={v => setPhases(ps => ps.map((x, j) => (j === i ? { ...x, type: v } : x)))} testID={`esport-tournoi-phase-${i}-type`} />
            <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
              <Champ theme={theme} libelle={trC('t.champ.nom_phase')} valeur={p.nom} onChanger={v => setPhases(ps => ps.map((x, j) => (j === i ? { ...x, nom: v } : x)))} maxLength={40} testID={`esport-tournoi-phase-${i}-nom`} style={{ flexGrow: 1, flexBasis: 200 }} />
              <BoutonHub theme={theme} titre={trC('t.retirer')} onPress={() => setPhases(ps => ps.filter((_, j) => j !== i))} testID={`esport-tournoi-phase-${i}-retirer`} />
            </View>
          </View>
        ))}
        {phases.length < 8 ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={trC('t.ajouter_phase')} onPress={() => setPhases(ps => [...ps, { type: 'simple', nom: '' }])} testID="esport-tournoi-ajouter-phase" />
          </View>
        ) : null}
      </View>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.frais')} valeur={frais} onChanger={setFrais} maxLength={12} testID="esport-tournoi-frais" style={{ width: 140 }} />
        <Champ theme={theme} libelle={trC('t.champ.cashprize')} valeur={cashprize} onChanger={setCashprize} maxLength={12} testID="esport-tournoi-cashprize" style={{ width: 140 }} />
        <Champ theme={theme} libelle={trC('t.champ.devise')} valeur={devise} onChanger={v => setDevise(v.toUpperCase())} maxLength={3} testID="esport-tournoi-devise" style={{ width: 100 }} />
      </View>
      <Champ theme={theme} libelle={trC('t.champ.cashprize_details')} valeur={cashprizeDetails} onChanger={setCashprizeDetails} maxLength={300} testID="esport-tournoi-cashprize-details" />
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trC('t.champ.inscription_limite')}</Text>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.date')} valeur={insDate} onChanger={setInsDate} maxLength={10} placeholder="2026-11-06" testID="esport-tournoi-inscription-date" style={{ width: 150 }} />
        <Champ theme={theme} libelle={trC('t.champ.heure')} valeur={insHeure} onChanger={setInsHeure} maxLength={5} testID="esport-tournoi-inscription-heure" style={{ width: 110 }} />
      </View>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trC('t.champ.checkin')}</Text>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Champ theme={theme} libelle={trC('t.champ.ouverture')} valeur={ckODate} onChanger={setCkODate} maxLength={10} placeholder="2026-11-08" testID="esport-tournoi-checkin-date" style={{ width: 150 }} />
        <Champ theme={theme} libelle={trC('t.champ.heure')} valeur={ckOHeure} onChanger={setCkOHeure} maxLength={5} placeholder="18:00" testID="esport-tournoi-checkin-heure" style={{ width: 110 }} />
        <Champ theme={theme} libelle={trC('t.champ.limite')} valeur={ckLDate} onChanger={setCkLDate} maxLength={10} placeholder="2026-11-08" testID="esport-tournoi-checkin-limite-date" style={{ width: 150 }} />
        <Champ theme={theme} libelle={trC('t.champ.heure')} valeur={ckLHeure} onChanger={setCkLHeure} maxLength={5} placeholder="19:30" testID="esport-tournoi-checkin-limite-heure" style={{ width: 110 }} />
      </View>
      {existant ? <Choix<StatutTournoi> theme={theme} libelle={trC('t.champ.statut')} valeur={statut} options={STATUTS_TOURNOI.map(s => ({ id: s, nom: nomStatutTournoi(s) }))} onChoisir={setStatut} testID="esport-tournoi-statut-choix" /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
        <Interrupteur theme={theme} libelle={trC('t.champ.publiable')} valeur={publiable} onChanger={setPubliable} testID="esport-tournoi-publiable" />
        <View style={{ flex: 1 }}>
          <Text style={texte(theme, 14)}>{trC('t.champ.publiable')}</Text>
          <Text style={attenue(theme, 12)}>{trC('t.publiable_aide')}</Text>
        </View>
      </View>
      <Champ theme={theme} libelle={trC('t.champ.notes')} valeur={notes} onChanger={setNotes} multiligne maxLength={4000} testID="esport-tournoi-notes" />
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub
          theme={theme}
          titre={trC('t.enregistrer')}
          variante="plein"
          desactive={nom.trim().length < 2 || Boolean(enCours)}
          onPress={() =>
            void agir('enregistrer', async () => {
              const r = existant ? await api.modifierTournoi(teamId, existant.id, corps()) : await api.creerTournoi(teamId, corps());
              onEnregistre(r.tournoi.id);
            })
          }
          testID="esport-tournoi-enregistrer"
        />
      </View>
    </Volet>
  );
}
