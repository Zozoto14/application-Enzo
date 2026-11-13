/**
 * Éditeur de strats : un pion posé montre la PHOTO de l'agent (canevas Konva simulé : chaque forme devient un
 * élément de test). Pendant la pose, le portrait suit le pointeur (fantôme) ; le pion posé l'affiche aussitôt.
 * Ordre des sources : image importée (lien signé du serveur), puis CDN officiel, puis initiales.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { appliquer, documentVide, type Action, type DocumentStrat } from './strats/document';
import type { AgentAsset, CacheImages } from './strats/assets';

// Fichiers web (DOM, Konva) lus par require : hors de la vérification de types de l'app (comme claudeOffice/scene.test.tsx).
const CanevasStrat = require('./ui/strats/CanevasStrat.web').default as (p: Record<string, unknown>) => React.ReactElement;
const { oublierImagesJeu } = require('./ui/strats/imagesCanevas.web') as { oublierImagesJeu(): void };

const pointeur = { x: 300, y: 320 };

jest.mock('konva', () => ({ __esModule: true, default: {} }));
jest.mock('react-konva', () => {
  const R = jest.requireActual<typeof React>('react');
  const noeud = { getRelativePointerPosition: () => pointeur, hasName: () => false, findAncestor: () => null, id: () => '', find: () => [] };
  const forme = (nom: string) =>
    R.forwardRef<unknown, { children?: React.ReactNode }>(function Forme({ children, ...props }, ref) {
      R.useImperativeHandle(ref, () => noeud);
      return R.createElement(`konva-${nom}`, props, children);
    });
  return Object.fromEntries(['Arrow', 'Circle', 'Ellipse', 'Group', 'Image', 'Layer', 'Line', 'Rect', 'RegularPolygon', 'Stage', 'Text', 'Wedge'].map(n => [n, forme(n)]));
});

/** Décodage d'image simulé : chargée au tour suivant, en échec si l'adresse contient « casse ». */
class FausseImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private s = '';
  get src() {
    return this.s;
  }
  set src(v: string) {
    this.s = v;
    setTimeout(() => (v.includes('casse') ? this.onerror?.() : this.onload?.()), 0);
  }
}

const SIGNE = 'https://esport.test/jeux/images/p-viper?c=x&exp=9&sig=s';
const CDN = 'https://media.valorant-api.com/agents/v/displayicon.png';
const VIPER: AgentAsset = { cle: 'viper', nom: 'Viper', role: 'Contrôleur', roleCle: 'controleur', icone: SIGNE, iconeDoc: CDN, capacites: [] };

/** Cache d'images simulé : adresse → blob: ; `refusees` : images qui ne chargent pas (réseau, 403). */
function cache(refusees: string[] = []): CacheImages & { demandes: string[] } {
  const demandes: string[] = [];
  return {
    demandes,
    obtenir: async url => {
      if (!url) return null;
      demandes.push(url);
      return refusees.includes(url) ? null : `blob:${url}`;
    },
  };
}

function Editeur({ images, agent = VIPER, initial }: { images: CacheImages; agent?: AgentAsset; initial?: DocumentStrat }) {
  const [doc, setDoc] = React.useState(() => initial ?? documentVide({ cle: 'ascent', nom: 'Ascent', image: null }, 'attaque', 'valorant', 'valorant'));
  return (
    <CanevasStrat
      doc={doc}
      fond={null}
      etape={0}
      taille={600}
      outil="agent"
      couleur="#22c55e"
      joueur={0}
      agent={agent}
      agents={[agent]}
      formeZone="auto"
      formeDessin="rect"
      texte=""
      tirets={false}
      epaisseur={5}
      vue={{ echelle: 1, x: 0, y: 0 }}
      onVue={() => undefined}
      onSelection={() => undefined}
      onAction={(a: Action) => setDoc(d => appliquer(d, a))}
      images={images}
    />
  );
}

/** Rendu simulé : éléments `konva-*` (props comprises) parcourus depuis l'arbre JSON. */
type Noeud = { type: string; props: Record<string, unknown>; children: Array<Noeud | string> | null };
function tous(racine: Noeud | Noeud[] | null, test: (n: Noeud) => boolean): Noeud[] {
  const sortie: Noeud[] = [];
  const visiter = (n: Noeud | string) => {
    if (typeof n === 'string') return;
    if (test(n)) sortie.push(n);
    (n.children ?? []).forEach(visiter);
  };
  (Array.isArray(racine) ? racine : racine ? [racine] : []).forEach(visiter);
  return sortie;
}
const arbre = () => screen.toJSON() as Noeud | Noeud[] | null;
const srcImages = (racine: Noeud | Noeud[] | null) => tous(racine, n => n.type === 'konva-Image').map(n => (n.props.image as FausseImage).src);
const imagesSous = (_r: unknown, nom?: string) => (nom ? tous(arbre(), n => n.type === 'konva-Group' && n.props.name === nom).flatMap(g => srcImages(g)) : srcImages(arbre()));
const pionsPoses = (_r?: unknown) => tous(arbre(), n => n.type === 'konva-Group' && n.props.name === 'objet');
const attendreImages = () => act(() => new Promise<void>(ok => setTimeout(ok, 5)));

beforeEach(() => {
  oublierImagesJeu();
  (globalThis as { Image?: unknown }).Image = FausseImage;
});

describe('pion posé : photo de l’agent', () => {
  it('fantôme sous le pointeur avec le portrait, puis pion posé qui l’affiche aussitôt (image importée)', async () => {
    const images = cache();
    const r = await render(<Editeur images={images} />);
    const scene = () => tous(arbre(), n => n.type === 'konva-Stage')[0] as unknown as { props: Record<string, (e: unknown) => void> };
    const ev = { target: { hasName: () => false, findAncestor: () => null }, evt: { isPrimary: true, shiftKey: false } };
    // Agent armé, pointeur sur la map : le portrait suit le pointeur.
    await act(async () => scene().props.onPointerMove(ev));
    await attendreImages();
    expect(imagesSous(r, 'fantome-agent')).toEqual([`blob:${SIGNE}`]);
    // Pose (appui + relâché au même endroit) : le pion posé montre la photo dès son premier rendu.
    await act(async () => scene().props.onPointerDown(ev));
    await act(async () => scene().props.onPointerUp(ev));
    const pions = pionsPoses(r);
    expect(pions).toHaveLength(1);
    expect(srcImages(pions[0])).toEqual([`blob:${SIGNE}`]);
    expect(pions[0].props).toMatchObject({ x: pointeur.x, y: pointeur.y });
  });

  it('image importée indisponible : le CDN officiel ; tout en échec : initiales seulement', async () => {
    const d = documentVide({ cle: 'ascent', nom: 'Ascent', image: null }, 'attaque', 'valorant', 'valorant');
    d.etapes[0].objets.push({ id: 'p1', type: 'agent', x: 100, y: 100, agent: 'viper', nom: 'Viper', icone: CDN, joueur: 0, couleur: '#22c55e' });
    let r = await render(<Editeur images={cache([SIGNE])} initial={d} />);
    await attendreImages();
    expect(imagesSous(r)).toEqual([`blob:${CDN}`]);
    await r.unmount();
    oublierImagesJeu();
    // Décodage en échec pour la première source : la suivante.
    r = await render(<Editeur images={cache()} agent={{ ...VIPER, icone: 'https://esport.test/jeux/images/casse?sig=s' }} initial={d} />);
    await attendreImages();
    await attendreImages();
    expect(imagesSous(r)).toEqual([`blob:${CDN}`]);
    await r.unmount();
    oublierImagesJeu();
    r = await render(<Editeur images={cache([SIGNE, CDN])} initial={d} />);
    await attendreImages();
    expect(imagesSous(r)).toEqual([]);
    expect(tous(arbre(), n => n.type === 'konva-Text' && n.props.text === 'V')).toHaveLength(1);
  });
});
