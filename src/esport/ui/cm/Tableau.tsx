/**
 * Tableau façon Trello de la section CM : listes côte à côte, cartes (couverture, étiquettes, statut du post,
 * réseaux, dates, compteurs, membres), recherche et filtres, archives.
 *
 * Mise en page (docs/esport/cm.md) : le tableau occupe la hauteur de la fenêtre qui reste sous son en-tête (la
 * page ne défile pas) ; les colonnes sont côte à côte et le TABLEAU défile horizontalement ; chaque COLONNE a sa
 * propre barre de défilement vertical (en-tête fixe avec le nombre de cartes, bouton réduire / agrandir, menu ⋯ ;
 * « + Ajouter une carte » fixé en bas). Colonne réduite : une bande verticale (choix mémorisé par compte,
 * `cm_preferences`). Téléphone : une colonne par écran, balayage latéral. Fond du tableau : teinte, dégradé ou
 * image, sous un voile sombre (colonnes lisibles en thème clair comme sombre).
 *
 * Cartes compactes : le titre seul (deux lignes au plus) ; la carte ne grandit que si elle a quelque chose à
 * montrer (étiquettes, description, échéance, checklist, pièces jointes, commentaires, membres, couverture, post).
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
import { Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent, type PanResponderGestureState, type TextStyle, type ViewStyle } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiCm, type CarteResume, type DetailTableau, type FondTableau, type ListeCm, type SaisieFond, type StatutPost, type TeamCm } from '../../cm/api';
import { FONDS_COULEURS, FONDS_DEGRADES, styleFond } from '../../cm/fonds';
import { minuscules } from '../../i18n';
import { trCm, trnCm, type CleCm } from '../../i18n/cm';
import { ACCEPT_IMAGE_FOND, choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { Retours, styles, useAgir } from '../commun';
import { Badge, ESP, MenuActions, Pliable, Volet, attenue, initiales, rayonCarte, texte, type ActionSecondaire, type EtatPresse } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import { trDr } from '../../i18n/drive';
import { ChoixDrive } from './drive/ChoixDrive';
import { Aide, BadgeStatut, FUSEAU_CLUB, PastilleReseau, nomListe, nomStatut, nomTableau, quand } from './commun';
import { FicheCarte } from './FicheCarte';
import { GestionEtiquettes } from './GestionEtiquettes';

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
  /** Défilement vertical de chaque colonne au début du geste (les mesures des cartes datent de ce moment). */
  scrollColonnes: Map<string, number>;
  listes: Array<Rect & { id: string }>;
  cartes: Map<string, Array<Rect & { id: string }>>;
}

/** Hauteur minimale du tableau (petite fenêtre) ; largeur d'une colonne réduite. */
const HAUTEUR_MIN = 320;
const LARGEUR_REDUITE = 44;
/** Téléphone : hauteur réservée à la barre de navigation du bas (et un peu d'air). */
const RESERVE_BARRE_BASSE = 76;
/** Distance au bord (px) qui déclenche le défilement automatique pendant un glisser-déposer, et pas par image. */
const BORD_DEFILEMENT = 56;
const PAS_DEFILEMENT = 24;

/** La carte a-t-elle quelque chose à montrer sous son titre (sinon : une ligne de titre, compacte) ? */
export function carteAInfos(c: CarteResume): boolean {
  return Boolean(
    c.post || c.reseaux.length || c.datePublication || c.echeance || c.description || c.commentaires || c.checklist.total || c.pieces || c.membres.length || c.origine === 'depot' || c.origine === 'suggestion',
  );
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
  const { width, height } = useWindowDimensions();
  const [d, setD] = useState<DetailTableau | undefined>();
  const [archives, setArchives] = useState(false);
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [ouverte, setOuverte] = useState<string | undefined>();
  const [ajout, setAjout] = useState<string | undefined>();
  const [titreAjout, setTitreAjout] = useState('');
  const [nouvelleListe, setNouvelleListe] = useState<string | undefined>();
  const [renommer, setRenommer] = useState<{ id: string; nom: string } | undefined>();
  const [deplacer, setDeplacer] = useState<CarteResume | undefined>();
  const [gestionEtiquettes, setGestionEtiquettes] = useState(false);
  const [choixFond, setChoixFond] = useState(false);
  const [limites, setLimites] = useState<Record<string, number>>({});
  const [reduites, setReduites] = useState<string[]>([]);
  const [fantome, setFantome] = useState<{ x: number; y: number; l: number; carte: CarteResume } | undefined>();
  const [cible, setCible] = useState<{ listeId: string; index: number } | undefined>();
  const cibleRef = useRef<{ listeId: string; index: number } | undefined>(undefined);
  const [annonce, setAnnonce] = useState('');
  // Zone du tableau : hauteur = fenêtre disponible sous son haut ; largeur (téléphone : une colonne par écran).
  const [zoneHaut, setZoneHaut] = useState<number | undefined>();
  const [zoneLargeur, setZoneLargeur] = useState<number | undefined>();
  const { erreur, avis, agir, setErreur } = useAgir();
  const glisse = useRef<Glisse | null>(null);
  const conteneur = useRef<Vue>(null);
  const defilement = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollX = useRef(0);
  const refsListes = useRef(new Map<string, Vue>());
  const refsCartes = useRef(new Map<string, Vue>());
  const refsColonnes = useRef(new Map<string, React.ComponentRef<typeof ScrollView>>());
  const scrollColonnes = useRef(new Map<string, number>());
  const largeurListe = large ? 272 : Math.max(240, Math.min(420, (zoneLargeur ?? width - 2 * ESP.m) - 2 * ESP.s));
  // Téléphone : la barre de navigation du bas recouvre le bas de la fenêtre (sa hauteur est réservée).
  const hauteurTableau = zoneHaut === undefined ? undefined : Math.max(HAUTEUR_MIN, Math.floor(height - zoneHaut - (large ? ESP.s : RESERVE_BARRE_BASSE)));

  const recharger = useCallback(async () => setD(await api.tableau(id, archives)), [api, id, archives]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Changement ailleurs (autre utilisateur, suggestion automatique…) : rechargé, sauf pendant un glisser-déposer.
  useEffect(() => {
    if (d && versionServeur !== undefined && versionServeur > d.tableau.version && !glisse.current) void recharger().catch(() => undefined);
  }, [versionServeur, d, recharger]);
  // Colonnes réduites : choix du compte, mémorisé en base (cm_preferences).
  const clePreference = `tableau.${id}.reduites`;
  useEffect(() => {
    let vivant = true;
    api
      .preferences()
      .then(p => {
        const v = p?.preferences?.[clePreference];
        if (vivant && Array.isArray(v)) setReduites(v.filter((x): x is string => typeof x === 'string'));
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [api, clePreference]);
  const basculerReduite = (listeId: string) => {
    const suivantes = reduites.includes(listeId) ? reduites.filter(x => x !== listeId) : [...reduites, listeId];
    setReduites(suivantes);
    void api.changerPreference(clePreference, suivantes.length ? suivantes : null).catch(() => undefined);
  };

  /** Haut de la zone du tableau dans la fenêtre : la zone prend la hauteur qui reste (la page ne défile pas). */
  const mesurerZone = useCallback(
    (e?: LayoutChangeEvent) => {
      if (e?.nativeEvent?.layout?.width) setZoneLargeur(e.nativeEvent.layout.width);
      void mesurer(conteneur.current).then(r => {
        if (r) setZoneHaut(h => (h !== undefined && Math.abs(h - r.y) < 2 ? h : r.y));
      });
    },
    [],
  );
  useEffect(() => {
    mesurerZone();
  }, [mesurerZone, height, width]);

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
      const g: Glisse = { carteId: carte.id, pret: false, conteneur: conteneurRect, carte: carteRect, decalage: { x: px - carteRect.x, y: py - carteRect.y }, scrollDepart: scrollX.current, scrollColonnes: new Map(scrollColonnes.current), listes: [], cartes: new Map() };
      glisse.current = g;
      for (const l of listes) {
        if (reduites.includes(l.id)) continue;
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
    [listes, visibles, reduites],
  );

  const bouge = useCallback((px: number, py: number) => {
    const g = glisse.current;
    if (!g?.pret) return;
    // Défilement automatique près des bords du tableau (horizontal) et de la colonne survolée (vertical).
    if (px < g.conteneur.x + BORD_DEFILEMENT) defilement.current?.scrollTo({ x: Math.max(0, scrollX.current - PAS_DEFILEMENT), animated: false });
    else if (px > g.conteneur.x + g.conteneur.l - BORD_DEFILEMENT) defilement.current?.scrollTo({ x: scrollX.current + PAS_DEFILEMENT, animated: false });
    const dx = scrollX.current - g.scrollDepart;
    setFantome(f => (f ? { ...f, x: px - g.conteneur.x - g.decalage.x, y: py - g.conteneur.y - g.decalage.y } : f));
    const liste = g.listes.find(l => px >= l.x - dx && px <= l.x - dx + l.l);
    if (!liste) {
      cibleRef.current = undefined;
      setCible(c => (c ? undefined : c));
      return;
    }
    const colonne = refsColonnes.current.get(liste.id);
    const yCol = scrollColonnes.current.get(liste.id) ?? 0;
    if (py < liste.y + BORD_DEFILEMENT) colonne?.scrollTo({ y: Math.max(0, yCol - PAS_DEFILEMENT), animated: false });
    else if (py > liste.y + liste.h - BORD_DEFILEMENT) colonne?.scrollTo({ y: yCol + PAS_DEFILEMENT, animated: false });
    // Les cartes ont été mesurées au début du geste : on retire ce que la colonne a défilé depuis.
    const dy = (scrollColonnes.current.get(liste.id) ?? 0) - (g.scrollColonnes.get(liste.id) ?? 0);
    const index = (g.cartes.get(liste.id) ?? []).filter(r => r.y - dy + r.h / 2 < py).length;
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
      // La nouvelle carte est en bas de la colonne : on y descend.
      setTimeout(() => refsColonnes.current.get(listeId)?.scrollToEnd?.({ animated: true }), 50);
    });

  const changerFond = (fond: SaisieFond) =>
    agir('fond', async () => {
      setD(await api.modifierTableau(id, { fond }));
      setChoixFond(false);
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

  const actionsListe = (l: ListeCm, i: number): ActionSecondaire[] => [
    { titre: reduites.includes(l.id) ? trCm('liste.agrandir') : trCm('liste.reduire'), onPress: () => basculerReduite(l.id), testID: `esport-cm-liste-${l.id}-reduire-menu` },
    ...(d?.droits.editer
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
      : []),
  ];

  if (!d) {
    return (
      <View testID={testID} style={{ gap: ESP.s }}>
        <Retours theme={theme} erreur={erreur} prefixe="esport-cm-tableau" />
        {!erreur ? <Text style={attenue(theme)}>{trCm('c.chargement')}</Text> : null}
      </View>
    );
  }

  const t = d.tableau;
  const fond = t.fond ?? null;
  // Colonnes : surface presque opaque sur un fond (lisible en clair comme en sombre), teinte légère sinon.
  const fondColonne = fond ? (theme.sombre ? 'rgba(22,26,30,0.94)' : 'rgba(241,242,244,0.96)') : teinteTransparente(theme.attenue, theme.sombre ? 0.14 : 0.08);
  const hauteurColonne = hauteurTableau === undefined ? undefined : hauteurTableau - 2 * ESP.s;
  return (
    <View testID={testID} style={{ gap: ESP.s }}>
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
              d.droits.editer && { titre: trCm('fond.changer'), onPress: () => setChoixFond(true), testID: 'esport-cm-tableau-fond' },
              d.droits.editer && { titre: trCm('etiquette.gerer'), onPress: () => setGestionEtiquettes(true), testID: 'esport-cm-tableau-etiquettes' },
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
      {/* Zone du tableau : fond (teinte, dégradé ou image) sous un voile sombre ; hauteur = fenêtre disponible. */}
      <View
        ref={conteneur}
        onLayout={mesurerZone}
        testID="esport-cm-zone"
        style={[{ position: 'relative', borderRadius: rayonCarte(theme), overflow: 'hidden' }, hauteurTableau !== undefined ? { height: hauteurTableau } : null, styleFond(fond) as ViewStyle]}>
        {fond?.genre === 'image' && fond.image ? <Image source={{ uri: fond.image }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors testID="esport-cm-fond-image" /> : null}
        {fond ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} testID="esport-cm-voile" /> : null}
        <ScrollView
          ref={defilement}
          horizontal
          scrollEnabled={!fantome}
          onScroll={e => {
            scrollX.current = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
          snapToInterval={large ? undefined : largeurListe + ESP.s}
          snapToAlignment="start"
          decelerationRate={large ? undefined : 'fast'}
          style={hauteurTableau !== undefined ? { height: hauteurTableau } : undefined}
          contentContainerStyle={{ gap: ESP.s, alignItems: 'flex-start', padding: ESP.s }}
          testID="esport-cm-listes">
          {listes.map((l, li) => {
            const vues = visibles(l.id);
            const limite = limites[l.id] ?? PAR_LISTE;
            if (reduites.includes(l.id)) {
              return (
                <Pressable
                  key={l.id}
                  testID={`esport-cm-liste-${l.cle ?? l.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={trCm('liste.agrandir_libelle', { nom: nomListe(l), n: vues.length })}
                  onPress={() => basculerReduite(l.id)}
                  style={(e: EtatPresse) => ({ width: LARGEUR_REDUITE, height: Math.min(hauteurColonne ?? 260, 260), borderRadius: rayonCarte(theme), backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.2) : fondColonne, alignItems: 'center', paddingTop: ESP.xs, gap: ESP.xs, overflow: 'hidden', opacity: l.archive ? 0.6 : 1 })}>
                  <Text style={{ color: theme.attenue, fontSize: 13, fontWeight: '800' }}>↔</Text>
                  <Text style={{ ...attenue(theme, 12), fontWeight: '700' }} testID={`esport-cm-liste-${l.id}-compteur`}>
                    {String(vues.length)}
                  </Text>
                  {/* Nom à la verticale : écriture verticale sur le web, texte tourné sur iPhone / Android. */}
                  {Platform.OS === 'web' ? (
                    <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '700', writingMode: 'vertical-rl', maxHeight: 190, overflow: 'hidden' } as unknown as TextStyle}>
                      {nomListe(l)}
                    </Text>
                  ) : (
                    <View style={{ flex: 1, width: LARGEUR_REDUITE }}>
                      <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '700', position: 'absolute', width: 180, left: LARGEUR_REDUITE / 2 - 90, top: 80, textAlign: 'center', transform: [{ rotate: '90deg' }] }}>
                        {nomListe(l)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            }
            return (
              <View
                key={l.id}
                ref={r => {
                  if (r) refsListes.current.set(l.id, r);
                  else refsListes.current.delete(l.id);
                }}
                testID={`esport-cm-liste-${l.cle ?? l.id}`}
                accessibilityLabel={trCm('liste.libelle', { nom: nomListe(l), n: vues.length })}
                style={[
                  {
                    width: largeurListe,
                    backgroundColor: fondColonne,
                    borderRadius: rayonCarte(theme),
                    opacity: l.archive ? 0.6 : 1,
                    borderWidth: 2,
                    borderColor: cible?.listeId === l.id ? theme.accent : 'transparent',
                    overflow: 'hidden',
                  },
                  hauteurColonne !== undefined ? { maxHeight: hauteurColonne } : null,
                ]}>
                {/* En-tête fixe : nom, nombre de cartes, réduire, menu ⋯. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: ESP.s, paddingRight: 4, paddingTop: 6, paddingBottom: 2 }} testID={`esport-cm-liste-${l.id}-entete`}>
                  <Text accessibilityRole="header" style={{ ...texte(theme, 14), fontWeight: '700', flex: 1 }} numberOfLines={1}>
                    {nomListe(l)}
                  </Text>
                  <Text style={{ ...attenue(theme, 12), fontWeight: '700', paddingHorizontal: 4 }} accessibilityLabel={trnCm('liste.cartes_n', vues.length)} testID={`esport-cm-liste-${l.id}-compteur`}>
                    {String(vues.length)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={trCm('liste.reduire_libelle', { nom: nomListe(l) })}
                    onPress={() => basculerReduite(l.id)}
                    testID={`esport-cm-liste-${l.id}-reduire`}
                    style={(e: EtatPresse) => ({ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.attenue, 0.2) : 'transparent' })}>
                    <Text style={{ color: theme.attenue, fontSize: 13, fontWeight: '800' }}>→←</Text>
                  </Pressable>
                  <MenuActions theme={theme} compact testID={`esport-cm-liste-${l.cle ?? l.id}-menu`} libelle={trCm('liste.actions', { nom: nomListe(l) })} actions={actionsListe(l, li)} />
                </View>
                {/* Cartes : la COLONNE défile (sa propre barre), pas la page. */}
                <ScrollView
                  ref={r => {
                    if (r) refsColonnes.current.set(l.id, r);
                    else refsColonnes.current.delete(l.id);
                  }}
                  onScroll={e => {
                    scrollColonnes.current.set(l.id, e.nativeEvent.contentOffset.y);
                  }}
                  scrollEventThrottle={16}
                  scrollEnabled={!fantome}
                  nestedScrollEnabled
                  style={{ flexGrow: 0, flexShrink: 1 }}
                  contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 2, paddingBottom: 4, gap: 6 }}
                  testID={`esport-cm-liste-${l.id}-cartes`}>
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
                  {d.droits.editer && !l.archive && ajout === l.id ? (
                    <View style={{ gap: ESP.xs, paddingVertical: 4 }}>
                      <Champ theme={theme} libelle={trCm('carte.titre')} valeur={titreAjout} onChanger={setTitreAjout} maxLength={200} testID={`esport-cm-ajout-${l.cle ?? l.id}-titre`} />
                      <View style={[styles.ligne, { gap: ESP.xs }]}>
                        <BoutonHub theme={theme} titre={trCm('carte.ajouter_carte')} variante="plein" desactive={!titreAjout.trim()} onPress={() => void creerCarte(l.id, false)} testID={`esport-cm-ajout-${l.cle ?? l.id}-carte`} />
                        <BoutonHub theme={theme} titre={trCm('carte.ajouter_post')} desactive={!titreAjout.trim()} onPress={() => void creerCarte(l.id, true)} testID={`esport-cm-ajout-${l.cle ?? l.id}-post`} />
                        <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setAjout(undefined)} testID={`esport-cm-ajout-${l.cle ?? l.id}-annuler`} />
                      </View>
                    </View>
                  ) : null}
                </ScrollView>
                {/* « + Ajouter une carte » : fixé en bas de la colonne. */}
                {d.droits.editer && !l.archive && ajout !== l.id ? (
                  <Pressable
                    testID={`esport-cm-ajout-${l.cle ?? l.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={trCm('carte.ajouter_dans', { liste: nomListe(l) })}
                    onPress={() => {
                      setTitreAjout('');
                      setAjout(l.id);
                      setTimeout(() => refsColonnes.current.get(l.id)?.scrollToEnd?.({ animated: true }), 50);
                    }}
                    style={(e: EtatPresse) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: ESP.s, marginHorizontal: 4, marginBottom: 4, borderRadius: 8, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.attenue, 0.18) : 'transparent' })}>
                    <Text style={{ ...texte(theme, 14), color: theme.attenue, fontWeight: '600' }}>{trCm('carte.ajouter')}</Text>
                  </Pressable>
                ) : (
                  <View style={{ height: 6 }} />
                )}
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

      {choixFond ? <ChoixFond theme={theme} api={api} tableau={t} enCours={false} onChoisir={changerFond} onFermer={() => setChoixFond(false)} erreur={erreur} /> : null}

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

      {gestionEtiquettes ? (
        <Volet theme={theme} visible titre={trCm('etiquette.titre')} onFermer={() => setGestionEtiquettes(false)} testID="esport-cm-etiquettes-volet">
          <GestionEtiquettes theme={theme} api={api} tableauId={t.id} etiquettes={d.etiquettes} droits={d.droits} onChange={() => recharger()} />
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

// ------------------------------------------------------------------ Fond du tableau

/** Choix du fond : teintes et dégradés prédéfinis, image du Drive ou importée, ou fond du thème. */
function ChoixFond({ theme, api, tableau, onChoisir, onFermer, erreur }: { theme: ThemeHub; api: ApiCm; tableau: DetailTableau['tableau']; enCours: boolean; onChoisir(f: SaisieFond): Promise<boolean>; onFermer(): void; erreur?: string }) {
  const [drive, setDrive] = useState(false);
  const envoi = useEnvoi();
  const actuel: FondTableau | null = tableau.fond ?? null;
  const pastille = (fond: FondTableau, libelle: string, cle: string) => {
    const choisi = actuel?.genre === fond.genre && 'cle' in actuel && 'cle' in fond && actuel.cle === fond.cle;
    return (
      <Pressable
        key={`${fond.genre}-${cle}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: choisi }}
        accessibilityLabel={libelle}
        onPress={() => void onChoisir(fond as SaisieFond)}
        testID={`esport-cm-fond-${fond.genre}-${cle}`}
        style={(e: EtatPresse) => [{ width: 76, height: 48, borderRadius: 8, borderWidth: 2, borderColor: choisi ? theme.texte : e.hovered || e.focused ? theme.accent : 'transparent', overflow: 'hidden' }, styleFond(fond) as ViewStyle]}>
        {choisi ? <Text style={{ color: '#ffffff', fontWeight: '800', textAlign: 'right', paddingRight: 6, paddingTop: 2 }}>✓</Text> : null}
      </Pressable>
    );
  };
  return (
    <Volet theme={theme} visible titre={trCm('fond.titre')} onFermer={onFermer} testID="esport-cm-fond">
      <Aide theme={theme}>{trCm('fond.aide')}</Aide>
      {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-cm-fond" /> : null}
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trCm('fond.couleurs')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup">
        {(Object.keys(FONDS_COULEURS) as Array<keyof typeof FONDS_COULEURS>).map(cle => pastille({ genre: 'couleur', cle }, trCm(`fond.couleur.${cle}` as CleCm), cle))}
      </View>
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trCm('fond.degrades')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup">
        {(Object.keys(FONDS_DEGRADES) as Array<keyof typeof FONDS_DEGRADES>).map(cle => pastille({ genre: 'degrade', cle }, trCm(`fond.degrade.${cle}` as CleCm), cle))}
      </View>
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trCm('fond.image')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={trDr('choix.depuis_drive')} onPress={() => setDrive(true)} testID="esport-cm-fond-drive" />
        {choixFichierDisponible ? (
          <BoutonHub
            theme={theme}
            titre={trCm('fond.importer')}
            desactive={envoi.enCours}
            onPress={async () => {
              const f = await choisirFichier(ACCEPT_IMAGE_FOND, 'esport-cm-fond-fichier');
              if (!f) return;
              const { etat, oublier } = await envoi.lancer({ client: api.client, teamId: tableau.portee === PORTEE_CLUB ? PORTEE_CLUB : tableau.portee, section: 'cm', fichier: f });
              if (await onChoisir({ genre: 'image', envoi: etat.id })) {
                oublier();
                envoi.effacer();
              }
            }}
            testID="esport-cm-fond-importer"
          />
        ) : null}
        {actuel ? <BoutonHub theme={theme} titre={trCm('fond.aucun')} onPress={() => void onChoisir(null)} testID="esport-cm-fond-aucun" /> : null}
      </View>
      <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-cm-fond-envoi" />
      <ChoixDrive
        theme={theme}
        client={api.client}
        visible={drive}
        portees={[tableau.portee, PORTEE_CLUB]}
        accepter={f => /^image\/(png|jpeg|webp|gif|avif)$/.test(f.type)}
        aide={trCm('fond.drive_aide')}
        onFermer={() => setDrive(false)}
        onChoisir={f => {
          setDrive(false);
          void onChoisir({ genre: 'image', drive: f.id });
        }}
        testID="esport-cm-fond-choix-drive"
      />
    </Volet>
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
  const pastilles = c.etiquettes.map(eid => etiquettes.get(eid)).filter((e): e is { nom: string; couleur: string } => Boolean(e));
  const infos = carteAInfos(c);
  return (
    <View
      style={{ backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 8), borderWidth: 1, borderColor: theme.ligne, overflow: 'hidden' }}
      testID={`esport-cm-carte-${c.id}`}>
      {c.couverture?.couleur ? <View style={{ height: 28, backgroundColor: c.couverture.couleur }} testID={`esport-cm-carte-${c.id}-couverture`} /> : null}
      {c.couverture?.image ? <Image source={{ uri: c.couverture.image }} style={{ height: 96, width: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors testID={`esport-cm-carte-${c.id}-couverture`} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[c.titre, c.statut ? nomStatut(c.statut) : '', c.archive ? trCm('c.archivee') : ''].filter(Boolean).join(', ')}
          onPress={onOuvrir}
          testID={`esport-cm-carte-${c.id}-tuile`}
          style={(e: EtatPresse) => ({ flex: 1, minWidth: 0, paddingLeft: 10, paddingRight: 2, paddingVertical: 7, gap: 5, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.06) : 'transparent' })}>
          {pastilles.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID={`esport-cm-carte-${c.id}-etiquettes`}>
              {pastilles.map((e, i) => (
                <View key={i} style={{ backgroundColor: e.couleur, borderRadius: 4, paddingHorizontal: 6, height: 16, minWidth: 36, justifyContent: 'center' }}>
                  {e.nom ? (
                    <Text style={{ color: '#172b4d', fontSize: 11, fontWeight: '700', lineHeight: 14 }} numberOfLines={1}>
                      {e.nom}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          <Text style={{ ...texte(theme, 14), fontWeight: '500', lineHeight: 19 }} numberOfLines={2}>
            {c.titre}
          </Text>
          {infos ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 4, alignItems: 'center' }} testID={`esport-cm-carte-${c.id}-infos`}>
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
              {c.description ? <Text style={attenue(theme, 12)} accessibilityLabel={trCm('carte.a_description')} testID={`esport-cm-carte-${c.id}-description`}>≡</Text> : null}
              {c.commentaires ? <Text style={attenue(theme, 12)} accessibilityLabel={trnCm('carte.commentaires_n', c.commentaires)}>{`❝ ${c.commentaires}`}</Text> : null}
              {c.checklist.total ? (
                <Text style={{ ...attenue(theme, 12), color: c.checklist.faits === c.checklist.total ? theme.ok : theme.attenue }} accessibilityLabel={trCm('carte.checklist_n', { faits: c.checklist.faits, total: c.checklist.total })}>
                  {`☑ ${c.checklist.faits}/${c.checklist.total}`}
                </Text>
              ) : null}
              {c.pieces ? <Text style={attenue(theme, 12)} accessibilityLabel={trnCm('carte.pieces_n', c.pieces)}>{`⎘ ${c.pieces}`}</Text> : null}
              {c.origine === 'depot' ? <Badge theme={theme} texte={trCm('carte.depot')} /> : null}
              {c.origine === 'suggestion' ? <Badge theme={theme} texte={trCm('carte.suggestion')} /> : null}
              {c.membres.length ? (
                <View style={{ flexDirection: 'row', gap: 2, marginLeft: 'auto' }} testID={`esport-cm-carte-${c.id}-membres`}>
                  {c.membres.slice(0, 5).map(m => (
                    <View key={m} accessibilityLabel={d.noms[m] ?? ''} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: teinteTransparente(theme.accent, 0.25), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: theme.texte, fontSize: 9, fontWeight: '800' }}>{initiales(d.noms[m] ?? '?')}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 2, paddingRight: 2 }}>
          {glisser ? <Poignee theme={theme} titre={c.titre} glisser={glisser} testID={`esport-cm-carte-${c.id}-poignee`} /> : null}
          {actions.length ? <MenuActions theme={theme} compact actions={actions} testID={`esport-cm-carte-${c.id}-menu`} libelle={trCm('carte.actions', { titre: c.titre })} /> : null}
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
      style={{ width: 24, height: 32, alignItems: 'center', justifyContent: 'center', cursor: 'grab' } as unknown as ViewStyle}>
      <Text style={{ color: theme.attenue, fontSize: 14 }}>⠿</Text>
    </View>
  );
}
