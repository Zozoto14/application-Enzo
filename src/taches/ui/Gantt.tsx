/**
 * Vue Chronologie (Gantt) de Tâches (V3).
 *
 *  - barres début → échéance, regroupées par projet (et par liste) ; jalons
 *    en losange ; ligne « aujourd'hui » ; échelle jour / semaine / mois ;
 *  - glisser une barre la déplace, glisser ses bords l'étire (souris ; au
 *    doigt, appui long puis glisser — sinon le doigt fait défiler) ;
 *  - glisser la pastille ● au bout d'une barre sur une autre barre crée la
 *    dépendance « fin → début » ; une dépendance violée est en rouge, et
 *    « Décaler les suivantes » remet tout dans l'ordre ;
 *  - clavier : ← → déplace d'un jour, Maj + ← → change l'échéance,
 *    Entrée ouvre la tâche ;
 *  - iPhone : colonne des titres étroite, la chronologie défile seule à
 *    l'horizontale.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { ajouterJours, ecartJours, jourLisible } from '../dates';
import { barres as calculerBarres, basculerDependance, decalerSuivantes, deplacer, echelle, etirer, groupesGantt, LIBELLES_ZOOM, liens as calculerLiens, position, type Barre, type Echelle, type Zoom } from '../gantt';
import { creeBoucle, modifierTache, statutDe, type Tache } from '../modele';
import type { Actions } from './actions';
import { attenueDe, Bouton, EtatVide, Libelle, Puce, texteDe } from './atomes';
import { useGlissable, useZoneDepot } from './glisser';

const HAUTEUR_LIGNE = 44;
const HAUTEUR_TETE = 40;

interface ElementDom {
  addEventListener(type: string, f: (e: never) => void, o?: unknown): void;
  removeEventListener(type: string, f: (e: never) => void, o?: unknown): void;
  style: Record<string, string>;
}
const estDom = (x: unknown): x is ElementDom => Boolean(x) && typeof (x as ElementDom).addEventListener === 'function';

/**
 * Tirer à l'horizontale, par pas d'un jour (web : souris, ou doigt après un
 * appui long). Rend le décalage en cours (px) ; au lâcher, `onFin(jours)`.
 */
function useTirer(o: { actif: boolean; pas: number; onFin(jours: number): void }): { ref: (x: unknown) => void; decalage: number } {
  const [element, setElement] = useState<ElementDom | undefined>();
  const [decalage, setDecalage] = useState(0);
  const courant = useRef(o);
  courant.current = o;
  useEffect(() => {
    if (!element || !o.actif) return undefined;
    const doc = (globalThis as unknown as { document?: ElementDom }).document;
    if (!doc) return undefined;
    let x0: number | undefined;
    let dx = 0;
    let actif = false;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let avaler = false;
    const finir = (valider: boolean) => {
      if (minuterie) clearTimeout(minuterie);
      minuterie = undefined;
      doc.removeEventListener('pointermove', bouger as never);
      doc.removeEventListener('pointerup', lacher as never);
      doc.removeEventListener('keydown', touche as never, true);
      const jours = Math.round(dx / courant.current.pas);
      if (actif) {
        avaler = true;
        setTimeout(() => (avaler = false), 50);
      }
      const etait = actif;
      actif = false;
      x0 = undefined;
      dx = 0;
      setDecalage(0);
      if (etait && valider && jours) courant.current.onFin(jours);
    };
    const bouger = (e: { clientX: number; preventDefault(): void }) => {
      if (x0 === undefined) return;
      dx = e.clientX - x0;
      if (!actif && Math.abs(dx) > 4) actif = true;
      if (actif) {
        e.preventDefault();
        setDecalage(Math.round(dx / courant.current.pas) * courant.current.pas);
      }
    };
    const lacher = () => finir(true);
    const touche = (e: { key: string; preventDefault(): void; stopPropagation(): void }) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finir(false);
      }
    };
    const appui = (e: { pointerType: string; button: number; clientX: number; stopPropagation(): void }) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      e.stopPropagation();
      x0 = e.clientX;
      dx = 0;
      doc.addEventListener('pointermove', bouger as never);
      doc.addEventListener('pointerup', lacher as never);
      doc.addEventListener('keydown', touche as never, true);
    };
    // Doigt : appui long (280 ms) sans bouger, puis glisser ; bouger avant = défiler.
    const toucherDebut = (e: { touches: ArrayLike<{ clientX: number; clientY: number }>; stopPropagation(): void }) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      x0 = e.touches[0].clientX;
      const y0 = e.touches[0].clientY;
      dx = 0;
      (element as unknown as { _y0?: number })._y0 = y0;
      minuterie = setTimeout(() => {
        minuterie = undefined;
        if (x0 !== undefined) {
          actif = true;
          setDecalage(0);
        }
      }, 280);
    };
    const toucherBouger = (e: { touches: ArrayLike<{ clientX: number; clientY: number }>; cancelable?: boolean; preventDefault(): void }) => {
      if (x0 === undefined) return;
      const t = e.touches[0];
      if (!actif) {
        if (t && (Math.abs(t.clientX - x0) > 10 || Math.abs(t.clientY - ((element as unknown as { _y0?: number })._y0 ?? t.clientY)) > 10)) {
          if (minuterie) clearTimeout(minuterie);
          minuterie = undefined;
          x0 = undefined;
        }
        return;
      }
      if (e.cancelable !== false) e.preventDefault();
      dx = t.clientX - x0;
      setDecalage(Math.round(dx / courant.current.pas) * courant.current.pas);
    };
    const toucherFin = (e: { cancelable?: boolean; preventDefault(): void }) => {
      if (actif && e.cancelable !== false) e.preventDefault();
      finir(true);
    };
    const clic = (e: { preventDefault(): void; stopPropagation(): void }) => {
      if (avaler) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const menu = (e: { preventDefault(): void }) => e.preventDefault();
    element.addEventListener('pointerdown', appui as never);
    element.addEventListener('touchstart', toucherDebut as never, { passive: true });
    element.addEventListener('touchmove', toucherBouger as never, { passive: false });
    element.addEventListener('touchend', toucherFin as never, { passive: false });
    element.addEventListener('click', clic as never, true);
    element.addEventListener('contextmenu', menu as never);
    element.style.userSelect = 'none';
    return () => {
      finir(false);
      element.removeEventListener('pointerdown', appui as never);
      element.removeEventListener('touchstart', toucherDebut as never, { passive: true });
      element.removeEventListener('touchmove', toucherBouger as never, { passive: false });
      element.removeEventListener('touchend', toucherFin as never, { passive: false });
      element.removeEventListener('click', clic as never, true);
      element.removeEventListener('contextmenu', menu as never);
    };
  }, [element, o.actif]);
  const ref = useMemo(() => (x: unknown) => setElement(estDom(x) ? x : undefined), []);
  return { ref, decalage };
}

const fr = (j: string) => j.split('-').reverse().join('/');

function BarreGantt({ a, b, e, onDeplacer, onEtirer, onDependance, violee, libelleDeps }: { a: Actions; b: Barre; e: Echelle; onDeplacer(id: string, jours: number): void; onEtirer(id: string, cote: 'debut' | 'fin', jours: number): void; onDependance(de: string, vers: string): void; violee: boolean; libelleDeps: string }) {
  const theme = a.theme;
  const t = b.tache;
  const modifiable = a.droits(t.projetId).modifier;
  const couleur = a.etat.donnees.projets[t.projetId]?.couleur ?? theme.accent;
  const deplace = useTirer({ actif: modifiable, pas: e.largeurJour, onFin: j => onDeplacer(t.id, j) });
  const gauche = useTirer({ actif: modifiable && !b.jalon, pas: e.largeurJour, onFin: j => onEtirer(t.id, 'debut', j) });
  const droite = useTirer({ actif: modifiable && !b.jalon, pas: e.largeurJour, onFin: j => onEtirer(t.id, 'fin', j) });
  const zone = useZoneDepot(`gantt:${t.id}`);
  const lien = useGlissable({ actif: modifiable, onDeposer: z => z.startsWith('gantt:') && z !== `gantt:${t.id}` && onDependance(t.id, z.slice(6)) });
  const x = position(e, b.debut) + deplace.decalage + gauche.decalage;
  const largeur = Math.max(e.largeurJour, (ecartJours(b.debut, b.fin) + 1) * e.largeurJour - gauche.decalage + droite.decalage);
  const surTouche = (ev: { key: string; shiftKey?: boolean; preventDefault(): void }) => {
    if (!modifiable) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const pas = ev.key === 'ArrowLeft' ? -1 : 1;
      if (ev.shiftKey && !b.jalon) onEtirer(t.id, 'fin', pas);
      else onDeplacer(t.id, pas);
    }
  };
  const libelle = `${t.titre}. ${b.jalon ? `Jalon le ${fr(b.fin)}` : b.debut === b.fin ? `Le ${fr(b.debut)}` : `Du ${fr(b.debut)} au ${fr(b.fin)}`}. ${statutDe(a.etat.donnees, t).nom}.${libelleDeps}${violee ? ' Dépendance non respectée.' : ''}${modifiable ? ' Flèches gauche et droite pour déplacer d’un jour, Maj + flèches pour changer l’échéance.' : ''}`;
  const poignee = a.mobile ? 16 : 10;
  if (b.jalon) {
    return (
      <View ref={zone.ref as never} style={[styles.ligneTemps, { left: x, width: e.largeurJour }]} pointerEvents="box-none">
        <Pressable ref={deplace.ref as never} accessibilityRole="button" accessibilityLabel={libelle} onPress={() => a.ouvrir(t.id)} {...({ onKeyDown: surTouche } as object)} testID={`gantt-barre-${t.id}`} style={[styles.jalonZone, { width: Math.max(e.largeurJour, 28) }]}>
          <View style={[styles.jalon, { backgroundColor: b.terminee ? theme.attenue : theme.teintes.quatre, borderColor: violee ? theme.critique : theme.surface }]} />
        </Pressable>
        <Text numberOfLines={1} style={[attenueDe(theme), styles.etiquetteJalon]}>
          {t.titre}
        </Text>
      </View>
    );
  }
  return (
    <View ref={zone.ref as never} style={[styles.barreZone, { left: x, width: largeur }]}>
      <Pressable
        ref={deplace.ref as never}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        onPress={() => a.ouvrir(t.id)}
        {...({ onKeyDown: surTouche } as object)}
        testID={`gantt-barre-${t.id}`}
        style={[
          styles.barre,
          {
            backgroundColor: b.terminee ? teinteTransparente(couleur, 0.35) : couleur,
            borderColor: violee || zone.survolee ? theme.critique : 'transparent',
            borderRadius: Math.min(theme.rayonMoyen, 8),
            outlineStyle: zone.survolee ? 'dashed' : undefined,
          } as object,
        ]}>
        <Text numberOfLines={1} style={[styles.texteBarre, { color: b.terminee ? theme.texte : theme.surAccent, textDecorationLine: b.terminee ? 'line-through' : 'none' }]}>
          {largeur >= 60 ? t.titre : ''}
        </Text>
      </Pressable>
      {modifiable ? <View ref={gauche.ref as never} style={[styles.poignee, { left: 0, width: poignee, cursor: 'ew-resize' } as object]} accessibilityLabel="Étirer le début" testID={`gantt-debut-${t.id}`} /> : null}
      {modifiable ? <View ref={droite.ref as never} style={[styles.poignee, { right: 0, width: poignee, cursor: 'ew-resize' } as object]} accessibilityLabel="Étirer l’échéance" testID={`gantt-fin-${t.id}`} /> : null}
      {modifiable ? (
        <View ref={lien.ref as never} style={[styles.pastilleLien, { right: -14, backgroundColor: theme.surface, borderColor: couleur, cursor: 'crosshair' } as object]} accessibilityLabel={`Glisser sur une autre tâche : elle dépendra de « ${t.titre} »`} testID={`gantt-lien-${t.id}`}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: couleur }} />
        </View>
      ) : null}
    </View>
  );
}

export function VueGantt({ a, taches, onAvis, onErreur }: { a: Actions; taches: readonly Tache[]; onAvis(t: string): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const [zoom, setZoom] = useState<Zoom>(a.mobile ? 'semaine' : 'jour');
  const defile = useRef<{ scrollTo(o: { x: number; animated: boolean }): void } | null>(null);
  const { barres, sansDate } = useMemo(() => calculerBarres(d, taches), [d, taches]);
  const e = useMemo(() => echelle(barres, zoom, a.etat.aujourdhui), [barres, zoom, a.etat.aujourdhui]);
  const groupes = useMemo(() => groupesGantt(d, barres), [d, barres]);
  const liens = useMemo(() => calculerLiens(d, taches), [d, taches]);
  const violees = liens.filter(l => l.viole);
  const largeurTitres = a.mobile ? 128 : 240;
  const largeurTemps = e.jours * e.largeurJour;
  // Ouvre sur aujourd'hui.
  useEffect(() => {
    const x = Math.max(0, position(e, a.etat.aujourdhui) - (a.mobile ? 60 : 200));
    const t = setTimeout(() => defile.current?.scrollTo({ x, animated: false }), 0);
    return () => clearTimeout(t);
  }, [zoom, e.debut, a.mobile, a.etat.aujourdhui]);
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (err) {
      onErreur(err);
    }
  };
  const onDeplacer = (id: string, jours: number) =>
    essayer(() => {
      a.etat.maj((x, ctx) => deplacer(x, id, jours, ctx));
      onAvis(`« ${d.taches[id]?.titre ?? ''} » déplacée de ${jours > 0 ? '+' : ''}${jours} jour${Math.abs(jours) > 1 ? 's' : ''}.`);
    });
  const onEtirer = (id: string, cote: 'debut' | 'fin', jours: number) => essayer(() => a.etat.maj((x, ctx) => etirer(x, id, cote, jours, ctx)));
  const onDependance = (de: string, vers: string) =>
    essayer(() => {
      if (creeBoucle(d, vers, de)) throw new Error('Cette dépendance ferait une boucle.');
      a.etat.maj((x, ctx) => basculerDependance(x, vers, de, ctx));
      onAvis(`« ${d.taches[vers]?.titre} » dépend maintenant de « ${d.taches[de]?.titre} ».`);
    });
  const decalerTout = () =>
    essayer(() => {
      let n = 0;
      a.etat.maj((x, ctx) => {
        let y = x;
        for (const l of violees) {
          const r = decalerSuivantes(y, l.de, ctx);
          y = r.donnees;
          n += r.decalees.length;
        }
        return y;
      });
      onAvis(`${n} tâche${n > 1 ? 's' : ''} décalée${n > 1 ? 's' : ''} : les dépendances sont respectées.`);
    });
  const lignes: Array<{ cle: string; groupe?: { titre: string; couleur?: string }; barre?: Barre }> = [];
  for (const g of groupes) {
    lignes.push({ cle: `g-${g.cle}`, groupe: { titre: g.titre, couleur: g.couleur } });
    for (const b of g.barres) lignes.push({ cle: b.tache.id, barre: b });
  }
  const indexLigne = new Map(lignes.map((l, i) => [l.cle, i]));
  const xAujourdhui = position(e, a.etat.aujourdhui) + e.largeurJour / 2;
  const libelleDeps = (t: Tache) => {
    const l = (t.dependances ?? []).map(x => d.taches[x]?.titre).filter(Boolean);
    return l.length ? ` Après : ${l.join(', ')}.` : '';
  };

  const outils = (
    <View style={styles.rangee}>
      <View style={styles.rangee} accessibilityRole="radiogroup" accessibilityLabel="Échelle">
        {(['jour', 'semaine', 'mois'] as Zoom[]).map(z => (
          <Puce key={z} theme={theme} grand={a.mobile} texte={LIBELLES_ZOOM[z]} couleur={theme.accent} actif={zoom === z} onPress={() => setZoom(z)} testID={`gantt-zoom-${z}`} />
        ))}
      </View>
      <Bouton theme={theme} compact titre="Aujourd’hui" onPress={() => defile.current?.scrollTo({ x: Math.max(0, xAujourdhui - (a.mobile ? 60 : 200)), animated: false })} testID="gantt-aujourdhui" />
      <Text style={attenueDe(theme)}>{a.mobile ? 'Appui long puis glisser · ● vers une autre tâche : dépendance' : 'Glisser : déplacer · bords : étirer · ● vers une autre tâche : dépendance · ← → au clavier'}</Text>
    </View>
  );
  if (!barres.length && !sansDate.length) {
    return <EtatVide theme={theme} testID="gantt-vide" titre="Rien à montrer dans la chronologie" texte="Donnez une échéance (et un début) à vos tâches : elles apparaissent ici en barres." />;
  }
  return (
    <View style={{ gap: 12 }} testID="vue-gantt">
      {outils}
      {violees.length ? (
        <View style={[styles.alerte, { borderColor: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.08), borderRadius: 10 }]} accessibilityRole="alert" testID="gantt-violations">
          <Text style={[texteDe(theme), { color: theme.critique, flex: 1, minWidth: 200 }]}>
            ⚠ {violees.length} dépendance{violees.length > 1 ? 's' : ''} non respectée{violees.length > 1 ? 's' : ''} : {violees.slice(0, 3).map(l => `« ${d.taches[l.vers]?.titre} » commence avant la fin de « ${d.taches[l.de]?.titre} »`).join(' ; ')}
            {violees.length > 3 ? '…' : ''}
          </Text>
          <Bouton theme={theme} compact titre="Décaler les suivantes" onPress={decalerTout} testID="gantt-decaler" />
        </View>
      ) : null}
      <View style={[styles.cadre, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
        <View style={[styles.colonneTitres, { width: largeurTitres, borderColor: theme.ligne }]}>
          <View style={[styles.tete, { height: HAUTEUR_TETE, borderColor: theme.ligne }]}>
            <Text style={attenueDe(theme)}>Tâche</Text>
          </View>
          {lignes.map(l =>
            l.groupe ? (
              <View key={l.cle} style={[styles.ligneTitre, { height: HAUTEUR_LIGNE, backgroundColor: teinteTransparente(l.groupe.couleur ?? theme.accent, 0.1) }]}>
                <Text numberOfLines={1} style={[texteDe(theme), { fontWeight: '700' }]}>
                  {l.groupe.titre}
                </Text>
              </View>
            ) : (
              <Pressable key={l.cle} accessibilityRole="button" accessibilityLabel={`Ouvrir ${l.barre!.tache.titre}`} onPress={() => a.ouvrir(l.barre!.tache.id)} style={[styles.ligneTitre, { height: HAUTEUR_LIGNE }]} testID={`gantt-titre-${l.cle}`}>
                <Text numberOfLines={1} style={[texteDe(theme), { textDecorationLine: l.barre!.terminee ? 'line-through' : 'none', color: l.barre!.terminee ? theme.attenue : theme.texte }]}>
                  {l.barre!.jalon ? '◆ ' : ''}
                  {l.barre!.tache.titre}
                </Text>
              </Pressable>
            ),
          )}
        </View>
        <ScrollView ref={defile as never} horizontal style={{ flex: 1 }} contentContainerStyle={{ width: largeurTemps + 24 }} testID="gantt-defilement" accessibilityLabel="Chronologie (défile à l’horizontale)">
          <View style={{ width: largeurTemps + 24 }}>
            <View style={[styles.tete, { height: HAUTEUR_TETE, borderColor: theme.ligne, width: largeurTemps }]}>
              {e.reperes.map(r => (
                <View key={r.jour} style={[styles.repere, { left: position(e, r.jour), borderColor: r.fort ? theme.ligne : 'transparent' }]}>
                  <Text numberOfLines={1} style={[attenueDe(theme), { fontWeight: r.fort ? '700' : '500' }]}>
                    {r.texte}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ height: lignes.length * HAUTEUR_LIGNE, width: largeurTemps }}>
              {/* Grille : un trait par repère fort, week-ends teintés en vue jour. */}
              {e.reperes
                .filter(r => r.fort)
                .map(r => (
                  <View key={`g-${r.jour}`} pointerEvents="none" style={[styles.trait, { left: position(e, r.jour), backgroundColor: theme.ligne }]} />
                ))}
              {lignes.map((l, i) =>
                l.groupe ? <View key={l.cle} pointerEvents="none" style={[styles.fondGroupe, { top: i * HAUTEUR_LIGNE, height: HAUTEUR_LIGNE, backgroundColor: teinteTransparente(l.groupe.couleur ?? theme.accent, 0.06) }]} /> : null,
              )}
              {/* Aujourd'hui. */}
              <View pointerEvents="none" style={[styles.aujourdhui, { left: xAujourdhui, backgroundColor: theme.critique }]} testID="gantt-ligne-aujourdhui" accessibilityLabel={`Aujourd’hui, ${jourLisible(a.etat.aujourdhui, a.etat.aujourdhui, true)}`} />
              {/* Dépendances : coude de la fin de la précédente au début de la suivante. */}
              {liens.map(l => {
                const i1 = indexLigne.get(l.de);
                const i2 = indexLigne.get(l.vers);
                const b1 = lignes[i1 ?? -1]?.barre;
                const b2 = lignes[i2 ?? -1]?.barre;
                if (i1 === undefined || i2 === undefined || !b1 || !b2) return null;
                const x1 = position(e, b1.fin) + e.largeurJour;
                const x2 = position(e, b2.debut);
                const y1 = i1 * HAUTEUR_LIGNE + HAUTEUR_LIGNE / 2;
                const y2 = i2 * HAUTEUR_LIGNE + HAUTEUR_LIGNE / 2;
                const c = l.viole ? theme.critique : theme.attenue;
                const xm = x1 + 6;
                return (
                  <View key={`${l.de}>${l.vers}`} pointerEvents="none" testID={`gantt-dependance-${l.de}-${l.vers}`}>
                    <View style={[styles.segment, { left: Math.min(x1, xm), top: y1, width: Math.abs(xm - x1), height: 2, backgroundColor: c }]} />
                    <View style={[styles.segment, { left: xm, top: Math.min(y1, y2), width: 2, height: Math.abs(y2 - y1), backgroundColor: c }]} />
                    <View style={[styles.segment, { left: Math.min(xm, x2), top: y2, width: Math.max(2, Math.abs(x2 - xm)), height: 2, backgroundColor: c }]} />
                    <View style={[styles.fleche, { left: x2 - 6, top: y2 - 4, borderLeftColor: c }]} />
                  </View>
                );
              })}
              {lignes.map((l, i) =>
                l.barre ? (
                  <View key={l.cle} style={[styles.rangeeTemps, { top: i * HAUTEUR_LIGNE, width: largeurTemps }]} pointerEvents="box-none">
                    <BarreGantt a={a} b={l.barre} e={e} onDeplacer={onDeplacer} onEtirer={onEtirer} onDependance={onDependance} violee={liens.some(x => x.vers === l.cle && x.viole)} libelleDeps={libelleDeps(l.barre.tache)} />
                  </View>
                ) : null,
              )}
            </View>
          </View>
        </ScrollView>
      </View>
      {sansDate.length ? (
        <View style={{ gap: 6 }} testID="gantt-sans-date">
          <Libelle theme={theme}>{`À PLANIFIER (SANS DATE) · ${sansDate.length}`}</Libelle>
          {sansDate.slice(0, 30).map(t => (
            <View key={t.id} style={[styles.rangee, { flexWrap: 'nowrap', minHeight: 44 }]}>
              <Pressable accessibilityRole="button" onPress={() => a.ouvrir(t.id)} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
                <Text numberOfLines={1} style={texteDe(theme)}>
                  {t.titre}
                </Text>
              </Pressable>
              {a.droits(t.projetId).modifier ? (
                <Bouton theme={theme} compact titre="Planifier" libelle={`Planifier « ${t.titre} » d’aujourd’hui à dans 2 jours`} onPress={() => essayer(() => a.etat.maj((x, ctx) => modifierTache(x, t.id, { debut: a.etat.aujourdhui, echeance: { jour: ajouterJours(a.etat.aujourdhui, 2) } }, ctx)))} testID={`gantt-planifier-${t.id}`} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  alerte: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 10, flexWrap: 'wrap' },
  cadre: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden' },
  colonneTitres: { borderRightWidth: 1 },
  tete: { borderBottomWidth: 1, justifyContent: 'center', paddingHorizontal: 10 },
  ligneTitre: { justifyContent: 'center', paddingHorizontal: 10 },
  repere: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', paddingLeft: 4, borderLeftWidth: 1, width: 120 },
  trait: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.6 },
  fondGroupe: { position: 'absolute', left: 0, right: 0 },
  aujourdhui: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.85 },
  rangeeTemps: { position: 'absolute', left: 0, height: HAUTEUR_LIGNE },
  barreZone: { position: 'absolute', top: 6, height: HAUTEUR_LIGNE - 12 },
  barre: { flex: 1, borderWidth: 2, justifyContent: 'center', paddingHorizontal: 8, minHeight: 32 },
  texteBarre: { fontSize: 15, fontWeight: '600' },
  poignee: { position: 'absolute', top: 0, bottom: 0 },
  pastilleLien: { position: 'absolute', top: (HAUTEUR_LIGNE - 12) / 2 - 11, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  ligneTemps: { position: 'absolute', top: 0, height: HAUTEUR_LIGNE, alignItems: 'flex-start' },
  jalonZone: { height: HAUTEUR_LIGNE, alignItems: 'center', justifyContent: 'center' },
  jalon: { width: 18, height: 18, transform: [{ rotate: '45deg' }], borderWidth: 2 },
  etiquetteJalon: { position: 'absolute', left: 30, top: 12, width: 180 },
  segment: { position: 'absolute' },
  fleche: { position: 'absolute', width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 7, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
});
