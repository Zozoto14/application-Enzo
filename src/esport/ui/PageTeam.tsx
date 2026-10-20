/**
 * Page d'une team : barre latérale (PC, iPad paysage) ou onglets défilants
 * (iPhone, iPad portrait) qui ne listent QUE les modules activés. Accueil,
 * Membres et rôles, Journal, Paramètres, et les modules livrés : Planning,
 * Disponibilités, Présence (écrans dans ui/modules.tsx), Résumés de réunions,
 * Objectifs et tâches (et leurs blocs sur l'accueil) ; les autres modules
 * activés apparaissent « bientôt ».
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { CATALOGUE, MENTION_DONNEES, nomModule, type ClientEsport, type DetailTeam, type Notifications } from '../client';
import { dateCourte, phraseNotification } from '../libelles';
import type { SaisieEvenement } from '../planning/api';
import { AccueilPhase3 } from './AccueilPhase3';
import { Journal } from './Journal';
import { StatsTeam } from './StatsTeam';
import { MembresRoles } from './MembresRoles';
import { SectionObjectifs } from './Objectifs';
import { SectionResumes } from './Resumes';
import { ECRANS_MODULES, moduleAccessible } from './modules';
import { AccueilPlanning, ReglagesPlanning } from './planning/AccueilPlanning';
import { BoutonConfirme, PastilleRole, Retours, TitreSection, styles, useAgir } from './commun';

export type SectionTeam = 'accueil' | 'membres' | 'journal' | 'parametres' | `module:${string}`;

/** Modules déjà disponibles (les autres activés apparaissent « bientôt »). */
const MODULES_DISPONIBLES = new Set(['meeting_summaries', 'goals_tasks']);

/** Entrées de la barre : le cœur, puis les modules ACTIVÉS (Journal ouvert ; les autres « bientôt »). */
export function entreesBarre(detail: DetailTeam): Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> {
  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const entrees: Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> = [{ id: 'accueil', libelle: 'Accueil' }];
  for (const m of CATALOGUE.modules) {
    if (!actifs.has(m.cle) || m.cle === 'activity_log') continue;
    const livre = Boolean(ECRANS_MODULES[m.cle]);
    if (livre && !moduleAccessible(m.cle, detail.moi.permissions)) continue;
    entrees.push({ id: `module:${m.cle}`, libelle: m.nom, bientot: !livre && !MODULES_DISPONIBLES.has(m.cle) });
  }
  if (peut('members.view') || peut('members.invite') || peut('roles.manage')) entrees.push({ id: 'membres', libelle: 'Membres et rôles' });
  if (actifs.has('activity_log') && peut('activity_log.view')) entrees.push({ id: 'journal', libelle: 'Journal' });
  entrees.push({ id: 'parametres', libelle: 'Paramètres' });
  return entrees;
}

export function PageTeam({
  theme,
  client,
  teamId,
  large,
  sectionInitiale = 'accueil',
  onQuitter,
  onExporter,
  onMembresGlobal,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  teamId: string;
  large: boolean;
  sectionInitiale?: SectionTeam;
  onQuitter(): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Page « Membres » de premier niveau (inviter, ajouter un compte existant). */
  onMembresGlobal?(): void;
}) {
  const [detail, setDetail] = useState<DetailTeam | undefined>();
  const [section, setSection] = useState<SectionTeam>(sectionInitiale);
  const [brouillon, setBrouillon] = useState<{ n: number; b?: Partial<SaisieEvenement>; reviewId?: string }>({ n: 0 });
  const aller = useCallback((s: SectionTeam, b?: Partial<SaisieEvenement>, reviewId?: string) => {
    setBrouillon(x => ({ n: x.n + 1, b, reviewId }));
    setSection(s);
  }, []);
  const { erreur, agir } = useAgir();

  const recharger = useCallback(async () => setDetail(await client.team(teamId)), [client, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  if (!detail) {
    return (
      <View style={{ padding: 16, gap: 12 }} testID="esport-team-chargement">
        {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-team" /> : <Text style={{ color: theme.attenue }}>Chargement de la team…</Text>}
        <BoutonHub theme={theme} titre="← Mes teams" onPress={onQuitter} testID="esport-team-retour" />
      </View>
    );
  }
  const entrees = entreesBarre(detail);
  const active = entrees.some(e => e.id === section) ? section : 'accueil';

  const barre = (
    <View
      testID="esport-barre"
      accessibilityRole="tablist"
      style={
        large
          ? { width: 220, gap: 4, padding: 12, borderRightWidth: 1, borderRightColor: theme.ligne }
          : { borderBottomWidth: 1, borderBottomColor: theme.ligne }
      }>
      {large ? (
        <View style={{ gap: 4, marginBottom: 8 }}>
          <Text style={{ color: theme.texte, fontSize: 17, fontWeight: '800', ...police(theme.policeTitre) }} numberOfLines={2}>
            {detail.team.nom}
          </Text>
          {detail.moi.role ? <PastilleRole theme={theme} nom={detail.moi.role.nom} couleur={detail.moi.role.couleur} /> : <Text style={{ color: theme.attenue, fontSize: 12 }}>Super admin</Text>}
        </View>
      ) : null}
      <ScrollView horizontal={!large} showsHorizontalScrollIndicator={false} contentContainerStyle={large ? { gap: 2 } : { gap: 4, paddingHorizontal: 12, paddingVertical: 8 }}>
        {entrees.map(e => {
          const choisie = e.id === active;
          return (
            <Pressable
              key={e.id}
              testID={`esport-onglet-${e.id.replace(':', '-')}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: choisie }}
              accessibilityLabel={`${e.libelle}${e.bientot ? ' (bientôt)' : ''}`}
              onPress={() => aller(e.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 8,
                // Cible tactile de 44 px (WCAG 2.5.5, recommandations Apple).
                minHeight: 44,
                borderRadius: Math.min(theme.rayonMoyen, 10),
                backgroundColor: choisie ? teinteTransparente(theme.accent, 0.18) : 'transparent',
              }}>
              <Text style={{ color: e.bientot ? theme.attenue : theme.texte, fontWeight: choisie ? '700' : '500', fontSize: 14, ...police(theme.policeTexte) }}>{e.libelle}</Text>
              {e.bientot ? <Text style={{ color: theme.attenue, fontSize: 10, borderWidth: 1, borderColor: theme.ligne, borderRadius: 6, paddingHorizontal: 4 }}>bientôt</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {large ? <BoutonHub theme={theme} titre="← Mes teams" onPress={onQuitter} testID="esport-team-retour" /> : null}
    </View>
  );

  let contenu: React.ReactNode;
  if (active === 'membres') contenu = <MembresRoles theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} onMembresGlobal={onMembresGlobal} />;
  else if (active === 'journal') contenu = <Journal theme={theme} client={client} detail={detail} onExporter={onExporter} />;
  else if (active === 'parametres') contenu = <Parametres theme={theme} client={client} detail={detail} onChange={recharger} onSupprimee={onQuitter} onExporter={onExporter} />;
  else if (active === 'module:meeting_summaries') contenu = <SectionResumes theme={theme} client={client} detail={detail} large={large} />;
  else if (active === 'module:goals_tasks') contenu = <SectionObjectifs theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} />;
  else if (active.startsWith('module:') && ECRANS_MODULES[active.slice('module:'.length)]) {
    const Ecran = ECRANS_MODULES[active.slice('module:'.length)];
    contenu = <Ecran key={`${active}-${brouillon.n}`} theme={theme} client={client} detail={detail} large={large} onAller={aller} brouillon={brouillon.b} reviewId={brouillon.reviewId} onExporter={onExporter} />;
  } else if (active.startsWith('module:')) {
    const cle = active.slice('module:'.length);
    const module = CATALOGUE.modules.find(m => m.cle === cle);
    contenu = (
      <View style={{ gap: 12 }} testID={`esport-bientot-${cle}`}>
        <TitreSection theme={theme} titre={module?.nom ?? cle} sous="Bientôt disponible" />
        <Panneau theme={theme}>
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{module?.description}</Text>
          <Text style={{ color: theme.attenue, fontSize: 13 }}>Ce module est activé pour la team : il arrivera dans une prochaine version (étape {module?.phase} du plan).</Text>
        </Panneau>
      </View>
    );
  } else contenu = <AccueilTeam theme={theme} client={client} detail={detail} onAller={aller} />;

  return (
    <View style={{ flex: 1, flexDirection: large ? 'row' : 'column' }} testID="esport-team">
      {large ? null : (
        <View style={[styles.ligne, { paddingHorizontal: 12, paddingTop: 8 }]}>
          <BoutonHub theme={theme} titre="← Teams" onPress={onQuitter} testID="esport-team-retour" />
          <Text style={{ flex: 1, color: theme.texte, fontSize: 17, fontWeight: '800', ...police(theme.policeTitre) }} numberOfLines={1}>
            {detail.team.nom}
          </Text>
        </View>
      )}
      {barre}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {contenu}
      </ScrollView>
    </View>
  );
}

function AccueilTeam({ theme, client, detail, onAller }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onAller(s: SectionTeam, b?: Partial<SaisieEvenement>): void }) {
  const [notifs, setNotifs] = useState<Notifications | undefined>();
  useEffect(() => {
    client.notifications().then(setNotifs, () => undefined);
  }, [client]);
  const actifs = detail.modules.filter(m => m.active).map(m => m.cle);
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const miennes = notifs?.liste.filter(n => n.team?.id === detail.team.id).slice(0, 6) ?? [];
  return (
    <View style={{ gap: 16 }} testID="esport-accueil-team">
      <TitreSection theme={theme} titre={detail.team.nom} sous={detail.team.description || `${CATALOGUE.jeux.find(j => j.cle === detail.team.jeu)?.nom ?? detail.team.jeu} · ${detail.membres} membre(s)`} />
      {/* Planning d'abord : sur iPhone, répondre doit se faire sans défiler. */}
      <AccueilPlanning theme={theme} client={client} detail={detail} onAller={onAller} />
      <View style={styles.ligne}>
        <Panneau theme={theme} style={{ flex: 1, minWidth: 180 }}>
          <Intertitre theme={theme}>Mon rôle</Intertitre>
          {detail.moi.role ? <PastilleRole theme={theme} nom={detail.moi.role.nom} couleur={detail.moi.role.couleur} testID="esport-mon-role" /> : <Text style={attenue}>Super admin (Fondateur)</Text>}
        </Panneau>
        <Panneau theme={theme} style={{ flex: 1, minWidth: 180 }}>
          <Intertitre theme={theme}>Membres</Intertitre>
          <Text style={{ color: theme.texte, fontSize: 24, fontWeight: '800', ...police(theme.policeChiffres) }}>{detail.membres}</Text>
          {detail.moi.permissions.includes('members.view') ? <BoutonHub theme={theme} titre="Voir" onPress={() => onAller('membres')} testID="esport-accueil-membres" /> : null}
        </Panneau>
        <Panneau theme={theme} style={{ flex: 2, minWidth: 220 }}>
          <Intertitre theme={theme}>Modules</Intertitre>
          <Text style={attenue}>{actifs.map(nomModule).join(' · ') || 'Aucun module activé'}</Text>
        </Panneau>
      </View>
      <Panneau theme={theme} testID="esport-accueil-notifications">
        <Intertitre theme={theme}>Notifications</Intertitre>
        {miennes.length === 0 ? <Text style={attenue}>Rien de nouveau.</Text> : null}
        {miennes.map(n => (
          <Text key={n.id} style={{ color: theme.texte, fontWeight: n.lue ? '400' : '700', ...police(theme.policeTexte) }}>
            {phraseNotification(n, notifs?.noms ?? {})} <Text style={attenue}>· {dateCourte(n.date)}</Text>
          </Text>
        ))}
      </Panneau>
      <AccueilPhase3 theme={theme} client={client} detail={detail} onAller={onAller} />
      <StatsTeam theme={theme} client={client} detail={detail} />
    </View>
  );
}

function Parametres({
  theme,
  client,
  detail,
  onChange,
  onSupprimee,
  onExporter,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  onChange(): Promise<void>;
  onSupprimee(): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const [nom, setNom] = useState(detail.team.nom);
  const [description, setDescription] = useState(detail.team.description);
  const { enCours, erreur, avis, agir } = useAgir();
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 16 }} testID="esport-parametres">
      <TitreSection theme={theme} titre="Paramètres" />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-parametres" />
      {peut('team.manage') ? (
        <Panneau theme={theme}>
          <Intertitre theme={theme}>La team</Intertitre>
          <Champ theme={theme} libelle="Nom" valeur={nom} onChanger={setNom} maxLength={60} testID="esport-parametres-nom" />
          <Champ theme={theme} libelle="Description" valeur={description} onChanger={setDescription} maxLength={500} multiligne testID="esport-parametres-description" />
          <BoutonHub
            theme={theme}
            titre="Enregistrer"
            variante="plein"
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('Team', async () => {
                await client.modifierTeam(detail.team.id, { nom: nom.trim(), description });
                await onChange();
                return 'Team enregistrée.';
              })
            }
            testID="esport-parametres-enregistrer"
          />
        </Panneau>
      ) : null}
      <Panneau theme={theme} testID="esport-parametres-modules">
        <Intertitre theme={theme}>Modules</Intertitre>
        <Text style={attenue}>
          {peut('modules.manage') ? 'Désactiver un module le cache (et ferme ses routes) sans rien effacer : le réactiver rend tout.' : 'Seul le Propriétaire active ou désactive les modules.'}
        </Text>
        {CATALOGUE.modules.map(m => {
          const actif = detail.modules.some(x => x.cle === m.cle && x.active);
          return (
            <View key={m.cle} style={[styles.ligne, { flexWrap: 'nowrap' }]}>
              {peut('modules.manage') ? (
                <Case
                  theme={theme}
                  coche={actif}
                  libelle={m.nom}
                  onChanger={v =>
                    void agir('Modules', async () => {
                      await client.changerModules(detail.team.id, { [m.cle]: v });
                      await onChange();
                      return `${m.nom} ${v ? 'activé' : 'désactivé'}.`;
                    })
                  }
                  testID={`esport-parametres-module-${m.cle}`}
                />
              ) : (
                <Text style={{ color: actif ? theme.ok : theme.attenue, width: 22 }}>{actif ? '✓' : '·'}</Text>
              )}
              <Text style={{ flex: 1, color: theme.texte, ...police(theme.policeTexte) }}>
                {m.nom}
                {m.cle !== 'activity_log' && !ECRANS_MODULES[m.cle] && !MODULES_DISPONIBLES.has(m.cle) ? <Text style={attenue}> · bientôt</Text> : null}
              </Text>
            </View>
          );
        })}
      </Panneau>
      <ReglagesPlanning theme={theme} client={client} detail={detail} onChange={onChange} />
      <MonProfil theme={theme} client={client} onExporter={onExporter} />
      {peut('team.delete') ? (
        <Panneau theme={theme}>
          <Intertitre theme={theme}>Zone sensible</Intertitre>
          <BoutonConfirme
            theme={theme}
            titre="Supprimer la team"
            confirmation={`Oui, supprimer « ${detail.team.nom} »`}
            onConfirme={() =>
              void agir('Suppression', async () => {
                await client.supprimerTeam(detail.team.id);
                onSupprimee();
              })
            }
            testID="esport-parametres-supprimer"
          />
        </Panneau>
      ) : null}
    </View>
  );
}

/** Profil Esport, mention des données, export et suppression (RGPD). */
export function MonProfil({ theme, client, onExporter, onSupprime }: { theme: ThemeHub; client: ClientEsport; onExporter?(nom: string, contenu: string): Promise<boolean>; onSupprime?(): void }) {
  const [profil, setProfil] = useState<{ pseudo: string; riotId: string; discord: string } | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    client.moi().then(m => setProfil({ pseudo: m.profil?.pseudo ?? '', riotId: m.profil?.riotId ?? '', discord: m.profil?.discord ?? '' }), () => undefined);
  }, [client]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  if (!profil) return null;
  return (
    <Panneau theme={theme} testID="esport-mon-profil">
      <Intertitre theme={theme}>Mon profil Esport</Intertitre>
      <Champ theme={theme} libelle="Pseudo (obligatoire)" valeur={profil.pseudo} onChanger={pseudo => setProfil({ ...profil, pseudo })} maxLength={24} testID="esport-profil-pseudo" />
      <Champ theme={theme} libelle="Riot ID (facultatif, Pseudo#TAG)" valeur={profil.riotId} onChanger={riotId => setProfil({ ...profil, riotId })} maxLength={22} testID="esport-profil-riot" />
      <Champ theme={theme} libelle="Discord (facultatif)" valeur={profil.discord} onChanger={discord => setProfil({ ...profil, discord })} maxLength={32} testID="esport-profil-discord" />
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          titre="Enregistrer le profil"
          variante="plein"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('Profil', async () => {
              await client.majProfil({ pseudo: profil.pseudo.trim(), riotId: profil.riotId.trim() || undefined, discord: profil.discord.trim() || undefined });
              return 'Profil enregistré.';
            })
          }
          testID="esport-profil-enregistrer"
        />
        {onExporter ? (
          <BoutonHub
            theme={theme}
            titre="Exporter mes données"
            onPress={() =>
              void agir('Export', async () => {
                const donnees = await client.exporterMesDonnees();
                const ok = await onExporter('esport-mes-donnees.json', JSON.stringify(donnees, null, 2));
                return ok ? 'Export enregistré.' : undefined;
              })
            }
            testID="esport-profil-exporter"
          />
        ) : null}
        <BoutonConfirme
          theme={theme}
          titre="Supprimer mes données Esport"
          confirmation="Oui, tout supprimer"
          onConfirme={() =>
            void agir('Suppression', async () => {
              await client.supprimerMesDonnees();
              onSupprime?.();
              return 'Vos données Esport sont supprimées.';
            })
          }
          testID="esport-profil-supprimer"
        />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-profil" />
      <Text style={attenue} testID="esport-mention">
        {MENTION_DONNEES}
      </Text>
    </Panneau>
  );
}
