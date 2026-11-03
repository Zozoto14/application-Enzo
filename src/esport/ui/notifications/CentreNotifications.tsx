/**
 * Centre de notifications de l'Esport (migration 0038, docs/esport/notifications.md).
 *
 *  - `ClocheNotifications` : cloche + pastille des non lues, dans l'en-tête de l'app (téléphone compris : pas de
 *    nouvelle entrée dans la barre du bas) ; `useCompteurNotifications` relit le compteur toutes les minutes, au
 *    retour sur l'onglet, et à chaque signal du temps réel (`signalerNotifications`).
 *  - `PageNotifications` : toutes les notifications que le rôle du compte permet de voir (le serveur filtre),
 *    regroupées par jour, icône par catégorie, team, auteur, date relative, lien direct, lu / non lu,
 *    « Tout marquer comme lu », défilement infini ; filtres (catégories, team, auteur, période, non lues, tri) et
 *    préférences enregistrées sur le compte (catégories suivies, « me notifier », teams suivies).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { BoutonHub, Case } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trNf, trnNf } from '../../i18n/notifications';
import { trRp } from '../../i18n/roles';
import { CATEGORIES_NOTIFICATIONS, apiNotifications, signalerNotifications, surNotifications, type CategorieNotification, type LienNotification, type NotificationCentre, type PageNotifications as Page, type PreferencesNotifications } from '../../notifications/api';
import { ICONES, bornesPeriode, dateRelative, grouperParJour, libelleCategorie, pastille, phraseCentre, titreJour, type Periode } from '../../notifications/logique';
import { Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Squelette, attenue, rayonControle, texte } from '../design';
import { useTempsReel } from '../../tempsReel/hooks';

const RAFRAICHISSEMENT_MS = 60_000;
const PAR_PAGE = 30;

const pageVisible = () => Platform.OS !== 'web' || (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState !== 'hidden';

/** Compteur des non lues (droits et préférences appliqués par le serveur). */
export function useCompteurNotifications(client: ClientEsport | undefined): { nonLues: number; relire(): void } {
  const [nonLues, setNonLues] = useState(0);
  const api = useMemo(() => (client ? apiNotifications(client) : undefined), [client]);
  const enCours = useRef(false);
  const relire = useCallback(() => {
    if (!api || enCours.current || !pageVisible()) return;
    enCours.current = true;
    Promise.resolve()
      .then(() => api.compteur())
      .then(r => setNonLues(Number(r?.nonLues ?? 0)))
      .catch(() => undefined)
      .finally(() => {
        enCours.current = false;
      });
  }, [api]);
  useEffect(() => {
    if (!api) return undefined;
    relire();
    const minuterie = setInterval(relire, RAFRAICHISSEMENT_MS);
    const doc = (globalThis as { document?: { addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void } }).document;
    doc?.addEventListener?.('visibilitychange', relire);
    const fin = surNotifications(n => (typeof n === 'number' ? setNonLues(n) : relire()));
    return () => {
      clearInterval(minuterie);
      doc?.removeEventListener?.('visibilitychange', relire);
      fin();
    };
  }, [api, relire]);
  // Temps réel (docs/esport/temps-reel.md) : notification créée ou lue ailleurs → compteur relu aussitôt.
  // Le signal commun relit aussi la page ouverte du centre (pas seulement la cloche).
  useTempsReel(client, 'compte', () => signalerNotifications());
  return { nonLues, relire };
}

/** Cloche de l'en-tête : ouvre le centre ; pastille des non lues (annoncée aux lecteurs d'écran). */
export function ClocheNotifications({ theme, n, actif, onPress }: { theme: ThemeHub; n: number; actif?: boolean; onPress(): void }) {
  const libelle = n > 0 ? trnNf('cloche_libelle', n) : trNf('cloche_libelle_zero');
  const texteP = pastille(n);
  return (
    <Pressable
      testID="esport-cloche"
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: Boolean(actif) }}
      onPress={onPress}
      hitSlop={6}
      style={etat => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : (etat as { hovered?: boolean }).hovered ? teinteTransparente(theme.attenue, 0.12) : 'transparent',
      })}>
      <Text style={{ fontSize: 20, color: actif ? theme.accent : theme.texte }}>🔔</Text>
      {texteP ? (
        <View testID="esport-cloche-pastille" style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: theme.critique, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800', ...police(theme.policeChiffres) }}>{texteP}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Pastille de filtre (bascule), 44 px de cible tactile. */
function Puce({ theme, libelle, actif, onPress, testID, glyphe }: { theme: ThemeHub; libelle: string; actif: boolean; onPress(): void; testID: string; glyphe?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: actif }}
      accessibilityLabel={libelle}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        paddingHorizontal: ESP.s,
        borderWidth: 1,
        borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme),
        borderColor: actif ? theme.accent : theme.ligne,
        backgroundColor: actif ? teinteTransparente(theme.accent, theme.sombre ? 0.22 : 0.14) : theme.surface,
      }}>
      {glyphe ? <Text style={{ color: actif ? theme.accent : theme.attenue, fontSize: 14 }}>{glyphe}</Text> : null}
      <Text style={{ ...texte(theme, 13), fontWeight: actif ? '700' : '500' }} numberOfLines={1}>
        {libelle}
      </Text>
    </Pressable>
  );
}

function Groupe({ theme, titre, children }: { theme: ThemeHub; titre: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: ESP.xs }}>
      <Text style={{ ...attenue(theme, 12), fontWeight: '700', letterSpacing: 0.6 }}>{titre}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>{children}</View>
    </View>
  );
}

interface Filtres {
  categories: CategorieNotification[];
  team?: string;
  auteur?: string;
  periode: Periode;
  nonLues: boolean;
  ordre: 'desc' | 'asc';
}
const FILTRES_VIDES: Filtres = { categories: [], periode: 'tout', nonLues: false, ordre: 'desc' };

/** Ligne d'une notification : icône, phrase, team, auteur, date relative ; appui = ouvrir (et marquer lue). */
function LigneNotification({ theme, n, noms, onOuvrir, onLue }: { theme: ThemeHub; n: NotificationCentre; noms: Record<string, string | null>; onOuvrir?(): void; onLue(): void }) {
  const phrase = phraseCentre(n, noms);
  const auteur = n.acteur ? (noms[n.acteur] ?? null) : null;
  const details = [n.team?.nom ?? (n.team ? null : trNf('club')), auteur ? trNf('par', { nom: auteur }) : null, dateRelative(n.date)].filter(Boolean).join(' · ');
  return (
    <View testID={`esport-notif-${n.id}`} style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', paddingVertical: ESP.s, borderTopWidth: 1, borderTopColor: theme.ligne }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, n.lue ? 0.06 : 0.16) }}>
        <Text style={{ fontSize: 16, color: n.lue ? theme.attenue : theme.accent }}>{ICONES[n.categorie] ?? '•'}</Text>
      </View>
      <Pressable
        style={{ flex: 1, minWidth: 0, gap: 2, minHeight: 44, justifyContent: 'center' }}
        accessibilityRole={onOuvrir ? 'link' : 'text'}
        accessibilityLabel={`${n.lue ? '' : `${trNf('non_lue')} · `}${phrase} · ${details}`}
        disabled={!onOuvrir}
        onPress={onOuvrir}
        testID={`esport-notif-${n.id}-ouvrir`}>
        <Text style={{ ...texte(theme, 15), fontWeight: n.lue ? '400' : '700' }}>{phrase}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESP.xs }}>
          <Text style={attenue(theme, 12)}>{libelleCategorie(n.categorie)}</Text>
          <Text style={attenue(theme, 12)} numberOfLines={1}>{`· ${details}`}</Text>
        </View>
      </Pressable>
      {n.lue ? null : (
        <Pressable testID={`esport-notif-${n.id}-lu`} accessibilityRole="button" accessibilityLabel={trNf('marquer_lu')} onPress={onLue} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent }} />
        </Pressable>
      )}
    </View>
  );
}

/** Préférences du compte : catégories suivies et « me notifier », teams suivies (enregistrées en base). */
function Preferences({ theme, prefs, teams, onChanger, enCours }: { theme: ThemeHub; prefs: PreferencesNotifications; teams: Array<{ id: string; nom: string }>; onChanger(p: Partial<PreferencesNotifications>): void; enCours: boolean }) {
  const basculer = <T,>(liste: T[], x: T) => (liste.includes(x) ? liste.filter(y => y !== x) : [...liste, x]);
  return (
    <Carte theme={theme} testID="esport-notifs-preferences" dense>
      <Text style={attenue(theme, 13)}>{trNf('preferences_aide')}</Text>
      <View style={{ gap: 2, opacity: enCours ? 0.6 : 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, paddingBottom: ESP.xxs }}>
          <Text style={{ flex: 1 }} />
          <Text style={{ ...attenue(theme, 12), width: 76, textAlign: 'center', fontWeight: '700' }}>{trNf('suivre')}</Text>
          <Text style={{ ...attenue(theme, 12), width: 76, textAlign: 'center', fontWeight: '700' }}>{trNf('me_notifier')}</Text>
        </View>
        {CATEGORIES_NOTIFICATIONS.map(c => {
          const suivie = !prefs.masquees.includes(c);
          const notifier = suivie && !prefs.silencieuses.includes(c);
          return (
            <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
              <Text style={{ width: 22, textAlign: 'center', color: theme.attenue }}>{ICONES[c]}</Text>
              <Text style={{ ...texte(theme, 14), flex: 1 }} numberOfLines={1}>
                {libelleCategorie(c)}
              </Text>
              <View style={{ width: 76, alignItems: 'center' }}>
                <Case theme={theme} coche={suivie} libelle={`${trNf('suivre')} : ${libelleCategorie(c)}`} onChanger={() => onChanger({ masquees: basculer(prefs.masquees, c) })} testID={`esport-notifs-suivre-${c}`} />
              </View>
              <View style={{ width: 76, alignItems: 'center', opacity: suivie ? 1 : 0.4 }}>
                <Case theme={theme} coche={notifier} libelle={`${trNf('me_notifier')} : ${libelleCategorie(c)}`} onChanger={() => suivie && onChanger({ silencieuses: basculer(prefs.silencieuses, c) })} testID={`esport-notifs-notifier-${c}`} />
              </View>
            </View>
          );
        })}
      </View>
      {teams.length > 1 ? (
        <Groupe theme={theme} titre={trNf('teams_suivies')}>
          {teams.map(t => (
            <Puce key={t.id} theme={theme} libelle={t.nom} actif={prefs.teams.includes(t.id)} onPress={() => onChanger({ teams: basculer(prefs.teams, t.id) })} testID={`esport-notifs-team-suivie-${t.id}`} />
          ))}
          <Text style={{ ...attenue(theme, 12), alignSelf: 'center' }}>{trNf('teams_suivies_aide')}</Text>
        </Groupe>
      ) : null}
    </Carte>
  );
}

export function PageNotifications({
  theme,
  client,
  large,
  fondateur,
  onOuvrir,
  avant,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  fondateur?: boolean;
  /** Ouvre l'élément (écran de l'app) ; rien si l'écran n'existe pas pour ce compte. */
  onOuvrir(lien: LienNotification, teamId: string | null): void;
  avant?: React.ReactNode;
}) {
  const api = useMemo(() => apiNotifications(client), [client]);
  const [page, setPage] = useState<Page | undefined>();
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [voirFiltres, setVoirFiltres] = useState(false);
  const [prefs, setPrefs] = useState<PreferencesNotifications | undefined>();
  const [voirPrefs, setVoirPrefs] = useState(false);
  const [suiteEnCours, setSuiteEnCours] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const demande = useRef(0);

  const requete = useCallback(
    (suite?: string) =>
      api.liste({
        categories: filtres.categories,
        team: filtres.team,
        auteur: filtres.auteur,
        ...bornesPeriode(filtres.periode),
        nonLues: filtres.nonLues,
        ordre: filtres.ordre,
        suite,
        limite: PAR_PAGE,
      }),
    [api, filtres],
  );

  const charger = useCallback(async () => {
    const n = ++demande.current;
    const p = await requete();
    if (n === demande.current) {
      setPage(p);
      signalerNotifications(p.nonLues);
    }
  }, [requete]);

  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel (ou lecture ailleurs) : la première page se relit, sans perdre les filtres.
  useEffect(() => surNotifications(n => (typeof n === 'number' ? undefined : void charger().catch(() => undefined))), [charger]);

  const suite = useCallback(async () => {
    if (!page?.suite || suiteEnCours) return;
    setSuiteEnCours(true);
    try {
      const n = demande.current;
      const p = await requete(page.suite);
      if (n === demande.current) setPage(a => (a ? { ...p, liste: [...a.liste, ...p.liste.filter(x => !a.liste.some(y => y.id === x.id))], noms: { ...a.noms, ...p.noms } } : p));
    } catch {
      // Réessai au prochain défilement.
    } finally {
      setSuiteEnCours(false);
    }
  }, [page, requete, suiteEnCours]);

  const marquer = useCallback(
    (ids: string[]) =>
      agir('lu', async () => {
        const r = await api.marquerLues(ids);
        setPage(a => (a ? { ...a, nonLues: r.nonLues, liste: a.liste.map(x => (ids.includes(x.id) ? { ...x, lue: true } : x)) } : a));
        signalerNotifications(r.nonLues);
      }),
    [agir, api],
  );

  const ouvrir = (n: NotificationCentre) => {
    if (!n.lue) void marquer([n.id]);
    if (n.lien) onOuvrir(n.lien, n.team?.id ?? null);
  };

  const ouvrirPrefs = () => {
    setVoirPrefs(v => !v);
    if (!prefs) void agir('', async () => setPrefs(await api.preferences()));
  };
  const changerPrefs = (p: Partial<PreferencesNotifications>) =>
    void agir('prefs', async () => {
      const r = await api.changerPreferences({ masquees: p.masquees, silencieuses: p.silencieuses, teams: p.teams });
      setPrefs(r);
      await charger();
      return trNf('enregistre');
    });

  const groupes = useMemo(() => grouperParJour(page?.liste ?? []), [page]);
  const auteurs = useMemo(() => {
    const ids = [...new Set((page?.liste ?? []).map(n => n.acteur).filter((x): x is string => Boolean(x)))];
    if (filtres.auteur && !ids.includes(filtres.auteur)) ids.unshift(filtres.auteur);
    return ids.map(id => ({ id, nom: page?.noms[id] ?? (id === 'principal' ? trRp('fondateur') : trRp('inconnu')) }));
  }, [page, filtres.auteur]);
  const filtresActifs = filtres.categories.length > 0 || Boolean(filtres.team) || Boolean(filtres.auteur) || filtres.periode !== 'tout' || filtres.nonLues || filtres.ordre !== 'desc';
  const changer = (f: Partial<Filtres>) => setFiltres(a => ({ ...a, ...f }));

  const surDefilement = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) void suite();
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      onScroll={surDefilement}
      scrollEventThrottle={200}
      testID="esport-notifications-page"
      contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.xl : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.xl : ESP.l, maxWidth: 920 + (large ? 2 * ESP.xxl : 2 * ESP.m), width: '100%', alignSelf: 'center' }}>
      <EnTetePage
        theme={theme}
        large={large}
        avant={avant}
        titre={trNf('titre')}
        sous={fondateur ? trNf('sous_fondateur') : trNf('sous')}
        action={
          <>
            <BoutonHub theme={theme} titre={voirFiltres ? trNf('filtres_masquer') : trNf('filtres')} onPress={() => setVoirFiltres(v => !v)} testID="esport-notifs-filtres" />
            <BoutonHub theme={theme} titre={voirPrefs ? trNf('preferences_masquer') : trNf('preferences')} onPress={ouvrirPrefs} testID="esport-notifs-prefs" />
            {page && page.nonLues > 0 ? (
              <BoutonHub
                theme={theme}
                titre={trNf('tout_lu')}
                variante="plein"
                onPress={() =>
                  void agir('tout', async () => {
                    const r = await api.toutMarquerLu();
                    setPage(a => (a ? { ...a, nonLues: r.nonLues, liste: a.liste.map(x => ({ ...x, lue: true })) } : a));
                    signalerNotifications(r.nonLues);
                  })
                }
                testID="esport-notifs-tout-lu"
              />
            ) : null}
          </>
        }
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-notifs" />
      {voirPrefs ? prefs ? <Preferences theme={theme} prefs={prefs} teams={page?.teams ?? []} onChanger={changerPrefs} enCours={enCours === 'prefs'} /> : <Squelette theme={theme} lignes={4} /> : null}
      {voirFiltres ? (
        <Carte theme={theme} dense testID="esport-notifs-panneau-filtres">
          <Groupe theme={theme} titre={trNf('categories')}>
            <Puce theme={theme} libelle={trNf('toutes_categories')} actif={!filtres.categories.length} onPress={() => changer({ categories: [] })} testID="esport-notifs-cat-toutes" />
            {CATEGORIES_NOTIFICATIONS.map(c => (
              <Puce
                key={c}
                theme={theme}
                glyphe={ICONES[c]}
                libelle={libelleCategorie(c)}
                actif={filtres.categories.includes(c)}
                onPress={() => changer({ categories: filtres.categories.includes(c) ? filtres.categories.filter(x => x !== c) : [...filtres.categories, c] })}
                testID={`esport-notifs-cat-${c}`}
              />
            ))}
          </Groupe>
          {(page?.teams.length ?? 0) > 1 ? (
            <Groupe theme={theme} titre={trNf('team')}>
              <Puce theme={theme} libelle={trNf('toutes_teams')} actif={!filtres.team} onPress={() => changer({ team: undefined })} testID="esport-notifs-team-toutes" />
              {page?.teams.map(t => (
                <Puce key={t.id} theme={theme} libelle={t.nom} actif={filtres.team === t.id} onPress={() => changer({ team: filtres.team === t.id ? undefined : t.id })} testID={`esport-notifs-team-${t.id}`} />
              ))}
            </Groupe>
          ) : null}
          {auteurs.length ? (
            <Groupe theme={theme} titre={trNf('auteur')}>
              <Puce theme={theme} libelle={trNf('tous_auteurs')} actif={!filtres.auteur} onPress={() => changer({ auteur: undefined })} testID="esport-notifs-auteur-tous" />
              {auteurs.map(a => (
                <Puce key={a.id} theme={theme} libelle={a.nom} actif={filtres.auteur === a.id} onPress={() => changer({ auteur: filtres.auteur === a.id ? undefined : a.id })} testID={`esport-notifs-auteur-${a.id}`} />
              ))}
            </Groupe>
          ) : null}
          <Groupe theme={theme} titre={trNf('periode')}>
            {(['tout', 'jour', 'semaine', 'mois'] as const).map(p => (
              <Puce key={p} theme={theme} libelle={trNf(`periode_${p}`)} actif={filtres.periode === p} onPress={() => changer({ periode: p })} testID={`esport-notifs-periode-${p}`} />
            ))}
          </Groupe>
          <Groupe theme={theme} titre={trNf('tri')}>
            <Puce theme={theme} libelle={trNf('tri_recent')} actif={filtres.ordre === 'desc'} onPress={() => changer({ ordre: 'desc' })} testID="esport-notifs-tri-desc" />
            <Puce theme={theme} libelle={trNf('tri_ancien')} actif={filtres.ordre === 'asc'} onPress={() => changer({ ordre: 'asc' })} testID="esport-notifs-tri-asc" />
            <Puce theme={theme} libelle={trNf('non_lues_seulement')} actif={filtres.nonLues} onPress={() => changer({ nonLues: !filtres.nonLues })} testID="esport-notifs-non-lues" />
          </Groupe>
          {filtresActifs ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub theme={theme} titre={trNf('effacer_filtres')} onPress={() => setFiltres(FILTRES_VIDES)} testID="esport-notifs-effacer" />
            </View>
          ) : null}
        </Carte>
      ) : filtresActifs ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
          {filtres.categories.map(c => (
            <Badge key={c} theme={theme} texte={libelleCategorie(c)} ton="accent" />
          ))}
          {filtres.nonLues ? <Badge theme={theme} texte={trNf('non_lues_seulement')} ton="accent" /> : null}
          <BoutonHub theme={theme} titre={trNf('effacer_filtres')} onPress={() => setFiltres(FILTRES_VIDES)} testID="esport-notifs-effacer" />
        </View>
      ) : null}
      {!page ? <Squelette theme={theme} lignes={6} testID="esport-notifs-chargement" /> : null}
      {page && !page.liste.length ? (
        <Carte theme={theme}>
          <EtatVide
            theme={theme}
            glyphe="🔔"
            titre={trNf('vide')}
            texte={filtresActifs ? trNf('vide_filtres') : trNf('vide_aide')}
            action={filtresActifs ? { titre: trNf('effacer_filtres'), onPress: () => setFiltres(FILTRES_VIDES), testID: 'esport-notifs-vide-effacer' } : undefined}
            testID="esport-notifs-vide"
          />
        </Carte>
      ) : null}
      {groupes.map(g => (
        <View key={g.jour} style={{ gap: ESP.xs }} testID={`esport-notifs-jour-${g.jour}`}>
          <Text accessibilityRole="header" style={{ ...attenue(theme, 13), fontWeight: '700', textTransform: 'capitalize' }}>
            {titreJour(g.jour)}
          </Text>
          <Carte theme={theme} dense style={{ gap: 0, paddingVertical: ESP.xxs }}>
            {g.elements.map(n => (
              <LigneNotification key={n.id} theme={theme} n={n} noms={page?.noms ?? {}} onOuvrir={n.lien ? () => ouvrir(n) : undefined} onLue={() => void marquer([n.id])} />
            ))}
          </Carte>
        </View>
      ))}
      {page?.suite ? (
        <View style={{ alignSelf: 'center' }}>
          <BoutonHub theme={theme} titre={suiteEnCours ? trNf('chargement') : trNf('plus')} onPress={() => void suite()} testID="esport-notifs-plus" />
        </View>
      ) : null}
    </ScrollView>
  );
}
