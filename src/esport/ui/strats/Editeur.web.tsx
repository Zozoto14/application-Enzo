/**
 * Éditeur de strats (site et app PC) : un ATELIER plein écran, la map d'abord.
 *
 * Ouvrir une strat recouvre toute la fenêtre (barre d'onglets du hub, barre latérale de l'Esport, fil d'Ariane
 * et onglets du module disparaissent) : le canevas prend toute la place, l'interface se pose autour ou dessus
 * (src/esport/ui/strats/atelier/). Le bouton « Strats » revient à la liste ; Échap ferme d'abord ce qui est
 * ouvert et ne fait jamais perdre le travail (enregistrement automatique).
 *
 * Ici : ce que seul le navigateur sait faire. L'hôte plein écran (portail hors de la page : rien de l'Esport ne
 * défile dessous), le canevas Konva chargé à la demande (CanevasStrat.web.tsx), la comparaison côte à côte, le
 * GLISSER depuis le dock (un portrait ou une capacité déposés sur la map), le glisser des étapes pour les
 * réordonner, le téléchargement et l'impression (PNG, PDF), le vrai plein écran de la présentation, le
 * presse-papiers. L'état et la mise en page sont dans `useAtelier` et `Atelier` (testés sans canevas).
 *
 * Selon le MODÈLE DE STRAT du jeu de la team : Valorant (5 joueurs, agents et capacités à l'échelle), The
 * Finals (3 joueurs, Cashout / Final Round, classes, spécialisations et gadgets, étages), générique (pions).
 */

import { reglagesCarte } from '../../strats/plateau';
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Text, View } from 'react-native';
import { police, type ThemeHub } from '../../../hub/themes';
import { trSt } from '../../i18n/strats2';
import { tr } from '../../i18n';
import type { Strat } from '../../strats/api';
import { creerCacheImages, trouverAgent } from '../../strats/assets';
import { VUE_INITIALE, lireDocument, type DocumentStrat, type Vue } from '../../strats/document';
import { Retours, useAgir } from '../commun';
import { Atelier } from './atelier/Atelier';
import { Bascule, attenueAtelier, texteAtelier, verre } from './atelier/briques';
import { capacitesDuDock } from './atelier/Dock';
import { AGENT_INCONNU, useAtelier, type EtatAtelier, type Plateforme } from './atelier/useAtelier';
import type { Depot, PropsCanevas } from './canevas/types';
import { documentImpression } from './impression';
import type { PropsEditeur } from './types';

export type { PropsEditeur };

const Canevas = React.lazy(() => import('./CanevasStrat.web'));

export const cacheImages = creerCacheImages({
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit),
  caches: (globalThis as { caches?: Parameters<typeof creerCacheImages>[0]['caches'] }).caches,
  creerUrl: b => URL.createObjectURL(b),
});

const plateforme: Plateforme = {
  async telecharger(url, nom) {
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
  },
  async imprimer(html) {
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
  },
  attendreRendu: () => new Promise<void>(ok => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 60)))),
};

/** Hôte plein écran de l'atelier, posé sur `document.body` : au-dessus de l'app, sous les fenêtres modales. */
function creerHote(): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'esport-atelier-hote');
  Object.assign(div.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '4000',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
    overscrollBehavior: 'none',
    touchAction: 'manipulation',
  });
  return div;
}

const mouvementReduit = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Editeur(props: PropsEditeur) {
  const hote = useMemo(creerHote, []);
  // L'hôte suit la vie de l'écran : retiré quand l'onglet du hub est masqué (Activity), remis à son retour.
  useLayoutEffect(() => {
    hote.style.background = props.theme.fond;
    document.body.appendChild(hote);
    return () => hote.remove();
  }, [hote, props.theme.fond]);
  return createPortal(<AtelierWeb {...props} hote={hote} />, hote);
}

function AtelierWeb({ hote, ...props }: PropsEditeur & { hote: HTMLDivElement }) {
  const { theme } = props;
  const reduit = useMemo(mouvementReduit, []);
  const a = useAtelier({ ...props, images: cacheImages, plateforme, mouvementReduit: reduit });
  const [pleinEcran, setPleinEcran] = useState(false);
  const aRef = useRef(a);
  aRef.current = a;

  // ---------------------------------------------------------------- Vrai plein écran (présentation)
  const basculerPleinEcran = useCallback(
    (actif: boolean) => {
      const d = document as Document & { webkitExitFullscreen?(): void; webkitFullscreenElement?: Element | null };
      const el = hote as HTMLDivElement & { webkitRequestFullscreen?(): void };
      try {
        if (actif && !d.fullscreenElement && !d.webkitFullscreenElement) void (el.requestFullscreen ? el.requestFullscreen().catch(() => undefined) : el.webkitRequestFullscreen?.());
        else if (!actif && (d.fullscreenElement || d.webkitFullscreenElement)) void (d.exitFullscreen ? d.exitFullscreen().catch(() => undefined) : d.webkitExitFullscreen?.());
      } catch {
        // Plein écran refusé (iPhone, cadre) : la présentation occupe déjà toute la fenêtre.
      }
    },
    [hote],
  );
  useEffect(() => {
    const suivre = () => setPleinEcran(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', suivre);
    return () => {
      document.removeEventListener('fullscreenchange', suivre);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!a.presentation) basculerPleinEcran(false);
  }, [a.presentation, basculerPleinEcran]);

  // ---------------------------------------------------------------- Glisser depuis le dock, réordonner les étapes
  useEffect(() => {
    let geste: { type: 'depot' | 'etape'; id: string; x: number; y: number; actif: boolean; fantome?: HTMLDivElement; pointeur: number } | undefined;
    const sous = (ev: PointerEvent, prefixe: string): string | undefined => {
      // La puce elle-même, pas son image (dont l'identifiant commence pareil) : on remonte jusqu'à elle.
      let el = (ev.target as Element | null)?.closest?.(`[data-testid^="${prefixe}"]`) ?? null;
      while (el) {
        const id = el.getAttribute('data-testid') ?? '';
        if (!/-(portrait|icone|image|initiales)/.test(id.slice(prefixe.length))) return id;
        el = el.parentElement?.closest(`[data-testid^="${prefixe}"]`) ?? null;
      }
      return undefined;
    };
    const depotPour = (id: string): Depot | undefined => {
      const e = aRef.current;
      if (!e.doc || !e.peutModifier || e.temps !== undefined) return undefined;
      if (id.startsWith('esport-agent-')) {
        const cle = id.slice('esport-agent-'.length);
        const agent = cle === AGENT_INCONNU.cle ? AGENT_INCONNU : e.agents.find(x => x.cle === cle);
        return agent ? { type: 'agent', agent, joueur: e.depot.joueur, couleur: e.depot.couleur } : undefined;
      }
      if (id.startsWith('esport-capacite-')) {
        const capacite = capacitesDuDock(e.agent, e.categorie).find(c => c.cle === id.slice('esport-capacite-'.length));
        return capacite ? { type: 'capacite', agent: e.agent, capacite, joueur: e.depot.joueur, couleur: e.depot.couleur } : undefined;
      }
      if (id.startsWith('esport-joueur-')) {
        // Glisser un joueur : son pion (l'agent du joueur, sinon l'agent choisi).
        const i = Number(id.slice('esport-joueur-'.length));
        const j = e.doc.joueurs[i];
        if (!j || !Number.isInteger(i)) return undefined;
        const agent = (j.agent ? trouverAgent(e.assets, j.agent) : undefined) ?? e.agent;
        return { type: 'agent', agent, joueur: i, couleur: j.couleur };
      }
      return undefined;
    };
    const bas = (ev: PointerEvent) => {
      if (ev.button !== 0 || !ev.isPrimary) return;
      const etape = sous(ev, 'esport-etape-num-');
      const depot = sous(ev, 'esport-agent-') ?? sous(ev, 'esport-capacite-') ?? sous(ev, 'esport-joueur-');
      if (etape && /^esport-etape-num-\d+$/.test(etape) && aRef.current.peutModifier) geste = { type: 'etape', id: etape, x: ev.clientX, y: ev.clientY, actif: false, pointeur: ev.pointerId };
      else if (depot && depotPour(depot)) geste = { type: 'depot', id: depot, x: ev.clientX, y: ev.clientY, actif: false, pointeur: ev.pointerId };
    };
    const etapeSous = (ev: PointerEvent): number | undefined => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-testid^="esport-etape-num-"]');
      const m = /^esport-etape-num-(\d+)$/.exec(el?.getAttribute('data-testid') ?? '');
      return m ? Number(m[1]) : undefined;
    };
    const bouge = (ev: PointerEvent) => {
      if (!geste || ev.pointerId !== geste.pointeur) return;
      if (!geste.actif) {
        if (Math.hypot(ev.clientX - geste.x, ev.clientY - geste.y) < 10) return;
        geste.actif = true;
        if (geste.type === 'depot') {
          // Fantôme du glisser : la puce elle-même, clonée, qui suit le pointeur.
          const source = hote.querySelector(`[data-testid="${geste.id}"]`);
          const f = document.createElement('div');
          Object.assign(f.style, { position: 'fixed', zIndex: '4500', pointerEvents: 'none', opacity: '0.85', transform: 'translate(-50%, -50%) scale(1.1)', left: '0', top: '0' });
          if (source) f.appendChild(source.cloneNode(true));
          hote.appendChild(f);
          geste.fantome = f;
        }
      }
      ev.preventDefault();
      if (geste.type === 'depot' && geste.fantome) {
        geste.fantome.style.left = `${ev.clientX}px`;
        geste.fantome.style.top = `${ev.clientY}px`;
      } else if (geste.type === 'etape') {
        const de = Number(geste.id.slice('esport-etape-num-'.length));
        const vers = etapeSous(ev);
        aRef.current.setGlisseEtape(vers === undefined ? { de, vers: de } : { de, vers });
      }
    };
    const haut = (ev: PointerEvent) => {
      const g = geste;
      geste = undefined;
      if (!g || ev.pointerId !== g.pointeur) return;
      g.fantome?.remove();
      if (!g.actif) return;
      // Le relâché d'un glisser n'est pas un appui sur la puce.
      const avaler = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', avaler, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', avaler, { capture: true }), 80);
      const e = aRef.current;
      if (g.type === 'depot') {
        const quoi = depotPour(g.id);
        if (quoi) e.canevas.current?.deposer(ev.clientX, ev.clientY, quoi);
      } else {
        const de = Number(g.id.slice('esport-etape-num-'.length));
        const vers = etapeSous(ev);
        e.setGlisseEtape(undefined);
        if (vers !== undefined && vers !== de) e.deplacerEtape(de, vers);
      }
    };
    hote.addEventListener('pointerdown', bas);
    window.addEventListener('pointermove', bouge, { passive: false });
    window.addEventListener('pointerup', haut);
    window.addEventListener('pointercancel', haut);
    return () => {
      hote.removeEventListener('pointerdown', bas);
      window.removeEventListener('pointermove', bouge);
      window.removeEventListener('pointerup', haut);
      window.removeEventListener('pointercancel', haut);
    };
  }, [hote]);

  const canevas = useCallback(
    (p: PropsCanevas) => (
      <Suspense
        fallback={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{tr('strats.editeur.chargement_de_l_editeur')}</Text>
          </View>
        }>
        <Canevas {...p} />
      </Suspense>
    ),
    [theme],
  );
  const { doc, strat } = a;
  /** Quitter l'atelier vers un autre écran : ce qui reste à enregistrer part d'abord ; en cas d'échec, l'atelier demande. */
  const sortir = (suite: () => void) => {
    if (!a.peutModifier) suite();
    else void a.enregistrer({ auto: true }).then(ok => (ok ? suite() : a.setConfirmation('quitter')));
  };
  return (
    <Atelier
      theme={theme}
      a={a}
      canevas={canevas}
      comparaison={doc && strat ? zone => <Comparaison theme={theme} a={a} api={props.api} teamId={props.teamId} strat={strat} doc={doc} zone={zone} /> : undefined}
      impression={doc && strat ? images => documentImpression({ strat, doc, images, agents: props.assets?.agents ?? [] }) : undefined}
      pleinEcran={pleinEcran}
      onPleinEcran={basculerPleinEcran}
      copier={texte => void navigator.clipboard?.writeText(texte).catch(() => undefined)}
      onAdminJeux={props.onAdminJeux ? () => sortir(() => props.onAdminJeux?.()) : undefined}
      extrasTiroir={props.extrasTiroir?.(sortir)}
    />
  );
}

/** Comparaison côte à côte, à la place du canevas : une autre strat de la team, ou une ancienne version (lecture seule). */
function Comparaison({ theme, a, api, teamId, strat, doc, zone }: { theme: ThemeHub; a: EtatAtelier; api: PropsEditeur['api']; teamId: string; strat: Strat; doc: DocumentStrat; zone: { largeur: number; hauteur: number } }) {
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
  const carte = (d: DocumentStrat) => a.assets?.cartes.find(c => c.cle === d.carte.cle);
  const empile = zone.hauteur > zone.largeur;
  const entete = 46;
  const l = Math.floor(empile ? zone.largeur : zone.largeur / 2) - 1;
  const h = Math.floor(empile ? (zone.hauteur - entete) / 2 : zone.hauteur - entete) - 1;
  const commun = {
    outil: 'main' as const,
    couleur: '#ffffff',
    joueur: null,
    formeZone: 'auto' as const,
    formeDessin: 'rect' as const,
    texte: '',
    tirets: false,
    epaisseur: 5,
    lectureSeule: true,
    onSelection: () => undefined,
    onAction: () => undefined,
    images: cacheImages,
    agents: a.assets?.agents,
    ...reglagesCarte(a.doc?.modele, a.prefs.themeCarte, a.prefs.attenuation),
    noms: a.prefs.noms,
    largeur: l,
    hauteur: h,
    marges: { haut: 30, bas: 0, gauche: 0, droite: 0 },
  };
  const titre = (texte: string) => (
    <View style={[verre(theme, 8), { position: 'absolute', top: 6, left: 6, paddingHorizontal: 8, height: 24, justifyContent: 'center' }]} pointerEvents="none">
      <Text style={texteAtelier(theme, 12, true)} numberOfLines={1}>
        {texte}
      </Text>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.fond }} testID="esport-comparaison">
      <View style={{ height: entete, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
        <Text style={attenueAtelier(theme, 12)}>{trSt('comparer.avec')}</Text>
        <div style={{ flex: 1, display: 'flex', overflowX: 'auto' }}>
          {options.length ? (
            <Bascule theme={theme} libelle={trSt('comparer.avec')} valeur={choix ?? ''} options={options.map(o => [o.id, o.nom] as const)} onChoisir={setChoix} testID="esport-comparaison-choix" hauteur={30} />
          ) : (
            <Text style={attenueAtelier(theme, 12)}>…</Text>
          )}
        </div>
        <Retours theme={theme} erreur={erreur} prefixe="esport-comparaison" />
      </View>
      <View style={{ flex: 1, flexDirection: empile ? 'column' : 'row', gap: 2 }}>
        <View style={{ width: l, height: h }}>
          <Suspense fallback={null}>
            <Canevas {...commun} doc={doc} carte={carte(doc)} fond={doc.carte.image ?? carte(doc)?.minimap ?? null} etape={a.iEtape} vue={vueA} onVue={setVueA} testID="esport-comparaison-a" />
          </Suspense>
          {titre(trSt('comparer.actuelle'))}
        </View>
        <View style={{ width: l, height: h, backgroundColor: theme.surface }}>
          {autre ? (
            <Suspense fallback={null}>
              <Canevas {...commun} doc={autre} carte={carte(autre)} fond={autre.carte.image ?? carte(autre)?.minimap ?? null} etape={Math.min(a.iEtape, autre.etapes.length - 1)} vue={vueB} onVue={setVueB} testID="esport-comparaison-b" />
            </Suspense>
          ) : null}
          {titre(options.find(o => o.id === choix)?.nom ?? trSt('comparer.avec'))}
        </View>
      </View>
    </View>
  );
}
