/**
 * Profils de jeu précis (Administration › Jeux) :
 *  - `ModeleProfil` : modèle de strat du jeu (Valorant, The Finals, générique) et données pré-remplies
 *    (capacités des agents, modèle The Finals), toutes « à vérifier » ;
 *  - `DetailsCarte` : image de la map (import depuis un fichier, état vide clair), plan avec callouts,
 *    repères (sites, spawns, cashouts, coffres), calibrage de l'échelle par deux points, étages ;
 *  - `CapacitesPersonnage` : capacités d'un personnage (forme, dimensions en mètres, durée, charges, coût).
 */

import React, { Suspense, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import { CATEGORIES_CAPACITE, FORMES_CAPACITE, TYPES_REPERES, type CapaciteJeu, type CarteJeu, type DonneesJeu, type ImageJeu, type PersonnageJeu, type TypeRepere } from '../../jeux/api';
import { ajouterNiveau, ajouterRepere, ajouterZone, avecEchelle, avecImage, echelleDepuis, retirer, renommer } from '../../jeux/cartes';
import { trSt } from '../../i18n/strats2';
import { capacitesPrereplies, fusionnerTheFinals, preremplirCapacites } from '../../jeux/modeles';
import type { ModeleStrat } from '../../strats/modeles';
import { trJc, type CleJc } from '../../i18n/jeuxCartes';
import { Choix, styles } from '../commun';
import { Badge, attenue, texte } from '../design';
import { choisirImage, choixImageDisponible } from './choixImage';
import { PlanCarte } from './planCarte';


/** Dépôt d'une image dans le profil (fond d'une map). */
export type DeposerImage = (corps: { type: string; donnees: string; nom?: string }) => Promise<{ id: string; url: string | null; largeur: number; hauteur: number }>;

const nombre = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};
const enTexte = (n: number | undefined) => (typeof n === 'number' ? String(n) : '');

// ------------------------------------------------------------------ Modèle et pré-remplissage

export function ModeleProfil({ theme, modele, onModele, d, onDonnees, testID }: { theme: ThemeHub; modele: ModeleStrat; onModele(m: ModeleStrat): void; d: DonneesJeu; onDonnees(d: DonneesJeu): void; testID: string }) {
  const [avis, setAvis] = useState<string | undefined>();
  const aCompleter = d.personnages.filter(p => !p.capacites?.length && capacitesPrereplies(modele, p).length > 0).length;
  const etages = [trJc('etages.sous_sol'), trJc('etages.rdc'), trJc('etages.etage1'), trJc('etages.etage2'), trJc('etages.toit')];
  return (
    <View style={{ gap: 8 }} testID={`${testID}-modele`}>
      <Segments<ModeleStrat>
        theme={theme}
        libelle={trJc('modele.titre')}
        valeur={modele}
        options={[['valorant', trJc('modele.valorant')], ['thefinals', trJc('modele.thefinals')], ['generique', trJc('modele.generique')]]}
        onChoisir={onModele}
        testID={`${testID}-modele-choix`}
      />
      <Text style={attenue(theme, 12)}>{trJc('modele.aide')}</Text>
      {modele !== 'generique' ? (
        <View style={[styles.ligne, { gap: 8 }]}>
          {modele === 'thefinals' ? (
            <BoutonHub
              theme={theme}
              titre={trJc('prerempli.thefinals')}
              onPress={() => {
                const r = fusionnerTheFinals(d, etages);
                onDonnees(r.donnees);
                setAvis(trJc('prerempli.thefinals_ok', { n: r.ajouts }));
              }}
              testID={`${testID}-prerempli-thefinals`}
            />
          ) : null}
          <BoutonHub
            theme={theme}
            titre={trJc('prerempli.capacites', { n: aCompleter })}
            desactive={aCompleter === 0}
            onPress={() => {
              const r = preremplirCapacites(d, modele);
              onDonnees(r.donnees);
              setAvis(r.n ? trJc('prerempli.capacites_ok', { n: r.n }) : trJc('prerempli.aucune'));
            }}
            testID={`${testID}-prerempli-capacites`}
          />
        </View>
      ) : null}
      {modele !== 'generique' ? <Text style={attenue(theme, 12)}>{trJc('prerempli.aide')}</Text> : null}
      {avis ? (
        <Text style={{ ...texte(theme, 13), color: theme.ok }} testID={`${testID}-prerempli-avis`}>
          {avis}
        </Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Map détaillée

type Mode = 'zone' | 'repere' | 'echelle';
const COULEURS_ZONES = ['#e5e7eb', '#f59e0b', '#22c55e', '#38bdf8', '#f43f5e', '#a855f7'];

export function DetailsCarte({
  theme,
  carte: c,
  onCarte,
  image,
  deposer,
  testID,
}: {
  theme: ThemeHub;
  carte: CarteJeu;
  onCarte(c: CarteJeu): void;
  /** Lien signé de l'image déposée (profil enregistré), ou de celle qu'on vient d'importer. */
  image?: ImageJeu;
  /** Absent : profil pas encore enregistré (création). */
  deposer?: DeposerImage;
  testID: string;
}) {
  const [mode, setMode] = useState<Mode>('zone');
  const [points, setPoints] = useState<number[]>([]);
  const [nom, setNom] = useState('');
  const [type, setType] = useState<TypeRepere>('site');
  const [niveau, setNiveau] = useState<string>('');
  const [distance, setDistance] = useState('');
  const [couleurZone, setCouleurZone] = useState<string>(COULEURS_ZONES[0]);
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [envoi, setEnvoi] = useState(false);
  const [locale, setLocale] = useState<ImageJeu | undefined>();
  const img = locale ?? image;
  const changerMode = (m: Mode) => {
    setMode(m);
    setPoints([]);
    setErreur(undefined);
  };

  const importer = async () => {
    if (!deposer) return;
    setErreur(undefined);
    const f = await choisirImage();
    if (!f) return;
    setEnvoi(true);
    try {
      const r = await deposer(f);
      setLocale({ url: r.url, expire: null, largeur: r.largeur, hauteur: r.hauteur });
      onCarte(avecImage(c, r.id));
      setAvis(trJc('carte.image_envoyee'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  const surPoint = (x: number, y: number) => {
    setErreur(undefined);
    if (mode === 'repere') {
      if (!nom.trim()) {
        setErreur(trJc('carte.repere_nom'));
        return;
      }
      onCarte(ajouterRepere(c, nom, type, x, y, niveau === '' ? null : Number(niveau)));
      setNom('');
      return;
    }
    if (mode === 'echelle') {
      setPoints(p => (p.length >= 4 ? [x, y] : [...p, x, y]));
      return;
    }
    setPoints(p => (p.length >= 48 ? p : [...p, x, y]));
  };

  const echelle = c.echelle;
  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trJc('carte.image')}</Text>
      <Text style={attenue(theme, 12)}>{trJc('carte.image_aide')}</Text>
      {!img?.url ? <Text style={{ ...texte(theme, 13), fontStyle: 'italic' }} testID={`${testID}-image-vide`}>{trJc('carte.image_vide')}</Text> : null}
      <View style={[styles.ligne, { gap: 8 }]}>
        {deposer && choixImageDisponible ? <BoutonHub theme={theme} titre={c.fichier ? trJc('carte.image_remplacer') : trJc('carte.image_deposer')} desactive={envoi} onPress={() => void importer()} testID={`${testID}-image-importer`} /> : null}
        {c.fichier ? <BoutonHub theme={theme} titre={trJc('carte.image_retirer')} variante="danger" onPress={() => (setLocale(undefined), onCarte(avecImage(c, null)))} testID={`${testID}-image-retirer`} /> : null}
      </View>
      {!deposer ? <Text style={attenue(theme, 12)}>{trJc('carte.image_enregistrer_dabord')}</Text> : null}
      {avis ? <Text style={{ ...texte(theme, 13), color: theme.ok }}>{avis}</Text> : null}
      {erreur ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID={`${testID}-erreur`}>{erreur}</Text> : null}

      <Segments<Mode> theme={theme} libelle={trJc('carte.mode')} valeur={mode} options={[['zone', trJc('carte.mode.zone')], ['repere', trJc('carte.mode.repere')], ['echelle', trJc('carte.mode.echelle')]]} onChoisir={changerMode} testID={`${testID}-mode`} />
      {mode === 'zone' ? (
        <View style={{ gap: 6 }}>
          <Text style={attenue(theme, 12)}>{trJc('carte.zone_aide')}</Text>
          <View style={[styles.ligne, { gap: 8, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJc('carte.zone_nom')} valeur={nom} onChanger={setNom} maxLength={30} style={{ minWidth: 160, flex: 1 }} testID={`${testID}-zone-nom`} />
            <BoutonHub
              theme={theme}
              titre={trJc('carte.zone_fermer')}
              desactive={points.length < 6 || !nom.trim()}
              onPress={() => {
                onCarte(ajouterZone(c, nom, points, couleurZone));
                setPoints([]);
                setNom('');
              }}
              testID={`${testID}-zone-fermer`}
            />
            <BoutonHub theme={theme} titre={trJc('carte.zone_dernier')} desactive={points.length === 0} onPress={() => setPoints(p => p.slice(0, -2))} testID={`${testID}-zone-dernier`} />
            <BoutonHub theme={theme} titre={trJc('carte.zone_annuler')} desactive={points.length === 0} onPress={() => setPoints([])} testID={`${testID}-zone-annuler`} />
          </View>
          <Choix theme={theme} libelle={trJc('carte.zone_couleur')} valeur={couleurZone} options={COULEURS_ZONES.map(x => ({ id: x, nom: x, couleur: x }))} onChoisir={setCouleurZone} repliable={false} testID={`${testID}-zone-couleur`} />
          <Text style={attenue(theme, 12)} testID={`${testID}-points`}>{trJc('carte.points_poses', { n: points.length / 2 })}</Text>
        </View>
      ) : null}
      {mode === 'repere' ? (
        <View style={{ gap: 6 }}>
          <Text style={attenue(theme, 12)}>{trJc('carte.repere_aide')}</Text>
          <Champ theme={theme} libelle={trJc('carte.repere_nom')} valeur={nom} onChanger={setNom} maxLength={30} testID={`${testID}-repere-nom`} />
          <Choix<TypeRepere> theme={theme} libelle={trJc('carte.repere_type')} valeur={type} options={TYPES_REPERES.map(t => ({ id: t, nom: trJc(`repere.${t}` as CleJc) }))} onChoisir={setType} repliable={false} testID={`${testID}-repere-type`} />
          {c.niveaux?.length ? <Choix theme={theme} libelle={trJc('carte.niveau_repere')} valeur={niveau} options={[{ id: '', nom: '–' }, ...c.niveaux.map((n, i) => ({ id: String(i), nom: n.nom }))]} onChoisir={setNiveau} repliable={false} testID={`${testID}-repere-niveau`} /> : null}
        </View>
      ) : null}
      {mode === 'echelle' ? (
        <View style={{ gap: 6 }}>
          <Text style={attenue(theme, 12)}>{trJc('carte.echelle_aide')}</Text>
          <View style={[styles.ligne, { gap: 8, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJc('carte.echelle_distance')} valeur={distance} onChanger={setDistance} clavier="number-pad" maxLength={7} style={{ width: 160 }} testID={`${testID}-echelle-distance`} />
            <BoutonHub
              theme={theme}
              titre={trJc('carte.echelle_valider')}
              desactive={points.length !== 4 || nombre(distance) === undefined}
              onPress={() => {
                const e = echelleDepuis(points, nombre(distance) ?? 0);
                if (!e) {
                  setErreur(trJc('carte.echelle_invalide'));
                  return;
                }
                onCarte(avecEchelle(c, e));
                setPoints([]);
              }}
              testID={`${testID}-echelle-valider`}
            />
            {echelle ? <BoutonHub theme={theme} titre={trJc('carte.echelle_effacer')} variante="danger" onPress={() => onCarte(avecEchelle(c, null))} testID={`${testID}-echelle-effacer`} /> : null}
          </View>
          <Text style={attenue(theme, 12)} testID={`${testID}-points`}>{trJc('carte.points_poses', { n: points.length / 2 })}</Text>
        </View>
      ) : null}
      <Text style={{ ...texte(theme, 13) }} testID={`${testID}-echelle`}>
        {echelle ? trJc('carte.echelle_actuelle', { v: echelle.pxParMetre, m: Math.round(1000 / echelle.pxParMetre) }) : trJc('carte.echelle_aucune')}
      </Text>

      <Suspense fallback={null}>
        <PlanCarte carte={c} url={img?.url ?? null} largeur={img?.largeur} hauteur={img?.hauteur} taille={Math.min(560, 520)} points={points} fermer={mode === 'zone' && points.length >= 6} onPoint={surPoint} />
      </Suspense>

      <ListeElements theme={theme} titre={trJc('carte.zones', { n: c.zones?.length ?? 0 })} elements={c.zones ?? []} onRenommer={(cle, n) => onCarte(renommer(c, 'zones', cle, n))} onRetirer={cle => onCarte(retirer(c, 'zones', cle))} testID={`${testID}-zones`} />
      <ListeElements theme={theme} titre={trJc('carte.reperes', { n: c.reperes?.length ?? 0 })} elements={(c.reperes ?? []).map(r => ({ ...r, detail: trJc(`repere.${r.type}` as CleJc) }))} onRenommer={(cle, n) => onCarte(renommer(c, 'reperes', cle, n))} onRetirer={cle => onCarte(retirer(c, 'reperes', cle))} testID={`${testID}-reperes`} />
      <ListeElements theme={theme} titre={trJc('carte.niveaux', { n: c.niveaux?.length ?? 0 })} elements={c.niveaux ?? []} onRenommer={(cle, n) => onCarte(renommer(c, 'niveaux', cle, n))} onRetirer={cle => onCarte(retirer(c, 'niveaux', cle))} testID={`${testID}-niveaux`} />
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} titre={trJc('carte.ajouter_niveau')} onPress={() => onCarte(ajouterNiveau(c, trSt('niveau.n', { n: c.niveaux?.length ?? 0 })))} testID={`${testID}-ajouter-niveau`} />
      </View>
    </View>
  );
}

function ListeElements({ theme, titre, elements, onRenommer, onRetirer, testID }: { theme: ThemeHub; titre: string; elements: Array<{ cle: string; nom: string; detail?: string }>; onRenommer(cle: string, nom: string): void; onRetirer(cle: string): void; testID: string }) {
  if (elements.length === 0) return null;
  return (
    <View style={{ gap: 4 }} testID={testID}>
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{titre}</Text>
      {elements.map(e => (
        <View key={e.cle} style={[styles.ligne, { gap: 6, alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={e.detail ?? e.cle} valeur={e.nom} onChanger={n => onRenommer(e.cle, n)} maxLength={30} style={{ flex: 1, minWidth: 140 }} testID={`${testID}-${e.cle}-nom`} />
          <BoutonHub theme={theme} titre="✕" libelle={trJc('carte.retirer', { nom: e.nom })} onPress={() => onRetirer(e.cle)} testID={`${testID}-${e.cle}-retirer`} />
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Capacités d'un personnage

export function CapacitesPersonnage({ theme, personnage: p, modele, onCapacites, testID }: { theme: ThemeHub; personnage: PersonnageJeu; modele: ModeleStrat; onCapacites(c: CapaciteJeu[] | undefined): void; testID: string }) {
  const liste = p.capacites ?? [];
  const maj = (i: number, champs: Partial<CapaciteJeu>) => onCapacites(liste.map((c, j) => (j === i ? { ...c, ...champs } : c)));
  const prerempli = capacitesPrereplies(modele, p);
  const aVerifier = liste.filter(c => c.aVerifier).length;
  return (
    <View style={{ gap: 8, width: '100%' }} testID={testID}>
      <View style={[styles.ligne, { gap: 8 }]}>
        <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trJc('capacites.titre', { n: liste.length })}</Text>
        {aVerifier ? <Badge theme={theme} texte={trJc('capacites.n_a_verifier', { n: aVerifier })} ton="alerte" testID={`${testID}-a-verifier`} /> : null}
      </View>
      <Text style={attenue(theme, 12)}>{trJc('capacites.aide')}</Text>
      {liste.map((c, i) => (
        <View key={`${c.cle}-${i}`} style={{ gap: 6, borderLeftWidth: 3, borderLeftColor: c.aVerifier ? theme.alerte : theme.ok, paddingLeft: 8 }} testID={`${testID}-${i}`}>
          <View style={[styles.ligne, { gap: 6, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJc('capacites.nom')} valeur={c.nom} onChanger={nom => maj(i, { nom, cle: c.cle || '' })} maxLength={40} style={{ minWidth: 140, flex: 1 }} testID={`${testID}-${i}-nom`} />
            <Champ theme={theme} libelle={trJc('capacites.touche')} valeur={c.touche} onChanger={touche => maj(i, { touche: touche.slice(0, 6) })} maxLength={6} style={{ width: 80 }} testID={`${testID}-${i}-touche`} />
            <BoutonHub theme={theme} titre="✕" libelle={trJc('carte.retirer', { nom: c.nom })} onPress={() => onCapacites(liste.filter((_, j) => j !== i))} testID={`${testID}-${i}-retirer`} />
          </View>
          <Choix theme={theme} libelle={trJc('capacites.categorie')} valeur={c.categorie} options={CATEGORIES_CAPACITE.map(x => ({ id: x, nom: trJc(`categorie.${x}` as CleJc) }))} onChoisir={categorie => maj(i, { categorie })} repliable testID={`${testID}-${i}-categorie`} />
          <Choix theme={theme} libelle={trJc('capacites.forme')} valeur={c.forme} options={FORMES_CAPACITE.map(x => ({ id: x, nom: trJc(`forme.${x}` as CleJc) }))} onChoisir={forme => maj(i, { forme })} repliable testID={`${testID}-${i}-forme`} />
          <View style={[styles.ligne, { gap: 6 }]}>
            {(['rayon', 'longueur', 'largeur', 'ouverture', 'portee', 'duree', 'charges', 'cout'] as const).map(k => (
              <Champ key={k} theme={theme} libelle={trJc(`capacites.${k}` as CleJc)} valeur={enTexte(c[k])} onChanger={v => maj(i, { [k]: nombre(v) })} clavier="number-pad" maxLength={7} style={{ width: 104 }} testID={`${testID}-${i}-${k}`} />
            ))}
          </View>
          <View style={[styles.ligne, { gap: 8 }]}>
            <Case theme={theme} coche={Boolean(c.courbable)} libelle={trJc('capacites.courbable')} onChanger={v => maj(i, { courbable: v || undefined })} testID={`${testID}-${i}-courbable`} />
            <Text style={texte(theme, 13)}>{trJc('capacites.courbable')}</Text>
            <Case theme={theme} coche={c.aVerifier} libelle={trJc('capacites.a_verifier')} onChanger={v => maj(i, { aVerifier: v })} testID={`${testID}-${i}-a-verifier`} />
            <Text style={texte(theme, 13)}>{trJc('capacites.a_verifier')}</Text>
          </View>
        </View>
      ))}
      <View style={[styles.ligne, { gap: 8 }]}>
        <BoutonHub theme={theme} titre={trJc('capacites.ajouter')} desactive={liste.length >= 40} onPress={() => onCapacites([...liste, { cle: '', nom: '', touche: '', categorie: 'basique', forme: 'cercle', aVerifier: false }])} testID={`${testID}-ajouter`} />
        {prerempli.length && liste.length === 0 ? <BoutonHub theme={theme} titre={trJc('capacites.prerempli')} onPress={() => onCapacites(prerempli)} testID={`${testID}-prerempli`} /> : null}
      </View>
    </View>
  );
}
