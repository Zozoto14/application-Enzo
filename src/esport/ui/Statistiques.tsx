/**
 * Page « Statistiques » de l'Esport, au premier niveau (à côté de Dashboard · Teams · Membres), réservée au
 * FONDATEUR : l'entrée n'existe que pour lui et le serveur répond 404 à tout autre compte. Qui utilise
 * l'app, quelles pages le plus et le moins, quand, sur quel appareil, quelles fonctionnalités, quelles
 * erreurs. Voir docs/esport/statistiques.md.
 *
 * Filtres (période, team, rôle, appareil) en haut ; sept onglets : Vue d'ensemble, Utilisateurs, Pages,
 * Activité, Teams, Fonctionnalités, Qualité. Chaque tableau s'exporte en CSV. Les jours reconstitués depuis
 * le journal d'activité (avant la mise en ligne de la collecte) sont signalés « ≈ ».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { ClientEsport, FicheUsage, FiltresStatistiques, StatistiquesUsage, UtilisateurUsage } from '../client';
import { aujourdhui, dateCourte } from '../libelles';
import { formaterNombre, minuscules } from '../i18n';
import { trStats, trnStats } from '../i18n/statistiques';
import { apiStatistiques } from '../usage/api';
import { PageEsport } from './CadreEsport';
import { Choix, Retours, useAgir } from './commun';
import { Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Grille, Onglets, Pliable, SqueletteCartes, TitreCarte, Volet, attenue, texte, type EtatPresse } from './design';
import { BarreH, Chaleur } from './graphiquesUsage/graphiques';
import { Courbe } from './graphiquesUsage/Courbe';
import { csv, depuis, duree, libelleAction, libelleAppareil, libelleFonction, libelleLangue, libellePage, libelleRole, tendance } from './graphiquesUsage/format';

type Periode = '1' | '7' | '30' | '90' | 'perso';
type Section = 'apercu' | 'utilisateurs' | 'pages' | 'activite' | 'teams' | 'fonctions' | 'qualite';
const SECTIONS: readonly Section[] = ['apercu', 'utilisateurs', 'pages', 'activite', 'teams', 'fonctions', 'qualite'];
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const JOUR_MS = 86_400_000;

type Exporter = (nom: string, contenu: string, type?: string) => Promise<boolean>;

interface Colonne<T> {
  cle: string;
  titre: string;
  rendu(l: T): React.ReactNode;
  /** Valeur exportée en CSV. */
  csv(l: T): string | number | null;
  largeur?: number;
  nombre?: boolean;
}

/** Tableau : colonnes sur PC, une carte par ligne sur téléphone ; export CSV. */
function Tableau<T>({ theme, large, colonnes, colonnesCsv, lignes, cle, testID, titre, sous, nomCsv, onExporter, onLigne, libelleLigne, vide }: {
  theme: ThemeHub;
  large: boolean;
  colonnes: Array<Colonne<T>>;
  /** Colonnes du CSV, si elles diffèrent de l'écran. */
  colonnesCsv?: Array<Colonne<T>>;
  lignes: T[];
  cle(l: T): string;
  testID: string;
  titre: string;
  sous?: string;
  nomCsv: string;
  onExporter?: Exporter;
  onLigne?(l: T): void;
  libelleLigne?(l: T): string;
  vide?: string;
}) {
  const { avis, erreur, agir } = useAgir();
  const exporter = onExporter
    ? () =>
        void agir('csv', async () =>
          (await onExporter(nomCsv, csv((colonnesCsv ?? colonnes).map(c => c.titre), lignes.map(l => (colonnesCsv ?? colonnes).map(c => c.csv(l)))), 'text/csv')) ? trStats('statistiques.csv_ok') : undefined,
        )
    : undefined;
  return (
    <Carte theme={theme} testID={testID}>
      <TitreCarte theme={theme} titre={titre} sous={sous} droite={exporter && lignes.length ? <BoutonHub theme={theme} titre={trStats('statistiques.exporter_csv')} onPress={exporter} testID={`${testID}-csv`} /> : undefined} />
      <Retours theme={theme} avis={avis} erreur={erreur} prefixe={`${testID}-export`} />
      {lignes.length === 0 ? <Text style={attenue(theme, 14)}>{vide ?? trStats('statistiques.table_vide')}</Text> : null}
      {large && lignes.length ? (
        <View accessibilityRole="list">
          <View style={{ flexDirection: 'row', gap: ESP.s, paddingBottom: ESP.xs, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
            {colonnes.map(c => (
              <Text key={c.cle} style={{ ...attenue(theme, 12), fontWeight: '700', flex: c.largeur ?? 1, textAlign: c.nombre ? 'right' : 'left' }}>
                {c.titre}
              </Text>
            ))}
          </View>
          {lignes.map(l => {
            const contenu = colonnes.map(c => (
              <View key={c.cle} style={{ flex: c.largeur ?? 1, minWidth: 0, alignItems: c.nombre ? 'flex-end' : 'flex-start' }}>
                {c.rendu(l)}
              </View>
            ));
            const style = { flexDirection: 'row' as const, gap: ESP.s, paddingVertical: ESP.xs, minHeight: 44, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: teinteTransparente(theme.ligne, 0.6) };
            return onLigne ? (
              <Pressable key={cle(l)} testID={`${testID}-${cle(l)}`} accessibilityRole="button" accessibilityLabel={libelleLigne?.(l)} onPress={() => onLigne(l)} style={(e: EtatPresse) => [style, (e.hovered || e.focused) && { backgroundColor: teinteTransparente(theme.accent, 0.06) }]}>
                {contenu}
              </Pressable>
            ) : (
              <View key={cle(l)} testID={`${testID}-${cle(l)}`} style={style}>
                {contenu}
              </View>
            );
          })}
        </View>
      ) : null}
      {!large && lignes.length ? (
        <View style={{ gap: ESP.xs }}>
          {lignes.map(l => {
            const contenu = colonnes.map((c, i) => (
              <View key={c.cle} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.s, alignItems: 'flex-start' }}>
                {i > 0 ? <Text style={{ ...attenue(theme, 12), flexShrink: 0 }}>{c.titre}</Text> : null}
                <View style={{ flexShrink: 1, alignItems: i > 0 ? 'flex-end' : 'flex-start', flexGrow: i === 0 ? 1 : 0 }}>{c.rendu(l)}</View>
              </View>
            ));
            const style = { gap: ESP.xxs, padding: ESP.s, borderRadius: 10, borderWidth: 1, borderColor: theme.ligne };
            return onLigne ? (
              <Pressable key={cle(l)} testID={`${testID}-${cle(l)}`} accessibilityRole="button" accessibilityLabel={libelleLigne?.(l)} onPress={() => onLigne(l)} style={style}>
                {contenu}
              </Pressable>
            ) : (
              <View key={cle(l)} testID={`${testID}-${cle(l)}`} style={style}>
                {contenu}
              </View>
            );
          })}
        </View>
      ) : null}
    </Carte>
  );
}

const Valeur = ({ theme, children, testID, gras }: { theme: ThemeHub; children: React.ReactNode; testID?: string; gras?: boolean }) => (
  <Text testID={testID} style={{ ...texte(theme, 14), ...(gras ? { fontWeight: '700' as const } : {}), ...police(theme.policeChiffres) }} numberOfLines={2}>
    {children}
  </Text>
);

/** Période choisie → dates (jours de l'appareil, comme les autres écrans de l'Esport). */
function bornes(periode: Periode, du: string, au: string, t: number): { du: string; au: string } | undefined {
  if (periode === 'perso') return MOTIF_JOUR.test(du) && MOTIF_JOUR.test(au) && du <= au ? { du, au } : undefined;
  return { du: aujourdhui(t - (Number(periode) - 1) * JOUR_MS), au: aujourdhui(t) };
}

export function Statistiques({ theme, client, large, onExporter, maintenant = Date.now }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?: Exporter; maintenant?: () => number }) {
  const [periode, setPeriode] = useState<Periode>('30');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [appareil, setAppareil] = useState('');
  const [absents, setAbsents] = useState<'7' | '14' | '30'>('14');
  const [section, setSection] = useState<Section>('apercu');
  const [donnees, setDonnees] = useState<StatistiquesUsage | undefined>();
  const [fiche, setFiche] = useState<string | undefined>();
  const [version, setVersion] = useState(0);
  const { erreur, avis, agir } = useAgir();

  const filtres = useMemo<FiltresStatistiques | undefined>(() => {
    const b = bornes(periode, du, au, maintenant());
    return b ? { ...b, team: team || undefined, role: role || undefined, appareil: (appareil || undefined) as FiltresStatistiques['appareil'], absents: Number(absents) } : undefined;
  }, [periode, du, au, team, role, appareil, absents, maintenant]);

  useEffect(() => {
    if (!filtres) return;
    let vivant = true;
    void agir('', async () => {
      const d = await apiStatistiques(client).tableau(filtres);
      if (vivant) setDonnees(d);
    });
    return () => {
      vivant = false;
    };
  }, [client, filtres, agir, version]);

  const collecte = donnees?.collecte.actif ?? true;
  const basculer = useCallback(
    () =>
      void agir('collecte', async () => {
        const r = await apiStatistiques(client).changerCollecte(!collecte);
        setVersion(v => v + 1);
        return r.collecte ? trStats('statistiques.collecte_on_ok') : trStats('statistiques.collecte_off_ok');
      }),
    [agir, client, collecte],
  );

  const nbFiltres = [team, role, appareil].filter(Boolean).length;
  const d = donnees;
  const nomCsv = (quoi: string) => `statistiques-${quoi}-${d?.periode.du ?? ''}-${d?.periode.au ?? ''}.csv`;

  return (
    <PageEsport large={large} testID="esport-statistiques">
      <EnTetePage
        theme={theme}
        large={large}
        titre={trStats('statistiques.titre')}
        sous={d?.collecte.debut ? `${trStats('statistiques.sous_titre')} · ${trStats('statistiques.depuis', { date: dateCourte(d.collecte.debut) })}` : trStats('statistiques.sous_titre')}
        action={<BoutonHub theme={theme} titre={trStats('statistiques.rafraichir')} onPress={() => setVersion(v => v + 1)} testID="esport-stats-rafraichir" />}
        actions={[{ titre: collecte ? trStats('statistiques.couper') : trStats('statistiques.retablir'), onPress: basculer, testID: 'esport-stats-collecte', danger: collecte }]}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-stats" />
      <Carte theme={theme} dense>
        <Choix<Periode>
          theme={theme}
          libelle={trStats('statistiques.periode')}
          valeur={periode}
          options={(['1', '7', '30', '90', 'perso'] as const).map(p => ({ id: p, nom: trStats(`statistiques.periode.${p}`) }))}
          onChoisir={p => {
            if (p === 'perso' && !du) {
              setDu(aujourdhui(maintenant() - 29 * JOUR_MS));
              setAu(aujourdhui(maintenant()));
            }
            setPeriode(p);
          }}
          testID="esport-stats-periode"
        />
        {periode === 'perso' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
            <View style={{ flexGrow: 1, flexBasis: 160 }}>
              <Champ theme={theme} libelle={trStats('statistiques.du')} valeur={du} onChanger={setDu} maxLength={10} testID="esport-stats-du" />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 160 }}>
              <Champ theme={theme} libelle={trStats('statistiques.au')} valeur={au} onChanger={setAu} maxLength={10} testID="esport-stats-au" />
            </View>
          </View>
        ) : null}
        <Pliable theme={theme} titre={trStats('statistiques.filtres')} resume={nbFiltres ? trnStats('statistiques.filtres_actifs', nbFiltres) : undefined} testID="esport-stats-filtres">
          <Choix
            theme={theme}
            libelle={trStats('statistiques.team')}
            valeur={team}
            options={[{ id: '', nom: trStats('statistiques.toutes') }, ...(d?.choix.teams ?? []).map(x => ({ id: x.id, nom: x.nom }))]}
            onChoisir={setTeam}
            testID="esport-stats-team"
          />
          <Choix theme={theme} libelle={trStats('statistiques.role')} valeur={role} options={[{ id: '', nom: trStats('statistiques.tous') }, ...(d?.choix.roles ?? []).map(r => ({ id: r, nom: libelleRole(r) }))]} onChoisir={setRole} testID="esport-stats-role" />
          <Choix theme={theme} libelle={trStats('statistiques.appareil')} valeur={appareil} options={[{ id: '', nom: trStats('statistiques.tous') }, ...(d?.choix.appareils ?? []).map(a => ({ id: a, nom: libelleAppareil(a) }))]} onChoisir={setAppareil} testID="esport-stats-appareil" />
        </Pliable>
      </Carte>
      {d && !d.collecte.actif ? <Badge theme={theme} texte={trStats('statistiques.collecte_coupee')} ton="alerte" testID="esport-stats-collecte-coupee" /> : null}
      {d?.historique.reconstitue ? (
        <Text style={{ ...attenue(theme, 13), backgroundColor: teinteTransparente(theme.attenue, 0.08), padding: ESP.s, borderRadius: 10 }} testID="esport-stats-reconstitue">
          {trStats('statistiques.reconstitue', { date: dateCourte(d.collecte.debut ?? d.periode.au) })}
          {d.historique.tronque ? ` ${trStats('statistiques.reconstitue_tronque')}` : ''}
        </Text>
      ) : null}
      <Onglets
        theme={theme}
        prefixe="esport-stats-onglet"
        testID="esport-stats-onglets"
        entrees={SECTIONS.map(s => ({ id: s, libelle: trStats(`statistiques.onglet.${s}`) }))}
        actif={section}
        onChoisir={s => setSection(s as Section)}
        defilant={!large}
      />
      {!d ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {d && section === 'apercu' ? <Apercu theme={theme} d={d} large={large} /> : null}
      {d && section === 'utilisateurs' ? <Utilisateurs theme={theme} d={d} large={large} absents={absents} onAbsents={setAbsents} onExporter={onExporter} nomCsv={nomCsv('utilisateurs')} onFiche={setFiche} maintenant={maintenant} /> : null}
      {d && section === 'pages' ? <Pages theme={theme} d={d} large={large} onExporter={onExporter} nomCsv={nomCsv('pages')} /> : null}
      {d && section === 'activite' ? <Activite theme={theme} d={d} large={large} onExporter={onExporter} nomCsv={nomCsv('activite')} /> : null}
      {d && section === 'teams' ? <Teams theme={theme} d={d} large={large} onExporter={onExporter} nomCsv={nomCsv('teams')} /> : null}
      {d && section === 'fonctions' ? <Fonctions theme={theme} d={d} large={large} onExporter={onExporter} nomCsv={nomCsv('fonctionnalites')} /> : null}
      {d && section === 'qualite' ? <Qualite theme={theme} d={d} large={large} onExporter={onExporter} nomCsv={nomCsv('erreurs')} /> : null}
      <Text style={{ ...attenue(theme, 12), backgroundColor: teinteTransparente(theme.attenue, 0.08), padding: ESP.s, borderRadius: 10 }} testID="esport-stats-mention">
        {trStats('statistiques.mention')}
      </Text>
      {fiche && d ? <FicheMembre theme={theme} client={client} compte={fiche} periode={d.periode} large={large} onFermer={() => setFiche(undefined)} /> : null}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Vue d'ensemble

function Apercu({ theme, d, large }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean }) {
  const a = d.apercu;
  const p = a.periode;
  const q = a.precedente;
  const tuiles: Array<{ cle: string; libelle: string; valeur: string; detail?: string; glyphe: string }> = [
    { cle: 'jour', libelle: trStats('statistiques.actifs_jour'), valeur: formaterNombre(a.actifsJour), glyphe: '●' },
    { cle: 'semaine', libelle: trStats('statistiques.actifs_semaine'), valeur: formaterNombre(a.actifsSemaine), glyphe: '◐' },
    { cle: 'mois', libelle: trStats('statistiques.actifs_mois'), valeur: formaterNombre(a.actifsMois), glyphe: '◯' },
    { cle: 'periode', libelle: trStats('statistiques.actifs_periode'), valeur: formaterNombre(p.actifs), detail: tendance(p.actifs, q.actifs), glyphe: 'membres' },
    { cle: 'sessions', libelle: trStats('statistiques.sessions'), valeur: formaterNombre(p.sessions), detail: tendance(p.sessions, q.sessions), glyphe: '⇄' },
    { cle: 'duree', libelle: trStats('statistiques.duree_moyenne'), valeur: duree(p.dureeMoyenneMs), detail: tendance(p.dureeMoyenneMs, q.dureeMoyenneMs), glyphe: '◷' },
    { cle: 'vues', libelle: trStats('statistiques.vues'), valeur: formaterNombre(p.vues), detail: tendance(p.vues, q.vues), glyphe: '▤' },
    { cle: 'inscriptions', libelle: trStats('statistiques.inscriptions'), valeur: formaterNombre(p.inscriptions), detail: tendance(p.inscriptions, q.inscriptions), glyphe: '+' },
    { cle: 'invitations', libelle: trStats('statistiques.invitations'), valeur: formaterNombre(p.invitationsAcceptees), detail: tendance(p.invitationsAcceptees, q.invitationsAcceptees), glyphe: '✓' },
  ];
  return (
    <View style={{ gap: ESP.m }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }} testID="esport-stats-apercu">
        {tuiles.map(x => (
          <ChiffreCle key={x.cle} theme={theme} large={large} libelle={x.libelle} valeur={x.valeur} detail={x.detail} glyphe={x.glyphe} testID={`esport-stats-tuile-${x.cle}`} testIDValeur={`esport-stats-valeur-${x.cle}`} />
        ))}
      </View>
      {!d.collecte.debut && !d.historique.reconstitue ? <Text style={attenue(theme, 14)}>{trStats('statistiques.pas_encore')}</Text> : null}
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trStats('statistiques.courbe')} />
        <Courbe theme={theme} points={pointsQuotidiens(d)} testID="esport-stats-courbe" />
      </Carte>
    </View>
  );
}

const pointsQuotidiens = (d: StatistiquesUsage) =>
  d.activite.quotidien.map(j => ({
    jour: j.jour,
    valeur: j.actifs,
    reconstitue: j.reconstitue,
    detail: j.reconstitue
      ? trStats('statistiques.courbe_detail_reconstitue', { jour: dateCourte(j.jour), actifs: j.actifs, actions: j.actions })
      : trStats('statistiques.courbe_detail', { jour: dateCourte(j.jour), actifs: j.actifs, vues: j.vues }),
  }));

// ------------------------------------------------------------------ Utilisateurs

type Tri = 'activite' | 'sessions' | 'temps' | 'nom';
type Montrer = 'tous' | 'actifs' | 'inactifs' | 'jamais';

function Utilisateurs({ theme, d, large, absents, onAbsents, onExporter, nomCsv, onFiche, maintenant }: {
  theme: ThemeHub;
  d: StatistiquesUsage;
  large: boolean;
  absents: '7' | '14' | '30';
  onAbsents(v: '7' | '14' | '30'): void;
  onExporter?: Exporter;
  nomCsv: string;
  onFiche(compte: string): void;
  maintenant: () => number;
}) {
  const [recherche, setRecherche] = useState('');
  const [tri, setTri] = useState<Tri>('activite');
  const [montrer, setMontrer] = useState<Montrer>('tous');
  const t = maintenant();
  const lignes = useMemo(() => {
    const q = minuscules(recherche.trim());
    const filtres = d.utilisateurs.filter(u => {
      if (q && !minuscules(u.pseudo).includes(q) && !u.teams.some(x => minuscules(x.nom ?? '').includes(q))) return false;
      if (montrer === 'actifs') return !u.inactif;
      if (montrer === 'inactifs') return u.inactif;
      if (montrer === 'jamais') return u.jamaisConnecte;
      return true;
    });
    const par: Record<Tri, (a: UtilisateurUsage, b: UtilisateurUsage) => number> = {
      activite: (a, b) => (b.derniereActivite ?? '').localeCompare(a.derniereActivite ?? ''),
      sessions: (a, b) => b.sessions - a.sessions,
      temps: (a, b) => b.dureeMs - a.dureeMs,
      nom: (a, b) => a.pseudo.localeCompare(b.pseudo),
    };
    return [...filtres].sort((a, b) => par[tri](a, b) || a.pseudo.localeCompare(b.pseudo));
  }, [d.utilisateurs, recherche, tri, montrer]);
  const inactifs = d.utilisateurs.filter(u => u.inactif).length;
  const statut = (u: UtilisateurUsage) => (u.jamaisConnecte ? trStats('statistiques.statut.invite') : u.inactif ? trStats('statistiques.statut.inactif') : trStats('statistiques.statut.actif'));
  const colonnes: Array<Colonne<UtilisateurUsage>> = [
    {
      cle: 'membre',
      titre: trStats('statistiques.col.membre'),
      largeur: 1.6,
      rendu: u => (
        <View style={{ gap: 2 }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={1}>
            {u.pseudo}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xxs }}>
            {u.jamaisConnecte || u.inactif ? <Badge theme={theme} texte={statut(u)} ton={u.jamaisConnecte ? 'critique' : 'alerte'} /> : null}
            {u.teams.slice(0, 2).map(x => (
              <Badge key={x.id} theme={theme} texte={`${x.nom ?? ''} · ${x.role}`} />
            ))}
          </View>
        </View>
      ),
      csv: u => u.pseudo,
    },
    { cle: 'teams', titre: trStats('statistiques.col.teams'), csv: u => u.teams.map(x => `${x.nom ?? ''} (${x.role})`).join(' ; '), rendu: () => null, largeur: 0.001 },
    { cle: 'statut', titre: trStats('statistiques.col.statut'), csv: statut, rendu: () => null, largeur: 0.001 },
    {
      cle: 'derniere',
      titre: trStats('statistiques.col.derniere'),
      rendu: u => (
        <View>
          <Valeur theme={theme}>{depuis(u.derniereActivite, t)}</Valeur>
          {u.source === 'journal' ? <Text style={attenue(theme, 11)}>{trStats('statistiques.selon_journal')}</Text> : null}
        </View>
      ),
      csv: u => u.derniereActivite ?? '',
    },
    { cle: 'sessions', titre: trStats('statistiques.col.sessions'), nombre: true, largeur: 0.6, rendu: u => <Valeur theme={theme} testID={`esport-stats-sessions-${u.compte}`}>{formaterNombre(u.sessions)}</Valeur>, csv: u => u.sessions },
    { cle: 'temps', titre: trStats('statistiques.col.temps'), nombre: true, largeur: 0.7, rendu: u => <Valeur theme={theme}>{duree(u.dureeMs)}</Valeur>, csv: u => Math.round(u.dureeMs / 1000) },
    {
      cle: 'pages',
      titre: trStats('statistiques.col.pages_preferees'),
      largeur: 1.5,
      rendu: u => <Text style={attenue(theme, 13)} numberOfLines={2} testID={`esport-stats-preferees-${u.compte}`}>{u.pagesPreferees.map(p => libellePage(p.page)).join(', ') || '—'}</Text>,
      csv: u => u.pagesPreferees.map(p => `${p.page} (${p.vues})`).join(' ; '),
    },
    { cle: 'appareil', titre: trStats('statistiques.col.appareil'), largeur: 0.8, rendu: u => <Text style={attenue(theme, 13)}>{libelleAppareil(u.appareil)}</Text>, csv: u => u.appareil ?? '' },
  ];
  // Colonnes « teams » et « statut » : dans le CSV seulement (à l'écran, en pastilles sous le nom).
  const visibles = colonnes.filter(c => c.cle !== 'teams' && c.cle !== 'statut');
  return (
    <View style={{ gap: ESP.m }}>
      <Carte theme={theme} dense>
        <Champ theme={theme} libelle={trStats('statistiques.rechercher')} valeur={recherche} onChanger={setRecherche} maxLength={40} testID="esport-stats-recherche" />
        <View style={{ flexDirection: large ? 'row' : 'column', flexWrap: 'wrap', gap: ESP.m }}>
          <Choix<Tri> theme={theme} libelle={trStats('statistiques.tri')} valeur={tri} options={(['activite', 'sessions', 'temps', 'nom'] as const).map(x => ({ id: x, nom: trStats(`statistiques.tri.${x}`) }))} onChoisir={setTri} testID="esport-stats-tri" />
          <Choix<Montrer> theme={theme} libelle={trStats('statistiques.montrer')} valeur={montrer} options={(['tous', 'actifs', 'inactifs', 'jamais'] as const).map(x => ({ id: x, nom: trStats(`statistiques.montrer.${x}`) }))} onChoisir={setMontrer} testID="esport-stats-montrer" />
          <Choix<'7' | '14' | '30'> theme={theme} libelle={trStats('statistiques.absents')} valeur={absents} options={(['7', '14', '30'] as const).map(x => ({ id: x, nom: trStats('statistiques.absents_jours', { n: x }) }))} onChoisir={onAbsents} testID="esport-stats-absents" />
        </View>
      </Carte>
      <Tableau
        theme={theme}
        large={large}
        colonnes={visibles}
        colonnesCsv={colonnes}
        lignes={lignes}
        cle={u => u.compte}
        testID="esport-stats-utilisateurs"
        titre={trnStats('statistiques.utilisateurs_compte', lignes.length)}
        sous={trStats('statistiques.inactifs_compte', { n: inactifs })}
        nomCsv={nomCsv}
        onExporter={onExporter}
        onLigne={u => onFiche(u.compte)}
        libelleLigne={u => trStats('statistiques.ouvrir_fiche', { nom: u.pseudo })}
        vide={trStats('statistiques.aucun_membre')}
      />
    </View>
  );
}

function FicheMembre({ theme, client, compte, periode, large, onFermer }: { theme: ThemeHub; client: ClientEsport; compte: string; periode: { du: string; au: string }; large: boolean; onFermer(): void }) {
  const [f, setF] = useState<FicheUsage | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    let vivant = true;
    void agir('', async () => {
      const r = await apiStatistiques(client).fiche(compte, periode);
      if (vivant) setF(r);
    });
    return () => {
      vivant = false;
    };
  }, [agir, client, compte, periode]);
  const contenu = (
    <View style={{ gap: ESP.m }} testID="esport-stats-fiche">
      <Retours theme={theme} erreur={erreur} prefixe="esport-stats-fiche" />
      {!f ? <SqueletteCartes theme={theme} n={1} large={large} /> : null}
      {f ? (
        <>
          <Text style={texte(theme, 15)} testID="esport-stats-fiche-resume">
            {trStats('statistiques.fiche_resume', { sessions: f.totaux.sessions, vues: f.totaux.vues, temps: duree(f.totaux.dureeMs), actions: f.totaux.actions })}
          </Text>
          <Text style={attenue(theme)}>
            {[f.inscritLe ? trStats('statistiques.fiche_inscrit', { date: dateCourte(f.inscritLe) }) : null, f.premiereConnexion ? trStats('statistiques.fiche_premiere', { date: dateCourte(f.premiereConnexion) }) : trStats('statistiques.fiche_jamais'), f.appareils.map(libelleAppareil).join(', ')].filter(Boolean).join(' · ')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xxs }}>
            {f.teams.map(x => (
              <Badge key={x.id} theme={theme} texte={`${x.nom} · ${x.role}`} />
            ))}
          </View>
          {f.pages.length ? (
            <View style={{ gap: ESP.xxs }}>
              {f.pages.slice(0, 8).map(p => (
                <BarreH key={p.page} theme={theme} libelle={libellePage(p.page)} valeur={p.vues} max={f.pages[0].vues} texte={`${p.vues} · ${duree(p.dureeMs)}`} />
              ))}
            </View>
          ) : null}
          <Text accessibilityRole="header" style={{ ...texte(theme, 16), fontWeight: '700' }}>
            {trStats('statistiques.chronologie')}
          </Text>
          {f.chronologie.length === 0 ? <Text style={attenue(theme, 14)}>{trStats('statistiques.chronologie_vide')}</Text> : null}
          <View style={{ gap: ESP.xxs }} testID="esport-stats-chronologie">
            {f.chronologie.slice(0, 150).map((e, i) => (
              <View key={`${e.date}-${i}`} style={{ flexDirection: 'row', gap: ESP.s, paddingVertical: 2 }}>
                <Text style={{ ...attenue(theme, 12), width: 110 }}>{`${dateCourte(e.date)} ${e.date.slice(11, 16)}`}</Text>
                <Text style={{ ...texte(theme, 13), flex: 1 }}>
                  {e.source === 'journal'
                    ? trStats('statistiques.chrono.journal', { action: libelleAction(e.action ?? '') })
                    : e.genre === 'page'
                      ? trStats('statistiques.chrono.page', { page: libellePage(e.page ?? ''), temps: duree(e.dureeMs) })
                      : e.genre === 'erreur'
                        ? trStats('statistiques.chrono.erreur', { message: e.erreur ?? '' })
                        : libelleAction(e.action ?? '')}
                  {e.team ? ` · ${e.team}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
  const titre = trStats('statistiques.fiche', { nom: f?.pseudo ?? compte });
  if (large) {
    return (
      <Volet theme={theme} visible titre={titre} onFermer={onFermer} testID="esport-stats-volet" largeur={620}>
        {contenu}
      </Volet>
    );
  }
  return (
    <Carte theme={theme} testID="esport-stats-volet">
      <TitreCarte theme={theme} titre={titre} droite={<BoutonHub theme={theme} titre={trStats('statistiques.fermer')} onPress={onFermer} testID="esport-stats-volet-fermer" />} />
      {contenu}
    </Carte>
  );
}

// ------------------------------------------------------------------ Pages

function Pages({ theme, d, large, onExporter, nomCsv }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean; onExporter?: Exporter; nomCsv: string }) {
  const c = d.pages.classement;
  const max = c[0]?.vues ?? 0;
  const barre = (p: (typeof c)[number], prefixe: string) => (
    <BarreH
      key={p.page}
      theme={theme}
      libelle={libellePage(p.page)}
      valeur={p.vues}
      max={max}
      texte={trStats('statistiques.barre_page', { vues: p.vues, visiteurs: p.visiteurs, temps: duree(p.dureeMoyenneMs) })}
      testID={`${prefixe}-${p.page}`}
    />
  );
  const moins = [...c].reverse().slice(0, 10);
  type L = (typeof c)[number];
  const colonnes: Array<Colonne<L>> = [
    { cle: 'page', titre: trStats('statistiques.col.page'), largeur: 2, rendu: p => <Valeur theme={theme}>{libellePage(p.page)}</Valeur>, csv: p => p.page },
    { cle: 'vues', titre: trStats('statistiques.col.vues'), nombre: true, rendu: p => <Valeur theme={theme} gras>{formaterNombre(p.vues)}</Valeur>, csv: p => p.vues },
    { cle: 'visiteurs', titre: trStats('statistiques.col.visiteurs'), nombre: true, rendu: p => <Valeur theme={theme}>{formaterNombre(p.visiteurs)}</Valeur>, csv: p => p.visiteurs },
    { cle: 'moyen', titre: trStats('statistiques.col.temps_moyen'), nombre: true, rendu: p => <Valeur theme={theme}>{duree(p.dureeMoyenneMs)}</Valeur>, csv: p => Math.round(p.dureeMoyenneMs / 1000) },
    { cle: 'total', titre: trStats('statistiques.col.temps'), nombre: true, rendu: p => <Valeur theme={theme}>{duree(p.dureeMs)}</Valeur>, csv: p => Math.round(p.dureeMs / 1000) },
  ];
  return (
    <View style={{ gap: ESP.m }}>
      {c.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="◔" titre={trStats('statistiques.aucune_page')} />
        </Carte>
      ) : (
        <Grille min={large ? 380 : 280}>
          <Carte theme={theme} testID="esport-stats-plus">
            <TitreCarte theme={theme} titre={trStats('statistiques.plus_utilisees')} />
            {c.slice(0, 10).map(p => barre(p, 'esport-stats-plus'))}
          </Carte>
          <Carte theme={theme} testID="esport-stats-moins">
            <TitreCarte theme={theme} titre={trStats('statistiques.moins_utilisees')} />
            {moins.map(p => barre(p, 'esport-stats-moins'))}
          </Carte>
        </Grille>
      )}
      <Grille min={large ? 380 : 280}>
        <Carte theme={theme} testID="esport-stats-jamais">
          <TitreCarte theme={theme} titre={trStats('statistiques.jamais_ouvertes')} />
          {d.pages.jamais.length === 0 ? <Text style={attenue(theme, 14)}>{trStats('statistiques.jamais_ouvertes_aucune')}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xxs }}>
            {d.pages.jamais.map(p => (
              <Badge key={p} theme={theme} texte={libellePage(p)} testID={`esport-stats-jamais-${p}`} />
            ))}
          </View>
        </Carte>
        <Carte theme={theme} testID="esport-stats-non-utilises">
          <TitreCarte theme={theme} titre={trStats('statistiques.modules_non_utilises')} />
          {d.pages.nonUtilises.length === 0 ? <Text style={attenue(theme, 14)}>{trStats('statistiques.modules_non_utilises_aucun')}</Text> : null}
          {d.pages.nonUtilises.map(x => (
            <View key={x.team.id} style={{ gap: ESP.xxs }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{x.team.nom}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xxs }}>
                {x.modules.map(m => (
                  <Badge key={m} theme={theme} texte={libellePage(d.choix.pages.find(p => p.endsWith(`.${m}`)) ?? m)} ton="alerte" testID={`esport-stats-non-utilise-${x.team.slug}-${m}`} />
                ))}
              </View>
            </View>
          ))}
        </Carte>
      </Grille>
      <Tableau theme={theme} large={large} colonnes={colonnes} lignes={c} cle={p => p.page} testID="esport-stats-pages" titre={trStats('statistiques.toutes_les_pages')} nomCsv={nomCsv} onExporter={onExporter} vide={trStats('statistiques.aucune_page')} />
    </View>
  );
}

// ------------------------------------------------------------------ Activité

function Activite({ theme, d, large, onExporter, nomCsv }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean; onExporter?: Exporter; nomCsv: string }) {
  const a = d.activite;
  const maxApp = Math.max(0, ...a.appareils.map(x => x.visiteurs));
  const maxLangue = Math.max(0, ...a.langues.map(x => x.visiteurs));
  type J = (typeof a.quotidien)[number];
  const colonnes: Array<Colonne<J>> = [
    { cle: 'jour', titre: trStats('statistiques.col.jour'), rendu: j => <Valeur theme={theme}>{`${dateCourte(j.jour)}${j.reconstitue ? ' ≈' : ''}`}</Valeur>, csv: j => `${j.jour}${j.reconstitue ? ' ≈' : ''}` },
    { cle: 'actifs', titre: trStats('statistiques.col.actifs'), nombre: true, rendu: j => <Valeur theme={theme} gras>{formaterNombre(j.actifs)}</Valeur>, csv: j => j.actifs },
    { cle: 'sessions', titre: trStats('statistiques.col.sessions'), nombre: true, rendu: j => <Valeur theme={theme}>{formaterNombre(j.sessions)}</Valeur>, csv: j => j.sessions },
    { cle: 'vues', titre: trStats('statistiques.col.vues'), nombre: true, rendu: j => <Valeur theme={theme}>{formaterNombre(j.vues)}</Valeur>, csv: j => j.vues },
    { cle: 'actions', titre: trStats('statistiques.col.actions'), nombre: true, rendu: j => <Valeur theme={theme}>{formaterNombre(j.actions)}</Valeur>, csv: j => j.actions },
  ];
  return (
    <View style={{ gap: ESP.m }}>
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trStats('statistiques.chaleur')} />
        <Chaleur theme={theme} grille={a.chaleur} large={large} />
      </Carte>
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trStats('statistiques.courbe')} />
        <Courbe theme={theme} points={pointsQuotidiens(d)} testID="esport-stats-courbe-activite" />
      </Carte>
      <Grille min={large ? 380 : 280}>
        <Carte theme={theme} testID="esport-stats-appareils">
          <TitreCarte theme={theme} titre={trStats('statistiques.par_appareil')} />
          {a.appareils.length === 0 ? <Text style={attenue(theme, 14)}>{trStats('statistiques.table_vide')}</Text> : null}
          {a.appareils.map(x => (
            <BarreH key={x.appareil} theme={theme} libelle={libelleAppareil(x.appareil)} valeur={x.visiteurs} max={maxApp} texte={trStats('statistiques.visiteurs_sessions', { visiteurs: x.visiteurs, sessions: x.sessions })} testID={`esport-stats-appareil-${x.appareil}`} />
          ))}
        </Carte>
        <Carte theme={theme} testID="esport-stats-langues">
          <TitreCarte theme={theme} titre={trStats('statistiques.par_langue')} />
          {a.langues.length === 0 ? <Text style={attenue(theme, 14)}>{trStats('statistiques.table_vide')}</Text> : null}
          {a.langues.map(x => (
            <BarreH key={x.langue} theme={theme} libelle={libelleLangue(x.langue)} valeur={x.visiteurs} max={maxLangue} texte={trStats('statistiques.visiteurs_sessions', { visiteurs: x.visiteurs, sessions: x.sessions })} testID={`esport-stats-langue-${x.langue}`} />
          ))}
        </Carte>
      </Grille>
      <Tableau theme={theme} large={large} colonnes={colonnes} lignes={[...a.quotidien].reverse()} cle={j => j.jour} testID="esport-stats-quotidien" titre={trStats('statistiques.courbe')} nomCsv={nomCsv} onExporter={onExporter} />
    </View>
  );
}

// ------------------------------------------------------------------ Teams, fonctionnalités, qualité

function Teams({ theme, d, large, onExporter, nomCsv }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean; onExporter?: Exporter; nomCsv: string }) {
  type L = StatistiquesUsage['teams'][number];
  const max = Math.max(0, ...d.teams.map(x => x.vues));
  const colonnes: Array<Colonne<L>> = [
    { cle: 'team', titre: trStats('statistiques.col.team'), largeur: 1.6, rendu: x => <Valeur theme={theme} gras>{x.nom}</Valeur>, csv: x => x.nom },
    { cle: 'membres', titre: trStats('statistiques.col.membres'), nombre: true, largeur: 0.7, rendu: x => <Valeur theme={theme}>{formaterNombre(x.membres)}</Valeur>, csv: x => x.membres },
    { cle: 'adoption', titre: trStats('statistiques.col.adoption'), nombre: true, rendu: x => <Valeur theme={theme}>{`${x.visiteurs} · ${trStats('statistiques.adoption', { p: x.adoption })}`}</Valeur>, csv: x => x.adoption },
    { cle: 'vues', titre: trStats('statistiques.col.vues'), nombre: true, largeur: 0.7, rendu: x => <Valeur theme={theme}>{formaterNombre(x.vues)}</Valeur>, csv: x => x.vues },
    { cle: 'temps', titre: trStats('statistiques.col.temps'), nombre: true, largeur: 0.8, rendu: x => <Valeur theme={theme}>{duree(x.dureeMs)}</Valeur>, csv: x => Math.round(x.dureeMs / 1000) },
    { cle: 'actions', titre: trStats('statistiques.col.actions'), nombre: true, largeur: 0.8, rendu: x => <Valeur theme={theme}>{`${x.actions}${x.actionsReconstituees ? ` (≈ ${x.actionsReconstituees})` : ''}`}</Valeur>, csv: x => x.actions },
  ];
  return (
    <View style={{ gap: ESP.m }}>
      <Carte theme={theme} testID="esport-stats-teams-barres">
        <TitreCarte theme={theme} titre={trStats('statistiques.comparaison_teams')} />
        {d.teams.map(x => (
          <BarreH key={x.id} theme={theme} libelle={x.nom} valeur={x.vues} max={max} texte={`${formaterNombre(x.vues)} · ${trStats('statistiques.adoption', { p: x.adoption })}`} testID={`esport-stats-team-${x.slug}`} />
        ))}
      </Carte>
      <Tableau theme={theme} large={large} colonnes={colonnes} lignes={d.teams} cle={x => x.slug} testID="esport-stats-teams" titre={trStats('statistiques.comparaison_teams')} nomCsv={nomCsv} onExporter={onExporter} />
    </View>
  );
}

function Fonctions({ theme, d, large, onExporter, nomCsv }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean; onExporter?: Exporter; nomCsv: string }) {
  type L = StatistiquesUsage['fonctions'][number];
  const max = Math.max(0, ...d.fonctions.map(f => f.n + f.reconstitue));
  const colonnes: Array<Colonne<L>> = [
    { cle: 'fonction', titre: trStats('statistiques.col.fonction'), largeur: 2, rendu: f => <Valeur theme={theme}>{libelleFonction(f.fonction)}</Valeur>, csv: f => f.fonction },
    { cle: 'n', titre: trStats('statistiques.col.utilisations'), nombre: true, rendu: f => <Valeur theme={theme} gras>{`${formaterNombre(f.n)}${f.reconstitue ? ` (≈ ${f.reconstitue})` : ''}`}</Valeur>, csv: f => f.n },
    { cle: 'utilisateurs', titre: trStats('statistiques.col.utilisateurs'), nombre: true, rendu: f => <Valeur theme={theme}>{formaterNombre(f.utilisateurs)}</Valeur>, csv: f => f.utilisateurs },
  ];
  return (
    <View style={{ gap: ESP.m }}>
      <Carte theme={theme} testID="esport-stats-fonctions">
        <TitreCarte theme={theme} titre={trStats('statistiques.fonctions_titre')} />
        {d.fonctions.map(f => (
          <BarreH
            key={f.fonction}
            theme={theme}
            libelle={libelleFonction(f.fonction)}
            valeur={f.n + f.reconstitue}
            max={max}
            discret={f.n === 0 && f.reconstitue > 0}
            texte={f.reconstitue ? trStats('statistiques.fonction_detail_reconstitue', { n: f.n, utilisateurs: f.utilisateurs, r: f.reconstitue }) : trStats('statistiques.fonction_detail', { n: f.n, utilisateurs: f.utilisateurs })}
            testID={`esport-stats-fonction-${f.fonction}`}
          />
        ))}
      </Carte>
      <Tableau theme={theme} large={large} colonnes={colonnes} lignes={d.fonctions} cle={f => f.fonction} testID="esport-stats-fonctions-table" titre={trStats('statistiques.fonctions_titre')} nomCsv={nomCsv} onExporter={onExporter} />
    </View>
  );
}

function Qualite({ theme, d, large, onExporter, nomCsv }: { theme: ThemeHub; d: StatistiquesUsage; large: boolean; onExporter?: Exporter; nomCsv: string }) {
  type L = StatistiquesUsage['erreurs'][number];
  const colonnes: Array<Colonne<L>> = [
    { cle: 'erreur', titre: trStats('statistiques.col.erreur'), largeur: 2.4, rendu: e => <Text style={{ ...texte(theme, 13), fontFamily: 'monospace' }} numberOfLines={3}>{e.message}</Text>, csv: e => e.message },
    { cle: 'page', titre: trStats('statistiques.col.page'), largeur: 1.2, rendu: e => <Text style={attenue(theme, 13)}>{e.page ? libellePage(e.page) : '—'}</Text>, csv: e => e.page ?? '' },
    { cle: 'n', titre: trStats('statistiques.col.occurrences'), nombre: true, largeur: 0.7, rendu: e => <Valeur theme={theme} gras>{formaterNombre(e.n)}</Valeur>, csv: e => e.n },
    { cle: 'touches', titre: trStats('statistiques.col.touches'), nombre: true, largeur: 0.8, rendu: e => <Valeur theme={theme}>{formaterNombre(e.utilisateurs)}</Valeur>, csv: e => e.utilisateurs },
    { cle: 'vu', titre: trStats('statistiques.col.vue_le'), largeur: 0.8, rendu: e => <Text style={attenue(theme, 13)}>{dateCourte(e.derniere)}</Text>, csv: e => e.derniere },
  ];
  return (
    <Tableau theme={theme} large={large} colonnes={colonnes} lignes={d.erreurs} cle={e => `${e.empreinte}-${e.page ?? ''}`} testID="esport-stats-erreurs" titre={trStats('statistiques.erreurs_titre')} nomCsv={nomCsv} onExporter={onExporter} vide={trStats('statistiques.erreurs_aucune')} />
  );
}
