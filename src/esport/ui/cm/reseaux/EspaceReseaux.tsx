/**
 * Page « Réseaux » de l'espace CM (onglet de l'espace CM, aucune entrée de plus dans la barre du bas) :
 * tableau de bord des statistiques, publications suivies et leurs relevés, comptes du club et des teams (et
 * leur annonce Discord), import / export CSV, et pour le gestionnaire (cm.gerer) : salons Discord du club,
 * rappels, dernières annonces. Tout est décidé par le serveur (docs/esport/reseaux-stats.md).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { apiReseaux, variationSignee, type Annonce, type ApercuImportReseaux, type ApiReseaux, type BilanImportReseaux, type EtatReseaux, type FiltresReseaux, type GenreImport, type Groupe, type LignePalmares, type TableauDeBordReseaux, type TypeContenu } from '../../../cm/reseauxApi';
import { localeCourante } from '../../../i18n';
import { traduireServeur } from '../../../i18n/erreurs';
import { libelleChamp, raisonImport, trRs, trnRs, type CleRs } from '../../../i18n/reseaux';
import { choisirFichier, choixFichierDisponible } from '../../../medias/choixFichier';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { Carte, ChiffreCle, ESP, EtatVide, Grille, MenuActions, Onglets, SqueletteCartes, TitreCarte, attenue, texte } from '../../design';
import { BarreH } from '../../graphiquesUsage/graphiques';
import { Courbe } from '../../graphiquesUsage/Courbe';
import { Aide, quand } from '../commun';
import { Comptes } from './Comptes';
import { Publications } from './Publications';
import { Filtres, LigneInterrupteur, jourCourt, jourLong, nb, nomReseau, nomType, pct } from './commun';
import { useTempsReel } from '../../../tempsReel/hooks';

type OngletRs = 'tableau' | 'publications' | 'comptes' | 'outils' | 'bot';

export function EspaceReseaux({ theme, client, large, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiReseaux(client), [client]);
  const [etat, setEtat] = useState<EtatReseaux | undefined>();
  const [onglet, setOnglet] = useState<OngletRs>('tableau');
  const [version, setVersion] = useState(0);
  const { erreur, agir } = useAgir();
  const relire = useCallback(() => {
    setVersion(v => v + 1);
    void agir('', async () => setEtat(await api.etat()));
  }, [agir, api]);
  useEffect(() => {
    void agir('', async () => setEtat(await api.etat()));
  }, [agir, api]);
  // Temps réel : compte, publication ou relevé changé par un autre.
  useTempsReel(client, 'cm:reseaux', relire);
  if (!etat) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-rs" /> : <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} />;
  const entrees = [
    { id: 'tableau', libelle: trRs('espace.tableau') },
    { id: 'publications', libelle: trRs('espace.publications') },
    { id: 'comptes', libelle: trRs('espace.comptes') },
    { id: 'outils', libelle: trRs('espace.outils') },
    ...(etat.droits.gerer ? [{ id: 'bot', libelle: trRs('espace.reglages') }] : []),
  ];
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs">
      <Text style={attenue(theme, 13)}>{trRs('espace.sous')}</Text>
      <Onglets theme={theme} prefixe="esport-rs-onglet" testID="esport-rs-onglets" actif={onglet} onChoisir={id => setOnglet(id as OngletRs)} entrees={entrees} defilant={!large} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-rs" />
      {onglet === 'tableau' ? <TableauDeBord theme={theme} api={api} etat={etat} large={large} version={version} /> : null}
      {onglet === 'publications' ? <Publications theme={theme} api={api} etat={etat} large={large} version={version} onChange={relire} /> : null}
      {onglet === 'comptes' ? <Comptes theme={theme} api={api} etat={etat} large={large} onChange={relire} /> : null}
      {onglet === 'outils' ? <Outils theme={theme} api={api} etat={etat} onExporter={onExporter} onImporte={relire} /> : null}
      {onglet === 'bot' && etat.droits.gerer ? <ReglagesBot theme={theme} api={api} etat={etat} onChange={relire} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Tableau de bord

function TableauDeBord({ theme, api, etat, large, version }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; large: boolean; version: number }) {
  const [filtres, setFiltres] = useState<FiltresReseaux & { jours?: number }>({ jours: 30 });
  const [t, setT] = useState<TableauDeBordReseaux | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setT(await api.tableauDeBord({ du: filtres.du, au: filtres.au, reseau: filtres.reseau, team: filtres.team, type: filtres.type })));
  }, [agir, api, filtres, version]);
  const locale = localeCourante();
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-tdb">
      <Panneau theme={theme}>
        <Filtres theme={theme} etat={etat} filtres={filtres} onChanger={setFiltres} testID="esport-rs-tdb-filtres" />
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-rs-tdb" />
      {!t && !erreur ? <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} /> : null}
      {t ? (
        <>
          <Text style={attenue(theme)}>{trRs('tdb.du_au', { du: jourLong(t.periode.du), au: jourLong(t.periode.au) })}</Text>
          <View style={[styles.ligne, { gap: ESP.s }]}>
            <ChiffreCle theme={theme} large={large} glyphe="▤" libelle={trRs('tdb.publications')} valeur={String(t.totaux.publications)} detail={trRs('tdb.publications_detail', { n: t.totaux.relevees })} testID="esport-rs-tdb-publications" />
            <ChiffreCle theme={theme} large={large} glyphe="◉" libelle={trRs('tdb.vues')} valeur={nb(t.totaux.vues)} testID="esport-rs-tdb-vues" />
            <ChiffreCle theme={theme} large={large} glyphe="♥" libelle={trRs('tdb.engagement')} valeur={pct(t.totaux.engagement)} detail={`${nb(t.totaux.interactions)} ${trRs('metrique.interactions').toLowerCase()}`} testID="esport-rs-tdb-engagement" />
            <ChiffreCle
              theme={theme}
              large={large}
              glyphe="👥"
              libelle={trRs('tdb.abonnes')}
              valeur={nb(t.totaux.abonnes)}
              ton={t.totaux.variationAbonnes !== null && t.totaux.variationAbonnes < 0 ? 'alerte' : 'neutre'}
              detail={t.totaux.variationAbonnes !== null ? trRs('tdb.abonnes_variation', { variation: variationSignee(t.totaux.variationAbonnes, locale) }) : undefined}
              testID="esport-rs-tdb-abonnes"
            />
          </View>
          <Aide theme={theme}>{trRs('tdb.engagement_aide')}</Aide>
          <Grille min={large ? 420 : 260}>
            <Carte theme={theme} testID="esport-rs-tdb-comptes">
              <TitreCarte theme={theme} titre={trRs('tdb.comptes')} />
              {t.comptes.filter(c => c.serie.length).length === 0 ? <Text style={attenue(theme)}>{trRs('tdb.comptes_vide')}</Text> : null}
              {t.comptes
                .filter(c => c.serie.length)
                .map(c => (
                  <View key={c.id} style={{ gap: ESP.xxs }}>
                    <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{`@${c.identifiant}${c.team ? ` · ${c.team}` : ''}`}</Text>
                    <Text style={attenue(theme)}>{trRs('tdb.compte_detail', { reseau: nomReseau(etat, c.reseau), fin: nb(c.fin), variation: variationSignee(c.variation, locale), pct: c.variationPct === null ? '—' : pct(c.variationPct) })}</Text>
                    {c.serie.length > 1 ? <Courbe theme={theme} points={c.serie.map(p => ({ jour: p.jour, valeur: p.abonnes, detail: trRs('tdb.point', { jour: jourCourt(p.jour), n: nb(p.abonnes) }) }))} testID={`esport-rs-tdb-courbe-${c.id}`} /> : null}
                  </View>
                ))}
            </Carte>
            <Palmares theme={theme} titre={trRs('tdb.top_vues')} lignes={t.topVues} etat={etat} mesure={l => l.vues ?? 0} texteMesure={l => nb(l.vues)} testID="esport-rs-tdb-top-vues" />
            <Palmares theme={theme} titre={trRs('tdb.top_engagement')} lignes={t.topEngagement} etat={etat} mesure={l => l.engagement ?? 0} texteMesure={l => pct(l.engagement)} testID="esport-rs-tdb-top-engagement" />
            <Groupes theme={theme} titre={trRs('tdb.par_reseau')} groupes={t.parReseau} nom={g => nomReseau(etat, g.cle)} testID="esport-rs-tdb-reseaux" />
            <Groupes theme={theme} titre={trRs('tdb.par_type')} groupes={t.parType} nom={g => nomType(g.cle as TypeContenu)} testID="esport-rs-tdb-types" />
            <Groupes theme={theme} titre={trRs('tdb.par_team')} groupes={t.parTeam} nom={g => (g.cle === 'club' ? trRs('c.club') : (g.nom ?? '?'))} testID="esport-rs-tdb-teams" />
          </Grille>
        </>
      ) : null}
    </View>
  );
}

function Palmares({ theme, titre, lignes, etat, mesure, texteMesure, testID }: { theme: ThemeHub; titre: string; lignes: LignePalmares[]; etat: EtatReseaux; mesure(l: LignePalmares): number; texteMesure(l: LignePalmares): string; testID: string }) {
  const max = Math.max(0, ...lignes.map(mesure));
  return (
    <Carte theme={theme} testID={testID}>
      <TitreCarte theme={theme} titre={titre} />
      {lignes.length === 0 ? <Text style={attenue(theme)}>{trRs('c.aucune_donnee')}</Text> : null}
      {lignes.map((l, i) => (
        <BarreH key={l.id} theme={theme} libelle={`${i + 1}. ${l.titre || l.url} · ${nomReseau(etat, l.reseau)}`} valeur={mesure(l)} max={max} texte={texteMesure(l)} testID={`${testID}-${l.id}`} />
      ))}
    </Carte>
  );
}

function Groupes({ theme, titre, groupes, nom, testID }: { theme: ThemeHub; titre: string; groupes: Groupe[]; nom(g: Groupe): string; testID: string }) {
  const max = Math.max(0, ...groupes.map(g => g.vues));
  return (
    <Carte theme={theme} testID={testID}>
      <TitreCarte theme={theme} titre={titre} />
      {groupes.length === 0 ? <Text style={attenue(theme)}>{trRs('c.aucune_donnee')}</Text> : null}
      {[...groupes]
        .sort((a, b) => b.vues - a.vues)
        .map(g => (
          <View key={g.cle} style={{ gap: 2 }}>
            <BarreH theme={theme} libelle={nom(g)} valeur={g.vues} max={max} texte={nb(g.vues)} testID={`${testID}-${g.cle}`} />
            <Text style={attenue(theme)}>{trRs('tdb.groupe_detail', { publications: g.publications, vues: nb(g.vues), engagement: pct(g.engagement) })}</Text>
          </View>
        ))}
    </Carte>
  );
}

// ------------------------------------------------------------------ Import / export

function Outils({ theme, api, etat, onExporter, onImporte }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>; onImporte(): void }) {
  const [genre, setGenre] = useState<GenreImport>('posts');
  const [contenu, setContenu] = useState('');
  const [apercu, setApercu] = useState<ApercuImportReseaux | undefined>();
  const [corresp, setCorresp] = useState<Record<string, string | null>>({});
  const [creer, setCreer] = useState(false);
  const [bilan, setBilan] = useState<BilanImportReseaux | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const voir = (texteCsv: string, g = genre) =>
    agir('apercu', async () => {
      setBilan(undefined);
      const a = await api.apercuImport(g, texteCsv);
      setApercu(a);
      setCorresp(Object.fromEntries(a.entetes.map((_, i) => [String(i), a.correspondance[String(i)] ?? null])));
    });
  const exporter = (g: GenreImport) =>
    agir(`export-${g}`, async () => {
      const f = await api.exporter(g);
      if (!onExporter) throw new Error(trRs('outils.export_indisponible'));
      return (await onExporter(f.nom, f.contenu, 'text/csv')) ? trRs('outils.exporte', { nom: f.nom }) : undefined;
    });
  const choisi = new Set(Object.values(corresp).filter(Boolean));
  const requis = genre === 'posts' ? 'url' : 'compte';
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-outils">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-outils" />
      <Panneau theme={theme}>
        <Intertitre theme={theme}>{trRs('outils.export')}</Intertitre>
        <Aide theme={theme}>{trRs('outils.export_aide')}</Aide>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={trRs('outils.export_posts')} onPress={() => void exporter('posts')} testID="esport-rs-export-posts" />
          <BoutonHub theme={theme} titre={trRs('outils.export_comptes')} onPress={() => void exporter('comptes')} testID="esport-rs-export-comptes" />
        </View>
      </Panneau>
      {etat.droits.editer ? (
        <Panneau theme={theme} testID="esport-rs-import">
          <Intertitre theme={theme}>{trRs('outils.import')}</Intertitre>
          <Aide theme={theme}>{trRs('outils.import_aide')}</Aide>
          <Choix
            theme={theme}
            libelle={trRs('outils.genre')}
            valeur={genre}
            options={(['posts', 'comptes'] as const).map(g => ({ id: g, nom: trRs(`outils.genre.${g}` as CleRs) }))}
            onChoisir={g => {
              setGenre(g);
              setApercu(undefined);
              setBilan(undefined);
            }}
            testID="esport-rs-import-genre"
          />
          {choixFichierDisponible ? (
            <BoutonHub
              theme={theme}
              titre={trRs('outils.choisir')}
              onPress={() =>
                void agir('fichier', async () => {
                  const f = await choisirFichier('text/csv,.csv,text/plain,.txt', 'esport-rs-import-fichier');
                  if (!f) return undefined;
                  if (f.taille > 1024 * 1024) throw new Error(trRs('outils.trop_gros'));
                  const Decodeur = (globalThis as { TextDecoder?: new () => { decode(o: Uint8Array): string } }).TextDecoder;
                  if (!Decodeur) throw new Error(trRs('outils.illisible'));
                  const t = new Decodeur().decode(await f.lire(0, f.taille));
                  setContenu(t);
                  await voir(t);
                  return undefined;
                })
              }
              testID="esport-rs-import-choisir"
            />
          ) : null}
          <Champ theme={theme} libelle={trRs('outils.coller')} valeur={contenu} onChanger={setContenu} multiligne maxLength={1024 * 1024} testID="esport-rs-import-texte" />
          <BoutonHub theme={theme} titre={trRs('outils.apercu')} desactive={!contenu.trim() || Boolean(enCours)} onPress={() => void voir(contenu)} testID="esport-rs-import-apercu" />
          {apercu ? (
            <View style={{ gap: ESP.xs }} testID="esport-rs-import-correspondance">
              <Text style={texte(theme)}>{trnRs('outils.lignes', apercu.lignes)}</Text>
              {apercu.entetes.map((e, i) => {
                const c = corresp[String(i)] ?? null;
                return (
                  <View key={i} style={[styles.ligne, { gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }]}>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{e || trRs('outils.colonne_n', { n: i + 1 })}</Text>
                      <Text style={attenue(theme)} numberOfLines={1}>
                        {apercu.exemples
                          .map(x => x[i])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(' · ')}
                      </Text>
                    </View>
                    <MenuActions
                      theme={theme}
                      titreBouton={c ? libelleChamp(c) : trRs('outils.ignorer')}
                      libelle={trRs('outils.colonne_vers', { colonne: e || String(i + 1) })}
                      testID={`esport-rs-import-col-${i}`}
                      actions={[
                        { titre: trRs('outils.ignorer'), onPress: () => setCorresp({ ...corresp, [String(i)]: null }), testID: `esport-rs-import-col-${i}-ignorer` },
                        ...apercu.champs.filter(ch => ch === c || !choisi.has(ch)).map(ch => ({ titre: libelleChamp(ch), onPress: () => setCorresp({ ...corresp, [String(i)]: ch }), testID: `esport-rs-import-col-${i}-${ch}` })),
                      ]}
                    />
                  </View>
                );
              })}
              {!choisi.has(requis) ? <Aide theme={theme}>{trRs(genre === 'posts' ? 'outils.requis_posts' : 'outils.requis_comptes')}</Aide> : null}
              {genre === 'posts' ? <LigneInterrupteur theme={theme} libelle={trRs('outils.creer')} valeur={creer} onChanger={setCreer} testID="esport-rs-import-creer" /> : null}
              <BoutonHub
                theme={theme}
                titre={trnRs('outils.importer_n', apercu.lignes)}
                variante="plein"
                desactive={!choisi.has(requis) || Boolean(enCours)}
                onPress={() =>
                  void agir('importer', async () => {
                    const b = await api.importer(genre, contenu, corresp, creer);
                    setBilan(b);
                    setApercu(undefined);
                    onImporte();
                  })
                }
                testID="esport-rs-import-ok"
              />
            </View>
          ) : null}
          {bilan ? (
            <View style={{ gap: ESP.xxs }} testID="esport-rs-import-bilan">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{trRs('outils.bilan', { releves: bilan.releves, crees: bilan.crees, invalides: bilan.nInvalides })}</Text>
              {bilan.invalides.slice(0, 30).map(x => (
                <Text key={`i${x.ligne}`} style={attenue(theme)}>
                  {trRs('outils.invalide_ligne', { ligne: x.ligne, raison: raisonImport(x.code) })}
                </Text>
              ))}
            </View>
          ) : null}
        </Panneau>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Bot Discord : salons du club, rappels, annonces

function ReglagesBot({ theme, api, etat, onChange }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; onChange(): void }) {
  const [nouveau, setNouveau] = useState({ nom: '', url: '' });
  const [remplacer, setRemplacer] = useState<{ id: string; url: string } | undefined>();
  const [annonces, setAnnonces] = useState<Annonce[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setAnnonces((await api.annonces()).annonces));
  }, [agir, api, etat]);
  const faire = (cle: string, a: () => Promise<unknown>, m?: string) =>
    agir(cle, async () => {
      await a();
      onChange();
      return m;
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-bot">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-bot" />
      {!etat.bot ? <Aide theme={theme}>{trRs('bot.sans_bot')}</Aide> : null}
      <Panneau theme={theme} testID="esport-rs-salons">
        <Intertitre theme={theme}>{trRs('bot.salons')}</Intertitre>
        <Aide theme={theme}>{trRs('bot.salons_aide')}</Aide>
        {(etat.salons ?? []).map(s => (
          <View key={s.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-rs-salon-${s.id}`}>
            <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{`#${s.nom}`}</Text>
            <Text style={attenue(theme)}>{trRs('bot.salon_etat', { masque: s.masque, succes: s.dernierSucces ? quand(s.dernierSucces) : trRs('bot.jamais') })}</Text>
            {s.invalide ? <Text style={{ ...texte(theme, 13), color: theme.critique }}>{trRs('bot.salon_invalide')}</Text> : null}
            <LigneInterrupteur theme={theme} libelle={trRs('bot.fil_fr')} valeur={s.filFr} onChanger={filFr => void faire('fil', () => api.modifierSalon(s.id, { filFr }))} testID={`esport-rs-salon-${s.id}-fil`} />
            {!s.filFr ? (
              <Choix theme={theme} libelle={trRs('bot.langue')} valeur={s.langue} options={(['fr', 'en'] as const).map(l => ({ id: l, nom: l.toUpperCase() }))} onChoisir={langue => void faire('langue', () => api.modifierSalon(s.id, { langue }))} testID={`esport-rs-salon-${s.id}-langue`} />
            ) : null}
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trRs('bot.salon_tester')}
                onPress={() =>
                  void agir('test', async () => {
                    const r = await api.testerSalon(s.id);
                    if (!r.ok) throw new Error(traduireServeur(r.motif ?? ''));
                    return trRs('annonce.test_ok');
                  })
                }
                testID={`esport-rs-salon-${s.id}-tester`}
              />
              <BoutonHub theme={theme} titre={trRs('bot.salon_remplacer')} onPress={() => setRemplacer({ id: s.id, url: '' })} testID={`esport-rs-salon-${s.id}-remplacer`} />
              <BoutonConfirme theme={theme} titre={trRs('c.supprimer')} confirmation={trRs('c.confirmer_suppression')} onConfirme={() => void faire('supprimer', () => api.supprimerSalon(s.id))} testID={`esport-rs-salon-${s.id}-supprimer`} />
            </View>
            {remplacer?.id === s.id ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Champ theme={theme} libelle={trRs('bot.salon_url')} valeur={remplacer.url} onChanger={url => setRemplacer({ id: s.id, url })} secret maxLength={400} testID={`esport-rs-salon-${s.id}-url`} style={{ flex: 1, minWidth: 220 }} />
                <BoutonHub
                  theme={theme}
                  titre={trRs('c.enregistrer')}
                  variante="plein"
                  desactive={!remplacer.url.trim()}
                  onPress={() => void faire('remplacer', async () => (await api.modifierSalon(s.id, { url: remplacer.url.trim() }), setRemplacer(undefined)), trRs('c.enregistre'))}
                  testID={`esport-rs-salon-${s.id}-url-ok`}
                />
              </View>
            ) : null}
          </View>
        ))}
        <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trRs('bot.salon_nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={60} testID="esport-rs-salon-nom" style={{ minWidth: 180, flexGrow: 1 }} />
          <Champ theme={theme} libelle={trRs('bot.salon_url')} valeur={nouveau.url} onChanger={url => setNouveau({ ...nouveau, url })} secret maxLength={400} testID="esport-rs-salon-url" style={{ minWidth: 220, flexGrow: 2 }} />
          <BoutonHub
            theme={theme}
            titre={trRs('bot.salon_ajouter')}
            variante="plein"
            desactive={!nouveau.nom.trim() || !nouveau.url.trim()}
            onPress={() => void faire('ajouter', async () => (await api.ajouterSalon({ nom: nouveau.nom.trim(), url: nouveau.url.trim() }), setNouveau({ nom: '', url: '' })), trRs('c.enregistre'))}
            testID="esport-rs-salon-ajouter"
          />
        </View>
      </Panneau>
      <Panneau theme={theme}>
        <LigneInterrupteur theme={theme} libelle={trRs('bot.rappels')} aide={trRs('bot.rappels_aide')} valeur={etat.reglages?.rappels ?? true} onChanger={rappels => void faire('rappels', () => api.changerReglages({ rappels }))} testID="esport-rs-rappels" />
      </Panneau>
      <Carte theme={theme} testID="esport-rs-annonces">
        <TitreCarte theme={theme} titre={trRs('bot.annonces')} />
        {annonces && !annonces.length ? <EtatVide theme={theme} glyphe="📣" titre={trRs('bot.annonces_vide')} texte="" /> : null}
        {annonces?.map(a => (
          <View key={a.id} style={{ gap: 2 }} testID={`esport-rs-annonce-${a.id}`}>
            <Text style={{ ...texte(theme, 13), color: a.statut === 'abandonne' ? theme.critique : theme.texte }}>
              {`${quand(a.majLe)} · ${trRs('bot.annonce_ligne', { titre: a.titre, reseau: nomReseau(etat, a.reseau), cible: a.cible.genre === 'salon' ? `#${a.cible.nom}` : a.cible.nom, statut: `${trRs(`bot.statut.${a.statut}` as CleRs)}${a.operation === 'editer' ? ` (${trRs('bot.operation.editer')})` : ''}` })}`}
            </Text>
            {a.erreur ? <Text style={attenue(theme)}>{traduireServeur(a.erreur)}</Text> : null}
          </View>
        ))}
      </Carte>
    </View>
  );
}
