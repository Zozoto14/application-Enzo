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
import { agentsActifs, cartesDuPool } from '../../jeux/profil';
import type { PropsEditeur } from './types';
import { tr } from '../../i18n';

export type { PropsEditeur };

const Canevas = React.lazy(() => import('./CanevasStrat.web'));

const outilsEditeur = (): ReadonlyArray<readonly [Outil, string, string]> => [
  ['selection', '↖', tr('strats.editeur.selection_et_deplacement_v')],
  ['main', '✋', tr('strats.editeur.deplacer_la_vue_h')],
  ['agent', '◉', tr('strats.editeur.agent_a')],
  ['capacite', '✦', tr('strats.editeur.capacite_c')],
  ['fleche', '➜', tr('strats.editeur.fleche_f')],
  ['ligne', '╱', tr('strats.editeur.ligne_l')],
  ['forme', '▭', tr('strats.editeur.forme_r')],
  ['texte', 'T', tr('strats.editeur.texte_t')],
  ['gomme', '⌫', tr('strats.editeur.gomme_e')],
];
const TOUCHES_OUTILS: Record<string, Outil> = { v: 'selection', h: 'main', a: 'agent', c: 'capacite', f: 'fleche', l: 'ligne', r: 'forme', t: 'texte', e: 'gomme' };
const NOMS_CALQUES: Record<Calque, string> = { get fond() {
      return tr('strats.editeur.fond_carte');
    }, get utilitaires() {
      return tr('review.libelles.utilitaires');
    }, get dessins() {
      return tr('strats.editeur.dessins');
    }, get texte() {
      return tr('review.dessin.texte');
    } };

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
  const agents = agentsActifs(assets);
  const agent: AgentAsset | undefined = (agentCle ? trouverAgent(assets, agentCle) : undefined) ?? (joueur !== null && doc?.joueurs[joueur]?.agent ? trouverAgent(assets, doc.joueurs[joueur].agent as string) : undefined) ?? agents[0];
  const capacite = agent?.capacites.find(c => c.cle === capaciteCle) ?? agent?.capacites[0];
  const couleur = couleurLibre ?? (joueur !== null ? (doc?.joueurs[joueur]?.couleur ?? '#ffffff') : '#ffffff');
  const etapeCourante = doc?.etapes[Math.min(etape, (doc?.etapes.length ?? 1) - 1)];
  const iEtape = doc ? Math.min(etape, doc.etapes.length - 1) : 0;

  const faire = useCallback((a: Action) => setH(x => (x ? executer(x, a) : x)), []);

  const enregistrer = useCallback(
    (forcer?: number) =>
      agir('enregistrement', async () => {
        if (!doc || !strat) return;
        if (tailleDocument(doc) > TAILLE_MAX_DOCUMENT) throw new Error(tr('strats.editeur.strat_trop_volumineuse_256'));
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
          return s.avertissement ? tr('strats.editeur.strat_enregistree_miniature_no') : tr('strats.editeur.strat_enregistree_version', { revision: s.revision });
        } catch (e) {
          if (e instanceof ErreurEsport && e.code === 'conflit') setConflit(Number((e.details as { revision?: number } | undefined)?.revision ?? 0) || undefined);
          throw e;
        }
      }),
    [agir, api, doc, revision, strat, teamId],
  );

  const exporterPng = useCallback(() => {
    void agir('export', async () => {
      if (!exportRef.current || !strat || !doc) throw new Error(tr('strats.editeur.le_canevas_n_est'));
      let url: string;
      try {
        url = exportRef.current.png(2);
      } catch {
        throw new Error(tr('strats.editeur.export_impossible_une_image'));
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
      return tr('strats.editeur.image_png_exportee');
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
        <BoutonHub theme={theme} titre={tr('strats.editeur.strats')} onPress={onRetour} testID="esport-editeur-retour" />
        {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-editeur" /> : <Text style={{ color: theme.attenue }}>{tr('strats.editeur.chargement_de_la_strat')}</Text>}
      </View>
    );
  }

  const taille = Math.max(240, Math.min(largeur || 600, large ? 860 : 720));
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const carteAsset = assets?.cartes.find(c => c.cle === doc.carte.cle);

  const barreOutils = (
    <View style={[styles.ligne, { gap: 6 }]} accessibilityRole="toolbar" accessibilityLabel={tr('strats.editeur.outils')} testID="esport-editeur-outils">
      {outilsEditeur().map(([id, icone, libelle]) => (
        <Pastille key={id} theme={theme} actif={outil === id} onPress={() => setOutil(id)} libelle={libelle} testID={`esport-outil-${id}`}>
          <Text style={{ color: theme.texte, fontSize: 17 }}>{icone}</Text>
        </Pastille>
      ))}
      <View style={{ width: 8 }} />
      <Pastille theme={theme} actif={false} onPress={() => setH(annuler(h))} libelle={tr('strats.editeur.annuler_ctrl_z')} testID="esport-editeur-annuler">
        <Text style={{ color: h.passe.length ? theme.texte : theme.attenue, fontSize: 17 }}>↶</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setH(retablir(h))} libelle={tr('strats.editeur.retablir_ctrl_maj_z')} testID="esport-editeur-retablir">
        <Text style={{ color: h.futur.length ? theme.texte : theme.attenue, fontSize: 17 }}>↷</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1.25, { x: taille / 2, y: taille / 2 }))} libelle={tr('strats.editeur.zoomer')} testID="esport-editeur-zoom-plus">
        <Text style={{ color: theme.texte, fontSize: 17 }}>＋</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(v => zoomer(v, 1 / 1.25, { x: taille / 2, y: taille / 2 }))} libelle={tr('strats.editeur.dezoomer')} testID="esport-editeur-zoom-moins">
        <Text style={{ color: theme.texte, fontSize: 17 }}>－</Text>
      </Pastille>
      <Pastille theme={theme} actif={false} onPress={() => setVue(VUE_INITIALE)} libelle={tr('strats.editeur.vue_entiere_0')} testID="esport-editeur-zoom-zero">
        <Text style={{ color: theme.texte, fontSize: 12 }}>{Math.round(vue.echelle * 100)} %</Text>
      </Pastille>
    </View>
  );

  const palette = (
    <View style={{ gap: 10 }}>
      <Panneau theme={theme} testID="esport-editeur-joueurs">
        <Intertitre theme={theme}>{tr('strats.editeur.joueurs_et_couleurs')}</Intertitre>
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
            <Pastille key={c} theme={theme} actif={couleurLibre === c} couleur={c} onPress={() => (setCouleurLibre(c), setJoueur(null))} libelle={tr('strats.editeur.couleur', { c })} testID={`esport-couleur-${c.slice(1)}`}>
              <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c, borderWidth: 1, borderColor: theme.ligne }} />
            </Pastille>
          ))}
        </View>
        {joueur !== null ? (
          <Champ theme={theme} libelle={tr('strats.editeur.nom_du_joueur', { v: joueur + 1 })} valeur={doc.joueurs[joueur].nom} onChanger={nom => faire({ type: 'joueur', index: joueur, champs: { nom: nom.slice(0, 24) } })} maxLength={24} testID="esport-joueur-nom" />
        ) : null}
      </Panneau>
      {outil === 'agent' || outil === 'capacite' ? (
        <Panneau theme={theme} testID="esport-editeur-agents">
          <Intertitre theme={theme}>{outil === 'agent' ? tr('strats.editeur.agent_a_poser') : tr('strats.editeur.capacite_a_poser')}</Intertitre>
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
              <Text style={attenue}>{capacite ? tr('strats.editeur.choisissez_la_zone_puis', { nom: capacite.nom }) : ''}</Text>
              <Segments<FormeZone | 'aucune'> theme={theme} libelle={tr('strats.editeur.zone')} valeur={formeZone} options={[['cercle', tr('strats.editeur.cercle_smoke_molly')], ['mur', tr('strats.editeur.mur_ligne')], ['cone', tr('strats.editeur.cone_flash')], ['aucune', tr('strats.editeur.icone_seule')]]} onChoisir={setFormeZone} testID="esport-zone" />
            </>
          ) : null}
        </Panneau>
      ) : null}
      {outil === 'texte' ? (
        <Panneau theme={theme}>
          <Champ theme={theme} libelle={tr('strats.editeur.texte_a_poser_touchez')} valeur={texte} onChanger={setTexte} maxLength={200} testID="esport-editeur-texte" />
        </Panneau>
      ) : null}
      {outil === 'forme' ? (
        <Segments<'rect' | 'ellipse'> theme={theme} libelle={tr('strats.editeur.forme')} valeur={formeDessin} options={[['rect', tr('strats.editeur.rectangle')], ['ellipse', tr('strats.editeur.ellipse')]]} onChoisir={setFormeDessin} testID="esport-forme" />
      ) : null}
      {outil === 'fleche' || outil === 'ligne' ? (
        <Segments<'plein' | 'tirets'> theme={theme} libelle={tr('strats.editeur.trait')} valeur={tirets ? 'tirets' : 'plein'} options={[['plein', tr('strats.editeur.plein')], ['tirets', tr('strats.editeur.tirets_rotation')]]} onChoisir={v => setTirets(v === 'tirets')} testID="esport-trait" />
      ) : null}
      {selection && outil === 'selection' ? (
        <BoutonHub
          theme={theme}
          titre={tr('strats.editeur.effacer_la_selection_suppr')}
          variante="danger"
          onPress={() => {
            faire({ type: 'supprimer', etape: iEtape, id: selection });
            setSelection(undefined);
          }}
          testID="esport-editeur-effacer"
        />
      ) : null}
      <Panneau theme={theme} testID="esport-editeur-calques">
        <Intertitre theme={theme}>{tr('strats.editeur.calques')}</Intertitre>
        {CALQUES.map(c => (
          <View key={c} style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ color: theme.texte, fontSize: 13, flex: 1 }}>{NOMS_CALQUES[c]}</Text>
            <BoutonHub theme={theme} titre={doc.calques[c].visible ? '👁' : '—'} libelle={`${doc.calques[c].visible ? tr('strats.editeur.masquer') : tr('strats.editeur.afficher')} ${NOMS_CALQUES[c]}`} onPress={() => faire({ type: 'calque', calque: c, champs: { visible: !doc.calques[c].visible } })} testID={`esport-calque-${c}-visible`} />
            {c !== 'fond' ? (
              <BoutonHub theme={theme} titre={doc.calques[c].verrou ? '🔒' : '🔓'} libelle={`${doc.calques[c].verrou ? tr('strats.editeur.deverrouiller') : tr('strats.editeur.verrouiller')} ${NOMS_CALQUES[c]}`} onPress={() => faire({ type: 'calque', calque: c, champs: { verrou: !doc.calques[c].verrou } })} testID={`esport-calque-${c}-verrou`} />
            ) : null}
          </View>
        ))}
      </Panneau>
    </View>
  );

  const etapes = (
    <Panneau theme={theme} testID="esport-editeur-etapes">
      <View style={[styles.ligne, { gap: 6 }]}>
        <BoutonHub theme={theme} titre="◀" libelle={tr('strats.editeur.etape_precedente')} onPress={() => setEtape(Math.max(0, iEtape - 1))} desactive={iEtape === 0} testID="esport-etape-precedente" />
        <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }} testID="esport-etape-position">
          {tr('strats.editeur.etape', { v: iEtape + 1, length: doc.etapes.length })}</Text>
        <BoutonHub theme={theme} titre="▶" libelle={tr('strats.editeur.etape_suivante')} onPress={() => setEtape(Math.min(doc.etapes.length - 1, iEtape + 1))} desactive={iEtape >= doc.etapes.length - 1} testID="esport-etape-suivante" />
        <BoutonHub
          theme={theme}
          titre={tr('strats.editeur.etape_2')}
          desactive={doc.etapes.length >= ETAPES_MAX}
          onPress={() => {
            faire({ type: 'ajouterEtape', apres: iEtape });
            setEtape(iEtape + 1);
          }}
          testID="esport-etape-ajouter"
        />
        <BoutonHub
          theme={theme}
          titre={tr('strats.editeur.dupliquer_l_etape')}
          desactive={doc.etapes.length >= ETAPES_MAX}
          onPress={() => {
            faire({ type: 'dupliquerEtape', etape: iEtape });
            setEtape(iEtape + 1);
          }}
          testID="esport-etape-dupliquer"
        />
        <BoutonHub
          theme={theme}
          titre={tr('strats.editeur.supprimer_l_etape')}
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
          <Champ theme={theme} libelle={tr('strats.editeur.titre_de_l_etape')} valeur={etapeCourante.titre} onChanger={titre => faire({ type: 'titreEtape', etape: iEtape, titre })} maxLength={60} style={{ flex: 1, minWidth: 180 }} testID="esport-etape-titre" />
          <ChampNote theme={theme} libelle={tr('strats.editeur.note_de_l_etape')} valeur={etapeCourante.note} onChanger={note => faire({ type: 'noteEtape', etape: iEtape, note })} maxLength={2000} style={{ flex: 2, minWidth: 220 }} testID="esport-etape-note" />
        </View>
      ) : null}
    </Panneau>
  );

  return (
    <View style={{ gap: 12 }} testID="esport-editeur">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={[styles.ligne, { flex: 1 }]}>
          <BoutonHub theme={theme} titre={tr('strats.editeur.strats')} onPress={onRetour} testID="esport-editeur-retour" />
          <Text style={{ color: theme.texte, fontSize: 20, fontWeight: '800', ...police(theme.policeTitre) }} numberOfLines={1} testID="esport-editeur-titre">
            {strat.titre}
          </Text>
          <Text style={attenue}>
            {doc.carte.nom} · {LIBELLES_SIDE[doc.side]} · {tr('strats.editeur.version', { n: revision })}
            {modifie ? tr('strats.editeur.modifications_non_enregistrees') : ''}
          </Text>
        </View>
        <View style={styles.ligne}>
          {peutModifier ? <BoutonHub theme={theme} titre={enCours === 'enregistrement' ? tr('membresRoles.enregistrement') : tr('discord.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID="esport-editeur-enregistrer" /> : null}
          <BoutonHub theme={theme} titre={tr('strats.editeur.exporter_en_png')} onPress={exporterPng} testID="esport-editeur-png" />
          {peutModifier ? (
            <BoutonHub
              theme={theme}
              titre={tr('strats.editeur.dupliquer_la_strat')}
              onPress={() =>
                void agir('duplication', async () => {
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
          <BoutonHub theme={theme} titre={tr('strats.editeur.recharger_la_version_du')} onPress={() => void agir('', charger)} testID="esport-editeur-recharger" />
          <BoutonHub theme={theme} titre={tr('strats.editeur.garder_la_mienne_ecraser')} variante="danger" onPress={() => (setErreur(undefined), void enregistrer(conflit))} testID="esport-editeur-ecraser" />
        </View>
      ) : null}
      {!peutModifier ? <Text style={attenue}>{tr('strats.editeur.lecture_seule_votre_role')}</Text> : null}
      {peutModifier ? (
        <View style={[styles.ligne, { gap: 8 }]}>
          <Segments
            theme={theme}
            libelle={tr('scouting.scouting.side')}
            valeur={doc.side}
            options={[['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]] as const}
            onChoisir={side => faire({ type: 'side', side })}
            testID="esport-editeur-side"
          />
          <View style={[styles.ligne, { gap: 4, flex: 1 }]} accessibilityRole="radiogroup" accessibilityLabel={tr('strats.editeur.carte')}>
            {cartesDuPool(assets, doc.carte.cle).map(c => (
              <Pastille key={c.cle} theme={theme} actif={doc.carte.cle === c.cle} onPress={() => faire({ type: 'carte', carte: { cle: c.cle, nom: c.nom, image: c.minimap } })} libelle={tr('strats.editeur.carte_2', { nom: c.nom })} testID={`esport-editeur-carte-${c.cle}`}>
                <Text style={{ color: theme.texte, fontSize: 12 }}>{c.nom}</Text>
              </Pastille>
            ))}
          </View>
        </View>
      ) : null}
      {peutModifier ? barreOutils : null}
      <View style={{ flexDirection: large ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, width: '100%', gap: 8 }} onLayout={ev => setLargeur(ev.nativeEvent.layout.width)}>
          <Suspense fallback={<Text style={attenue}>{tr('strats.editeur.chargement_de_l_editeur')}</Text>}>
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
          {!carteAsset?.minimap && !doc.carte.image ? <Text style={attenue}>{tr('strats.editeur.fond_generique_l_image')}</Text> : null}
          {etapes}
        </View>
        {peutModifier ? <View style={{ width: large ? 320 : '100%' }}>{palette}</View> : null}
      </View>
      <MentionRiot theme={theme} jeu={assets?.jeu} />
    </View>
  );
}
