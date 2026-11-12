/**
 * Éditeur de strats (site et app PC), selon le MODÈLE DE STRAT du jeu de la team (profil de jeu) :
 *  - Valorant : 5 joueurs, attaque / défense, économie du round, agents et capacités À L'ÉCHELLE de la map
 *    calibrée (smokes, murs courbables, cônes de flash, trajets de recon, fils, ultimes), phases (setup,
 *    execute, post-plant, retake) ;
 *  - The Finals : 3 joueurs, classes et gadgets, cashout et coffres, étages, destruction, équipes adverses ;
 *  - générique : pions, flèches, zones, textes.
 *
 * Étapes en frise (phase, durée, note), ordre et minutage des utilitaires, trajets minutés des joueurs,
 * cônes de vision, calques, aimantation, map retournée, zoom et déplacement (molette, pincement), annuler /
 * rétablir, copier / coller, lecture animée et mode présentation, comparaison avec une autre strat ou une
 * ancienne version, export PNG et PDF (impression), enregistrement versionné (verrou optimiste). Le canevas
 * Konva (CanevasStrat.web.tsx) est chargé à la demande.
 *
 * Raccourcis : V sélection, H main, A agent, C capacité, F flèche, L ligne, R forme, T texte, M marqueur,
 * O vision, E gomme, G aimantation, 1 à 5 joueur, Espace lecture, Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y),
 * Ctrl+C / Ctrl+V, Suppr, Ctrl+S, Ctrl+D (dupliquer l'étape), [ et ] étapes, flèches (déplacer la
 * sélection), + / - / 0 zoom, Échap.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import type { Strat } from '../../strats/api';
import { creerCacheImages, initiales, trouverAgent, type AgentAsset } from '../../strats/assets';
import {
  CALQUES,
  COULEURS_LIBRES,
  FORMES_ZONE,
  TAILLE_MAX_DOCUMENT,
  VUE_INITIALE,
  annuler,
  executer,
  historique,
  lireDocument,
  ordreUtilitaires,
  prochainOrdre,
  retablir,
  tailleDocument,
  zoomer,
  type Action,
  type Calque,
  type DocumentStrat,
  type FormeZone,
  type Historique,
  type ObjetStrat,
  type Vue,
} from '../../strats/document';
import { MODELES, type Economie, type GenreMarqueur } from '../../strats/modeles';
import { LIBELLES_SIDE } from '../../strats/libelles';
import { Retours, styles, useAgir, Intertitre, Panneau, Choix } from '../commun';
import { MenuActions } from '../design';
import type { ExportCanevas, Outil, PropsCanevas } from './CanevasStrat.web';
import { MentionRiot } from './commun';
import { agentsActifs, cartesDuPool } from '../../jeux/profil';
import type { PropsEditeur } from './types';
import { ConfirmationSuppression } from './Suppression';
import { trSs } from '../../i18n/stratsSuppr';
import { tr } from '../../i18n';
import { trSt, type CleSt } from '../../i18n/strats2';
import { Glyphe } from '../../../ui/icones';
import { Chronologie, FicheCapacite, Inspecteur, ListeUtilitaires, PanneauJoueurs, couleurPhase, libellePhase } from './Panneaux';
import { documentImpression } from './impression';

export type { PropsEditeur };

const Canevas = React.lazy(() => import('./CanevasStrat.web'));

const OUTILS: ReadonlyArray<readonly [Outil, string, CleSt, string]> = [
  ['selection', 'selection', 'outil.selection', 'V'],
  ['main', 'main', 'outil.main', 'H'],
  ['agent', '◉', 'outil.agent', 'A'],
  ['capacite', '✦', 'outil.capacite', 'C'],
  ['fleche', '➜', 'outil.fleche', 'F'],
  ['ligne', '╱', 'outil.ligne', 'L'],
  ['forme', '▭', 'outil.forme', 'R'],
  ['texte', 'T', 'outil.texte', 'T'],
  ['marqueur', '◆', 'outil.marqueur', 'M'],
  ['vision', '◠', 'outil.vision', 'O'],
  ['gomme', '⌫', 'outil.gomme', 'E'],
];
const TOUCHES_OUTILS: Record<string, Outil> = { v: 'selection', h: 'main', a: 'agent', c: 'capacite', f: 'fleche', l: 'ligne', r: 'forme', t: 'texte', m: 'marqueur', o: 'vision', e: 'gomme' };

const cacheImages = creerCacheImages({
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit),
  caches: (globalThis as { caches?: Parameters<typeof creerCacheImages>[0]['caches'] }).caches,
  creerUrl: b => URL.createObjectURL(b),
});

function IconeAsset({ theme, url, nom, couleur, taille = 30 }: { theme: ThemeHub; url: string | null; nom: string; couleur?: string; taille?: number }) {
  const [echec, setEchec] = useState(false);
  if (url && !echec) return <Image source={{ uri: url }} onError={() => setEchec(true)} style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? theme.surface }} accessibilityLabel={nom} />;
  return (
    <View style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? teinteTransparente(theme.attenue, 0.4), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontSize: taille * 0.38, fontWeight: '800' }}>{initiales(nom)}</Text>
    </View>
  );
}

function Pastille({ theme, actif, onPress, libelle, testID, children, couleur }: { theme: ThemeHub; actif: boolean; onPress(): void; libelle: string; testID: string; children: React.ReactNode; couleur?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={{
        minWidth: 40,
        minHeight: 40,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(theme.rayonMoyen, 10),
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? (couleur ?? theme.accent) : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : theme.surface,
      }}>
      {children}
    </Pressable>
  );
}

/** Nom de fichier ASCII (certains navigateurs ignorent un nom accentué). */
const nomFichier = (titre: string) => titre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'strat';

async function telecharger(url: string, nom: string) {
  // Data URL → Blob : un lien court, et le nom de fichier respecté par tous les navigateurs.
  const blob = await (await fetch(url)).blob();
  const lien = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = lien;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(lien), 30_000);
}

/** Attend deux images du navigateur (le canevas a redessiné l'étape demandée). */
const deuxImages = () => new Promise<void>(ok => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 60))));

export function Editeur({ theme, api, teamId, stratId, large, assets, onRetour, onOuvrir, onSupprimee }: PropsEditeur) {
  const [strat, setStrat] = useState<Strat | undefined>();
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const [h, setH] = useState<Historique | undefined>();
  const [revision, setRevision] = useState(0);
  const [enregistre, setEnregistre] = useState<DocumentStrat | undefined>();
  const [etape, setEtape] = useState(0);
  const [outil, setOutil] = useState<Outil>('agent');
  const [joueur, setJoueur] = useState<number | null>(0);
  const [couleurLibre, setCouleurLibre] = useState<string | undefined>();
  const [agentCle, setAgentCle] = useState<string | undefined>();
  const [capaciteCle, setCapaciteCle] = useState<string | undefined>();
  const [formeZone, setFormeZone] = useState<FormeZone | 'aucune' | 'auto'>('auto');
  const [formeDessin, setFormeDessin] = useState<'rect' | 'ellipse'>('rect');
  const [texte, setTexte] = useState('');
  const [tirets, setTirets] = useState(false);
  const [trajetJoueur, setTrajetJoueur] = useState(true);
  const [marqueur, setMarqueur] = useState<{ genre: GenreMarqueur; equipe: number | null; etiquette: string } | undefined>();
  const [vision, setVision] = useState({ ouverture: 90, portee: 30 });
  const [niveau, setNiveau] = useState<number | null>(null);
  const [aimant, setAimant] = useState(0);
  const [rotation, setRotation] = useState<0 | 180>(0);
  const [selection, setSelection] = useState<string | undefined>();
  const [pressePapier, setPressePapier] = useState<ObjetStrat[]>([]);
  const [vue, setVue] = useState<Vue>(VUE_INITIALE);
  const [largeur, setLargeur] = useState(0);
  const [conflit, setConflit] = useState<number | undefined>();
  const [temps, setTemps] = useState<number | undefined>();
  const [enLecture, setEnLecture] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [comparer, setComparer] = useState(false);
  const exportRef = useRef<ExportCanevas | undefined>(undefined);
  const { enCours, erreur, avis, agir, setErreur } = useAgir();

  const charger = useCallback(async () => {
    const s = await api.detail(teamId, stratId);
    const doc = lireDocument(s.donnees, s.modele);
    setStrat(s);
    setH(historique(doc));
    setEnregistre(doc);
    setRevision(s.revision);
    setEtape(0);
    setConflit(undefined);
  }, [api, teamId, stratId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const doc = h?.present;
  const def = MODELES[doc?.modele ?? 'generique'];
  const peutModifier = Boolean(strat?.moi.modifier);
  const modifie = Boolean(doc && enregistre && doc !== enregistre);
  const agents = agentsActifs(assets);
  const agent: AgentAsset | undefined = (agentCle ? trouverAgent(assets, agentCle) : undefined) ?? (joueur !== null && doc?.joueurs[joueur]?.agent ? trouverAgent(assets, doc.joueurs[joueur].agent as string) : undefined) ?? agents[0];
  const capacite = agent?.capacites.find(c => c.cle === capaciteCle) ?? agent?.capacites[0];
  const couleur = couleurLibre ?? (joueur !== null ? (doc?.joueurs[joueur]?.couleur ?? '#ffffff') : '#ffffff');
  const iEtape = doc ? Math.min(etape, doc.etapes.length - 1) : 0;
  const etapeCourante = doc?.etapes[iEtape];
  const carteAsset = assets?.cartes.find(c => c.cle === doc?.carte.cle);
  const marqueurCourant = marqueur ?? { genre: def.marqueurs[0], equipe: null, etiquette: '' };
  const niveaux = useMemo(() => {
    if (carteAsset?.niveaux?.length) return carteAsset.niveaux.map((n, i) => ({ valeur: i, nom: n.nom }));
    return def.etages ? [0, 1, 2, 3].map(i => ({ valeur: i, nom: trSt('niveau.n', { n: i }) })) : [];
  }, [carteAsset, def.etages]);
  const libelleAgent = doc?.modele === 'thefinals' ? trSt('modele.classe') : doc?.modele === 'valorant' ? trSt('modele.agent') : trSt('modele.personnage');
  const choisi = etapeCourante?.objets.find(o => o.id === selection);

  const faire = useCallback((a: Action) => setH(x => (x ? executer(x, a) : x)), []);

  // ---------------------------------------------------------------- Lecture animée
  useEffect(() => {
    if (!enLecture || !doc) return undefined;
    let precedent = performance.now();
    let id = 0;
    const pas = (maintenant: number) => {
      const dt = (maintenant - precedent) / 1000;
      precedent = maintenant;
      setTemps(t => {
        const actuel = (t ?? 0) + dt;
        const duree = doc.etapes[iEtape]?.duree ?? 5;
        if (actuel < duree) return actuel;
        if (iEtape < doc.etapes.length - 1) {
          setEtape(iEtape + 1);
          return 0;
        }
        setEnLecture(false);
        return duree;
      });
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [enLecture, doc, iEtape]);
  const lire = useCallback(() => {
    setSelection(undefined);
    setTemps(t => (t === undefined || (doc && t >= (doc.etapes[iEtape]?.duree ?? 5)) ? 0 : t));
    setEnLecture(true);
  }, [doc, iEtape]);
  const arreter = useCallback(() => {
    setEnLecture(false);
    setTemps(undefined);
  }, []);
  const changerEtape = useCallback((i: number) => {
    setEtape(i);
    setSelection(undefined);
    setTemps(t => (t === undefined ? undefined : 0));
  }, []);

  // ---------------------------------------------------------------- Enregistrement et exports

  const enregistrer = useCallback(
    (forcer?: number) =>
      agir('enregistrement', async () => {
        if (!doc || !strat) return;
        if (tailleDocument(doc) > TAILLE_MAX_DOCUMENT) throw new Error(trSt('editeur.trop_gros'));
        let miniature: string | undefined;
        try {
          miniature = exportRef.current?.miniature();
        } catch {
          miniature = undefined; // Canevas « contaminé » ou pas prêt : on enregistre sans miniature.
        }
        // Instantané de l'échelle de la map (page de partage, export) : celle du profil au moment d'enregistrer.
        const donnees = carteAsset?.echelle !== undefined && carteAsset.echelle !== doc.carte.echelle ? { ...doc, carte: { ...doc.carte, echelle: carteAsset.echelle ?? null } } : doc;
        try {
          const s = await api.enregistrer(teamId, strat.id, { revision: forcer ?? revision, donnees, miniature });
          setStrat(s);
          setRevision(s.revision);
          setEnregistre(doc);
          setConflit(undefined);
          return s.avertissement ? tr('strats.editeur.strat_enregistree_miniature_no') : tr('strats.editeur.strat_enregistree_version', { revision: s.revision });
        } catch (e) {
          if (e instanceof ErreurEsport && e.code === 'conflit') setConflit(Number((e.details as { revision?: number } | undefined)?.revision ?? 0) || undefined);
          throw e;
        }
      }),
    [agir, api, carteAsset, doc, revision, strat, teamId],
  );

  const exporterPng = useCallback(() => {
    void agir('export', async () => {
      if (!exportRef.current || !strat || !doc) throw new Error(tr('strats.editeur.le_canevas_n_est'));
      let url: string;
      try {
        url = exportRef.current.png(2);
      } catch {
        throw new Error(tr('strats.editeur.export_impossible_une_image'));
      }
      await telecharger(url, `${nomFichier(strat.titre)}-etape-${iEtape + 1}.png`);
      return tr('strats.editeur.image_png_exportee');
    });
  }, [agir, strat, doc, iEtape]);

  /** Images de toutes les étapes (le canevas affiche chaque étape tour à tour). */
  const imagesEtapes = useCallback(async (): Promise<string[]> => {
    if (!doc || !exportRef.current) throw new Error(tr('strats.editeur.le_canevas_n_est'));
    const avant = iEtape;
    const sortie: string[] = [];
    setSelection(undefined);
    setTemps(undefined);
    setEnLecture(false);
    try {
      for (let i = 0; i < doc.etapes.length; i++) {
        setEtape(i);
        await deuxImages();
        sortie.push((exportRef.current as ExportCanevas).png(1.2));
      }
    } catch {
      throw new Error(tr('strats.editeur.export_impossible_une_image'));
    } finally {
      setEtape(avant);
    }
    return sortie;
  }, [doc, iEtape]);

  const exporterPdf = useCallback(() => {
    void agir('export', async () => {
      if (!doc || !strat) return;
      const images = await imagesEtapes();
      const html = documentImpression({ strat, doc, images, agents: assets?.agents ?? [] });
      // Impression dans un cadre caché (aucune fenêtre surgissante) : « Enregistrer en PDF » du navigateur.
      const cadre = document.createElement('iframe');
      cadre.setAttribute('aria-hidden', 'true');
      Object.assign(cadre.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
      document.body.appendChild(cadre);
      const d = cadre.contentDocument;
      if (!d || !cadre.contentWindow) throw new Error(trSt('export.impossible'));
      d.open();
      d.write(html);
      d.close();
      await new Promise(ok => setTimeout(ok, 400));
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      setTimeout(() => cadre.remove(), 60_000);
      return trSt('export.pdf_pret');
    });
  }, [agir, assets, doc, imagesEtapes, strat]);

  const exporterToutesPng = useCallback(() => {
    void agir('export', async () => {
      if (!strat) return;
      const images = await imagesEtapes();
      for (let i = 0; i < images.length; i++) await telecharger(images[i], `${nomFichier(strat.titre)}-etape-${i + 1}.png`);
      return trSt('export.png_toutes', { n: images.length });
    });
  }, [agir, imagesEtapes, strat]);

  // ---------------------------------------------------------------- Clavier
  useEffect(() => {
    function touche(ev: KeyboardEvent) {
      const cible = ev.target as HTMLElement | null;
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (ctrl && k === 'z') {
        ev.preventDefault();
        setH(x => (x ? (ev.shiftKey ? retablir(x) : annuler(x)) : x));
      } else if (ctrl && k === 'y') {
        ev.preventDefault();
        setH(x => (x ? retablir(x) : x));
      } else if (ctrl && k === 's') {
        ev.preventDefault();
        if (peutModifier) void enregistrer();
      } else if (ctrl && k === 'd') {
        ev.preventDefault();
        faire({ type: 'dupliquerEtape', etape: iEtape });
        changerEtape(iEtape + 1);
      } else if (ctrl && k === 'c' && choisi) {
        ev.preventDefault();
        setPressePapier([choisi]);
      } else if (ctrl && k === 'v' && pressePapier.length) {
        ev.preventDefault();
        faire({ type: 'coller', etape: iEtape, objets: pressePapier, decalage: 20 });
      } else if (ctrl || ev.altKey) {
        return;
      } else if (k === ' ') {
        ev.preventDefault();
        if (enLecture) setEnLecture(false);
        else lire();
      } else if ((k === 'delete' || k === 'backspace') && selection) {
        faire({ type: 'supprimer', etape: iEtape, id: selection });
        setSelection(undefined);
      } else if (k.startsWith('arrow') && selection) {
        ev.preventDefault();
        const pas = ev.shiftKey ? 20 : 4;
        faire({ type: 'deplacer', etape: iEtape, id: selection, dx: k === 'arrowleft' ? -pas : k === 'arrowright' ? pas : 0, dy: k === 'arrowup' ? -pas : k === 'arrowdown' ? pas : 0 });
      } else if (k === 'g') setAimant(a => (a ? 0 : 10));
      else if (TOUCHES_OUTILS[k]) setOutil(TOUCHES_OUTILS[k]);
      else if (/^[1-9]$/.test(k) && Number(k) <= (doc?.joueurs.length ?? 0)) {
        setJoueur(Number(k) - 1);
        setCouleurLibre(undefined);
      } else if (k === '[') changerEtape(Math.max(0, iEtape - 1));
      else if (k === ']') changerEtape(Math.min((doc?.etapes.length ?? 1) - 1, iEtape + 1));
      else if (k === '+' || k === '=') setVue(v => zoomer(v, 1.25, { x: largeur / 2, y: largeur / 2 }));
      else if (k === '-') setVue(v => zoomer(v, 1 / 1.25, { x: largeur / 2, y: largeur / 2 }));
      else if (k === '0') setVue(VUE_INITIALE);
      else if (k === 'escape') {
        setSelection(undefined);
        setPresentation(false);
      }
    }
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [changerEtape, choisi, doc, enLecture, enregistrer, faire, iEtape, largeur, lire, peutModifier, pressePapier, selection]);

  const surPret = useCallback((e: ExportCanevas) => {
    exportRef.current = e;
  }, []);

  if (!strat || !doc || !h) {
    return (
      <View style={{ gap: 12 }} testID="esport-editeur-chargement">
        <BoutonHub theme={theme} titre={tr('strats.editeur.strats')} onPress={onRetour} testID="esport-editeur-retour" />
        {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-editeur" /> : <Text style={{ color: theme.attenue }}>{tr('strats.editeur.chargement_de_la_strat')}</Text>}
      </View>
    );
  }

  const taille = Math.max(240, Math.min(largeur || 600, large ? 900 : 760));
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const propsCanevas: Omit<PropsCanevas, 'taille' | 'vue' | 'onVue'> = {
    doc,
    carte: carteAsset,
    fond: doc.carte.image ?? carteAsset?.minimap ?? null,
    etape: iEtape,
    outil: peutModifier && temps === undefined ? outil : 'main',
    couleur,
    joueur: couleurLibre ? null : joueur,
    agent,
    capacite,
    formeZone,
    formeDessin,
    texte,
    tirets,
    epaisseur: 5,
    trajetJoueur,
    marqueur: marqueurCourant,
    vision,
    niveau: niveaux.length ? niveau : null,
    aimant,
    rotation,
    temps,
    ordreSuivant: prochainOrdre(etapeCourante),
    selection,
    onSelection: setSelection,
    onAction: peutModifier ? faire : () => undefined,
    images: cacheImages,
    onPret: surPret,
  };

  const barreOutils = (
    <View style={[styles.ligne, { gap: 6 }]} accessibilityRole="toolbar" accessibilityLabel={trSt('outil.outils')} testID="esport-editeur-outils">
      {OUTILS.map(([id, icone, cle, raccourci]) => (
        <Pastille key={id} theme={theme} actif={outil === id} onPress={() => setOutil(id)} libelle={`${trSt(cle)} (${raccourci})`} testID={`esport-outil-${id}`}>
          <Glyphe valeur={icone} style={{ color: theme.texte, fontSize: 17 }} />
        </Pastille>
      ))}
      <View style={{ width: 8 }} />
      <Pastille theme={theme} actif={false} onPress={() => setH(annuler(h))} libelle={tr('strats.editeur.annuler_ctrl_z')} testID="esport-editeur-annuler">
        <Text style={{ color: h.passe.length ? theme.texte : theme.attenue, fontSize: 17 }}>↶</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setH(retablir(h))} libelle={tr('strats.editeur.retablir_ctrl_maj_z')} testID="esport-editeur-retablir">
        <Text style={{ color: h.futur.length ? theme.texte : theme.attenue, fontSize: 17 }}>↷</Text>
      </Pastille>
      <Pastille theme={theme} actif={Boolean(aimant)} onPress={() => setAimant(a => (a ? 0 : 10))} libelle={trSt('outil.aimant')} testID="esport-editeur-aimant">
        <Glyphe valeur="grille" style={{ color: theme.texte, fontSize: 16 }} />
      </Pastille>
      <Pastille theme={theme} actif={rotation === 180} onPress={() => setRotation(r => (r ? 0 : 180))} libelle={trSt('outil.retourner')} testID="esport-editeur-retourner">
        <Glyphe valeur="synchro" style={{ color: theme.texte, fontSize: 16 }} />
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1.25, { x: taille / 2, y: taille / 2 }))} libelle={tr('strats.editeur.zoomer')} testID="esport-editeur-zoom-plus">
        <Text style={{ color: theme.texte, fontSize: 17 }}>＋</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1 / 1.25, { x: taille / 2, y: taille / 2 }))} libelle={tr('strats.editeur.dezoomer')} testID="esport-editeur-zoom-moins">
        <Text style={{ color: theme.texte, fontSize: 17 }}>－</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(VUE_INITIALE)} libelle={tr('strats.editeur.vue_entiere_0')} testID="esport-editeur-zoom-zero">
        <Text style={{ color: theme.texte, fontSize: 12 }}>{Math.round(vue.echelle * 100)} %</Text>
      </Pastille>
    </View>
  );

  const couleurs = (
    <View style={[styles.ligne, { gap: 6 }]}>
      {COULEURS_LIBRES.map(c => (
        <Pastille key={c} theme={theme} actif={couleurLibre === c} couleur={c} onPress={() => (setCouleurLibre(c), setJoueur(null))} libelle={tr('strats.editeur.couleur', { c })} testID={`esport-couleur-${c.slice(1)}`}>
          <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c, borderWidth: 1, borderColor: theme.ligne }} />
        </Pastille>
      ))}
    </View>
  );

  const palette = (
    <View style={{ gap: 10 }}>
      {outil === 'agent' || outil === 'capacite' ? (
        <Panneau theme={theme} testID="esport-editeur-agents">
          <Intertitre theme={theme}>{outil === 'agent' ? trSt('palette.agent', { quoi: libelleAgent }) : trSt('palette.capacite')}</Intertitre>
          {agents.length === 0 ? <Text style={attenue}>{trSt('palette.aucun_personnage')}</Text> : null}
          <View style={[styles.ligne, { gap: 4 }]}>
            {agents.map(a => (
              <Pastille
                key={a.cle}
                theme={theme}
                actif={agent?.cle === a.cle}
                onPress={() => {
                  setAgentCle(a.cle);
                  setCapaciteCle(undefined);
                  if (joueur !== null) faire({ type: 'joueur', index: joueur, champs: { agent: a.cle } });
                }}
                libelle={a.nom}
                testID={`esport-agent-${a.cle}`}>
                <IconeAsset theme={theme} url={a.icone} nom={a.nom} />
              </Pastille>
            ))}
          </View>
          {outil === 'capacite' && agent ? (
            <>
              <View style={[styles.ligne, { gap: 6 }]}>
                {agent.capacites.map(c => (
                  <Pastille key={c.cle} theme={theme} actif={capacite?.cle === c.cle} onPress={() => setCapaciteCle(c.cle)} libelle={`${c.nom}${c.touche ? ` (${c.touche})` : ''}`} testID={`esport-capacite-${c.cle}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 150 }}>
                      <IconeAsset theme={theme} url={c.icone} nom={c.nom} taille={24} couleur="#334155" />
                      <Text style={{ color: theme.texte, fontSize: 11 }} numberOfLines={1}>
                        {c.touche || c.nom}
                      </Text>
                    </View>
                  </Pastille>
                ))}
              </View>
              <FicheCapacite theme={theme} capacite={capacite} />
              <Choix<FormeZone | 'aucune' | 'auto'>
                theme={theme}
                libelle={tr('strats.editeur.zone')}
                valeur={formeZone}
                options={[
                  { id: 'auto', nom: trSt('forme.auto') },
                  ...FORMES_ZONE.map(f => ({ id: f, nom: trSt(`forme.${f}` as CleSt) })),
                  { id: 'aucune', nom: tr('strats.editeur.icone_seule') },
                ]}
                onChoisir={setFormeZone}
                repliable
                testID="esport-zone"
              />
              <Text style={attenue}>{trSt('palette.aide_capacite')}</Text>
            </>
          ) : null}
        </Panneau>
      ) : null}
      {outil === 'marqueur' ? (
        <Panneau theme={theme} testID="esport-editeur-marqueurs">
          <Intertitre theme={theme}>{trSt('outil.marqueur')}</Intertitre>
          <View style={[styles.ligne, { gap: 4 }]}>
            {def.marqueurs.map(g => (
              <Pastille key={g} theme={theme} actif={marqueurCourant.genre === g} onPress={() => setMarqueur({ ...marqueurCourant, genre: g })} libelle={trSt(`marqueur.${g}` as CleSt)} testID={`esport-marqueur-${g}`}>
                <Text style={{ color: theme.texte, fontSize: 12 }}>{trSt(`marqueur.${g}` as CleSt)}</Text>
              </Pastille>
            ))}
          </View>
          {marqueurCourant.genre === 'ennemi' && def.equipesAdverses > 1 ? (
            <Segments
              theme={theme}
              libelle={trSt('marqueur.equipe')}
              valeur={String(marqueurCourant.equipe ?? 1)}
              options={Array.from({ length: def.equipesAdverses }, (_, i) => [String(i + 1), trSt('marqueur.equipe_n', { n: i + 1 })] as const)}
              onChoisir={v => setMarqueur({ ...marqueurCourant, equipe: Number(v) })}
              testID="esport-marqueur-equipe"
            />
          ) : null}
          <Champ theme={theme} libelle={trSt('marqueur.etiquette')} valeur={marqueurCourant.etiquette} onChanger={v => setMarqueur({ ...marqueurCourant, etiquette: v.slice(0, 40) })} maxLength={40} testID="esport-marqueur-etiquette" />
          {couleurs}
        </Panneau>
      ) : null}
      {outil === 'vision' ? (
        <Panneau theme={theme} testID="esport-editeur-vision">
          <Intertitre theme={theme}>{trSt('outil.vision')}</Intertitre>
          <Segments theme={theme} libelle={trSt('inspecteur.ouverture')} valeur={String(vision.ouverture)} options={[['60', '60°'], ['90', '90°'], ['120', '120°'], ['360', '360°']] as const} onChoisir={v => setVision(x => ({ ...x, ouverture: Number(v) }))} testID="esport-vision-ouverture" />
          <Segments theme={theme} libelle={trSt('inspecteur.portee')} valeur={String(vision.portee)} options={[['15', '15 m'], ['30', '30 m'], ['50', '50 m']] as const} onChoisir={v => setVision(x => ({ ...x, portee: Number(v) }))} testID="esport-vision-portee" />
        </Panneau>
      ) : null}
      {outil === 'texte' ? (
        <Panneau theme={theme}>
          <Champ theme={theme} libelle={tr('strats.editeur.texte_a_poser_touchez')} valeur={texte} onChanger={setTexte} maxLength={200} testID="esport-editeur-texte" />
          {couleurs}
        </Panneau>
      ) : null}
      {outil === 'forme' ? (
        <Panneau theme={theme}>
          <Segments<'rect' | 'ellipse'> theme={theme} libelle={tr('strats.editeur.forme')} valeur={formeDessin} options={[['rect', tr('strats.editeur.rectangle')], ['ellipse', tr('strats.editeur.ellipse')]]} onChoisir={setFormeDessin} testID="esport-forme" />
          {couleurs}
        </Panneau>
      ) : null}
      {outil === 'fleche' || outil === 'ligne' ? (
        <Panneau theme={theme}>
          <Segments<'plein' | 'tirets'> theme={theme} libelle={tr('strats.editeur.trait')} valeur={tirets ? 'tirets' : 'plein'} options={[['plein', tr('strats.editeur.plein')], ['tirets', tr('strats.editeur.tirets_rotation')]]} onChoisir={v => setTirets(v === 'tirets')} testID="esport-trait" />
          {outil === 'fleche' ? (
            <Segments<'oui' | 'non'> theme={theme} libelle={trSt('palette.trajet_joueur')} valeur={trajetJoueur ? 'oui' : 'non'} options={[['oui', trSt('palette.trajet_oui')], ['non', trSt('palette.trajet_non')]]} onChoisir={v => setTrajetJoueur(v === 'oui')} testID="esport-trajet-joueur" />
          ) : null}
          {couleurs}
        </Panneau>
      ) : null}
      {choisi && peutModifier ? (
        <Inspecteur
          theme={theme}
          doc={doc}
          etape={iEtape}
          objet={choisi}
          faire={faire}
          niveaux={niveaux}
          genres={def.marqueurs}
          onFermer={() => setSelection(undefined)}
          onSupprimer={() => {
            faire({ type: 'supprimer', etape: iEtape, id: choisi.id });
            setSelection(undefined);
          }}
          onDupliquer={() => faire({ type: 'coller', etape: iEtape, objets: [choisi], decalage: 20 })}
        />
      ) : null}
      <PanneauJoueurs theme={theme} doc={doc} agents={agents} joueur={couleurLibre ? null : joueur} onJoueur={i => (setJoueur(i), setCouleurLibre(undefined))} faire={faire} modifiable={peutModifier} libelleAgent={libelleAgent} />
      <ListeUtilitaires theme={theme} doc={doc} etape={iEtape} faire={faire} modifiable={peutModifier} onChoisir={id => (setOutil('selection'), setSelection(id))} />
      <Panneau theme={theme} testID="esport-editeur-calques">
        <Intertitre theme={theme}>{tr('strats.editeur.calques')}</Intertitre>
        {CALQUES.map((c: Calque) => (
          <View key={c} style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ color: theme.texte, fontSize: 13, flex: 1 }}>{trSt(`calque.${c}` as CleSt)}</Text>
            <BoutonHub theme={theme} icone={doc.calques[c].visible ? 'oeil' : 'oeil-barre'} titre="" libelle={`${doc.calques[c].visible ? tr('strats.editeur.masquer') : tr('strats.editeur.afficher')} ${trSt(`calque.${c}` as CleSt)}`} onPress={() => faire({ type: 'calque', calque: c, champs: { visible: !doc.calques[c].visible } })} testID={`esport-calque-${c}-visible`} />
            {c !== 'fond' && c !== 'callouts' ? (
              <BoutonHub theme={theme} icone={doc.calques[c].verrou ? 'cadenas' : 'cadenas-ouvert'} titre="" libelle={`${doc.calques[c].verrou ? tr('strats.editeur.deverrouiller') : tr('strats.editeur.verrouiller')} ${trSt(`calque.${c}` as CleSt)}`} onPress={() => faire({ type: 'calque', calque: c, champs: { verrou: !doc.calques[c].verrou } })} testID={`esport-calque-${c}-verrou`} />
            ) : null}
          </View>
        ))}
      </Panneau>
    </View>
  );

  const reglagesStrat = (
    <View style={[styles.ligne, { gap: 8 }]} testID="esport-editeur-reglages">
      {def.sides && peutModifier ? (
        <Segments theme={theme} libelle={tr('scouting.scouting.side')} valeur={doc.side} options={[['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]] as const} onChoisir={side => faire({ type: 'side', side })} testID="esport-editeur-side" />
      ) : null}
      {def.economie.length && peutModifier ? (
        <Segments<Economie | 'aucune'>
          theme={theme}
          libelle={trSt('economie.titre')}
          valeur={doc.economie ?? 'aucune'}
          options={[['aucune', trSt('economie.aucune')], ...def.economie.map(x => [x, trSt(`economie.${x}` as CleSt)] as const)]}
          onChoisir={v => faire({ type: 'economie', economie: v === 'aucune' ? null : v })}
          testID="esport-editeur-economie"
        />
      ) : null}
      {niveaux.length ? (
        <Segments<string>
          theme={theme}
          libelle={trSt('niveau.etage')}
          valeur={niveau === null ? 'tous' : String(niveau)}
          options={[['tous', trSt('niveau.tous')], ...niveaux.map(n => [String(n.valeur), n.nom] as const)]}
          onChoisir={v => setNiveau(v === 'tous' ? null : Number(v))}
          testID="esport-editeur-niveau"
        />
      ) : null}
      {peutModifier ? (
        <Choix
          theme={theme}
          libelle={tr('strats.editeur.carte')}
          valeur={doc.carte.cle}
          options={cartesDuPool(assets, doc.carte.cle).map(c => ({ id: c.cle, nom: c.nom }))}
          onChoisir={cle => {
            const c = assets?.cartes.find(x => x.cle === cle);
            if (c) faire({ type: 'carte', carte: { cle: c.cle, nom: c.nom, image: c.minimap && /^https:\/\/media\.valorant-api\.com\//.test(c.minimap) ? c.minimap : null, echelle: c.echelle ?? null } });
          }}
          repliable
          testID="esport-editeur-carte"
        />
      ) : null}
    </View>
  );

  const canevas = (t: number, extra?: Partial<PropsCanevas>) => (
    <Suspense fallback={<Text style={attenue}>{tr('strats.editeur.chargement_de_l_editeur')}</Text>}>
      <Canevas {...propsCanevas} {...extra} taille={t} vue={vue} onVue={setVue} />
    </Suspense>
  );

  const chronologie = (
    <Chronologie
      theme={theme}
      doc={doc}
      etape={iEtape}
      onEtape={changerEtape}
      faire={faire}
      modifiable={peutModifier}
      temps={temps}
      enLecture={enLecture}
      onLire={lire}
      onPause={() => setEnLecture(false)}
      onArreter={arreter}
    />
  );

  return (
    <View style={{ gap: 12 }} testID="esport-editeur">
      <View style={{ gap: 6 }}>
        <View style={[styles.ligne, { flexWrap: 'nowrap' }]}>
          <BoutonHub theme={theme} titre={tr('strats.editeur.strats')} onPress={onRetour} testID="esport-editeur-retour" />
          <Text style={{ color: theme.texte, fontSize: 20, fontWeight: '800', flex: 1, minWidth: 0, ...police(theme.policeTitre) }} numberOfLines={1} testID="esport-editeur-titre">
            {strat.titre}
          </Text>
        </View>
        <Text style={attenue} testID="esport-editeur-resume">
          {[doc.carte.nom, def.sides ? LIBELLES_SIDE[doc.side] : '', doc.economie ? trSt(`economie.${doc.economie}` as CleSt) : '', trSt(`modele.${doc.modele}` as CleSt), tr('strats.editeur.version', { n: revision })].filter(Boolean).join(' · ')}
          {modifie ? tr('strats.editeur.modifications_non_enregistrees') : ''}
        </Text>
        <View style={[styles.ligne, { gap: 8 }]}>
          {peutModifier ? <BoutonHub theme={theme} titre={enCours === 'enregistrement' ? tr('membresRoles.enregistrement') : tr('discord.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID="esport-editeur-enregistrer" /> : null}
          <BoutonHub theme={theme} titre={trSt('presentation.ouvrir')} onPress={() => (setPresentation(true), setSelection(undefined))} testID="esport-editeur-presentation" />
          <BoutonHub theme={theme} titre={trSt('comparer.ouvrir')} variante={comparer ? 'plein' : 'normal'} onPress={() => setComparer(c => !c)} testID="esport-editeur-comparer" />
          <MenuActions
            theme={theme}
            titreBouton={trSt('export.menu')}
            libelle={trSt('export.menu')}
            testID="esport-editeur-exporter"
            actions={[
              { titre: tr('strats.editeur.exporter_en_png'), testID: 'esport-editeur-png', onPress: exporterPng },
              { titre: trSt('export.png_tout'), testID: 'esport-editeur-png-tout', onPress: exporterToutesPng },
              { titre: trSt('export.pdf'), testID: 'esport-editeur-pdf', onPress: exporterPdf },
              peutModifier && {
                titre: tr('strats.editeur.dupliquer_la_strat'),
                testID: 'esport-editeur-dupliquer',
                onPress: () =>
                  void agir('duplication', async () => {
                    const copie = await api.dupliquer(teamId, strat.id);
                    onOuvrir(copie.id);
                  }),
              },
            ]}
          />
          {strat.moi.supprimer ? (
            <BoutonHub theme={theme} titre={`🗑︎ ${trSs('supprimer')}`} libelle={trSs('supprimer.libelle', { titre: strat.titre })} variante="danger" desactive={Boolean(enCours)} onPress={() => setConfirmerSuppression(c => !c)} testID="esport-editeur-supprimer" />
          ) : null}
        </View>
      </View>
      {confirmerSuppression && strat.moi.supprimer ? (
        <ConfirmationSuppression
          theme={theme}
          testID="esport-editeur-supprimer-confirmation"
          titre={trSs('confirm.titre', { titre: strat.titre })}
          texte={trSs('confirm.texte')}
          oui={trSs('confirm.oui')}
          desactive={Boolean(enCours)}
          onAnnuler={() => setConfirmerSuppression(false)}
          onConfirmer={() =>
            void agir('suppression', async () => {
              await api.supprimer(teamId, strat.id);
              onSupprimee({ id: strat.id, titre: strat.titre });
            })
          }
        />
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-editeur" />
      {conflit !== undefined ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={tr('strats.editeur.recharger_la_version_du')} onPress={() => void agir('', charger)} testID="esport-editeur-recharger" />
          <BoutonHub theme={theme} titre={tr('strats.editeur.garder_la_mienne_ecraser')} variante="danger" onPress={() => (setErreur(undefined), void enregistrer(conflit))} testID="esport-editeur-ecraser" />
        </View>
      ) : null}
      {!peutModifier ? <Text style={attenue}>{tr('strats.editeur.lecture_seule_votre_role')}</Text> : null}
      {reglagesStrat}
      {peutModifier ? barreOutils : null}
      {comparer ? <Comparaison theme={theme} api={api} teamId={teamId} strat={strat} doc={doc} etape={iEtape} assets={assets} taille={large ? Math.min(560, (largeur || 900) / 2 - 12) : Math.min(taille, 420)} /> : null}
      <View style={{ flexDirection: large ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, width: '100%', gap: 8, minWidth: 0 }} onLayout={ev => setLargeur(ev.nativeEvent.layout.width)}>
          {canevas(taille)}
          {!carteAsset?.minimap && !doc.carte.image ? <Text style={attenue}>{trSt('editeur.sans_image')}</Text> : null}
          {carteAsset && !carteAsset.echelle ? <Text style={attenue} testID="esport-editeur-non-calibree">{trSt('editeur.non_calibree')}</Text> : null}
          {chronologie}
        </View>
        {peutModifier || doc.joueurs.length ? <View style={{ width: large ? 340 : '100%', gap: 10 }}>{palette}</View> : null}
      </View>
      <MentionRiot theme={theme} jeu={assets?.jeu} />
      {presentation ? (
        <Modal visible animationType="fade" onRequestClose={() => setPresentation(false)}>
          <ScrollView style={{ flex: 1, backgroundColor: theme.fond }} contentContainerStyle={{ padding: 16, gap: 12, alignItems: 'center' }} testID="esport-presentation">
            <View style={[styles.ligne, { justifyContent: 'space-between', width: '100%' }]}>
              <Text style={{ color: theme.texte, fontSize: 22, fontWeight: '800', ...police(theme.policeTitre) }}>{strat.titre}</Text>
              <BoutonHub theme={theme} titre={trSt('presentation.fermer')} onPress={() => (setPresentation(false), arreter())} testID="esport-presentation-fermer" />
            </View>
            {etapeCourante ? (
              <View style={[styles.ligne, { gap: 8, width: '100%' }]}>
                {etapeCourante.phase ? (
                  <View style={{ backgroundColor: couleurPhase(etapeCourante.phase), borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#ffffff', fontWeight: '700' }}>{libellePhase(etapeCourante.phase)}</Text>
                  </View>
                ) : null}
                <Text style={{ color: theme.texte, fontSize: 18, fontWeight: '700', ...police(theme.policeTexte) }}>{`${iEtape + 1}. ${etapeCourante.titre}`}</Text>
              </View>
            ) : null}
            {canevas(Math.max(260, Math.min(900, (globalThis as { innerWidth?: number }).innerWidth ? Math.min((globalThis as { innerWidth: number }).innerWidth - 32, ((globalThis as { innerHeight?: number }).innerHeight ?? 900) - 260) : 600)), { outil: 'main', onAction: () => undefined, selection: undefined, testID: 'esport-presentation-canevas' })}
            <View style={{ width: '100%', maxWidth: 900 }}>{chronologie}</View>
            {etapeCourante ? (
              <View style={{ width: '100%', maxWidth: 900, gap: 4 }}>
                {ordreUtilitaires(etapeCourante).map(c => (
                  <Text key={c.id} style={{ color: theme.texte, ...police(theme.policeTexte) }}>{`${c.ordre ?? '–'}. ${c.nom}${c.joueur !== null && doc.joueurs[c.joueur] ? ` (${doc.joueurs[c.joueur].nom})` : ''}`}</Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </Modal>
      ) : null}
    </View>
  );
}

/** Comparaison côte à côte : une autre strat de la team, ou une ancienne version de celle-ci (lecture seule). */
function Comparaison({ theme, api, teamId, strat, doc, etape, assets, taille }: { theme: ThemeHub; api: PropsEditeur['api']; teamId: string; strat: Strat; doc: DocumentStrat; etape: number; assets: PropsEditeur['assets']; taille: number }) {
  const [choix, setChoix] = useState<string | undefined>();
  const [options, setOptions] = useState<Array<{ id: string; nom: string }>>([]);
  const [autre, setAutre] = useState<DocumentStrat | undefined>();
  const [vueA, setVueA] = useState<Vue>(VUE_INITIALE);
  const [vueB, setVueB] = useState<Vue>(VUE_INITIALE);
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const [liste, versions] = await Promise.all([api.liste(teamId), api.versions(teamId, strat.id)]);
      setOptions([
        ...versions.filter(v => v.revision !== strat.revision).slice(0, 15).map(v => ({ id: `v:${v.revision}`, nom: trSt('comparer.version', { n: v.revision }) })),
        ...liste.filter(s => s.id !== strat.id && s.modele === strat.modele).map(s => ({ id: `s:${s.id}`, nom: s.titre })),
      ]);
    });
  }, [agir, api, teamId, strat.id, strat.modele, strat.revision]);
  useEffect(() => {
    if (!choix) return;
    void agir('', async () => {
      if (choix.startsWith('v:')) setAutre(lireDocument((await api.version(teamId, strat.id, Number(choix.slice(2)))).donnees, strat.modele));
      else {
        const s = await api.detail(teamId, choix.slice(2));
        setAutre(lireDocument(s.donnees, s.modele));
      }
    });
  }, [agir, api, choix, strat.id, strat.modele, teamId]);
  const carte = (d: DocumentStrat) => assets?.cartes.find(c => c.cle === d.carte.cle);
  const commun = { outil: 'main' as const, couleur: '#ffffff', joueur: null, formeZone: 'auto' as const, formeDessin: 'rect' as const, texte: '', tirets: false, epaisseur: 5, onSelection: () => undefined, onAction: () => undefined, images: cacheImages };
  return (
    <Panneau theme={theme} testID="esport-comparaison">
      <Choix theme={theme} libelle={trSt('comparer.avec')} valeur={choix} options={options} onChoisir={setChoix} repliable testID="esport-comparaison-choix" />
      <Retours theme={theme} erreur={erreur} prefixe="esport-comparaison" />
      {autre ? (
        <View style={[styles.ligne, { alignItems: 'flex-start', gap: 12 }]}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.texte, fontWeight: '700' }}>{trSt('comparer.actuelle')}</Text>
            <Suspense fallback={null}>
              <Canevas {...commun} doc={doc} carte={carte(doc)} fond={doc.carte.image ?? carte(doc)?.minimap ?? null} etape={etape} taille={taille} vue={vueA} onVue={setVueA} testID="esport-comparaison-a" />
            </Suspense>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.texte, fontWeight: '700' }}>{options.find(o => o.id === choix)?.nom ?? ''}</Text>
            <Suspense fallback={null}>
              <Canevas {...commun} doc={autre} carte={carte(autre)} fond={autre.carte.image ?? carte(autre)?.minimap ?? null} etape={Math.min(etape, autre.etapes.length - 1)} taille={taille} vue={vueB} onVue={setVueB} testID="esport-comparaison-b" />
            </Suspense>
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}
