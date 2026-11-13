/**
 * Panneaux de l'éditeur de strats (React Native : site, app PC, et testables sans canevas) :
 *  - couleurs et libellés des phases d'une étape (frise et tiroir de l'atelier) ;
 *  - `ListeUtilitaires` : ordre de lancer des utilitaires de l'étape (monter, descendre, minutage) ;
 *  - `PanneauJoueurs` : les joueurs du modèle (nom, couleur, agent ou classe, rôle) ;
 *  - `Inspecteur` : propriétés de l'objet choisi (dimensions en mètres, ordre, minutage, étage…) ;
 *  - `FicheCapacite` : caractéristiques d'une capacité (profil de jeu, « à vérifier »).
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { sourcesIcone, type AgentAsset, type CapaciteAsset } from '../../strats/assets';
import { IconeAsset } from './Barres';
import { USAGES_TRACE, ordreUtilitaires, type Action, type ChampsObjet, type DocumentStrat, type ObjetStrat, type Zone } from '../../strats/document';
import { usageTrace } from '../../strats/plateau';
import { trAt, type CleAt } from '../../i18n/atelier';
import { definitionPour, type GenreMarqueur } from '../../strats/modeles';
import { trSt } from '../../i18n/strats2';
import { Choix, Intertitre, Panneau, styles } from '../commun';
import { Glyphe } from '../../../ui/icones';

const COULEURS_PHASES: Record<string, string> = {
  setup: '#64748b',
  execute: '#ef4444',
  'post-plant': '#f59e0b',
  retake: '#3b82f6',
  'mid-round': '#a855f7',
  approche: '#64748b',
  prise: '#ef4444',
  tenue: '#22c55e',
  vol: '#f59e0b',
  engagement: '#ef4444',
  elimination: '#a855f7',
  troisieme: '#a855f7',
  fin: '#3b82f6',
  debut: '#64748b',
  milieu: '#f59e0b',
};
export const couleurPhase = (p: string | null | undefined): string => (p ? (COULEURS_PHASES[p] ?? '#64748b') : '#475569');
export const libellePhase = (p: string): string => trSt(`phase.${p}` as Parameters<typeof trSt>[0]);

const nombre = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
};
const texteNombre = (n: number | null | undefined): string => (typeof n === 'number' ? String(n) : '');

/** Panneau encadré (page), ou simple pile sans cadre (tiroir de l'atelier : `cadre={false}`). */
function Cadre({ theme, cadre = true, testID, children }: { theme: ThemeHub; cadre?: boolean; testID: string; children: React.ReactNode }) {
  if (cadre) return <Panneau theme={theme} testID={testID}>{children}</Panneau>;
  return (
    <View style={{ gap: 10 }} testID={testID}>
      {children}
    </View>
  );
}

/** Petit bouton carré (icône ou symbole). */
function Bouton({ theme, libelle, onPress, desactive, children, testID, actif }: { theme: ThemeHub; libelle: string; onPress(): void; desactive?: boolean; children: React.ReactNode; testID: string; actif?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: desactive, selected: actif }}
      disabled={desactive}
      onPress={onPress}
      style={{
        minWidth: 40,
        minHeight: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? theme.accent : theme.ligne,
        backgroundColor: actif ? teinteTransparente(theme.accent, 0.2) : theme.surface,
        opacity: desactive ? 0.4 : 1,
        paddingHorizontal: 8,
      }}>
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Ordre des utilitaires

export function ListeUtilitaires({ theme, doc, etape, faire, modifiable, onChoisir, cadre }: { theme: ThemeHub; doc: DocumentStrat; etape: number; faire(a: Action): void; modifiable: boolean; onChoisir(id: string): void; cadre?: boolean }) {
  const e = doc.etapes[etape];
  if (!e) return null;
  const liste = ordreUtilitaires(e);
  const renumeroter = (ids: string[]) => ids.forEach((id, i) => faire({ type: 'modifier', etape, id, champs: { ordre: i + 1 } }));
  return (
    <Cadre theme={theme} cadre={cadre} testID="esport-utilitaires">
      {cadre === false ? null : <Intertitre theme={theme}>{trSt('utilitaires.titre')}</Intertitre>}
      {liste.length === 0 ? <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{trSt('utilitaires.vide')}</Text> : null}
      {liste.map((c, i) => (
        <View key={c.id} style={[styles.ligne, { gap: 6, flexWrap: 'nowrap' }]} testID={`esport-utilitaire-${c.id}`}>
          <Text style={{ color: theme.texte, fontWeight: '800', width: 22, ...police(theme.policeTexte) }}>{c.ordre ?? '–'}</Text>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.couleur }} />
          <Pressable accessibilityRole="button" onPress={() => onChoisir(c.id)} style={{ flex: 1, minWidth: 0 }} testID={`esport-utilitaire-choisir-${c.id}`}>
            <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} numberOfLines={1}>
              {`${c.nom}${c.joueur !== null && doc.joueurs[c.joueur] ? ` · ${doc.joueurs[c.joueur].nom}` : ''}${typeof c.t === 'number' ? ` · ${c.t} s` : ''}`}
            </Text>
          </Pressable>
          {modifiable ? (
            <>
              <Bouton theme={theme} libelle={trSt('utilitaires.monter', { nom: c.nom })} desactive={i === 0} onPress={() => renumeroter(liste.map(x => x.id).map((id, j, t) => (j === i - 1 ? t[i] : j === i ? t[i - 1] : id)))} testID={`esport-utilitaire-monter-${c.id}`}>
                <Glyphe valeur="chevron-haut" style={{ color: theme.texte, fontSize: 14 }} />
              </Bouton>
              <Bouton theme={theme} libelle={trSt('utilitaires.descendre', { nom: c.nom })} desactive={i === liste.length - 1} onPress={() => renumeroter(liste.map(x => x.id).map((id, j, t) => (j === i + 1 ? t[i] : j === i ? t[i + 1] : id)))} testID={`esport-utilitaire-descendre-${c.id}`}>
                <Glyphe valeur="chevron-bas" style={{ color: theme.texte, fontSize: 14 }} />
              </Bouton>
            </>
          ) : null}
        </View>
      ))}
    </Cadre>
  );
}

// ------------------------------------------------------------------ Joueurs

export function PanneauJoueurs({ theme, doc, agents, joueur, onJoueur, faire, modifiable, libelleAgent, cadre }: { theme: ThemeHub; doc: DocumentStrat; agents: AgentAsset[]; joueur: number | null; onJoueur(i: number): void; faire(a: Action): void; modifiable: boolean; libelleAgent: string; cadre?: boolean }) {
  return (
    <Cadre theme={theme} cadre={cadre} testID="esport-joueurs">
      {cadre === false ? null : <Intertitre theme={theme}>{trSt('joueurs.titre', { n: doc.joueurs.length })}</Intertitre>}
      {doc.joueurs.map((j, i) => (
        <View key={i} style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: j.couleur, paddingLeft: 8, opacity: joueur === i ? 1 : 0.92 }} testID={`esport-joueur-ligne-${i}`}>
          <View style={[styles.ligne, { gap: 6 }]}>
            <Bouton theme={theme} libelle={trSt('joueurs.choisir', { nom: j.nom, n: i + 1 })} onPress={() => onJoueur(i)} actif={joueur === i} testID={`esport-joueur-${i}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: j.couleur }} />
                <Text style={{ color: theme.texte, fontSize: 12 }}>{i + 1}</Text>
              </View>
            </Bouton>
            {j.agent ? <IconeAsset theme={theme} url={sourcesIcone(agents.find(a => a.cle === j.agent))} nom={agents.find(a => a.cle === j.agent)?.nom ?? j.agent} taille={26} testID={`esport-joueur-portrait-${i}`} /> : null}
            {modifiable ? (
              <>
                <Champ theme={theme} libelle={trSt('joueurs.nom')} valeur={j.nom} onChanger={nom => faire({ type: 'joueur', index: i, champs: { nom: nom.slice(0, 24) } })} maxLength={24} style={{ flex: 1, minWidth: 110 }} testID={`esport-joueur-nom-${i}`} />
                <Champ theme={theme} libelle={trSt('joueurs.role')} valeur={j.role ?? ''} onChanger={role => faire({ type: 'joueur', index: i, champs: { role: role.slice(0, 24) || null } })} maxLength={24} style={{ width: 110 }} testID={`esport-joueur-role-${i}`} />
              </>
            ) : (
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{[j.nom, j.role].filter(Boolean).join(' · ')}</Text>
            )}
          </View>
          {modifiable && agents.length ? (
            <Choix
              theme={theme}
              libelle={libelleAgent}
              valeur={j.agent ?? ''}
              options={[{ id: '', nom: trSt('joueurs.aucun') }, ...agents.map(a => ({ id: a.cle, nom: a.nom }))]}
              onChoisir={agent => faire({ type: 'joueur', index: i, champs: { agent: agent || null } })}
              repliable
              testID={`esport-joueur-agent-${i}`}
            />
          ) : j.agent ? (
            <Text style={{ color: theme.attenue, fontSize: 12 }}>{agents.find(a => a.cle === j.agent)?.nom ?? j.agent}</Text>
          ) : null}
        </View>
      ))}
    </Cadre>
  );
}

// ------------------------------------------------------------------ Caractéristiques d'une capacité

export function FicheCapacite({ theme, capacite }: { theme: ThemeHub; capacite: CapaciteAsset | undefined }) {
  const d = capacite?.donnees;
  if (!capacite) return null;
  const morceaux = d
    ? [
        trSt(`forme.${d.forme}` as Parameters<typeof trSt>[0]),
        d.rayon !== undefined ? trSt('fiche.rayon', { v: d.rayon }) : '',
        d.longueur !== undefined ? trSt('fiche.longueur', { v: d.longueur }) : '',
        d.largeur !== undefined ? trSt('fiche.largeur', { v: d.largeur }) : '',
        d.ouverture !== undefined ? trSt('fiche.ouverture', { v: d.ouverture }) : '',
        d.portee !== undefined ? trSt('fiche.portee', { v: d.portee }) : '',
        d.duree !== undefined ? trSt('fiche.duree', { v: d.duree }) : '',
        d.charges !== undefined ? trSt('fiche.charges', { v: d.charges }) : '',
        d.cout !== undefined ? trSt(d.categorie === 'ultime' ? 'fiche.points' : 'fiche.cout', { v: d.cout }) : '',
      ].filter(Boolean)
    : [];
  return (
    <View style={{ gap: 4 }} testID="esport-fiche-capacite">
      <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{`${capacite.nom}${capacite.touche ? ` (${capacite.touche})` : ''}`}</Text>
      {morceaux.length ? <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{morceaux.join(' · ')}</Text> : <Text style={{ color: theme.attenue, fontSize: 12 }}>{trSt('fiche.sans_donnees')}</Text>}
      {d?.aVerifier ? (
        <Text style={{ color: theme.alerte, fontSize: 11, fontWeight: '700', ...police(theme.policeTexte) }} testID="esport-fiche-a-verifier">
          {trSt('fiche.a_verifier')}
        </Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Inspecteur de l'objet choisi

function ChampNombre({ theme, libelle, valeur, onChanger, testID, largeur = 100 }: { theme: ThemeHub; libelle: string; valeur: number | null | undefined; onChanger(n: number | null): void; testID: string; largeur?: number }) {
  const [texte, setTexte] = React.useState(texteNombre(valeur));
  React.useEffect(() => setTexte(texteNombre(valeur)), [valeur]);
  return (
    <Champ
      theme={theme}
      libelle={libelle}
      valeur={texte}
      onChanger={v => {
        setTexte(v);
        const n = nombre(v);
        if (n !== null || v.trim() === '') onChanger(n);
      }}
      clavier="number-pad"
      maxLength={7}
      style={{ width: largeur }}
      testID={testID}
    />
  );
}

export interface PropsInspecteur {
  theme: ThemeHub;
  doc: DocumentStrat;
  etape: number;
  objet: ObjetStrat;
  faire(a: Action): void;
  niveaux: Array<{ valeur: number; nom: string }>;
  genres: readonly GenreMarqueur[];
  onFermer(): void;
  onSupprimer(): void;
  onDupliquer(): void;
  /** Sans cadre (tiroir de l'atelier). */
  cadre?: boolean;
}

export function Inspecteur({ theme, doc, etape, objet: o, faire, niveaux, genres, onFermer, onSupprimer, onDupliquer, cadre }: PropsInspecteur) {
  const champs = (c: ChampsObjet) => faire({ type: 'modifier', etape, id: o.id, champs: c });
  const zone = (z: Partial<Zone>) => o.type === 'capacite' && o.zone && champs({ zone: { ...o.zone, ...z } as Zone });
  const def = definitionPour(doc.modele, doc.mode);
  const optionsJoueurs = [{ id: '', nom: trSt('joueurs.aucun') }, ...doc.joueurs.map((j, i) => ({ id: String(i), nom: `${i + 1}. ${j.nom}`, couleur: j.couleur }))];
  return (
    <Cadre theme={theme} cadre={cadre} testID="esport-inspecteur">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trSt(`objet.${o.type}` as Parameters<typeof trSt>[0])}</Intertitre>
        <BoutonHub theme={theme} titre="✕" libelle={trSt('inspecteur.fermer')} onPress={onFermer} testID="esport-inspecteur-fermer" />
      </View>
      {o.type === 'capacite' ? (
        <>
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{o.nom}</Text>
          <View style={[styles.ligne, { gap: 6 }]}>
            <ChampNombre theme={theme} libelle={trSt('inspecteur.ordre')} valeur={o.ordre} onChanger={n => champs({ ordre: n === null ? null : Math.max(1, Math.min(99, Math.round(n))) })} testID="esport-inspecteur-ordre" largeur={80} />
            <ChampNombre theme={theme} libelle={trSt('inspecteur.minutage')} valeur={o.t} onChanger={n => champs({ t: n === null ? null : Math.max(0, Math.min(600, n)) })} testID="esport-inspecteur-t" largeur={90} />
          </View>
          {o.zone?.forme === 'cercle' ? <ChampNombre theme={theme} libelle={trSt('inspecteur.rayon')} valeur={o.zone.rayon} onChanger={n => n !== null && zone({ rayon: Math.max(0.2, Math.min(100, n)) })} testID="esport-inspecteur-rayon" /> : null}
          {o.zone?.forme === 'cercle' ? <Case theme={theme} coche={Boolean(o.creux)} libelle={trAt('inspecteur.creux')} onChanger={v => champs({ creux: v })} testID="esport-inspecteur-creux" /> : null}
          {o.zone && (o.zone.forme === 'mur' || o.zone.forme === 'ligne' || o.zone.forme === 'rect') ? (
            <View style={[styles.ligne, { gap: 6 }]}>
              <ChampNombre theme={theme} libelle={trSt('inspecteur.longueur')} valeur={o.zone.longueur} onChanger={n => n !== null && zone({ longueur: Math.max(0.5, Math.min(200, n)) })} testID="esport-inspecteur-longueur" />
              {o.zone.forme !== 'ligne' ? <ChampNombre theme={theme} libelle={trSt('inspecteur.largeur')} valeur={o.zone.largeur} onChanger={n => n !== null && zone({ largeur: Math.max(0.1, Math.min(100, n)) })} testID="esport-inspecteur-largeur" /> : null}
              <ChampNombre theme={theme} libelle={trSt('inspecteur.angle')} valeur={o.zone.angle} onChanger={n => n !== null && zone({ angle: ((n % 360) + 360) % 360 })} testID="esport-inspecteur-angle" />
            </View>
          ) : null}
          {o.zone?.forme === 'cone' ? (
            <View style={[styles.ligne, { gap: 6 }]}>
              <ChampNombre theme={theme} libelle={trSt('inspecteur.portee')} valeur={o.zone.portee} onChanger={n => n !== null && zone({ portee: Math.max(0.5, Math.min(200, n)) })} testID="esport-inspecteur-portee" />
              <ChampNombre theme={theme} libelle={trSt('inspecteur.ouverture')} valeur={o.zone.ouverture} onChanger={n => n !== null && zone({ ouverture: Math.max(5, Math.min(360, n)) })} testID="esport-inspecteur-ouverture" />
              <ChampNombre theme={theme} libelle={trSt('inspecteur.angle')} valeur={o.zone.angle} onChanger={n => n !== null && zone({ angle: ((n % 360) + 360) % 360 })} testID="esport-inspecteur-angle" />
            </View>
          ) : null}
          {o.zone?.forme === 'trajet' ? <ChampNombre theme={theme} libelle={trSt('inspecteur.revelation')} valeur={o.zone.rayon} onChanger={n => n !== null && zone({ rayon: Math.max(0, Math.min(100, n)) })} testID="esport-inspecteur-rayon" /> : null}
          {o.zone?.forme === 'mur' ? <Text style={{ color: theme.attenue, fontSize: 12 }}>{trSt('inspecteur.aide_mur')}</Text> : null}
        </>
      ) : null}
      {o.type === 'vision' ? (
        <View style={[styles.ligne, { gap: 6 }]}>
          <ChampNombre theme={theme} libelle={trSt('inspecteur.portee')} valeur={o.portee} onChanger={n => n !== null && champs({ portee: Math.max(1, Math.min(200, n)) })} testID="esport-inspecteur-portee" />
          <ChampNombre theme={theme} libelle={trSt('inspecteur.ouverture')} valeur={o.ouverture} onChanger={n => n !== null && champs({ ouverture: Math.max(5, Math.min(360, n)) })} testID="esport-inspecteur-ouverture" />
          <ChampNombre theme={theme} libelle={trSt('inspecteur.angle')} valeur={o.angle} onChanger={n => n !== null && champs({ angle: ((n % 360) + 360) % 360 })} testID="esport-inspecteur-angle" />
        </View>
      ) : null}
      {o.type === 'fleche' || o.type === 'ligne' ? (
        <>
          <Choix theme={theme} libelle={trAt('options.usage')} valeur={usageTrace(o)} options={USAGES_TRACE.map(u => ({ id: u, nom: trAt(`usage.${u}` as CleAt) }))} onChoisir={u => champs({ usage: u, tirets: u === 'rotation' })} repliable={false} testID="esport-inspecteur-usage" />
          <Choix theme={theme} libelle={trSt('inspecteur.trajet_de')} valeur={o.joueur === null || o.joueur === undefined ? '' : String(o.joueur)} options={optionsJoueurs} onChoisir={v => champs(v === '' ? { joueur: null } : { joueur: Number(v), couleur: doc.joueurs[Number(v)]?.couleur ?? o.couleur })} repliable={false} testID="esport-inspecteur-joueur" />
          <View style={[styles.ligne, { gap: 6 }]}>
            <ChampNombre theme={theme} libelle={trSt('inspecteur.depart')} valeur={o.t0} onChanger={n => champs({ t0: n === null ? null : Math.max(0, Math.min(600, n)) })} testID="esport-inspecteur-t0" largeur={90} />
            <ChampNombre theme={theme} libelle={trSt('inspecteur.arrivee')} valeur={o.t1} onChanger={n => champs({ t1: n === null ? null : Math.max(0, Math.min(600, n)) })} testID="esport-inspecteur-t1" largeur={90} />
          </View>
        </>
      ) : null}
      {o.type === 'marqueur' ? (
        <>
          <Choix theme={theme} libelle={trSt('marqueur.genre')} valeur={o.genre} options={genres.map(g => ({ id: g, nom: trSt(`marqueur.${g}` as Parameters<typeof trSt>[0]) }))} onChoisir={genre => champs({ genre })} repliable testID="esport-inspecteur-genre" />
          <Champ theme={theme} libelle={trSt('marqueur.etiquette')} valeur={o.etiquette} onChanger={etiquette => champs({ etiquette: etiquette.slice(0, 40) })} maxLength={40} testID="esport-inspecteur-etiquette" />
          {o.genre === 'ennemi' && def.equipesAdverses > 1 ? (
            <Choix theme={theme} libelle={trSt('marqueur.equipe')} valeur={String(o.equipe ?? '')} options={[{ id: '', nom: trSt('joueurs.aucun') }, ...Array.from({ length: def.equipesAdverses }, (_, i) => ({ id: String(i + 1), nom: trSt('marqueur.equipe_n', { n: i + 1 }) }))]} onChoisir={v => champs({ equipe: v ? Number(v) : null })} repliable={false} testID="esport-inspecteur-equipe" />
          ) : null}
        </>
      ) : null}
      {o.type === 'texte' ? <Champ theme={theme} libelle={trSt('inspecteur.texte')} valeur={o.texte} onChanger={texte => texte.trim() && champs({ texte: texte.slice(0, 200) })} maxLength={200} testID="esport-inspecteur-texte" /> : null}
      {niveaux.length ? (
        <Choix
          theme={theme}
          libelle={trSt('inspecteur.etage')}
          valeur={typeof o.niveau === 'number' ? String(o.niveau) : ''}
          options={[{ id: '', nom: trSt('niveau.tous') }, ...niveaux.map(n => ({ id: String(n.valeur), nom: n.nom }))]}
          onChoisir={v => champs({ niveau: v === '' ? null : Number(v) })}
          repliable={false}
          testID="esport-inspecteur-niveau"
        />
      ) : null}
      <View style={[styles.ligne, { gap: 6 }]}>
        <BoutonHub theme={theme} titre={trSt('inspecteur.dupliquer')} onPress={onDupliquer} testID="esport-inspecteur-dupliquer" />
        <BoutonHub theme={theme} titre={trSt('inspecteur.supprimer')} variante="danger" onPress={onSupprimer} testID="esport-editeur-effacer" />
      </View>
    </Cadre>
  );
}
