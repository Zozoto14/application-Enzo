/**
 * Tableau façon Trello de la section CM : listes côte à côte, cartes (couverture, étiquettes, statut du post,
 * réseaux, dates, compteurs, membres), recherche et filtres, archives.
 *
 * Déplacer une carte :
 *  - à la souris ou au doigt : la poignée « ⠿ » de la carte se saisit et se dépose dans une liste (un trait
 *    montre où la carte arrivera ; le tableau défile tout seul près des bords) ;
 *  - au clavier (et au lecteur d'écran) : menu « ⋯ » de la carte › Monter, Descendre, Liste précédente,
 *    Liste suivante, Déplacer vers… (liste et position).
 * Le serveur reçoit la liste et la position parmi TOUTES les cartes de la liste (même filtrées ou repliées).
 *
 * Rafraîchissement : la page relit la version du tableau (GET /cm/etat) ; s'il a changé ailleurs, il est
 * rechargé (sauf pendant un glisser-déposer).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions, type GestureResponderEvent, type PanResponderGestureState, type ViewStyle } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiCm, CarteResume, DetailTableau, ListeCm, StatutPost, TeamCm } from '../../cm/api';
import { minuscules } from '../../i18n';
import { trCm, trnCm } from '../../i18n/cm';
import { Retours, styles, useAgir } from '../commun';
import { Badge, ESP, MenuActions, Pliable, Volet, attenue, initiales, rayonCarte, texte, type ActionSecondaire, type EtatPresse } from '../design';
import { BadgeStatut, FUSEAU_CLUB, PastilleReseau, nomListe, nomStatut, nomTableau, quand } from './commun';
import { FicheCarte } from './FicheCarte';

type FiltreEcheance = 'toutes' | 'retard' | 'semaine' | 'sans';
type FiltreType = 'tout' | 'posts' | 'cartes';
interface Filtres {
  q: string;
  etiquettes: string[];
  membres: string[];
  echeance: FiltreEcheance;
  type: FiltreType;
  statut: StatutPost | '';
}
const FILTRES_VIDES: Filtres = { q: '', etiquettes: [], membres: [], echeance: 'toutes', type: 'tout', statut: '' };
const PAR_LISTE = 60;

interface Rect {
  x: number;
  y: number;
  l: number;
  h: number;
}
interface Glisse {
  carteId: string;
  pret: boolean;
  conteneur: Rect;
  carte: Rect;
  decalage: { x: number; y: number };
  scrollDepart: number;
  listes: Array<Rect & { id: string }>;
  cartes: Map<string, Array<Rect & { id: string }>>;
}

type Vue = React.ComponentRef<typeof View>;

const mesurer = (v: Vue | null | undefined): Promise<Rect | null> =>
  new Promise(ok => {
    if (!v || typeof v.measureInWindow !== 'function') return ok(null);
    try {
      v.measureInWindow((x: number, y: number, l: number, h: number) => ok(Number.isFinite(x) && l > 0 ? { x, y, l, h } : null));
    } catch {
      ok(null);
    }
  });

/** Carte visible avec les filtres ? */
export function carteVisible(c: CarteResume, f: Filtres, maintenant: number, noms: Record<string, string | null>): boolean {
  if (f.q.trim()) {
    const q = minuscules(f.q.trim());
    if (!minuscules(c.titre).includes(q) && !c.membres.some(m => minuscules(noms[m] ?? '').includes(q))) return false;
  }
  if (f.etiquettes.length && !f.etiquettes.some(e => c.etiquettes.includes(e))) return false;
  if (f.membres.length && !f.membres.some(m => c.membres.includes(m))) return false;
  if (f.type === 'posts' && !c.post) return false;
  if (f.type === 'cartes' && c.post) return false;
  if (f.statut && c.statut !== f.statut) return false;
  const date = c.echeance ? Date.parse(c.echeance) : NaN;
  if (f.echeance === 'sans' && c.echeance) return false;
  if (f.echeance === 'retard' && !(date < maintenant && !c.echeanceFaite)) return false;
  if (f.echeance === 'semaine' && !(date >= maintenant && date < maintenant + 7 * 86_400_000)) return false;
  return true;
}

/** Position parmi toutes les cartes de la liste (serveur) d'une insertion à `indexVisible` parmi les cartes affichées. */
export function indexServeur(toutes: CarteResume[], visibles: CarteResume[], indexVisible: number): number {
  const apres = visibles[indexVisible];
  if (apres) return Math.max(0, toutes.findIndex(c => c.id === apres.id));
  const derniere = visibles[visibles.length - 1];
  return derniere ? toutes.findIndex(c => c.id === derniere.id) + 1 : toutes.length;
}

export function Tableau({
  theme,
  api,
  id,
  large,
  versionServeur,
  teams = [],
  onRetour,
  testID = 'esport-cm-tableau',
}: {
  theme: ThemeHub;
  api: ApiCm;
  id: string;
  large: boolean;
  /** Version connue du serveur (GET /cm/etat) : recharge le tableau s'il a changé ailleurs. */
  versionServeur?: number;
  /** Teams liables à une carte (tableau du club). */
  teams?: TeamCm[];
  onRetour?(): void;
  testID?: string;
}) {
  const { width } = useWindowDimensions();
  const [d, setD] = useState<DetailTableau | undefined>();
  const [archives, setArchives] = useState(false);
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [ouverte, setOuverte] = useState<string | undefined>();
  const [ajout, setAjout] = useState<string | undefined>();
  const [titreAjout, setTitreAjout] = useState('');
  const [nouvelleListe, setNouvelleListe] = useState<string | undefined>();
  const [renommer, setRenommer] = useState<{ id: string; nom: string } | undefined>();
  const [deplacer, setDeplacer] = useState<CarteResume | undefined>();
  const [limites, setLimites] = useState<Record<string, number>>({});
  const [fantome, setFantome] = useState<{ x: number; y: number; l: number; carte: CarteResume } | undefined>();
  const [cible, setCible] = useState<{ listeId: string; index: number } | undefined>();
  const cibleRef = useRef<{ listeId: string; index: number } | undefined>(undefined);
  const [annonce, setAnnonce] = useState('');
  const { erreur, avis, agir, setErreur } = useAgir();
  const glisse = useRef<Glisse | null>(null);
  const conteneur = useRef<Vue>(null);
  const defilement = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollX = useRef(0);
  const refsListes = useRef(new Map<string, Vue>());
  const refsCartes = useRef(new Map<string, Vue>());
  const largeurListe = large ? 284 : Math.max(240, Math.min(320, width - 56));

  const recharger = useCallback(async () => setD(await api.tableau(id, archives)), [api, id, archives]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Changement ailleurs (autre utilisateur, suggestion automatique…) : rechargé, sauf pendant un glisser-déposer.
  useEffect(() => {
    if (d && versionServeur !== undefined && versionServeur > d.tableau.version && !glisse.current) void recharger().catch(() => undefined);
  }, [versionServeur, d, recharger]);

  const maintenant = Date.now();
  const etiquettes = useMemo(() => new Map((d?.etiquettes ?? []).map(e => [e.id, e])), [d]);
  const parListe = useMemo(() => {
    const m = new Map<string, CarteResume[]>();
    for (const c of d?.cartes ?? []) {
      if (!m.has(c.listeId)) m.set(c.listeId, []);
      m.get(c.listeId)!.push(c);
    }
    for (const l of m.values()) l.sort((a, b) => a.position - b.position);
    return m;
  }, [d]);
  const visibles = useCallback((listeId: string) => (parListe.get(listeId) ?? []).filter(c => carteVisible(c, filtres, maintenant, d?.noms ?? {})), [parListe, filtres, maintenant, d]);
  const listes = useMemo(() => d?.listes ?? [], [d]);
  const nbFiltres = (filtres.q.trim() ? 1 : 0) + filtres.etiquettes.length + filtres.membres.length + (filtres.echeance !== 'toutes' ? 1 : 0) + (filtres.type !== 'tout' ? 1 : 0) + (filtres.statut ? 1 : 0);

  /** Déplace une carte (index parmi toutes les cartes de la liste, sans elle) : local d'abord, puis le serveur. */
  const deplacerCarte = useCallback(
    (carte: CarteResume, listeId: string, index: number) => {
      if (!d) return;
      const toutes = (parListe.get(listeId) ?? []).filter(c => c.id !== carte.id && !c.archive);
      const avant = index > 0 ? toutes[index - 1]?.position : undefined;
      const apres = toutes[index]?.position;
      const position = avant === undefined ? (apres === undefined ? 1024 : apres - 1024) : apres === undefined ? avant + 1024 : (avant + apres) / 2;
      setD({ ...d, cartes: d.cartes.map(c => (c.id === carte.id ? { ...c, listeId, position } : c)) });
      const liste = listes.find(l => l.id === listeId);
      setAnnonce(trCm('tableau.annonce_deplacee', { titre: carte.titre, liste: liste ? nomListe(liste) : '', position: index + 1 }));
      void agir('deplacer', async () => {
        await api.deplacerCarte(carte.id, { listeId, index });
        await recharger();
      });
    },
    [d, parListe, listes, agir, api, recharger],
  );

  // ---------------------------------------------------------------- Glisser-déposer (souris et doigt)

  const debut = useCallback(
    async (carte: CarteResume, px: number, py: number) => {
      const conteneurRect = await mesurer(conteneur.current);
      const carteRect = await mesurer(refsCartes.current.get(carte.id));
      if (!conteneurRect || !carteRect) return;
      const g: Glisse = { carteId: carte.id, pret: false, conteneur: conteneurRect, carte: carteRect, decalage: { x: px - carteRect.x, y: py - carteRect.y }, scrollDepart: scrollX.current, listes: [], cartes: new Map() };
      glisse.current = g;
      for (const l of listes) {
        const r = await mesurer(refsListes.current.get(l.id));
        if (r) g.listes.push({ ...r, id: l.id });
        const rects: Array<Rect & { id: string }> = [];
        for (const c of visibles(l.id)) {
          if (c.id === carte.id) continue;
          const rc = await mesurer(refsCartes.current.get(c.id));
          if (rc) rects.push({ ...rc, id: c.id });
        }
        g.cartes.set(l.id, rects);
      }
      if (glisse.current !== g) return;
      g.pret = true;
      setFantome({ x: carteRect.x - conteneurRect.x, y: carteRect.y - conteneurRect.y, l: carteRect.l, carte });
    },
    [listes, visibles],
  );

  const bouge = useCallback((px: number, py: number) => {
    const g = glisse.current;
    if (!g?.pret) return;
    // Défilement automatique près des bords du tableau.
    const bord = 56;
    if (px < g.conteneur.x + bord) defilement.current?.scrollTo({ x: Math.max(0, scrollX.current - 28), animated: false });
    else if (px > g.conteneur.x + g.conteneur.l - bord) defilement.current?.scrollTo({ x: scrollX.current + 28, animated: false });
    const dx = scrollX.current - g.scrollDepart;
    setFantome(f => (f ? { ...f, x: px - g.conteneur.x - g.decalage.x, y: py - g.conteneur.y - g.decalage.y } : f));
    const liste = g.listes.find(l => px >= l.x - dx && px <= l.x - dx + l.l);
    if (!liste) {
      cibleRef.current = undefined;
      setCible(c => (c ? undefined : c));
      return;
    }
    const index = (g.cartes.get(liste.id) ?? []).filter(r => r.y + r.h / 2 < py).length;
    if (cibleRef.current?.listeId === liste.id && cibleRef.current.index === index) return;
    cibleRef.current = { listeId: liste.id, index };
    setCible(cibleRef.current);
  }, []);

  const fin = useCallback(
    (annuler: boolean) => {
      const g = glisse.current;
      const c = cibleRef.current;
      glisse.current = null;
      cibleRef.current = undefined;
      setFantome(undefined);
      setCible(undefined);
      if (annuler || !g?.pret || !c) return;
      const carte = d?.cartes.find(x => x.id === g.carteId);
      if (!carte) return;
      const toutes = (parListe.get(c.listeId) ?? []).filter(x => x.id !== carte.id && !x.archive);
      const vues = visibles(c.listeId).filter(x => x.id !== carte.id);
      deplacerCarte(carte, c.listeId, indexServeur(toutes, vues, c.index));
    },
    [d, parListe, visibles, deplacerCarte],
  );

  // ---------------------------------------------------------------- Actions

  const creerCarte = (listeId: string, post: boolean) =>
    agir('carte', async () => {
      if (!titreAjout.trim()) return;
      await api.creerCarte(id, { listeId, titre: titreAjout.trim(), post });
      setTitreAjout('');
      await recharger();
    });

  const actionsCarte = (c: CarteResume, l: ListeCm, i: number, vues: CarteResume[]): ActionSecondaire[] => {
    if (!d?.droits.editer) return [{ titre: trCm('carte.ouvrir'), onPress: () => setOuverte(c.id), testID: `esport-cm-carte-${c.id}-ouvrir` }];
    const toutes = (parListe.get(l.id) ?? []).filter(x => x.id !== c.id && !x.archive);
    const li = listes.findIndex(x => x.id === l.id);
    return [
      { titre: trCm('carte.ouvrir'), onPress: () => setOuverte(c.id), testID: `esport-cm-carte-${c.id}-ouvrir` },
      ...(i > 0 ? [{ titre: trCm('carte.monter'), onPress: () => deplacerCarte(c, l.id, indexServeur(toutes, vues.filter(x => x.id !== c.id), i - 1)), testID: `esport-cm-carte-${c.id}-monter` }] : []),
      ...(i < vues.length - 1 ? [{ titre: trCm('carte.descendre'), onPress: () => deplacerCarte(c, l.id, indexServeur(toutes, vues.filter(x => x.id !== c.id), i + 1)), testID: `esport-cm-carte-${c.id}-descendre` }] : []),
      ...(li > 0 ? [{ titre: trCm('carte.liste_precedente'), onPress: () => deplacerCarte(c, listes[li - 1].id, (parListe.get(listes[li - 1].id) ?? []).filter(x => !x.archive).length), testID: `esport-cm-carte-${c.id}-gauche` }] : []),
      ...(li < listes.length - 1 ? [{ titre: trCm('carte.liste_suivante'), onPress: () => deplacerCarte(c, listes[li + 1].id, (parListe.get(listes[li + 1].id) ?? []).filter(x => !x.archive).length), testID: `esport-cm-carte-${c.id}-droite` }] : []),
      { titre: trCm('carte.deplacer_vers'), onPress: () => setDeplacer(c), testID: `esport-cm-carte-${c.id}-deplacer` },
      {
        titre: c.archive ? trCm('carte.restaurer') : trCm('carte.archiver'),
        onPress: () =>
          void agir('archiver', async () => {
            await api.modifierCarte(c.id, { archive: !c.archive });
            await recharger();
          }),
        testID: `esport-cm-carte-${c.id}-archiver`,
      },
    ];
  };

  const actionsListe = (l: ListeCm, i: number): ActionSecondaire[] =>
    d?.droits.editer
      ? [
          { titre: trCm('liste.renommer'), onPress: () => setRenommer({ id: l.id, nom: nomListe(l) }), testID: `esport-cm-liste-${l.id}-renommer` },
          ...(i > 0 ? [{ titre: trCm('liste.gauche'), onPress: () => void agir('liste', async () => { await api.deplacerListe(l.id, i - 1); await recharger(); }), testID: `esport-cm-liste-${l.id}-gauche` }] : []),
          ...(i < listes.length - 1 ? [{ titre: trCm('liste.droite'), onPress: () => void agir('liste', async () => { await api.deplacerListe(l.id, i + 1); await recharger(); }), testID: `esport-cm-liste-${l.id}-droite` }] : []),
          {
            titre: l.archive ? trCm('liste.restaurer') : trCm('liste.archiver'),
            onPress: () =>
              void agir('liste', async () => {
                await api.modifierListe(l.id, { archive: !l.archive });
                await recharger();
              }),
            testID: `esport-cm-liste-${l.id}-archiver`,
          },
        ]
      : [];

  if (!d) {
    return (
      <View testID={testID} style={{ gap: ESP.s }}>
        <Retours theme={theme} erreur={erreur} prefixe="esport-cm-tableau" />
        {!erreur ? <Text style={attenue(theme)}>{trCm('c.chargement')}</Text> : null}
      </View>
    );
  }

  const t = d.tableau;
  return (
    <View testID={testID} style={{ gap: ESP.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: ESP.s, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexShrink: 1, minWidth: 0 }}>
          {onRetour ? <BoutonHub theme={theme} titre="‹" libelle={trCm('tableau.retour')} onPress={onRetour} testID="esport-cm-tableau-retour" /> : null}
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.couleur }} />
          <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '800', flexShrink: 1 }} numberOfLines={1} testID="esport-cm-tableau-nom">
            {nomTableau(t)}
          </Text>
          {t.team ? <Badge theme={theme} texte={t.team.nom ?? ''} /> : <Badge theme={theme} ton="accent" texte={trCm('portee.club')} />}
          {t.trello ? <Badge theme={theme} texte="Trello" /> : null}
        </View>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          {d.droits.editer ? <BoutonHub theme={theme} titre={trCm('liste.nouvelle')} onPress={() => setNouvelleListe('')} testID="esport-cm-liste-nouvelle" /> : null}
          <MenuActions
            theme={theme}
            testID="esport-cm-tableau-menu"
            actions={[
              { titre: archives ? trCm('tableau.masquer_archives') : trCm('tableau.voir_archives'), onPress: () => setArchives(a => !a), testID: 'esport-cm-tableau-archives' },
              d.droits.gerer && { titre: trCm('tableau.renommer'), onPress: () => setRenommer({ id: t.id, nom: nomTableau(t) }), testID: 'esport-cm-tableau-renommer' },
              d.droits.gerer &&
                !t.cleDefaut && {
                  titre: trCm('tableau.supprimer'),
                  danger: true,
                  onPress: () =>
                    void agir('supprimer', async () => {
                      await api.supprimerTableau(t.id);
                      onRetour?.();
                    }),
                  testID: 'esport-cm-tableau-supprimer',
                },
            ]}
          />
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-tableau" />
      <Pliable theme={theme} titre={trCm('filtres.titre')} resume={nbFiltres ? trnCm('filtres.actifs', nbFiltres) : undefined} testID="esport-cm-filtres">
        <Champ theme={theme} libelle={trCm('filtres.recherche')} valeur={filtres.q} onChanger={q => setFiltres(f => ({ ...f, q }))} maxLength={80} testID="esport-cm-filtre-q" />
        {d.etiquettes.length ? (
          <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityLabel={trCm('filtres.etiquettes')}>
            {d.etiquettes.map(e => {
              const actif = filtres.etiquettes.includes(e.id);
              return (
                <Pressable
                  key={e.id}
                  testID={`esport-cm-filtre-etiquette-${e.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: actif }}
                  accessibilityLabel={e.nom || trCm('etiquette.sans_nom')}
                  onPress={() => setFiltres(f => ({ ...f, etiquettes: actif ? f.etiquettes.filter(x => x !== e.id) : [...f.etiquettes, e.id] }))}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <View style={{ backgroundColor: e.couleur, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 2, borderColor: actif ? theme.texte : 'transparent' }}>
                    <Text style={{ color: '#172b4d', fontSize: 13, fontWeight: '700' }}>{e.nom || ' '}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {d.personnes.length ? (
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            {d.personnes.map(p => {
              const actif = filtres.membres.includes(p.compte);
              return (
                <Pressable
                  key={p.compte}
                  testID={`esport-cm-filtre-membre-${p.compte}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: actif }}
                  accessibilityLabel={p.pseudo}
                  onPress={() => setFiltres(f => ({ ...f, membres: actif ? f.membres.filter(x => x !== p.compte) : [...f.membres, p.compte] }))}
                  style={[styles.choix, { borderColor: actif ? theme.accent : theme.ligne, borderRadius: 10, backgroundColor: actif ? teinteTransparente(theme.accent, 0.15) : theme.surface }]}>
                  <Text style={texte(theme, 13)}>{p.pseudo}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Segments
          theme={theme}
          libelle={trCm('filtres.echeance')}
          valeur={filtres.echeance}
          options={[
            ['toutes', trCm('filtres.echeance.toutes')],
            ['retard', trCm('filtres.echeance.retard')],
            ['semaine', trCm('filtres.echeance.semaine')],
            ['sans', trCm('filtres.echeance.sans')],
          ]}
          onChoisir={echeance => setFiltres(f => ({ ...f, echeance }))}
          testID="esport-cm-filtre-echeance"
        />
        <Segments
          theme={theme}
          libelle={trCm('filtres.type')}
          valeur={filtres.type}
          options={[
            ['tout', trCm('filtres.type.tout')],
            ['posts', trCm('filtres.type.posts')],
            ['cartes', trCm('filtres.type.cartes')],
          ]}
          onChoisir={type => setFiltres(f => ({ ...f, type }))}
          testID="esport-cm-filtre-type"
        />
        {nbFiltres ? <BoutonHub theme={theme} titre={trCm('filtres.effacer')} onPress={() => setFiltres(FILTRES_VIDES)} testID="esport-cm-filtres-effacer" /> : null}
      </Pliable>
      {/* Annonce des déplacements pour les lecteurs d'écran. */}
      <Text accessibilityLiveRegion="polite" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }} testID="esport-cm-annonce">
        {annonce}
      </Text>
      <View ref={conteneur} style={{ position: 'relative' }}>
        <ScrollView
          ref={defilement}
          horizontal
          scrollEnabled={!fantome}
          onScroll={e => {
            scrollX.current = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
          snapToInterval={large ? undefined : largeurListe + ESP.s}
          decelerationRate={large ? undefined : 'fast'}
          contentContainerStyle={{ gap: ESP.s, alignItems: 'flex-start', paddingBottom: ESP.s }}
          testID="esport-cm-listes">
          {listes.map((l, li) => {
            const vues = visibles(l.id);
            const limite = limites[l.id] ?? PAR_LISTE;
            return (
              <View
                key={l.id}
                ref={r => {
                  if (r) refsListes.current.set(l.id, r);
                  else refsListes.current.delete(l.id);
                }}
                testID={`esport-cm-liste-${l.cle ?? l.id}`}
                accessibilityLabel={trCm('liste.libelle', { nom: nomListe(l), n: vues.length })}
                style={{
                  width: largeurListe,
                  backgroundColor: teinteTransparente(theme.attenue, theme.sombre ? 0.14 : 0.08),
                  borderRadius: rayonCarte(theme),
                  padding: ESP.s,
                  gap: ESP.xs,
                  opacity: l.archive ? 0.6 : 1,
                  borderWidth: cible?.listeId === l.id ? 2 : 0,
                  borderColor: theme.accent,
                }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
                  <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '700', flex: 1 }} numberOfLines={1}>
                    {nomListe(l)}
                  </Text>
                  <Text style={attenue(theme)}>{String(vues.length)}</Text>
                  {actionsListe(l, li).length ? <MenuActions theme={theme} testID={`esport-cm-liste-${l.cle ?? l.id}-menu`} actions={actionsListe(l, li)} /> : null}
                </View>
                {vues.slice(0, limite).map((c, i) => (
                  <React.Fragment key={c.id}>
                    {cible?.listeId === l.id && cible.index === i ? <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.accent }} testID="esport-cm-depot-ici" /> : null}
                    <View
                      ref={r => {
                        if (r) refsCartes.current.set(c.id, r);
                        else refsCartes.current.delete(c.id);
                      }}
                      style={{ opacity: fantome?.carte.id === c.id ? 0.35 : 1 }}>
                      <TuileCarte
                        theme={theme}
                        carte={c}
                        d={d}
                        etiquettes={etiquettes}
                        maintenant={maintenant}
                        onOuvrir={() => setOuverte(c.id)}
                        actions={actionsCarte(c, l, i, vues)}
                        glisser={d.droits.editer ? { debut: (x, y) => void debut(c, x, y), bouge, fin } : undefined}
                      />
                    </View>
                  </React.Fragment>
                ))}
                {cible?.listeId === l.id && cible.index >= Math.min(vues.length, limite) ? <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.accent }} testID="esport-cm-depot-ici" /> : null}
                {vues.length > limite ? (
                  <BoutonHub theme={theme} titre={trCm('liste.plus', { n: vues.length - limite })} onPress={() => setLimites(x => ({ ...x, [l.id]: limite + PAR_LISTE }))} testID={`esport-cm-liste-${l.id}-plus`} />
                ) : null}
                {d.droits.editer && !l.archive ? (
                  ajout === l.id ? (
                    <View style={{ gap: ESP.xs }}>
                      <Champ theme={theme} libelle={trCm('carte.titre')} valeur={titreAjout} onChanger={setTitreAjout} maxLength={200} testID={`esport-cm-ajout-${l.cle ?? l.id}-titre`} />
                      <View style={[styles.ligne, { gap: ESP.xs }]}>
                        <BoutonHub theme={theme} titre={trCm('carte.ajouter_carte')} variante="plein" desactive={!titreAjout.trim()} onPress={() => void creerCarte(l.id, false)} testID={`esport-cm-ajout-${l.cle ?? l.id}-carte`} />
                        <BoutonHub theme={theme} titre={trCm('carte.ajouter_post')} desactive={!titreAjout.trim()} onPress={() => void creerCarte(l.id, true)} testID={`esport-cm-ajout-${l.cle ?? l.id}-post`} />
                        <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setAjout(undefined)} testID={`esport-cm-ajout-${l.cle ?? l.id}-annuler`} />
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      testID={`esport-cm-ajout-${l.cle ?? l.id}`}
                      accessibilityRole="button"
                      onPress={() => {
                        setTitreAjout('');
                        setAjout(l.id);
                      }}
                      style={(e: EtatPresse) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: ESP.xs, borderRadius: 8, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.attenue, 0.15) : 'transparent' })}>
                      <Text style={{ ...texte(theme, 14), color: theme.attenue }}>{trCm('carte.ajouter')}</Text>
                    </Pressable>
                  )
                ) : null}
              </View>
            );
          })}
        </ScrollView>
        {fantome ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: fantome.x, top: fantome.y, width: fantome.l, transform: [{ rotate: '2deg' }], opacity: 0.95 }} testID="esport-cm-fantome">
            <TuileCarte theme={theme} carte={fantome.carte} d={d} etiquettes={etiquettes} maintenant={maintenant} onOuvrir={() => undefined} actions={[]} />
          </View>
        ) : null}
      </View>

      {ouverte ? (
        <Volet theme={theme} visible titre={trCm('carte.titre_volet')} onFermer={() => setOuverte(undefined)} testID="esport-cm-fiche" largeur={large ? 760 : 560}>
          <FicheCarte
            theme={theme}
            api={api}
            id={ouverte}
            large={large}
            tableau={d}
            teams={teams}
            fuseau={FUSEAU_CLUB}
            onChange={() => void recharger().catch(() => undefined)}
            onFermer={() => setOuverte(undefined)}
          />
        </Volet>
      ) : null}

      {deplacer ? (
        <Volet theme={theme} visible titre={trCm('carte.deplacer_vers')} onFermer={() => setDeplacer(undefined)} testID="esport-cm-deplacer">
          <Text style={texte(theme)}>{deplacer.titre}</Text>
          {listes
            .filter(l => !l.archive)
            .map(l => {
              const nb = (parListe.get(l.id) ?? []).filter(x => x.id !== deplacer.id && !x.archive).length;
              return (
                <View key={l.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
                  <Text style={{ ...texte(theme), flex: 1 }}>{nomListe(l)}</Text>
                  <BoutonHub
                    theme={theme}
                    titre={trCm('carte.en_haut')}
                    libelle={trCm('carte.en_haut_de', { liste: nomListe(l) })}
                    onPress={() => {
                      deplacerCarte(deplacer, l.id, 0);
                      setDeplacer(undefined);
                    }}
                    testID={`esport-cm-deplacer-${l.cle ?? l.id}-haut`}
                  />
                  <BoutonHub
                    theme={theme}
                    titre={trCm('carte.en_bas')}
                    libelle={trCm('carte.en_bas_de', { liste: nomListe(l) })}
                    onPress={() => {
                      deplacerCarte(deplacer, l.id, nb);
                      setDeplacer(undefined);
                    }}
                    testID={`esport-cm-deplacer-${l.cle ?? l.id}-bas`}
                  />
                </View>
              );
            })}
        </Volet>
      ) : null}

      {nouvelleListe !== undefined ? (
        <Volet theme={theme} visible titre={trCm('liste.nouvelle_titre')} onFermer={() => setNouvelleListe(undefined)} testID="esport-cm-liste-volet">
          <Champ theme={theme} libelle={trCm('c.nom')} valeur={nouvelleListe} onChanger={setNouvelleListe} maxLength={80} testID="esport-cm-liste-nom" />
          <BoutonHub
            theme={theme}
            titre={trCm('c.creer')}
            variante="plein"
            desactive={!nouvelleListe.trim()}
            onPress={() =>
              void agir('liste', async () => {
                await api.creerListe(id, nouvelleListe.trim());
                setNouvelleListe(undefined);
                await recharger();
              })
            }
            testID="esport-cm-liste-creer"
          />
        </Volet>
      ) : null}

      {renommer ? (
        <Volet theme={theme} visible titre={trCm('c.renommer')} onFermer={() => setRenommer(undefined)} testID="esport-cm-renommer">
          <Champ theme={theme} libelle={trCm('c.nom')} valeur={renommer.nom} onChanger={nom => setRenommer({ ...renommer, nom })} maxLength={80} testID="esport-cm-renommer-nom" />
          <BoutonHub
            theme={theme}
            titre={trCm('c.enregistrer')}
            variante="plein"
            desactive={!renommer.nom.trim()}
            onPress={() =>
              void agir('renommer', async () => {
                if (renommer.id === t.id) await api.modifierTableau(t.id, { nom: renommer.nom.trim() });
                else await api.modifierListe(renommer.id, { nom: renommer.nom.trim() });
                setRenommer(undefined);
                setErreur(undefined);
                await recharger();
              })
            }
            testID="esport-cm-renommer-ok"
          />
        </Volet>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Tuile d'une carte

function TuileCarte({
  theme,
  carte: c,
  d,
  etiquettes,
  maintenant,
  onOuvrir,
  actions,
  glisser,
}: {
  theme: ThemeHub;
  carte: CarteResume;
  d: DetailTableau;
  etiquettes: Map<string, { nom: string; couleur: string }>;
  maintenant: number;
  onOuvrir(): void;
  actions: ActionSecondaire[];
  glisser?: { debut(x: number, y: number): void; bouge(x: number, y: number): void; fin(annuler: boolean): void };
}) {
  const retard = c.echeance && !c.echeanceFaite && Date.parse(c.echeance) < maintenant;
  return (
    <View
      style={{ backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 10), borderWidth: 1, borderColor: theme.ligne, overflow: 'hidden' }}
      testID={`esport-cm-carte-${c.id}`}>
      {c.couverture?.couleur ? <View style={{ height: 24, backgroundColor: c.couverture.couleur }} /> : null}
      {c.couverture?.image ? <Image source={{ uri: c.couverture.image }} style={{ height: 96, width: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[c.titre, c.statut ? nomStatut(c.statut) : '', c.archive ? trCm('c.archivee') : ''].filter(Boolean).join(', ')}
          onPress={onOuvrir}
          testID={`esport-cm-carte-${c.id}-tuile`}
          style={(e: EtatPresse) => ({ flex: 1, padding: ESP.s, gap: 6, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.06) : 'transparent' })}>
          {c.etiquettes.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {c.etiquettes.map(eid => {
                const e = etiquettes.get(eid);
                return e ? (
                  <View key={eid} style={{ backgroundColor: e.couleur, borderRadius: 4, paddingHorizontal: 6, minHeight: 8, minWidth: 32, justifyContent: 'center' }}>
                    {e.nom ? <Text style={{ color: '#172b4d', fontSize: 11, fontWeight: '700' }}>{e.nom}</Text> : null}
                  </View>
                ) : null;
              })}
            </View>
          ) : null}
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={4}>
            {c.titre}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {c.post ? <BadgeStatut theme={theme} statut={c.statut} testID={`esport-cm-carte-${c.id}-statut`} /> : null}
            {c.reseaux.map(r => (
              <PastilleReseau key={r} theme={theme} reseau={r} compact />
            ))}
            {c.datePublication ? <Text style={attenue(theme, 12)} accessibilityLabel={trCm('carte.publication_le', { date: quand(c.datePublication) })}>{`◷ ${quand(c.datePublication)}`}</Text> : null}
            {c.echeance ? (
              <Text style={{ ...attenue(theme, 12), color: c.echeanceFaite ? theme.ok : retard ? theme.critique : theme.attenue, fontWeight: retard ? '700' : '400' }} accessibilityLabel={trCm('carte.echeance_le', { date: quand(c.echeance) })}>
                {`⚑ ${quand(c.echeance)}`}
              </Text>
            ) : null}
            {c.description ? <Text style={attenue(theme, 12)} accessibilityLabel={trCm('carte.a_description')}>≡</Text> : null}
            {c.commentaires ? <Text style={attenue(theme, 12)} accessibilityLabel={trnCm('carte.commentaires_n', c.commentaires)}>{`❝ ${c.commentaires}`}</Text> : null}
            {c.checklist.total ? (
              <Text style={{ ...attenue(theme, 12), color: c.checklist.faits === c.checklist.total ? theme.ok : theme.attenue }} accessibilityLabel={trCm('carte.checklist_n', { faits: c.checklist.faits, total: c.checklist.total })}>
                {`☑ ${c.checklist.faits}/${c.checklist.total}`}
              </Text>
            ) : null}
            {c.pieces ? <Text style={attenue(theme, 12)} accessibilityLabel={trnCm('carte.pieces_n', c.pieces)}>{`⎘ ${c.pieces}`}</Text> : null}
            {c.origine === 'depot' ? <Badge theme={theme} texte={trCm('carte.depot')} /> : null}
            {c.origine === 'suggestion' ? <Badge theme={theme} texte={trCm('carte.suggestion')} /> : null}
          </View>
          {c.membres.length ? (
            <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'flex-end' }}>
              {c.membres.slice(0, 5).map(m => (
                <View key={m} accessibilityLabel={d.noms[m] ?? ''} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: teinteTransparente(theme.accent, 0.25), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.texte, fontSize: 10, fontWeight: '800' }}>{initiales(d.noms[m] ?? '?')}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          {glisser ? <Poignee theme={theme} titre={c.titre} glisser={glisser} testID={`esport-cm-carte-${c.id}-poignee`} /> : null}
          {actions.length ? <MenuActions theme={theme} actions={actions} testID={`esport-cm-carte-${c.id}-menu`} libelle={trCm('carte.actions', { titre: c.titre })} /> : null}
        </View>
      </View>
    </View>
  );
}

/** Poignée de glisser-déposer (souris et doigt) : le geste commence dès qu'on la saisit. */
function Poignee({ theme, titre, glisser, testID }: { theme: ThemeHub; titre: string; glisser: { debut(x: number, y: number): void; bouge(x: number, y: number): void; fin(annuler: boolean): void }; testID: string }) {
  const rappel = useRef(glisser);
  rappel.current = glisser;
  const geste = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => rappel.current.debut(e.nativeEvent.pageX, e.nativeEvent.pageY),
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => rappel.current.bouge(g.moveX, g.moveY),
      onPanResponderRelease: () => rappel.current.fin(false),
      onPanResponderTerminate: () => rappel.current.fin(true),
    }),
  ).current;
  return (
    <View
      {...geste.panHandlers}
      testID={testID}
      accessibilityLabel={trCm('carte.poignee', { titre })}
      accessibilityHint={trCm('carte.poignee_aide')}
      style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', cursor: 'grab' } as unknown as ViewStyle}>
      <Text style={{ color: theme.attenue, fontSize: 16 }}>⠿</Text>
    </View>
  );
}
