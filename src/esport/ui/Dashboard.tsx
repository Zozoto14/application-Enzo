/**
 * Dashboard de l'Esport (premier niveau) : résumé de TOUTES les teams de
 * l'utilisateur, en une seule requête (`GET /dashboard`).
 *
 * Bloc global : résumés à rédiger, événements de la semaine (toutes teams),
 * alertes. Puis une carte par team : prochains événements, présence récente,
 * résumés en attente, tâches en retard, dernière activité, membres. Le
 * serveur ne renvoie que les teams autorisées, et un bloc vaut `null` quand
 * le module est coupé ou que la permission manque : il n'est pas affiché.
 * Toucher une carte ouvre la team.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { CarteTeam, ClientEsport, OccurrenceTableau, Tableau } from '../client';
import { phraseJournal, texteAlerte } from '../libelles';
import { nomJour, typeEvenement } from '../planning/libelles';
import { PageEsport } from './CadreEsport';
import { PastilleRole, Retours, useAgir } from './commun';
import { AvatarTeam, Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Grille, SqueletteCartes, TitreCarte, attenue, couleurTeam, texte, useDensite, type EtatPresse } from './design';
import { tr, trn } from '../i18n';
import { trDv } from '../i18n/devblog';
import { nomRole } from '../client';
import { nomIssue, ordinal } from '../competition/libelles';

/** « jeu. 22/10 · 20:00 » (heure de l'appareil). */
export function quandCourt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${nomJour(d.getDay() || 7, 'short')} ${deux(d.getDate())}/${deux(
    d.getMonth() + 1,
  )} · ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** « il y a 3 h », « il y a 2 j ». */
export function depuis(iso: string, maintenant = Date.now()): string {
  const ecart = Math.max(0, maintenant - Date.parse(iso));
  if (Number.isNaN(ecart)) return '';
  const minutes = Math.round(ecart / 60_000);
  if (minutes < 1) return tr('dashboard.a_l_instant');
  if (minutes < 60) return tr('dashboard.il_y_a_min', { minutes });
  const heures = Math.round(minutes / 60);
  if (heures < 24) return tr('dashboard.il_y_a_h', { heures });
  return tr('dashboard.il_y_a_j', { v: Math.round(heures / 24) });
}

export function Dashboard({
  theme,
  client,
  large,
  pseudo,
  onOuvrir,
  onBoite,
  onMembres,
  onTeams,
  onNouveautes,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  pseudo?: string;
  onOuvrir(teamId: string): void;
  onBoite(): void;
  onMembres?(): void;
  onTeams?(): void;
  /** Devblog (historique des mises à jour) : bouton « Nouveautés » discret, dans l'en-tête. */
  onNouveautes?(): void;
}) {
  const { compacte } = useDensite();
  const [tableau, setTableau] = useState<Tableau | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setTableau(await client.tableau()), [client]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const g = tableau?.global;
  const redacteur = Boolean(tableau?.teams.some(t => t.resumes?.redacteur));
  const enRetard = tableau?.teams.reduce((n, t) => n + (t.taches?.enRetard ?? 0), 0) ?? 0;
  const membres = tableau?.teams.reduce((n, t) => n + t.effectif.actifs, 0) ?? 0;

  return (
    <PageEsport large={large} testID="esport-dashboard">
      <EnTetePage
        theme={theme}
        large={large}
        titre={pseudo ? tr('dashboard.bonjour', { pseudo }) : tr('dashboard.dashboard')}
        sous={tr('dashboard.toutes_vos_teams_en')}
        action={
          <>
            {onNouveautes ? <BoutonHub theme={theme} titre={`✨ ${trDv('bouton_dashboard')}`} libelle={trDv('bouton_dashboard_libelle')} onPress={onNouveautes} testID="esport-dashboard-devblog" /> : null}
            <BoutonHub theme={theme} titre={tr('dashboard.actualiser')} libelle={tr('dashboard.actualiser_le_dashboard')} onPress={() => void agir('', charger)} testID="esport-dashboard-actualiser" />
          </>
        }
      />
      <Retours theme={theme} erreur={erreur} prefixe="esport-dashboard" />
      {!tableau && !erreur ? <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} /> : null}
      {tableau && tableau.teams.length === 0 ? (
        <Carte theme={theme} testID="esport-dashboard-vide">
          <EtatVide
            theme={theme}
            glyphe="◆"
            titre={tr('dashboard.aucune_team_pour_l')}
            texte={tr('dashboard.vous_n_etes_encore')}
            action={onTeams ? { titre: tr('dashboard.voir_les_teams'), onPress: onTeams, testID: 'esport-dashboard-vers-teams' } : undefined}
          />
        </Carte>
      ) : null}
      {g && tableau && tableau.teams.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: large ? ESP.m : ESP.s }} testID="esport-dashboard-global">
            <ChiffreCle theme={theme} large={large} glyphe="◆" libelle={tr('dashboard.teams')} valeur={String(tableau.teams.length)} detail={trn('dashboard.membres_actifs', membres)} onPress={onTeams} testID="esport-dashboard-chiffre-teams" />
            <ChiffreCle theme={theme} large={large} glyphe="◷" libelle={tr('dashboard.evenements_7_jours')} valeur={String(g.evenementsSemaine.length)} detail={g.evenementsSemaine[0] ? tr('dashboard.prochain', { v: quandCourt(g.evenementsSemaine[0].debut) }) : tr('dashboard.rien_de_prevu')} testID="esport-dashboard-chiffre-semaine" />
            {redacteur ? (
              <ChiffreCle
                theme={theme}
                large={large}
                glyphe="✎"
                libelle={tr('dashboard.resumes_a_rediger')}
                valeur={String(g.resumesARediger)}
                testIDValeur="esport-dashboard-resumes-nombre"
                ton={g.resumesARediger > 0 ? 'alerte' : 'neutre'}
                detail={g.resumesARediger > 0 ? tr('dashboard.ouvrir_la_boite') : tr('dashboard.rien_en_attente')}
                onPress={g.resumesARediger > 0 ? onBoite : undefined}
                testID="esport-dashboard-resumes"
              />
            ) : (
              <ChiffreCle theme={theme} large={large} glyphe="☑︎" libelle={tr('dashboard.taches_en_retard')} valeur={String(enRetard)} ton={enRetard > 0 ? 'critique' : 'ok'} detail={enRetard > 0 ? tr('dashboard.a_rattraper') : tr('dashboard.tout_est_a_jour')} testID="esport-dashboard-chiffre-taches" />
            )}
            <ChiffreCle theme={theme} large={large} glyphe="!" libelle={tr('dashboard.alertes')} valeur={String(g.alertes.length)} ton={g.alertes.length > 0 ? 'alerte' : 'ok'} detail={g.alertes.length > 0 ? tr('dashboard.voir_ci_dessous') : tr('dashboard.tout_est_en_ordre')} testID="esport-dashboard-chiffre-alertes" />
          </View>
          <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }}>
            <Carte theme={theme} style={large ? { flex: 2 } : undefined} testID="esport-dashboard-semaine">
              <TitreCarte theme={theme} titre={tr('dashboard.cette_semaine', { length: g.evenementsSemaine.length })} sous={tr('dashboard.les_7_prochains_jours')} />
              {g.evenementsSemaine.length === 0 ? <EtatVide theme={theme} glyphe="◷" titre={tr('dashboard.semaine_libre')} texte={tr('dashboard.aucun_evenement_dans_les')} /> : null}
              <View style={{ gap: ESP.xs }}>
                {g.evenementsSemaine.slice(0, 8).map(o => (
                  <LigneEvenement key={`${o.evenementId}-${o.cle}`} theme={theme} o={o} avecTeam onPress={() => onOuvrir(o.teamId)} />
                ))}
              </View>
            </Carte>
            <Carte theme={theme} style={large ? { flex: 1.2 } : undefined} testID="esport-dashboard-alertes">
              <TitreCarte theme={theme} titre={g.alertes.length ? tr('dashboard.alertes_n', { n: g.alertes.length }) : tr('dashboard.alertes')} />
              {g.alertes.length === 0 ? <EtatVide theme={theme} glyphe="✓" titre={tr('dashboard.tout_est_en_ordre')} texte={tr('dashboard.aucune_tache_en_retard')} /> : null}
              {g.alertes.map(a => (
                <Pressable
                  key={`${a.genre}-${a.teamId}`}
                  accessibilityRole="button"
                  accessibilityLabel={tr('dashboard.alerte_label', { team: a.teamNom, texte: texteAlerte(a) })}
                  onPress={() => (a.genre === 'invites' && onMembres ? onMembres() : onOuvrir(a.teamId))}
                  style={(etat: EtatPresse) => ({
                    flexDirection: 'row',
                    gap: ESP.s,
                    alignItems: 'center',
                    minHeight: 48,
                    paddingHorizontal: ESP.s,
                    borderRadius: 10,
                    backgroundColor: teinteTransparente(a.genre === 'invites' ? theme.accent : theme.alerte, etat.hovered ? 0.18 : 0.1),
                  })}
                  testID={`esport-alerte-${a.genre}-${a.teamId}`}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.genre === 'invites' ? theme.accent : theme.alerte }} />
                  <Text style={{ ...texte(theme), flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{a.teamNom}</Text> · {texteAlerte(a)}
                  </Text>
                  <Text style={{ color: theme.attenue, fontSize: 18 }}>›</Text>
                </Pressable>
              ))}
            </Carte>
          </View>
          <View style={{ gap: ESP.m }}>
            <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '700', ...police(theme.policeTitre) }}>
              {tr('dashboard.vos_teams')}</Text>
            <Grille min={large ? (compacte ? 290 : 340) : 280} max={480} gap={ESP.m} testID="esport-dashboard-teams">
              {tableau.teams.map(c => (
                <CarteDashboard key={c.team.id} theme={theme} carte={c} onOuvrir={() => onOuvrir(c.team.id)} />
              ))}
            </Grille>
          </View>
        </>
      ) : null}
    </PageEsport>
  );
}

/** Une ligne d'événement : jour et heure, liseré de la couleur du type, titre, type et team. */
function LigneEvenement({ theme, o, avecTeam, onPress }: { theme: ThemeHub; o: OccurrenceTableau; avecTeam?: boolean; onPress?(): void }) {
  const t = typeEvenement(o.type);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${o.titre}, ${t.nom}, ${quandCourt(o.debut)}${avecTeam && o.teamNom ? `, ${o.teamNom}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        flexDirection: 'row',
        gap: ESP.s,
        alignItems: 'center',
        minHeight: 48,
        paddingVertical: ESP.xs,
        paddingHorizontal: ESP.s,
        borderRadius: 10,
        backgroundColor: etat.hovered ? teinteTransparente(theme.attenue, 0.1) : teinteTransparente(theme.attenue, 0.05),
      })}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: t.couleur }} />
      <View style={{ width: 92 }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '700', ...police(theme.policeChiffres) }}>{quandCourt(o.debut).split(' · ')[0]}</Text>
        <Text style={{ ...attenue(theme), ...police(theme.policeChiffres) }}>{quandCourt(o.debut).split(' · ')[1]}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...texte(theme), fontWeight: '600' }} numberOfLines={1}>
          {o.titre}
        </Text>
        <Text style={attenue(theme)} numberOfLines={1}>
          {`${t.nom}${avecTeam && o.teamNom ? ` · ${o.teamNom}` : ''}${o.lieu ? ` · ${o.lieu}` : ''}`}
        </Text>
      </View>
    </Pressable>
  );
}

function Indicateur({ theme, libelle, valeur, alerte, testID }: { theme: ThemeHub; libelle: string; valeur: string; alerte?: boolean; testID: string }) {
  return (
    <View
      style={{
        minWidth: 92,
        flex: 1,
        gap: 2,
        paddingVertical: ESP.xs,
        paddingHorizontal: ESP.s,
        borderRadius: Math.min(theme.rayonMoyen, 10),
        backgroundColor: teinteTransparente(alerte ? theme.alerte : theme.attenue, alerte ? 0.14 : 0.07),
      }}
      testID={testID}>
      <Text style={{ color: alerte ? theme.alerte : theme.texte, fontSize: 20, fontWeight: '700', ...police(theme.policeChiffres) }}>{valeur}</Text>
      <Text style={attenue(theme, 12)} numberOfLines={1}>
        {libelle}
      </Text>
    </View>
  );
}

function CarteDashboard({ theme, carte, onOuvrir }: { theme: ThemeHub; carte: CarteTeam; onOuvrir(): void }) {
  const { team, effectif } = carte;
  const activite = carte.derniereActivite;
  const phrase = activite?.action
    ? phraseJournal(
        { id: '', action: activite.action, acteur: activite.acteur ?? null, entiteType: null, entiteId: null, meta: activite.meta ?? {}, date: activite.date },
        activite.acteur ? { [activite.acteur]: activite.pseudo ?? null } : {},
      )
    : undefined;
  return (
    <Carte theme={theme} testID={`esport-team-${team.slug}`} libelle={tr('dashboard.ouvrir', { nom: team.nom })} onPress={onOuvrir} accent={couleurTeam(team.slug)} style={{ height: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
        <AvatarTeam theme={theme} team={team} taille={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ ...texte(theme, 18), fontWeight: '800' }} numberOfLines={1}>
            {team.nom}
          </Text>
          {carte.role ? <PastilleRole theme={theme} nom={nomRole(carte.role.nom)} couleur={carte.role.couleur} /> : <Badge theme={theme} texte={tr('dashboard.fondateur')} ton="accent" />}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        <Indicateur theme={theme} libelle={tr('dashboard.membres')} valeur={`${effectif.actifs}${effectif.invites ? ` +${effectif.invites}` : ''}`} testID={`esport-carte-membres-${team.slug}`} />
        {carte.presence ? (
          <Indicateur
            theme={theme}
            libelle={tr('dashboard.presence_j', { jours: carte.presence.jours })}
            valeur={carte.presence.taux === null ? tr('presence.rien_de_marque') : `${carte.presence.taux} %`}
            alerte={carte.presence.taux !== null && carte.presence.taux < 60}
            testID={`esport-carte-presence-${team.slug}`}
          />
        ) : null}
        {carte.resumes ? (
          <Indicateur
            theme={theme}
            libelle={tr('dashboard.resumes_en_attente')}
            valeur={String(carte.resumes.aResumer + carte.resumes.enCours)}
            alerte={carte.resumes.aResumer + carte.resumes.enCours > 0 && carte.resumes.redacteur}
            testID={`esport-carte-resumes-${team.slug}`}
          />
        ) : null}
        {carte.taches ? <Indicateur theme={theme} libelle={tr('dashboard.taches_en_retard')} valeur={String(carte.taches.enRetard)} alerte={carte.taches.enRetard > 0} testID={`esport-carte-taches-${team.slug}`} /> : null}
      </View>
      {effectif.invites > 0 ? <Text style={attenue(theme)}>{trn('dashboard.invites_pas_connectes', effectif.invites)}</Text> : null}
      {carte.prochains ? (
        <View style={{ gap: ESP.xxs }}>
          <Text style={{ ...attenue(theme), fontWeight: '700' }}>{tr('dashboard.prochains_evenements')}</Text>
          {carte.prochains.length === 0 ? <Text style={attenue(theme)}>{tr('dashboard.rien_de_prevu_dans')}</Text> : null}
          {carte.prochains.slice(0, 3).map(o => {
            const t = typeEvenement(o.type);
            return (
              <View key={`${o.evenementId}-${o.cle}`} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.couleur }} />
                <Text style={{ ...attenue(theme), minWidth: 104, ...police(theme.policeChiffres) }}>{quandCourt(o.debut)}</Text>
                <Text style={{ ...texte(theme, 14), flex: 1 }} numberOfLines={1}>
                  {o.titre}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {carte.competition && (carte.competition.prochains?.length || carte.competition.derniers?.length) ? (
        <View style={{ gap: ESP.xxs }} testID={`esport-carte-competition-${team.slug}`}>
          <Text style={{ ...attenue(theme), fontWeight: '700' }}>{tr('competition.accueil.titre')}</Text>
          {carte.competition.prochains?.slice(0, 2).map(m => (
            <View key={m.id} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: typeEvenement('tournament').couleur }} />
              <Text style={{ ...attenue(theme), minWidth: 104, ...police(theme.policeChiffres) }}>{quandCourt(m.debut)}</Text>
              <Text style={{ ...texte(theme, 14), flex: 1 }} numberOfLines={1}>
                {[m.tournoi.nom, m.adversaires.length ? tr('competition.contre_court', { adversaire: m.adversaires.join(', ') }) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
          {carte.competition.derniers?.slice(0, 2).map(r => (
            <View key={r.id} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center' }}>
              <Badge theme={theme} ton={r.issue === 'victoire' ? 'ok' : r.issue === 'defaite' ? 'critique' : 'neutre'} texte={r.issue ? `${nomIssue(r.issue)}${r.score ? ` ${r.score}` : ''}` : ordinal(r.place, true)} />
              <Text style={{ ...texte(theme, 14), flex: 1 }} numberOfLines={1}>
                {r.adversaires.join(', ')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Text style={attenue(theme)} numberOfLines={2} testID={`esport-carte-activite-${team.slug}`}>
        {activite ? tr('dashboard.derniere_activite', { quand: depuis(activite.date), suite: phrase ? tr('fmt.suite', { texte: phrase }) : '' }) : tr('dashboard.aucune_activite_pour_l')}
      </Text>
    </Carte>
  );
}
