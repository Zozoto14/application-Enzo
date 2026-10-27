/**
 * Éditeur de visuels (site et app PC, et le site sur téléphone) : canevas Konva chargé à la demande.
 *
 *  - calques : texte, image, forme, logo, liste, champ dynamique ; sélection au clic (ou dans la liste),
 *    déplacer, redimensionner, faire pivoter (poignées), magnétisme (bords, centre, autres calques, guides
 *    roses), alignements, ordre, verrouillage, masquage, duplication, suppression ;
 *  - propriétés (Proprietes.tsx), polices et couleurs de la charte, dégradés, ombre, contour, lueur, glitch ;
 *  - annuler / rétablir, zoom, zones sûres par réseau (Instagram, TikTok, X) ;
 *  - modèle : tous les formats, aperçu avec des données d'exemple (série ou classement), en FR ou EN ;
 *    visuel : ses vraies données ; enregistrer (retouche), revenir au modèle, générer et joindre ;
 *  - export PNG / JPG à la taille exacte (même dessin que l'aperçu).
 *
 * Raccourcis : Suppr efface, Ctrl+D duplique, flèches déplacent (Maj : 10 px), Ctrl+Z / Ctrl+Maj+Z (ou
 * Ctrl+Y), Échap désélectionne.
 */

import Konva from 'konva';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { ErreurEsport } from '../../../client';
import { estRefDefaut, refDefaut, type ModeleComplet, type Visuel } from '../../../cm/visuels/api';
import { CHAMPS_TEXTE, donneesExemple } from '../../../cm/visuels/champs';
import { aimanter, annuler, appliquer, calqueTexteDefaut, historique, horsZone, lireDocument, nouvelIdCalque, retablir, ZONES_SURES, type Action, type Historique, type ReseauZone } from '../../../cm/visuels/document';
import { genererVisuel } from '../../../cm/visuels/generation';
import { documentsDefaut, modeleDefaut } from '../../../cm/visuels/modeles';
import { planifier, type PlanRendu } from '../../../cm/visuels/plan';
import { chargerImages, chargerPolices, creerChargeurImages, dessiner, rendreBlob, type ImagesChargees } from '../../../cm/visuels/rendu.web';
import { CLES_FORMATS, FORMATS, type Calque, type CleFormat, type DocumentVisuel, type Langue } from '../../../cm/visuels/types';
import { envoyerFichier } from '../../../medias/envoi';
import { choisirFichier } from '../../../medias/choixFichier';
import { trVi, trViLangue, type CleVi } from '../../../i18n/visuels';
import { langueCourante } from '../../../i18n';
import { obtenirAssets } from '../../strats/commun';
import { Retours, styles, useAgir } from '../../commun';
import { ESP, Volet, attenue, texte, type EtatPresse } from '../../design';
import { Proprietes } from './Proprietes';
import { Pastilles } from './controles';
import type { PropsEditeurVisuel } from './typesEditeur';

export type { PropsEditeurVisuel };

const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,image/gif';
const TAILLE_MAX_IMAGE = 15 * 1024 * 1024;

// ------------------------------------------------------------------ Canevas (Konva, impératif)

interface PropsCanevas {
  plan: PlanRendu;
  images: ImagesChargees;
  doc: DocumentVisuel;
  selection: string | undefined;
  echelle: number;
  zone: ReseauZone | '';
  aimant: boolean;
  onSelection(id: string | undefined): void;
  onAction(a: Action): void;
}

function Canevas({ plan, images, doc, selection, echelle, zone, aimant, onSelection, onAction }: PropsCanevas) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const scene = useRef<{ stage: Konva.Stage; calque: Konva.Layer; ui: Konva.Layer; tr: Konva.Transformer; guides: Konva.Group; zone: Konva.Group } | null>(null);
  const rappels = useRef({ onSelection, onAction, doc, aimant, echelle });
  rappels.current = { onSelection, onAction, doc, aimant, echelle };

  useEffect(() => {
    if (!conteneur.current) return undefined;
    const stage = new Konva.Stage({ container: conteneur.current, width: 10, height: 10 });
    const calque = new Konva.Layer();
    const ui = new Konva.Layer();
    const tr = new Konva.Transformer({
      rotateEnabled: true,
      keepRatio: false,
      ignoreStroke: true,
      borderStroke: '#00f0ff',
      anchorStroke: '#00f0ff',
      anchorFill: '#07060f',
      anchorSize: 12,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      boundBoxFunc: (ancien, nouveau) => (Math.abs(nouveau.width) < 8 || Math.abs(nouveau.height) < 8 ? ancien : nouveau),
    });
    const guides = new Konva.Group({ listening: false });
    const zoneG = new Konva.Group({ listening: false });
    ui.add(zoneG, guides, tr);
    stage.add(calque, ui);
    stage.on('mousedown touchstart', e => {
      if (e.target === stage || e.target.name() === 'fond') rappels.current.onSelection(undefined);
    });
    tr.on('transformend', () => {
      const n = tr.nodes()[0];
      const c = n ? rappels.current.doc.calques.find(x => x.id === n.id()) : undefined;
      if (!n || !c) return;
      const l = Math.max(4, Math.round(c.l * n.scaleX()));
      const h = Math.max(4, Math.round(c.h * n.scaleY()));
      n.scale({ x: 1, y: 1 });
      rappels.current.onAction({ type: 'modifier', id: c.id, valeurs: { x: Math.round(n.x()), y: Math.round(n.y()), l, h, rotation: Math.round(n.rotation() * 10) / 10 } });
    });
    scene.current = { stage, calque, ui, tr, guides, zone: zoneG };
    return () => {
      stage.destroy();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.stage.size({ width: Math.round(plan.largeur * echelle), height: Math.round(plan.hauteur * echelle) });
    s.stage.scale({ x: echelle, y: echelle });
    s.tr.anchorSize(echelle < 0.4 ? 14 : 12);
  }, [echelle, plan.largeur, plan.hauteur]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.calque.destroyChildren();
    const groupes = dessiner(s.calque, plan, images, { edition: true });
    const W = plan.largeur;
    const H = plan.hauteur;
    for (const [id, g] of groupes) {
      const c = doc.calques.find(x => x.id === id);
      g.draggable(Boolean(c && !c.verrouille));
      g.on('mousedown touchstart', ev => {
        ev.cancelBubble = true;
        rappels.current.onSelection(id);
      });
      g.on('dragmove', () => {
        s.guides.destroyChildren();
        if (!c || !rappels.current.aimant) return;
        const autres = rappels.current.doc.calques.filter(x => x.id !== id && !x.masque && x.type !== 'image').map(x => ({ x: x.x, y: x.y, l: x.l, h: x.h }));
        const r = aimanter({ x: g.x(), y: g.y(), l: c.l, h: c.h }, autres, W, H, 8 / rappels.current.echelle);
        g.position({ x: r.x, y: r.y });
        for (const gd of r.guides) {
          s.guides.add(new Konva.Line({ points: gd.sens === 'v' ? [gd.position, 0, gd.position, H] : [0, gd.position, W, gd.position], stroke: '#ff2bd6', strokeWidth: 1.5 / rappels.current.echelle, dash: [8 / rappels.current.echelle, 6 / rappels.current.echelle] }));
        }
        s.ui.batchDraw();
      });
      g.on('dragend', () => {
        s.guides.destroyChildren();
        s.ui.batchDraw();
        rappels.current.onAction({ type: 'modifier', id, valeurs: { x: Math.round(g.x()), y: Math.round(g.y()) } });
      });
    }
    const choisi = selection ? groupes.get(selection) : undefined;
    const c = selection ? doc.calques.find(x => x.id === selection) : undefined;
    s.tr.nodes(choisi && c && !c.verrouille ? [choisi] : []);
    s.calque.batchDraw();
    s.ui.batchDraw();
  }, [plan, images, selection, doc.calques]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.zone.destroyChildren();
    const z = zone ? ZONES_SURES[doc.format].find(x => x.reseau === zone) : undefined;
    if (z) {
      const { largeur: W, hauteur: H } = FORMATS[doc.format];
      s.zone.add(new Konva.Rect({ x: z.gauche, y: z.haut, width: W - z.gauche - z.droite, height: H - z.haut - z.bas, stroke: '#f5ff3b', strokeWidth: 2 / echelle, dash: [14 / echelle, 8 / echelle] }));
      for (const [x, y, l, h] of [
        [0, 0, W, z.haut],
        [0, H - z.bas, W, z.bas],
        [0, z.haut, z.gauche, H - z.haut - z.bas],
        [W - z.droite, z.haut, z.droite, H - z.haut - z.bas],
      ]) {
        s.zone.add(new Konva.Rect({ x, y, width: l, height: h, fill: 'rgba(245,255,59,0.08)' }));
      }
    }
    s.ui.batchDraw();
  }, [zone, doc.format, echelle]);

  return <div ref={conteneur} data-testid="esport-vi-canevas" style={{ touchAction: 'none', display: 'inline-block', lineHeight: 0, boxShadow: '0 8px 30px rgba(0,0,0,0.45)' }} />;
}

// ------------------------------------------------------------------ Liste des calques

function nomCalque(c: Calque, langue: Langue): string {
  if (c.nom) return c.nom;
  if (c.type === 'texte') return (c.texte[langue] || c.texte.fr).replace(/\s+/g, ' ').slice(0, 40) || trVi('editeur.calque_texte');
  if (c.type === 'liste') return `${trVi('editeur.calque_liste')} · ${trVi(`editeur.liste.${c.source}` as CleVi)}`;
  if (c.type === 'logo') return `${trVi('editeur.calque_logo')} · ${trVi(`editeur.cible.${c.cible}` as CleVi)}`;
  if (c.type === 'forme') return `${trVi('editeur.calque_forme')} · ${trVi(`editeur.forme.${c.forme}` as CleVi)}`;
  return trVi('editeur.calque_image');
}

function ListeCalques({ theme, doc, selection, langue, onSelection, onAction }: { theme: ThemeHub; doc: DocumentVisuel; selection?: string; langue: Langue; onSelection(id: string): void; onAction(a: Action): void }) {
  const ordre = [...doc.calques].reverse();
  const bouton = (glyphe: string, libelle: string, action: () => void, testID: string, actif = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={libelle} onPress={action} testID={testID} style={(e: EtatPresse) => ({ minWidth: 30, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: e.hovered ? theme.surface : 'transparent', opacity: actif ? 1 : 0.7 })}>
      <Text style={texte(theme, 13)}>{glyphe}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 2 }} testID="esport-vi-calques">
      {ordre.map(c => {
        const choisi = c.id === selection;
        return (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 8, borderWidth: 1, borderColor: choisi ? theme.accent : 'transparent', backgroundColor: choisi ? theme.surface : 'transparent', opacity: c.masque ? 0.5 : 1 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: choisi }} onPress={() => onSelection(c.id)} testID={`esport-vi-calque-${c.id}`} style={{ flex: 1, minHeight: 34, justifyContent: 'center', paddingHorizontal: ESP.xs }}>
              <Text style={texte(theme, 13)} numberOfLines={1}>
                {nomCalque(c, langue)}
              </Text>
            </Pressable>
            {bouton(c.masque ? '◌' : '●', c.masque ? trVi('editeur.afficher') : trVi('editeur.masquer'), () => onAction({ type: 'modifier', id: c.id, valeurs: { masque: !c.masque } }), `esport-vi-calque-${c.id}-masque`, !c.masque)}
            {bouton(c.verrouille ? '🔒' : '🔓', c.verrouille ? trVi('editeur.deverrouiller') : trVi('editeur.verrouiller'), () => onAction({ type: 'modifier', id: c.id, valeurs: { verrouille: !c.verrouille } }), `esport-vi-calque-${c.id}-verrou`, c.verrouille)}
            {bouton('↑', trVi('editeur.monter'), () => onAction({ type: 'ordre', id: c.id, sens: 'monter' }), `esport-vi-calque-${c.id}-monter`)}
            {bouton('↓', trVi('editeur.descendre'), () => onAction({ type: 'ordre', id: c.id, sens: 'descendre' }), `esport-vi-calque-${c.id}-descendre`)}
          </View>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Éditeur

function documentsInitiaux(p: PropsEditeurVisuel): Partial<Record<CleFormat, DocumentVisuel>> {
  const c = p.cible;
  if (c.genre === 'visuel') {
    const v = c.visuel;
    const doc = v.document ?? (!estRefDefaut(v.modele) && c.modele?.documents[v.format] ? c.modele.documents[v.format] : modeleDefaut(v.type, v.format));
    return { [v.format]: lireDocument(doc, v.format) };
  }
  if (c.modele) return Object.fromEntries(Object.entries(c.modele.documents).map(([f, d]) => [f, lireDocument(d, f as CleFormat)]));
  return documentsDefaut(c.type);
}

export function EditeurVisuel(props: PropsEditeurVisuel) {
  const { theme, api, large, charte, cible, onFermer } = props;
  const { width: largeurFenetre, height: hauteurFenetre } = useWindowDimensions();
  const [historiques, setHistoriques] = useState<Partial<Record<CleFormat, Historique>>>(() => Object.fromEntries(Object.entries(documentsInitiaux(props)).map(([f, d]) => [f, historique(d as DocumentVisuel)])));
  const formats = CLES_FORMATS.filter(f => historiques[f]);
  const [format, setFormat] = useState<CleFormat>(formats[0] ?? 'carre');
  const [modele, setModele] = useState<ModeleComplet | null>(cible.modele);
  const [visuel, setVisuel] = useState<Visuel | null>(cible.genre === 'visuel' ? cible.visuel : null);
  const [langue, setLangue] = useState<Langue>(cible.genre === 'visuel' ? cible.visuel.langue : langueCourante());
  const [systeme, setSysteme] = useState<'serie' | 'classement'>('serie');
  const [selection, setSelection] = useState<string | undefined>();
  const [zoom, setZoom] = useState(1);
  const [zone, setZone] = useState<ReseauZone | ''>('');
  const [aimant, setAimant] = useState(true);
  const [modifie, setModifie] = useState(false);
  const [change, setChange] = useState(false);
  const [nomModele, setNomModele] = useState<string | undefined>();
  const [choixImage, setChoixImage] = useState(false);
  const [versions, setVersions] = useState<Array<{ version: number; nom: string; date: string }> | undefined>();
  const [largeurCanevas, setLargeurCanevas] = useState(600);
  const { erreur, avis, agir, enCours } = useAgir();

  const h = historiques[format] ?? historique(modeleDefaut('libre', format));
  const doc = h.present;
  const { largeur: W, hauteur: H } = FORMATS[format];
  const portee = visuel?.portee ?? (cible.genre === 'modele' ? (modele?.portee ?? cible.portee) : 'club');
  const type = visuel?.type ?? modele?.type ?? (cible.genre === 'modele' ? cible.type : 'libre');
  const donnees = useMemo(() => (visuel?.donnees ? visuel.donnees : donneesExemple(systeme)), [visuel, systeme]);
  const plan = useMemo(() => planifier(doc, charte, donnees, langue), [doc, charte, donnees, langue]);
  const choisi = doc.calques.find(c => c.id === selection);

  // Polices et images (chargées à la demande ; le canevas se redessine quand elles arrivent).
  const [images, setImages] = useState<ImagesChargees>(() => new Map());
  const [policesPretes, setPolicesPretes] = useState(0);
  const chargeur = useMemo(() => creerChargeurImages({ lienFichier: async id => (await api.lienFichier(id)).url, assets: () => obtenirAssets().catch(() => undefined) }), [api]);
  const cache = useRef<ImagesChargees>(new Map());
  useEffect(() => {
    let vivant = true;
    void chargerPolices(plan).then(() => vivant && setPolicesPretes(n => n + 1));
    const avant = cache.current.size;
    void chargerImages(plan, chargeur, cache.current).then(m => {
      if (vivant && m.size !== avant) setImages(new Map(m));
    });
    return () => {
      vivant = false;
    };
  }, [plan, chargeur]);
  const planDessine = useMemo(() => ({ ...plan }), [plan, policesPretes]); // eslint-disable-line react-hooks/exhaustive-deps

  const executer = useCallback(
    (a: Action, fusion = false) => {
      setHistoriques(hs => {
        const actuel = hs[format];
        return actuel ? { ...hs, [format]: appliquer(actuel, a, { fusion }) } : hs;
      });
      setModifie(true);
      if (a.type === 'supprimer') setSelection(undefined);
      if (a.type === 'ajouter') setSelection(a.calque.id);
    },
    [format],
  );
  const annulerRetablir = useCallback(
    (sens: 'annuler' | 'retablir') => {
      setHistoriques(hs => {
        const actuel = hs[format];
        return actuel ? { ...hs, [format]: sens === 'annuler' ? annuler(actuel) : retablir(actuel) } : hs;
      });
      setModifie(true);
    },
    [format],
  );

  // Raccourcis clavier (hors champs de saisie).
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const cibleTouche = e.target as HTMLElement | null;
      if (cibleTouche && (cibleTouche.tagName === 'INPUT' || cibleTouche.tagName === 'TEXTAREA' || cibleTouche.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        annulerRetablir(e.shiftKey ? 'retablir' : 'annuler');
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        annulerRetablir('retablir');
      } else if (!selection) return;
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        executer({ type: 'supprimer', id: selection });
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        executer({ type: 'dupliquer', id: selection });
      } else if (e.key === 'Escape') setSelection(undefined);
      else if (e.key.startsWith('Arrow') && choisi && !choisi.verrouille) {
        e.preventDefault();
        const pas = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -pas : e.key === 'ArrowRight' ? pas : 0;
        const dy = e.key === 'ArrowUp' ? -pas : e.key === 'ArrowDown' ? pas : 0;
        executer({ type: 'modifier', id: selection, valeurs: { x: choisi.x + dx, y: choisi.y + dy } }, true);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [selection, choisi, executer, annulerRetablir]);

  // Échelle : le canevas tient dans la largeur disponible et (sur PC) dans la hauteur de la fenêtre.
  const ajuste = Math.min(largeurCanevas / W, (large ? hauteurFenetre - 220 : hauteurFenetre * 0.7) / H);
  const echelle = Math.max(0.05, ajuste * zoom);
  const horsZoneN = zone ? horsZone(doc, ZONES_SURES[format].find(z => z.reseau === zone) ?? ZONES_SURES[format][0]).length : 0;

  // ---------------------------------------------------------------- Ajouts
  const ajouterTexte = (t?: string) => executer({ type: 'ajouter', calque: { ...calqueTexteDefaut(W, H, t ? { fr: t, en: t } : { fr: trViLangue('fr', 'editeur.nouveau_texte'), en: trViLangue('en', 'editeur.nouveau_texte') }) } });
  const base = (id: string, l: number, h: number) => ({ id, nom: '', x: Math.round((W - l) / 2), y: Math.round((H - h) / 2), l, h, rotation: 0, opacite: 1, verrouille: false, masque: false, si: null, ombre: null, contour: null, lueur: null });
  const ajouterForme = () => executer({ type: 'ajouter', calque: { ...base(nouvelIdCalque('f'), 360, 220), type: 'forme', forme: 'chanfrein', remplissage: null, rayon: 0, coupe: 32, contour: { couleur: 'charte:primaire', epaisseur: 4 }, lueur: { couleur: 'charte:primaire', force: 20 } } });
  const ajouterLogo = () => executer({ type: 'ajouter', calque: { ...base(nouvelIdCalque('l'), 260, 260), type: 'logo', cible: 'team' } });
  const ajouterListe = () =>
    executer({ type: 'ajouter', calque: { ...base(nouvelIdCalque('li'), Math.round(W * 0.8), 300), type: 'liste', source: 'manches', ligne: { fr: '{carte}    {score}', en: '{carte}    {score}' }, police: 'charte:sousTitre', taille: 40, graisse: 700, couleur: { type: 'uni', couleur: 'charte:texte' }, align: 'centre', pas: 64, max: 5, majuscules: true, surligne: 'charte:victoire' } });
  const ajouterImage = (source: { fichier: string } | { champ: 'map_1' | 'agent_mvp' | 'logo_team' | 'logo_club' }) => {
    if (choisi?.type === 'image') executer({ type: 'modifier', id: choisi.id, valeurs: { source } });
    else executer({ type: 'ajouter', calque: { ...base(nouvelIdCalque('i'), Math.round(W * 0.5), Math.round(H * 0.4)), type: 'image', source, ajustement: 'couvrir', rayon: 0, filtre: 'normal' } });
    setChoixImage(false);
  };
  const insererChamp = (champ: string) => {
    if (choisi?.type === 'texte') executer({ type: 'modifier', id: choisi.id, valeurs: { texte: { ...choisi.texte, [langue]: `${choisi.texte[langue]}{${champ}}` } } });
    else ajouterTexte(`{${champ}}`);
  };
  const importerImage = () =>
    agir('image', async () => {
      const f = await choisirFichier(ACCEPT_IMAGES, 'esport-vi-image-fichier');
      if (!f) return undefined;
      if (f.taille > TAILLE_MAX_IMAGE) throw new Error(trVi('editeur.image_trop_lourde'));
      const { etat, oublier } = await envoyerFichier({ client: api.client, teamId: portee, section: 'cm', fichier: f });
      const img = await api.importerImage(portee, etat.id);
      oublier();
      ajouterImage({ fichier: img.fichierId });
      return undefined;
    });

  // ---------------------------------------------------------------- Enregistrements
  const documents = (): Partial<Record<CleFormat, DocumentVisuel>> => Object.fromEntries(formats.map(f => [f, historiques[f]?.present]));
  const enregistrer = () =>
    agir('enregistrer', async () => {
      if (visuel) {
        const r = await api.modifierVisuel(visuel.id, visuel.version, { document: doc });
        setVisuel(r.visuel);
      } else if (modele) {
        const r = await api.modifierModele(modele.id, modele.version, { documents: documents() });
        setModele(r.modele);
      } else {
        setNomModele(trVi('espace.copie_de', { nom: trVi(`type.${type}` as CleVi) }));
        return undefined;
      }
      setModifie(false);
      setChange(true);
      return trVi('editeur.enregistre');
    });
  const creerModele = (nom: string) =>
    agir('modele', async () => {
      const r = await api.creerModele({ portee, nom, type, base: refDefaut(type), documents: documents() });
      setModele(r.modele);
      setNomModele(undefined);
      setModifie(false);
      setChange(true);
      return trVi('editeur.modele_cree');
    });
  const revenirAuModele = () =>
    agir('revenir', async () => {
      if (!visuel || !window.confirm(trVi('editeur.revenir_modele_confirmer'))) return undefined;
      const r = await api.modifierVisuel(visuel.id, visuel.version, { document: null });
      setVisuel(r.visuel);
      setHistoriques({ [r.visuel.format]: historique(lireDocument(!estRefDefaut(r.visuel.modele) && modele?.documents[r.visuel.format] ? modele.documents[r.visuel.format] : modeleDefaut(r.visuel.type, r.visuel.format), r.visuel.format)) });
      setModifie(false);
      setChange(true);
      return undefined;
    });
  const generer = () =>
    agir('generer', async () => {
      if (!visuel) return undefined;
      let v = visuel;
      if (modifie) v = (await api.modifierVisuel(v.id, v.version, { document: doc })).visuel;
      try {
        const r = await genererVisuel(api, v, charte, modele);
        if (r) setVisuel(r);
      } catch (e) {
        if (e instanceof ErreurEsport && e.code === 'conflit') setVisuel((await api.visuel(v.id)).visuel);
        throw e;
      }
      setModifie(false);
      setChange(true);
      return v.carteId ? trVi('editeur.genere') : trVi('editeur.genere_seul');
    });
  const exporter = (typeImage: 'png' | 'jpeg') =>
    agir('exporter', async () => {
      const imgs = await chargerImages(plan, chargeur, cache.current);
      const blob = await rendreBlob(plan, imgs, typeImage);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-${format}-${langue}.${typeImage === 'jpeg' ? 'jpg' : 'png'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return undefined;
    });
  const ouvrirVersions = () =>
    agir('versions', async () => {
      if (!modele) return undefined;
      setVersions((await api.versionsModele(modele.id)).versions);
      return undefined;
    });
  const restaurer = (version: number) =>
    agir('restaurer', async () => {
      if (!modele) return undefined;
      const r = await api.restaurerModele(modele.id, version, modele.version);
      setModele(r.modele);
      setHistoriques(Object.fromEntries(Object.entries(r.modele.documents).map(([f, d]) => [f, historique(lireDocument(d, f as CleFormat))])));
      setVersions(undefined);
      setModifie(false);
      setChange(true);
      return trVi('espace.restaure');
    });
  const fermer = () => {
    if (modifie && !window.confirm(trVi('editeur.modifs_non_enregistrees'))) return;
    onFermer(change);
  };

  // ---------------------------------------------------------------- Mise en page
  const barre = (
    <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]} testID="esport-vi-barre">
      <BoutonHub theme={theme} titre={`← ${trVi('editeur.retour')}`} onPress={fermer} testID="esport-vi-retour" />
      {formats.length > 1 ? <Pastilles<CleFormat> theme={theme} libelle={trVi('editeur.format')} valeur={format} options={formats.map(f => [f, trVi(`format.${f}` as CleVi)] as const)} onChoisir={f => { setFormat(f); setSelection(undefined); }} testID="esport-vi-format" /> : null}
      {cible.genre === 'modele' ? <Pastilles<Langue> theme={theme} libelle={trVi('editeur.langue')} valeur={langue} options={[['fr', 'FR'], ['en', 'EN']] as const} onChoisir={setLangue} testID="esport-vi-langue" /> : null}
      {!visuel ? <Pastilles<'serie' | 'classement'> theme={theme} libelle={trVi('editeur.donnees')} valeur={systeme} options={[['serie', trVi('editeur.exemple_serie')], ['classement', trVi('editeur.exemple_classement')]] as const} onChoisir={setSysteme} testID="esport-vi-exemple" /> : null}
      <BoutonHub theme={theme} titre="↶" libelle={trVi('editeur.annuler')} desactive={!h.passe.length} onPress={() => annulerRetablir('annuler')} testID="esport-vi-annuler" />
      <BoutonHub theme={theme} titre="↷" libelle={trVi('editeur.retablir')} desactive={!h.futur.length} onPress={() => annulerRetablir('retablir')} testID="esport-vi-retablir" />
      <BoutonHub theme={theme} titre="−" libelle={trVi('editeur.zoom_moins')} onPress={() => setZoom(z => Math.max(0.25, Math.round((z / 1.25) * 100) / 100))} testID="esport-vi-zoom-moins" />
      <BoutonHub theme={theme} titre={`${Math.round(echelle * 100)} %`} libelle={trVi('editeur.zoom_ajuster')} onPress={() => setZoom(1)} testID="esport-vi-zoom-ajuster" />
      <BoutonHub theme={theme} titre="+" libelle={trVi('editeur.zoom_plus')} onPress={() => setZoom(z => Math.min(6, Math.round(z * 1.25 * 100) / 100))} testID="esport-vi-zoom-plus" />
      <Pastilles<ReseauZone | ''> theme={theme} libelle={trVi('editeur.zone_sure')} valeur={zone} options={[['', trVi('editeur.zone_aucune')], ...ZONES_SURES[format].map(z => [z.reseau, z.reseau === 'x' ? 'X' : z.reseau === 'tiktok' ? 'TikTok' : 'Instagram'] as const)]} onChoisir={setZone} testID="esport-vi-zone" />
      <View style={{ gap: 4 }}>
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trVi('editeur.magnetisme')}</Text>
        <Interrupteur theme={theme} libelle={trVi('editeur.magnetisme')} valeur={aimant} onChanger={setAimant} testID="esport-vi-aimant" />
      </View>
    </View>
  );
  const ajouts = (
    <View style={[styles.ligne, { gap: 4 }]} testID="esport-vi-ajouts">
      <BoutonHub theme={theme} titre={`+ ${trVi('editeur.ajouter_texte')}`} onPress={() => ajouterTexte()} testID="esport-vi-ajouter-texte" />
      <BoutonHub theme={theme} titre={`+ ${trVi('editeur.ajouter_forme')}`} onPress={ajouterForme} testID="esport-vi-ajouter-forme" />
      <BoutonHub theme={theme} titre={`+ ${trVi('editeur.ajouter_image')}`} onPress={() => setChoixImage(true)} testID="esport-vi-ajouter-image" />
      <BoutonHub theme={theme} titre={`+ ${trVi('editeur.ajouter_logo')}`} onPress={ajouterLogo} testID="esport-vi-ajouter-logo" />
      <BoutonHub theme={theme} titre={`+ ${trVi('editeur.ajouter_liste')}`} onPress={ajouterListe} testID="esport-vi-ajouter-liste" />
    </View>
  );
  const champs = (
    <View style={{ gap: 4 }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{`+ ${trVi('editeur.ajouter_champ')}`}</Text>
      <View style={[styles.ligne, { gap: 4 }]}>
        {CHAMPS_TEXTE.map(x => (
          <Pressable key={x} accessibilityRole="button" onPress={() => insererChamp(x)} testID={`esport-vi-champ-${x}`} style={(e: EtatPresse) => ({ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: theme.ligne, backgroundColor: e.hovered ? theme.surface : 'transparent' })}>
            <Text style={attenue(theme, 12)}>{`{${x}}`}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  const actions = (
    <View style={[styles.ligne, { gap: ESP.xs }]} testID="esport-vi-actions">
      <BoutonHub theme={theme} titre={visuel || modele ? trVi('editeur.enregistrer') : trVi('editeur.enregistrer_comme_modele')} variante="plein" desactive={Boolean(enCours) || (!modifie && Boolean(visuel || modele))} onPress={() => void enregistrer()} testID="esport-vi-enregistrer" />
      {visuel ? <BoutonHub theme={theme} titre={visuel.carteId ? trVi('editeur.generer') : trVi('editeur.generer_seul')} variante="plein" desactive={Boolean(enCours)} onPress={() => void generer()} testID="esport-vi-generer" /> : null}
      {visuel?.retouche ? <BoutonHub theme={theme} titre={trVi('editeur.revenir_modele')} onPress={() => void revenirAuModele()} testID="esport-vi-revenir-modele" /> : null}
      {modele ? <BoutonHub theme={theme} titre={trVi('espace.versions')} onPress={() => void ouvrirVersions()} testID="esport-vi-versions" /> : null}
      <BoutonHub theme={theme} titre={trVi('editeur.exporter_png')} onPress={() => void exporter('png')} testID="esport-vi-export-png" />
      <BoutonHub theme={theme} titre={trVi('editeur.exporter_jpg')} onPress={() => void exporter('jpeg')} testID="esport-vi-export-jpg" />
    </View>
  );
  const canevas = (
    <View style={{ flex: 1, minWidth: 0, gap: ESP.xs }} onLayout={e => setLargeurCanevas(Math.max(200, Math.floor(e.nativeEvent.layout.width - 8)))}>
      <ScrollView horizontal contentContainerStyle={{ minWidth: '100%', justifyContent: 'center' }}>
        <Canevas plan={planDessine} images={images} doc={doc} selection={selection} echelle={echelle} zone={zone} aimant={aimant} onSelection={setSelection} onAction={a => executer(a)} />
      </ScrollView>
      {horsZoneN ? <Text style={{ ...texte(theme, 13), color: theme.alerte }}>{trVi('editeur.hors_zone', { n: horsZoneN })}</Text> : null}
      <Text style={attenue(theme, 12)}>{trVi('editeur.raccourcis')}</Text>
    </View>
  );
  const proprietes = <Proprietes theme={theme} doc={doc} calque={choisi} charte={charte} onAction={executer} onChoisirImage={() => setChoixImage(true)} />;
  const titreEditeur = visuel ? visuel.nom : modele ? trVi('editeur.titre_modele', { nom: modele.nom }) : trVi('editeur.titre_modele', { nom: trVi(`type.${type}` as CleVi) });

  return (
    <View style={{ gap: ESP.s }} testID="esport-vi-editeur">
      <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '800' }}>
        {titreEditeur}
      </Text>
      {barre}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi-editeur" />
      {actions}
      {large && largeurFenetre >= 1100 ? (
        <View style={{ flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' }}>
          <View style={{ width: 260, flexShrink: 0, gap: ESP.s }}>
            {ajouts}
            {champs}
            <ListeCalques theme={theme} doc={doc} selection={selection} langue={langue} onSelection={setSelection} onAction={a => executer(a)} />
          </View>
          {canevas}
          <View style={{ width: 380, flexShrink: 0 }}>
            <ScrollView style={{ maxHeight: hauteurFenetre - 160 }} contentContainerStyle={{ gap: ESP.s, paddingBottom: ESP.xl }}>
              {proprietes}
            </ScrollView>
          </View>
        </View>
      ) : (
        <View style={{ gap: ESP.s }}>
          {canevas}
          {ajouts}
          {proprietes}
          {champs}
          <ListeCalques theme={theme} doc={doc} selection={selection} langue={langue} onSelection={setSelection} onAction={a => executer(a)} />
        </View>
      )}

      <Volet theme={theme} visible={nomModele !== undefined} titre={trVi('editeur.enregistrer_comme_modele')} onFermer={() => setNomModele(undefined)} testID="esport-vi-nom-modele">
        <Champ theme={theme} libelle={trVi('editeur.nom_modele')} valeur={nomModele ?? ''} onChanger={setNomModele} maxLength={80} testID="esport-vi-nom-modele-champ" />
        <BoutonHub theme={theme} titre={trVi('editeur.enregistrer_modele')} variante="plein" desactive={!nomModele?.trim()} onPress={() => nomModele && void creerModele(nomModele.trim())} testID="esport-vi-nom-modele-ok" />
      </Volet>
      <Volet theme={theme} visible={choixImage} titre={trVi('editeur.ajouter_image')} onFermer={() => setChoixImage(false)} testID="esport-vi-choix-image">
        <BoutonHub theme={theme} titre={trVi('editeur.importer_image')} variante="plein" onPress={() => void importerImage().then(() => setChoixImage(false))} testID="esport-vi-image-importer" />
        {(['map_1', 'agent_mvp', 'logo_team', 'logo_club'] as const).map(champ => (
          <BoutonHub key={champ} theme={theme} titre={trVi('editeur.image_champ', { champ })} onPress={() => ajouterImage({ champ })} testID={`esport-vi-image-champ-${champ}`} />
        ))}
      </Volet>
      <Volet theme={theme} visible={versions !== undefined} titre={trVi('espace.versions')} onFermer={() => setVersions(undefined)} testID="esport-vi-versions-volet">
        {(versions ?? []).map(v => (
          <View key={v.version} style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.xs }]}>
            <Text style={texte(theme)}>{`${trVi('espace.version_n', { n: v.version })} · ${v.nom} · ${new Date(v.date).toLocaleString()}`}</Text>
            <BoutonHub theme={theme} titre={trVi('espace.restaurer')} onPress={() => void restaurer(v.version)} testID={`esport-vi-restaurer-${v.version}`} />
          </View>
        ))}
      </Volet>
    </View>
  );
}
