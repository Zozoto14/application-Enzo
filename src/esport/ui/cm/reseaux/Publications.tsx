/**
 * Page Réseaux › Publications : posts et vidéos suivis (créés à la publication d'un post CM, ou ajoutés à la
 * main), dernier relevé, et le volet d'une publication : relevés datés (J+1, J+7…), évolution des vues, saisie.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { METRIQUES_POST, variationSignee, type ApiReseaux, type DetailPublication, type EtatReseaux, type FiltresReseaux, type MetriquePost, type Publication, type TypeContenu } from '../../../cm/reseauxApi';
import { localeCourante } from '../../../i18n';
import { trRs, trnRs, type CleRs } from '../../../i18n/reseaux';
import { BoutonConfirme, Choix, Panneau, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, SqueletteCartes, TitreCarte, Volet, attenue, texte } from '../../design';
import { Courbe } from '../../graphiquesUsage/Courbe';
import { Aide, quand } from '../commun';
import { Filtres, FormulaireReleve, LigneInterrupteur, Pastille, dureeTexte, jourCourt, nb, nomType, pct } from './commun';

export function Publications({ theme, api, etat, large, version, onChange }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; large: boolean; version: number; onChange(): void }) {
  const [filtres, setFiltres] = useState<FiltresReseaux>({});
  const [q, setQ] = useState('');
  const [liste, setListe] = useState<Publication[] | undefined>();
  const [ouverte, setOuverte] = useState<string | undefined>();
  const [nouvelle, setNouvelle] = useState<{ url: string; titre: string; type: TypeContenu; publieLe: string } | undefined>();
  const [maj, setMaj] = useState(0);
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setListe((await api.publications({ ...filtres, q: q.trim() || undefined })).publications));
    // La recherche texte part au bouton (pas à chaque frappe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, api, filtres, version, maj]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-publications">
      <Panneau theme={theme}>
        <Filtres theme={theme} etat={etat} filtres={filtres} onChanger={setFiltres} periode={false} testID="esport-rs-pub-filtres" />
        <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trRs('pub.chercher')} valeur={q} onChanger={setQ} maxLength={80} testID="esport-rs-pub-q" style={{ flex: 1, minWidth: 200 }} />
          <BoutonHub theme={theme} titre={trRs('c.ouvrir')} onPress={() => setMaj(m => m + 1)} testID="esport-rs-pub-chercher" />
          {etat.droits.editer ? <BoutonHub theme={theme} titre={trRs('pub.ajouter')} variante="plein" onPress={() => setNouvelle({ url: '', titre: '', type: 'autre', publieLe: '' })} testID="esport-rs-pub-ajouter" /> : null}
        </View>
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-rs-publications" />
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="▤" titre={trRs('pub.vide')} texte="" />
        </Carte>
      ) : null}
      {liste?.length ? (
        <Grille min={large ? 320 : 240} testID="esport-rs-pub-liste">
          {liste.map(p => (
            <Carte key={p.id} theme={theme} dense onPress={() => setOuverte(p.id)} libelle={`${trRs('pub.releves')} : ${p.titre || p.url}`} testID={`esport-rs-pub-${p.id}`}>
              <View style={[styles.ligne, { gap: ESP.xxs }]}>
                <Pastille theme={theme} etat={etat} reseau={p.reseau} />
                <Badge theme={theme} texte={nomType(p.type)} />
                {p.video ? <Badge theme={theme} ton="accent" texte={trRs('pub.video')} /> : null}
                {p.carteId ? <Badge theme={theme} texte={trRs('pub.post_cm')} /> : null}
              </View>
              <Text style={{ ...texte(theme, 15), fontWeight: '800' }} numberOfLines={2}>
                {p.titre || p.url}
              </Text>
              <Text style={attenue(theme)} numberOfLines={1}>
                {[p.compte ? `@${p.compte.identifiant}` : trRs('pub.compte_aucun'), p.team ?? trRs('c.club'), quand(p.publieLe)].join(' · ')}
              </Text>
              <Text style={texte(theme, 13)}>{p.dernier ? trRs('pub.dernier', { jour: jourCourt(p.dernier.jour), vues: nb(p.dernier.vues), engagement: pct(p.dernier.engagement) }) : trRs('pub.sans_releve')}</Text>
              {p.releves ? <Text style={attenue(theme)}>{trnRs('pub.releves_n', p.releves)}</Text> : null}
            </Carte>
          ))}
        </Grille>
      ) : null}
      {ouverte ? (
        <Volet theme={theme} visible titre={trRs('pub.releves')} onFermer={() => setOuverte(undefined)} largeur={720} testID="esport-rs-pub-volet">
          <FichePublication
            key={ouverte}
            theme={theme}
            api={api}
            etat={etat}
            id={ouverte}
            large={large}
            onChange={() => setMaj(m => m + 1)}
            onSupprimee={() => {
              setOuverte(undefined);
              setMaj(m => m + 1);
              onChange();
            }}
          />
        </Volet>
      ) : null}
      {nouvelle ? (
        <Volet theme={theme} visible titre={trRs('pub.ajouter')} onFermer={() => setNouvelle(undefined)} testID="esport-rs-pub-nouvelle">
          <Aide theme={theme}>{trRs('pub.ajouter_aide')}</Aide>
          <Champ theme={theme} libelle={trRs('pub.url')} valeur={nouvelle.url} onChanger={url => setNouvelle({ ...nouvelle, url })} maxLength={500} placeholder="https://www.youtube.com/watch?v=…" testID="esport-rs-pub-nouvelle-url" />
          <Champ theme={theme} libelle={trRs('pub.titre')} valeur={nouvelle.titre} onChanger={titre => setNouvelle({ ...nouvelle, titre })} maxLength={200} testID="esport-rs-pub-nouvelle-titre" />
          <Choix theme={theme} libelle={trRs('c.type')} valeur={nouvelle.type} options={etat.typesContenu.map(t => ({ id: t, nom: nomType(t) }))} onChoisir={type => setNouvelle({ ...nouvelle, type })} testID="esport-rs-pub-nouvelle-type" />
          <Champ theme={theme} libelle={trRs('pub.publie_le')} valeur={nouvelle.publieLe} onChanger={publieLe => setNouvelle({ ...nouvelle, publieLe })} maxLength={10} placeholder="2026-10-27" testID="esport-rs-pub-nouvelle-date" />
          <Retours theme={theme} erreur={erreur} prefixe="esport-rs-pub-nouvelle" />
          <BoutonHub
            theme={theme}
            titre={trRs('c.ajouter')}
            variante="plein"
            desactive={!nouvelle.url.trim()}
            onPress={() =>
              void agir('ajouter', async () => {
                const d = await api.creerPublication({ url: nouvelle.url.trim(), titre: nouvelle.titre.trim(), type: nouvelle.type, ...(nouvelle.publieLe.trim() ? { publieLe: nouvelle.publieLe.trim() } : {}) });
                setNouvelle(undefined);
                setMaj(m => m + 1);
                setOuverte(d.publication.id);
              })
            }
            testID="esport-rs-pub-nouvelle-ok"
          />
        </Volet>
      ) : null}
    </View>
  );
}

const libelleMetrique = (m: MetriquePost): string => trRs(`metrique.${m}` as CleRs);

function FichePublication({ theme, api, etat, id, large, onChange, onSupprimee }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; id: string; large: boolean; onChange(): void; onSupprimee(): void }) {
  const [d, setD] = useState<DetailPublication | undefined>();
  const [saisie, setSaisie] = useState<Partial<Record<MetriquePost | 'jour', string>>>({});
  const { erreur, avis, agir, enCours } = useAgir();
  useEffect(() => {
    void agir('', async () => setD(await api.publication(id)));
  }, [agir, api, id]);
  if (!d) return <Retours theme={theme} erreur={erreur} prefixe="esport-rs-fiche" />;
  const p = d.publication;
  const locale = localeCourante();
  const metriques = METRIQUES_POST.filter(m => p.video || (m !== 'dureeMoyenne' && m !== 'tauxCompletion'));
  const changer = (m: { type?: TypeContenu; video?: boolean; rappels?: boolean }) =>
    void agir('modifier', async () => {
      setD(await api.modifierPublication(p.id, m));
      onChange();
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-fiche">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-fiche" />
      <View style={{ gap: ESP.xxs }}>
        <Pastille theme={theme} etat={etat} reseau={p.reseau} />
        <Text style={{ ...texte(theme, 17), fontWeight: '800' }}>{p.titre || p.url}</Text>
        <Text style={attenue(theme)} selectable>
          {p.url}
        </Text>
        <Text style={attenue(theme)}>{[p.compte ? `@${p.compte.identifiant}` : trRs('pub.compte_aucun'), p.team ?? trRs('c.club'), quand(p.publieLe)].join(' · ')}</Text>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={trRs('pub.voir')} onPress={() => void Linking.openURL(p.url)} testID="esport-rs-fiche-voir" />
          {d.editer ? <BoutonConfirme theme={theme} titre={trRs('pub.supprimer')} confirmation={trRs('c.confirmer_suppression')} onConfirme={() => void agir('supprimer', async () => (await api.supprimerPublication(p.id), onSupprimee()))} testID="esport-rs-fiche-supprimer" /> : null}
        </View>
      </View>
      {d.editer ? (
        <Panneau theme={theme}>
          <Choix theme={theme} libelle={trRs('c.type')} valeur={p.type} options={etat.typesContenu.map(t => ({ id: t, nom: nomType(t) }))} onChoisir={type => changer({ type })} testID="esport-rs-fiche-type" />
          <LigneInterrupteur theme={theme} libelle={trRs('pub.video')} valeur={p.video} onChanger={video => changer({ video })} testID="esport-rs-fiche-video" />
          <LigneInterrupteur theme={theme} libelle={trRs('pub.rappels')} valeur={p.rappels} onChanger={rappels => changer({ rappels })} testID="esport-rs-fiche-rappels" />
        </Panneau>
      ) : null}
      {d.releves.length > 1 ? (
        <Carte theme={theme} testID="esport-rs-fiche-evolution">
          <TitreCarte theme={theme} titre={trRs('pub.evolution')} />
          <Courbe theme={theme} points={d.releves.filter(r => r.vues !== null).map(r => ({ jour: r.jour, valeur: r.vues ?? 0, detail: trRs('pub.point', { jour: jourCourt(r.jour), n: nb(r.vues) }) }))} testID="esport-rs-fiche-courbe" />
        </Carte>
      ) : null}
      <Carte theme={theme} testID="esport-rs-fiche-releves">
        <TitreCarte theme={theme} titre={trnRs('pub.releves_n', d.releves.length)} />
        {d.releves.map((r, i) => {
          const e = d.evolution[i];
          return (
            <View key={r.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between', borderTopWidth: i ? 1 : 0, borderTopColor: theme.ligne, paddingTop: i ? ESP.xxs : 0 }]} testID={`esport-rs-releve-${r.jour}`}>
              <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                <Text style={texte(theme, 13)}>
                  {trRs('pub.ligne_releve', { jour: jourCourt(r.jour), j: e?.jPlus !== null && e?.jPlus !== undefined ? trRs('pub.j_plus', { n: e.jPlus }) : '—', vues: nb(r.vues), interactions: nb(r.interactions), engagement: pct(r.engagement) }) + (e?.ecartVues !== null && e?.ecartVues !== undefined ? trRs('pub.ecart', { ecart: variationSignee(e.ecartVues, locale) }) : '')}
                </Text>
                <Text style={attenue(theme)}>
                  {metriques
                    .filter(m => r[m] !== null && m !== 'vues')
                    .map(m => `${libelleMetrique(m).split(' (')[0]} : ${m === 'dureeMoyenne' ? dureeTexte(r[m]) : m === 'tauxCompletion' ? pct(r[m]) : nb(r[m])}`)
                    .join(' · ')}
                </Text>
              </View>
              {d.editer ? <BoutonConfirme theme={theme} titre={trRs('c.supprimer')} confirmation={trRs('c.confirmer_suppression')} onConfirme={() => void agir('supprimer-releve', async () => setD(await api.supprimerRelevePost(r.id)))} testID={`esport-rs-releve-${r.jour}-supprimer`} /> : null}
            </View>
          );
        })}
      </Carte>
      {d.editer ? (
        <Panneau theme={theme}>
          <TitreCarte theme={theme} titre={trRs('pub.nouveau_releve')} sous={trRs('pub.releve_aide')} />
          <FormulaireReleve
            theme={theme}
            champs={metriques}
            libelle={libelleMetrique}
            valeurs={saisie}
            onChanger={setSaisie}
            large={large}
            desactive={Boolean(enCours)}
            testID="esport-rs-releve"
            onEnregistrer={() =>
              void agir(
                'relever',
                async () => {
                  const { jour, ...valeurs } = saisie;
                  setD(await api.releverPost(p.id, { ...(jour?.trim() ? { jour: jour.trim() } : {}), ...Object.fromEntries(Object.entries(valeurs).filter(([, v]) => (v ?? '').trim())) }));
                  setSaisie({});
                  onChange();
                  return trRs('c.enregistre');
                },
              )
            }
          />
        </Panneau>
      ) : null}
    </View>
  );
}
