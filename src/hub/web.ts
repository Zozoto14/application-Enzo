/**
 * Petits accès au navigateur pour le hub, sans que le code natif ait à les
 * connaître : `src` ne charge pas les types du DOM, et `document` n'existe pas
 * sur l'appareil.
 */

import { Platform } from 'react-native';

export function surLeWeb(): boolean {
  return Platform.OS === 'web';
}

interface DocumentMinimal {
  addEventListener(type: 'keydown', rappel: (e: ToucheMinimale) => void): void;
  removeEventListener(type: 'keydown', rappel: (e: ToucheMinimale) => void): void;
}
interface ToucheMinimale {
  key: string;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

function documentCourant(): DocumentMinimal | undefined {
  return (globalThis as { document?: DocumentMinimal }).document;
}

/** Vrai quand la cible est un champ de saisie : Échap y appartient au champ. */
function estChampDeSaisie(cible: unknown): boolean {
  const balise = (cible as { tagName?: string } | null)?.tagName?.toLowerCase();
  return balise === 'input' || balise === 'textarea' || balise === 'select';
}

/**
 * Écoute une touche du clavier (web uniquement). Sans effet ailleurs.
 * Renvoie la fonction qui retire l'écoute.
 */
export function ecouterTouche(touche: string, rappel: () => void, options: { ignorerChamps?: boolean } = {}): () => void {
  const doc = documentCourant();
  if (!doc) {
    return () => undefined;
  }
  const surTouche = (evenement: ToucheMinimale) => {
    if (evenement.key !== touche || evenement.defaultPrevented) {
      return;
    }
    if (options.ignorerChamps && estChampDeSaisie(evenement.target)) {
      return;
    }
    evenement.preventDefault();
    rappel();
  };
  doc.addEventListener('keydown', surTouche);
  return () => doc.removeEventListener('keydown', surTouche);
}

/** Préférence système « réduire les animations ». */
export function mouvementReduit(): boolean {
  const fenetre = globalThis as { matchMedia?: (requete: string) => { matches: boolean } };
  try {
    return Boolean(fenetre.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

interface DocumentTelechargement {
  createElement(balise: 'a'): { href: string; download: string; rel: string; click(): void; remove?(): void };
  body?: { appendChild(n: unknown): void };
}

/**
 * Propose un fichier au téléchargement (web). Faux hors navigateur. Le
 * contenu ne quitte pas l'appareil : c'est une URL locale au document.
 */
export function telechargerWeb(nom: string, contenu: string, type: string): boolean {
  const doc = (globalThis as { document?: DocumentTelechargement }).document;
  const urls = (globalThis as { URL?: { createObjectURL?(b: unknown): string; revokeObjectURL?(u: string): void } }).URL;
  const FabriqueBlob = (globalThis as unknown as { Blob?: new (parts: unknown[], options: { type: string }) => unknown }).Blob;
  if (!doc || !urls?.createObjectURL || !FabriqueBlob) {
    return false;
  }
  const url = urls.createObjectURL(new FabriqueBlob([contenu], { type }));
  const lien = doc.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.rel = 'noopener';
  doc.body?.appendChild(lien);
  lien.click();
  lien.remove?.();
  setTimeout(() => urls.revokeObjectURL?.(url), 1000);
  return true;
}

/**
 * Écoute toute activité de l'utilisateur (clavier, pointeur, défilement) sur
 * le web. Sans effet ailleurs : l'appelant complète par `onTouchStart`.
 */
export function ecouterActivite(rappel: () => void): () => void {
  const doc = (globalThis as { document?: { addEventListener(t: string, r: () => void, o?: unknown): void; removeEventListener(t: string, r: () => void, o?: unknown): void } }).document;
  if (!doc) {
    return () => undefined;
  }
  const types = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  for (const type of types) {
    doc.addEventListener(type, rappel, { capture: true, passive: true });
  }
  return () => {
    for (const type of types) {
      doc.removeEventListener(type, rappel, { capture: true });
    }
  };
}

/**
 * Actualise l'app web : désinscrit un éventuel service worker, vide les
 * caches du site, puis recharge la page depuis le serveur. Faux hors web.
 */
export async function rechargerApp(): Promise<boolean> {
  const g = globalThis as {
    navigator?: { serviceWorker?: { getRegistrations?(): Promise<Array<{ update?(): Promise<unknown>; unregister(): Promise<boolean> }>> } };
    caches?: { keys(): Promise<string[]>; delete(cle: string): Promise<boolean> };
    location?: { reload(): void };
  };
  if (!g.location) {
    return false;
  }
  try {
    const inscriptions = (await g.navigator?.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(inscriptions.map(inscription => inscription.unregister()));
  } catch {
    // Pas de service worker : rien à faire.
  }
  try {
    if (g.caches) {
      const cles = await g.caches.keys();
      await Promise.all(cles.map(cle => g.caches!.delete(cle)));
    }
  } catch {
    // Caches indisponibles (navigation privée…) : le rechargement suffit.
  }
  g.location.reload();
  return true;
}

/** Encodage UTF-8 sans dépendre de `TextEncoder` (absent des types de `src`). */
export function octetsUtf8(texte: string): Uint8Array {
  const octets: number[] = [];
  for (const caractere of texte) {
    const code = caractere.codePointAt(0)!;
    if (code < 0x80) {
      octets.push(code);
    } else if (code < 0x800) {
      octets.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      octets.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      octets.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return Uint8Array.from(octets);
}
