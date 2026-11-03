/**
 * Dossiers des visuels (migration 0041, docs/esport/visuels.md, « Dossiers »), dans le style du Drive et avec ses
 * briques (fil d'Ariane, arborescence latérale, glisser-déposer, toast « Annuler ») : les modèles du club et les
 * visuels générés d'une portée se rangent dans des dossiers (Annonces, Résultats, Recrues, Programmes, Sponsors,
 * Divers par défaut ; créer, renommer, déplacer, supprimer). Vue grille ou liste, recherche par nom.
 *
 * Le serveur vérifie tout (cm.editer de la portée, cycles, dossiers par défaut à la racine) ; l'écran refuse déjà
 * clairement pendant le glisser ce qui serait refusé.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { descendantsDe, groupesAnnulation } from '../../../cm/drive';
import type { ApiVisuels, DossierVisuel, ElementVisuel } from '../../../cm/visuels/api';
import { trDr, type CleDr } from '../../../i18n/drive';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { BoutonConfirme, styles, useAgir } from '../../commun';
import { Carte, ESP, EtatVide, Grille, MenuActions, Volet, attenue, texte, type EtatPresse } from '../../design';
import { ToastAnnuler } from '../../strats/Suppression';
import { Aide } from '../commun';
import { ArbreDossiers, ChoixDansArbre, FilAriane, styleCible, type NoeudArbre } from '../drive/explorateur';
import { useGlisser } from '../drive/glisser';

export const nomDossierVisuel = (d: { nom: string | null; cle: string | null }): string => d.nom ?? (d.cle ? trVi(`dossiers.${d.cle}` as CleVi) : trVi('dossiers.sans_nom'));

/** Élément rangé (modèle ou visuel) tel que l'explorateur l'affiche. */
export interface ElementRange {
  genre: 'modele' | 'visuel';
  id: string;
  nom: string;
  dossierId: string | null;
  modifiable: boolean;
  /** Aperçu (grille), badges, boutons propres à l'élément. */
  apercu?: React.ReactNode;
  badges?: React.ReactNode;
  sous?: string;
  actions?: React.ReactNode;
  onOuvrir?(): void;
}

type Dialogue = { genre: 'nouveau'; nom: string } | { genre: 'renommer'; d: DossierVisuel; nom: string } | { genre: 'deplacer'; elements: ElementVisuel[] };

const cle = (e: ElementVisuel) => `${e.genre}:${e.id}`;

export function ExplorateurVisuels({
  theme,
  api,
  large,
  portee,
  dossiers,
  editer,
  courant,
  onOuvrir,
  elements,
  avant,
  onChange,
  testID,
}: {
  theme: ThemeHub;
  api: ApiVisuels;
  large: boolean;
  portee: string;
  dossiers: DossierVisuel[];
  editer: boolean;
  courant: string | null;
  onOuvrir(id: string | null): void;
  elements: ElementRange[];
  /** Au-dessus du contenu, à la racine seulement (modèles par défaut…). */
  avant?: React.ReactNode;
  onChange(): Promise<void> | void;
  testID: string;
}) {
  const [vue, setVue] = useState<'grille' | 'liste'>(large ? 'grille' : 'liste');
  const [q, setQ] = useState('');
  const [selection, setSelection] = useState<Map<string, ElementVisuel>>(new Map());
  const [ancre, setAncre] = useState<string | undefined>();
  const [dialogue, setDialogue] = useState<Dialogue | undefined>();
  const [toast, setToast] = useState<{ cle: string; texte: string; annuler?: () => void } | undefined>();
  const { agir, erreur: erreurAgir } = useAgir();
  const [erreurLocale, setErreurLocale] = useState<string | undefined>();
  const erreur = erreurLocale ?? erreurAgir;

  const parId = useMemo(() => new Map(dossiers.map(d => [d.id, d])), [dossiers]);
  const noeuds: NoeudArbre[] = useMemo(() => dossiers.map(d => ({ id: d.id, parentId: d.parentId, nom: nomDossierVisuel(d) })), [dossiers]);
  const chemin: Array<{ id: string; nom: string }> = [];
  for (let x = courant ? parId.get(courant) : undefined, n = 0; x && n < 12; x = x.parentId ? parId.get(x.parentId) : undefined, n++) chemin.unshift({ id: x.id, nom: nomDossierVisuel(x) });
  const recherche = q.trim().toLocaleLowerCase();
  const sousDossiers = (recherche ? dossiers.filter(d => nomDossierVisuel(d).toLocaleLowerCase().includes(recherche)) : dossiers.filter(d => (d.parentId ?? null) === courant)).sort((a, b) =>
    a.cle && !b.cle ? -1 : !a.cle && b.cle ? 1 : nomDossierVisuel(a).localeCompare(nomDossierVisuel(b)),
  );
  const visibles = (recherche ? elements.filter(e => e.nom.toLocaleLowerCase().includes(recherche)) : elements.filter(e => (e.dossierId && parId.has(e.dossierId) ? e.dossierId : null) === courant)).sort((a, b) => a.nom.localeCompare(b.nom));
  const tous: ElementVisuel[] = [...sousDossiers.map(d => ({ genre: 'dossier' as const, id: d.id })), ...visibles.map(e => ({ genre: e.genre, id: e.id }))];
  const infos = new Map<string, { genre: ElementVisuel['genre']; id: string; parentId: string | null; modifiable: boolean; systeme: boolean; nom: string }>([
    ...sousDossiers.map(d => [`dossier:${d.id}`, { genre: 'dossier' as const, id: d.id, parentId: d.parentId, modifiable: editer, systeme: d.systeme, nom: nomDossierVisuel(d) }] as const),
    ...visibles.map(e => [`${e.genre}:${e.id}`, { genre: e.genre, id: e.id, parentId: e.dossierId && parId.has(e.dossierId) ? e.dossierId : null, modifiable: e.modifiable, systeme: false, nom: e.nom }] as const),
  ]);
  const nomCible = (id: string | null) => (id ? nomDossierVisuel(parId.get(id) ?? { nom: null, cle: null }) : trVi('dossiers.racine'));

  /** Même règle que le Drive : permission, dossier par défaut à la racine, jamais dans lui-même, déjà ici. */
  const refus = (els: Array<{ genre: string; id: string; parentId: string | null; modifiable: boolean; systeme: boolean }>, cible: string | null): string | null => {
    if (!els.length) return trDr('glisser.refus.meme');
    if (els.some(e => !e.modifiable)) return trDr('glisser.refus.permission' as CleDr);
    if (els.some(e => e.genre === 'dossier' && e.systeme && cible !== null)) return trDr('glisser.refus.systeme');
    if (cible !== null && els.some(e => e.genre === 'dossier' && descendantsDe(dossiers, e.id).has(cible))) return trDr('glisser.refus.boucle');
    if (els.every(e => e.parentId === cible)) return trDr('glisser.refus.meme');
    return null;
  };

  const deplacer = (els: ElementVisuel[], cible: string | null) =>
    agir('deplacer', async () => {
      setErreurLocale(undefined);
      const r = await api.deplacer({ elements: els, dossierId: cible });
      setSelection(new Map());
      await onChange();
      if (r.erreurs.length) setErreurLocale(trVi('dossiers.erreurs', { n: r.erreurs.length, liste: r.erreurs.map(x => x.erreur).join(' · ') }));
      const faits = els.filter(e => r.faits.includes(e.id));
      if (!faits.length) return undefined;
      setToast({
        cle: `${Date.now()}`,
        texte: trVi('dossiers.deplace', { n: faits.length, nom: nomCible(cible) }),
        annuler: () => {
          setToast(undefined);
          void agir('annuler', async () => {
            for (const g of groupesAnnulation(faits, r.avant)) await api.deplacer({ elements: g.elements, dossierId: g.dossierId });
            await onChange();
            setToast({ cle: `${Date.now()}`, texte: trVi('dossiers.annule') });
            return undefined;
          });
        },
      });
      return undefined;
    });

  const glisser = useGlisser({
    actif: editer,
    couleurs: { fond: theme.surface, texte: theme.texte, accent: theme.accent, critique: theme.critique },
    sources: c => (selection.has(c) ? [...selection.keys()] : [c]).filter(x => infos.has(x)),
    texteSources: src => (src.length === 1 ? (infos.get(src[0])?.nom ?? '') : trVi('dossiers.selection', { n: src.length })),
    verifier: (src, c) => {
      const cible = c === 'racine' ? null : c;
      const els = src.map(x => infos.get(x)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      return { refus: refus(els, cible), libelle: nomCible(cible) };
    },
    lacher: (src, c) =>
      void deplacer(
        src.map(x => infos.get(x)).filter((x): x is NonNullable<typeof x> => Boolean(x)).map(x => ({ genre: x.genre, id: x.id })),
        c === 'racine' ? null : c,
      ),
    refuse: r => setErreurLocale(r),
    cadre: (cles, ajout) =>
      setSelection(s => {
        const n = ajout ? new Map(s) : new Map<string, ElementVisuel>();
        for (const c of cles) {
          const i = infos.get(c);
          if (i) n.set(c, { genre: i.genre, id: i.id });
        }
        return n;
      }),
    videClique: () => setSelection(new Map()),
  });

  const basculer = (e: ElementVisuel) =>
    setSelection(s => {
      const n = new Map(s);
      if (n.has(cle(e))) n.delete(cle(e));
      else n.set(cle(e), e);
      return n;
    });
  const clic = (e: ElementVisuel, ouvrir: () => void) => {
    if (glisser.vientDeGlisser()) return;
    const m = glisser.modificateurs();
    if (m.plage && ancre) {
      const i = tous.findIndex(x => cle(x) === ancre);
      const j = tous.findIndex(x => cle(x) === cle(e));
      if (i >= 0 && j >= 0) {
        setSelection(s => new Map([...s, ...tous.slice(Math.min(i, j), Math.max(i, j) + 1).map(x => [cle(x), x] as const)]));
        return;
      }
    }
    setAncre(cle(e));
    if (m.ajout || m.plage || selection.size) basculer(e);
    else ouvrir();
  };

  const menuDossier = (d: DossierVisuel) => (
    <MenuActions
      theme={theme}
      libelle={trVi('dossiers.menu')}
      testID={`${testID}-dossier-${d.id}-menu`}
      actions={[
        { titre: trVi('dossiers.ouvrir'), onPress: () => onOuvrir(d.id) },
        editer && { titre: trVi('dossiers.renommer'), onPress: () => setDialogue({ genre: 'renommer', d, nom: nomDossierVisuel(d) }) },
        editer && !d.systeme && { titre: trVi('dossiers.deplacer'), onPress: () => setDialogue({ genre: 'deplacer', elements: [{ genre: 'dossier', id: d.id }] }) },
        editer &&
          !d.systeme && {
            titre: trVi('dossiers.supprimer'),
            danger: true,
            onPress: () =>
              void agir('supprimer', async () => {
                await api.supprimerDossier(d.id);
                if (courant === d.id) onOuvrir(d.parentId);
                await onChange();
                return undefined;
              }),
          },
      ]}
    />
  );
  const menuElement = (e: ElementRange) =>
    e.modifiable ? <MenuActions theme={theme} libelle={trVi('dossiers.menu')} testID={`${testID}-${e.genre}-${e.id}-menu`} actions={[{ titre: trVi('dossiers.deplacer'), onPress: () => setDialogue({ genre: 'deplacer', elements: [{ genre: e.genre, id: e.id }] }) }]} /> : null;
  const caseSel = (e: ElementVisuel, nom: string) => (selection.size ? <Case theme={theme} coche={selection.has(cle(e))} libelle={trDr('element.selectionner', { nom })} onChanger={() => basculer(e)} testID={`${testID}-${e.genre}-${e.id}-case`} /> : null);
  const enveloppe = (e: ElementVisuel, corps: React.ReactNode) => (
    <View
      key={cle(e)}
      {...glisser.marque({ source: cle(e), cible: e.genre === 'dossier' ? e.id : undefined })}
      style={[{ position: 'relative', borderRadius: 14, borderWidth: 2, borderColor: selection.has(cle(e)) ? theme.accent : 'transparent', opacity: glisser.glisses.includes(cle(e)) ? 0.45 : 1, userSelect: 'none' } as object, e.genre === 'dossier' ? styleCible(theme, glisser, e.id) : undefined]}>
      {corps}
    </View>
  );

  const carteDossier = (d: DossierVisuel) =>
    enveloppe(
      { genre: 'dossier', id: d.id },
      <Carte theme={theme} dense onPress={() => clic({ genre: 'dossier', id: d.id }, () => onOuvrir(d.id))} libelle={nomDossierVisuel(d)} testID={`${testID}-dossier-${d.id}`}>
        <View style={[styles.ligne, { gap: 6, flexWrap: 'nowrap', paddingRight: 64 }]}>
          <Text style={{ fontSize: 26 }}>📁</Text>
          <Text style={{ ...texte(theme, 14), fontWeight: '700', flex: 1 }} numberOfLines={2}>
            {nomDossierVisuel(d)}
          </Text>
        </View>
        <Text style={attenue(theme, 12)}>{trVi('dossiers.contenu', { m: d.modeles, v: d.visuels })}</Text>
        <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {caseSel({ genre: 'dossier', id: d.id }, nomDossierVisuel(d))}
          {menuDossier(d)}
        </View>
      </Carte>,
    );
  const carteElement = (e: ElementRange) =>
    enveloppe(
      { genre: e.genre, id: e.id },
      <Carte theme={theme} dense onPress={e.onOuvrir ? () => clic({ genre: e.genre, id: e.id }, () => e.onOuvrir?.()) : undefined} libelle={e.nom} testID={`${testID}-${e.genre}-${e.id}`}>
        {e.apercu}
        <Text style={{ ...texte(theme, 14), fontWeight: '700', paddingRight: 64 }} numberOfLines={2}>
          {e.nom}
        </Text>
        {e.badges}
        {e.actions}
        <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {caseSel({ genre: e.genre, id: e.id }, e.nom)}
          {menuElement(e)}
        </View>
      </Carte>,
    );
  const ligne = (e: ElementVisuel, glyphe: string, nom: string, sous: string, ouvrir: (() => void) | undefined, menu: React.ReactNode, extra?: React.ReactNode) =>
    enveloppe(
      e,
      <View style={[styles.ligne, { gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingVertical: 4, flexWrap: 'nowrap' }]}>
        {caseSel(e, nom)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nom}
          onPress={ouvrir ? () => clic(e, ouvrir) : undefined}
          onLongPress={glisser.disponible || !editer ? undefined : () => basculer(e)}
          testID={`${testID}-${e.genre}-${e.id}-ligne`}
          style={(p: EtatPresse) => ({ flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ESP.s, borderRadius: 8, paddingHorizontal: 4, backgroundColor: selection.has(cle(e)) ? teinteTransparente(theme.accent, 0.16) : p.hovered ? teinteTransparente(theme.accent, 0.06) : 'transparent' })}>
          <Text style={{ fontSize: 20 }}>{glyphe}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={1}>
              {nom}
            </Text>
            {sous ? (
              <Text style={attenue(theme, 12)} numberOfLines={1}>
                {sous}
              </Text>
            ) : null}
          </View>
          {extra}
        </Pressable>
        {menu}
      </View>,
    );

  const vide = !sousDossiers.length && !visibles.length;
  const contenu = (
    <View style={{ flex: 1, minWidth: 0, gap: ESP.m }} {...glisser.marque({ zone: true })}>
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trVi('dossiers.recherche')} valeur={q} onChanger={setQ} maxLength={80} testID={`${testID}-recherche`} style={{ flex: 1, minWidth: 180 }} />
        {q ? <BoutonHub theme={theme} titre={trVi('dossiers.effacer')} onPress={() => setQ('')} testID={`${testID}-recherche-effacer`} /> : null}
        {editer ? <BoutonHub theme={theme} titre={trVi('dossiers.nouveau')} onPress={() => setDialogue({ genre: 'nouveau', nom: '' })} testID={`${testID}-nouveau`} /> : null}
        <BoutonHub theme={theme} titre={vue === 'grille' ? `☰ ${trVi('dossiers.liste')}` : `▦ ${trVi('dossiers.grille')}`} libelle={trVi('dossiers.vue')} onPress={() => setVue(v => (v === 'grille' ? 'liste' : 'grille'))} testID={`${testID}-vue`} />
      </View>
      {recherche ? null : <FilAriane theme={theme} racine={trVi('dossiers.racine')} chemin={chemin} onOuvrir={onOuvrir} glisser={glisser} testID={`${testID}-ariane`} />}
      {erreur ? (
        <Text style={{ ...texte(theme, 13), color: theme.critique }} accessibilityRole="alert" testID={`${testID}-erreur`}>
          {erreur}
        </Text>
      ) : null}
      {selection.size ? (
        <View style={[styles.ligne, { gap: ESP.xs }]} testID={`${testID}-barre-selection`}>
          <Text style={texte(theme, 13)}>{trVi('dossiers.selection', { n: selection.size })}</Text>
          <BoutonHub theme={theme} titre={trVi('dossiers.tout')} onPress={() => setSelection(new Map(tous.map(e => [cle(e), e])))} testID={`${testID}-selection-tout`} />
          {editer ? <BoutonHub theme={theme} titre={trVi('dossiers.deplacer')} onPress={() => setDialogue({ genre: 'deplacer', elements: [...selection.values()] })} testID={`${testID}-selection-deplacer`} /> : null}
          <BoutonHub theme={theme} titre={trVi('dossiers.annuler_selection')} onPress={() => setSelection(new Map())} testID={`${testID}-selection-annuler`} />
        </View>
      ) : null}
      {!recherche && !courant ? avant : null}
      {vide ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="📁" titre={recherche ? trVi('dossiers.aucun_resultat') : nomCible(courant)} texte={recherche ? '' : trVi('dossiers.vide')} />
        </Carte>
      ) : vue === 'grille' ? (
        <Grille min={large ? 240 : 160} testID={`${testID}-grille`}>
          {[...sousDossiers.map(carteDossier), ...visibles.map(carteElement)]}
        </Grille>
      ) : (
        <View testID={`${testID}-liste`}>
          {sousDossiers.map(d => ligne({ genre: 'dossier', id: d.id }, '📁', nomDossierVisuel(d), trVi('dossiers.contenu', { m: d.modeles, v: d.visuels }), () => onOuvrir(d.id), menuDossier(d)))}
          {visibles.map(e => ligne({ genre: e.genre, id: e.id }, e.genre === 'modele' ? '◈' : '🖼', e.nom, e.sous ?? '', e.onOuvrir, menuElement(e), e.actions))}
        </View>
      )}
      {editer ? <Aide theme={theme}>{glisser.disponible ? trVi('dossiers.aide') : trVi('dossiers.aide_mobile')}</Aide> : null}
    </View>
  );

  return (
    <View ref={glisser.ref as never} style={{ gap: ESP.m }} testID={testID}>
      <View style={{ flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' }}>
        {large ? (
          <View style={{ width: 230, flexShrink: 0, borderRightWidth: 1, borderRightColor: theme.ligne, paddingRight: ESP.xs }}>
            <ArbreDossiers theme={theme} titre={trVi('dossiers.arbre')} racine={trVi('dossiers.racine')} dossiers={noeuds} courant={courant} onOuvrir={onOuvrir} glisser={glisser} testID={`${testID}-arbre`} />
          </View>
        ) : null}
        {contenu}
      </View>

      {dialogue?.genre === 'nouveau' ? (
        <Volet theme={theme} visible titre={trVi('dossiers.nouveau')} onFermer={() => setDialogue(undefined)} testID={`${testID}-volet-nouveau`}>
          <Champ theme={theme} libelle={trVi('dossiers.nom')} valeur={dialogue.nom} onChanger={nom => setDialogue({ ...dialogue, nom })} maxLength={80} testID={`${testID}-nouveau-nom`} />
          <BoutonHub
            theme={theme}
            titre={trVi('dossiers.creer')}
            variante="plein"
            desactive={!dialogue.nom.trim()}
            onPress={() =>
              void agir('creer', async () => {
                await api.creerDossier({ portee, parentId: courant, nom: dialogue.nom.trim() });
                setDialogue(undefined);
                await onChange();
                return undefined;
              })
            }
            testID={`${testID}-nouveau-ok`}
          />
        </Volet>
      ) : null}
      {dialogue?.genre === 'renommer' ? (
        <Volet theme={theme} visible titre={trVi('dossiers.renommer')} onFermer={() => setDialogue(undefined)} testID={`${testID}-volet-renommer`}>
          <Champ theme={theme} libelle={trVi('dossiers.nom')} valeur={dialogue.nom} onChanger={nom => setDialogue({ ...dialogue, nom })} maxLength={80} testID={`${testID}-renommer-nom`} />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trVi('dossiers.enregistrer')}
              variante="plein"
              desactive={!dialogue.nom.trim()}
              onPress={() =>
                void agir('renommer', async () => {
                  await api.modifierDossier(dialogue.d.id, { nom: dialogue.nom.trim() });
                  setDialogue(undefined);
                  await onChange();
                  return undefined;
                })
              }
              testID={`${testID}-renommer-ok`}
            />
            {dialogue.d.systeme ? (
              <BoutonConfirme
                theme={theme}
                titre={trVi('dossiers.nom_defaut')}
                confirmation={trVi('dossiers.nom_defaut')}
                onConfirme={() =>
                  void agir('renommer', async () => {
                    await api.modifierDossier(dialogue.d.id, { nom: null });
                    setDialogue(undefined);
                    await onChange();
                    return undefined;
                  })
                }
                testID={`${testID}-renommer-defaut`}
              />
            ) : null}
          </View>
        </Volet>
      ) : null}
      {dialogue?.genre === 'deplacer' ? (
        <Volet theme={theme} visible titre={trVi('dossiers.deplacer')} onFermer={() => setDialogue(undefined)} testID={`${testID}-volet-deplacer`}>
          <ChoixDansArbre
            theme={theme}
            racine={trVi('dossiers.racine')}
            dossiers={noeuds}
            exclure={dialogue.elements.filter(e => e.genre === 'dossier').map(e => e.id)}
            titreBouton={trVi('dossiers.deplacer_ici')}
            onChoisir={id => {
              const els = dialogue.elements;
              setDialogue(undefined);
              void deplacer(els, id);
            }}
            testID={`${testID}-destination`}
          />
        </Volet>
      ) : null}
      {toast ? <ToastAnnuler theme={theme} cle={toast.cle} texte={toast.texte} action={toast.annuler ? { titre: trVi('dossiers.annuler'), onPress: toast.annuler } : undefined} onFermer={() => setToast(undefined)} testID={`${testID}-toast`} /> : null}
    </View>
  );
}

/** Options « dossier » d'un choix (génération) : selon le genre, racine, puis l'arbre aplati (« Annonces › Playoffs »). */
export function optionsDossiers(dossiers: readonly DossierVisuel[]): Array<{ id: string; nom: string }> {
  const parId = new Map(dossiers.map(d => [d.id, d]));
  const chemin = (d: DossierVisuel): string => {
    const noms: string[] = [];
    for (let x: DossierVisuel | undefined = d, n = 0; x && n < 12; x = x.parentId ? parId.get(x.parentId) : undefined, n++) noms.unshift(nomDossierVisuel(x));
    return noms.join(' › ');
  };
  return [
    { id: 'auto', nom: trVi('dossiers.auto') },
    { id: 'racine', nom: trVi('dossiers.racine_choix') },
    ...dossiers.map(d => ({ id: d.id, nom: chemin(d) })).sort((a, b) => a.nom.localeCompare(b.nom)),
  ];
}
