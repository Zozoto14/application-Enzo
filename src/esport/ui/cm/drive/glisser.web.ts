/**
 * Glisser-déposer du Drive et des dossiers de visuels sur le site et l'app PC (docs/esport/drive.md, « Déplacer
 * à la souris ») : on saisit un fichier ou un dossier (ou la sélection entière) et on le lâche sur un dossier, le
 * fil d'Ariane ou l'arborescence. Souris : le glisser commence après quelques pixels ; écran tactile : appui long
 * (≈ 0,45 s) puis glisser. Un cadre tracé dans le vide sélectionne plusieurs éléments ; Ctrl / Cmd-clic et
 * Maj-clic sont lus au moment de l'appui (`modificateurs`).
 *
 * Fait avec les événements « pointer » du DOM (pas le glisser-déposer HTML5, réservé aux fichiers venus de
 * l'ordinateur : ZoneDepot) : les vues portent des attributs `data-drive-source`, `data-drive-cible` et
 * `data-drive-zone` (props `dataSet` de react-native-web), et la cible est trouvée sous le pointeur. Le fantôme qui
 * suit le pointeur et le cadre sont de simples éléments du DOM (aucun rendu React à chaque mouvement).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Glisser, OptionsGlisser, SurvolGlisser } from './typesGlisser';

export type { Glisser, OptionsGlisser, SurvolGlisser } from './typesGlisser';

const SEUIL_SOURIS = 6;
const SEUIL_TACTILE = 10;
const APPUI_LONG_MS = 450;

type Etat =
  | { mode: 'repos' }
  | { mode: 'attente'; cle: string; x: number; y: number; tactile: boolean; minuterie?: ReturnType<typeof setTimeout> }
  | { mode: 'glisse'; sources: string[]; x: number; y: number }
  | { mode: 'cadre'; x0: number; y0: number; trace: boolean; ajout: boolean };

const plusProche = (cible: EventTarget | null, attr: string): HTMLElement | null => ((cible as HTMLElement | null)?.closest?.(`[${attr}]`) as HTMLElement | null) ?? null;

export function useGlisser(o: OptionsGlisser): Glisser {
  const [noeud, setNoeud] = useState<HTMLElement | null>(null);
  const ref = useCallback((n: unknown) => setNoeud((n as HTMLElement | null) ?? null), []);
  const opts = useRef(o);
  opts.current = o;
  const [survol, setSurvol] = useState<SurvolGlisser | null>(null);
  const [glisses, setGlisses] = useState<string[]>([]);
  const modifs = useRef({ ajout: false, plage: false, le: 0 });
  const dernier = useRef(0);

  useEffect(() => {
    if (!o.actif || !noeud?.addEventListener || typeof document === 'undefined') return undefined;
    let etat: Etat = { mode: 'repos' };
    let fantome: HTMLDivElement | null = null;
    let cadre: HTMLDivElement | null = null;
    let cibleActuelle: string | null = null;
    const c = () => opts.current.couleurs;

    const nettoyer = () => {
      if (etat.mode === 'attente' && etat.minuterie) clearTimeout(etat.minuterie);
      fantome?.remove();
      cadre?.remove();
      fantome = null;
      cadre = null;
      cibleActuelle = null;
      etat = { mode: 'repos' };
      setSurvol(null);
      setGlisses([]);
      document.body.style.removeProperty('user-select');
    };

    const majFantome = (x: number, y: number, texte: string, refus: boolean) => {
      if (!fantome) return;
      fantome.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
      fantome.textContent = texte;
      fantome.style.borderColor = refus ? c().critique : c().accent;
    };

    const commencer = (cle: string, x: number, y: number) => {
      const sources = opts.current.sources(cle);
      if (!sources.length) {
        nettoyer();
        return;
      }
      etat = { mode: 'glisse', sources, x, y };
      setGlisses(sources);
      document.body.style.setProperty('user-select', 'none');
      fantome = document.createElement('div');
      fantome.setAttribute('aria-hidden', 'true');
      Object.assign(fantome.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        zIndex: '3000',
        pointerEvents: 'none',
        padding: '8px 12px',
        borderRadius: '10px',
        border: `2px solid ${c().accent}`,
        background: c().fond,
        color: c().texte,
        font: '600 13px system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        maxWidth: '320px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });
      document.body.appendChild(fantome);
      majFantome(x, y, opts.current.texteSources(sources), false);
      (navigator as { vibrate?: (n: number) => void }).vibrate?.(15);
    };

    const deplacerGlisse = (x: number, y: number) => {
      if (etat.mode !== 'glisse') return;
      etat.x = x;
      etat.y = y;
      // Défilement automatique près des bords de la fenêtre.
      if (y < 48) window.scrollBy(0, -16);
      else if (y > window.innerHeight - 48) window.scrollBy(0, 16);
      const el = document.elementFromPoint(x, y);
      const cible = plusProche(el, 'data-drive-cible')?.getAttribute('data-drive-cible') ?? null;
      const sources = etat.sources;
      if (cible !== cibleActuelle) {
        cibleActuelle = cible;
        if (cible) {
          const v = opts.current.verifier(sources, cible);
          setSurvol({ cible, refus: v.refus, libelle: v.libelle });
        } else setSurvol(null);
      }
      const v = cible ? opts.current.verifier(sources, cible) : null;
      majFantome(x, y, v ? (v.refus ? `⊘ ${v.refus}` : `${opts.current.texteSources(sources)} → ${v.libelle}${v.note ? ` · ${v.note}` : ''}`) : opts.current.texteSources(sources), Boolean(v?.refus));
    };

    const finirGlisse = (lacher: boolean) => {
      if (etat.mode !== 'glisse') return;
      const sources = etat.sources;
      const cible = cibleActuelle;
      dernier.current = Date.now();
      nettoyer();
      if (lacher && cible) {
        const v = opts.current.verifier(sources, cible);
        if (v.refus) opts.current.refuse?.(v.refus);
        else opts.current.lacher(sources, cible);
      }
    };

    const rectCadre = (x0: number, y0: number, x: number, y: number) => ({ g: Math.min(x0, x), h: Math.min(y0, y), d: Math.max(x0, x), b: Math.max(y0, y) });

    const appui = (e: PointerEvent) => {
      modifs.current = { ajout: e.ctrlKey || e.metaKey, plage: e.shiftKey, le: Date.now() };
      if (e.button !== 0 || etat.mode !== 'repos') return;
      const cibleDom = e.target as HTMLElement | null;
      // Les contrôles internes (menu « ⋯ », cases, champs) gardent leur comportement.
      if (cibleDom?.closest?.('[data-menu], [role="checkbox"], input, textarea, select')) return;
      const source = plusProche(cibleDom, 'data-drive-source');
      const tactile = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (source) {
        const cle = source.getAttribute('data-drive-source') ?? '';
        etat = { mode: 'attente', cle, x: e.clientX, y: e.clientY, tactile };
        if (tactile) {
          const ici = etat;
          ici.minuterie = setTimeout(() => {
            if (etat === ici) commencer(ici.cle, ici.x, ici.y);
          }, APPUI_LONG_MS);
        }
        return;
      }
      if (!tactile && plusProche(cibleDom, 'data-drive-zone') && opts.current.cadre) {
        etat = { mode: 'cadre', x0: e.clientX, y0: e.clientY, trace: false, ajout: e.ctrlKey || e.metaKey || e.shiftKey };
      }
    };

    const mouvement = (e: PointerEvent) => {
      if (etat.mode === 'attente') {
        const d = Math.hypot(e.clientX - etat.x, e.clientY - etat.y);
        if (etat.tactile) {
          // Le doigt bouge avant l'appui long : c'est un défilement, pas un glisser.
          if (d > SEUIL_TACTILE) nettoyer();
          else {
            etat.x = e.clientX;
            etat.y = e.clientY;
          }
        } else if (d > SEUIL_SOURIS) commencer(etat.cle, e.clientX, e.clientY);
        return;
      }
      if (etat.mode === 'glisse') {
        e.preventDefault();
        deplacerGlisse(e.clientX, e.clientY);
        return;
      }
      if (etat.mode === 'cadre') {
        if (!etat.trace && Math.hypot(e.clientX - etat.x0, e.clientY - etat.y0) < SEUIL_SOURIS) return;
        e.preventDefault();
        if (!etat.trace) {
          etat.trace = true;
          document.body.style.setProperty('user-select', 'none');
          cadre = document.createElement('div');
          cadre.setAttribute('aria-hidden', 'true');
          Object.assign(cadre.style, { position: 'fixed', zIndex: '2500', pointerEvents: 'none', border: `1px solid ${c().accent}`, background: `${c().accent}22`, borderRadius: '4px' });
          document.body.appendChild(cadre);
        }
        const r = rectCadre(etat.x0, etat.y0, e.clientX, e.clientY);
        if (cadre) Object.assign(cadre.style, { left: `${r.g}px`, top: `${r.h}px`, width: `${r.d - r.g}px`, height: `${r.b - r.h}px` });
        const touches: string[] = [];
        noeud.querySelectorAll('[data-drive-source]').forEach(x => {
          const b = (x as HTMLElement).getBoundingClientRect();
          if (b.right >= r.g && b.left <= r.d && b.bottom >= r.h && b.top <= r.b) touches.push(x.getAttribute('data-drive-source') ?? '');
        });
        opts.current.cadre?.(touches.filter(Boolean), etat.ajout);
      }
    };

    const relache = (e: PointerEvent) => {
      // Écran tactile : un « pointercancel » pendant le glisser n'arrête rien (la fin vient de « touchend »).
      if (etat.mode === 'glisse' && e.type === 'pointercancel' && e.pointerType === 'touch') return;
      if (etat.mode === 'glisse') {
        finirGlisse(e.type === 'pointerup');
        return;
      }
      if (etat.mode === 'cadre') {
        const trace = etat.trace;
        const ajout = etat.ajout;
        if (trace) dernier.current = Date.now();
        nettoyer();
        if (!trace && !ajout && e.type === 'pointerup') opts.current.videClique?.();
        return;
      }
      if (etat.mode === 'attente') nettoyer();
    };

    // Écran tactile : pendant un glisser, le doigt ne fait plus défiler la page (écouteur non passif).
    const toucheMouvement = (e: TouchEvent) => {
      if (etat.mode === 'glisse') {
        e.preventDefault();
        const t = e.touches[0];
        if (t) deplacerGlisse(t.clientX, t.clientY);
      }
    };
    const toucheFin = () => {
      if (etat.mode === 'glisse') finirGlisse(true);
    };
    const menuContextuel = (e: Event) => {
      if (etat.mode === 'attente' || etat.mode === 'glisse') e.preventDefault();
    };
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && etat.mode !== 'repos') {
        dernier.current = Date.now();
        nettoyer();
      }
    };
    // Le clic qui suit un glisser (ou un cadre) n'ouvre rien.
    const clic = (e: MouseEvent) => {
      if (Date.now() - dernier.current < 350) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    noeud.addEventListener('pointerdown', appui, true);
    document.addEventListener('pointermove', mouvement, { passive: false });
    document.addEventListener('pointerup', relache);
    document.addEventListener('pointercancel', relache);
    document.addEventListener('touchmove', toucheMouvement, { passive: false });
    document.addEventListener('touchend', toucheFin);
    noeud.addEventListener('contextmenu', menuContextuel);
    document.addEventListener('keydown', clavier);
    noeud.addEventListener('click', clic, true);
    return () => {
      nettoyer();
      noeud.removeEventListener('pointerdown', appui, true);
      document.removeEventListener('pointermove', mouvement);
      document.removeEventListener('pointerup', relache);
      document.removeEventListener('pointercancel', relache);
      document.removeEventListener('touchmove', toucheMouvement);
      document.removeEventListener('touchend', toucheFin);
      noeud.removeEventListener('contextmenu', menuContextuel);
      document.removeEventListener('keydown', clavier);
      noeud.removeEventListener('click', clic, true);
    };
  }, [o.actif, noeud]);

  const marque = useCallback((m: { source?: string; cible?: string; zone?: boolean }) => {
    const dataSet: Record<string, string> = {};
    if (m.source) dataSet.driveSource = m.source;
    if (m.cible) dataSet.driveCible = m.cible;
    if (m.zone) dataSet.driveZone = '1';
    return { dataSet } as object;
  }, []);

  return {
    ref,
    marque,
    survol,
    glisses,
    modificateurs: () => (Date.now() - modifs.current.le < 1500 ? { ajout: modifs.current.ajout, plage: modifs.current.plage } : { ajout: false, plage: false }),
    vientDeGlisser: () => Date.now() - dernier.current < 350,
    disponible: true,
  };
}
