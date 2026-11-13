/**
 * Canevas 2D de l'éditeur de strats (Konva, via react-konva). Chargé à la demande (import dynamique depuis
 * Editeur.web.tsx) : Konva n'entre dans le paquet du site qu'à l'ouverture de l'éditeur.
 *
 * Le canevas remplit la place qu'on lui donne (`largeur` × `hauteur`) ; le repère du document (carré de 1000)
 * y est CADRÉ dans la zone laissée libre par l'interface (`marges`) : toute la map visible et centrée à
 * l'ouverture (src/esport/strats/geometrie.ts, `cadrage`), puis zoom et déplacement de la vue par-dessus.
 *
 * Trois calques Konva seulement (mémoire d'un iPad) : le fond (plateau thémé : src/esport/cartes/rendu.web.ts,
 * callouts et repères du profil, grille de l'aimantation), les objets (calques de la strat, fantôme de l'étape
 * précédente), le dessus (aperçus des gestes, rectangle de sélection, poignées, étiquettes, laser, présences).
 *
 * Gestes : poser en cliquant-glissant (src/esport/strats/pose.ts), grandes poignées de la sélection (26 px à
 * l'écran, prise de 48 px), sélection multiple (rectangle avec l'outil Sélection, Maj + clic), déplacement de
 * groupe, menu contextuel (clic droit, appui long), zoom AU POINTEUR (molette, pincement), déplacement de la
 * vue (outil Main, Espace + glisser, molette pressée, deux doigts), double-clic sur le vide = map entière.
 *
 * Performance : objets mémoïsés (src/esport/ui/strats/canevas/dessins.web.tsx), tailles à l'écran appliquées
 * sans re-rendu, vue et aperçus limités à une mise à jour par image (requestAnimationFrame).
 */

import Konva from 'konva';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Wedge } from 'react-konva';
import { rendreCarte } from '../../cartes/rendu.web';
import { sourcesIcone, type AgentAsset, type CapaciteAsset } from '../../strats/assets';
import { VUE_INITIALE, calqueDe, couleurJoueur, idUnique, pionsFinaux, zoneParDefaut, zoomer, type ChampsObjet, type ObjetStrat, type Vue, type Zone } from '../../strats/document';
import { SANS_MARGE, aimanter, cadrage, cadreImage, centre, dansPolygone, departsDepuis, dimensionFixe, etatLecture, longueurMax, objetsDansRectangle, rectangle, zoneDepuisCapacite } from '../../strats/geometrie';
import { echelleEffective } from '../../strats/modeles';
import { PLATEAU, alpha, couleurAffichee, etiquettesVisibles, facteurEcran, melanger, opaciteEtiquette, segmentsMur, styleCapacite, themeCarte } from '../../strats/plateau';
import { avecChamps, debuterVisee, estGlisse, poigneesObjet, poseCapacite, posePion, poseVision, suivreVisee, tirerPoigneeDe, type PoigneeObjet, type Visee } from '../../strats/pose';
import { tr } from '../../i18n';
import { FormeCapacite, Halo, Objet, cote, tailleReelle, useImage } from './canevas/dessins.web';
import type { Outil, PropsCanevas } from './canevas/types';

export { cote } from './canevas/dessins.web';

export type { Depot, ExportCanevas, MenuCanevas, Outil, PropsCanevas } from './canevas/types';

Konva.hitOnDragEnabled = true;

const T = PLATEAU;
const adouci = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));

/** Contenu tourné autour du centre du repère (map retournée). Composant stable : les nœuds ne sont pas recréés. */
const Tourne = React.forwardRef<Konva.Group, { rotation: number; children: React.ReactNode }>(function Tourne({ rotation, children }, ref) {
  return (
    <Group ref={ref} x={500} y={500} offsetX={500} offsetY={500} rotation={rotation}>
      {children}
    </Group>
  );
});

type Brouillon = { type: 'trace'; points: number[] } | { type: 'forme'; x: number; y: number; l: number; h: number };

/** Taille des poignées À L'ÉCRAN (px) : rayon dessiné, et demi-largeur de la zone de prise (doigt, stylet). */
export const RAYON_POIGNEE_PX = 13;
export const PRISE_POIGNEE_PX = 24;
/** En deçà (px à l'écran), un appui n'est pas un glisser : pose simple. */
const SEUIL_GLISSER_PX = 8;
const APPUI_LONG_MS = 550;
const DUREE_LASER_MS = 900;
/** Outils de pose : un appui sur un objet existant le SÉLECTIONNE (et le déplace) au lieu de poser. */
const OUTILS_POSE: ReadonlyArray<Outil> = ['agent', 'capacite', 'marqueur', 'vision', 'texte'];
const CALQUES_OBJETS = ['vision', 'utilitaires', 'marqueurs', 'dessins', 'texte'] as const;
/** Icône d'un document : seule une adresse du CDN Riot y est acceptée (un lien signé expire). */
const iconeDocument = (url: string | null | undefined) => (url && /^https:\/\/media\.valorant-api\.com\//.test(url) ? url : null);
const iconeDoc = (a: { icone: string | null; iconeDoc?: string | null } | undefined) => iconeDocument(a?.iconeDoc) ?? iconeDocument(a?.icone);
const VIDE: readonly string[] = [];
/**
 * Sources d'une image du jeu (image importée, puis CDN officiel, puis celle du document), en liste STABLE : la même
 * référence pour les mêmes adresses, pour que les objets mémoïsés ne se redessinent pas à chaque rendu.
 */
const listesSources = new Map<string, ReadonlyArray<string>>();
function sourcesStables(a: { icone?: string | null; iconeDoc?: string | null } | null | undefined, ...secours: Array<string | null | undefined>): ReadonlyArray<string> {
  const liste = sourcesIcone(a, ...secours);
  const cle = liste.join('\n');
  const connue = listesSources.get(cle);
  if (connue) return connue;
  if (listesSources.size > 800) listesSources.clear();
  listesSources.set(cle, liste);
  return liste;
}
const origineDe = (o: ObjetStrat) => ('points' in o ? { x: 0, y: 0 } : o.type === 'forme' && o.forme === 'ellipse' ? { x: o.x + o.l / 2, y: o.y + o.h / 2 } : { x: o.x, y: o.y });

export default function CanevasStrat(p: PropsCanevas) {
  const { doc, etape, outil, vue, onAction, images, carte } = p;
  const R = useRef(p);
  R.current = p;
  const largeur = Math.max(40, Math.round(p.largeur ?? p.taille ?? 600));
  const hauteur = Math.max(40, Math.round(p.hauteur ?? p.taille ?? 600));
  const marges = p.marges ?? SANS_MARGE;
  const cadre0 = useMemo(() => cadrage(largeur, hauteur, marges, p.taille ? 0 : 12), [largeur, hauteur, marges, p.taille]);
  const cadreRef = useRef(cadre0);
  cadreRef.current = cadre0;
  const selection = p.selection ?? VIDE;
  const scene = useRef<Konva.Stage>(null);
  const repere = useRef<Konva.Group>(null);
  const dessus = useRef<Konva.Layer>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const [fantome, setFantome] = useState<{ x: number; y: number } | undefined>();
  const [apercu, setApercu] = useState<{ id: string; champs: ChampsObjet } | undefined>();
  const [visee, setVisee] = useState<Visee | undefined>();
  const [cadreSel, setCadreSel] = useState<{ a: { x: number; y: number }; b: { x: number; y: number }; ajout: boolean } | undefined>();
  const [survol, setSurvol] = useState<string | undefined>();
  const [maj, setMaj] = useState(false);
  const [trainee, setTrainee] = useState<Array<{ x: number; y: number; t: number }>>([]);
  const [enPan, setEnPan] = useState(false);
  const pincement = useRef<{ distance: number; centre: { x: number; y: number } } | undefined>(undefined);
  const pan = useRef<{ x: number; y: number; vue: Vue } | undefined>(undefined);
  const appuiLong = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOuvert = useRef(false);
  const glisse = useRef<{ origines: Map<string, { x: number; y: number }>; noeuds: Map<string, Konva.Node> } | undefined>(undefined);
  const theme = themeCarte(p.themeCarte);
  const fondImg = useImage(carte?.minimap ?? p.fond, images);
  const e = doc.etapes[etape];
  const echelle = carte?.echelle ?? doc.carte.echelle;
  const pxParUnite = cadre0.base * vue.echelle;
  /** Unités du document par pixel d'écran (poignées et seuils de taille constante quel que soit le zoom). */
  const parPixel = 1 / Math.max(0.01, pxParUnite);
  const editable = p.temps === undefined && !p.lectureSeule;
  const agentDe = (cle: string) => p.agents?.find(a => a.cle === cle) ?? (p.agent?.cle === cle ? p.agent : undefined);
  const capaciteDe = (agent: string, cle: string) => agentDe(agent)?.capacites.find(c => c.cle === cle);
  const donneesDe = (o: ObjetStrat | undefined) => (o?.type === 'capacite' ? capaciteDe(o.agent, o.capacite)?.donnees : undefined);

  // ---------------------------------------------------------------- Map thémée
  const rendu = useMemo(() => {
    if (!fondImg) return undefined;
    try {
      return rendreCarte(fondImg, { theme: p.themeCarte ?? 'tactique', attenuation: p.attenuation ?? 0, largeurImage: carte?.largeurImage, hauteurImage: carte?.hauteurImage });
    } catch {
      return undefined;
    }
  }, [fondImg, p.themeCarte, p.attenuation, carte?.largeurImage, carte?.hauteurImage]);
  const cadreBrut = cadreImage(fondImg && carte?.largeurImage ? carte.largeurImage : fondImg?.naturalWidth, fondImg && carte?.hauteurImage ? carte.hauteurImage : fondImg?.naturalHeight);

  // ---------------------------------------------------------------- Bascule attaque / défense animée
  const cible = p.rotation ?? 0;
  const [rotation, setRotation] = useState<number>(cible);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  useEffect(() => {
    if (rotationRef.current === cible) return undefined;
    if (R.current.mouvementReduit || typeof requestAnimationFrame !== 'function') {
      setRotation(cible);
      return undefined;
    }
    const depart = rotationRef.current;
    const t0 = performance.now();
    let id = 0;
    const pas = (t: number) => {
      const f = Math.min(1, (t - t0) / (T.animation.bascule * 1000));
      setRotation(f >= 1 ? cible : depart + (cible - depart) * adouci(f));
      if (f < 1) id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [cible]);

  // ---------------------------------------------------------------- Tailles à l'écran (sans re-rendu)
  const appliquerEchelles = useCallback((px: number): boolean => {
    const st = scene.current;
    if (!st) return false;
    const regles: Array<[string, number]> = [
      ['.jeton-pion', facteurEcran(T.pion.rayon + T.pion.anneau, px, T.pion.ecranMinPx, T.pion.ecranMaxPx)],
      ['.jeton-puce', facteurEcran(T.capacite.puceRayon + 2, px, T.capacite.ecranMinPx, T.capacite.ecranMaxPx)],
      ['.jeton-texte', facteurEcran(T.typo.s, px, 10, 15)],
    ];
    let change = false;
    for (const [nom, k] of regles) {
      for (const n of st.find(nom)) {
        if (Math.abs(n.scaleX() - k) > 0.002) {
          n.scale({ x: k, y: k });
          change = true;
        }
      }
    }
    return change;
  }, []);
  useLayoutEffect(() => {
    if (appliquerEchelles(pxParUnite)) scene.current?.batchDraw();
  });

  // ---------------------------------------------------------------- Export (synchrone : aucun clignotement)
  const exporter = useCallback(
    (options: { pixelRatio: number; mimeType?: string; quality?: number }) => {
      const st = scene.current;
      if (!st) throw new Error(tr('strats.canevasStrat.canevas_pas_pret'));
      const avant = { echelle: st.scaleX(), x: st.x(), y: st.y() };
      const caches: Konva.Node[] = [];
      const montres: Konva.Node[] = [];
      for (const n of [...st.find('.selection'), ...st.find('.hors-export')]) {
        if (n.visible()) {
          n.visible(false);
          caches.push(n);
        }
      }
      for (const n of st.find('.callout-etiquette')) {
        if (!n.visible()) {
          n.visible(true);
          montres.push(n);
        }
      }
      const dessusVisible = dessus.current?.visible() ?? false;
      dessus.current?.visible(false);
      st.scale({ x: 1, y: 1 });
      st.position({ x: 0, y: 0 });
      appliquerEchelles(1);
      try {
        try {
          return st.toDataURL({ x: 0, y: 0, width: 1000, height: 1000, ...options });
        } catch (erreur) {
          // Image d'une autre origine qui « contamine » le canevas : export avec les initiales à sa place, jamais d'échec.
          const masquees = st.find('.image-jeu').filter(n => n.visible());
          if (!masquees.length) throw erreur;
          masquees.forEach(n => n.visible(false));
          try {
            return st.toDataURL({ x: 0, y: 0, width: 1000, height: 1000, ...options });
          } finally {
            masquees.forEach(n => n.visible(true));
          }
        }
      } finally {
        st.scale({ x: avant.echelle, y: avant.echelle });
        st.position({ x: avant.x, y: avant.y });
        for (const n of caches) n.visible(true);
        for (const n of montres) n.visible(false);
        dessus.current?.visible(dessusVisible);
        appliquerEchelles(avant.echelle);
        st.batchDraw();
      }
    },
    [appliquerEchelles],
  );

  /** Point du pointeur dans le repère du document (map retournée comprise), aimanté au besoin. */
  const position = (aimante = true) => {
    const pt = repere.current?.getRelativePointerPosition();
    if (!pt) return undefined;
    const a = aimante ? (R.current.aimant ?? 0) : 0;
    return { x: Math.round(aimanter(pt.x, a) * 10) / 10, y: Math.round(aimanter(pt.y, a) * 10) / 10 };
  };
  const versDocument = useCallback((clientX: number, clientY: number) => {
    const st = scene.current;
    const boite = st?.container().getBoundingClientRect();
    if (!st || !boite || clientX < boite.left || clientX > boite.right || clientY < boite.top || clientY > boite.bottom) return undefined;
    st.setPointersPositions({ clientX, clientY });
    const pt = repere.current?.getRelativePointerPosition();
    return pt ? { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 } : undefined;
  }, []);

  const objetSous = (noeud: Konva.Node): string | undefined => {
    const groupe = noeud.hasName('objet') ? noeud : noeud.findAncestor('.objet', true);
    return groupe?.id() || undefined;
  };
  const fige = (o: ObjetStrat) => doc.calques[calqueDe(o)].verrou || Boolean(o.verrou);
  const niveau = p.niveau ?? null;
  const avecNiveau = <X extends ObjetStrat>(o: X): X => (niveau !== null ? { ...o, niveau } : o);
  /** Pion du joueur courant dans l'étape (origine d'un lancer, direction d'un cône). */
  const pionJoueur = (j: number | null) => (j === null ? undefined : (e?.objets.find(o => o.type === 'agent' && o.joueur === j) as { x: number; y: number } | undefined));

  /** Zone d'une capacité posée en `pt` : à sa taille réelle, orientée depuis le pion du joueur (un trajet part du pion). */
  function zoneDeBase(capacite: CapaciteAsset | undefined = p.capacite): Zone | null {
    return p.formeZone === 'auto' ? zoneDepuisCapacite(capacite?.donnees) : zoneParDefaut(p.formeZone);
  }
  function zonePourPose(pt: { x: number; y: number }, capacite: CapaciteAsset | undefined = p.capacite, joueur: number | null = p.joueur): Zone | null {
    let zone = zoneDeBase(capacite);
    const pion = pionJoueur(joueur);
    if (zone && pion && Math.hypot(pt.x - pion.x, pt.y - pion.y) > 4) {
      const angle = Math.round(((Math.atan2(pt.y - pion.y, pt.x - pion.x) * 180) / Math.PI) * 10) / 10;
      if (zone.forme === 'trajet') zone = { ...zone, dx: Math.round((pion.x - pt.x) * 10) / 10, dy: Math.round((pion.y - pt.y) * 10) / 10 };
      else if (zone.forme === 'cone' || zone.forme === 'ligne' || zone.forme === 'rect') zone = { ...zone, angle };
      else if (zone.forme === 'mur') zone = { ...zone, angle: angle + 90 };
    }
    // Bornée à la longueur réelle de la capacité.
    const max = longueurMax(capacite?.donnees);
    if (zone && max !== undefined) {
      if (zone.forme === 'cone' && zone.portee > max) zone = { ...zone, portee: max };
      if ((zone.forme === 'mur' || zone.forme === 'ligne' || zone.forme === 'rect') && zone.longueur > max) zone = { ...zone, longueur: max };
    }
    return zone;
  }
  const idsDocument = () => doc.etapes.flatMap(x => x.objets.map(o => o.id));

  /** Sélection d'un objet touché : Maj ajoute ou retire ; sinon lui seul (un objet déjà choisi garde son groupe). */
  function selectionner(id: string, ajout: boolean) {
    if (ajout) p.onSelection(selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id]);
    else if (!selection.includes(id)) p.onSelection([id]);
  }

  // ---------------------------------------------------------------- Vue : une mise à jour par image
  const vueRef = useRef(vue);
  const rafVue = useRef(0);
  if (!rafVue.current) vueRef.current = vue;
  const planifierVue = useCallback((v: Vue) => {
    vueRef.current = v;
    if (rafVue.current) return;
    rafVue.current = requestAnimationFrame(() => {
      rafVue.current = 0;
      R.current.onVue(vueRef.current);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafVue.current), []);

  function debuterPan(ev: PointerEvent) {
    pan.current = { x: ev.clientX, y: ev.clientY, vue: vueRef.current };
    setEnPan(true);
    const bouge = (m: PointerEvent) => {
      const d = pan.current;
      if (!d || pincement.current) return;
      planifierVue({ ...d.vue, x: d.vue.x + m.clientX - d.x, y: d.vue.y + m.clientY - d.y });
    };
    const fin = () => {
      pan.current = undefined;
      setEnPan(false);
      window.removeEventListener('pointermove', bouge);
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
    };
    window.addEventListener('pointermove', bouge);
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  }

  function annulerAppuiLong() {
    if (appuiLong.current) clearTimeout(appuiLong.current);
    appuiLong.current = undefined;
  }

  function auPointeurBas(ev: Konva.KonvaEventObject<PointerEvent>) {
    const natif = ev.evt as PointerEvent | undefined;
    menuOuvert.current = false;
    if (pincement.current || (natif && natif.isPrimary === false)) return;
    if (p.laser) {
      const pt = position(false);
      if (pt) setTrainee([{ ...pt, t: performance.now() }]);
      return;
    }
    if (natif && (natif.button === 1 || p.panTemporaire || outil === 'main' || !editable)) {
      debuterPan(natif);
      return;
    }
    if (!editable || (natif && natif.button === 2)) return;
    if (ev.target.hasName('poignee')) return;
    const pt = position();
    if (!pt || !e) return;
    const touche = objetSous(ev.target);
    const ajout = Boolean(natif?.shiftKey);
    setMaj(ajout);
    // Appui long au doigt sur un objet : menu contextuel.
    if (touche && natif && natif.pointerType !== 'mouse' && p.onMenu) {
      const depart = { x: natif.clientX, y: natif.clientY };
      annulerAppuiLong();
      appuiLong.current = setTimeout(() => {
        appuiLong.current = undefined;
        menuOuvert.current = true;
        scene.current?.find('.objet').forEach(n => n.isDragging() && n.stopDrag());
        const ids = R.current.selection?.includes(touche) ? [...(R.current.selection ?? [])] : [touche];
        R.current.onSelection(ids);
        R.current.onMenu?.({ x: depart.x, y: depart.y, ids, point: pt });
      }, APPUI_LONG_MS);
    }
    // Outil de pose sur un objet existant : on le sélectionne (ses poignées apparaissent, on peut le déplacer).
    if (touche && OUTILS_POSE.includes(outil)) {
      selectionner(touche, ajout);
      return;
    }
    const ajouter = (objet: ObjetStrat) => onAction({ type: 'ajouter', etape, objet: avecNiveau(objet) });
    switch (outil) {
      case 'selection':
        if (touche) selectionner(touche, ajout);
        else {
          const brut = position(false) ?? pt;
          setCadreSel({ a: brut, b: brut, ajout });
        }
        return;
      case 'gomme':
        if (touche) onAction({ type: 'supprimer', etape, id: touche });
        return;
      case 'agent':
      case 'capacite':
      case 'vision':
        // Cliquer-glisser : l'appui fixe l'origine, le relâché la direction (voir auPointeurHaut).
        if (outil === 'capacite' && (!p.agent || !p.capacite)) return;
        if (outil === 'agent' && !p.agent) return;
        setVisee(debuterVisee(pt));
        setFantome(undefined);
        return;
      case 'marqueur':
        if (p.marqueur) {
          const id = idUnique(idsDocument());
          ajouter({ id, type: 'marqueur', x: pt.x, y: pt.y, genre: p.marqueur.genre, etiquette: p.marqueur.etiquette.trim().slice(0, 40), couleur: p.couleur, equipe: p.marqueur.equipe });
          p.onSelection([id]);
        }
        return;
      case 'texte':
        if (p.texte.trim()) {
          const id = idUnique(idsDocument());
          ajouter({ id, type: 'texte', x: pt.x, y: pt.y, texte: p.texte.trim().slice(0, 200), couleur: p.couleur, taille: T.typo.xl });
          p.onSelection([id]);
        }
        return;
      case 'fleche':
      case 'ligne':
        setBrouillon({ type: 'trace', points: [pt.x, pt.y, pt.x, pt.y] });
        return;
      case 'forme':
        setBrouillon({ type: 'forme', x: pt.x, y: pt.y, l: 0, h: 0 });
        return;
      default:
        return;
    }
  }

  /** Pose d'un pion, d'une capacité ou d'un cône de vision (geste terminé, ou dépôt depuis le dock). */
  function poser(ctx: { outil: Outil; agent?: AgentAsset; capacite?: CapaciteAsset; joueur: number | null; couleur: string }, v: Visee, aimant: boolean): boolean {
    if (!e) return false;
    const couleur = ctx.joueur !== null ? couleurJoueur(doc, ctx.joueur) : ctx.couleur;
    const glisseV = estGlisse(v, SEUIL_GLISSER_PX * parPixel);
    const id = idUnique(idsDocument());
    if (ctx.outil === 'agent' && ctx.agent) {
      const pose = glisseV ? posePion(v, aimant) : { x: v.origine.x, y: v.origine.y };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'agent', ...pose, agent: ctx.agent.cle, nom: ctx.agent.nom, icone: iconeDoc(ctx.agent), joueur: ctx.joueur, couleur }) });
    } else if (ctx.outil === 'capacite' && ctx.agent && ctx.capacite) {
      const pose = glisseV ? poseCapacite(v, zoneDeBase(ctx.capacite), echelle, ctx.capacite.donnees, aimant) : { x: v.origine.x, y: v.origine.y, zone: zonePourPose(v.origine, ctx.capacite, ctx.joueur) };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'capacite', x: pose.x, y: pose.y, agent: ctx.agent.cle, capacite: ctx.capacite.cle, nom: ctx.capacite.nom, icone: iconeDoc(ctx.capacite), joueur: ctx.joueur, couleur, zone: pose.zone, ordre: p.ordreSuivant ?? null }) });
    } else if (ctx.outil === 'vision') {
      const pion = pionJoueur(ctx.joueur);
      const pose = glisseV ? poseVision(v, echelle, aimant) : { x: v.origine.x, y: v.origine.y, angle: pion ? Math.round((Math.atan2(v.origine.y - pion.y, v.origine.x - pion.x) * 180) / Math.PI) : -90, portee: p.vision?.portee ?? 30 };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'vision', ...pose, ouverture: p.vision?.ouverture ?? 90, joueur: ctx.joueur, couleur }) });
    } else return false;
    p.onSelection([id]);
    return true;
  }
  const poserRef = useRef(poser);
  poserRef.current = poser;

  const { onPret } = p;
  useEffect(() => {
    onPret?.({
      png: (ratio = 1) => exporter({ pixelRatio: ratio }),
      miniature: () => exporter({ pixelRatio: 0.32, mimeType: 'image/jpeg', quality: 0.78 }),
      versDocument,
      deposer: (clientX, clientY, quoi) => {
        const pt = versDocument(clientX, clientY);
        if (!pt) return false;
        const a = R.current.aimant ?? 0;
        const origine = { x: aimanter(pt.x, a), y: aimanter(pt.y, a) };
        return poserRef.current({ outil: quoi.type === 'agent' ? 'agent' : 'capacite', agent: quoi.agent, capacite: quoi.type === 'capacite' ? quoi.capacite : undefined, joueur: quoi.joueur, couleur: quoi.couleur }, debuterVisee(origine), false);
      },
    });
  }, [onPret, exporter, versDocument]);

  // ---------------------------------------------------------------- Pointeur : aperçus limités à une image
  const rafSurvol = useRef(0);
  const calloutSous = useRef<string | undefined>(undefined);
  useEffect(() => () => cancelAnimationFrame(rafSurvol.current), []);

  function auPointeurBouge(ev?: Konva.KonvaEventObject<PointerEvent>) {
    const natif = ev?.evt as PointerEvent | undefined;
    if (appuiLong.current && natif) annulerAppuiLong();
    if (pan.current || pincement.current) return;
    if (p.laser) {
      if (p.laser === 'libre' || trainee.length) {
        const pt = position(false);
        if (pt) setTrainee(t0 => [...t0.slice(-80), { ...pt, t: performance.now() }]);
      }
      return;
    }
    if (visee) {
      const pt = position();
      if (pt) setVisee(suivreVisee(visee, pt, 4 * parPixel));
      if (natif) setMaj(Boolean(natif.shiftKey));
      return;
    }
    if (cadreSel) {
      const pt = position(false);
      if (pt) setCadreSel({ ...cadreSel, b: pt });
      return;
    }
    if (brouillon) {
      const pt = position(brouillon.type === 'forme');
      if (!pt) return;
      if (brouillon.type === 'forme') {
        setBrouillon({ ...brouillon, l: pt.x - brouillon.x, h: pt.y - brouillon.y });
        return;
      }
      const pts = brouillon.points;
      const n = pts.length;
      const [px, py] = [pts[n - 4], pts[n - 3]];
      // Tracé à main levée : un point de plus tous les 18 (32 points au plus), sinon le dernier suit le pointeur.
      if (Math.hypot(pt.x - px, pt.y - py) > 18 && n < 64) setBrouillon({ type: 'trace', points: [...pts.slice(0, n - 2), pt.x, pt.y, pt.x, pt.y] });
      else setBrouillon({ type: 'trace', points: [...pts.slice(0, n - 2), pt.x, pt.y] });
      return;
    }
    // Survol : aperçu de ce que l'on va poser, callout sous le pointeur, présence. Une fois par image.
    if (rafSurvol.current) return;
    rafSurvol.current = requestAnimationFrame(() => {
      rafSurvol.current = 0;
      const q = R.current;
      const libre = q.temps === undefined && !q.lectureSeule;
      if (libre && (q.outil === 'capacite' || q.outil === 'agent') && (q.outil === 'agent' ? q.agent : q.capacite)) {
        const pt = position();
        if (pt) setFantome(pt);
      }
      const brut = position(false);
      if (q.onCallout && q.carte?.zones?.length) {
        const z = brut ? q.carte.zones.find(x => dansPolygone(brut.x, brut.y, x.points)) : undefined;
        if (z?.nom !== calloutSous.current) {
          calloutSous.current = z?.nom;
          q.onCallout(z?.nom);
        }
      }
    });
  }

  function auPointeurHaut(ev?: Konva.KonvaEventObject<PointerEvent>) {
    annulerAppuiLong();
    if (menuOuvert.current) {
      // L'appui long a ouvert le menu : le relâché ne pose rien.
      setVisee(undefined);
      setBrouillon(undefined);
      setCadreSel(undefined);
      return;
    }
    if (visee) {
      const pt = pincement.current ? undefined : position();
      const v = pt ? suivreVisee(visee, pt, 4 * parPixel) : visee;
      setVisee(undefined);
      poser({ outil, agent: p.agent, capacite: p.capacite, joueur: p.joueur, couleur: p.couleur }, v, ev?.evt ? Boolean(ev.evt.shiftKey) : maj);
      return;
    }
    if (cadreSel) {
      setCadreSel(undefined);
      const r = rectangle(cadreSel.a, cadreSel.b);
      if (r.x2 - r.x1 < 4 * parPixel && r.y2 - r.y1 < 4 * parPixel) {
        // Simple clic sur le vide : la sélection tombe.
        if (!cadreSel.ajout && selection.length) p.onSelection([]);
        return;
      }
      const dedans = objetsDansRectangle((e?.objets ?? []).filter(o => doc.calques[calqueDe(o)].visible && !doc.calques[calqueDe(o)].verrou), r);
      p.onSelection(cadreSel.ajout ? [...new Set([...selection, ...dedans])] : dedans);
      return;
    }
    if (!brouillon) return;
    setBrouillon(undefined);
    const ids = idsDocument();
    if (brouillon.type === 'forme') {
      const x = Math.min(brouillon.x, brouillon.x + brouillon.l);
      const y = Math.min(brouillon.y, brouillon.y + brouillon.h);
      const l = Math.abs(brouillon.l);
      const h = Math.abs(brouillon.h);
      if (l < 6 || h < 6) return;
      const id = idUnique(ids);
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'forme', forme: p.formeDessin, x, y, l, h, couleur: p.couleur, remplie: false }) });
      p.onSelection([id]);
      return;
    }
    // Points en double (dernier point fixe) retirés ; un tracé trop court est ignoré.
    const pts = brouillon.points;
    const propres: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const n = propres.length;
      if (n >= 2 && Math.hypot(pts[i] - propres[n - 2], pts[i + 1] - propres[n - 1]) < 2) continue;
      propres.push(pts[i], pts[i + 1]);
    }
    if (propres.length < 4 || Math.hypot(propres[propres.length - 2] - propres[0], propres[propres.length - 1] - propres[1]) < 8) return;
    const trajet = outil === 'fleche' && p.trajetJoueur && p.joueur !== null;
    onAction({
      type: 'ajouter',
      etape,
      objet: avecNiveau({
        id: idUnique(ids),
        type: outil === 'ligne' ? 'ligne' : 'fleche',
        points: propres,
        couleur: trajet ? couleurJoueur(doc, p.joueur) : p.couleur,
        epaisseur: p.epaisseur,
        tirets: p.tirets,
        ...(p.usage && p.usage !== (p.tirets ? 'rotation' : 'deplacement') ? { usage: p.usage } : {}),
        ...(trajet ? { joueur: p.joueur, t0: 0, t1: e?.duree ?? 5 } : {}),
      }),
    });
  }

  // ---------------------------------------------------------------- Déplacement (seul ou en groupe)
  const debutDeplacement = useCallback((o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>) => {
    const q = R.current;
    if (appuiLong.current) clearTimeout(appuiLong.current);
    appuiLong.current = undefined;
    const couche = ev.target.getLayer();
    const ids = q.selection?.includes(o.id) ? q.selection : [o.id];
    const origines = new Map<string, { x: number; y: number }>();
    const noeuds = new Map<string, Konva.Node>();
    for (const id of ids) {
      const n = id === o.id ? ev.target : couche?.findOne(`#${id}`);
      const obj = q.doc.etapes[q.etape]?.objets.find(x => x.id === id);
      if (!n || !obj || (id !== o.id && (q.doc.calques[calqueDe(obj)].verrou || obj.verrou))) continue;
      origines.set(id, origineDe(obj));
      noeuds.set(id, n);
    }
    glisse.current = { origines, noeuds };
    q.onOccupe?.(true);
  }, []);
  const deplacementEnCours = useCallback((o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>) => {
    const g = glisse.current;
    const o0 = g?.origines.get(o.id);
    if (!g || !o0 || g.noeuds.size < 2) return;
    const dx = ev.target.x() - o0.x;
    const dy = ev.target.y() - o0.y;
    for (const [id, n] of g.noeuds) {
      if (id === o.id) continue;
      const base = g.origines.get(id) as { x: number; y: number };
      n.position({ x: base.x + dx, y: base.y + dy });
    }
  }, []);
  const finDeplacement = useCallback((o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>) => {
    const q = R.current;
    const node = ev.target;
    const g = glisse.current;
    glisse.current = undefined;
    q.onOccupe?.(false);
    const origine = origineDe(o);
    const a = q.aimant ?? 0;
    const dx = 'points' in o ? node.x() : aimanter(node.x(), a) - origine.x;
    const dy = 'points' in o ? node.y() : aimanter(node.y(), a) - origine.y;
    // Les nœuds reviennent à leur place : c'est le document (et donc l'historique) qui les déplace.
    node.position(origine);
    if (g) for (const [id, n] of g.noeuds) n.position(g.origines.get(id) as { x: number; y: number });
    if (menuOuvert.current) return;
    const ids = g ? [...g.noeuds.keys()] : [o.id];
    const d = { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 };
    if (ids.length > 1) q.onAction({ type: 'deplacerLot', etape: q.etape, ids, ...d });
    else q.onAction({ type: 'deplacer', etape: q.etape, id: o.id, ...d });
  }, []);
  const surSurvol = useCallback((id: string | undefined) => setSurvol(id), []);

  function molette(ev: Konva.KonvaEventObject<WheelEvent>) {
    ev.evt.preventDefault();
    const pt = scene.current?.getPointerPosition();
    if (!pt) return;
    const c = cadreRef.current;
    // Pavé tactile : le pincement arrive en molette avec Ctrl, en petits pas.
    const facteur = ev.evt.ctrlKey ? Math.exp(-ev.evt.deltaY / 120) : ev.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
    planifierVue(zoomer(vueRef.current, facteur, { x: pt.x - c.dx, y: pt.y - c.dy }));
  }

  function toucheBouge(ev: Konva.KonvaEventObject<TouchEvent>) {
    const t = ev.evt.touches;
    if (t.length !== 2) return;
    ev.evt.preventDefault();
    annulerAppuiLong();
    const rect = scene.current?.container().getBoundingClientRect();
    if (!rect) return;
    const c0 = cadreRef.current;
    const a = { x: t[0].clientX - rect.left - c0.dx, y: t[0].clientY - rect.top - c0.dy };
    const b = { x: t[1].clientX - rect.left - c0.dx, y: t[1].clientY - rect.top - c0.dy };
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const avant = pincement.current;
    pincement.current = { distance, centre: c };
    pan.current = undefined;
    setBrouillon(undefined);
    setVisee(undefined);
    setCadreSel(undefined);
    if (!avant || avant.distance === 0) return;
    const v = zoomer(vueRef.current, distance / avant.distance, c);
    planifierVue({ ...v, x: v.x + c.x - avant.centre.x, y: v.y + c.y - avant.centre.y });
  }

  function menuContextuel(ev: Konva.KonvaEventObject<PointerEvent>) {
    ev.evt.preventDefault();
    if (!p.onMenu || !editable) return;
    // Une poignée appartient à l'objet choisi : le menu est le sien.
    const id = ev.target.hasName('poignee') ? selection[0] : objetSous(ev.target);
    let ids: string[] = [];
    if (id) {
      ids = selection.includes(id) ? [...selection] : [id];
      if (!selection.includes(id)) p.onSelection(ids);
    }
    setVisee(undefined);
    setBrouillon(undefined);
    p.onMenu({ x: ev.evt.clientX, y: ev.evt.clientY, ids, point: position(false) });
  }

  // ---------------------------------------------------------------- Laser : la traînée s'efface toute seule
  useEffect(() => {
    if (!trainee.length) return undefined;
    const id = requestAnimationFrame(() => {
      const limite = performance.now() - DUREE_LASER_MS;
      setTrainee(t0 => (t0.length && t0[0].t < limite ? t0.filter(x => x.t >= limite) : t0.length ? [...t0] : t0));
    });
    return () => cancelAnimationFrame(id);
  }, [trainee]);
  useEffect(() => {
    if (!p.laser) setTrainee([]);
  }, [p.laser]);

  // ---------------------------------------------------------------- Poignées de la sélection (un seul objet)
  //
  // Visibles avec TOUT outil d'édition (pas seulement la sélection) : on pose un mur avec l'outil Capacité, on
  // l'oriente aussitôt. Taille constante à l'écran (RAYON_POIGNEE_PX), zone de prise large (PRISE_POIGNEE_PX).

  const choisiBrut = editable && outil !== 'main' && selection.length === 1 ? e?.objets.find(o => o.id === selection[0]) : undefined;
  const choisi = choisiBrut && apercu?.id === choisiBrut.id ? avecChamps(choisiBrut, apercu.champs) : choisiBrut;
  // Un rayon fixé par les caractéristiques de la capacité (smoke, molly) ne se règle pas : pas de poignée sur sa puce.
  const rayonFixe = choisiBrut?.type === 'capacite' && choisiBrut.zone?.forme === 'cercle' && dimensionFixe(donneesDe(choisiBrut));
  const mesPoignees: PoigneeObjet[] = choisi && !fige(choisi) && !rayonFixe ? poigneesObjet(choisi, echelle) : [];
  const maxChoisi = longueurMax(donneesDe(choisiBrut));

  function poigneeBouge(cle: PoigneeObjet['cle'], ev: Konva.KonvaEventObject<DragEvent>) {
    if (!choisiBrut) return;
    const node = ev.target;
    const aimant = Boolean((ev.evt as MouseEvent | undefined)?.shiftKey);
    const champs = tirerPoigneeDe(choisiBrut, cle, { x: node.x(), y: node.y() }, echelle, donneesDe(choisiBrut), aimant);
    if (!champs) return;
    setApercu({ id: choisiBrut.id, champs });
    // La poignée colle à la forme réelle (longueur bornée, angle aimanté) : on la replace sous le doigt.
    const h = poigneesObjet(avecChamps(choisiBrut, champs), echelle).find(x => x.cle === cle);
    if (h) node.position({ x: h.x, y: h.y });
  }
  function poigneeFin(cle: PoigneeObjet['cle'], ev: Konva.KonvaEventObject<DragEvent>) {
    ev.cancelBubble = true;
    p.onOccupe?.(false);
    if (!choisiBrut) return;
    const champs = apercu?.id === choisiBrut.id ? apercu.champs : tirerPoigneeDe(choisiBrut, cle, { x: ev.target.x(), y: ev.target.y() }, echelle, donneesDe(choisiBrut));
    setApercu(undefined);
    if (champs) onAction({ type: 'modifier', etape, id: choisiBrut.id, champs });
  }

  // ---------------------------------------------------------------- Lecture, objets
  const precedente = etape > 0 ? doc.etapes[etape - 1] : undefined;
  const lecture = useMemo(() => {
    if (p.temps === undefined || !e) return undefined;
    const q = R.current;
    const duree = (o: ObjetStrat) => (o.type === 'capacite' ? (q.agents?.find(a => a.cle === o.agent) ?? (q.agent?.cle === o.agent ? q.agent : undefined))?.capacites.find(c => c.cle === o.capacite)?.donnees?.duree : undefined);
    return etatLecture(e, p.temps, {
      precedente: p.enchaine ? precedente : undefined,
      dureeCapacite: duree,
      deploiement: p.mouvementReduit ? 0 : T.animation.deploiement,
      fondu: p.mouvementReduit ? 0 : T.animation.fondu,
      transition: p.mouvementReduit ? 0 : T.animation.transition,
    });
  }, [p.temps, e, precedente, p.enchaine, p.mouvementReduit]);

  const visible = doc.calques;
  const deplacable = (o: ObjetStrat) => editable && (outil === 'selection' || OUTILS_POSE.includes(outil)) && !fige(o);
  const nomJoueur = (j: number | null | undefined) => (typeof j === 'number' && doc.joueurs[j] ? doc.joueurs[j].nom.slice(0, 14) : undefined);
  const dureeEtape = e?.duree ?? 5;
  const sel = useMemo(() => new Set(selection), [selection]);

  const rendreObjet = (brut: ObjetStrat, options: { fantome?: boolean } = {}) => {
    const o = apercu?.id === brut.id ? avecChamps(brut, apercu.champs) : brut;
    const agent = o.type === 'agent' || o.type === 'capacite' ? agentDe(o.agent) : undefined;
    const cap = o.type === 'capacite' ? agent?.capacites.find(c => c.cle === o.capacite) : undefined;
    const style = o.type === 'capacite' ? styleCapacite(o.zone, cap?.donnees, o.nom) : undefined;
    const couleur = o.type === 'capacite' ? couleurAffichee(o.couleur, doc.couleurs, cap?.couleur ?? agent?.couleur) : 'couleur' in o ? o.couleur : '#ffffff';
    const joueurObjet = 'joueur' in o ? o.joueur : undefined;
    let opacite = 1;
    if (niveau !== null && typeof o.niveau === 'number' && o.niveau !== niveau) opacite = 0.3;
    if (p.surligne !== null && p.surligne !== undefined && joueurObjet !== p.surligne) opacite = Math.min(opacite, 0.16);
    if (options.fantome) opacite = 0.3;
    const anime = style && lecture && !p.mouvementReduit && (style.genre === 'zone' || style.genre === 'recon');
    return (
      <Objet
        key={options.fantome ? `f-${o.id}` : o.id}
        o={o}
        couleur={couleur}
        icone={o.type === 'agent' ? sourcesStables(agent, o.icone) : o.type === 'capacite' ? sourcesStables(cap, o.icone) : undefined}
        etiquette={o.type === 'agent' && p.noms !== false ? nomJoueur(o.joueur) : undefined}
        images={images}
        selectionne={!options.fantome && sel.has(o.id)}
        deplacable={!options.fantome && deplacable(o)}
        echelle={echelle}
        rotation={rotation}
        opacite={opacite}
        genre={style?.genre ?? 'icone'}
        ultime={style?.ultime ?? false}
        chaud={style?.chaud ?? false}
        segments={segmentsMur(cap?.donnees)}
        duree={dureeEtape}
        progression={options.fantome ? undefined : lecture?.progression.get(o.id)}
        position={options.fantome ? undefined : lecture?.pions.get(o.id)}
        vie={options.fantome ? undefined : lecture?.capacites.get(o.id)}
        temps={anime ? p.temps : undefined}
        fantome={options.fantome}
        onDebut={debutDeplacement}
        onBouge={deplacementEnCours}
        onFin={finDeplacement}
        onSurvol={surSurvol}
      />
    );
  };
  const objetsDe = (c: (typeof CALQUES_OBJETS)[number]) => (e?.objets ?? []).filter(o => calqueDe(o) === c && (!lecture || lecture.visibles.has(o.id)));

  // Fantôme de l'étape précédente : pions à leur dernière position, utilitaires, et le chemin jusqu'ici.
  const fantomes = p.fantome && precedente && editable ? [...pionsFinaux(precedente), ...precedente.objets.filter(o => o.type === 'capacite')] : [];
  const liens = p.fantome && precedente && e && editable ? [...departsDepuis(precedente, e)].map(([id, depart]) => ({ id, depart, arrivee: e.objets.find(o => o.id === id) as { x: number; y: number } })) : [];

  // ---------------------------------------------------------------- Ligne d'état : cote du geste en cours
  const info = (() => {
    const max = (m: number | undefined) => (m !== undefined ? ` (max ${m} m)` : '');
    if (visee && outil === 'capacite' && p.capacite) {
      const glisseV = estGlisse(visee, SEUIL_GLISSER_PX * parPixel);
      const pose = glisseV ? poseCapacite(visee, zoneDeBase(), echelle, p.capacite.donnees, maj) : { zone: zonePourPose(visee.origine) };
      return pose.zone ? `${p.capacite.nom} · ${cote(pose.zone)}${max(longueurMax(p.capacite.donnees))}` : p.capacite.nom;
    }
    if (visee && outil === 'vision' && estGlisse(visee, SEUIL_GLISSER_PX * parPixel)) {
      const v = poseVision(visee, echelle, maj);
      return `${v.portee} m · ${Math.round(((v.angle % 360) + 360) % 360)}°`;
    }
    if (choisi?.type === 'capacite' && choisi.zone) return `${choisi.nom} · ${cote(choisi.zone)}${max(maxChoisi)}`;
    if (choisi?.type === 'vision') return `${choisi.portee} m · ${choisi.ouverture}° · ${Math.round(((choisi.angle % 360) + 360) % 360)}°`;
    if (brouillon?.type === 'trace') {
      let l = 0;
      for (let i = 2; i + 1 < brouillon.points.length; i += 2) l += Math.hypot(brouillon.points[i] - brouillon.points[i - 2], brouillon.points[i + 1] - brouillon.points[i - 1]);
      return `${Math.round((l / echelleEffective(echelle)) * 10) / 10} m`;
    }
    if (brouillon?.type === 'forme') return `${Math.abs(Math.round((brouillon.l / echelleEffective(echelle)) * 10) / 10)} × ${Math.abs(Math.round((brouillon.h / echelleEffective(echelle)) * 10) / 10)} m`;
    return undefined;
  })();
  const { onInfo } = p;
  useEffect(() => {
    onInfo?.(info);
  }, [info, onInfo]);

  // ---------------------------------------------------------------- Rendu
  const etiquettes = etiquettesVisibles(pxParUnite);
  const couleurPose = p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur;
  const survole = survol && !visee && !brouillon ? e?.objets.find(o => o.id === survol) : undefined;
  const etiquetteDe = (o: ObjetStrat | undefined) => {
    if (!o || o.type !== 'capacite') return undefined;
    const duree = donneesDe(o)?.duree;
    return [o.nom, o.zone ? tailleReelle(o.zone) : '', duree !== undefined ? `${duree} s` : ''].filter(Boolean).join(' · ');
  };
  const curseur = enPan ? 'grabbing' : p.panTemporaire || outil === 'main' || (!editable && !p.laser) ? 'grab' : p.laser ? 'crosshair' : outil === 'selection' ? 'default' : 'crosshair';
  const pionApercu = (x: number, y: number) =>
    p.agent ? (
      <Group x={x} y={y} name="fantome-agent">
        <Objet o={{ id: 'apercu', type: 'agent', x: 0, y: 0, agent: p.agent.cle, nom: p.agent.nom, icone: iconeDoc(p.agent), joueur: p.joueur, couleur: couleurPose }} couleur={couleurPose} icone={sourcesStables(p.agent)} images={images} selectionne={false} deplacable={false} echelle={echelle} rotation={rotation} opacite={1} genre="icone" ultime={false} chaud={false} segments={1} duree={5} fantome />
      </Group>
    ) : null;

  return (
    <div
      style={{ touchAction: 'none', width: largeur, height: hauteur, borderRadius: p.taille ? 10 : 0, overflow: 'hidden', cursor: curseur, background: melanger(theme.fond, '#000000', theme.vignette) }}
      onMouseDown={ev => {
        // Molette pressée : déplacement de la vue, pas le défilement automatique du navigateur.
        if (ev.button === 1) ev.preventDefault();
      }}
      data-testid={p.testID ?? 'esport-canevas'}
      data-outil={outil}
      data-zoom={Math.round(vue.echelle * 100)}
      data-cadre={`${Math.round(pxParUnite * 10000) / 10000},${Math.round((cadre0.dx + vue.x) * 10) / 10},${Math.round((cadre0.dy + vue.y) * 10) / 10}`}>
      <Stage
        ref={scene}
        width={largeur}
        height={hauteur}
        scaleX={pxParUnite}
        scaleY={pxParUnite}
        x={cadre0.dx + vue.x}
        y={cadre0.dy + vue.y}
        onPointerDown={auPointeurBas}
        onPointerMove={auPointeurBouge}
        onPointerUp={auPointeurHaut}
        onPointerLeave={() => {
          setFantome(undefined);
          setSurvol(undefined);
          auPointeurHaut();
        }}
        onContextMenu={menuContextuel}
        onDblClick={ev => {
          if (!objetSous(ev.target) && !ev.target.hasName('poignee')) p.onVue(VUE_INITIALE);
        }}
        onDblTap={ev => {
          if (!objetSous(ev.target) && !ev.target.hasName('poignee')) p.onVue(VUE_INITIALE);
        }}
        onWheel={molette}
        onTouchMove={toucheBouge}
        onTouchEnd={() => {
          pincement.current = undefined;
        }}>
        <Layer listening={false}>
          <Rect x={-4000} y={-4000} width={9000} height={9000} fill={theme.fond} />
          <Tourne ref={repere} rotation={rotation}>
            {visible.fond.visible ? (
              rendu ? (
                <KImage image={rendu.canevas} x={0} y={0} width={1000} height={1000} />
              ) : fondImg ? (
                <KImage image={fondImg} x={cadreBrut.x} y={cadreBrut.y} width={cadreBrut.l} height={cadreBrut.h} />
              ) : (
                <>
                  <Rect x={40} y={40} width={920} height={920} cornerRadius={28} fill={theme.sol} stroke={alpha(theme.contour, 0.5)} strokeWidth={2} dash={[10, 10]} />
                  <Halo x={500} y={500} texte={doc.carte.nom} taille={64} couleur={alpha(theme.etiquette, 0.5)} largeur={900} capitales />
                </>
              )
            ) : null}
            {p.aimant && editable ? (
              <Group opacity={0.1} name="hors-export">
                {Array.from({ length: Math.floor(1000 / Math.max(10, p.aimant * 5)) }, (_, i) => (i + 1) * Math.max(10, p.aimant ?? 10) * 5).map(v => (
                  <React.Fragment key={v}>
                    <Line points={[v, 0, v, 1000]} stroke={theme.grille} strokeWidth={1} />
                    <Line points={[0, v, 1000, v]} stroke={theme.grille} strokeWidth={1} />
                  </React.Fragment>
                ))}
              </Group>
            ) : null}
          </Tourne>
          {theme.vignette > 0 ? (
            <Rect
              x={-4000}
              y={-4000}
              width={9000}
              height={9000}
              fillRadialGradientStartPoint={{ x: 4500, y: 4500 }}
              fillRadialGradientEndPoint={{ x: 4500, y: 4500 }}
              fillRadialGradientStartRadius={400}
              fillRadialGradientEndRadius={1150}
              fillRadialGradientColorStops={[0, 'rgba(0,0,0,0)', 1, alpha('#000000', theme.vignette)]}
            />
          ) : null}
          <Tourne rotation={rotation}>
            {visible.callouts.visible ? (
              <>
                {(carte?.zones ?? []).map(z => {
                  const c = centre(z.points);
                  const cz = z.couleur ?? theme.etiquette;
                  return (
                    <Group key={z.cle}>
                      <Line points={z.points} closed fill={alpha(cz, theme.zone)} stroke={alpha(cz, 0.55)} strokeWidth={1.3} lineJoin="round" perfectDrawEnabled={false} />
                      <Group x={c.x} y={c.y} name="callout-etiquette" visible={etiquettes} opacity={opaciteEtiquette(c.x, c.y, e?.objets ?? [])}>
                        <Group name="jeton-texte" rotation={-rotation}>
                          <Halo texte={z.nom} taille={T.typo.s} couleur={z.couleur ? melanger(z.couleur, '#ffffff', 0.55) : theme.etiquette} capitales />
                        </Group>
                      </Group>
                    </Group>
                  );
                })}
                {(carte?.reperes ?? []).map(r => {
                  const estompe = niveau !== null && typeof r.niveau === 'number' && r.niveau !== niveau ? 0.35 : 1;
                  const reperes = T.reperes as Record<string, string>;
                  const cr = reperes[r.type] ?? (r.type.startsWith('spawn') ? reperes.spawn : reperes.autre);
                  const nom = r.nom.trim();
                  const court = /^[A-Za-z0-9]{1,2}$/.test(nom);
                  const lettre = (court ? nom : (/\b([A-Za-z0-9])$/.exec(nom)?.[1] ?? nom[0] ?? '?')).toUpperCase();
                  if (r.type === 'callout') {
                    return (
                      <Group key={r.cle} x={r.x} y={r.y} opacity={estompe * opaciteEtiquette(r.x, r.y, e?.objets ?? [])} name="callout-etiquette" visible={etiquettes}>
                        <Circle radius={2.5} fill={theme.etiquette} opacity={0.8} />
                        <Group name="jeton-texte" rotation={-rotation} y={-11}>
                          <Halo texte={nom} taille={T.typo.xs} couleur={theme.etiquette} capitales />
                        </Group>
                      </Group>
                    );
                  }
                  const site = r.type === 'site' || r.type === 'plant';
                  return (
                    <Group key={r.cle} x={r.x} y={r.y} opacity={estompe}>
                      {site ? (
                        <Circle radius={38} fill={alpha(cr, 0.13)} stroke={alpha(cr, 0.75)} strokeWidth={1.6} dash={[5, 6]} perfectDrawEnabled={false} />
                      ) : (
                        <Rect x={-13} y={-13} width={26} height={26} cornerRadius={r.type.startsWith('spawn') ? 13 : 6} fill={alpha(cr, 0.9)} stroke={T.halo} strokeWidth={1.8} perfectDrawEnabled={false} />
                      )}
                      <Group rotation={-rotation}>
                        <Halo texte={r.type === 'cashout' ? '$' : lettre} taille={site ? 30 : 15} couleur={site ? melanger(cr, '#ffffff', 0.35) : '#ffffff'} largeur={90} opacite={site ? opaciteEtiquette(r.x, r.y, e?.objets ?? []) : 1} />
                        {!court ? (
                          <Group y={site ? 50 : 26} name="callout-etiquette" visible={etiquettes}>
                            <Group name="jeton-texte">
                              <Halo texte={nom} taille={T.typo.xs} couleur={theme.etiquette} capitales />
                            </Group>
                          </Group>
                        ) : null}
                      </Group>
                    </Group>
                  );
                })}
              </>
            ) : null}
          </Tourne>
        </Layer>
        <Layer listening={editable}>
          <Tourne rotation={rotation}>
            {fantomes.length ? (
              <Group listening={false} name="hors-export">
                {liens.map(l => (
                  <Line key={l.id} points={[l.depart.x, l.depart.y, l.arrivee.x, l.arrivee.y]} stroke="#ffffff" strokeWidth={1.6} dash={[3, 6]} opacity={0.5} lineCap="round" />
                ))}
                {fantomes.map(o => rendreObjet(o, { fantome: true }))}
              </Group>
            ) : null}
            {CALQUES_OBJETS.map(c => (
              <Group key={c} visible={visible[c].visible} listening={!visible[c].verrou}>
                {objetsDe(c).map(o => rendreObjet(o))}
              </Group>
            ))}
          </Tourne>
        </Layer>
        <Layer ref={dessus}>
          <Tourne rotation={rotation}>
            {brouillon?.type === 'trace' ? (
              outil === 'fleche' ? (
                <Arrow points={brouillon.points} stroke={p.couleur} fill={p.couleur} strokeWidth={p.epaisseur} tension={0.35} pointerLength={16} pointerWidth={16} dash={p.tirets ? [14, 10] : undefined} lineCap="round" listening={false} />
              ) : (
                <Line points={brouillon.points} stroke={p.couleur} strokeWidth={p.epaisseur} tension={0.35} dash={p.tirets ? [14, 10] : undefined} lineCap="round" listening={false} />
              )
            ) : null}
            {brouillon?.type === 'forme' ? (
              p.formeDessin === 'rect' ? (
                <Rect x={brouillon.x} y={brouillon.y} width={brouillon.l} height={brouillon.h} stroke={p.couleur} strokeWidth={3} dash={[8, 6]} listening={false} />
              ) : (
                <Ellipse x={brouillon.x + brouillon.l / 2} y={brouillon.y + brouillon.h / 2} radiusX={Math.abs(brouillon.l / 2)} radiusY={Math.abs(brouillon.h / 2)} stroke={p.couleur} strokeWidth={3} dash={[8, 6]} listening={false} />
              )
            ) : null}
            {cadreSel ? (
              <Rect
                x={Math.min(cadreSel.a.x, cadreSel.b.x)}
                y={Math.min(cadreSel.a.y, cadreSel.b.y)}
                width={Math.abs(cadreSel.b.x - cadreSel.a.x)}
                height={Math.abs(cadreSel.b.y - cadreSel.a.y)}
                fill="rgba(255,255,255,0.08)"
                stroke="#ffffff"
                strokeWidth={1.5 * parPixel}
                dash={[6 * parPixel, 4 * parPixel]}
                listening={false}
              />
            ) : null}
            {(() => {
              // Aperçu de ce que l'on pose : capacité à sa taille réelle, pion avec son PORTRAIT.
              if (visee) {
                const glisseV = estGlisse(visee, SEUIL_GLISSER_PX * parPixel);
                const o = visee.origine;
                const tige = glisseV ? <Arrow points={[o.x, o.y, visee.pointeur.x, visee.pointeur.y]} stroke="#ffffff" fill="#ffffff" strokeWidth={2 * parPixel} dash={[8 * parPixel, 6 * parPixel]} pointerLength={10 * parPixel} pointerWidth={10 * parPixel} opacity={0.8} listening={false} /> : null;
                if (outil === 'capacite' && p.capacite) {
                  const pose = glisseV ? poseCapacite(visee, zoneDeBase(), echelle, p.capacite.donnees, maj) : { x: o.x, y: o.y, zone: zonePourPose(o) };
                  const st = styleCapacite(pose.zone, p.capacite.donnees, p.capacite.nom);
                  return (
                    <Group opacity={0.75} listening={false}>
                      {pose.zone ? (
                        <Group x={pose.x} y={pose.y}>
                          <FormeCapacite id="apercu" zone={pose.zone} x={pose.x} y={pose.y} genre={st.genre} couleur={couleurPose} ultime={st.ultime} chaud={st.chaud} creux={false} segments={segmentsMur(p.capacite.donnees)} echelle={echelle} d={1} />
                        </Group>
                      ) : null}
                      {tige}
                      <Circle x={pose.x} y={pose.y} radius={6 * parPixel} fill={couleurPose} stroke="#ffffff" strokeWidth={1.5 * parPixel} />
                      {pose.zone ? <Halo x={visee.pointeur.x} y={visee.pointeur.y - 26 * parPixel} texte={cote(pose.zone)} taille={15 * parPixel} couleur={T.cote} rotation={-rotation} /> : null}
                    </Group>
                  );
                }
                if (outil === 'vision' && glisseV) {
                  const v = poseVision(visee, echelle, maj);
                  return (
                    <Group opacity={0.75} listening={false}>
                      <Wedge x={v.x} y={v.y} radius={v.portee * echelleEffective(echelle)} angle={p.vision?.ouverture ?? 90} rotation={v.angle - (p.vision?.ouverture ?? 90) / 2} fill={alpha(couleurPose, 0.25)} stroke={couleurPose} strokeWidth={2} dash={[8, 6]} />
                      <Halo x={visee.pointeur.x} y={visee.pointeur.y - 26 * parPixel} texte={`${v.portee} m · ${Math.round(((v.angle % 360) + 360) % 360)}°`} taille={15 * parPixel} couleur={T.cote} rotation={-rotation} />
                    </Group>
                  );
                }
                return (
                  <Group opacity={0.85} listening={false}>
                    {tige}
                    {outil === 'agent' ? pionApercu(o.x, o.y) : null}
                  </Group>
                );
              }
              if (!fantome || !editable) return null;
              if (outil === 'agent')
                return (
                  <Group opacity={0.6} listening={false}>
                    {pionApercu(fantome.x, fantome.y)}
                  </Group>
                );
              if (outil !== 'capacite' || !p.capacite) return null;
              const z = zonePourPose(fantome);
              const st = styleCapacite(z, p.capacite.donnees, p.capacite.nom);
              return (
                <Group opacity={0.55} listening={false}>
                  {z ? (
                    <Group x={fantome.x} y={fantome.y}>
                      <FormeCapacite id="apercu" zone={z} x={fantome.x} y={fantome.y} genre={st.genre} couleur={couleurPose} ultime={st.ultime} chaud={st.chaud} creux={false} segments={segmentsMur(p.capacite.donnees)} echelle={echelle} d={1} />
                    </Group>
                  ) : null}
                  <Circle x={fantome.x} y={fantome.y} radius={5 * parPixel} fill={couleurPose} stroke="#ffffff" strokeWidth={1.5 * parPixel} />
                  {z ? <Halo x={fantome.x} y={fantome.y - 30 * parPixel} texte={cote(z)} taille={14 * parPixel} couleur={T.cote} rotation={-rotation} /> : null}
                </Group>
              );
            })()}
            {/* Étiquette de la capacité survolée ou choisie : nom, taille réelle, durée. */}
            {(() => {
              const o = (choisi?.type === 'capacite' ? choisi : undefined) ?? (survole?.type === 'capacite' ? survole : undefined);
              const texte = etiquetteDe(o);
              if (!o || !texte || visee) return null;
              const ancre = mesPoignees.length && choisi?.id === o.id ? (mesPoignees.find(h => h.cle === 'fin') ?? mesPoignees[mesPoignees.length - 1]) : undefined;
              const pt = ancre ? { x: ancre.x, y: ancre.y + 30 * parPixel } : { x: o.x, y: o.y - 30 * parPixel };
              return <Halo x={pt.x} y={pt.y} texte={`${texte}${choisi?.id === o.id && maxChoisi !== undefined ? ` (max ${maxChoisi} m)` : ''}`} taille={13.5 * parPixel} couleur={T.cote} rotation={-rotation} largeur={420 * parPixel} />;
            })()}
            {choisi && mesPoignees.length ? (
              <Group>
                {(() => {
                  // Repères du geste : tige de l'origine à la poignée de direction, cercle de la longueur réelle.
                  const fin = mesPoignees.find(h => h.cle === 'fin' || h.cle === 'regard');
                  const origine = 'x' in choisi ? { x: choisi.x, y: choisi.y } : { x: 0, y: 0 };
                  const k = echelleEffective(echelle);
                  const anneauMax = fin && maxChoisi !== undefined && choisi.type === 'capacite' && choisi.zone && choisi.zone.forme !== 'trajet' && choisi.zone.forme !== 'cercle';
                  return (
                    <>
                      {anneauMax ? <Circle x={origine.x} y={origine.y} radius={(maxChoisi as number) * k} stroke={T.cote} strokeWidth={1.5 * parPixel} dash={[6 * parPixel, 6 * parPixel]} opacity={0.6} listening={false} /> : null}
                      {fin ? <Line points={[origine.x, origine.y, fin.x, fin.y]} stroke="#ffffff" strokeWidth={2 * parPixel} dash={[7 * parPixel, 5 * parPixel]} opacity={0.85} listening={false} /> : null}
                    </>
                  );
                })()}
                {mesPoignees.map(h => (
                  <Circle
                    key={h.cle}
                    name="poignee"
                    x={h.x}
                    y={h.y}
                    radius={RAYON_POIGNEE_PX * parPixel}
                    fill={h.cle === 'courbe' ? '#f59e0b' : h.cle === 'debut' ? '#38bdf8' : h.cle.startsWith('p') ? '#86efac' : '#ffffff'}
                    stroke={T.halo}
                    strokeWidth={2.5 * parPixel}
                    hitStrokeWidth={2 * (PRISE_POIGNEE_PX - RAYON_POIGNEE_PX) * parPixel}
                    perfectDrawEnabled={false}
                    draggable
                    onMouseEnter={() => {
                      const c = scene.current?.container();
                      if (c) c.style.cursor = 'grab';
                    }}
                    onMouseLeave={() => {
                      const c = scene.current?.container();
                      if (c) c.style.cursor = curseur;
                    }}
                    onDragStart={ev => {
                      ev.cancelBubble = true;
                      annulerAppuiLong();
                      p.onOccupe?.(true);
                    }}
                    onDragMove={ev => poigneeBouge(h.cle, ev)}
                    onDragEnd={ev => poigneeFin(h.cle, ev)}
                  />
                ))}
              </Group>
            ) : null}
            {trainee.length > 1 ? (
              <Group listening={false}>
                <Line points={trainee.flatMap(t => [t.x, t.y])} stroke="#ff2d2d" strokeWidth={12 * parPixel} opacity={0.25} lineCap="round" lineJoin="round" tension={0.4} />
                <Line points={trainee.flatMap(t => [t.x, t.y])} stroke="#ff5a5a" strokeWidth={4 * parPixel} lineCap="round" lineJoin="round" tension={0.4} />
              </Group>
            ) : null}
            {trainee.length ? <Circle x={trainee[trainee.length - 1].x} y={trainee[trainee.length - 1].y} radius={6 * parPixel} fill="#ffffff" stroke="#ff2d2d" strokeWidth={3 * parPixel} listening={false} /> : null}
          </Tourne>
        </Layer>
      </Stage>
    </div>
  );
}
