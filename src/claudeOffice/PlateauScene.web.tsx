/**
 * Claude Office (v4), onglet « Bureau » : le PLATEAU de la scène sur le web
 * (site, iPad, iPhone, PC). La scène devient l'élément principal :
 *
 * - pleine largeur, hauteur disponible ; « Plein écran » (API Fullscreen quand
 *   elle existe, sinon mode immersif qui recouvre l'en-tête du hub) et
 *   « Écran d'ambiance » (plein écran sans interface, pour un 2e écran) ;
 * - caméra : molette et glisser à la souris, pincer et glisser au doigt,
 *   boutons + / − / « Recentrer », double-clic ou double-tap sur une zone pour
 *   la cadrer ; limites, inertie légère ; « réduire les animations » respecté
 *   (pas d'inertie ni de transition) ;
 * - presque aucun texte permanent : les détails viennent au SURVOL (souris,
 *   focus clavier) dans une carte qui ne sort jamais de l'écran ; au TOUCHER,
 *   premier tap = aperçu, second tap (ou bouton) = panneau Détail, tap ailleurs
 *   = ferme ; Échap ferme ;
 * - « Suivre cet agent » (caméra), mini-carte repliable, relecture de la
 *   journée (curseur temporel en bas).
 *
 * La caméra ne fait pas de nouveau rendu React : elle règle le viewBox du SVG
 * et la transformée du calque des cibles. Logique pure : logiqueCamera.ts.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeHub } from '../hub/themes';
import {
  borner, cadrer, contenir, deplacer, douceur, echelleSuivi, facteurMolette, hauteurPlateau, inertie, interpoler, placerCarte, rectZone,
  suivre, versEcran, vitesseLacher, vueInitiale, vueVisible, zoomerEn, type Camera, type Taille,
} from './logiqueCamera';
import { ilYA, LIBELLES_ETAT, phraseAgent, resumerTexte, type Agent } from './logiqueBureau';
import { heureRelecture, VITESSES_RELECTURE } from './logiqueRelecture';
import { activiteAgent, HAUTEUR_SCENE, iso, LARGEUR_SCENE, LIBELLES_ACTIVITE, RECTS_ZONES, TEINTES_ACTIVITE, type Point } from './logiqueScene';
import type { CommandesRelecture, PropsPlateau } from './plateauTypes';
import { SceneOpenSpace } from './SceneOpenSpace.web';
import type { CiblesScene, PositionPerso } from './sceneTypes';
import { compterParParent, sousAgentsVisibles, type SousAgent } from './sousAgentsScene';
import { apparenceAgent } from './equipe';
import { agentVoisin, ecouterOffice } from './raccourcis';
import { ORDRE_ZONES, ZONES, type Zone } from './zones';

/** Teinte d'état assez contrastée pour du texte sur la surface du thème. */
function lisible(hex: string, sombre: boolean): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (v: number) => Math.round(sombre ? v + (255 - v) * 0.3 : v * 0.6);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => canal(v).toString(16).padStart(2, '0')).join('')}`;
}

export const teinteAgent = (a: Agent): string => (a.fige ? '#8E95A8' : a.etat === 'attend' ? TEINTES_ACTIVITE.attend : a.salle ? ZONES.salle.teinte : TEINTES_ACTIVITE[activiteAgent(a)]);

export const libelleEtat = (a: Agent): string => (a.salle ? 'Terminé · à voir' : a.fige ? `${LIBELLES_ETAT[a.etat]} (figé)` : a.etat === 'outil' ? LIBELLES_ACTIVITE[activiteAgent(a)] : LIBELLES_ETAT[a.etat]);

/** Nom d'un agent dans la scène : « Surnom (projet) » si l'Équipe lui en a donné un, sinon le projet. */
export const nomScene = (a: Pick<Agent, 'projet' | 'session'> | undefined): string => {
  const projet = a?.projet ?? 'Projet inconnu';
  const surnom = a ? apparenceAgent(a.projet, a.session).surnom : undefined;
  return surnom ? `${surnom} (${projet})` : projet;
};

export const libelleCible = (a: Agent, maintenant: number): string =>
  `${nomScene(a)}, ${ZONES[a.zone].nom} : ${phraseAgent(a, maintenant)}. Entrée : ouvrir le détail`;

// ------------------------------------------------------------------ cartes

export type Apercu = { genre: 'agent'; cle: string; epingle: boolean } | { genre: 'sous'; id: string; epingle: boolean } | { genre: 'zone'; zone: Zone; point: Point; epingle: boolean };

/** Clé (positions, survol, aria-describedby) d'un aperçu de personnage : l'agent, ou « sa:<id> » pour un sous-agent. */
const clePerso = (a: Apercu | undefined): string | undefined => (a?.genre === 'agent' ? a.cle : a?.genre === 'sous' ? `sa:${a.id}` : undefined);

/** Carte d'un sous-agent : de qui il dépend, ce qu'il fait, son type, depuis quand. */
export function CarteSousAgent({ sa, parent, maintenant, idDescription, onDetail }: { sa: SousAgent; parent?: Agent; maintenant: number; idDescription: string; onDetail(): void }) {
  const fini = sa.etat !== 'en-cours';
  return (
    <>
      <div className="co-carte-tete">
        <span className="co-point" style={{ background: TEINTES_ACTIVITE.agent }} aria-hidden="true" />
        <strong className="co-carte-titre">{`Sous-agent de ${nomScene(parent)}`}</strong>
      </div>
      <div id={idDescription} className="co-carte-corps">
        <div className="co-carte-demande">{sa.description ? `« ${resumerTexte(sa.description, 110)} »` : 'Tâche déléguée'}</div>
        <div className="co-attenue">{[sa.type ?? 'sous-agent', sa.modele].filter(Boolean).join(' · ')}</div>
        <div data-testid="scene-carte-sous-etat">{fini ? `${sa.etat === 'echec' ? 'Échec' : 'Terminé'} ${sa.fin ? ilYA(sa.fin, maintenant) : ''} : il rend son travail` : (ilYA(sa.debut, maintenant) === 'à l’instant' ? 'Vient de démarrer' : `En cours depuis ${ilYA(sa.debut, maintenant).replace('il y a ', '')}`)}</div>
      </div>
      <div className="co-carte-actions">
        <button type="button" className="co-btn co-btn-plein" onClick={onDetail} data-testid="scene-carte-detail">Détail du parent</button>
      </div>
    </>
  );
}

/** Carte d'aperçu d'un agent : projet, état, depuis quand, dernière demande, outil en cours. */
export function CarteAgent({ a, maintenant, theme, idDescription, suivi, onDetail, onSuivre, sousAgentsEnCours = 0 }: {
  a: Agent; maintenant: number; theme: ThemeHub; idDescription: string; suivi: boolean; onDetail(): void; onSuivre(): void; sousAgentsEnCours?: number;
}) {
  const teinte = teinteAgent(a);
  const surnom = apparenceAgent(a.projet, a.session).surnom;
  const demande = resumerTexte(a.demande, 120);
  const outil = a.outil && (a.etat === 'outil' || a.etat === 'ecrit') ? `${a.outil}${a.resumeOutil ? ` · ${resumerTexte(a.resumeOutil, 60)}` : ''}` : undefined;
  return (
    <>
      <div className="co-carte-tete">
        <span className="co-point" style={{ background: teinte }} aria-hidden="true" />
        {surnom ? <strong className="co-carte-titre" data-testid="scene-carte-surnom">{surnom}</strong> : null}
        <strong className={surnom ? 'co-attenue' : 'co-carte-titre'}>{a.projet ?? 'Projet inconnu'}</strong>
        {a.appareil ? <span className="co-attenue">{a.appareil}</span> : null}
      </div>
      <div id={idDescription} className="co-carte-corps">
        <div style={{ color: lisible(teinte, theme.sombre), fontWeight: 700 }} data-testid="scene-carte-etat">{`${libelleEtat(a)} · ${ZONES[a.zone].nom}`}</div>
        <div className="co-attenue">{`Dernière activité ${ilYA(a.dernier, maintenant)} · session ouverte ${ilYA(a.debut, maintenant)}`}</div>
        {a.etat === 'attend' && a.attente ? <div className="co-alerte">{a.attente}</div> : null}
        {a.salle && a.fin !== undefined ? <div>{`Terminé ${ilYA(a.fin, maintenant)}`}</div> : null}
        {outil ? <div>{`Outil : ${outil}`}</div> : null}
        {sousAgentsEnCours ? <div data-testid="scene-carte-sous-agents">{`✦ ${sousAgentsEnCours} sous-agent${sousAgentsEnCours > 1 ? 's' : ''} en cours`}</div> : null}
        {demande ? <div className="co-carte-demande">{`« ${demande} »`}</div> : <div className="co-attenue">Pas encore de demande</div>}
      </div>
      <div className="co-carte-actions">
        <button type="button" className="co-btn co-btn-plein" onClick={onDetail} data-testid="scene-carte-detail">Voir le détail</button>
        <button type="button" className="co-btn" onClick={onSuivre} aria-pressed={suivi} data-testid="scene-carte-suivre">{suivi ? 'Ne plus suivre' : 'Suivre cet agent'}</button>
      </div>
    </>
  );
}

/** Carte d'une zone : nom, nombre d'agents, à quoi elle sert ; au guichet et en salle d'attente, qui attend. */
export function CarteZone({ zone, agents, idDescription, onZoomer }: { zone: Zone; agents: readonly Agent[]; idDescription: string; onZoomer(): void }) {
  const info = ZONES[zone];
  const ici = agents.filter(a => a.zone === zone);
  const qui = ici.map(a => a.projet ?? 'Projet inconnu');
  return (
    <>
      <div className="co-carte-tete">
        <span className="co-point" style={{ background: info.teinte }} aria-hidden="true" />
        <strong className="co-carte-titre">{info.nom}</strong>
        <span className="co-attenue" data-testid="scene-carte-nombre">{ici.length ? `${ici.length} agent${ici.length > 1 ? 's' : ''}` : 'personne'}</span>
      </div>
      <div id={idDescription} className="co-carte-corps">
        <div className="co-attenue">{`On y ${info.role}.`}</div>
        {(zone === 'guichet' || zone === 'salle') && qui.length ? <div data-testid="scene-carte-qui">{`${zone === 'guichet' ? 'Attendent ta réponse' : 'À voir'} : ${qui.join(', ')}`}</div> : null}
        {zone !== 'guichet' && zone !== 'salle' && qui.length ? <div>{qui.join(', ')}</div> : null}
      </div>
      <div className="co-carte-actions">
        <button type="button" className="co-btn" onClick={onZoomer} data-testid="scene-carte-zoomer">Zoomer sur la zone</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ relecture

function BarreRelecture({ c, theme }: { c: CommandesRelecture; theme: ThemeHub }) {
  const { r } = c;
  const max = Math.max(1, ...c.densite);
  const pct = ((r.t - r.debut) / Math.max(1, r.fin - r.debut)) * 100;
  return (
    <div className="co-relecture" data-testid="scene-relecture" role="group" aria-label="Relecture de la journée">
      <button type="button" className="co-btn co-btn-plein" onClick={() => c.onLecture(!r.lecture)} aria-label={r.lecture ? 'Pause' : 'Lecture'} data-testid="scene-relecture-lecture">{r.lecture ? '❚❚' : '▶︎'}</button>
      <div className="co-segments" role="radiogroup" aria-label="Vitesse">
        {VITESSES_RELECTURE.map(v => (
          <button key={v} type="button" role="radio" aria-checked={r.vitesse === v} className={`co-btn${r.vitesse === v ? ' co-btn-actif' : ''}`} onClick={() => c.onVitesse(v)} data-testid={`scene-relecture-x${v}`}>{`×${v}`}</button>
        ))}
      </div>
      <span className="co-heure" data-testid="scene-relecture-heure" aria-live="off">{heureRelecture(r.t)}</span>
      <div className="co-piste">
        <div className="co-densite" aria-hidden="true">
          {c.densite.map((n, k) => <span key={k} style={{ height: `${Math.round((n / max) * 100)}%`, background: k / c.densite.length * 100 <= pct ? theme.accent : theme.attenue }} />)}
        </div>
        <input
          type="range"
          min={r.debut}
          max={r.fin}
          step={1000}
          value={Math.round(r.t)}
          onChange={e => c.onAller(Number(e.currentTarget.value))}
          aria-label="Instant rejoué"
          aria-valuetext={heureRelecture(r.t)}
          data-testid="scene-relecture-curseur"
        />
      </div>
      <button type="button" className="co-btn" onClick={c.onQuitter} data-testid="scene-relecture-quitter">Direct</button>
    </div>
  );
}

// ------------------------------------------------------------------ mini-carte

const POINTS_PIECE = [iso(0, 0), iso(20, 0), iso(20, 14), iso(0, 14)].map(p => `${p.x},${p.y}`).join(' ');
const polygoneZone = (z: Zone) => {
  const r = RECTS_ZONES[z];
  return [iso(r.x0, r.y0), iso(r.x1, r.y0), iso(r.x1, r.y1), iso(r.x0, r.y1)].map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
};

function MiniCarte({ agents, positions, theme, refCadre, onAller, tic }: {
  agents: readonly Agent[]; positions: Map<string, PositionPerso>; theme: ThemeHub; refCadre: React.Ref<SVGRectElement>; onAller(p: Point, fin: boolean): void; tic: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const versPoint = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * LARGEUR_SCENE, y: ((e.clientY - r.top) / r.height) * HAUTEUR_SCENE };
  };
  return (
    <svg
      ref={ref}
      className="co-minicarte"
      viewBox={`0 0 ${LARGEUR_SCENE} ${HAUTEUR_SCENE}`}
      data-testid="scene-minicarte"
      data-tic={tic}
      role="img"
      aria-label="Mini-carte de l’open space : touche ou glisse pour y déplacer la vue"
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); onAller(versPoint(e), false); }}
      onPointerMove={e => { if (e.buttons) onAller(versPoint(e), false); }}
      onPointerUp={e => onAller(versPoint(e), true)}
    >
      <polygon points={POINTS_PIECE} fill={theme.sombre ? '#2A2F45' : '#E9DFCF'} />
      {ORDRE_ZONES.map(z => <polygon key={z} points={polygoneZone(z)} fill={ZONES[z].teinte} opacity={0.45} />)}
      {agents.map(a => {
        const p = positions.get(a.cle);
        return p ? <circle key={a.cle} cx={p.x} cy={p.y - 20} r={20} fill={teinteAgent(a)} stroke="#FFFFFF" strokeWidth={5} /> : null;
      })}
      <rect ref={refCadre} x={0} y={0} width={LARGEUR_SCENE} height={HAUTEUR_SCENE} fill={theme.accent} fillOpacity={0.1} stroke={theme.accent} strokeWidth={10} rx={12} />
    </svg>
  );
}

// ------------------------------------------------------------------ feuille de style

const CSS_PLATEAU = `
.co-plateau{position:relative;overflow:hidden;border-radius:18px;border:1px solid var(--co-ligne);background:var(--co-fond-plateau);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;color:var(--co-texte);-webkit-user-select:none;user-select:none}
.co-plateau.co-immersif{position:fixed;inset:0;z-index:900;border-radius:0;border:0;height:100%!important;width:100%!important}
.co-vue{position:absolute;inset:0;touch-action:none;cursor:grab;outline:none}
.co-vue.co-glisse{cursor:grabbing}
.co-ctl{position:absolute;display:flex;gap:8px;align-items:center;z-index:2}
.co-hd{top:10px;right:10px}.co-hg{top:10px;left:10px;flex-wrap:wrap;max-width:calc(100% - 260px)}.co-bd{right:10px;bottom:10px}.co-bg{left:10px;bottom:10px;align-items:flex-end}
.co-avec-relecture .co-bd,.co-avec-relecture .co-bg{bottom:76px}
.co-btn{min-width:44px;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--co-ligne);background:var(--co-surface);color:var(--co-texte);font:600 15px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.co-btn:hover{border-color:var(--co-accent)}
.co-btn:focus-visible{outline:3px solid var(--co-accent);outline-offset:2px}
.co-btn-plein,.co-btn-actif{background:var(--co-accent);border-color:var(--co-accent);color:var(--co-sur-accent)}
.co-ico{width:44px;padding:0;font-size:19px}
.co-ctl .co-btn{opacity:.9}.co-ctl .co-btn:hover,.co-ctl .co-btn:focus-visible{opacity:1}
.co-puce{min-height:44px;padding:0 14px;border-radius:999px;display:inline-flex;align-items:center;gap:8px;background:var(--co-surface);border:1px solid var(--co-ligne);font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.co-carte{position:absolute;z-index:5;width:min(330px,calc(100% - 16px));box-sizing:border-box;padding:12px 14px;border-radius:16px;background:var(--co-surface);color:var(--co-texte);border:1px solid var(--co-ligne);box-shadow:0 12px 32px rgba(0,0,0,.28);line-height:1.4;animation:co-carte .14s ease-out;-webkit-user-select:text;user-select:text}
@keyframes co-carte{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.co-carte-tete{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.co-carte-titre{font-size:17px}
.co-carte-corps{display:flex;flex-direction:column;gap:3px}
.co-carte-demande{font-style:italic}
.co-carte-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.co-point{width:12px;height:12px;border-radius:6px;flex:none}
.co-attenue{color:var(--co-attenue)}
.co-alerte{color:var(--co-critique);font-weight:700}
.co-minicarte{width:200px;height:auto;display:block;border-radius:12px;background:var(--co-surface);border:1px solid var(--co-ligne);box-shadow:0 4px 16px rgba(0,0,0,.18);touch-action:none;cursor:pointer}
.co-relecture{position:absolute;left:10px;right:10px;bottom:10px;z-index:3;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:14px;background:var(--co-surface);border:1px solid var(--co-ligne);box-shadow:0 6px 20px rgba(0,0,0,.2)}
.co-segments{display:flex;gap:4px}
.co-heure{font-variant-numeric:tabular-nums;font-weight:700;min-width:5.6em;text-align:center}
.co-piste{position:relative;flex:1;min-width:80px;height:44px}
.co-densite{position:absolute;left:8px;right:8px;top:6px;bottom:22px;display:flex;align-items:flex-end;gap:1px;opacity:.55;pointer-events:none}
.co-densite span{flex:1;min-height:1px;border-radius:1px}
.co-piste input{position:absolute;inset:0;width:100%;height:44px;margin:0;accent-color:var(--co-accent);background:transparent;cursor:pointer}
.co-ambiance .co-vue{cursor:none}
.co-quitter-ambiance{position:absolute;top:12px;right:12px;z-index:6}
.co-ico-seul{display:none;font-size:20px}
@media (max-width:600px){.co-bd{flex-direction:column}.co-recentrer{width:44px;padding:0}.co-recentrer .co-txt{display:none}.co-recentrer .co-ico-seul{display:inline}.co-minicarte{width:128px!important}.co-relecture{flex-wrap:wrap}.co-piste{flex-basis:100%;order:5}.co-avec-relecture .co-bd,.co-avec-relecture .co-bg{bottom:124px}.co-minicarte{width:150px}.co-hg{max-width:calc(100% - 210px)}}
@media (prefers-reduced-motion:reduce){.co-carte{animation:none}}
`;

// ------------------------------------------------------------------ plateau

const lireMemoire = (cle: string): string | undefined => {
  try {
    return globalThis.localStorage?.getItem(cle) ?? undefined;
  } catch {
    return undefined;
  }
};
const ecrireMemoire = (cle: string, v: string) => {
  try {
    globalThis.localStorage?.setItem(cle, v);
  } catch {
    // stockage indisponible (navigation privée) : tant pis, rien de grave
  }
};
const CLE_MINICARTE = 'claude-office-minicarte';
let compteurIds = 0;

type DocPleinEcran = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type ElPleinEcran = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function PlateauScene({
  agents, theme, reduit, demo, charge, maintenant, estompes, choisi, onDetail, largeur, relecture, onRelecture, cleScene, horloge, attendent, initial, sousAgents,
}: PropsPlateau) {
  const plateau = useRef<HTMLDivElement>(null);
  const vue = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const calque = useRef<HTMLDivElement>(null);
  const carte = useRef<HTMLDivElement>(null);
  const cadreMini = useRef<SVGRectElement>(null);
  const positions = useRef(new Map<string, PositionPerso>());
  const [ids] = useState(() => `co-${++compteurIds}`);
  const idCarte = `${ids}-carte`;
  const idDescription = `${ids}-desc`;

  const [immersif, setImmersif] = useState(Boolean(initial?.immersif || initial?.ambiance));
  const [ambiance, setAmbiance] = useState(Boolean(initial?.ambiance));
  const [interface_, setInterface] = useState(true);
  const [apercu, setApercu] = useState<Apercu | undefined>(() =>
    initial?.apercu ? { genre: 'agent', cle: initial.apercu, epingle: true } : initial?.sousAgent ? { genre: 'sous', id: initial.sousAgent, epingle: true } : initial?.zone ? { genre: 'zone', zone: initial.zone, point: { x: 200, y: 200 }, epingle: true } : undefined);
  const [suivi, setSuivi] = useState<string | undefined>(initial?.suivi);
  const [miniCarte, setMiniCarte] = useState(() => initial?.minicarte ?? (lireMemoire(CLE_MINICARTE) ? lireMemoire(CLE_MINICARTE) === '1' : (typeof window !== 'undefined' ? window.innerWidth : largeur) >= 700));
  const [dispo, setDispo] = useState(560);
  const [tic, setTic] = useState(0);
  const apercuRef = useRef(apercu);
  apercuRef.current = apercu;
  const suiviRef = useRef(suivi);
  suiviRef.current = suivi;

  // ----- taille du cadre
  const fenetre = typeof window !== 'undefined' ? window : undefined;
  const hauteurNormale = hauteurPlateau(largeur, dispo);
  const cadre = useRef<Taille>({ l: largeur, h: hauteurNormale });
  const cam = useRef<Camera>(vueInitiale(cadre.current));
  const touchee = useRef(false);

  // Hauteur disponible sous le plateau (fenêtre moins ce qui est au-dessus), mesurée à chaque mise en page
  // (ce qui est au-dessus peut changer) ; bornée par un seuil, donc sans boucle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!fenetre || !plateau.current || immersif) return;
    // Position dans la page, quel que soit le défilement (la page du hub défile dans son propre conteneur).
    let defile = fenetre.scrollY;
    for (let el = plateau.current.parentElement; el; el = el.parentElement) defile += el.scrollTop;
    const haut = plateau.current.getBoundingClientRect().top + defile;
    const d = Math.max(300, Math.round(fenetre.innerHeight - Math.min(haut, fenetre.innerHeight * 0.45) - 14));
    if (Math.abs(d - dispo) > 4) setDispo(d);
  });
  useEffect(() => {
    if (!fenetre) return undefined;
    const surTaille = () => setTic(n => n + 1);
    fenetre.addEventListener('resize', surTaille);
    return () => fenetre.removeEventListener('resize', surTaille);
  }, [fenetre]);

  // ----- caméra : appliquée sans rendu React
  const placerLaCarte = useCallback(() => {
    const el = carte.current;
    const a = apercuRef.current;
    if (!el || !a) return;
    const c = cadre.current;
    let ancre: { x: number; y: number; l: number; h: number };
    if (a.genre !== 'zone') {
      const p = positions.current.get(clePerso(a)!);
      if (!p) return;
      const bas = versEcran(cam.current, c, { x: p.x, y: p.y });
      const haut = versEcran(cam.current, c, { x: p.x, y: p.haut });
      const demi = Math.max(14, (a.genre === 'sous' ? 14 : 22) * cam.current.s);
      ancre = { x: bas.x - demi, y: haut.y, l: demi * 2, h: bas.y - haut.y };
    } else ancre = { x: a.point.x - 6, y: a.point.y - 6, l: 12, h: 12 };
    const pos = placerCarte(ancre, { l: el.offsetWidth, h: el.offsetHeight }, c);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.dataset.cote = pos.cote;
  }, []);

  const appliquer = useCallback((c0: Camera) => {
    const c = cadre.current;
    const camera = borner(c0, c);
    cam.current = camera;
    const v = vueVisible(camera, c);
    svg.current?.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.l.toFixed(2)} ${v.h.toFixed(2)}`);
    if (calque.current) {
      calque.current.style.transform = `translate(${(-v.x * camera.s).toFixed(2)}px, ${(-v.y * camera.s).toFixed(2)}px) scale(${camera.s.toFixed(4)})`;
      calque.current.style.setProperty('--co-inv', (1 / camera.s).toFixed(4));
    }
    const m = cadreMini.current;
    if (m) {
      const x = Math.max(0, v.x);
      const y = Math.max(0, v.y);
      m.setAttribute('x', String(Math.round(x)));
      m.setAttribute('y', String(Math.round(y)));
      m.setAttribute('width', String(Math.round(Math.min(LARGEUR_SCENE, v.x + v.l) - x)));
      m.setAttribute('height', String(Math.round(Math.min(HAUTEUR_SCENE, v.y + v.h) - y)));
    }
    if (plateau.current) {
      plateau.current.dataset.zoom = camera.s.toFixed(3);
      plateau.current.dataset.centre = `${Math.round(camera.cx)},${Math.round(camera.cy)}`;
    }
    placerLaCarte();
  }, [placerLaCarte]);

  // ----- animations de caméra (transitions, inertie, suivi) : une seule boucle
  const anim = useRef<{ id: number; genre: 'transition' | 'inertie' | 'suivi' } | undefined>(undefined);
  const arreter = useCallback(() => {
    if (anim.current && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(anim.current.id);
    anim.current = undefined;
  }, []);
  const animerVers = useCallback((cible: Camera, ms = 320) => {
    arreter();
    const fin = borner(cible, cadre.current);
    if (reduit || typeof requestAnimationFrame === 'undefined') {
      appliquer(fin);
      return;
    }
    const depart = cam.current;
    const t0 = performance.now();
    const image = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      appliquer(interpoler(depart, fin, douceur(k)));
      if (k < 1) anim.current = { id: requestAnimationFrame(image), genre: 'transition' };
      else anim.current = undefined;
    };
    anim.current = { id: requestAnimationFrame(image), genre: 'transition' };
  }, [appliquer, arreter, reduit]);

  const lancerInertie = useCallback((v: Point) => {
    arreter();
    if (reduit || typeof requestAnimationFrame === 'undefined') return;
    let vitesse = vitesseLacher(v);
    let avant = performance.now();
    const image = (t: number) => {
      const dt = Math.min(48, t - avant);
      avant = t;
      const pas = inertie(vitesse, dt);
      vitesse = pas.v;
      appliquer(deplacer(cam.current, pas.d.x, pas.d.y, cadre.current));
      if (!pas.fini) anim.current = { id: requestAnimationFrame(image), genre: 'inertie' };
      else anim.current = undefined;
    };
    anim.current = { id: requestAnimationFrame(image), genre: 'inertie' };
  }, [appliquer, arreter, reduit]);

  // Suivi caméra : la vue reste centrée sur l'agent (même quand il marche).
  useEffect(() => {
    if (!suivi || typeof requestAnimationFrame === 'undefined') return undefined;
    arreter();
    const c = cadre.current;
    const s = echelleSuivi(cam.current, c);
    let avant = performance.now();
    let id = 0;
    const image = (t: number) => {
      const dt = Math.min(64, t - avant);
      avant = t;
      const p = positions.current.get(suivi);
      if (!p) {
        setSuivi(undefined);
        return;
      }
      const base = cam.current.s < s ? { ...cam.current, s: cam.current.s + (s - cam.current.s) * (reduit ? 1 : 1 - Math.exp(-dt / 220)) } : cam.current;
      appliquer(suivre(base, { x: p.x, y: (p.y + p.haut) / 2 }, dt, cadre.current, reduit));
      id = requestAnimationFrame(image);
    };
    id = requestAnimationFrame(image);
    return () => cancelAnimationFrame(id);
  }, [suivi, appliquer, arreter, reduit]);
  const lacherSuivi = () => {
    if (suiviRef.current) setSuivi(undefined);
  };

  // Taille du cadre suivie de près (rotation de l'iPad, plein écran) ; la vue de départ tant qu'on n'y a pas touché.
  const centreAgents = (): Point | undefined => {
    const liste = [...positions.current.values()];
    if (!liste.length) return undefined;
    const prioritaires = agents.filter(a => a.etat === 'attend' || a.salle).map(a => positions.current.get(a.cle)).filter(Boolean) as PositionPerso[];
    const base = prioritaires.length ? prioritaires : liste;
    return { x: base.reduce((s, p) => s + p.x, 0) / base.length, y: base.reduce((s, p) => s + (p.y + p.haut) / 2, 0) / base.length };
  };
  const vueDepart = (): Camera => (ambiance ? { s: contenir(cadre.current), cx: LARGEUR_SCENE / 2, cy: HAUTEUR_SCENE / 2 } : vueInitiale(cadre.current, centreAgents()));
  useLayoutEffect(() => {
    const el = vue.current;
    if (!el) return;
    const l = el.clientWidth || largeur;
    const h = el.clientHeight || hauteurNormale;
    const change = Math.abs(l - cadre.current.l) > 1 || Math.abs(h - cadre.current.h) > 1;
    cadre.current = { l, h };
    if (change && !touchee.current) appliquer(vueDepart());
    else appliquer(cam.current);
  });
  useEffect(() => {
    // Première vue, une fois les positions connues (après le rendu de la scène).
    if (!touchee.current) appliquer(vueDepart());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charge, cleScene, ambiance, immersif]);
  // Le cadre ne défile jamais (un focus clavier sur un personnage hors de la vue le ferait glisser de travers) :
  // c'est la caméra qui va le chercher.
  useEffect(() => {
    const racine = plateau.current;
    if (!racine) return undefined;
    const cadres = [racine, vue.current, racine.parentElement].filter((x): x is HTMLElement => Boolean(x));
    const surDefile = (e: Event) => {
      const el = e.target as HTMLElement;
      if (cadres.includes(el) && (el.scrollLeft || el.scrollTop)) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    };
    for (const c of cadres) c.addEventListener('scroll', surDefile, true);
    return () => {
      for (const c of cadres) c.removeEventListener('scroll', surDefile, true);
    };
  }, [immersif]);
  useEffect(() => {
    const el = vue.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTic(n => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // La carte d'un agent qui marche le suit ; la mini-carte se met à jour (sans rien redessiner d'autre).
  useEffect(() => {
    const besoin = apercu?.genre === 'agent' || miniCarte;
    if (!besoin) return undefined;
    const t = setInterval(() => {
      placerLaCarte();
      if (miniCarte) setTic(n => n + 1);
    }, miniCarte ? 500 : 250);
    return () => clearInterval(t);
  }, [apercu, miniCarte, placerLaCarte]);
  useLayoutEffect(() => placerLaCarte());

  // ----- zoom
  const zoomer = (facteur: number, point?: Point) => {
    touchee.current = true;
    lacherSuivi();
    const c = cadre.current;
    animerVers(zoomerEn(cam.current, facteur, point ?? { x: c.l / 2, y: c.h / 2 }, c), 220);
  };
  const recentrer = () => {
    touchee.current = false;
    lacherSuivi();
    animerVers(vueDepart());
  };
  const zoomerZone = (z: Zone) => {
    touchee.current = true;
    lacherSuivi();
    setApercu(undefined);
    animerVers(cadrer(rectZone(z), cadre.current), 380);
  };

  // Molette (écouteur non passif) : zoom autour du pointeur ; aux limites, la page défile normalement.
  useEffect(() => {
    const el = vue.current;
    if (!el) return undefined;
    const surMolette = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const avant = cam.current;
      const apres = zoomerEn(avant, facteurMolette(e.deltaY * (e.ctrlKey ? 3 : 1), e.deltaMode), { x: e.clientX - r.left, y: e.clientY - r.top }, cadre.current);
      // Aux limites : en dézoomant, la page défile normalement ; en zoomant au maximum, rien ne bouge.
      if (Math.abs(apres.s - avant.s) < 1e-6) {
        if (e.deltaY < 0) e.preventDefault();
        return;
      }
      e.preventDefault();
      arreter();
      touchee.current = true;
      if (suiviRef.current) setSuivi(undefined);
      appliquer(apres);
    };
    // Au doigt, tout passe par les événements de pointeur : pas de « clic fantôme » après le toucher (il fermerait
    // aussitôt le panneau Détail qui vient de s'ouvrir dessous).
    const surFinToucher = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('wheel', surMolette, { passive: false });
    el.addEventListener('touchend', surFinToucher, { passive: false });
    return () => {
      el.removeEventListener('wheel', surMolette);
      el.removeEventListener('touchend', surFinToucher);
    };
  }, [appliquer, arreter]);

  // ----- pointeurs : glisser, pincer, toucher, survol
  const pointeurs = useRef(new Map<number, Point>());
  const geste = useRef<{ debut: Point; glisse: boolean; cible?: Element | null; type: string; echantillons: Array<{ t: number; p: Point }>; pince?: { d: number; m: Point } }>(undefined);
  const dernierTap = useRef<{ t: number; p: Point; zone?: Zone } | undefined>(undefined);
  const minuterieSurvol = useRef<ReturnType<typeof setTimeout>>(undefined);
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = vue.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cibleDe = (el: EventTarget | null): { agent?: string; sous?: string; zone?: Zone } => {
    const n = el instanceof Element ? el.closest('[data-co-agent],[data-co-sous],[data-co-zone]') : null;
    if (!n) return {};
    const agent = n.getAttribute('data-co-agent');
    const sous = n.getAttribute('data-co-sous');
    return agent ? { agent } : sous ? { sous } : { zone: n.getAttribute('data-co-zone') as Zone };
  };
  const planifier = (f: () => void, ms: number) => {
    clearTimeout(minuterieSurvol.current);
    minuterieSurvol.current = setTimeout(f, ms);
  };
  useEffect(() => () => clearTimeout(minuterieSurvol.current), []);

  const survoler = (e: React.PointerEvent) => {
    const { agent, sous, zone } = cibleDe(e.target);
    const a = apercuRef.current;
    if (sous) {
      if (a?.genre === 'sous' && a.id === sous) return clearTimeout(minuterieSurvol.current);
      planifier(() => setApercu({ genre: 'sous', id: sous, epingle: false }), a ? 60 : 140);
    } else if (agent) {
      if (a?.genre === 'agent' && a.cle === agent) return clearTimeout(minuterieSurvol.current);
      planifier(() => setApercu({ genre: 'agent', cle: agent, epingle: false }), a ? 60 : 140);
    } else if (zone) {
      if (a?.genre === 'zone' && a.zone === zone) return clearTimeout(minuterieSurvol.current);
      if (a?.epingle) return undefined;
      const point = local(e);
      planifier(() => setApercu({ genre: 'zone', zone, point, epingle: false }), a ? 120 : 320);
    } else if (a && !a.epingle) planifier(() => setApercu(undefined), 180);
    return undefined;
  };

  const surBas = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    arreter();
    const p = local(e);
    pointeurs.current.set(e.pointerId, p);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointeur déjà relâché
    }
    if (pointeurs.current.size === 1) {
      geste.current = { debut: p, glisse: false, cible: e.target as Element, type: e.pointerType, echantillons: [{ t: performance.now(), p }] };
    } else if (pointeurs.current.size === 2 && geste.current) {
      const [a, b] = [...pointeurs.current.values()];
      geste.current.glisse = true;
      geste.current.pince = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };
  const surMouvement = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = geste.current;
    if (!pointeurs.current.has(e.pointerId) || !g) {
      if (e.pointerType === 'mouse' && !e.buttons) survoler(e);
      return;
    }
    const avant = pointeurs.current.get(e.pointerId)!;
    const p = local(e);
    pointeurs.current.set(e.pointerId, p);
    const c = cadre.current;
    if (g.pince && pointeurs.current.size >= 2) {
      const [a, b] = [...pointeurs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let camera = zoomerEn(cam.current, d / Math.max(1, g.pince.d), m, c);
      camera = deplacer(camera, m.x - g.pince.m.x, m.y - g.pince.m.y, c);
      g.pince = { d, m };
      touchee.current = true;
      lacherSuivi();
      appliquer(camera);
      return;
    }
    if (!g.glisse && Math.hypot(p.x - g.debut.x, p.y - g.debut.y) > 7) {
      g.glisse = true;
      vue.current?.classList.add('co-glisse');
      if (apercuRef.current && !apercuRef.current.epingle) setApercu(undefined);
    }
    if (g.glisse) {
      touchee.current = true;
      lacherSuivi();
      appliquer(deplacer(cam.current, p.x - avant.x, p.y - avant.y, c));
      g.echantillons.push({ t: performance.now(), p });
      if (g.echantillons.length > 6) g.echantillons.shift();
    }
  };
  const surHaut = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = geste.current;
    if (!pointeurs.current.delete(e.pointerId) || !g) return;
    if (pointeurs.current.size) {
      // Fin d'un pincement : on continue en glisser avec le doigt restant.
      g.pince = undefined;
      return;
    }
    vue.current?.classList.remove('co-glisse');
    geste.current = undefined;
    if (g.glisse) {
      const ech = g.echantillons;
      if (ech.length >= 2) {
        const a = ech[0];
        const b = ech[ech.length - 1];
        const dt = Math.max(1, b.t - a.t);
        if (performance.now() - b.t < 80) lancerInertie({ x: (b.p.x - a.p.x) / dt, y: (b.p.y - a.p.y) / dt });
      }
      return;
    }
    toucher(g.cible ?? null, local(e), g.type);
  };
  const surAnnule = (e: React.PointerEvent<HTMLDivElement>) => {
    pointeurs.current.delete(e.pointerId);
    if (!pointeurs.current.size) {
      geste.current = undefined;
      vue.current?.classList.remove('co-glisse');
    }
  };

  /** Un toucher ou un clic sans glisser. */
  const toucher = (el: Element | null, p: Point, type: string) => {
    if (ambiance) {
      montrerInterface();
      return;
    }
    const { agent, sous, zone } = cibleDe(el);
    const maintenantMs = performance.now();
    const precedent = dernierTap.current;
    const double = precedent && maintenantMs - precedent.t < 340 && Math.hypot(p.x - precedent.p.x, p.y - precedent.p.y) < 30;
    dernierTap.current = { t: maintenantMs, p, zone };
    const souris = type === 'mouse';
    if (sous) {
      dernierTap.current = undefined;
      const a = apercuRef.current;
      const parent = sousAgents?.find(x => x.id === sous)?.parent;
      if ((souris || (a?.genre === 'sous' && a.id === sous)) && parent) {
        setApercu(undefined);
        onDetail(parent);
      } else setApercu({ genre: 'sous', id: sous, epingle: true });
      return;
    }
    if (agent) {
      dernierTap.current = undefined;
      const a = apercuRef.current;
      if (souris || (a?.genre === 'agent' && a.cle === agent)) {
        setApercu(undefined);
        onDetail(agent);
      } else setApercu({ genre: 'agent', cle: agent, epingle: true });
      return;
    }
    if (double) {
      dernierTap.current = undefined;
      if (zone) zoomerZone(zone);
      else zoomer(2, p);
      return;
    }
    if (zone && !souris) {
      setApercu({ genre: 'zone', zone, point: p, epingle: true });
      return;
    }
    setApercu(undefined);
  };

  // ----- clavier : Échap (avant le hub, qui fermerait l'app), zoom et flèches quand le plateau a le focus
  const etats = useRef({ apercu, immersif, ambiance });
  etats.current = { apercu, immersif, ambiance };
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const feuille = document.querySelector('[aria-modal="true"]');
      if (feuille) {
        // Une feuille ouverte (détail, aide) se ferme d'abord — sans que le hub ne ferme toute l'app.
        const fermer = feuille.querySelector<HTMLElement>('[data-testid$="-fermer"]');
        if (!fermer) return;
        e.preventDefault();
        e.stopPropagation();
        fermer.click();
        return;
      }
      const s = etats.current;
      if (s.ambiance) quitterPleinEcran();
      else if (s.apercu) setApercu(undefined);
      else if (s.immersif) quitterPleinEcran();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', surTouche, true);
    return () => document.removeEventListener('keydown', surTouche, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const surClavier = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey) return;
    const pas = 80;
    const c = cadre.current;
    const actions: Record<string, () => void> = {
      '+': () => zoomer(1.4), '=': () => zoomer(1.4), '-': () => zoomer(1 / 1.4), '0': recentrer,
      ArrowLeft: () => appliquer(deplacer(cam.current, pas, 0, c)), ArrowRight: () => appliquer(deplacer(cam.current, -pas, 0, c)),
      ArrowUp: () => appliquer(deplacer(cam.current, 0, pas, c)), ArrowDown: () => appliquer(deplacer(cam.current, 0, -pas, c)),
    };
    const f = actions[e.key];
    if (!f) return;
    e.preventDefault();
    touchee.current = true;
    lacherSuivi();
    f();
  };

  // ----- plein écran, immersif, écran d'ambiance
  const pleinEcranApi = useRef(false);
  const entrerPleinEcran = (avecAmbiance: boolean) => {
    setImmersif(true);
    setAmbiance(avecAmbiance);
    setApercu(undefined);
    touchee.current = false;
    const doc = document as DocPleinEcran;
    const racine = document.documentElement as ElPleinEcran;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      const demande = racine.requestFullscreen?.bind(racine) ?? racine.webkitRequestFullscreen?.bind(racine);
      if (demande) {
        pleinEcranApi.current = true;
        demande().catch(() => {
          pleinEcranApi.current = false;
        });
      }
    }
  };
  const quitterPleinEcran = () => {
    setImmersif(false);
    setAmbiance(false);
    touchee.current = false;
    const doc = document as DocPleinEcran;
    if (pleinEcranApi.current && (doc.fullscreenElement || doc.webkitFullscreenElement)) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => undefined);
    }
    pleinEcranApi.current = false;
  };
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const surChange = () => {
      const doc = document as DocPleinEcran;
      if (pleinEcranApi.current && !doc.fullscreenElement && !doc.webkitFullscreenElement) quitterPleinEcran();
    };
    document.addEventListener('fullscreenchange', surChange);
    document.addEventListener('webkitfullscreenchange', surChange);
    return () => {
      document.removeEventListener('fullscreenchange', surChange);
      document.removeEventListener('webkitfullscreenchange', surChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Immersif : la page ne défile plus derrière le plateau.
  useEffect(() => {
    if (!immersif || typeof document === 'undefined') return undefined;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => void (document.documentElement.style.overflow = avant);
  }, [immersif]);
  // Écran d'ambiance : l'écran reste allumé (quand le navigateur le permet), l'interface se cache.
  useEffect(() => {
    if (!ambiance) return undefined;
    let verrou: { release(): Promise<void> } | undefined;
    const nav = (globalThis as { navigator?: { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } } }).navigator;
    nav?.wakeLock?.request('screen').then(v => void (verrou = v)).catch(() => undefined);
    setInterface(false);
    return () => void verrou?.release().catch(() => undefined);
  }, [ambiance]);
  const minuterieInterface = useRef<ReturnType<typeof setTimeout>>(undefined);
  const montrerInterface = () => {
    setInterface(true);
    clearTimeout(minuterieInterface.current);
    minuterieInterface.current = setTimeout(() => setInterface(false), 3500);
  };
  useEffect(() => () => clearTimeout(minuterieInterface.current), []);

  // ----- cibles accessibles (boutons au-dessus des personnages)
  const cibles = useMemo<CiblesScene>(() => ({
    libelle: a => libelleCible(a, maintenant),
    decrit: clePerso(apercu) ? { cle: clePerso(apercu)!, id: idDescription } : undefined,
    onFocus: cle => {
      if (!cle) {
        if (apercuRef.current?.genre !== 'zone' && apercuRef.current?.epingle) setApercu(undefined);
        return;
      }
      setApercu(cle.startsWith('sa:') ? { genre: 'sous', id: cle.slice(3), epingle: true } : { genre: 'agent', cle, epingle: true });
      // Agent hors de la vue : on l'y amène.
      const p = positions.current.get(cle);
      const c = cadre.current;
      if (p) {
        const e = versEcran(cam.current, c, p);
        if (e.x < 40 || e.x > c.l - 40 || e.y < 60 || e.y > c.h - 20) animerVers({ ...cam.current, cx: p.x, cy: p.y - 40 }, 260);
      }
    },
    onActiver: cle => {
      setApercu(undefined);
      const parent = cle.startsWith('sa:') ? sousAgents?.find(x => x.id === cle.slice(3))?.parent : cle;
      if (parent) onDetail(parent);
    },
  }), [maintenant, apercu, idDescription, onDetail, animerVers, sousAgents]);
  // Sous-agents dessinés à l'instant affiché (au plus quelques-uns, le reste compté) et compteur par parent.
  const clesAgents = agents.map(a => a.cle).join('|');
  const minis = useMemo(() => sousAgentsVisibles(sousAgents ?? [], new Set(agents.map(a => a.cle)), maintenant), [sousAgents, clesAgents, maintenant]); // eslint-disable-line react-hooks/exhaustive-deps
  const parParent = useMemo(() => compterParParent((sousAgents ?? []).filter(s => s.debut <= maintenant)), [sousAgents, maintenant]);
  const sousApercu = apercu?.genre === 'sous' ? (sousAgents ?? []).find(x => x.id === apercu.id) : undefined;

  const agentApercu = apercu?.genre === 'agent' ? agents.find(a => a.cle === apercu.cle) : undefined;
  useEffect(() => {
    if (apercu?.genre === 'agent' && !agentApercu && charge !== false && agents.length) setApercu(undefined);
    if (apercu?.genre === 'sous' && !minis.visibles.some(m => m.id === apercu.id)) setApercu(undefined);
  }, [apercu, agentApercu, agents.length, charge, minis]);
  const agentSuivi = suivi ? agents.find(a => a.cle === suivi) : undefined;
  const allerMiniCarte = (p: Point, fin: boolean) => {
    touchee.current = true;
    lacherSuivi();
    const camera = { ...cam.current, cx: p.x, cy: p.y };
    if (fin) animerVers(camera, 200);
    else {
      arreter();
      appliquer(camera);
    }
  };
  // Raccourcis de l'écran (raccourcis.ts) : F bascule le plein écran ; J / K suivent l'agent suivant / précédent
  // (caméra + aperçu épinglé) ; Bureau.tsx laisse alors J / K à la scène.
  const raccourcis = useRef({ agents, immersif, entrerPleinEcran, quitterPleinEcran });
  raccourcis.current = { agents, immersif, entrerPleinEcran, quitterPleinEcran };
  useEffect(() => {
    const suivre = (sens: 1 | -1) => () => {
      const cles = raccourcis.current.agents.map(a => a.cle);
      const courant = suiviRef.current ?? (apercuRef.current?.genre === 'agent' ? apercuRef.current.cle : undefined);
      const cle = agentVoisin(cles, courant, sens);
      if (cle === undefined) return false;
      touchee.current = true;
      setSuivi(cle);
      setApercu({ genre: 'agent', cle, epingle: true });
      return true;
    };
    const retirer = [
      ecouterOffice('plein-ecran', () => {
        const r = raccourcis.current;
        if (r.immersif) r.quitterPleinEcran();
        else r.entrerPleinEcran(false);
        return true;
      }),
      ecouterOffice('agent-suivant', suivre(1)),
      ecouterOffice('agent-precedent', suivre(-1)),
    ];
    return () => retirer.forEach(f => f());
  }, []);
  const basculerMiniCarte = () => {
    setMiniCarte(m => {
      ecrireMemoire(CLE_MINICARTE, m ? '0' : '1');
      return !m;
    });
  };

  const style = {
    height: immersif ? undefined : hauteurNormale,
    ['--co-fond-plateau' as string]: theme.sombre ? 'radial-gradient(ellipse at 50% 35%, #1D2342 0%, #0C0F1C 75%)' : 'radial-gradient(ellipse at 50% 35%, #FBFCFE 0%, #DCE5EF 80%)',
    ['--co-surface' as string]: theme.surface,
    ['--co-texte' as string]: theme.texte,
    ['--co-attenue' as string]: theme.attenue,
    ['--co-ligne' as string]: theme.ligne,
    ['--co-accent' as string]: theme.accent,
    ['--co-sur-accent' as string]: theme.surAccent,
    ['--co-critique' as string]: lisible(TEINTES_ACTIVITE.attend, theme.sombre),
  } as React.CSSProperties;
  const controles = !ambiance || interface_;

  const contenu = (
    <div
      ref={plateau}
      className={`co-plateau${immersif ? ' co-immersif' : ''}${ambiance ? ' co-ambiance' : ''}${relecture ? ' co-avec-relecture' : ''}`}
      style={style}
      data-testid="bureau-plateau"
      data-mode={ambiance ? 'ambiance' : immersif ? 'immersif' : 'normal'}
      data-tic={tic}
      onKeyDown={surClavier}
      onPointerMove={ambiance ? montrerInterface : undefined}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS_PLATEAU }} />
      <div
        ref={vue}
        className="co-vue"
        data-testid="bureau-scene-defilement"
        role="application"
        aria-roledescription="open space"
        aria-label="Open space de Claude Office : glisser pour se déplacer, pincer ou + et − pour zoomer, double-tap sur une zone pour la cadrer, Tab pour passer d’un agent à l’autre"
        tabIndex={0}
        onPointerDown={surBas}
        onPointerMove={surMouvement}
        onPointerUp={surHaut}
        onPointerCancel={surAnnule}
        onPointerLeave={e => {
          if (e.pointerType === 'mouse' && apercuRef.current && !apercuRef.current.epingle) planifier(() => setApercu(undefined), 220);
        }}
        onDoubleClick={e => e.preventDefault()}
      >
        <SceneOpenSpace
          key={cleScene}
          agents={agents}
          theme={theme}
          reduit={reduit}
          largeur={largeur}
          choisi={choisi}
          onChoisir={onDetail}
          demo={demo}
          charge={charge}
          maintenant={maintenant}
          estompes={estompes}
          horloge={horloge}
          remplir
          refSvg={svg}
          refCalque={calque}
          positions={positions}
          survole={agentApercu?.cle ?? (sousApercu ? `sa:${sousApercu.id}` : undefined)}
          sousAgents={minis.visibles}
          sousAgentsEnPlus={minis.enPlus}
          sousAgentsParParent={parParent}
          zoneSurvolee={apercu?.genre === 'zone' ? apercu.zone : undefined}
          cibles={ambiance ? undefined : cibles}
        />
      </div>

      {controles ? (
        <>
          <div className="co-ctl co-hg">
            {relecture ? <span className="co-puce" data-testid="scene-puce-relecture">{`⏱︎ Relecture · ${heureRelecture(relecture.r.t)}`}</span> : null}
            {agentSuivi ? (
              <button type="button" className="co-btn" onClick={() => setSuivi(undefined)} data-testid="scene-suivi">{`◎ Suivi : ${nomScene(agentSuivi)} · Arrêter`}</button>
            ) : null}
            {immersif && !ambiance && attendent?.length ? (
              <button type="button" className="co-btn co-btn-plein" style={{ background: lisible(TEINTES_ACTIVITE.attend, false), borderColor: 'transparent', color: '#FFFFFF' }} onClick={() => setApercu({ genre: 'agent', cle: attendent[0].cle, epingle: true })} data-testid="scene-puce-attend">
                {`! ${attendent.length} attend${attendent.length > 1 ? 'ent' : ''} ta réponse`}
              </button>
            ) : null}
          </div>
          <div className="co-ctl co-hd">
            {ambiance ? (
              <button type="button" className="co-btn co-btn-plein" onClick={quitterPleinEcran} data-testid="scene-ambiance-quitter">Quitter l’écran d’ambiance</button>
            ) : (
              <>
                {onRelecture && !relecture ? <button type="button" className="co-btn co-ico" title="Relecture de la journée" aria-label="Relecture de la journée" onClick={onRelecture} data-testid="scene-relecture-ouvrir">⏱︎</button> : null}
                <button type="button" className="co-btn co-ico" title={miniCarte ? 'Replier la mini-carte' : 'Mini-carte'} aria-label={miniCarte ? 'Replier la mini-carte' : 'Afficher la mini-carte'} aria-pressed={miniCarte} onClick={basculerMiniCarte} data-testid="scene-minicarte-basculer">▣</button>
                <button type="button" className="co-btn co-ico" title="Écran d’ambiance (plein écran sans interface)" aria-label="Écran d’ambiance : plein écran sans interface, pour un deuxième écran ou une tablette posée" onClick={() => entrerPleinEcran(true)} data-testid="scene-ambiance">◐</button>
                <button type="button" className="co-btn co-ico" title={immersif ? 'Quitter le plein écran' : 'Plein écran'} aria-label={immersif ? 'Quitter le plein écran' : 'Plein écran'} aria-pressed={immersif} onClick={() => (immersif ? quitterPleinEcran() : entrerPleinEcran(false))} data-testid="scene-plein-ecran">{immersif ? '✕' : '⛶'}</button>
              </>
            )}
          </div>
          {ambiance ? null : (
            <>
              <div className="co-ctl co-bd" role="group" aria-label="Zoom">
                <button type="button" className="co-btn co-ico" aria-label="Zoomer" title="Zoomer (+)" onClick={() => zoomer(1.4)} data-testid="scene-zoom-plus">+</button>
                <button type="button" className="co-btn co-ico" aria-label="Dézoomer" title="Dézoomer (−)" onClick={() => zoomer(1 / 1.4)} data-testid="scene-zoom-moins">−</button>
                <button type="button" className="co-btn co-recentrer" onClick={recentrer} title="Recentrer (0)" aria-label="Recentrer" data-testid="scene-recentrer"><span className="co-txt">Recentrer</span><span className="co-ico-seul" aria-hidden="true">⌖</span></button>
              </div>
              {miniCarte ? (
                <div className="co-ctl co-bg">
                  <MiniCarte agents={agents} positions={positions.current} theme={theme} refCadre={cadreMini} onAller={allerMiniCarte} tic={tic} />
                </div>
              ) : null}
              {relecture ? <BarreRelecture c={relecture} theme={theme} /> : null}
            </>
          )}
        </>
      ) : null}

      {apercu && !ambiance ? (
        <div
          ref={carte}
          id={idCarte}
          className="co-carte"
          role="group"
          aria-label={apercu.genre === 'agent' ? 'Aperçu de l’agent' : apercu.genre === 'sous' ? 'Aperçu du sous-agent' : 'Aperçu de la zone'}
          data-testid={apercu.genre === 'agent' ? 'scene-carte' : apercu.genre === 'sous' ? 'scene-carte-sous' : 'scene-carte-zone'}
          style={{ left: -9999, top: 0 }}
          onPointerEnter={() => clearTimeout(minuterieSurvol.current)}
          onPointerLeave={e => {
            if (e.pointerType === 'mouse' && !apercuRef.current?.epingle) planifier(() => setApercu(undefined), 220);
          }}
        >
          {apercu.genre === 'agent' && agentApercu ? (
            <CarteAgent
              a={agentApercu}
              maintenant={maintenant}
              theme={theme}
              idDescription={idDescription}
              suivi={suivi === agentApercu.cle}
              sousAgentsEnCours={parParent.get(agentApercu.cle)}
              onDetail={() => {
                setApercu(undefined);
                onDetail(agentApercu.cle);
              }}
              onSuivre={() => {
                touchee.current = true;
                setSuivi(s => (s === agentApercu.cle ? undefined : agentApercu.cle));
              }}
            />
          ) : apercu.genre === 'sous' && sousApercu ? (
            <CarteSousAgent
              sa={sousApercu}
              parent={agents.find(a => a.cle === sousApercu.parent)}
              maintenant={maintenant}
              idDescription={idDescription}
              onDetail={() => {
                setApercu(undefined);
                onDetail(sousApercu.parent);
              }}
            />
          ) : apercu.genre === 'zone' ? (
            <CarteZone zone={apercu.zone} agents={agents} idDescription={idDescription} onZoomer={() => zoomerZone(apercu.zone)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
  // Plein écran : le plateau passe au-dessus de toute la page (hors des empilements du hub) ; sa place reste réservée.
  if (immersif && typeof document !== 'undefined') {
    return (
      <>
        <div style={{ height: hauteurNormale }} data-testid="bureau-plateau-place" />
        {createPortal(contenu, document.body)}
      </>
    );
  }
  return contenu;
}
