/**
 * Graphiques de l'application de bureau, en SVG.
 *
 * Écrits à la main plutôt qu'avec une bibliothèque : il en faut six, tous
 * simples, et la présentation — fond noir, pastilles de dernière valeur,
 * survol qui suit la souris — compte autant que le tracé. Une bibliothèque
 * aurait coûté plus à contraindre qu'à remplacer.
 *
 * La géométrie vient de `geometrie.ts` ; ce fichier ne fait que poser les
 * formes et gérer le survol.
 */

import { formateurDiscret } from '../discretion';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePalette } from '../composants';
import { formaterDate } from '../format';
import type { Palette } from '../theme';
import { useMobile } from '../mobile/useMobile';
import {
  arcAnneau,
  cheminAire,
  cheminCourbe,
  cheminLigne,
  echelle,
  graduations,
  indicesEtiquettes,
  graduationsTemps,
  milieuArc,
  moisAnnee,
  plusProche,
  treemap,
} from './geometrie';
import type {
  ProprietesBarres,
  ProprietesDonut,
  ProprietesLignes,
  ProprietesNuage,
  ProprietesRadar,
  ProprietesTreemap,
} from './types';

export type * from './types';

const POLICE = 11;

/** Téléphone : 15 px au minimum partout, y compris dans le dessin. */
const police = (mobile: boolean, taille = POLICE) => (mobile ? Math.max(15, taille) : taille);

/** Téléphone : hauteur réservée au-dessus du graphique pour la valeur touchée. */
const HAUTEUR_LECTURE = 60;

/** Largeur disponible, suivie au redimensionnement de la fenêtre. */
function useLargeur(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setLargeur(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observateur = new ResizeObserver(entrees => {
      const largeurObservee = entrees[0]?.contentRect.width;
      if (largeurObservee !== undefined) {
        setLargeur(Math.floor(largeurObservee));
      }
    });
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  return [ref, largeur];
}

interface Survol {
  x: number;
  y: number;
  lignes: Array<{ couleur?: string; texte: string; fort?: boolean }>;
}

/** Info-bulle posée au-dessus du graphique, retenue dans son cadre. */
function InfoBulle({ survol, largeur, palette }: { survol: Survol | null; largeur: number; palette: Palette }) {
  const mobile = useMobile();
  if (mobile) {
    // Téléphone : pas de survol. La valeur touchée s'affiche dans un cadre fixe au-dessus du graphique.
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="graphique-lecture"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: -HAUTEUR_LECTURE,
          height: HAUTEUR_LECTURE - 8,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
          fontSize: 15,
          lineHeight: '20px',
          color: palette.texte,
        }}>
        {survol ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 12 }}>
            {survol.lignes.map((ligne, index) => (
              <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: ligne.fort ? 700 : 500, color: ligne.fort ? palette.texte : palette.texte }}>
                {ligne.couleur ? <span style={{ width: 10, height: 10, borderRadius: 5, background: ligne.couleur, flexShrink: 0 }} /> : null}
                {ligne.texte}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: palette.texteSecondaire }}>Touchez le graphique pour lire une valeur.</span>
        )}
      </div>
    );
  }
  if (!survol) {
    return null;
  }
  const largeurBulle = 220;
  const gauche = Math.min(Math.max(8, survol.x + 14), Math.max(8, largeur - largeurBulle - 8));
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: gauche,
        top: Math.max(4, survol.y - 12),
        maxWidth: largeurBulle,
        pointerEvents: 'none',
        background: palette.surfaceHaute,
        border: `1px solid ${palette.bordure}`,
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 12,
        lineHeight: '17px',
        color: palette.texte,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        zIndex: 5,
      }}>
      {survol.lignes.map((ligne, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: ligne.fort ? 700 : 400 }}>
          {ligne.couleur ? (
            <span style={{ width: 8, height: 8, borderRadius: 4, background: ligne.couleur, flexShrink: 0 }} />
          ) : null}
          <span>{ligne.texte}</span>
        </div>
      ))}
    </div>
  );
}

function Legende({ elements, palette }: { elements?: readonly { couleur: string; texte: string }[]; palette: Palette }) {
  const mobile = useMobile();
  if (!elements || elements.length === 0) {
    return null;
  }
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: mobile ? 'flex-start' : 'center',
        gap: mobile ? '8px 16px' : '6px 18px',
        marginTop: mobile ? 12 : 8,
        fontSize: mobile ? 15 : 12,
        color: palette.texte,
      }}>
      {elements.map((element, index) => (
        <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, background: element.couleur }} />
          {element.texte}
        </span>
      ))}
    </div>
  );
}

function positionSouris(evenement: React.MouseEvent<Element>): { x: number; y: number } {
  const cadre = (evenement.currentTarget as Element).getBoundingClientRect();
  return { x: evenement.clientX - cadre.left, y: evenement.clientY - cadre.top };
}

/** Écarte des pastilles superposées, en gardant leur ordre vertical. */
function espacer(positions: number[], ecart: number, min: number, max: number): number[] {
  const ordre = positions.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ordre.length; i++) {
    if (ordre[i].y - ordre[i - 1].y < ecart) {
      ordre[i].y = ordre[i - 1].y + ecart;
    }
  }
  const depassement = ordre.length > 0 ? ordre[ordre.length - 1].y - max : 0;
  if (depassement > 0) {
    for (const element of ordre) {
      element.y -= depassement;
    }
  }
  const resultat = [...positions];
  for (const element of ordre) {
    resultat[element.index] = Math.max(min, element.y);
  }
  return resultat;
}

const temps = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// ------------------------------------------------------------------ Lignes

export function GraphiqueLignes({
  series,
  formater,
  hauteur = 300,
  repere,
  marqueurs,
  etiquettesFinales = true,
  legende,
  testID,
}: ProprietesLignes) {
  formater = formateurDiscret(formater);
  const palette = usePalette();
  const mobile = useMobile();
  // Téléphone : courbe de 240 px au plus, valeurs de l'axe DANS le tracé, pas de pastilles de fin.
  if (mobile) {
    hauteur = Math.min(hauteur, 240);
  }
  const identifiant = useId().replace(/:/g, '');
  const [ref, largeur] = useLargeur();
  const [survol, setSurvol] = useState<{ index: number; x: number; y: number } | null>(null);

  const marges = mobile ? { haut: 12, bas: 32, gauche: 8, droite: 8 } : { haut: 12, bas: 26, gauche: 8, droite: 78 };
  const utile = {
    largeur: Math.max(10, largeur - marges.gauche - marges.droite),
    hauteur: Math.max(10, hauteur - marges.haut - marges.bas),
  };

  const calcul = useMemo(() => {
    const visibles = series.filter(serie => serie.points.length > 0);
    const dates = [...new Set(visibles.flatMap(serie => serie.points.map(point => point.date)))].sort();
    if (dates.length === 0) {
      return undefined;
    }
    const valeurs = visibles.flatMap(serie => serie.points.map(point => point.valeur));
    if (repere) {
      valeurs.push(repere.valeur);
    }
    const { valeurs: graduationsY, domaine } = graduations(Math.min(...valeurs), Math.max(...valeurs), mobile ? 4 : 5);
    const x = echelle([temps(dates[0]), temps(dates[dates.length - 1])], [marges.gauche, marges.gauche + utile.largeur]);
    const y = echelle(domaine, [marges.haut + utile.hauteur, marges.haut]);
    const trajets = visibles.map(serie => {
      const points = serie.points.map(point => ({ x: x(temps(point.date)), y: y(point.valeur) }));
      const trace = cheminCourbe(points);
      return {
        serie,
        points,
        trace,
        aire: serie.aire ? cheminAire(trace, points, y(Math.max(domaine[0], Math.min(domaine[1], 0)))) : undefined,
      };
    });
    return { dates, graduationsY, x, y, trajets, abscisses: dates.map(date => x(temps(date))) };
    // Les marges sont constantes ; la largeur et les données suffisent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, repere, utile.largeur, utile.hauteur, mobile]);

  const valeurA = (points: readonly { date: string; valeur: number }[], date: string) => {
    let retenu: number | undefined;
    for (const point of points) {
      if (point.date <= date) {
        retenu = point.valeur;
      }
    }
    return retenu;
  };

  const etiquettes = calcul
    ? espacer(
        calcul.trajets.map(trajet => trajet.points[trajet.points.length - 1]?.y ?? 0),
        20,
        marges.haut,
        marges.haut + utile.hauteur,
      )
    : [];

  const dateSurvolee = survol && calcul ? calcul.dates[survol.index] : undefined;
  // Téléphone : sans doigt posé, la lecture montre la dernière valeur.
  const dateLue = dateSurvolee ?? (mobile && calcul ? calcul.dates[calcul.dates.length - 1] : undefined);

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: mobile ? HAUTEUR_LECTURE : 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 && calcul ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block', overflow: 'visible', touchAction: 'pan-y' }}>
            <defs>
              {calcul.trajets.map((trajet, index) => (
                <linearGradient key={index} id={`aire-${identifiant}-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trajet.serie.couleur} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={trajet.serie.couleur} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            {calcul.graduationsY.map(valeur => (
              <g key={valeur}>
                <line
                  x1={marges.gauche}
                  x2={marges.gauche + utile.largeur}
                  y1={calcul.y(valeur)}
                  y2={calcul.y(valeur)}
                  stroke={palette.bordure}
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text
                  x={mobile ? marges.gauche + 2 : marges.gauche + utile.largeur + 8}
                  y={mobile ? calcul.y(valeur) - 6 : calcul.y(valeur) + 4}
                  fontSize={police(mobile)}
                  fill={palette.texteSecondaire}>
                  {formater(valeur)}
                </text>
              </g>
            ))}

            {graduationsTemps(
              temps(calcul.dates[0]),
              temps(calcul.dates[calcul.dates.length - 1]),
              Math.max(2, Math.floor(utile.largeur / (mobile ? 120 : 95))),
            ).map((instant, index, tous) => (
              <text
                key={instant}
                x={calcul.x(instant)}
                y={hauteur - 7}
                fontSize={police(mobile)}
                fill={palette.texteSecondaire}
                textAnchor={index === 0 ? 'start' : index === tous.length - 1 ? 'end' : 'middle'}>
                {moisAnnee(new Date(instant).toISOString().slice(0, 10))}
              </text>
            ))}

            {repere ? (
              <g>
                <line
                  x1={marges.gauche}
                  x2={marges.gauche + utile.largeur}
                  y1={calcul.y(repere.valeur)}
                  y2={calcul.y(repere.valeur)}
                  stroke={repere.couleur ?? palette.reference}
                  strokeDasharray="5 4"
                  strokeWidth={1.2}
                />
                {repere.libelle ? (
                  <text
                    x={marges.gauche + utile.largeur - 4}
                    y={calcul.y(repere.valeur) - 6}
                    fontSize={police(mobile)}
                    fontWeight={600}
                    textAnchor="end"
                    fill={palette.texte}>
                    {repere.libelle}
                  </text>
                ) : null}
              </g>
            ) : null}

            {calcul.trajets.map((trajet, index) => (
              <g key={trajet.serie.nom}>
                {trajet.aire ? <path d={trajet.aire} fill={`url(#aire-${identifiant}-${index})`} /> : null}
                <path
                  d={trajet.trace}
                  fill="none"
                  stroke={trajet.serie.couleur}
                  strokeWidth={2}
                  strokeDasharray={trajet.serie.pointilles ? '5 4' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}

            {(marqueurs ?? []).map((marqueur, index) => {
              const cx = calcul.x(temps(marqueur.date));
              const cy = calcul.y(marqueur.valeur);
              const couleur = marqueur.type === 'achat' ? palette.hausse : palette.baisse;
              const pointe = marqueur.type === 'achat' ? `${cx},${cy - 12} ${cx - 6},${cy - 2} ${cx + 6},${cy - 2}` : `${cx},${cy + 12} ${cx - 6},${cy + 2} ${cx + 6},${cy + 2}`;
              return <polygon key={index} points={pointe} fill={couleur} />;
            })}

            {dateSurvolee && survol ? (
              <g>
                <line
                  x1={calcul.abscisses[survol.index]}
                  x2={calcul.abscisses[survol.index]}
                  y1={marges.haut}
                  y2={marges.haut + utile.hauteur}
                  stroke={palette.texteSecondaire}
                  strokeDasharray="3 3"
                />
                {calcul.trajets.map(trajet => {
                  const valeur = valeurA(trajet.serie.points, dateSurvolee);
                  return valeur === undefined ? null : (
                    <circle
                      key={trajet.serie.nom}
                      cx={calcul.abscisses[survol.index]}
                      cy={calcul.y(valeur)}
                      r={4}
                      fill={trajet.serie.couleur}
                      stroke={palette.surface}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            ) : null}

            {etiquettesFinales && !mobile
              ? calcul.trajets.map((trajet, index) => {
                  const dernier = trajet.serie.points[trajet.serie.points.length - 1];
                  if (!dernier) {
                    return null;
                  }
                  const texte = formater(dernier.valeur);
                  const largeurPastille = Math.max(40, texte.length * 6.4 + 12);
                  return (
                    <g key={`fin-${trajet.serie.nom}`}>
                      <rect
                        x={marges.gauche + utile.largeur + 2}
                        y={etiquettes[index] - 9}
                        width={largeurPastille}
                        height={18}
                        rx={4}
                        fill={trajet.serie.couleur}
                      />
                      <text
                        x={marges.gauche + utile.largeur + 8}
                        y={etiquettes[index] + 4}
                        fontSize={POLICE}
                        fontWeight={700}
                        fill="#0b0b0c">
                        {texte}
                      </text>
                    </g>
                  );
                })
              : null}

            <rect
              x={marges.gauche}
              y={marges.haut}
              width={utile.largeur}
              height={utile.hauteur}
              fill="transparent"
              onMouseMove={evenement => {
                const position = positionSouris(evenement);
                setSurvol({
                  index: plusProche(calcul.abscisses, position.x + marges.gauche),
                  x: position.x + marges.gauche,
                  y: position.y + marges.haut,
                });
              }}
              onPointerDown={evenement => {
                // Doigt : toucher ou glisser horizontalement lit la valeur (le défilement vertical reste libre).
                if (evenement.pointerType === 'touch') {
                  const position = positionSouris(evenement);
                  setSurvol({
                    index: plusProche(calcul.abscisses, position.x + marges.gauche),
                    x: position.x + marges.gauche,
                    y: position.y + marges.haut,
                  });
                }
              }}
              onPointerMove={evenement => {
                if (evenement.pointerType === 'touch') {
                  const position = positionSouris(evenement);
                  setSurvol({
                    index: plusProche(calcul.abscisses, position.x + marges.gauche),
                    x: position.x + marges.gauche,
                    y: position.y + marges.haut,
                  });
                }
              }}
              onMouseLeave={() => (mobile ? undefined : setSurvol(null))}
            />
          </svg>
        ) : largeur > 0 ? (
          <Vide palette={palette} hauteur={hauteur} />
        ) : null}

        {dateLue && calcul ? (
          <InfoBulle
            largeur={largeur}
            palette={palette}
            survol={{
              x: survol?.x ?? 0,
              y: survol?.y ?? 0,
              lignes: [
                { texte: formaterDate(dateLue), fort: true },
                ...calcul.trajets.flatMap(trajet => {
                  const valeur = valeurA(trajet.serie.points, dateLue);
                  return valeur === undefined
                    ? []
                    : [{ couleur: trajet.serie.couleur, texte: `${trajet.serie.nom} : ${formater(valeur)}` }];
                }),
              ],
            }}
          />
        ) : mobile ? (
          <InfoBulle largeur={largeur} palette={palette} survol={null} />
        ) : null}
      </div>
      <Legende elements={legende} palette={palette} />
    </div>
  );
}

function Vide({ palette, hauteur }: { palette: Palette; hauteur: number }) {
  const mobile = useMobile();
  return (
    <div
      style={{
        height: hauteur,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: palette.texteSecondaire,
        fontSize: mobile ? 15 : 13,
      }}>
      Aucune donnée à afficher
    </div>
  );
}

// ------------------------------------------------------------------- Donut

export function Donut({ parts, formater, hauteur = 280, centre, testID }: ProprietesDonut) {
  formater = formateurDiscret(formater);
  const palette = usePalette();
  const mobile = useMobile();
  if (mobile) {
    hauteur = Math.min(hauteur, 240);
  }
  const [ref, largeur] = useLargeur();
  const [survol, setSurvol] = useState<{ index: number; x: number; y: number } | null>(null);

  const visibles = parts
    .map((part, index) => ({ ...part, couleur: part.couleur ?? palette.series[index % palette.series.length] }))
    .filter(part => part.valeur > 0);
  const total = visibles.reduce((somme, part) => somme + part.valeur, 0);

  const cote = Math.min(hauteur, largeur);
  const cx = largeur / 2;
  const cy = hauteur / 2;
  const rayon = cote / 2 - 16;
  const interieur = rayon * 0.55;

  let angle = 0;
  const secteurs = visibles.map((part, index) => {
    const debut = angle;
    const fin = angle + (part.valeur / total) * Math.PI * 2;
    angle = fin;
    return { part, index, debut, fin, fraction: part.valeur / total };
  });

  const pourcentage = (fraction: number) =>
    `${(fraction * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: mobile ? HAUTEUR_LECTURE : 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 && total > 0 ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
            {secteurs.map(secteur => {
              const actif = survol?.index === secteur.index;
              return (
                <path
                  key={secteur.index}
                  d={arcAnneau(cx, cy, actif ? rayon + 6 : rayon, interieur, secteur.debut, secteur.fin)}
                  fill={secteur.part.couleur}
                  stroke={palette.surface}
                  strokeWidth={secteurs.length > 1 ? 2 : 0}
                  onMouseMove={evenement => {
                    const position = positionSouris(evenement);
                    setSurvol({ index: secteur.index, ...position });
                  }}
                  onMouseLeave={() => setSurvol(null)}
                />
              );
            })}
            {secteurs
              .filter(secteur => secteur.fraction >= (mobile ? 0.09 : 0.05))
              .map(secteur => {
                const milieu = milieuArc(cx, cy, (rayon + interieur) / 2, secteur.debut, secteur.fin);
                return (
                  <text
                    key={`p-${secteur.index}`}
                    x={milieu.x}
                    y={milieu.y + 4}
                    textAnchor="middle"
                    fontSize={police(mobile)}
                    fontWeight={700}
                    fill="#0b0b0c"
                    pointerEvents="none">
                    {pourcentage(secteur.fraction)}
                  </text>
                );
              })}
            {centre ? (
              <text x={cx} y={cy + 5} textAnchor="middle" fontSize={police(mobile, 14)} fontWeight={700} fill={palette.texte}>
                {centre}
              </text>
            ) : null}
          </svg>
        ) : largeur > 0 ? (
          <Vide palette={palette} hauteur={hauteur} />
        ) : null}
        {survol || mobile ? (
          <InfoBulle
            largeur={largeur}
            palette={palette}
            survol={!survol ? null : {
              x: survol.x,
              y: survol.y,
              lignes: [
                { couleur: secteurs[survol.index]?.part.couleur, texte: secteurs[survol.index]?.part.libelle ?? '', fort: true },
                {
                  texte: [formater(secteurs[survol.index]?.part.valeur ?? 0), pourcentage(secteurs[survol.index]?.fraction ?? 0)]
                    .filter(Boolean)
                    .join(' · '),
                },
                ...(secteurs[survol.index]?.part.detail ? [{ texte: secteurs[survol.index].part.detail! }] : []),
              ],
            }}
          />
        ) : null}
      </div>
      <Legende
        palette={palette}
        elements={secteurs.map(secteur => ({
          couleur: secteur.part.couleur,
          texte: `${secteur.part.libelle} · ${pourcentage(secteur.fraction)}`,
        }))}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Barres

export function Barres(brutes: ProprietesBarres) {
  const proprietes = { ...brutes, formater: formateurDiscret(brutes.formater) };
  return proprietes.horizontal ? <BarresHorizontales {...proprietes} /> : <BarresVerticales {...proprietes} />;
}

function BarresVerticales({ barres, formater, hauteur = 260, repere, valeursVisibles, legende, testID }: ProprietesBarres) {
  const palette = usePalette();
  const mobile = useMobile();
  if (mobile) {
    hauteur = Math.min(hauteur, 240);
  }
  const [ref, largeur] = useLargeur();
  const [survol, setSurvol] = useState<{ index: number; x: number; y: number } | null>(null);

  const marges = mobile ? { haut: 16, bas: 32, gauche: 8, droite: 8 } : { haut: 16, bas: 26, gauche: 8, droite: 58 };
  const utileL = Math.max(10, largeur - marges.gauche - marges.droite);
  const utileH = Math.max(10, hauteur - marges.haut - marges.bas);

  const valeurs = barres.flatMap(barre => [barre.valeur, -(barre.negatif ?? 0)]);
  valeurs.push(0);
  if (repere) {
    valeurs.push(repere.valeur);
  }
  const { valeurs: graduationsY, domaine } = graduations(Math.min(...valeurs), Math.max(...valeurs), mobile ? 4 : 5);
  const y = echelle(domaine, [marges.haut + utileH, marges.haut]);
  const bande = barres.length > 0 ? utileL / barres.length : utileL;
  const epaisseur = Math.max(2, Math.min(64, bande * 0.62));
  const zero = y(0);

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: mobile ? HAUTEUR_LECTURE : 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 && barres.length > 0 ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
            {graduationsY.map(valeur => (
              <g key={valeur}>
                <line
                  x1={marges.gauche}
                  x2={marges.gauche + utileL}
                  y1={y(valeur)}
                  y2={y(valeur)}
                  stroke={palette.bordure}
                  opacity={valeur === 0 ? 1 : 0.5}
                />
                <text
                  x={mobile ? marges.gauche + 2 : marges.gauche + utileL + 8}
                  y={mobile ? y(valeur) - 6 : y(valeur) + 4}
                  fontSize={police(mobile)}
                  fill={palette.texteSecondaire}>
                  {formater(valeur)}
                </text>
              </g>
            ))}
            {barres.map((barre, index) => {
              const x = marges.gauche + index * bande + (bande - epaisseur) / 2;
              const haut = y(Math.max(0, barre.valeur));
              const bas = y(Math.min(0, barre.valeur));
              const couleur = barre.couleur ?? (barre.valeur < 0 ? palette.baisse : palette.accent);
              return (
                <g
                  key={index}
                  onMouseMove={evenement => setSurvol({ index, ...positionSouris(evenement) })}
                  onMouseLeave={() => setSurvol(null)}>
                  <rect x={marges.gauche + index * bande} y={marges.haut} width={bande} height={utileH} fill="transparent" />
                  <rect x={x} y={haut} width={epaisseur} height={Math.max(1, bas - haut)} rx={3} fill={couleur} opacity={survol && survol.index !== index ? 0.7 : 1} />
                  {barre.negatif ? (
                    <rect x={x} y={zero} width={epaisseur} height={Math.max(1, y(-barre.negatif) - zero)} rx={3} fill={palette.baisse} />
                  ) : null}
                  {valeursVisibles && barre.valeur !== 0 && (!mobile || bande >= 56) ? (
                    <text
                      x={x + epaisseur / 2}
                      y={bas - haut > 26 ? (haut + bas) / 2 + 4 : haut - 6}
                      textAnchor="middle"
                      fontSize={police(mobile, 10)}
                      fontWeight={600}
                      fill={bas - haut > 26 ? '#ffffff' : palette.texte}>
                      {formater(barre.valeur)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {indicesEtiquettes(barres.length, Math.max(2, Math.floor(utileL / (mobile ? 64 : 44)))).map(index => (
              <text
                key={`l-${index}`}
                x={marges.gauche + index * bande + bande / 2}
                y={hauteur - 7}
                textAnchor="middle"
                fontSize={police(mobile)}
                fill={palette.texteSecondaire}>
                {barres[index].libelle}
              </text>
            ))}
            {repere ? (
              <g pointerEvents="none">
                <line
                  x1={marges.gauche}
                  x2={marges.gauche + utileL}
                  y1={y(repere.valeur)}
                  y2={y(repere.valeur)}
                  stroke={repere.couleur ?? palette.reference}
                  strokeDasharray="5 4"
                />
                {repere.libelle ? (
                  <text x={marges.gauche + utileL - 4} y={y(repere.valeur) - 6} textAnchor="end" fontSize={police(mobile)} fontWeight={600} fill={palette.texte}>
                    {repere.libelle}
                  </text>
                ) : null}
              </g>
            ) : null}
          </svg>
        ) : largeur > 0 ? (
          <Vide palette={palette} hauteur={hauteur} />
        ) : null}
        {(survol && barres[survol.index]) || mobile ? (
          <InfoBulle
            largeur={largeur}
            palette={palette}
            survol={!survol || !barres[survol.index] ? null : {
              x: survol.x,
              y: survol.y,
              lignes: [
                { texte: barres[survol.index].libelle, fort: true },
                { couleur: barres[survol.index].couleur ?? palette.accent, texte: formater(barres[survol.index].valeur) },
                ...(barres[survol.index].negatif
                  ? [{ couleur: palette.baisse, texte: `-${formater(barres[survol.index].negatif!)}` }]
                  : []),
                ...(barres[survol.index].detail ? [{ texte: barres[survol.index].detail! }] : []),
              ],
            }}
          />
        ) : null}
      </div>
      <Legende elements={legende} palette={palette} />
    </div>
  );
}

function BarresHorizontales({ barres, formater, repere, legende, testID }: ProprietesBarres) {
  const palette = usePalette();
  const mobile = useMobile();
  const [ref, largeur] = useLargeur();
  // Téléphone : le libellé et la valeur se lisent sur une ligne, la barre dessous (rien n'est tronqué).
  const hauteurLigne = mobile ? 52 : 28;
  const hauteur = barres.length * hauteurLigne + 8;
  const gauche = mobile ? 4 : Math.min(170, Math.max(90, largeur * 0.32));
  const droite = mobile ? 4 : 84;
  const utile = Math.max(10, largeur - gauche - droite);

  const valeurs = barres.map(barre => barre.valeur);
  valeurs.push(0);
  if (repere) {
    valeurs.push(repere.valeur);
  }
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const x = echelle([min, max], [gauche, gauche + utile]);

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
            {barres.map((barre, index) => {
              const yLigne = 4 + index * hauteurLigne;
              const debut = x(Math.min(0, barre.valeur));
              const fin = x(Math.max(0, barre.valeur));
              if (mobile) {
                return (
                  <g key={index}>
                    <text x={gauche} y={yLigne + 17} fontSize={15} fill={palette.texteSecondaire}>
                      {barre.libelle.length > 24 ? `${barre.libelle.slice(0, 23)}…` : barre.libelle}
                    </text>
                    <text x={gauche + utile} y={yLigne + 17} textAnchor="end" fontSize={15} fontWeight={700} fill={palette.texte}>
                      {formater(barre.valeur)}
                    </text>
                    <rect x={debut} y={yLigne + 26} width={Math.max(2, fin - debut)} height={12} rx={4} fill={barre.couleur ?? palette.accent} />
                  </g>
                );
              }
              return (
                <g key={index}>
                  <text x={gauche - 8} y={yLigne + 17} textAnchor="end" fontSize={11} fill={palette.texteSecondaire}>
                    {barre.libelle.length > 28 ? `${barre.libelle.slice(0, 27)}…` : barre.libelle}
                  </text>
                  <rect x={debut} y={yLigne + 5} width={Math.max(2, fin - debut)} height={hauteurLigne - 10} rx={3} fill={barre.couleur ?? palette.accent} />
                  <text x={fin + 6} y={yLigne + 17} fontSize={11} fontWeight={600} fill={palette.texte}>
                    {formater(barre.valeur)}
                  </text>
                </g>
              );
            })}
            {repere ? (
              <line x1={x(repere.valeur)} x2={x(repere.valeur)} y1={0} y2={hauteur} stroke={repere.couleur ?? palette.texte} strokeWidth={1.5} />
            ) : null}
          </svg>
        ) : null}
      </div>
      <Legende elements={legende} palette={palette} />
    </div>
  );
}

// ------------------------------------------------------------------- Nuage

export function Nuage({ points, lignes, formaterX, formaterY, hauteur = 300, legende, testID }: ProprietesNuage) {
  const palette = usePalette();
  const mobile = useMobile();
  if (mobile) {
    hauteur = Math.min(hauteur, 280);
  }
  const [ref, largeur] = useLargeur();
  const [survol, setSurvol] = useState<{ index: number; x: number; y: number } | null>(null);

  const marges = mobile ? { haut: 12, bas: 32, gauche: 64, droite: 16 } : { haut: 12, bas: 26, gauche: 48, droite: 20 };
  const utileL = Math.max(10, largeur - marges.gauche - marges.droite);
  const utileH = Math.max(10, hauteur - marges.haut - marges.bas);

  const tous = [...points, ...(lignes ?? []).flatMap(ligne => ligne.points)];
  const gx = graduations(Math.min(...tous.map(p => p.x), 0), Math.max(...tous.map(p => p.x)), mobile ? 3 : 6);
  const gy = graduations(Math.min(...tous.map(p => p.y)), Math.max(...tous.map(p => p.y)), mobile ? 4 : 6);
  const x = echelle(gx.domaine, [marges.gauche, marges.gauche + utileL]);
  const y = echelle(gy.domaine, [marges.haut + utileH, marges.haut]);

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: mobile ? HAUTEUR_LECTURE : 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 && tous.length > 0 ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
            {gy.valeurs.map(valeur => (
              <g key={`y${valeur}`}>
                <line x1={marges.gauche} x2={marges.gauche + utileL} y1={y(valeur)} y2={y(valeur)} stroke={palette.bordure} opacity={0.5} />
                <text x={marges.gauche - 8} y={y(valeur) + 4} textAnchor="end" fontSize={police(mobile)} fill={palette.texteSecondaire}>
                  {formaterY(valeur)}
                </text>
              </g>
            ))}
            {gx.valeurs.map(valeur => (
              <text key={`x${valeur}`} x={x(valeur)} y={hauteur - 7} textAnchor="middle" fontSize={police(mobile)} fill={palette.texteSecondaire}>
                {formaterX(valeur)}
              </text>
            ))}
            {(lignes ?? []).map((ligne, index) => (
              <path
                key={`l${index}`}
                d={cheminLigne(ligne.points.map(point => ({ x: x(point.x), y: y(point.y) })))}
                fill="none"
                stroke={ligne.couleur}
                strokeWidth={1.6}
                strokeDasharray={ligne.pointilles ? '4 4' : undefined}
              />
            ))}
            {points.map((point, index) => {
              const cx = x(point.x);
              const cy = y(point.y);
              const forme =
                point.forme === 'triangle' ? (
                  <polygon points={`${cx},${cy - 7} ${cx - 7},${cy + 6} ${cx + 7},${cy + 6}`} fill={point.couleur} />
                ) : point.forme === 'losange' ? (
                  <polygon points={`${cx},${cy - 7} ${cx + 7},${cy} ${cx},${cy + 7} ${cx - 7},${cy}`} fill={point.couleur} />
                ) : (
                  <circle cx={cx} cy={cy} r={6} fill={point.couleur} stroke={palette.surface} strokeWidth={1.5} />
                );
              return (
                <g
                  key={index}
                  onMouseMove={evenement => setSurvol({ index, ...positionSouris(evenement) })}
                  onMouseLeave={() => setSurvol(null)}>
                  <circle cx={cx} cy={cy} r={12} fill="transparent" />
                  {forme}
                  {point.libelle ? (
                    <text
                      x={cx + 10}
                      y={point.forme === 'losange' ? cy + 18 : cy - 8}
                      fontSize={police(mobile, 10)}
                      fontWeight={700}
                      fill={palette.texte}>
                      {point.libelle}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : largeur > 0 ? (
          <Vide palette={palette} hauteur={hauteur} />
        ) : null}
        {(survol && points[survol.index]) || mobile ? (
          <InfoBulle
            largeur={largeur}
            palette={palette}
            survol={!survol || !points[survol.index] ? null : {
              x: survol.x,
              y: survol.y,
              lignes: [
                { couleur: points[survol.index].couleur, texte: points[survol.index].libelle ?? '', fort: true },
                ...(points[survol.index].detail ?? `${formaterX(points[survol.index].x)} · ${formaterY(points[survol.index].y)}`)
                  .split('\n')
                  .map(texte => ({ texte })),
              ],
            }}
          />
        ) : null}
      </div>
      <Legende elements={legende} palette={palette} />
    </div>
  );
}

// ----------------------------------------------------------------- Treemap

export function Treemap({ tuiles, hauteur = 320, testID }: ProprietesTreemap) {
  const palette = usePalette();
  const mobile = useMobile();
  if (mobile) {
    hauteur = Math.min(hauteur, 300);
  }
  const [ref, largeur] = useLargeur();
  const [survol, setSurvol] = useState<{ index: number; x: number; y: number } | null>(null);

  const rectangles = treemap(tuiles, { x: 0, y: 0, largeur, hauteur });

  return (
    <div data-testid={testID} style={{ width: '100%', paddingTop: mobile ? HAUTEUR_LECTURE : 0 }}>
      <div ref={ref} style={{ position: 'relative', width: '100%', height: hauteur }}>
        {largeur > 0 && tuiles.length > 0 ? (
          <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
            {rectangles.map((rectangle, index) => {
              if (rectangle.largeur <= 0 || rectangle.hauteur <= 0) {
                return null;
              }
              const tuile = tuiles[index];
              const pas = mobile ? 20 : 16;
              const assez = mobile ? rectangle.largeur > 92 && rectangle.hauteur > 36 : rectangle.largeur > 64 && rectangle.hauteur > 34;
              const lignes = [tuile.libelle, ...(tuile.lignes ?? [])].slice(
                0,
                Math.max(1, Math.floor((rectangle.hauteur - 8) / pas)),
              );
              return (
                <g
                  key={index}
                  onMouseMove={evenement => setSurvol({ index, ...positionSouris(evenement) })}
                  onMouseLeave={() => setSurvol(null)}>
                  <rect
                    x={rectangle.x + 1}
                    y={rectangle.y + 1}
                    width={Math.max(0, rectangle.largeur - 2)}
                    height={Math.max(0, rectangle.hauteur - 2)}
                    rx={4}
                    fill={tuile.couleur}
                    opacity={survol && survol.index !== index ? 0.8 : 1}
                  />
                  {assez
                    ? lignes.map((ligne, rang) => (
                        <text
                          key={rang}
                          x={rectangle.x + rectangle.largeur / 2}
                          y={rectangle.y + rectangle.hauteur / 2 - ((lignes.length - 1) * pas) / 2 + rang * pas + 4}
                          textAnchor="middle"
                          fontSize={police(mobile, rang === 0 ? 12 : 11)}
                          fontWeight={rang === 0 ? 700 : 500}
                          fill="#ffffff">
                          {ligne}
                        </text>
                      ))
                    : null}
                </g>
              );
            })}
          </svg>
        ) : largeur > 0 ? (
          <Vide palette={palette} hauteur={hauteur} />
        ) : null}
        {(survol && tuiles[survol.index]) || mobile ? (
          <InfoBulle
            largeur={largeur}
            palette={palette}
            survol={!survol || !tuiles[survol.index] ? null : {
              x: survol.x,
              y: survol.y,
              lignes: [
                { couleur: tuiles[survol.index].couleur, texte: tuiles[survol.index].libelle, fort: true },
                ...(tuiles[survol.index].lignes ?? []).map(texte => ({ texte })),
              ],
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Radar

export function Radar({ axes, couleur, hauteur = 260, testID }: ProprietesRadar) {
  const palette = usePalette();
  const mobile = useMobile();
  const [ref, largeur] = useLargeur();
  const cx = largeur / 2;
  const cy = hauteur / 2;
  const rayon = Math.max(10, Math.min(largeur, hauteur) / 2 - (mobile ? 52 : 36));

  const sommet = (index: number, fraction: number) => {
    const angle = (index / axes.length) * Math.PI * 2;
    return { x: cx + rayon * fraction * Math.sin(angle), y: cy - rayon * fraction * Math.cos(angle) };
  };
  const polygone = (fraction: (index: number) => number) =>
    axes.map((_, index) => {
      const point = sommet(index, fraction(index));
      return `${point.x},${point.y}`;
    }).join(' ');

  return (
    <div data-testid={testID} ref={ref} style={{ width: '100%', height: hauteur }}>
      {largeur > 0 && axes.length >= 3 ? (
        <svg width={largeur} height={hauteur} style={{ display: 'block' }}>
          {[0.25, 0.5, 0.75, 1].map(niveau => (
            <polygon key={niveau} points={polygone(() => niveau)} fill="none" stroke={palette.bordure} />
          ))}
          {axes.map((axe, index) => {
            const bout = sommet(index, 1);
            const etiquette = sommet(index, 1.18);
            return (
              <g key={axe.libelle}>
                <line x1={cx} y1={cy} x2={bout.x} y2={bout.y} stroke={palette.bordure} />
                <text x={etiquette.x} y={etiquette.y + 4} textAnchor="middle" fontSize={police(mobile, 10)} fill={palette.texteSecondaire}>
                  {axe.libelle}
                </text>
              </g>
            );
          })}
          <polygon
            points={polygone(index => Math.max(0, Math.min(1, axes[index].valeur)))}
            fill={couleur}
            fillOpacity={0.25}
            stroke={couleur}
            strokeWidth={2}
          />
        </svg>
      ) : null}
    </div>
  );
}
