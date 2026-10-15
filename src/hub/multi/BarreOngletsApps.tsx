/**
 * Barre d'onglets des apps ouvertes, comme dans un navigateur.
 *
 * Identifiants de test par RANG (`onglets-n1`, `onglets-n1-ouvrir`…), jamais par app : une recherche
 * « tout ce qui parle de prospects » dans la page ne doit pas tomber sur la barre.
 *
 * Bureau, tablette (`BarreOngletsApps`) : « ⌂ Hub », puis un onglet par app
 * (icône, nom, « ⋯ » pour ses actions, « × » pour le fermer). Clic molette sur
 * un onglet : il se ferme. Le menu « ⋯ » propose « Afficher à côté » (écrans
 * larges), « Ouvrir dans une nouvelle fenêtre » (app de bureau) ou « Ouvrir
 * dans un nouvel onglet du navigateur » (site), et « Fermer l'onglet ». En
 * côte à côte, la barre propose aussi d'échanger les côtés ou d'en fermer un.
 *
 * Téléphone (`SelecteurOngletsMobile`) : un bouton compact « ▤ n » dans
 * l'en-tête ouvre la liste des onglets dans une feuille basse.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../themes';
import type { AppHub } from '../types';
import { BoutonIcone } from '../../ui/mobile/EnTeteMobile';
import { FeuilleBasse } from '../../ui/mobile/FeuilleBasse';
import { Cellule, GroupeCellules } from '../../ui/mobile/ListeCellules';
import { useOngletsHub } from './contexte';
import { MAX_ONGLETS, type EtatOnglets } from './onglets';

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

/** Où « ouvrir ailleurs » envoie l'app : une vraie fenêtre (PC) ou un onglet du navigateur (site). */
export type Ailleurs = 'fenetre' | 'navigateur';

export interface PropsBarreOnglets {
  theme: ThemeHub;
  etat: EtatOnglets;
  /** Apps des onglets ouverts, dans l'ordre de la barre. */
  apps: readonly AppHub[];
  /** Le hub est à l'écran (aucun onglet affiché). */
  surHub: boolean;
  /** Deux apps sont affichées côte à côte. */
  partage: boolean;
  /** Le côte à côte est possible (écran assez large). */
  coteACotePossible: boolean;
  ailleurs?: Ailleurs;
  annonce?: string;
  onActiver(id: string | undefined): void;
  onFermer(id: string): void;
  onACote(id: string): void;
  onEchanger(): void;
  onQuitterCote(cote: 'gauche' | 'droite'): void;
  onAilleurs?(id: string): void;
}

interface Ancre {
  id: string;
  x: number;
  y: number;
}

export function BarreOngletsApps({
  theme,
  etat,
  apps,
  surHub,
  partage,
  coteACotePossible,
  ailleurs,
  annonce,
  onActiver,
  onFermer,
  onACote,
  onEchanger,
  onQuitterCote,
  onAilleurs,
}: PropsBarreOnglets) {
  const [menu, setMenu] = useState<Ancre | undefined>();
  const { width } = useWindowDimensions();
  const rayon = Math.min(theme.rayonMoyen, 10);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const appMenu = menu ? apps.find(app => app.id === menu.id) : undefined;
  const etroit = width < 900;
  return (
    <View style={[styles.barre, { backgroundColor: theme.fond, borderBottomColor: theme.ligne }]} testID="onglets-barre" accessibilityRole="tablist" accessibilityLabel="Apps ouvertes">
      <Pressable
        testID="onglets-hub"
        accessibilityRole="tab"
        accessibilityState={{ selected: surHub }}
        aria-selected={surHub}
        accessibilityLabel="Hub : toutes vos apps"
        onPress={() => onActiver(undefined)}
        style={(e: EtatPresse) => [
          styles.hub,
          { borderRadius: rayon, backgroundColor: surHub ? theme.accent : e.hovered ? teinteTransparente(theme.accent, 0.12) : 'transparent' },
        ]}>
        <Text style={[texte, { color: surHub ? theme.surAccent : theme.texte, fontWeight: '700', fontSize: 14 }]}>⌂ Hub</Text>
      </Pressable>
      <View style={styles.onglets}>
        {apps.map((app, index) => (
          <Onglet
            key={app.id}
            theme={theme}
            app={app}
            rang={index + 1}
            actif={etat.actif === app.id}
            aDroite={partage && etat.cote === app.id}
            etroit={etroit}
            onActiver={() => onActiver(app.id)}
            onFermer={() => onFermer(app.id)}
            onMenu={ancre => setMenu({ id: app.id, ...ancre })}
          />
        ))}
      </View>
      {partage ? (
        <View style={styles.actionsCote}>
          <PetitBouton theme={theme} titre="⇄" libelle="Échanger les deux côtés" testID="onglets-echanger" onPress={onEchanger} />
          <PetitBouton theme={theme} titre="◧" libelle="Fermer le côté droit (l’onglet reste ouvert)" testID="onglets-quitter-droite" onPress={() => onQuitterCote('droite')} />
          <PetitBouton theme={theme} titre="◨" libelle="Fermer le côté gauche (l’onglet reste ouvert)" testID="onglets-quitter-gauche" onPress={() => onQuitterCote('gauche')} />
        </View>
      ) : null}
      <Text style={[styles.compte, { color: theme.attenue, ...police(theme.policeTexte) }]} testID="onglets-compte" accessibilityLabel={`${apps.length} onglets ouverts sur ${MAX_ONGLETS}`}>
        {apps.length}/{MAX_ONGLETS}
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.annonce} testID="onglets-annonce">
        {annonce ?? ''}
      </Text>
      <Modal visible={Boolean(menu && appMenu)} transparent animationType="none" onRequestClose={() => setMenu(undefined)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(undefined)} accessibilityLabel="Fermer le menu" testID="onglets-menu-fond" />
        {menu && appMenu ? (
          <MenuOnglet
            theme={theme}
            app={appMenu}
            ancre={menu}
            largeurFenetre={width}
            actif={etat.actif === appMenu.id}
            peutACote={coteACotePossible && etat.actif !== undefined && etat.actif !== appMenu.id && etat.cote !== appMenu.id}
            ailleurs={onAilleurs ? ailleurs : undefined}
            onFermerMenu={() => setMenu(undefined)}
            onACote={() => onACote(appMenu.id)}
            onAilleurs={() => onAilleurs?.(appMenu.id)}
            onFermer={() => onFermer(appMenu.id)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function Onglet({
  theme,
  app,
  rang,
  actif,
  aDroite,
  etroit,
  onActiver,
  onFermer,
  onMenu,
}: {
  theme: ThemeHub;
  app: AppHub;
  rang: number;
  actif: boolean;
  aDroite: boolean;
  etroit: boolean;
  onActiver(): void;
  onFermer(): void;
  onMenu(ancre: { x: number; y: number }): void;
}) {
  const noeud = useRef<unknown>(null);
  const bouton = useRef<unknown>(null);
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  const couleur = theme.teintes[app.teinte];
  const rayon = Math.min(theme.rayonMoyen, 10);
  // Clic molette : ferme l'onglet, comme dans un navigateur.
  useEffect(() => {
    const element = noeud.current as { addEventListener?(t: string, f: (e: { button: number; preventDefault(): void }) => void): void; removeEventListener?(t: string, f: (e: { button: number; preventDefault(): void }) => void): void } | null;
    if (Platform.OS !== 'web' || !element?.addEventListener) return undefined;
    const bas = (e: { button: number; preventDefault(): void }) => {
      if (e.button === 1) e.preventDefault();
    };
    const auxiliaire = (e: { button: number; preventDefault(): void }) => {
      if (e.button === 1) {
        e.preventDefault();
        fermer.current();
      }
    };
    element.addEventListener('mousedown', bas);
    element.addEventListener('auxclick', auxiliaire);
    return () => {
      element.removeEventListener?.('mousedown', bas);
      element.removeEventListener?.('auxclick', auxiliaire);
    };
  }, []);
  const ouvrirMenu = () => {
    const cible = bouton.current as unknown as { measureInWindow?(f: (x: number, y: number, l: number, h: number) => void): void } | null;
    if (cible?.measureInWindow) {
      cible.measureInWindow((x, y, _l, h) => onMenu({ x, y: y + h + 4 }));
    } else {
      onMenu({ x: 0, y: 48 });
    }
  };
  return (
    <View
      ref={noeud as React.Ref<never>}
      testID={`onglets-n${rang}`}
      style={[
        styles.onglet,
        etroit && styles.ongletEtroit,
        {
          borderRadius: rayon,
          backgroundColor: actif || aDroite ? theme.surface : 'transparent',
          borderColor: actif ? couleur : aDroite ? theme.ligne : 'transparent',
        },
      ]}>
      <Pressable
        testID={`onglets-n${rang}-ouvrir`}
        accessibilityRole="tab"
        accessibilityState={{ selected: actif }}
        aria-selected={actif}
        accessibilityLabel={`${app.nom}${aDroite ? ' (à droite)' : ''}, onglet ${rang}`}
        onPress={onActiver}
        onLongPress={ouvrirMenu}
        style={styles.ongletTitre}>
        <Text style={{ color: couleur, fontSize: 15, fontWeight: '700' }}>{app.icone}</Text>
        <Text numberOfLines={1} style={[styles.ongletNom, { color: theme.texte, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }]}>
          {app.nom}
        </Text>
        {aDroite ? <Text style={{ color: theme.attenue, fontSize: 12 }}>▐</Text> : null}
      </Pressable>
      <Pressable
        ref={bouton as React.Ref<never>}
        testID={`onglets-n${rang}-menu`}
        accessibilityRole="button"
        accessibilityLabel={`Actions de l’onglet ${app.nom}`}
        onPress={ouvrirMenu}
        style={(e: EtatPresse) => [styles.ongletAction, { borderRadius: 6, backgroundColor: e.hovered ? teinteTransparente(theme.texte, 0.08) : 'transparent' }]}>
        <Text style={{ color: theme.attenue, fontSize: 14, fontWeight: '700' }}>⋯</Text>
      </Pressable>
      <Pressable
        testID={`onglets-n${rang}-fermer`}
        accessibilityRole="button"
        accessibilityLabel={`Fermer l’onglet ${app.nom}`}
        onPress={onFermer}
        style={(e: EtatPresse) => [styles.ongletAction, { borderRadius: 6, backgroundColor: e.hovered ? teinteTransparente(theme.critique, 0.14) : 'transparent' }]}>
        <Text style={{ color: theme.attenue, fontSize: 16, lineHeight: 18 }}>×</Text>
      </Pressable>
    </View>
  );
}

function MenuOnglet({
  theme,
  app,
  ancre,
  largeurFenetre,
  actif,
  peutACote,
  ailleurs,
  onFermerMenu,
  onACote,
  onAilleurs,
  onFermer,
}: {
  theme: ThemeHub;
  app: AppHub;
  ancre: Ancre;
  largeurFenetre: number;
  actif: boolean;
  peutACote: boolean;
  ailleurs?: Ailleurs;
  onFermerMenu(): void;
  onACote(): void;
  onAilleurs(): void;
  onFermer(): void;
}) {
  const LARGEUR = 300;
  const gauche = Math.max(8, Math.min(ancre.x, largeurFenetre - LARGEUR - 8));
  const ligne = (testID: string, titre: string, action: () => void, desactive = false) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={() => {
        onFermerMenu();
        action();
      }}
      style={(e: EtatPresse) => [
        styles.ligneMenu,
        { borderRadius: Math.min(theme.rayonMoyen, 8), opacity: desactive ? 0.45 : 1 },
        (e.hovered || e.focused) && { backgroundColor: teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.07) },
      ]}>
      <Text style={{ color: theme.texte, fontSize: 14, fontWeight: '500', ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
  return (
    <View
      testID="onglets-menu"
      accessibilityRole="menu"
      accessibilityLabel={`Actions de ${app.nom}`}
      style={[styles.menu, { left: gauche, top: ancre.y, width: LARGEUR, backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
      <Text style={[styles.menuTitre, { color: theme.attenue }]}>{app.nom.toUpperCase()}</Text>
      {peutACote ? ligne('onglets-menu-a-cote', '▐ Afficher à côté', onACote) : null}
      {ailleurs === 'fenetre' ? ligne('onglets-menu-ailleurs', '⧉ Ouvrir dans une nouvelle fenêtre', onAilleurs) : null}
      {ailleurs === 'navigateur' ? ligne('onglets-menu-ailleurs', '↗ Ouvrir dans un nouvel onglet du navigateur', onAilleurs) : null}
      {ligne('onglets-menu-fermer', actif ? '× Fermer l’onglet' : '× Fermer cet onglet', onFermer)}
    </View>
  );
}

function PetitBouton({ theme, titre, libelle, testID, onPress }: { theme: ThemeHub; titre: string; libelle: string; testID: string; onPress(): void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      onPress={onPress}
      style={(e: EtatPresse) => [
        styles.petitBouton,
        { borderRadius: Math.min(theme.rayonMoyen, 8), borderColor: e.hovered ? theme.accent : theme.ligne, backgroundColor: theme.fond },
      ]}>
      <Text style={{ color: theme.texte, fontSize: 15, fontWeight: '700' }}>{titre}</Text>
    </Pressable>
  );
}

/**
 * Téléphone et écrans étroits : « ▤ n » dans l'en-tête ouvre la liste des
 * onglets (passer à un autre, en fermer). Rien sans onglet ouvert.
 */
export function SelecteurOngletsMobile({ theme }: { theme: ThemeHub }) {
  const controle = useOngletsHub();
  const [ouvert, setOuvert] = useState(false);
  if (!controle || controle.apps.length === 0) {
    return null;
  }
  const { apps, etat } = controle;
  return (
    <>
      <BoutonIcone
        theme={theme}
        titre="▤"
        pastille={String(apps.length)}
        libelle={`Apps ouvertes : ${apps.length}`}
        onPress={() => setOuvert(true)}
        testID="onglets-mobile-ouvrir"
      />
      <FeuilleBasse
        theme={theme}
        visible={ouvert}
        titre="Apps ouvertes"
        description={`Chaque app garde son état. ${MAX_ONGLETS} au plus.`}
        onFermer={() => setOuvert(false)}
        testID="onglets-mobile">
        <GroupeCellules theme={theme}>
          <Cellule
            theme={theme}
            glyphe="⌂"
            titre="Accueil"
            sousTitre="Toutes vos apps"
            coche={etat.actif === undefined}
            onPress={() => {
              setOuvert(false);
              controle.activer(undefined);
            }}
            testID="onglets-mobile-hub"
          />
          {apps.map(app => (
            <Cellule
              key={app.id}
              theme={theme}
              glyphe={app.icone}
              teinte={theme.teintes[app.teinte]}
              titre={app.nom}
              coche={etat.actif === app.id}
              onPress={() => {
                setOuvert(false);
                controle.activer(app.id);
              }}
              testID={`onglets-mobile-${app.id}`}
              droite={
                <Pressable
                  testID={`onglets-mobile-${app.id}-fermer`}
                  accessibilityRole="button"
                  accessibilityLabel={`Fermer ${app.nom}`}
                  hitSlop={6}
                  onPress={() => controle.fermer(app.id)}
                  style={styles.fermerMobile}>
                  <Text style={{ color: theme.attenue, fontSize: 22, lineHeight: 24 }}>×</Text>
                </Pressable>
              }
            />
          ))}
        </GroupeCellules>
      </FeuilleBasse>
    </>
  );
}

const styles = StyleSheet.create({
  barre: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: 1, minHeight: 46 },
  hub: { paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  onglets: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' },
  onglet: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 10, paddingRight: 2, minHeight: 34, maxWidth: 230, minWidth: 0, flexShrink: 1 },
  ongletEtroit: { maxWidth: 170 },
  ongletTitre: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, minWidth: 0, minHeight: 32 },
  ongletNom: { fontSize: 13.5, flexShrink: 1 },
  ongletAction: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  actionsCote: { flexDirection: 'row', gap: 4 },
  petitBouton: { width: 34, height: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compte: { fontSize: 12, fontWeight: '600', marginLeft: 4 },
  annonce: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  menu: {
    position: 'absolute',
    padding: 6,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  menuTitre: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, fontSize: 11, fontWeight: '600', letterSpacing: 1.1 },
  ligneMenu: { paddingVertical: 10, paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' },
  fermerMobile: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
