/**
 * Rubrique « Sponsors & partenaires » de l'espace CM (permissions du club sponsors.voir / sponsors.gerer) :
 * tableau de bord, pipeline des prospects (Kanban), partenaires et sponsors, import / export CSV, et pour les
 * gestionnaires : étapes du pipeline, RGPD des contacts, journal de la rubrique. Les fiches s'ouvrent dans un
 * volet. Tout est décidé par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { NIVEAUX, apiSponsors, type ApercuImport, type ApiSponsors, type BilanImport, type ChampImport, type EntreeJournalSponsors, type Etape, type Niveau, type ResumePartenaire, type TableauDeBord } from '../../sponsors/api';
import { formaterMontant, nomEtape, nomPeriode } from '../../sponsors/regles';
import { phraseJournalSponsors } from '../../sponsors/libelles';
import { CHAMPS_LIBELLES, trSp, trnSp, type CleSp } from '../../i18n/sponsors';
import { formaterDate } from '../../i18n';
import { trCm } from '../../i18n/cm';
import { choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ChiffreCle, ESP, EtatVide, Grille, MenuActions, Onglets, SqueletteCartes, TitreCarte, Volet, attenue, texte } from '../design';
import { Aide, PALETTE, Teinte, quand } from '../cm/commun';
import { FichePartenaire } from './FichePartenaire';
import { FicheProspect } from './FicheProspect';
import { Pipeline } from './Pipeline';
import { nomCompte } from './commun';
import { useTempsReel } from '../../tempsReel/hooks';

type OngletSp = 'tableau' | 'pipeline' | 'partenaires' | 'outils' | 'reglages';
type Ouvert = { genre: 'prospect' | 'partenaire'; id: string } | undefined;

export function EspaceSponsors({
  theme,
  client,
  large,
  gerer,
  teams,
  onExporter,
  onOuvrirTableau,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  gerer: boolean;
  /** Teams proposées pour « teams concernées » (celles de l'espace CM). */
  teams: Array<{ id: string; nom: string }>;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  onOuvrirTableau?(id: string): void;
}) {
  const api = useMemo(() => apiSponsors(client), [client]);
  const [onglet, setOnglet] = useState<OngletSp>('tableau');
  const [ouvert, setOuvert] = useState<Ouvert>();
  const [version, setVersion] = useState(0);
  const [nouveau, setNouveau] = useState<'prospect' | 'partenaire' | undefined>();
  const [comptes, setComptes] = useState<Array<{ compte: string; pseudo: string | null }>>([]);
  // Nom du club dans les modèles d'e-mail : vide = « notre club » / « our club » (langue du modèle).
  const club = '';
  const { erreur, agir } = useAgir();
  useEffect(() => {
    api
      .comptes()
      .then(c => setComptes(c.comptes))
      .catch(() => setComptes([]));
  }, [api]);
  const relire = useCallback(() => setVersion(v => v + 1), []);
  // Temps réel : prospect, partenaire ou étape changé par un autre → tableau, pipeline et partenaires relus.
  useTempsReel(client, 'sponsors', relire);
  const entrees = [
    { id: 'tableau', libelle: trSp('espace.tableau') },
    { id: 'pipeline', libelle: trSp('espace.pipeline') },
    { id: 'partenaires', libelle: trSp('espace.partenaires') },
    ...(gerer ? [{ id: 'outils', libelle: trSp('espace.outils') }, { id: 'reglages', libelle: trSp('espace.reglages') }] : []),
  ];
  const convertir = (id: string) =>
    agir('convertir', async () => {
      const r = await api.convertir(id);
      relire();
      setOuvert({ genre: 'partenaire', id: r.partenaireId });
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp">
      <Text style={attenue(theme, 13)}>{trSp('espace.sous')}</Text>
      <Onglets theme={theme} prefixe="esport-sp-onglet" testID="esport-sp-onglets" actif={onglet} onChoisir={id => setOnglet(id as OngletSp)} entrees={entrees} defilant={!large} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-sp" />
      {onglet === 'tableau' ? <TableauDeBordSp theme={theme} api={api} large={large} version={version} onProspect={id => setOuvert({ genre: 'prospect', id })} onPartenaire={id => setOuvert({ genre: 'partenaire', id })} /> : null}
      {onglet === 'pipeline' ? <Pipeline theme={theme} api={api} large={large} version={version} onOuvrir={id => setOuvert({ genre: 'prospect', id })} onNouveau={() => setNouveau('prospect')} onConvertir={id => void convertir(id)} /> : null}
      {onglet === 'partenaires' ? <Partenaires theme={theme} api={api} large={large} version={version} gerer={gerer} onOuvrir={id => setOuvert({ genre: 'partenaire', id })} onNouveau={() => setNouveau('partenaire')} /> : null}
      {onglet === 'outils' && gerer ? <Outils theme={theme} api={api} onExporter={onExporter} onImporte={relire} /> : null}
      {onglet === 'reglages' && gerer ? <ReglagesSp theme={theme} api={api} onExporter={onExporter} onChange={relire} /> : null}
      {ouvert ? (
        <Volet theme={theme} visible titre={ouvert.genre === 'prospect' ? trSp('fiche.prospect') : trSp('fiche.partenaire')} onFermer={() => setOuvert(undefined)} largeur={760} testID="esport-sp-fiche">
          {ouvert.genre === 'prospect' ? (
            <FicheProspect key={ouvert.id} theme={theme} api={api} id={ouvert.id} teams={teams} comptes={comptes} club={club} onChange={relire} onPartenaire={id => setOuvert({ genre: 'partenaire', id })} onSupprime={() => setOuvert(undefined)} />
          ) : (
            <FichePartenaire
              key={ouvert.id}
              theme={theme}
              api={api}
              id={ouvert.id}
              teams={teams}
              comptes={comptes}
              club={club}
              onChange={relire}
              onProspect={id => setOuvert({ genre: 'prospect', id })}
              onSupprime={() => setOuvert(undefined)}
              onOuvrirTableau={
                onOuvrirTableau
                  ? id => {
                      setOuvert(undefined);
                      onOuvrirTableau(id);
                    }
                  : undefined
              }
            />
          )}
        </Volet>
      ) : null}
      {nouveau ? <Nouveau theme={theme} api={api} genre={nouveau} onFermer={() => setNouveau(undefined)} onCree={(genre, id) => (setNouveau(undefined), relire(), setOuvert({ genre, id }))} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Création

function Nouveau({ theme, api, genre, onFermer, onCree }: { theme: ThemeHub; api: ApiSponsors; genre: 'prospect' | 'partenaire'; onFermer(): void; onCree(genre: 'prospect' | 'partenaire', id: string): void }) {
  const [s, setS] = useState({ nom: '', secteur: '', valeur: '', contactNom: '', contactEmail: '', niveau: 'partenaire' as Niveau });
  const { erreur, agir } = useAgir();
  return (
    <Volet theme={theme} visible titre={genre === 'prospect' ? trSp('pipeline.nouveau') : trSp('partenaires.nouveau')} onFermer={onFermer} testID="esport-sp-nouveau">
      <Retours theme={theme} erreur={erreur} prefixe="esport-sp-nouveau" />
      <Champ theme={theme} libelle={trSp('champ.nom')} valeur={s.nom} onChanger={nom => setS({ ...s, nom })} maxLength={120} testID="esport-sp-nouveau-nom" />
      <Champ theme={theme} libelle={trSp('champ.secteur')} valeur={s.secteur} onChanger={secteur => setS({ ...s, secteur })} maxLength={80} testID="esport-sp-nouveau-secteur" />
      {genre === 'prospect' ? (
        <>
          <Champ theme={theme} libelle={trSp('champ.valeur')} valeur={s.valeur} onChanger={valeur => setS({ ...s, valeur })} maxLength={16} testID="esport-sp-nouveau-valeur" />
          <Champ theme={theme} libelle={trSp('contacts.nom')} valeur={s.contactNom} onChanger={contactNom => setS({ ...s, contactNom })} maxLength={120} testID="esport-sp-nouveau-contact" />
          <Champ theme={theme} libelle={trSp('contacts.email')} valeur={s.contactEmail} onChanger={contactEmail => setS({ ...s, contactEmail })} maxLength={254} testID="esport-sp-nouveau-email" />
        </>
      ) : (
        <Choix theme={theme} libelle={trSp('partenaire.niveau')} valeur={s.niveau} options={NIVEAUX.map(n => ({ id: n, nom: trSp(`niveau.${n}` as CleSp) }))} onChoisir={niveau => setS({ ...s, niveau })} testID="esport-sp-nouveau-niveau" />
      )}
      <BoutonHub
        theme={theme}
        titre={trSp('c.creer')}
        variante="plein"
        desactive={!s.nom.trim()}
        onPress={() =>
          void agir('creer', async () => {
            if (genre === 'prospect') {
              const contact = s.contactNom.trim() || s.contactEmail.trim() ? { nom: s.contactNom.trim() || s.contactEmail.trim(), email: s.contactEmail.trim() } : undefined;
              const f = await api.creerProspect({ nom: s.nom.trim(), secteur: s.secteur.trim(), valeurEstimee: s.valeur.trim(), ...(contact ? { contact } : {}) });
              onCree('prospect', f.prospect.id);
            } else {
              const f = await api.creerPartenaire({ nom: s.nom.trim(), secteur: s.secteur.trim(), niveau: s.niveau });
              onCree('partenaire', f.partenaire.id);
            }
          })
        }
        testID="esport-sp-nouveau-creer"
      />
    </Volet>
  );
}

// ------------------------------------------------------------------ Tableau de bord

function Barre({ theme, part, couleur }: { theme: ThemeHub; part: number; couleur: string }) {
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.ligne, overflow: 'hidden', flex: 1, minWidth: 60 }}>
      <View style={{ width: `${Math.max(0, Math.min(100, Math.round(part * 100)))}%`, height: '100%', backgroundColor: couleur }} />
    </View>
  );
}

function TableauDeBordSp({ theme, api, large, version, onProspect, onPartenaire }: { theme: ThemeHub; api: ApiSponsors; large: boolean; version: number; onProspect(id: string): void; onPartenaire(id: string): void }) {
  const [t, setT] = useState<TableauDeBord | undefined>();
  const [annee, setAnnee] = useState<number | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setT(await api.tableauDeBord(annee)));
  }, [agir, api, annee, version]);
  if (!t) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-sp-tdb" /> : <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} />;
  const maxEtape = Math.max(1, ...t.pipeline.etapes.map(e => e.valeur));
  const maxMois = Math.max(1, ...t.revenus.mois.map(m => m.numeraire + m.nature));
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-tdb">
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <ChiffreCle theme={theme} large={large} glyphe="◎" libelle={trSp('tdb.pipeline_ouvert')} valeur={formaterMontant(t.pipeline.valeurOuverte)} detail={trnSp('pipeline.n_prospects', t.pipeline.ouverts)} testID="esport-sp-tdb-pipeline" />
        <ChiffreCle theme={theme} large={large} glyphe="%" libelle={trSp('tdb.conversion')} valeur={t.conversion.taux === null ? '—' : `${t.conversion.taux} %`} detail={trSp('tdb.conversion_detail', { signes: t.conversion.signes, perdus: t.conversion.perdus })} testID="esport-sp-tdb-conversion" />
        <ChiffreCle theme={theme} large={large} glyphe="€" libelle={trSp('tdb.revenus_annee', { annee: t.revenus.annee })} valeur={formaterMontant(t.revenus.numeraire)} detail={trSp('tdb.dont_nature', { montant: formaterMontant(t.revenus.nature) })} testID="esport-sp-tdb-revenus" />
        <ChiffreCle theme={theme} large={large} glyphe="★" libelle={trSp('tdb.partenaires_actifs')} valeur={String(t.partenairesActifs)} ton={t.obligationsEnRetard.length ? 'alerte' : 'neutre'} detail={t.obligationsEnRetard.length ? trnSp('tdb.retards_n', t.obligationsEnRetard.length) : undefined} testID="esport-sp-tdb-partenaires" />
      </View>
      <Grille min={large ? 420 : 260}>
        <Carte theme={theme} testID="esport-sp-tdb-etapes">
          <TitreCarte theme={theme} titre={trSp('tdb.pipeline_etapes')} />
          {t.pipeline.etapes.map(e => (
            <View key={e.id} style={{ gap: 2 }}>
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <Text style={texte(theme, 14)}>{`${nomEtape(e)} · ${e.n}`}</Text>
                <Text style={attenue(theme)}>{formaterMontant(e.valeur)}</Text>
              </View>
              <Barre theme={theme} part={e.valeur / maxEtape} couleur={e.couleur} />
            </View>
          ))}
        </Carte>
        <Carte theme={theme} testID="esport-sp-tdb-mois">
          <TitreCarte
            theme={theme}
            titre={trSp('tdb.revenus_mois')}
            sous={trSp('tdb.revenus_aide')}
            droite={
              <View style={[styles.ligne, { gap: ESP.xxs }]}>
                <BoutonHub theme={theme} titre="‹" libelle={trSp('tdb.annee_precedente')} onPress={() => setAnnee(t.revenus.annee - 1)} testID="esport-sp-tdb-annee-precedente" />
                <Text style={texte(theme)}>{String(t.revenus.annee)}</Text>
                <BoutonHub theme={theme} titre="›" libelle={trSp('tdb.annee_suivante')} onPress={() => setAnnee(t.revenus.annee + 1)} testID="esport-sp-tdb-annee-suivante" />
              </View>
            }
          />
          {t.revenus.mois.map(m => (
            <View key={m.mois} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
              <Text style={{ ...texte(theme, 13), width: 90 }}>{formaterDate(`${m.mois}-15T12:00:00Z`, { month: 'short', timeZone: 'UTC' })}</Text>
              <Barre theme={theme} part={(m.numeraire + m.nature) / maxMois} couleur={theme.accent} />
              <Text style={{ ...attenue(theme), width: 110, textAlign: 'right' }}>{formaterMontant(m.numeraire + m.nature)}</Text>
            </View>
          ))}
        </Carte>
        <Liste theme={theme} titre={trSp('tdb.obligations_retard')} vide={trSp('tdb.obligations_retard_vide')} testID="esport-sp-tdb-retards">
          {t.obligationsEnRetard.map(o => (
            <LigneLien key={`${o.obligationId}-${o.periode}`} theme={theme} texteLigne={`${o.partenaire.nom} · ${o.intitule} · ${nomPeriode(o.periode)} (${o.fait}/${o.quantite})`} ton="critique" onPress={() => onPartenaire(o.partenaire.id)} testID={`esport-sp-tdb-retard-${o.obligationId}-${o.periode}`} />
          ))}
        </Liste>
        <Liste theme={theme} titre={trSp('tdb.obligations_a_faire')} vide={trSp('tdb.obligations_a_faire_vide')} testID="esport-sp-tdb-a-faire">
          {t.obligationsAFaire.map(o => (
            <LigneLien key={o.obligationId} theme={theme} texteLigne={`${o.partenaire.nom} · ${o.intitule} · ${o.fait}/${o.quantite} · ${trnSp('tdb.jours_restants', o.joursRestants)}`} ton={o.joursRestants <= 7 ? 'alerte' : 'neutre'} onPress={() => onPartenaire(o.partenaire.id)} testID={`esport-sp-tdb-a-faire-${o.obligationId}`} />
          ))}
        </Liste>
        <Liste theme={theme} titre={trSp('tdb.contrats_expirant')} vide={trSp('tdb.contrats_expirant_vide')} testID="esport-sp-tdb-contrats">
          {t.contratsExpirant.map(c => (
            <LigneLien
              key={c.contratId}
              theme={theme}
              texteLigne={`${c.partenaire.nom}${c.intitule ? ` · ${c.intitule}` : ''} · ${c.joursRestants < 0 ? trSp('contrats.expire') : trnSp('contrats.fin_dans', c.joursRestants)} · ${trSp(`renouvellement.${c.renouvellement}` as CleSp)}`}
              ton={c.joursRestants < 0 ? 'critique' : 'alerte'}
              onPress={() => onPartenaire(c.partenaire.id)}
              testID={`esport-sp-tdb-contrat-${c.contratId}`}
            />
          ))}
        </Liste>
        <Liste theme={theme} titre={trSp('tdb.actions')} vide={trSp('tdb.actions_vide')} testID="esport-sp-tdb-actions">
          {t.actions.map(a => (
            <LigneLien key={a.prospectId} theme={theme} texteLigne={`${a.nom} · ${a.prochaineAction || '…'} · ${quand(a.prochaineActionLe)}${a.responsable ? ` · ${nomCompte(t.noms, a.responsable)}` : ''}`} ton={a.enRetard ? 'critique' : 'neutre'} onPress={() => onProspect(a.prospectId)} testID={`esport-sp-tdb-action-${a.prospectId}`} />
          ))}
        </Liste>
      </Grille>
    </View>
  );
}

function Liste({ theme, titre, vide, children, testID }: { theme: ThemeHub; titre: string; vide: string; children: React.ReactNode[]; testID: string }) {
  return (
    <Carte theme={theme} testID={testID}>
      <TitreCarte theme={theme} titre={titre} droite={children.length ? <Badge theme={theme} texte={String(children.length)} /> : undefined} />
      {children.length ? children : <Text style={attenue(theme)}>{vide}</Text>}
    </Carte>
  );
}

function LigneLien({ theme, texteLigne, ton, onPress, testID }: { theme: ThemeHub; texteLigne: string; ton: 'critique' | 'alerte' | 'neutre'; onPress(): void; testID: string }) {
  const couleur = ton === 'critique' ? theme.critique : ton === 'alerte' ? theme.alerte : theme.texte;
  return (
    <Text accessibilityRole="button" onPress={onPress} testID={testID} style={{ ...texte(theme, 14), color: couleur, minHeight: 32, paddingVertical: 4 }}>
      {`• ${texteLigne}`}
    </Text>
  );
}

// ------------------------------------------------------------------ Partenaires

function Partenaires({ theme, api, large, version, gerer, onOuvrir, onNouveau }: { theme: ThemeHub; api: ApiSponsors; large: boolean; version: number; gerer: boolean; onOuvrir(id: string): void; onNouveau(): void }) {
  const [liste, setListe] = useState<ResumePartenaire[] | undefined>();
  const [teams, setTeams] = useState<Record<string, string>>({});
  const [statut, setStatut] = useState<'actif' | 'termine'>('actif');
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const r = await api.partenaires(statut);
      setListe(r.partenaires);
      setTeams(r.teams);
    });
  }, [agir, api, statut, version]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-partenaires">
      <Retours theme={theme} erreur={erreur} prefixe="esport-sp-partenaires" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {(['actif', 'termine'] as const).map(s => (
          <BoutonHub key={s} theme={theme} titre={trSp(`partenaires.filtre_${s}` as CleSp)} variante={statut === s ? 'plein' : 'normal'} onPress={() => setStatut(s)} testID={`esport-sp-partenaires-${s}`} />
        ))}
        {gerer ? <BoutonHub theme={theme} titre={trSp('partenaires.nouveau')} variante="plein" onPress={onNouveau} testID="esport-sp-partenaire-nouveau" /> : null}
      </View>
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="★" titre={trSp('partenaires.vide')} texte={trSp('partenaires.vide_texte')} />
        </Carte>
      ) : null}
      {liste?.length ? (
        <Grille min={large ? 300 : 240} testID="esport-sp-partenaires-liste">
          {liste.map(p => (
            <Carte key={p.id} theme={theme} dense onPress={() => onOuvrir(p.id)} libelle={trSp('partenaires.ouvrir', { nom: p.nom })} testID={`esport-sp-partenaire-${p.id}`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {p.nom}
              </Text>
              <View style={[styles.ligne, { gap: ESP.xxs }]}>
                <Badge theme={theme} ton="accent" texte={trSp(`niveau.${p.niveau}` as CleSp)} />
                {p.obligationsEnRetard ? <Badge theme={theme} ton="critique" texte={trnSp('obligations.en_retard_n', p.obligationsEnRetard)} /> : null}
                {p.contrat && p.contrat.statut === 'actif' && p.contrat.joursRestants <= 60 ? <Badge theme={theme} ton="alerte" texte={p.contrat.joursRestants < 0 ? trSp('contrats.expire') : trnSp('contrats.fin_dans', p.contrat.joursRestants)} /> : null}
              </View>
              {p.contrat ? <Text style={attenue(theme)}>{[trSp('contrats.du_au', { debut: p.contrat.debut, fin: p.contrat.fin }), p.contrat.montant ? formaterMontant(p.contrat.montant) : '', p.contrat.dotation ? trSp('contrats.en_nature') : ''].filter(Boolean).join(' · ')}</Text> : <Text style={attenue(theme)}>{trSp('contrats.vide')}</Text>}
              {p.teams.length ? <Text style={attenue(theme)} numberOfLines={1}>{p.teams.map(t => teams[t] ?? '?').join(', ')}</Text> : null}
            </Carte>
          ))}
        </Grille>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Import / export

function Outils({ theme, api, onExporter, onImporte }: { theme: ThemeHub; api: ApiSponsors; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>; onImporte(): void }) {
  const [contenu, setContenu] = useState('');
  const [apercu, setApercu] = useState<ApercuImport | undefined>();
  const [corresp, setCorresp] = useState<Record<string, ChampImport | null>>({});
  const [bilan, setBilan] = useState<BilanImport | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const voir = (texteCsv: string) =>
    agir('apercu', async () => {
      setBilan(undefined);
      const a = await api.apercuImport(texteCsv);
      setApercu(a);
      setCorresp(Object.fromEntries(a.entetes.map((_, i) => [String(i), a.correspondance[String(i)] ?? null])));
    });
  const exporter = (genre: 'prospects' | 'partenaires') =>
    agir(`export-${genre}`, async () => {
      const f = await api.exporter(genre);
      if (!onExporter) throw new Error(trSp('outils.export_indisponible'));
      return (await onExporter(f.nom, f.contenu, 'text/csv')) ? trSp('outils.exporte', { nom: f.nom }) : undefined;
    });
  const choisi = new Set(Object.values(corresp).filter(Boolean));
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-outils">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-sp-outils" />
      <Panneau theme={theme}>
        <Intertitre theme={theme}>{trSp('outils.export')}</Intertitre>
        <Aide theme={theme}>{trSp('outils.export_aide')}</Aide>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={trSp('outils.export_prospects')} onPress={() => void exporter('prospects')} testID="esport-sp-export-prospects" />
          <BoutonHub theme={theme} titre={trSp('outils.export_partenaires')} onPress={() => void exporter('partenaires')} testID="esport-sp-export-partenaires" />
        </View>
      </Panneau>
      <Panneau theme={theme} testID="esport-sp-import">
        <Intertitre theme={theme}>{trSp('outils.import')}</Intertitre>
        <Aide theme={theme}>{trSp('outils.import_aide')}</Aide>
        {choixFichierDisponible ? (
          <BoutonHub
            theme={theme}
            titre={trSp('outils.choisir_csv')}
            onPress={() =>
              void agir('fichier', async () => {
                const f = await choisirFichier('text/csv,.csv,text/plain,.txt', 'esport-sp-import-fichier');
                if (!f) return undefined;
                if (f.taille > 1024 * 1024) throw new Error(trSp('outils.trop_gros'));
                const Decodeur = (globalThis as { TextDecoder?: new () => { decode(o: Uint8Array): string } }).TextDecoder;
                if (!Decodeur) throw new Error(trSp('outils.illisible'));
                const t = new Decodeur().decode(await f.lire(0, f.taille));
                setContenu(t);
                await voir(t);
                return undefined;
              })
            }
            testID="esport-sp-import-choisir"
          />
        ) : null}
        <Champ theme={theme} libelle={trSp('outils.coller')} valeur={contenu} onChanger={setContenu} multiligne maxLength={1024 * 1024} testID="esport-sp-import-texte" />
        <BoutonHub theme={theme} titre={trSp('outils.apercu')} desactive={!contenu.trim() || Boolean(enCours)} onPress={() => void voir(contenu)} testID="esport-sp-import-apercu" />
        {apercu ? (
          <View style={{ gap: ESP.xs }} testID="esport-sp-import-correspondance">
            <Text style={texte(theme)}>{trnSp('outils.lignes', apercu.lignes)}</Text>
            {apercu.entetes.map((e, i) => {
              const c = corresp[String(i)] ?? null;
              return (
                <View key={i} style={[styles.ligne, { gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }]}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{e || trSp('outils.colonne_n', { n: i + 1 })}</Text>
                    <Text style={attenue(theme)} numberOfLines={1}>
                      {apercu.exemples.map(x => x[i]).filter(Boolean).slice(0, 2).join(' · ')}
                    </Text>
                  </View>
                  <MenuActions
                    theme={theme}
                    titreBouton={c ? CHAMPS_LIBELLES()[c] : trSp('outils.ignorer')}
                    libelle={trSp('outils.colonne_vers', { colonne: e || String(i + 1) })}
                    testID={`esport-sp-import-col-${i}`}
                    actions={[
                      { titre: trSp('outils.ignorer'), onPress: () => setCorresp({ ...corresp, [String(i)]: null }), testID: `esport-sp-import-col-${i}-ignorer` },
                      ...apercu.champs.filter(ch => ch === c || !choisi.has(ch)).map(ch => ({ titre: CHAMPS_LIBELLES()[ch], onPress: () => setCorresp({ ...corresp, [String(i)]: ch }), testID: `esport-sp-import-col-${i}-${ch}` })),
                    ]}
                  />
                </View>
              );
            })}
            {!choisi.has('nom') ? <Aide theme={theme}>{trSp('outils.nom_requis')}</Aide> : null}
            <BoutonHub
              theme={theme}
              titre={trnSp('outils.importer_n', apercu.lignes)}
              variante="plein"
              desactive={!choisi.has('nom') || Boolean(enCours)}
              onPress={() =>
                void agir('importer', async () => {
                  const b = await api.importer(contenu, corresp);
                  setBilan(b);
                  setApercu(undefined);
                  onImporte();
                })
              }
              testID="esport-sp-import-ok"
            />
          </View>
        ) : null}
        {bilan ? (
          <View style={{ gap: ESP.xxs }} testID="esport-sp-import-bilan">
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{trSp('outils.bilan', { crees: bilan.crees, doublons: bilan.nDoublons, invalides: bilan.nInvalides })}</Text>
            {bilan.doublons.slice(0, 20).map(d => (
              <Text key={`d${d.ligne}`} style={attenue(theme)}>{trSp('outils.doublon_ligne', { ligne: d.ligne, nom: d.nom })}</Text>
            ))}
            {bilan.invalides.slice(0, 20).map(x => (
              <Text key={`i${x.ligne}`} style={attenue(theme)}>{trSp('outils.invalide_ligne', { ligne: x.ligne, champ: CHAMPS_LIBELLES()[x.code as ChampImport] ?? x.code })}</Text>
            ))}
          </View>
        ) : null}
      </Panneau>
    </View>
  );
}

// ------------------------------------------------------------------ Réglages : étapes, RGPD, journal

function ReglagesSp({ theme, api, onExporter, onChange }: { theme: ThemeHub; api: ApiSponsors; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>; onChange(): void }) {
  const [etapes, setEtapes] = useState<Etape[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string>>({});
  const [nouvelle, setNouvelle] = useState('');
  const [email, setEmail] = useState('');
  const [journal, setJournal] = useState<{ entrees: EntreeJournalSponsors[]; noms: Record<string, string | null> } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const e = (await api.etapes()).etapes;
    setEtapes(e);
    setNoms(Object.fromEntries(e.map(x => [x.id, x.nom ?? ''])));
    setJournal(await api.journal());
  }, [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const faire = (cle: string, a: () => Promise<unknown>, m?: string) =>
    agir(cle, async () => {
      await a();
      await charger();
      onChange();
      return m;
    });
  const ouvertes = etapes?.filter(e => e.issue === 'ouverte' && !e.archive) ?? [];
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-reglages">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-sp-reglages" />
      <Panneau theme={theme} testID="esport-sp-etapes">
        <Intertitre theme={theme}>{trSp('reglages.etapes')}</Intertitre>
        <Aide theme={theme}>{trSp('reglages.etapes_aide')}</Aide>
        {etapes?.map(e => {
          const rang = ouvertes.findIndex(x => x.id === e.id);
          return (
            <View key={e.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs, opacity: e.archive ? 0.6 : 1 }} testID={`esport-sp-etape-${e.cle ?? e.id}`}>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Champ theme={theme} libelle={trSp('reglages.nom_etape', { defaut: e.cle ? trSp(`etape.${e.cle}` as CleSp) : '' })} valeur={noms[e.id] ?? ''} onChanger={v => setNoms({ ...noms, [e.id]: v })} placeholder={e.cle ? trSp(`etape.${e.cle}` as CleSp) : ''} maxLength={60} testID={`esport-sp-etape-${e.cle ?? e.id}-nom`} style={{ flex: 1, minWidth: 180 }} />
                <Badge theme={theme} ton={e.issue === 'gagnee' ? 'ok' : e.issue === 'perdue' ? 'critique' : 'neutre'} texte={trSp(`issue.${e.issue}` as CleSp)} />
                {e.archive ? <Badge theme={theme} texte={trSp('c.archivee')} /> : null}
              </View>
              <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trSp('reglages.couleur')}>
                {PALETTE.map(([couleur, cle]) => (
                  <Teinte key={couleur} theme={theme} couleur={couleur} choisie={e.couleur === couleur} libelle={trCm(cle)} onPress={() => void faire('couleur', () => api.modifierEtape(e.id, { couleur }))} />
                ))}
              </View>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                {(noms[e.id] ?? '') !== (e.nom ?? '') ? <BoutonHub theme={theme} titre={trSp('c.enregistrer')} variante="plein" onPress={() => void faire('nom', () => api.modifierEtape(e.id, { nom: noms[e.id]?.trim() ? noms[e.id].trim() : e.cle ? null : e.nom }), trSp('c.enregistre'))} testID={`esport-sp-etape-${e.cle ?? e.id}-enregistrer`} /> : null}
                {rang > 0 ? <BoutonHub theme={theme} titre="↑" libelle={trSp('reglages.monter', { nom: nomEtape(e) })} onPress={() => void faire('ordre', () => api.modifierEtape(e.id, { index: rang - 1 }))} testID={`esport-sp-etape-${e.cle ?? e.id}-monter`} /> : null}
                {rang >= 0 && rang < ouvertes.length - 1 ? <BoutonHub theme={theme} titre="↓" libelle={trSp('reglages.descendre', { nom: nomEtape(e) })} onPress={() => void faire('ordre', () => api.modifierEtape(e.id, { index: rang + 1 }))} testID={`esport-sp-etape-${e.cle ?? e.id}-descendre`} /> : null}
                {e.issue === 'ouverte' && e.cle !== 'a_contacter' ? <BoutonHub theme={theme} titre={e.archive ? trSp('c.desarchiver') : trSp('c.archiver')} onPress={() => void faire('archive', () => api.modifierEtape(e.id, { archive: !e.archive }))} testID={`esport-sp-etape-${e.cle ?? e.id}-archiver`} /> : null}
              </View>
            </View>
          );
        })}
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Champ theme={theme} libelle={trSp('reglages.nouvelle_etape')} valeur={nouvelle} onChanger={setNouvelle} maxLength={60} testID="esport-sp-etape-nouvelle" style={{ flex: 1, minWidth: 200 }} />
          <BoutonHub
            theme={theme}
            titre={trSp('c.ajouter')}
            desactive={!nouvelle.trim()}
            onPress={() =>
              void faire('ajouter', async () => {
                await api.creerEtape(nouvelle.trim());
                setNouvelle('');
              })
            }
            testID="esport-sp-etape-ajouter"
          />
        </View>
      </Panneau>

      <Panneau theme={theme} testID="esport-sp-rgpd">
        <Intertitre theme={theme}>{trSp('reglages.rgpd')}</Intertitre>
        <Aide theme={theme}>{trSp('reglages.rgpd_aide')}</Aide>
        <Champ theme={theme} libelle={trSp('contacts.email')} valeur={email} onChanger={setEmail} maxLength={254} testID="esport-sp-rgpd-email" />
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub
            theme={theme}
            titre={trSp('reglages.rgpd_export')}
            desactive={!email.includes('@')}
            onPress={() =>
              void agir('rgpd-export', async () => {
                const r = await api.rgpdExport(email.trim());
                if (!r.contacts.length) return trSp('reglages.rgpd_rien');
                if (!onExporter) throw new Error(trSp('outils.export_indisponible'));
                const nom = `contact-sponsors-${r.exporteLe.slice(0, 10)}.json`;
                return (await onExporter(nom, JSON.stringify(r, null, 2), 'application/json')) ? trSp('outils.exporte', { nom }) : undefined;
              })
            }
            testID="esport-sp-rgpd-export"
          />
          <BoutonConfirme
            theme={theme}
            titre={trSp('reglages.rgpd_effacer')}
            confirmation={trSp('reglages.rgpd_confirmer')}
            desactive={!email.includes('@')}
            onConfirme={() =>
              void agir('rgpd-effacer', async () => {
                const r = await api.rgpdEffacer(email.trim());
                onChange();
                return trnSp('reglages.rgpd_effaces', r.effaces);
              })
            }
            testID="esport-sp-rgpd-effacer"
          />
        </View>
      </Panneau>

      <Panneau theme={theme} testID="esport-sp-journal">
        <Intertitre theme={theme}>{trSp('reglages.journal')}</Intertitre>
        {journal && !journal.entrees.length ? <Text style={attenue(theme)}>{trSp('reglages.journal_vide')}</Text> : null}
        {journal?.entrees.map(x => (
          <Text key={x.id} style={texte(theme, 13)}>
            {`${quand(x.date)} · ${phraseJournalSponsors(x.action, nomCompte(journal.noms, x.acteur), x.meta) ?? x.action}`}
          </Text>
        ))}
      </Panneau>
    </View>
  );
}
