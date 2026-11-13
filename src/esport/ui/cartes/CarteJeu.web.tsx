/**
 * Carte d'un jeu en plateau (web) : le MÊME rendu que l'atelier de strats, dans un simple canevas 2D (sans Konva),
 * pour tout écran qui montre une map : lineups, plans de match, miniatures, aperçus.
 *
 * Minimap à fond transparent : redessinée (sol teinté, liseré, ombre intérieure, `rendreCarte`) ; vue de dessus
 * opaque : gardée, au besoin atténuée. Zones nommées, repères (sites, spawns, cashouts…) et callouts du profil
 * par-dessus. Composition 2D seulement : identique dans Chromium et Safari. Propriétés : voir types.ts.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rendreCarte } from '../../cartes/rendu.web';
import { sourcesImage, type CacheImages } from '../../strats/assets';
import { centre } from '../../strats/geometrie';
import { PLATEAU, alpha, melanger, themeCarte } from '../../strats/plateau';
import { useImageJeu } from '../strats/imagesCanevas.web';
import type { PropsCarteJeu } from './types';

export type { PropsCarteJeu, RepereCarteJeu } from './types';

const T = PLATEAU;
/** Sans cache fourni : l'adresse est donnée telle quelle à l'image (affichage seul, pas d'export). */
const SANS_CACHE: CacheImages = { obtenir: async url => url };

/** Texte à halo sombre, centré. */
function etiquette(ctx: CanvasRenderingContext2D, texte: string, x: number, y: number, taille: number, couleur: string) {
  ctx.font = `700 ${taille}px ${T.police}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, taille * 0.3);
  ctx.strokeStyle = T.halo;
  ctx.strokeText(texte, x, y);
  ctx.fillStyle = couleur;
  ctx.fillText(texte, x, y);
}

export default function CarteJeu({ carte, image, images, taille, themeCarte: idTheme = 'tactique', attenuation = 0, reperes = true, etiquettes, niveau = null, rotation = 0, rayon = 10, filigrane = true, children, testID = 'esport-carte-jeu', accessibilityLabel }: PropsCarteJeu) {
  const hote = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const [mesure, setMesure] = useState(0);
  const cote = Math.max(0, Math.round(taille ?? mesure));
  const sources = image === undefined ? sourcesImage(carte?.minimap) : typeof image === 'string' ? sourcesImage(image) : sourcesImage(image ?? []);
  const img = useImageJeu(sources, images ?? SANS_CACHE);
  const theme = themeCarte(idTheme);

  // Sans taille imposée : la largeur disponible (carte carrée), suivie quand elle change.
  useLayoutEffect(() => {
    if (taille || !hote.current) return undefined;
    const el = hote.current;
    const lire = () => setMesure(Math.round(el.getBoundingClientRect().width));
    lire();
    if (typeof ResizeObserver !== 'function') return undefined;
    const o = new ResizeObserver(lire);
    o.observe(el);
    return () => o.disconnect();
  }, [taille]);

  const avecEtiquettes = etiquettes ?? cote >= 280;
  useEffect(() => {
    const c = toile.current;
    if (!c || cote <= 0) return;
    const densite = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const cotePx = Math.round(cote * densite);
    if (c.width !== cotePx) c.width = cotePx;
    if (c.height !== cotePx) c.height = cotePx;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const k = cotePx / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cotePx, cotePx);
    ctx.fillStyle = melanger(theme.fond, '#000000', theme.vignette * 0.4);
    ctx.fillRect(0, 0, cotePx, cotePx);
    // Repère du document (carré de 1000), retourné pour la défense.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (rotation === 180) {
      ctx.translate(1000, 1000);
      ctx.rotate(Math.PI);
    }
    if (img) {
      try {
        const rendu = rendreCarte(img, { theme: idTheme, attenuation, cote: Math.min(2048, Math.max(256, cotePx)), largeurImage: carte?.largeurImage, hauteurImage: carte?.hauteurImage });
        ctx.drawImage(rendu.canevas, 0, 0, 1000, 1000);
      } catch {
        // Image d'une autre origine (sans cache) : elle ne peut pas être redessinée ; elle s'affiche telle quelle.
        ctx.drawImage(img, 0, 0, 1000, 1000);
      }
    } else if (filigrane && carte?.nom) {
      ctx.save();
      if (rotation === 180) {
        ctx.translate(1000, 1000);
        ctx.rotate(Math.PI);
      }
      ctx.font = `800 64px ${T.police}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = alpha(theme.etiquette, 0.3);
      ctx.fillText(carte.nom.toUpperCase(), 500, 500, 900);
      ctx.restore();
    }
    if (reperes) {
      /** Texte toujours à l'endroit, même map retournée. */
      const droit = (x: number, y: number, dessin: () => void) => {
        ctx.save();
        ctx.translate(x, y);
        if (rotation === 180) ctx.rotate(Math.PI);
        dessin();
        ctx.restore();
      };
      const tailleTexte = Math.max(T.typo.xs, 11 / Math.max(0.2, cote / 1000));
      for (const z of carte?.zones ?? []) {
        if (z.points.length < 6) continue;
        const cz = z.couleur ?? theme.etiquette;
        ctx.beginPath();
        ctx.moveTo(z.points[0], z.points[1]);
        for (let i = 2; i + 1 < z.points.length; i += 2) ctx.lineTo(z.points[i], z.points[i + 1]);
        ctx.closePath();
        ctx.fillStyle = alpha(cz, theme.zone);
        ctx.fill();
        ctx.lineWidth = 1.3 / Math.max(0.4, cote / 1000);
        ctx.strokeStyle = alpha(cz, 0.55);
        ctx.stroke();
        if (avecEtiquettes) {
          const m = centre(z.points);
          droit(m.x, m.y, () => etiquette(ctx, z.nom.toUpperCase(), 0, 0, tailleTexte, z.couleur ? melanger(z.couleur, '#ffffff', 0.55) : theme.etiquette));
        }
      }
      const couleurs = T.reperes as Record<string, string>;
      for (const r of carte?.reperes ?? []) {
        const estompe = niveau !== null && typeof r.niveau === 'number' && r.niveau !== niveau ? 0.35 : 1;
        const nom = r.nom.trim();
        ctx.globalAlpha = estompe;
        if (r.type === 'callout') {
          if (avecEtiquettes) droit(r.x, r.y, () => etiquette(ctx, nom.toUpperCase(), 0, 0, tailleTexte * 0.92, theme.etiquette));
        } else {
          const cr = couleurs[r.type] ?? (r.type.startsWith('spawn') ? couleurs.spawn : couleurs.autre);
          const court = /^[A-Za-z0-9]{1,2}$/.test(nom);
          const lettre = (court ? nom : (/\b([A-Za-z0-9])$/.exec(nom)?.[1] ?? nom[0] ?? '?')).toUpperCase();
          const rr = Math.max(13, 11 / Math.max(0.2, cote / 1000));
          if (r.type === 'site' || r.type === 'plant') {
            ctx.beginPath();
            ctx.arc(r.x, r.y, rr * 2.6, 0, Math.PI * 2);
            ctx.fillStyle = alpha(cr, 0.13);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = T.puce;
          ctx.fill();
          ctx.lineWidth = rr * 0.16;
          ctx.strokeStyle = cr;
          ctx.stroke();
          droit(r.x, r.y, () => {
            ctx.font = `800 ${rr * 1.05}px ${T.police}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = cr;
            ctx.fillText(lettre, 0, rr * 0.06);
          });
        }
        ctx.globalAlpha = 1;
      }
    }
    // Vignettage léger (pas de grille).
    if (theme.vignette > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createRadialGradient(cotePx / 2, cotePx / 2, cotePx * 0.35, cotePx / 2, cotePx / 2, cotePx * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, alpha('#000000', theme.vignette));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cotePx, cotePx);
    }
  }, [img, cote, idTheme, attenuation, reperes, avecEtiquettes, niveau, rotation, filigrane, carte, theme]);

  const px = (u: number) => (u * cote) / 1000;
  return (
    <div
      ref={hote}
      role="img"
      aria-label={accessibilityLabel ?? carte?.nom}
      data-testid={testID}
      data-theme-carte={idTheme}
      data-image={img ? 'oui' : 'non'}
      style={{ position: 'relative', width: taille ?? '100%', height: cote || undefined, aspectRatio: taille ? undefined : '1 / 1', borderRadius: rayon, overflow: 'hidden', background: theme.fond, flexShrink: 0 }}>
      <canvas ref={toile} style={{ position: 'absolute', top: 0, left: 0, width: cote, height: cote, display: 'block' }} />
      {cote > 0 && children ? <div style={{ position: 'absolute', top: 0, left: 0, width: cote, height: cote }}>{typeof children === 'function' ? children({ taille: cote, px }) : children}</div> : null}
    </div>
  );
}
