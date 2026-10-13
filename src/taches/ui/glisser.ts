/**
 * Glisser-déposer des cartes (Kanban) et des tâches (Calendrier), à la
 * souris ET au doigt, sur le web (PC, site, iPad, iPhone) :
 *
 *  - souris / stylet : le glisser commence après 6 px de mouvement ;
 *  - doigt : appui long (280 ms) sans bouger, puis on glisse (le défilement
 *    de la page est bloqué pendant le glisser) ; bouger avant = défiler ;
 *  - Échap annule ; le clic qui suit un glisser est avalé.
 *
 * Les zones de dépôt (colonnes, jours) s'inscrivent dans un registre ; au
 * lâcher, celle qui contient le point reçoit l'élément. Ailleurs que sur le
 * web, rien n'est branché : le menu « Déplacer vers… » et le clavier
 * (Maj + flèches) font la même chose, partout.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ElementDom {
  addEventListener(type: string, f: (e: never) => void, o?: unknown): void;
  removeEventListener(type: string, f: (e: never) => void, o?: unknown): void;
  getBoundingClientRect(): Rect;
  style: Record<string, string>;
}

const estElementDom = (x: unknown): x is ElementDom =>
  Boolean(x) && typeof (x as ElementDom).addEventListener === 'function' && typeof (x as ElementDom).getBoundingClientRect === 'function';

export class RegistreZones {
  private zones = new Map<string, () => Rect | undefined>();
  private ecouteurs = new Set<(zone: string | undefined) => void>();
  survolee: string | undefined;

  inscrire(id: string, element: unknown): () => void {
    this.zones.set(id, () => (estElementDom(element) ? element.getBoundingClientRect() : undefined));
    return () => {
      if (this.zones.get(id)) this.zones.delete(id);
    };
  }

  trouver(x: number, y: number): string | undefined {
    for (const [id, rect] of this.zones) {
      const r = rect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return undefined;
  }

  survoler(zone: string | undefined): void {
    if (zone === this.survolee) return;
    this.survolee = zone;
    for (const e of this.ecouteurs) e(zone);
  }

  ecouter(f: (zone: string | undefined) => void): () => void {
    this.ecouteurs.add(f);
    return () => this.ecouteurs.delete(f);
  }
}

export const ContexteZones = createContext<RegistreZones | undefined>(undefined);

/** Zone de dépôt : rend une ref à poser sur la vue, et si elle est survolée. */
export function useZoneDepot(id: string): { ref: (x: unknown) => void; survolee: boolean } {
  const registre = useContext(ContexteZones);
  const [survolee, setSurvolee] = useState(false);
  const retirer = useRef<(() => void) | undefined>(undefined);
  useEffect(() => registre?.ecouter(z => setSurvolee(z === id)), [registre, id]);
  useEffect(() => () => retirer.current?.(), []);
  const ref = useCallback(
    (x: unknown) => {
      retirer.current?.();
      retirer.current = x && registre ? registre.inscrire(id, x) : undefined;
    },
    [registre, id],
  );
  return { ref, survolee };
}

const DELAI_APPUI_LONG = 280;
const SEUIL_SOURIS = 6;
const SEUIL_DOIGT = 10;

interface Pointeur {
  clientX: number;
  clientY: number;
}
interface EvtPointeur extends Pointeur {
  pointerType: string;
  button: number;
  pointerId: number;
  preventDefault(): void;
}
interface EvtToucher {
  touches: ArrayLike<Pointeur>;
  changedTouches: ArrayLike<Pointeur>;
  preventDefault(): void;
  cancelable?: boolean;
}

/**
 * Rend un élément déplaçable (web seulement). `onDeposer(zone)` reçoit la zone
 * sous le point au lâcher (rien si hors zone).
 */
export function useGlissable(o: { actif: boolean; onDeposer(zone: string): void; onDebut?(): void; onFin?(): void }): { ref: (x: unknown) => void; glisse: boolean } {
  const registre = useContext(ContexteZones);
  const [element, setElement] = useState<ElementDom | undefined>();
  const [glisse, setGlisse] = useState(false);
  const rappels = useRef(o);
  rappels.current = o;
  useEffect(() => {
    if (!element || !o.actif || !registre) return undefined;
    const doc = (globalThis as unknown as { document?: ElementDom }).document;
    if (!doc) return undefined;
    let depart: Pointeur | undefined;
    let enCours = false;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let avalerClic = false;
    let modeDoigt = false;
    const deplacer = (p: Pointeur) => {
      if (!depart) return;
      element.style.transform = `translate(${p.clientX - depart.clientX}px, ${p.clientY - depart.clientY}px) rotate(1.5deg)`;
      registre.survoler(registre.trouver(p.clientX, p.clientY));
    };
    const commencer = () => {
      enCours = true;
      setGlisse(true);
      element.style.zIndex = '50';
      element.style.position = 'relative';
      element.style.pointerEvents = 'none';
      element.style.boxShadow = '0 12px 28px rgba(0,0,0,0.28)';
      rappels.current.onDebut?.();
    };
    const finir = (p: Pointeur | undefined) => {
      if (minuterie) clearTimeout(minuterie);
      minuterie = undefined;
      const zone = enCours && p ? registre.trouver(p.clientX, p.clientY) : undefined;
      if (enCours) {
        avalerClic = true;
        setTimeout(() => {
          avalerClic = false;
        }, 50);
      }
      element.style.transform = '';
      element.style.zIndex = '';
      element.style.pointerEvents = '';
      element.style.boxShadow = '';
      registre.survoler(undefined);
      const etait = enCours;
      enCours = false;
      depart = undefined;
      setGlisse(false);
      doc.removeEventListener('pointermove', surBouger as never);
      doc.removeEventListener('pointerup', surLacher as never);
      doc.removeEventListener('keydown', surTouche as never, true);
      if (etait) {
        rappels.current.onFin?.();
        if (zone) rappels.current.onDeposer(zone);
      }
    };
    // --- Souris, stylet
    const surBouger = (e: EvtPointeur) => {
      if (modeDoigt || !depart) return;
      if (!enCours && Math.hypot(e.clientX - depart.clientX, e.clientY - depart.clientY) > SEUIL_SOURIS) commencer();
      if (enCours) {
        e.preventDefault();
        deplacer(e);
      }
    };
    const surLacher = (e: EvtPointeur) => finir(e);
    const surTouche = (e: { key: string; preventDefault(): void; stopPropagation(): void }) => {
      if (e.key === 'Escape' && depart) {
        e.preventDefault();
        e.stopPropagation();
        enCours = false;
        finir(undefined);
      }
    };
    const surAppui = (e: EvtPointeur) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      modeDoigt = false;
      depart = { clientX: e.clientX, clientY: e.clientY };
      doc.addEventListener('pointermove', surBouger as never);
      doc.addEventListener('pointerup', surLacher as never);
      doc.addEventListener('keydown', surTouche as never, true);
    };
    // --- Doigt : appui long, puis glisser (défilement bloqué)
    const surToucherDebut = (e: EvtToucher) => {
      if (e.touches.length !== 1) return;
      modeDoigt = true;
      const t = e.touches[0];
      depart = { clientX: t.clientX, clientY: t.clientY };
      minuterie = setTimeout(() => {
        minuterie = undefined;
        if (depart) commencer();
      }, DELAI_APPUI_LONG);
    };
    const surToucherBouger = (e: EvtToucher) => {
      if (!depart) return;
      const t = e.touches[0];
      if (!enCours) {
        if (t && Math.hypot(t.clientX - depart.clientX, t.clientY - depart.clientY) > SEUIL_DOIGT) {
          // Bougé avant l'appui long : c'est un défilement.
          if (minuterie) clearTimeout(minuterie);
          minuterie = undefined;
          depart = undefined;
        }
        return;
      }
      if (e.cancelable !== false) e.preventDefault();
      if (t) deplacer(t);
    };
    const surToucherFin = (e: EvtToucher) => {
      if (!depart) return;
      const t = e.changedTouches[0];
      if (enCours && e.cancelable !== false) e.preventDefault();
      finir(t);
    };
    const surClic = (e: { preventDefault(): void; stopPropagation(): void }) => {
      if (avalerClic) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const surMenu = (e: { preventDefault(): void }) => {
      // Appui long au doigt : pas de menu contextuel du navigateur.
      if (modeDoigt) e.preventDefault();
    };
    element.addEventListener('pointerdown', surAppui as never);
    element.addEventListener('touchstart', surToucherDebut as never, { passive: true });
    element.addEventListener('touchmove', surToucherBouger as never, { passive: false });
    element.addEventListener('touchend', surToucherFin as never, { passive: false });
    const surAnnuler = () => finir(undefined);
    element.addEventListener('touchcancel', surAnnuler as never);
    element.addEventListener('click', surClic as never, true);
    element.addEventListener('contextmenu', surMenu as never);
    element.style.touchAction = 'manipulation';
    element.style.userSelect = 'none';
    return () => {
      if (minuterie) clearTimeout(minuterie);
      element.removeEventListener('pointerdown', surAppui as never);
      element.removeEventListener('touchstart', surToucherDebut as never, { passive: true });
      element.removeEventListener('touchmove', surToucherBouger as never, { passive: false });
      element.removeEventListener('touchend', surToucherFin as never, { passive: false });
      element.removeEventListener('touchcancel', surAnnuler as never);
      element.removeEventListener('click', surClic as never, true);
      element.removeEventListener('contextmenu', surMenu as never);
      doc.removeEventListener('pointermove', surBouger as never);
      doc.removeEventListener('pointerup', surLacher as never);
      doc.removeEventListener('keydown', surTouche as never, true);
    };
  }, [element, o.actif, registre]);
  const ref = useCallback((x: unknown) => setElement(estElementDom(x) ? x : undefined), []);
  return { ref, glisse };
}
