/**
 * Champ de note en Markdown limité, avec barre de mise en forme et aperçu.
 *
 *  - Taille : zone de saisie grande (11 lignes sur PC, 8 sur téléphone) qui grandit avec le texte
 *    jusqu'à un maximum puis défile ; poignée de redimensionnement sur le web ; bouton « Agrandir »
 *    (plein écran : éditeur et aperçu côte à côte sur PC, onglets Écrire / Aperçu sur téléphone) ;
 *    aperçu repliable.
 *  - Mise en forme : gras, italique, barré, surlignage, couleurs prédéfinies, titres, listes (puces,
 *    numérotée, cases cochables dans l'aperçu), citation, code, bloc de code, séparateur, lien, emoji,
 *    @mention d'un joueur (autocomplétion), annuler / rétablir. Sur petit écran, la barre défile
 *    horizontalement et « ⋯ » ouvre le reste.
 *  - Clavier (site et app PC) : Ctrl/Cmd+B, I, U (barré), Maj+X (barré), K (lien), Maj+7 / Maj+8 (listes),
 *    Z / Y (annuler / rétablir) ; Entrée continue une liste, Entrée sur un élément vide en sort ; Tab et
 *    Maj+Tab indentent les listes. Logique pure : review/formatage.ts.
 *
 * Le rendu de l'aperçu passe par les composants de l'app (NoteMarkdown), jamais par du HTML brut ; le
 * serveur nettoie toujours la note. Boutons de 44 px : utilisables au doigt sur iPhone et iPad.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputKeyPressEvent,
  type ViewStyle,
} from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { useMobile } from '../../ui/mobile/useMobile';
import {
  actionDuRaccourci,
  annulerEdition,
  appliquerFormat,
  choisirMention,
  continuerListe,
  enregistrer,
  historiqueVide,
  indenter,
  inserer,
  mentionEnCours,
  pseudoMention,
  retablirEdition,
  type Edition,
  type Format,
  type Historique,
  type Selection,
} from '../review/formatage';
import { basculerCase, COULEURS, type Couleur } from '../review/markdown';
import { ESP, rayonControle, type EtatPresse } from './design';
import { NoteMarkdown, teinteCouleur } from './review/Note';
import { tr } from '../i18n';
import { Glyphe } from '../../ui/icones';

type NoeudTexte = {
  selectionStart?: number;
  selectionEnd?: number;
  setSelectionRange?(a: number, b: number): void;
  focus?(): void;
  scrollHeight?: number;
  offsetHeight?: number;
  style?: { height: string };
};

interface Outil {
  id: string;
  glyphe: string;
  nom: () => string;
  style?: object;
  /** Visible en permanence, même sur petit écran ; les autres passent par « ⋯ » sur petit écran. */
  base?: boolean;
  agir(): void;
  actif?: boolean;
}

const EMOJIS = ['👍', '👎', '🔥', '💯', '✅', '❌', '⚠️', '❓', '💡', '🎯', '👀', '🧠', '💪', '👏', '🙏', '😅', '😂', '😬', '😎', '🤝', '🏆', '📌', '📈', '📉', '⏱️', '🛡️', '⚔️', '💣', '🔫', '🗺️', '⭐', '🚀']; // emoji-autorise : emojis proposés à l'utilisateur pour son texte (contenu)

const NOM_COULEUR: Record<Couleur, () => string> = {
  rouge: () => tr('champNote.couleur_rouge'),
  orange: () => tr('champNote.couleur_orange'),
  jaune: () => tr('champNote.couleur_jaune'),
  vert: () => tr('champNote.couleur_vert'),
  bleu: () => tr('champNote.couleur_bleu'),
  violet: () => tr('champNote.couleur_violet'),
  rose: () => tr('champNote.couleur_rose'),
  gris: () => tr('champNote.couleur_gris'),
};

const HAUTEUR_LIGNE = 22;
const MARGE_VERTICALE = 16;
/** À partir de cette largeur, l'éditeur et l'aperçu passent côte à côte (agrandi). */
const LARGEUR_DEUX_COLONNES = 900;

export function ChampNote({
  theme,
  libelle,
  valeur,
  onChanger,
  testID,
  maxLength,
  placeholder,
  apercu = 'bouton',
  testIDApercu,
  style,
  joueurs,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID: string;
  maxLength?: number;
  placeholder?: string;
  /** Aperçu du rendu : repliable (affiché d'emblée avec « toujours », sur demande avec « bouton »), ou absent (« jamais »). */
  apercu?: 'bouton' | 'toujours' | 'jamais';
  testIDApercu?: string;
  style?: StyleProp<ViewStyle>;
  /** Pseudos proposés par l'autocomplétion des @mentions (aucun : pas de bouton @). */
  joueurs?: ReadonlyArray<string>;
}) {
  const mobile = useMobile();
  const { width: largeur } = useWindowDimensions();
  const champ = useRef<React.ComponentRef<typeof TextInput>>(null);
  const selection = useRef<Selection>({ start: valeur.length, end: valeur.length });
  const historique = useRef<Historique>(historiqueVide());
  const derniereFrappe = useRef(0);
  const minManuel = useRef(0);
  const derniereHauteur = useRef(0);
  const [forcee, setForcee] = useState<Selection | undefined>();
  const [curseur, setCurseur] = useState(valeur.length);
  const [voir, setVoir] = useState(apercu === 'toujours');
  const [voirGrand, setVoirGrand] = useState(true);
  const [agrandi, setAgrandi] = useState(false);
  const [onglet, setOnglet] = useState<'ecrire' | 'apercu'>('ecrire');
  const [panneau, setPanneau] = useState<null | 'plus' | 'couleurs' | 'emoji'>(null);
  const [hauteur, setHauteur] = useState(0);
  const web = Platform.OS === 'web';
  const deuxColonnes = largeur >= LARGEUR_DEUX_COLONNES;

  const lignesMin = mobile ? 8 : 11;
  const hMin = lignesMin * HAUTEUR_LIGNE + MARGE_VERTICALE;
  const hMax = mobile ? 380 : 560;
  const hauteurChamp = Math.max(hMin, Math.min(hMax, hauteur));

  /** Web : la hauteur suit le contenu (mesure du textarea), jusqu'au maximum ; une poignée tirée par l'utilisateur est respectée. */
  useLayoutEffect(() => {
    if (!web || agrandi) return;
    const n = champ.current as unknown as NoeudTexte | null;
    if (!n?.style || typeof n.scrollHeight !== 'number') return;
    const actuelle = n.offsetHeight ?? 0;
    if (derniereHauteur.current && actuelle > derniereHauteur.current + 4) minManuel.current = actuelle;
    n.style.height = '0px';
    const contenu = (n.scrollHeight ?? 0) + 2;
    n.style.height = `${actuelle}px`;
    const cible = Math.max(Math.max(hMin, Math.min(hMax, contenu)), minManuel.current);
    derniereHauteur.current = cible;
    setHauteur(cible);
  }, [valeur, agrandi, web, hMin, hMax]);

  /** Sélection courante : lue sur le champ du navigateur (fiable même après la perte du focus), sinon la dernière connue. */
  const lire = (): Selection => {
    const n = champ.current as unknown as NoeudTexte | null;
    if (n && typeof n.selectionStart === 'number' && typeof n.selectionEnd === 'number') return { start: n.selectionStart, end: n.selectionEnd };
    return selection.current;
  };

  const poserSelection = (sel: Selection, texte: string) => {
    selection.current = sel;
    setCurseur(sel.end);
    if (web) {
      // Après le rendu : le focus revient au champ, la sélection entoure le texte mis en forme.
      // Si l'utilisateur a déjà retapé quelque chose entre-temps, son curseur n'est pas déplacé.
      setTimeout(() => {
        const n = champ.current as unknown as NoeudTexte | null;
        n?.focus?.();
        if (n && (n as { value?: string }).value === texte) n.setSelectionRange?.(sel.start, sel.end);
      }, 0);
    } else setForcee(sel);
  };

  /** Applique une modification venue de la barre ou du clavier (un pas d'annulation). */
  const appliquerEdition = (e: Edition) => {
    const texte = maxLength ? e.texte.slice(0, maxLength) : e.texte;
    const sel = { start: Math.min(e.selection.start, texte.length), end: Math.min(e.selection.end, texte.length) };
    historique.current = enregistrer(historique.current, { texte: valeur, selection: lire() });
    derniereFrappe.current = 0;
    onChanger(texte);
    poserSelection(sel, texte);
  };

  const appliquer = (format: Format) => appliquerEdition(appliquerFormat(valeur, lire(), format));

  const defaire = () => {
    const r = annulerEdition(historique.current, { texte: valeur, selection: lire() });
    if (!r) return;
    historique.current = r.historique;
    derniereFrappe.current = 0;
    onChanger(r.etat.texte);
    poserSelection(r.etat.selection, r.etat.texte);
  };
  const refaire = () => {
    const r = retablirEdition(historique.current, { texte: valeur, selection: lire() });
    if (!r) return;
    historique.current = r.historique;
    derniereFrappe.current = 0;
    onChanger(r.etat.texte);
    poserSelection(r.etat.selection, r.etat.texte);
  };

  /** Frappe : un retour à la ligne dans une liste la continue ; sinon la frappe est mémorisée (regroupée par rafales). */
  const surTexte = (t: string) => {
    if (t.length === valeur.length + 1) {
      let p = 0;
      while (p < valeur.length && t[p] === valeur[p]) p++;
      if (t[p] === '\n' && t.slice(0, p) + t.slice(p + 1) === valeur) {
        const e = continuerListe(valeur, { start: p, end: p });
        if (e) return appliquerEdition(e);
      }
    }
    const maintenant = Date.now();
    const regrouper = maintenant - derniereFrappe.current < 900;
    historique.current = enregistrer(historique.current, { texte: valeur, selection: selection.current }, regrouper);
    derniereFrappe.current = maintenant;
    onChanger(t);
    if (web) setCurseur(lire().end);
  };

  const touche = (e: TextInputKeyPressEvent) => {
    const ne = e.nativeEvent as unknown as Parameters<typeof actionDuRaccourci>[0] & { key?: string };
    if (ne.key === 'Tab' && !ne.ctrlKey && !ne.metaKey && !ne.altKey) {
      const r = indenter(valeur, lire(), ne.shiftKey ? -1 : 1);
      if (r) {
        e.preventDefault();
        appliquerEdition(r);
      }
      return;
    }
    const action = actionDuRaccourci(ne);
    if (!action) return;
    e.preventDefault();
    if (action === 'annuler') defaire();
    else if (action === 'retablir') refaire();
    else appliquer(action);
  };

  const suggestions = (() => {
    if (!joueurs || joueurs.length === 0) return [];
    const en = mentionEnCours(valeur, curseur);
    if (!en) return [];
    const q = en.requete.toLowerCase();
    const vus = new Set<string>();
    const sortie: string[] = [];
    for (const p of joueurs.map(pseudoMention)) {
      if (!p || vus.has(p.toLowerCase()) || !p.toLowerCase().startsWith(q)) continue;
      vus.add(p.toLowerCase());
      sortie.push(p);
    }
    return sortie.slice(0, 6);
  })();

  const choisirJoueur = (pseudo: string) => {
    const e = choisirMention(valeur, curseur, pseudo);
    if (e) appliquerEdition(e);
  };

  const montrerApercu = apercu !== 'jamais';
  const peutAnnuler = historique.current.passe.length > 0;
  const peutRetablir = historique.current.futur.length > 0;
  const basculerPanneau = (nom: 'plus' | 'couleurs' | 'emoji') => setPanneau(p => (p === nom ? null : nom));

  const outils: Outil[] = [
    { id: 'annuler', glyphe: '↶', nom: () => tr('champNote.annuler'), base: true, agir: defaire },
    { id: 'retablir', glyphe: '↷', nom: () => tr('champNote.retablir'), base: true, agir: refaire },
    { id: 'gras', glyphe: 'B', nom: () => tr('champNote.gras_ctrl_b'), style: { fontWeight: '900' }, base: true, agir: () => appliquer('gras') },
    { id: 'italique', glyphe: 'I', nom: () => tr('champNote.italique_ctrl_i'), style: { fontStyle: 'italic', fontWeight: '700' }, base: true, agir: () => appliquer('italique') },
    { id: 'barre', glyphe: 'S', nom: () => tr('champNote.barre'), style: { textDecorationLine: 'line-through', fontWeight: '700' }, base: true, agir: () => appliquer('barre') },
    { id: 'liste', glyphe: '•≡', nom: () => tr('champNote.liste_a_puces'), base: true, agir: () => appliquer('liste') },
    { id: 'case', glyphe: '☑︎', nom: () => tr('champNote.case'), base: true, agir: () => appliquer('case') },
    { id: 'lien', glyphe: 'lien', nom: () => tr('champNote.lien_ctrl_k'), base: true, agir: () => appliquer('lien') },
    { id: 'surligne', glyphe: 'ab', nom: () => tr('champNote.surligne'), style: { backgroundColor: 'rgba(250, 204, 21, 0.45)', paddingHorizontal: 3 }, agir: () => appliquer('surligne') },
    { id: 'couleur', glyphe: 'A', nom: () => tr('champNote.couleur'), style: { color: teinteCouleur('rouge'), fontWeight: '800' }, actif: panneau === 'couleurs', agir: () => basculerPanneau('couleurs') },
    { id: 'titre1', glyphe: 'H1', nom: () => tr('champNote.titre1'), style: { fontWeight: '800' }, agir: () => appliquer('titre1') },
    { id: 'titre2', glyphe: 'H2', nom: () => tr('champNote.titre2'), style: { fontWeight: '800' }, agir: () => appliquer('titre2') },
    { id: 'titre3', glyphe: 'H3', nom: () => tr('champNote.titre3'), style: { fontWeight: '800' }, agir: () => appliquer('titre3') },
    { id: 'numerotee', glyphe: '1.', nom: () => tr('champNote.numerotee'), agir: () => appliquer('numerotee') },
    { id: 'citation', glyphe: '”', nom: () => tr('champNote.citation'), style: { fontWeight: '900', fontSize: 20 }, agir: () => appliquer('citation') },
    { id: 'code', glyphe: '`', nom: () => tr('champNote.code_en_ligne'), style: { fontWeight: '900' }, agir: () => appliquer('code') },
    { id: 'bloc', glyphe: '</>', nom: () => tr('champNote.bloc'), agir: () => appliquer('bloc') },
    { id: 'separateur', glyphe: '—', nom: () => tr('champNote.separateur'), agir: () => appliquer('separateur') },
    { id: 'emoji', glyphe: 'content', nom: () => tr('champNote.emoji'), actif: panneau === 'emoji', agir: () => basculerPanneau('emoji') },
    ...(joueurs && joueurs.length > 0
      ? [{ id: 'mention', glyphe: '@', nom: () => tr('champNote.mention'), style: { fontWeight: '800' }, agir: () => appliquerEdition(inserer(valeur, lire(), '@')) } as Outil]
      : []),
  ];
  const visibles = mobile ? outils.filter(o => o.base) : outils;
  const dansPlus = mobile ? outils.filter(o => !o.base) : [];

  const bouton = (etat: EtatPresse, actif = false, desactive = false): ViewStyle => ({
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: ESP.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: rayonControle(theme) === 999 ? 22 : Math.max(4, rayonControle(theme) - 2),
    borderWidth: 1,
    borderColor: actif || etat.hovered || etat.focused ? theme.accent : 'transparent',
    backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : etat.pressed ? teinteTransparente(theme.attenue, 0.18) : 'transparent',
    opacity: desactive ? 0.4 : 1,
  });
  // Le focus reste dans le champ (souris) : la sélection n'est pas perdue.
  const gardeFocus = web ? { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() } : {};

  const boutonOutil = (o: Outil) => {
    const desactive = (o.id === 'annuler' && !peutAnnuler) || (o.id === 'retablir' && !peutRetablir);
    return (
      <Pressable
        key={o.id}
        testID={`${testID}-${o.id}`}
        accessibilityRole="button"
        accessibilityLabel={o.nom()}
        accessibilityState={{ disabled: desactive, selected: o.actif }}
        {...gardeFocus}
        onPress={() => {
          if (!desactive) o.agir();
        }}
        style={(etat: EtatPresse) => bouton(etat, o.actif, desactive)}>
        <Glyphe valeur={o.glyphe} style={{ color: theme.texte, fontSize: 16, ...police(theme.policeTexte), ...o.style }} />
      </Pressable>
    );
  };

  const boutonTexte = (id: string, glyphe: string, nom: string, agir: () => void, actif = false) => (
    <Pressable
      key={id}
      testID={`${testID}-${id}`}
      accessibilityRole="button"
      accessibilityState={{ selected: actif }}
      accessibilityLabel={nom}
      {...gardeFocus}
      onPress={agir}
      style={(etat: EtatPresse) => ({ ...bouton(etat, actif), paddingHorizontal: ESP.s })}>
      <Glyphe valeur={glyphe} style={{ color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }} />
    </Pressable>
  );

  const barre = (grand: boolean) => {
    const apercuVisible = grand ? voirGrand : voir;
    const droite = [
      // Agrandi sur téléphone, l'aperçu a son onglet : pas de bouton.
      ...(montrerApercu && !(grand && !deuxColonnes)
        ? [boutonTexte('voir-apercu', tr('champNote.apercu'), apercuVisible ? tr('champNote.masquer_l_apercu') : tr('champNote.voir_l_apercu_du'), () => (grand ? setVoirGrand(v => !v) : setVoir(v => !v)), apercuVisible)]
        : []),
      boutonTexte(grand ? 'reduire' : 'agrandir', grand ? '⤡' : '⤢', grand ? tr('champNote.reduire') : tr('champNote.agrandir'), () => {
        setPanneau(null);
        setAgrandi(!grand);
      }),
    ];
    const plus = mobile ? [boutonTexte('plus', '⋯', tr('champNote.plus'), () => basculerPanneau('plus'), panneau === 'plus')] : [];
    const contenu = (
      <>
        {visibles.map(boutonOutil)}
        {plus}
        {mobile ? droite : <View style={{ marginLeft: 'auto', flexDirection: 'row' }}>{droite}</View>}
      </>
    );
    const panneauBoutons = (id: string, enfants: React.ReactNode) => (
      <View testID={`${testID}-${id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2, borderTopWidth: 1, borderTopColor: theme.ligne }}>
        {enfants}
      </View>
    );
    return (
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.ligne, backgroundColor: theme.surface }}>
        {mobile ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            accessibilityRole="toolbar"
            accessibilityLabel={tr('champNote.mise_en_forme', { libelle })}
            testID={`${testID}-outils`}
            contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 2, padding: 2 }}>
            {contenu}
          </ScrollView>
        ) : (
          <View
            accessibilityRole="toolbar"
            accessibilityLabel={tr('champNote.mise_en_forme', { libelle })}
            testID={`${testID}-outils`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: 2 }}>
            {contenu}
          </View>
        )}
        {panneau === 'plus' && mobile ? panneauBoutons('menu-plus', dansPlus.map(boutonOutil)) : null}
        {panneau === 'couleurs'
          ? panneauBoutons(
              'couleurs',
              COULEURS.map(c => (
                <Pressable
                  key={c}
                  testID={`${testID}-couleur-${c}`}
                  accessibilityRole="button"
                  accessibilityLabel={NOM_COULEUR[c]()}
                  {...gardeFocus}
                  onPress={() => {
                    appliquer(`couleur:${c}`);
                    setPanneau(null);
                  }}
                  style={(etat: EtatPresse) => bouton(etat)}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: teinteCouleur(c) }} />
                </Pressable>
              )),
            )
          : null}
        {panneau === 'emoji'
          ? panneauBoutons(
              'emojis',
              EMOJIS.map(em => (
                <Pressable
                  key={em}
                  testID={`${testID}-emoji-${em}`}
                  accessibilityRole="button"
                  accessibilityLabel={em}
                  {...gardeFocus}
                  onPress={() => {
                    appliquerEdition(inserer(valeur, lire(), em));
                    setPanneau(null);
                  }}
                  style={(etat: EtatPresse) => bouton(etat)}>
                  <Text style={{ fontSize: 22 }}>{em}</Text>
                </Pressable>
              )),
            )
          : null}
        {suggestions.length > 0
          ? panneauBoutons(
              'suggestions',
              suggestions.map(p => (
                <Pressable
                  key={p}
                  testID={`${testID}-mention-${p}`}
                  accessibilityRole="button"
                  accessibilityLabel={`@${p}`}
                  {...gardeFocus}
                  onPress={() => choisirJoueur(p)}
                  style={(etat: EtatPresse) => ({ ...bouton(etat), paddingHorizontal: ESP.s })}>
                  <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 14, ...police(theme.policeTexte) }}>@{p}</Text>
                </Pressable>
              )),
            )
          : null}
      </View>
    );
  };

  const saisie = (grand: boolean) => (
    <TextInput
      ref={champ}
      testID={testID}
      accessibilityLabel={libelle}
      value={valeur}
      onChangeText={surTexte}
      onKeyPress={touche}
      onSelectionChange={e => {
        selection.current = e.nativeEvent.selection;
        setCurseur(e.nativeEvent.selection.end);
        if (forcee) setForcee(undefined);
      }}
      onContentSizeChange={
        web || grand
          ? undefined
          : e => {
              const h = e.nativeEvent.contentSize.height + MARGE_VERTICALE;
              setHauteur(prev => (Math.abs(prev - h) > 1 ? h : prev));
            }
      }
      selection={web ? undefined : forcee}
      placeholder={placeholder}
      placeholderTextColor={theme.attenue}
      autoCapitalize="sentences"
      autoFocus={grand}
      multiline
      scrollEnabled={grand || hauteurChamp >= hMax}
      maxLength={maxLength}
      style={[
        {
          color: theme.texte,
          fontSize: 15,
          lineHeight: HAUTEUR_LIGNE,
          paddingVertical: 8,
          paddingHorizontal: 10,
          textAlignVertical: 'top',
          ...police(theme.policeTexte),
        },
        grand ? { flex: 1, minHeight: 160 } : { height: hauteurChamp },
        // Poignée de redimensionnement (navigateur).
        web && !grand ? ({ resize: 'vertical' } as object) : null,
      ]}
    />
  );

  const proche = !!maxLength && valeur.length >= maxLength * 0.8;
  const compteur = proche ? (
    <Text
      testID={`${testID}-compteur`}
      accessibilityLiveRegion="polite"
      style={{ alignSelf: 'flex-end', fontSize: 12, color: valeur.length >= maxLength! * 0.95 ? theme.critique : theme.attenue, fontWeight: valeur.length >= maxLength! ? '700' : '400', ...police(theme.policeTexte) }}>
      {tr('champNote.compteur', { n: valeur.length, max: maxLength! })}
    </Text>
  ) : null;

  const rendu = (grand: boolean) => (
    <View style={{ gap: 4, padding: ESP.xs, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: teinteTransparente(theme.attenue, 0.08) }}>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{tr('champNote.apercu')}</Text>
      {valeur.trim() === '' ? (
        grand ? (
          <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{tr('champNote.apercu_vide')}</Text>
        ) : null
      ) : (
        <NoteMarkdown theme={theme} source={valeur} testID={testIDApercu ?? `${testID}-apercu`} onBasculerCase={ligne => appliquerEdition({ texte: basculerCase(valeur, ligne), selection: lire() })} />
      )}
    </View>
  );

  const cadre: ViewStyle = { borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: theme.fond, overflow: 'hidden' };

  const panneauAgrandi = () => (
    <Modal visible animationType="fade" onRequestClose={() => setAgrandi(false)}>
      <View testID={`${testID}-agrandi`} style={{ flex: 1, backgroundColor: theme.fond, padding: mobile ? ESP.xs : ESP.m, gap: ESP.xs }}>
        <Text accessibilityRole="header" style={{ color: theme.texte, fontWeight: '700', fontSize: 16, ...police(theme.policeTexte) }}>
          {libelle}
        </Text>
        <View style={[cadre, { flex: 1 }]}>
          {barre(true)}
          {!deuxColonnes && montrerApercu ? (
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
              {(['ecrire', 'apercu'] as const).map(o => (
                <Pressable
                  key={o}
                  testID={`${testID}-onglet-${o}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: onglet === o }}
                  onPress={() => setOnglet(o)}
                  style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: onglet === o ? theme.accent : 'transparent' }}>
                  <Text style={{ color: onglet === o ? theme.texte : theme.attenue, fontWeight: '700', ...police(theme.policeTexte) }}>{o === 'ecrire' ? tr('champNote.ecrire') : tr('champNote.apercu')}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ flex: 1, flexDirection: deuxColonnes ? 'row' : 'column' }}>
            {deuxColonnes || onglet === 'ecrire' || !montrerApercu ? <View style={{ flex: 1 }}>{saisie(true)}</View> : null}
            {montrerApercu && ((deuxColonnes && voirGrand) || (!deuxColonnes && onglet === 'apercu')) ? (
              <ScrollView style={{ flex: 1, borderLeftWidth: deuxColonnes ? 1 : 0, borderLeftColor: theme.ligne }} contentContainerStyle={{ padding: ESP.xs }}>
                {rendu(true)}
              </ScrollView>
            ) : null}
          </View>
        </View>
        {compteur}
      </View>
    </Modal>
  );

  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>
      {agrandi ? (
        panneauAgrandi()
      ) : (
        <View style={cadre}>
          {barre(false)}
          {saisie(false)}
        </View>
      )}
      {!agrandi ? compteur : null}
      {!agrandi && montrerApercu && voir && valeur.trim() !== '' ? rendu(false) : null}
    </View>
  );
}
