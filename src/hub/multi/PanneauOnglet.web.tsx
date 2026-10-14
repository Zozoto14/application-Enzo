/**
 * Un onglet d'app, version web (navigateur, application de bureau).
 *
 * L'app est rendue dans un conteneur qui lui est propre (portail React) :
 *
 *  - affichée, le conteneur est posé dans la scène, à sa place (toute la
 *    largeur, ou un côté en côte à côte) ;
 *  - masquée, elle passe sous `<Activity mode="hidden">` (état gardé, effets
 *    suspendus : minuteurs, sondages, écouteurs du clavier, animations) ET son
 *    conteneur est retiré du document. Rien d'un onglet masqué ne reste donc
 *    dans la page : ni double identifiant, ni lecture qui continue (une vidéo
 *    retirée du document se met en pause), ni travail de mise en page.
 *
 * Le React reste au même endroit de l'arbre quel que soit le côté : passer
 * d'un côté à l'autre ou d'un onglet à l'autre ne remonte jamais l'app. Les
 * positions de défilement sont notées au fil de l'eau et rétablies au retour.
 */

import React, { Activity, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Placement, PropsPanneauOnglet } from './placement';

export { stylePlacement, type Placement, type PropsPanneauOnglet } from './placement';

function creerConteneur(): HTMLDivElement {
  const div = document.createElement('div');
  Object.assign(div.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    minWidth: '0',
    minHeight: '0',
    overflow: 'hidden',
  });
  return div;
}

function poser(conteneur: HTMLDivElement, placement: Placement): void {
  conteneur.style.left = `${placement.gauche * 100}%`;
  conteneur.style.width = `${placement.largeur * 100}%`;
  conteneur.style.paddingLeft = `${placement.marge?.gauche ?? 0}px`;
  conteneur.style.paddingRight = `${placement.marge?.droite ?? 0}px`;
}

export function PanneauOnglet({ placement, scene, testID, children }: PropsPanneauOnglet) {
  const conteneur = useMemo(creerConteneur, []);
  const visible = Boolean(placement);
  // Défilements notés pendant que l'onglet est affiché (masqué, le navigateur les oublie).
  const defilements = useRef(new Map<Element, { haut: number; gauche: number }>());
  const affiche = useRef(false);

  useEffect(() => {
    const noter = (e: Event) => {
      const cible = e.target;
      if (affiche.current && cible instanceof Element) {
        defilements.current.set(cible, { haut: cible.scrollTop, gauche: cible.scrollLeft });
      }
    };
    conteneur.addEventListener('scroll', noter, true);
    return () => {
      conteneur.removeEventListener('scroll', noter, true);
      conteneur.remove();
    };
  }, [conteneur]);

  useLayoutEffect(() => {
    if (testID) {
      conteneur.setAttribute('data-testid', testID);
    }
    if (!placement) {
      affiche.current = false;
      conteneur.remove();
      return undefined;
    }
    const poserDansLaScene = (): boolean => {
      const hote = scene.current as HTMLElement | null;
      if (!hote) {
        return false;
      }
      affiche.current = true;
      poser(conteneur, placement);
      if (conteneur.parentNode !== hote) {
        hote.appendChild(conteneur);
        // Retour à l'écran : chaque zone retrouve son défilement.
        for (const [element, { haut, gauche }] of defilements.current) {
          if (!conteneur.contains(element)) {
            defilements.current.delete(element);
            continue;
          }
          element.scrollTop = haut;
          element.scrollLeft = gauche;
        }
      }
      return true;
    };
    if (poserDansLaScene()) {
      return undefined;
    }
    // Premier rendu : la scène (parente) reçoit sa référence juste après ses enfants.
    let annule = false;
    queueMicrotask(() => {
      if (!annule) poserDansLaScene();
    });
    return () => {
      annule = true;
    };
  }, [conteneur, scene, testID, placement]);

  return createPortal(<Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>, conteneur);
}
