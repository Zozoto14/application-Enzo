/**
 * « Maps proposées » (Administration › Jeux) : le serveur prépare une proposition par map (The Finals : wiki
 * communautaire ; Valorant : valorant-api.com), le gestionnaire la revoit puis la valide. Rien n'est appliqué
 * au profil avant « Valider » ou « Valider toutes ». Par map : aperçu de l'image, nom, échelle, source et
 * licence, pool suggéré, ce que la validation changera ; « Rejeter », « Remplacer l'image » (adresse https ou
 * fichier), « Calibrer » (deux points sur le plan et la distance réelle).
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import type { CarteProposee, ImageJeu, LignePreparation, ListeCartesProposees } from '../../jeux/api';
import type { ModeleStrat } from '../../strats/modeles';
import { trJc, type CleJc } from '../../i18n/jeuxCartes';
import { styles } from '../commun';
import { Badge, attenue, texte } from '../design';
import { choisirImage, choixImageDisponible } from './choixImage';
import { PlanCarte } from './planCarte';

/** Appels du serveur utilisés par l'écran (api.ts, liés au jeu). */
export interface ApiCartesProposees {
  liste(): Promise<ListeCartesProposees>;
  preparer(): Promise<ListeCartesProposees & { rapport: LignePreparation[] }>;
  valider(corps: { cartes?: string[]; toutes?: boolean }): Promise<ListeCartesProposees & { validees: string[] }>;
  rejeter(cartes: string[]): Promise<ListeCartesProposees>;
  remplacerImage(carte: string, corps: { url: string } | { type: string; donnees: string; nom?: string }): Promise<ListeCartesProposees>;
  calibrer(carte: string, corps: { points: number[]; distance: number }): Promise<ListeCartesProposees>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TONS = { 'a-valider': 'alerte', validee: 'ok', rejetee: 'neutre' } as const;

export function CartesProposees({ theme, modele, api, onApplique }: { theme: ThemeHub; modele?: ModeleStrat; api: ApiCartesProposees; /** Après une validation : recharger le profil. */ onApplique(): void }) {
  const [liste, setListe] = useState<ListeCartesProposees | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [rapport, setRapport] = useState<LignePreparation[] | undefined>();

  const avecImport = modele === 'valorant' || modele === 'thefinals';
  useEffect(() => {
    if (!avecImport) return undefined;
    let vivant = true;
    api
      .liste()
      .then(l => vivant && setListe(l))
      .catch(e => vivant && setErreur(message(e)));
    return () => {
      vivant = false;
    };
  }, [api, avecImport]);

  const agir = useCallback(async (f: () => Promise<ListeCartesProposees | undefined>, apres?: (l: ListeCartesProposees) => void) => {
    setEnCours(true);
    setErreur(undefined);
    setAvis(undefined);
    try {
      const l = await f();
      if (l) {
        setListe(l);
        apres?.(l);
      }
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  }, []);

  if (!avecImport) return null;
  const aValider = (liste?.cartes ?? []).filter(c => c.statut === 'a-valider');
  const valider = (corps: { cartes?: string[]; toutes?: boolean }) =>
    agir(
      () => api.valider(corps),
      l => {
        setAvis(trJc('prop.validees', { n: (l as ListeCartesProposees & { validees?: string[] }).validees?.length ?? 0 }));
        onApplique();
      },
    );

  return (
    <View style={{ gap: 10 }} testID="esport-jeu-proposees">
      <Text style={attenue(theme, 12)}>{modele === 'thefinals' ? trJc('prop.aide_thefinals') : trJc('prop.aide_valorant')}</Text>
      <View style={[styles.ligne, { gap: 8 }]}>
        <BoutonHub
          theme={theme}
          titre={enCours ? trJc('prop.en_cours') : liste?.cartes.length ? trJc('prop.preparer_encore') : trJc('prop.preparer')}
          variante="plein"
          desactive={enCours}
          onPress={() => void agir(async () => {
            const r = await api.preparer();
            setRapport(r.rapport);
            return r;
          })}
          testID="esport-jeu-proposees-preparer"
        />
        {aValider.length > 0 ? <BoutonHub theme={theme} titre={trJc('prop.valider_toutes', { n: aValider.length })} desactive={enCours} onPress={() => void valider({ toutes: true })} testID="esport-jeu-proposees-valider-toutes" /> : null}
      </View>
      {erreur ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID="esport-jeu-proposees-erreur">{erreur}</Text> : null}
      {avis ? <Text style={{ ...texte(theme, 13), color: theme.ok }} testID="esport-jeu-proposees-avis">{avis}</Text> : null}
      {rapport ? (
        <Text style={attenue(theme, 12)} testID="esport-jeu-proposees-rapport">
          {rapport.map(l => `${l.carte} : ${trJc(`prop.rapport.${l.statut}` as CleJc)}${l.erreur ? ` (${l.erreur})` : ''}`).join(' · ')}
        </Text>
      ) : null}
      {liste && liste.cartes.length === 0 ? <Text style={{ ...texte(theme, 13), fontStyle: 'italic' }} testID="esport-jeu-proposees-vide">{trJc('prop.vide')}</Text> : null}
      {aValider.length > 0 ? <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trJc('prop.n_a_valider', { n: aValider.length })}</Text> : null}
      {(liste?.cartes ?? []).map(c => (
        <FicheProposee
          key={c.cle}
          theme={theme}
          carte={c}
          image={c.fichier ? liste?.images[c.fichier] : undefined}
          occupe={enCours}
          onValider={() => void valider({ cartes: [c.cle] })}
          onRejeter={() => void agir(() => api.rejeter([c.cle]))}
          onRemplacer={corps => agir(() => api.remplacerImage(c.cle, corps))}
          onCalibrer={corps => agir(() => api.calibrer(c.cle, corps))}
        />
      ))}
    </View>
  );
}

function libelleChangements(c: CarteProposee): string {
  const ch = c.changements;
  const parts = [
    ch.nouvelle ? trJc('prop.ch.nouvelle') : null,
    ch.image !== 'aucune' ? trJc(`prop.ch.image.${ch.image}` as CleJc) : null,
    ch.echelle !== 'aucune' ? trJc(`prop.ch.echelle.${ch.echelle}` as CleJc) : null,
    ch.reperes ? trJc('prop.ch.reperes', { n: ch.reperes }) : null,
  ].filter(Boolean);
  return trJc('prop.changements', { v: parts.join(', ') });
}

function FicheProposee({
  theme,
  carte: c,
  image,
  occupe,
  onValider,
  onRejeter,
  onRemplacer,
  onCalibrer,
}: {
  theme: ThemeHub;
  carte: CarteProposee;
  image?: ImageJeu;
  occupe: boolean;
  onValider(): void;
  onRejeter(): void;
  onRemplacer(corps: { url: string } | { type: string; donnees: string; nom?: string }): Promise<void>;
  onCalibrer(corps: { points: number[]; distance: number }): Promise<void>;
}) {
  const [panneau, setPanneau] = useState<'image' | 'calibrer' | null>(null);
  const [url, setUrl] = useState('');
  const [points, setPoints] = useState<number[]>([]);
  const [distance, setDistance] = useState('');
  const id = `esport-jeu-proposee-${c.cle}`;
  const e = c.echelle;
  const methode = c.echelleManuelle ? 'manuel' : (e?.methode ?? 'manuel');
  const largeurApercu = 220;
  const hauteurApercu = image?.largeur && image.hauteur ? Math.round((largeurApercu * image.hauteur) / image.largeur) : largeurApercu;
  const distanceNombre = Number(distance.replace(',', '.'));
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={id}>
      <View style={[styles.ligne, { gap: 8, alignItems: 'center' }]}>
        <Text style={{ ...texte(theme, 15), fontWeight: '700', flexShrink: 1 }}>{c.nom}</Text>
        <Badge theme={theme} texte={trJc(`prop.statut.${c.statut}` as CleJc)} ton={TONS[c.statut]} testID={`${id}-statut`} />
      </View>
      {image?.url ? <Image source={{ uri: image.url }} style={{ width: largeurApercu, height: Math.min(hauteurApercu, 320), borderRadius: 8, backgroundColor: theme.fond }} resizeMode="contain" accessibilityLabel={c.nom} testID={`${id}-apercu`} /> : null}
      {!c.fichier ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID={`${id}-sans-image`}>{trJc('prop.sans_image', { code: c.erreur ?? '-' })}</Text> : null}
      {c.fichier && !c.vueDessus ? <Text style={{ ...texte(theme, 12), color: theme.alerte }} testID={`${id}-pas-vue-dessus`}>{trJc('prop.pas_vue_dessus')}</Text> : null}
      {c.imageManuelle ? <Text style={attenue(theme, 12)}>{trJc('prop.image_manuelle')}</Text> : null}
      <Text style={texte(theme, 13)} testID={`${id}-echelle`}>
        {e ? `${trJc('prop.echelle', { v: e.pxParMetre, m: Math.round(1000 / e.pxParMetre) })} (${trJc(`prop.echelle.${methode}` as CleJc)})` : trJc('prop.echelle_aucune')}
      </Text>
      <Text style={attenue(theme, 12)} testID={`${id}-pool`}>{c.competitive === true ? trJc('prop.pool.oui') : c.competitive === false ? trJc('prop.pool.non') : trJc('prop.pool.inconnu')}</Text>
      {c.variantes.length ? <Text style={attenue(theme, 12)}>{trJc('prop.variantes', { v: c.variantes.join(', ') })}</Text> : null}
      {c.attribution ? <Text style={attenue(theme, 11)} testID={`${id}-attribution`}>{c.attribution}</Text> : null}
      {c.page ? <Text style={attenue(theme, 11)} selectable testID={`${id}-source`}>{trJc('prop.source', { page: c.page })}</Text> : null}
      {c.statut === 'a-valider' ? <Text style={texte(theme, 12)} testID={`${id}-changements`}>{libelleChangements(c)}</Text> : null}
      {c.statut === 'a-valider' ? (
        <View style={[styles.ligne, { gap: 8 }]}>
          <BoutonHub theme={theme} titre={trJc('prop.valider')} variante="plein" desactive={occupe} onPress={onValider} testID={`${id}-valider`} />
          <BoutonHub theme={theme} titre={trJc('prop.rejeter')} variante="danger" desactive={occupe} onPress={onRejeter} testID={`${id}-rejeter`} />
          <BoutonHub theme={theme} titre={trJc('prop.remplacer')} desactive={occupe} onPress={() => setPanneau(p => (p === 'image' ? null : 'image'))} testID={`${id}-remplacer`} />
          <BoutonHub theme={theme} titre={trJc('prop.calibrer')} desactive={occupe || !c.fichier} onPress={() => (setPoints([]), setPanneau(p => (p === 'calibrer' ? null : 'calibrer')))} testID={`${id}-calibrer`} />
        </View>
      ) : null}
      {panneau === 'image' ? (
        <View style={[styles.ligne, { gap: 8, alignItems: 'flex-end' }]} testID={`${id}-panneau-image`}>
          <Champ theme={theme} libelle={trJc('prop.url')} valeur={url} onChanger={setUrl} placeholder="https://" maxLength={500} style={{ minWidth: 220, flex: 1 }} testID={`${id}-url`} />
          <BoutonHub theme={theme} titre={trJc('prop.telecharger')} desactive={occupe || !/^https:\/\//i.test(url.trim())} onPress={() => void onRemplacer({ url: url.trim() }).then(() => setPanneau(null))} testID={`${id}-url-envoyer`} />
          {choixImageDisponible ? (
            <BoutonHub
              theme={theme}
              titre={trJc('prop.fichier')}
              desactive={occupe}
              onPress={() =>
                void choisirImage().then(f => {
                  if (f) void onRemplacer({ type: f.type, donnees: f.donnees, nom: f.nom }).then(() => setPanneau(null));
                })
              }
              testID={`${id}-fichier`}
            />
          ) : null}
        </View>
      ) : null}
      {panneau === 'calibrer' ? (
        <View style={{ gap: 6 }} testID={`${id}-panneau-calibrer`}>
          <Text style={attenue(theme, 12)}>{trJc('prop.calibrer_aide')}</Text>
          <Suspense fallback={null}>
            <PlanCarte carte={{ cle: c.cle, nom: c.nom, image: null, actif: false, modes: [], ...(e ? { echelle: e } : {}) }} url={image?.url ?? null} largeur={image?.largeur} hauteur={image?.hauteur} taille={360} points={points} fermer={false} onPoint={(x, y) => setPoints(p => (p.length >= 4 ? [x, y] : [...p, x, y]))} />
          </Suspense>
          <View style={[styles.ligne, { gap: 8, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJc('carte.echelle_distance')} valeur={distance} onChanger={setDistance} clavier="number-pad" maxLength={7} style={{ width: 160 }} testID={`${id}-distance`} />
            <BoutonHub
              theme={theme}
              titre={trJc('prop.calibrer_enregistrer')}
              desactive={occupe || points.length !== 4 || !(distanceNombre > 0)}
              onPress={() => void onCalibrer({ points, distance: distanceNombre }).then(() => setPanneau(null))}
              testID={`${id}-calibrer-enregistrer`}
            />
          </View>
          <Text style={attenue(theme, 12)} testID={`${id}-points`}>{trJc('carte.points_poses', { n: points.length / 2 })}</Text>
        </View>
      ) : null}
    </View>
  );
}
