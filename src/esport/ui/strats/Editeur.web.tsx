/**
 * Éditeur de strats (site et app PC) : barre d'outils, palettes (joueurs,
 * agents, capacités, couleurs), calques, étapes, enregistrement versionné,
 * export PNG, raccourcis clavier. Le canevas Konva (CanevasStrat.web.tsx) est
 * chargé à la demande : Konva n'est téléchargé qu'à l'ouverture de l'éditeur.
 *
 * Raccourcis : V sélection, H main, A agent, C capacité, F flèche, L ligne,
 * R forme, T texte, E gomme, 1 à 5 joueur, Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y)
 * annuler / rétablir, Suppr effacer la sélection, Ctrl+S enregistrer,
 * Ctrl+D dupliquer l'étape, [ et ] étape précédente / suivante, + / - / 0 zoom.
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import type { Strat } from '../../strats/api';
import { creerCacheImages, initiales, trouverAgent, type AgentAsset } from '../../strats/assets';
import {
  CALQUES,
  COULEURS_LIBRES,
  ETAPES_MAX,
  TAILLE_MAX_DOCUMENT,
  VUE_INITIALE,
  annuler,
  executer,
  historique,
  lireDocument,
  retablir,
  tailleDocument,
  zoomer,
  type Action,
  type Calque,
  type FormeZone,
  type Historique,
  type Vue,
} from '../../strats/document';
import { LIBELLES_SIDE } from '../../strats/libelles';
import { ChampNote } from '../ChampNote';
import { Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import type { ExportCanevas, Outil } from './CanevasStrat.web';
import { MentionRiot } from './commun';
import type { PropsEditeur } from './types';

export type { PropsEditeur };

const Canevas = React.lazy(() => import('./CanevasStrat.web'));

const OUTILS: ReadonlyArray<readonly [Outil, string, string]> = [
  ['selection', '↖', 'Sélection et déplacement (V)'],
  ['main', '✋', 'Déplacer la vue (H)'],
  ['agent', '◉', 'Agent (A)'],
  ['capacite', '✦', 'Capacité (C)'],
  ['fleche', '➜', 'Flèche (F)'],
  ['ligne', '╱', 'Ligne (L)'],
  ['forme', '▭', 'Forme (R)'],
  ['texte', 'T', 'Texte (T)'],
  ['gomme', '⌫', 'Gomme (E)'],
];
const TOUCHES_OUTILS: Record<string, Outil> = { v: 'selection', h: 'main', a: 'agent', c: 'capacite', f: 'fleche', l: 'ligne', r: 'forme', t: 'texte', e: 'gomme' };
const NOMS_CALQUES: Record<Calque, string> = { fond: 'Fond (carte)', utilitaires: 'Utilitaires', dessins: 'Dessins', texte: 'Texte' };

const cacheImages = creerCacheImages({
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit),
  caches: (globalThis as { caches?: Parameters<typeof creerCacheImages>[0]['caches'] }).caches,
  creerUrl: b => URL.createObjectURL(b),
});

function IconeAsset({ theme, url, nom, couleur, taille = 30 }: { theme: ThemeHub; url: string | null; nom: string; couleur?: string; taille?: number }) {
  const [echec, setEchec] = useState(false);
  if (url && !echec) return <Image source={{ uri: url }} onError={() => setEchec(true)} style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? theme.surface }} accessibilityLabel={nom} />;
  return (
    <View style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? teinteTransparente(theme.attenue, 0.4), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontSize: taille * 0.38, fontWeight: '800' }}>{initiales(nom)}</Text>
    </View>
  );
}

function Pastille({ theme, actif, onPress, libelle, testID, children, couleur }: { theme: ThemeHub; actif: boolean; onPress(): void; libelle: string; testID: string; children: React.ReactNode; couleur?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={{
        minWidth: 40,
        minHeight: 40,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(theme.rayonMoyen, 10),
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? (couleur ?? theme.accent) : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : theme.surface,
      }}>
      {children}
    </Pressable>
  );
}

export function Editeur({ theme, api, teamId, stratId, large, assets, onRetour, onOuvrir }: PropsEditeur) {
  const [strat, setStrat] = useState<Strat | undefined>();
  const [h, setH] = useState<Historique | undefined>();
  const [revision, setRevision] = useState(0);
  const [enregistre, setEnregistre] = useState<Historique['present'] | undefined>();
  const [etape, setEtape] = useState(0);
  const [outil, setOutil] = useState<Outil>('agent');
  const [joueur, setJoueur] = useState<number | null>(0);
  const [couleurLibre, setCouleurLibre] = useState<string | undefined>();
  const [agentCle, setAgentCle] = useState<string | undefined>();
  const [capaciteCle, setCapaciteCle] = useState<string | undefined>();
  const [formeZone, setFormeZone] = useState<FormeZone | 'aucune'>('cercle');
  const [formeDessin, setFormeDessin] = useState<'rect' | 'ellipse'>('rect');
  const [texte, setTexte] = useState('');
  const [tirets, setTirets] = useState(false);
  const [selection, setSelection] = useState<string | undefined>();
  const [vue, setVue] = useState<Vue>(VUE_INITIALE);
  const [largeur, setLargeur] = useState(0);
  const [conflit, setConflit] = useState<number | undefined>();
  const exportRef = useRef<ExportCanevas | undefined>(undefined);
  const { enCours, erreur, avis, agir, setErreur } = useAgir();

  const charger = useCallback(async () => {
    const s = await api.detail(teamId, stratId);
    const doc = lireDocument(s.donnees);
    setStrat(s);
    setH(historique(doc));
    setEnregistre(doc);
    setRevision(s.revision);
    setEtape(0);
    setConflit(undefined);
  }, [api, teamId, stratId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const doc = h?.present;
  const peutModifier = Boolean(strat?.moi.modifier);
  const modifie = Boolean(doc && enregistre && doc !== enregistre);
  const agents = assets?.agents ?? [];
  const agent: AgentAsset | undefined = (agentCle ? trouverAgent(assets, agentCle) : undefined) ?? (joueur !== null && doc?.joueurs[joueur]?.agent ? trouverAgent(assets, doc.joueurs[joueur].agent as string) : undefined) ?? agents[0];
  const capacite = agent?.capacites.find(c => c.cle === capaciteCle) ?? agent?.capacites[0];
  const couleur = couleurLibre ?? (joueur !== null ? (doc?.joueurs[joueur]?.couleur ?? '#ffffff') : '#ffffff');
  const etapeCourante = doc?.etapes[Math.min(etape, (doc?.etapes.length ?? 1) - 1)];
  const iEtape = doc ? Math.min(etape, doc.etapes.length - 1) : 0;

  const faire = useCallback((a: Action) => setH(x => (x ? executer(x, a) : x)), []);

  const enregistrer = useCallback(
    (forcer?: number) =>
      agir('Enregistrement', async () => {
        if (!doc || !strat) return;
        if (tailleDocument(doc) > TAILLE_MAX_DOCUMENT) throw new Error('Strat trop volumineuse (256 Ko au plus) : retirez des étapes ou des dessins.');
        let miniature: string | undefined;
        try {
          miniature = exportRef.current?.miniature();
        } catch {
          miniature = undefined; // Canevas « contaminé » ou pas prêt : on enregistre sans miniature.
        }
        try {
          const s = await api.enregistrer(teamId, strat.id, { revision: forcer ?? revision, donnees: doc, miniature });
          setStrat(s);
          setRevision(s.revision);
          setEnregistre(doc);
          setConflit(undefined);
          return s.avertissement ? 'Strat enregistrée (miniature non stockée : stockage absent).' : `Strat enregistrée (version ${s.revision}).`;
        } catch (e) {
          if (e instanceof ErreurEsport && e.code === 'conflit') setConflit(Number((e.details as { revision?: number } | undefined)?.revision ?? 0) || undefined);
          throw e;
        }
      }),
    [agir, api, doc, revision, strat, teamId],
  );

  const exporterPng = useCallback(() => {
    void agir('Export', async () => {
      if (!exportRef.current || !strat || !doc) throw new Error('Le canevas n’est pas encore prêt.');
      let url: string;
      try {
        url = exportRef.current.png(2);
      } catch {
        throw new Error('Export impossible : une image n’a pas pu être chargée proprement. Réessayez sans le fond de carte.');
      }
      // Data URL → Blob : un lien court, et le nom de fichier respecté par tous les navigateurs.
      const blob = await (await fetch(url)).blob();
      const lien = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = lien;
      // Nom en ASCII : certains navigateurs ignorent un nom accentué (« download »).
      const nom = strat.titre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'strat';
      a.download = `${nom}-etape-${iEtape + 1}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(lien), 30_000);
      return 'Image PNG exportée.';
    });
  }, [agir, strat, doc, iEtape]);

  // Raccourcis clavier (hors champs de saisie).
  useEffect(() => {
    function touche(ev: KeyboardEvent) {
      const cible = ev.target as HTMLElement | null;
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (ctrl && k === 'z') {
        ev.preventDefault();
        setH(x => (x ? (ev.shiftKey ? retablir(x) : annuler(x)) : x));
      } else if (ctrl && k === 'y') {
        ev.preventDefault();
        setH(x => (x ? retablir(x) : x));
      } else if (ctrl && k === 's') {
        ev.preventDefault();
        if (peutModifier) void enregistrer();
      } else if (ctrl && k === 'd') {
        ev.preventDefault();
        faire({ type: 'dupliquerEtape', etape: iEtape });
        setEtape(iEtape + 1);
      } else if (ctrl || ev.altKey) {
        return;
      } else if ((k === 'delete' || k === 'backspace') && selection) {
        faire({ type: 'supprimer', etape: iEtape, id: selection });
        setSelection(undefined);
      } else if (TOUCHES_OUTILS[k]) setOutil(TOUCHES_OUTILS[k]);
      else if (/^[1-5]$/.test(k)) {
        setJoueur(Number(k) - 1);
        setCouleurLibre(undefined);
      } else if (k === '[') setEtape(Math.max(0, iEtape - 1));
      else if (k === ']') setEtape(Math.min((doc?.etapes.length ?? 1) - 1, iEtape + 1));
      else if (k === '+' || k === '=') setVue(v => zoomer(v, 1.25, { x: largeur / 2, y: largeur / 2 }));
      else if (k === '-') setVue(v => zoomer(v, 1 / 1.25, { x: largeur / 2, y: largeur / 2 }));
      else if (k === '0') setVue(VUE_INITIALE);
      else if (k === 'escape') setSelection(undefined);
    }
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [doc, enregistrer, faire, iEtape, largeur, peutModifier, selection]);

  const surPret = useCallback((e: ExportCanevas) => {
    exportRef.current = e;
  }, []);

  if (!strat || !doc || !h) {
    return (
      <View style={{ gap: 12 }} testID="esport-editeur-chargement">
        <BoutonHub theme={theme} titre="← Strats" onPress={onRetour} testID="esport-editeur-retour" />
        {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-editeur" /> : <Text style={{ color: theme.attenue }}>Chargement de la strat…</Text>}
      </View>
    );
  }

  const taille = Math.max(240, Math.min(largeur || 600, large ? 860 : 720));
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const carteAsset = assets?.cartes.find(c => c.cle === doc.carte.cle);

  const barreOutils = (
    <View style={[styles.ligne, { gap: 6 }]} accessibilityRole="toolbar" accessibilityLabel="Outils" testID="esport-editeur-outils">
      {OUTILS.map(([id, icone, libelle]) => (
        <Pastille key={id} theme={theme} actif={outil === id} onPress={() => setOutil(id)} libelle={libelle} testID={`esport-outil-${id}`}>
          <Text style={{ color: theme.texte, fontSize: 17 }}>{icone}</Text>
        </Pastille>
      ))}
      <View style={{ width: 8 }} />
      <Pastille theme={theme} actif={false} onPress={() => setH(annuler(h))} libelle="Annuler (Ctrl+Z)" testID="esport-editeur-annuler">
        <Text style={{ color: h.passe.length ? theme.texte : theme.attenue, fontSize: 17 }}>↶</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setH(retablir(h))} libelle="Rétablir (Ctrl+Maj+Z)" testID="esport-editeur-retablir">
        <Text style={{ color: h.futur.length ? theme.texte : theme.attenue, fontSize: 17 }}>↷</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1.25, { x: taille / 2, y: taille / 2 }))} libelle="Zoomer (+)" testID="esport-editeur-zoom-plus">
        <Text style={{ color: theme.texte, fontSize: 17 }}>＋</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1 / 1.25, { x: taille / 2, y: taille / 2 }))} libelle="Dézoomer (-)" testID="esport-editeur-zoom-moins">
        <Text style={{ color: theme.texte, fontSize: 17 }}>－</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(VUE_INITIALE)} libelle="Vue entière (0)" testID="esport-editeur-zoom-zero">
        <Text style={{ color: theme.texte, fontSize: 12 }}>{Math.round(vue.echelle * 100)} %</Text>
      </Pastille>
    </View>
  );

  const palette = (
    <View style={{ gap: 10 }}>
      <Panneau theme={theme} testID="esport-editeur-joueurs">
        <Intertitre theme={theme}>Joueurs et couleurs</Intertitre>
        <View style={[styles.ligne, { gap: 6 }]}>
          {doc.joueurs.map((j, i) => (
            <Pastille key={i} theme={theme} actif={joueur === i && !couleurLibre} couleur={j.couleur} onPress={() => (setJoueur(i), setCouleurLibre(undefined))} libelle={`${j.nom} (${i + 1})`} testID={`esport-joueur-${i}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: j.couleur }} />
                <Text style={{ color: theme.texte, fontSize: 12 }}>{i + 1}</Text>
              </View>
            </Pastille>
          ))}
          {COULEURS_LIBRES.map(c => (
            <Pastille key={c} theme={theme} actif={couleurLibre === c} couleur={c} onPress={() => (setCouleurLibre(c), setJoueur(null))} libelle={`Couleur ${c}`} testID={`esport-couleur-${c.slice(1)}`}>
              <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c, borderWidth: 1, borderColor: theme.ligne }} />
            </Pastille>
          ))}
        </View>
        {joueur !== null ? (
          <Champ theme={theme} libelle={`Nom du joueur ${joueur + 1}`} valeur={doc.joueurs[joueur].nom} onChanger={nom => faire({ type: 'joueur', index: joueur, champs: { nom: nom.slice(0, 24) } })} maxLength={24} testID="esport-joueur-nom" />
        ) : null}
      </Panneau>
      {outil === 'agent' || outil === 'capacite' ? (
        <Panneau theme={theme} testID="esport-editeur-agents">
          <Intertitre theme={theme}>{outil === 'agent' ? 'Agent à poser' : 'Capacité à poser'}</Intertitre>
          <View style={[styles.ligne, { gap: 4 }]}>
            {agents.map(a => (
              <Pastille
                key={a.cle}
                theme={theme}
                actif={agent?.cle === a.cle}
                onPress={() => {
                  setAgentCle(a.cle);
                  setCapaciteCle(undefined);
                  if (joueur !== null) faire({ type: 'joueur', index: joueur, champs: { agent: a.cle } });
                }}
                libelle={a.nom}
                testID={`esport-agent-${a.cle}`}>
                <IconeAsset theme={theme} url={a.icone} nom={a.nom} />
              </Pastille>
            ))}
          </View>
          {outil === 'capacite' && agent ? (
            <>
              <View style={[styles.ligne, { gap: 6 }]}>
                {agent.capacites.map(c => (
                  <Pastille key={c.cle} theme={theme} actif={capacite?.cle === c.cle} onPress={() => setCapaciteCle(c.cle)} libelle={`${c.nom} (${c.touche})`} testID={`esport-capacite-${c.cle}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <IconeAsset theme={theme} url={c.icone} nom={c.nom} taille={24} couleur="#334155" />
                      <Text style={{ color: theme.texte, fontSize: 11 }}>{c.touche}</Text>
                    </View>
                  </Pastille>
                ))}
              </View>
              <Text style={attenue}>{capacite ? `${capacite.nom} : choisissez la zone, puis touchez la carte.` : ''}</Text>
              <Segments<FormeZone | 'aucune'> theme={theme} libelle="Zone" valeur={formeZone} options={[['cercle', 'Cercle (smoke, molly)'], ['mur', 'Mur / ligne'], ['cone', 'Cône (flash)'], ['aucune', 'Icône seule']]} onChoisir={setFormeZone} testID="esport-zone" />
            </>
          ) : null}
        </Panneau>
      ) : null}
      {outil === 'texte' ? (
        <Panneau theme={theme}>
          <Champ theme={theme} libelle="Texte à poser (touchez la carte)" valeur={texte} onChanger={setTexte} maxLength={200} testID="esport-editeur-texte" />
        </Panneau>
      ) : null}
      {outil === 'forme' ? (
        <Segments<'rect' | 'ellipse'> theme={theme} libelle="Forme" valeur={formeDessin} options={[['rect', 'Rectangle'], ['ellipse', 'Ellipse']]} onChoisir={setFormeDessin} testID="esport-forme" />
      ) : null}
      {outil === 'fleche' || outil === 'ligne' ? (
        <Segments<'plein' | 'tirets'> theme={theme} libelle="Trait" valeur={tirets ? 'tirets' : 'plein'} options={[['plein', 'Plein'], ['tirets', 'Tirets (rotation)']]} onChoisir={v => setTirets(v === 'tirets')} testID="esport-trait" />
      ) : null}
      {selection && outil === 'selection' ? (
        <BoutonHub
          theme={theme}
          titre="Effacer la sélection (Suppr)"
          variante="danger"
          onPress={() => {
            faire({ type: 'supprimer', etape: iEtape, id: selection });
            setSelection(undefined);
          }}
          testID="esport-editeur-effacer"
        />
      ) : null}
      <Panneau theme={theme} testID="esport-editeur-calques">
        <Intertitre theme={theme}>Calques</Intertitre>
        {CALQUES.map(c => (
          <View key={c} style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ color: theme.texte, fontSize: 13, flex: 1 }}>{NOMS_CALQUES[c]}</Text>
            <BoutonHub theme={theme} titre={doc.calques[c].visible ? '👁' : '—'} libelle={`${doc.calques[c].visible ? 'Masquer' : 'Afficher'} ${NOMS_CALQUES[c]}`} onPress={() => faire({ type: 'calque', calque: c, champs: { visible: !doc.calques[c].visible } })} testID={`esport-calque-${c}-visible`} />
            {c !== 'fond' ? (
              <BoutonHub theme={theme} titre={doc.calques[c].verrou ? '🔒' : '🔓'} libelle={`${doc.calques[c].verrou ? 'Déverrouiller' : 'Verrouiller'} ${NOMS_CALQUES[c]}`} onPress={() => faire({ type: 'calque', calque: c, champs: { verrou: !doc.calques[c].verrou } })} testID={`esport-calque-${c}-verrou`} />
            ) : null}
          </View>
        ))}
      </Panneau>
    </View>
  );

  const etapes = (
    <Panneau theme={theme} testID="esport-editeur-etapes">
      <View style={[styles.ligne, { gap: 6 }]}>
        <BoutonHub theme={theme} titre="◀" libelle="Étape précédente ([)" onPress={() => setEtape(Math.max(0, iEtape - 1))} desactive={iEtape === 0} testID="esport-etape-precedente" />
        <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }} testID="esport-etape-position">
          Étape {iEtape + 1} / {doc.etapes.length}
        </Text>
        <BoutonHub theme={theme} titre="▶" libelle="Étape suivante (])" onPress={() => setEtape(Math.min(doc.etapes.length - 1, iEtape + 1))} desactive={iEtape >= doc.etapes.length - 1} testID="esport-etape-suivante" />
        <BoutonHub
          theme={theme}
          titre="+ Étape"
          desactive={doc.etapes.length >= ETAPES_MAX}
          onPress={() => {
            faire({ type: 'ajouterEtape', apres: iEtape });
            setEtape(iEtape + 1);
          }}
          testID="esport-etape-ajouter"
        />
        <BoutonHub
          theme={theme}
          titre="Dupliquer l’étape"
          desactive={doc.etapes.length >= ETAPES_MAX}
          onPress={() => {
            faire({ type: 'dupliquerEtape', etape: iEtape });
            setEtape(iEtape + 1);
          }}
          testID="esport-etape-dupliquer"
        />
        <BoutonHub
          theme={theme}
          titre="Supprimer l’étape"
          variante="danger"
          desactive={doc.etapes.length <= 1}
          onPress={() => {
            faire({ type: 'supprimerEtape', etape: iEtape });
            setEtape(Math.max(0, iEtape - 1));
          }}
          testID="esport-etape-supprimer"
        />
      </View>
      {etapeCourante ? (
        <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
          <Champ theme={theme} libelle="Titre de l’étape" valeur={etapeCourante.titre} onChanger={titre => faire({ type: 'titreEtape', etape: iEtape, titre })} maxLength={60} style={{ flex: 1, minWidth: 180 }} testID="esport-etape-titre" />
          <ChampNote theme={theme} libelle="Note de l’étape" valeur={etapeCourante.note} onChanger={note => faire({ type: 'noteEtape', etape: iEtape, note })} maxLength={2000} style={{ flex: 2, minWidth: 220 }} testID="esport-etape-note" />
        </View>
      ) : null}
    </Panneau>
  );

  return (
    <View style={{ gap: 12 }} testID="esport-editeur">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={[styles.ligne, { flex: 1 }]}>
          <BoutonHub theme={theme} titre="← Strats" onPress={onRetour} testID="esport-editeur-retour" />
          <Text style={{ color: theme.texte, fontSize: 20, fontWeight: '800', ...police(theme.policeTitre) }} numberOfLines={1} testID="esport-editeur-titre">
            {strat.titre}
          </Text>
          <Text style={attenue}>
            {doc.carte.nom} · {LIBELLES_SIDE[doc.side]} · version {revision}
            {modifie ? ' · modifications non enregistrées' : ''}
          </Text>
        </View>
        <View style={styles.ligne}>
          {peutModifier ? <BoutonHub theme={theme} titre={enCours === 'Enregistrement' ? 'Enregistrement…' : 'Enregistrer'} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID="esport-editeur-enregistrer" /> : null}
          <BoutonHub theme={theme} titre="Exporter en PNG" onPress={exporterPng} testID="esport-editeur-png" />
          {peutModifier ? (
            <BoutonHub
              theme={theme}
              titre="Dupliquer la strat"
              onPress={() =>
                void agir('Duplication', async () => {
                  const copie = await api.dupliquer(teamId, strat.id);
                  onOuvrir(copie.id);
                })
              }
              testID="esport-editeur-dupliquer"
            />
          ) : null}
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-editeur" />
      {conflit !== undefined ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre="Recharger la version du serveur" onPress={() => void agir('', charger)} testID="esport-editeur-recharger" />
          <BoutonHub theme={theme} titre="Garder la mienne (écraser)" variante="danger" onPress={() => (setErreur(undefined), void enregistrer(conflit))} testID="esport-editeur-ecraser" />
        </View>
      ) : null}
      {!peutModifier ? <Text style={attenue}>Lecture seule : votre rôle ne permet pas de modifier les strats.</Text> : null}
      {peutModifier ? (
        <View style={[styles.ligne, { gap: 8 }]}>
          <Segments
            theme={theme}
            libelle="Side"
            valeur={doc.side}
            options={[['attaque', 'Attaque'], ['defense', 'Défense']] as const}
            onChoisir={side => faire({ type: 'side', side })}
            testID="esport-editeur-side"
          />
          <View style={[styles.ligne, { gap: 4, flex: 1 }]} accessibilityRole="radiogroup" accessibilityLabel="Carte">
            {(assets?.cartes ?? []).map(c => (
              <Pastille key={c.cle} theme={theme} actif={doc.carte.cle === c.cle} onPress={() => faire({ type: 'carte', carte: { cle: c.cle, nom: c.nom, image: c.minimap } })} libelle={`Carte ${c.nom}`} testID={`esport-editeur-carte-${c.cle}`}>
                <Text style={{ color: theme.texte, fontSize: 12 }}>{c.nom}</Text>
              </Pastille>
            ))}
          </View>
        </View>
      ) : null}
      {peutModifier ? barreOutils : null}
      <View style={{ flexDirection: large ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, width: '100%', gap: 8 }} onLayout={ev => setLargeur(ev.nativeEvent.layout.width)}>
          <Suspense fallback={<Text style={attenue}>Chargement de l’éditeur…</Text>}>
            <Canevas
              doc={doc}
              fond={doc.carte.image ?? carteAsset?.minimap ?? null}
              etape={iEtape}
              taille={taille}
              outil={peutModifier ? outil : 'main'}
              couleur={couleur}
              joueur={couleurLibre ? null : joueur}
              agent={agent}
              capacite={capacite}
              formeZone={formeZone}
              formeDessin={formeDessin}
              texte={texte}
              tirets={tirets}
              epaisseur={5}
              selection={selection}
              onSelection={setSelection}
              vue={vue}
              onVue={setVue}
              onAction={peutModifier ? faire : () => undefined}
              images={cacheImages}
              onPret={surPret}
            />
          </Suspense>
          {!carteAsset?.minimap && !doc.carte.image ? <Text style={attenue}>Fond générique : l’image de la carte n’a pas pu être chargée (hors ligne ou API indisponible).</Text> : null}
          {etapes}
        </View>
        {peutModifier ? <View style={{ width: large ? 320 : '100%' }}>{palette}</View> : null}
      </View>
      <MentionRiot theme={theme} />
    </View>
  );
}
