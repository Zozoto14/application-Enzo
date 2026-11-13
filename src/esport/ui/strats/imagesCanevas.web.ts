/**
 * Images du jeu sur le canevas Konva de l'éditeur de strats (web) : première source qui charge parmi celles données
 * dans l'ordre (voir imagesJeu.ts), décodée en élément image ; mémoire des images décodées pour qu'un pion posé
 * affiche aussitôt le portrait déjà montré par le fantôme ou la barre.
 */

import { useEffect, useState } from 'react';
import type { CacheImages } from '../../strats/assets';
import { listeSources, type SourcesImage } from './imagesJeu';

/** Images déjà décodées, par adresse d'origine : un pion posé avec un portrait déjà vu (barre, fantôme) l'affiche aussitôt. */
const pretes = new Map<string, HTMLImageElement>();
const MAX_PRETES = 300;

function decoder(src: string): Promise<HTMLImageElement | null> {
  return new Promise(ok => {
    const Img = (globalThis as { Image?: new () => { onload: (() => void) | null; onerror: (() => void) | null; src: string } }).Image;
    if (!Img) return ok(null);
    const i = new Img();
    i.onload = () => ok(i as unknown as HTMLImageElement);
    i.onerror = () => ok(null);
    i.src = src;
  });
}

/**
 * Image (élément décodé, pour Konva) de la première source qui charge ; undefined tant que rien n'a chargé ou si
 * toutes échouent (repli). Les images passent par le cache (`fetch` puis blob: local) : le canevas n'est jamais
 * « contaminé » et l'export PNG reste possible.
 */
export function useImageJeu(sources: SourcesImage, images: CacheImages): HTMLImageElement | undefined {
  const toutes = listeSources(sources);
  const cle = toutes.join('\n');
  const deja = () => toutes.map(u => pretes.get(u)).find(Boolean);
  const [img, setImg] = useState<{ cle: string; img: HTMLImageElement | undefined }>(() => ({ cle, img: deja() }));
  useEffect(() => {
    let vivant = true;
    const urls = cle ? cle.split('\n') : [];
    const immediate = urls.map(u => pretes.get(u)).find(Boolean);
    setImg({ cle, img: immediate });
    if (immediate && pretes.get(urls[0]) === immediate) return undefined;
    void (async () => {
      for (const url of urls) {
        const src = await images.obtenir(url);
        if (!vivant) return;
        if (!src) continue;
        const i = await decoder(src);
        if (!vivant) return;
        if (!i) continue;
        if (pretes.size >= MAX_PRETES) pretes.delete(pretes.keys().next().value as string);
        pretes.set(url, i);
        setImg({ cle, img: i });
        return;
      }
    })();
    return () => {
      vivant = false;
    };
  }, [cle, images]);
  return img.cle === cle ? img.img : deja();
}

/** Pour les tests : oublie les images décodées. */
export function oublierImagesJeu(): void {
  pretes.clear();
}
