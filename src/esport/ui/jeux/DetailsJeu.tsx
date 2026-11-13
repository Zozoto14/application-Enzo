/**
 * Profils de jeu précis (Administration › Jeux) :
 *  - `ModeleProfil` : modèle de strat du jeu (Valorant, The Finals, générique) et données pré-remplies
 *    (capacités des agents, modèle The Finals), toutes « à vérifier » ;
 *  - `DetailsCarte` : image de la map (import depuis un fichier, état vide clair), plan avec callouts,
 *    repères (sites, spawns, cashouts, coffres), calibrage de l'échelle par deux points, étages ;
 *  - `CapacitesPersonnage` : capacités d'un personnage (forme, dimensions en mètres, durée, charges, coût).
 */

import React, { Suspense, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import { CATEGORIES_CAPACITE, FORMES_CAPACITE, TYPES_REPERES, type CapaciteJeu, type CarteJeu, type DonneesJeu, type ImageJeu, type LigneImport, type LigneImportAgent, type PersonnageJeu, type TypeRepere } from '../../jeux/api';
import { cleDe } from '../../jeux/profil';
import { ajouterNiveau, ajouterRepere, ajouterZone, avecEchelle, avecImage, echelleDepuis, retirer, renommer } from '../../jeux/cartes';
import { trSt } from '../../i18n/strats2';
import { accentPrerempli, capacitesPrereplies, fusionnerTheFinals, preremplirCapacites } from '../../jeux/modeles';
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
      {c.source ? <Text style={attenue(theme, 12)} testID={`${testID}-source`}>{trJc('carte.source', { fournisseur: c.source.fournisseur, le: c.source.le?.slice(0, 10) ?? '' })}{c.source.aVerifier ? ` ${trJc('carte.source_a_verifier')}` : ''}</Text> : null}
      {c.source?.attribution ? <Text style={attenue(theme, 11)} testID={`${testID}-attribution`}>{c.source.attribution}</Text> : null}
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
        {echelle ? `${trJc('carte.echelle_actuelle', { v: echelle.pxParMetre, m: Math.round(1000 / echelle.pxParMetre) })}${echelle.methode === 'import' ? ` ${trJc('carte.echelle_importee')}` : echelle.methode === 'approx' ? ` ${trJc('carte.echelle_approx')}` : ''}` : trJc('carte.echelle_aucune')}
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

/** Couleur saisie (« #rrggbb », avec ou sans dièse) ; undefined : vide ou invalide. */
const couleurSaisie = (v: string): string | undefined => {
  const t = v.trim().toLowerCase();
  const h = t.startsWith('#') ? t : `#${t}`;
  return /^#[0-9a-f]{6}$/.test(h) ? h : undefined;
};

/** Champ d'une couleur d'accent : pastille, saisie hexadécimale ; vide = valeur par défaut (`defaut`, « à vérifier »). */
function ChampAccent({ theme, libelle, valeur, defaut, onChanger, testID }: { theme: ThemeHub; libelle: string; valeur: string | undefined; defaut?: string; onChanger(c: string | undefined): void; testID: string }) {
  const [saisie, setSaisie] = useState(valeur ?? '');
  useEffect(() => setSaisie(valeur ?? ''), [valeur]);
  const montree = couleurSaisie(saisie) ?? valeur ?? defaut;
  return (
    <View style={[styles.ligne, { gap: 6, alignItems: 'flex-end' }]}>
      <View style={{ width: 28, height: 28, borderRadius: 14, marginBottom: 6, backgroundColor: montree ?? 'transparent', borderWidth: 2, borderColor: theme.ligne }} testID={`${testID}-pastille`} accessibilityLabel={montree ?? trJc('accent.aucun')} />
      <Champ
        theme={theme}
        libelle={libelle}
        valeur={saisie}
        placeholder={defaut ?? '#rrggbb'}
        onChanger={v => {
          setSaisie(v);
          if (!v.trim()) onChanger(undefined);
          else if (couleurSaisie(v)) onChanger(couleurSaisie(v));
        }}
        maxLength={7}
        style={{ width: 130 }}
        testID={testID}
      />
    </View>
  );
}

export function CapacitesPersonnage({ theme, personnage: p, modele, onCapacites, onCouleur, testID }: { theme: ThemeHub; personnage: PersonnageJeu; modele: ModeleStrat; onCapacites(c: CapaciteJeu[] | undefined): void; /** Accent du personnage (absent : champ non proposé). */ onCouleur?(c: string | undefined): void; testID: string }) {
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
      {onCouleur ? (
        <View style={{ gap: 4 }} testID={`${testID}-accent-bloc`}>
          <View style={[styles.ligne, { gap: 8, alignItems: 'flex-end' }]}>
            <ChampAccent theme={theme} libelle={trJc('accent.personnage')} valeur={p.couleur} defaut={accentPrerempli(modele, p)} onChanger={onCouleur} testID={`${testID}-accent`} />
            {!p.couleur && accentPrerempli(modele, p) ? <Badge theme={theme} texte={trJc('accent.a_verifier')} ton="alerte" testID={`${testID}-accent-a-verifier`} /> : null}
          </View>
          <Text style={attenue(theme, 12)}>{trJc('accent.aide')}</Text>
        </View>
      ) : null}
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
            {c.forme === 'mur' ? (
              <>
                <Case theme={theme} coche={Boolean(c.double)} libelle={trJc('capacites.double')} onChanger={v => maj(i, { double: v || undefined })} testID={`${testID}-${i}-double`} />
                <Text style={texte(theme, 13)}>{trJc('capacites.double')}</Text>
              </>
            ) : null}
            <Case theme={theme} coche={c.aVerifier} libelle={trJc('capacites.a_verifier')} onChanger={v => maj(i, { aVerifier: v })} testID={`${testID}-${i}-a-verifier`} />
            <Text style={texte(theme, 13)}>{trJc('capacites.a_verifier')}</Text>
          </View>
          {onCouleur ? <ChampAccent theme={theme} libelle={trJc('accent.capacite')} valeur={c.couleur} defaut={p.couleur ?? accentPrerempli(modele, p)} onChanger={couleur => maj(i, { couleur })} testID={`${testID}-${i}-accent`} /> : null}
        </View>
      ))}
      <View style={[styles.ligne, { gap: 8 }]}>
        <BoutonHub theme={theme} titre={trJc('capacites.ajouter')} desactive={liste.length >= 40} onPress={() => onCapacites([...liste, { cle: '', nom: '', touche: '', categorie: 'basique', forme: 'cercle', aVerifier: false }])} testID={`${testID}-ajouter`} />
        {prerempli.length && liste.length === 0 ? <BoutonHub theme={theme} titre={trJc('capacites.prerempli')} onPress={() => onCapacites(prerempli)} testID={`${testID}-prerempli`} /> : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Import serveur des images et de l'échelle

/** Maps de The Finals proposées pour l'import (noms courants, à vérifier). */
export const CARTES_IMPORT_THEFINALS = ['Monaco', 'Seoul', 'Skyway Stadium', 'SYS$HORIZON', 'Las Vegas', 'Kyoto', 'Bernal', 'Fortune Stadium', 'Nozomi Citadel'];

export function ImportCartes({
  theme,
  profil,
  importer,
  onFini,
}: {
  theme: ThemeHub;
  profil: { cle: string; version: number; modeleStrat?: ModeleStrat; donnees: DonneesJeu };
  importer(corps: { version?: number; urls?: Record<string, string>; remplacer?: boolean }): Promise<{ rapport: LigneImport[]; inchange: boolean }>;
  onFini(): void;
}) {
  const modele = profil.modeleStrat ?? 'generique';
  const [enCours, setEnCours] = useState(false);
  const [rapport, setRapport] = useState<LigneImport[] | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [remplacer, setRemplacer] = useState(false);
  const cartesTf = Array.from(new Set([...profil.donnees.cartes.map(c => c.nom), ...CARTES_IMPORT_THEFINALS]));
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries(profil.donnees.cartes.filter(c => c.source?.url).map(c => [c.cle, c.source?.url ?? ''])));
  if (modele === 'generique') return <Text style={attenue(theme, 12)} testID="esport-jeu-import-generique">{trJc('import.generique')}</Text>;
  const lancer = async () => {
    setEnCours(true);
    setErreur(undefined);
    setRapport(undefined);
    try {
      const r = await importer({ version: profil.version, ...(modele === 'thefinals' ? { urls: Object.fromEntries(Object.entries(urls).filter(([, u]) => u.trim())) } : {}), ...(remplacer ? { remplacer: true } : {}) });
      setRapport(r.rapport);
      onFini();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <View style={{ gap: 8 }} testID="esport-jeu-import">
      <Text style={attenue(theme, 12)}>{modele === 'valorant' ? trJc('import.aide_valorant') : trJc('import.aide_thefinals')}</Text>
      {modele === 'thefinals'
        ? cartesTf.map(nom => {
            const cle = cleDe(nom);
            return <Champ key={cle} theme={theme} libelle={trJc('import.adresse', { nom })} valeur={urls[cle] ?? ''} onChanger={v => setUrls(x => ({ ...x, [cle]: v }))} placeholder="https://" maxLength={500} testID={`esport-jeu-import-url-${cle}`} />;
          })
        : null}
      <View style={[styles.ligne, { gap: 8 }]}>
        <Case theme={theme} coche={remplacer} libelle={trJc('import.remplacer')} onChanger={setRemplacer} testID="esport-jeu-import-remplacer" />
        <Text style={texte(theme, 13)}>{trJc('import.remplacer')}</Text>
      </View>
      <BoutonHub theme={theme} titre={enCours ? trJc('import.en_cours') : trJc('import.lancer')} variante="plein" desactive={enCours} onPress={() => void lancer()} testID="esport-jeu-import-lancer" />
      {erreur ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID="esport-jeu-import-erreur">{erreur}</Text> : null}
      {rapport ? (
        <View style={{ gap: 2 }} testID="esport-jeu-import-rapport">
          {rapport.map(l => (
            <Text key={l.carte} style={{ ...texte(theme, 12), color: l.erreur ? theme.critique : theme.texte }}>
              {`${l.carte} : ${trJc(`import.image.${l.image}` as CleJc)} · ${trJc(`import.echelle.${l.echelle}` as CleJc)}${l.reperes ? ` · ${trJc('import.reperes', { n: l.reperes })}` : ''}${l.erreur ? ` · ${trJc('import.erreur', { code: l.erreur })}` : ''}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Import serveur des agents et de leurs capacités (Valorant)

export function ImportAgents({
  theme,
  profil,
  importer,
  onFini,
}: {
  theme: ThemeHub;
  profil: { version: number };
  importer(corps: { version?: number; remplacer?: boolean }): Promise<{ rapport: LigneImportAgent[]; inchange: boolean }>;
  onFini(): void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [rapport, setRapport] = useState<LigneImportAgent[] | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [remplacer, setRemplacer] = useState(false);
  const lancer = async () => {
    setEnCours(true);
    setErreur(undefined);
    setRapport(undefined);
    try {
      const r = await importer({ version: profil.version, ...(remplacer ? { remplacer: true } : {}) });
      setRapport(r.rapport);
      onFini();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <View style={{ gap: 8 }} testID="esport-jeu-import-agents">
      <Text style={attenue(theme, 12)}>{trJc('agents.aide')}</Text>
      <View style={[styles.ligne, { gap: 8 }]}>
        <Case theme={theme} coche={remplacer} libelle={trJc('agents.remplacer')} onChanger={setRemplacer} testID="esport-jeu-import-agents-remplacer" />
        <Text style={texte(theme, 13)}>{trJc('agents.remplacer')}</Text>
      </View>
      <BoutonHub theme={theme} titre={enCours ? trJc('agents.en_cours') : trJc('agents.lancer')} variante="plein" desactive={enCours} onPress={() => void lancer()} testID="esport-jeu-import-agents-lancer" />
      {erreur ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID="esport-jeu-import-agents-erreur">{erreur}</Text> : null}
      {rapport ? (
        <View style={{ gap: 2 }} testID="esport-jeu-import-agents-rapport">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>
            {trJc('agents.resume', { agents: rapport.length, portraits: rapport.filter(l => l.portrait === 'importee').length, icones: rapport.reduce((n, l) => n + l.capacites, 0) })}
          </Text>
          {rapport.map(l => (
            <Text key={l.agent} style={{ ...texte(theme, 12), color: l.erreur ? theme.critique : theme.texte }}>
              {[l.agent, trJc(`agents.portrait.${l.portrait}` as CleJc), l.capacites ? trJc('agents.icones', { n: l.capacites }) : '', l.ajoute ? trJc('agents.ajoute') : '', l.erreur ? trJc('import.erreur', { code: l.erreur }) : ''].filter(Boolean).join(' · ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
