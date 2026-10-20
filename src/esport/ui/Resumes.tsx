/**
 * Module « Résumés de réunions » de l'Esport (phase 3).
 *
 *  - Membre : déposer une réunion (lien, type, date, titre, note), suivre
 *    ses dépôts, ouvrir ou télécharger le PDF quand le résumé est prêt ;
 *    bibliothèque des résumés lisibles de la team.
 *  - Rédacteur (Fondateur, rôles avec `meeting_summaries.write_summary`) :
 *    boîte de réception (toutes les teams accessibles, ou celle de la page),
 *    filtres et tri, « Nouveau » / « Vu », statuts, dépôt et remplacement du
 *    PDF (Terminé automatiquement), historique des versions ; types de
 *    réunion et leur visibilité.
 *
 * Les droits sont vérifiés par le serveur ; l'interface n'affiche que ce
 * qu'il permet. Le PDF s'ouvre par un lien signé valable quelques minutes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { Boite, ClientEsport, Depot, DetailDepot, DetailTeam, FiltresBoite, StatutDepot, TypeReunion } from '../client';
import { LIBELLES_STATUT_DEPOT, aujourdhui, dateCourte, dateJour, lireDateSaisie, tailleLisible } from '../libelles';
import { choisirPdf, choixPdfDisponible } from './choixPdf';
import { ouvrirLienDiffere } from './ouvrirLien';
import { ChampNote } from './ChampNote';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles, useAgir, Intertitre, Panneau } from './commun';
import { NoteMarkdown } from './review/Note';
import { Carte, ESP, EnTetePage, EtatVide, Onglets } from './design';

type VueResumes = 'deposer' | 'miens' | 'bibliotheque' | 'boite' | 'types';

const COULEURS_STATUT = (theme: ThemeHub): Record<StatutDepot, string> => ({ a_resumer: theme.alerte, en_cours: theme.accent, termine: theme.ok });

export function PastilleStatut({ theme, statut, testID }: { theme: ThemeHub; statut: StatutDepot; testID?: string }) {
  return <PastilleRole theme={theme} nom={LIBELLES_STATUT_DEPOT[statut]} couleur={COULEURS_STATUT(theme)[statut]} testID={testID} />;
}

export function BadgeNouveau({ theme, testID }: { theme: ThemeHub; testID?: string }) {
  return (
    <Text testID={testID} style={{ color: theme.surAccent, backgroundColor: theme.accent, fontSize: 11, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' }}>
      Nouveau
    </Text>
  );
}

/** Ouvre le PDF (lien signé, quelques minutes) dans le lecteur du système. */
export function ouvrirPdf(client: ClientEsport, teamId: string, depotId: string, options: { fichierId?: string; telecharger?: boolean } = {}) {
  return ouvrirLienDiffere(async () => (await client.lienPdf(teamId, depotId, options)).url);
}

/** Libellés courts des vues (iPhone). */
const COURTS_RESUMES: Partial<Record<VueResumes, string>> = { boite: 'Boîte', types: 'Types', bibliotheque: 'Résumés', miens: 'Mes dépôts' };

export function SectionResumes({ theme, client, detail, large }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; large: boolean }) {
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const redacteur = peut('meeting_summaries.write_summary');
  const options = useMemo(() => {
    const o: Array<readonly [VueResumes, string]> = [];
    if (peut('meeting_summaries.submit')) o.push(['deposer', 'Déposer'], ['miens', 'Mes dépôts']);
    if (peut('meeting_summaries.view_summary') || peut('meeting_summaries.view_all') || redacteur) o.push(['bibliotheque', 'Résumés']);
    if (redacteur || peut('meeting_summaries.view_all')) o.push(['boite', 'Boîte de réception']);
    if (redacteur) o.push(['types', 'Types de réunion']);
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const [vue, setVue] = useState<VueResumes>(options[0]?.[0] ?? 'bibliotheque');
  const active = options.some(o => o[0] === vue) ? vue : (options[0]?.[0] ?? 'bibliotheque');
  return (
    <View style={{ gap: ESP.l }} testID="esport-resumes">
      <EnTetePage
        theme={theme}
        large={large}
        titre="Résumés de réunions"
        sous="Déposez l’enregistrement d’une réunion : le résumé en PDF arrive ici dès qu’il est prêt."
        action={
          options.some(o => o[0] === 'deposer') && active !== 'deposer' ? (
            <BoutonHub theme={theme} titre="+ Déposer une réunion" variante="plein" onPress={() => setVue('deposer')} testID="esport-resumes-nouveau" />
          ) : undefined
        }
      />
      {options.length > 1 ? (
        <Onglets
          theme={theme}
          prefixe="esport-resumes-vue"
          actif={active}
          defilant={!large && options.length > 3}
          pleineLargeur={!large && options.length <= 3}
          onChoisir={v => setVue(v as VueResumes)}
          entrees={options.map(([id, nom]) => ({ id, libelle: large ? nom : (COURTS_RESUMES[id] ?? nom), description: nom }))}
        />
      ) : null}
      {options.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="✎" titre="Pas d’accès aux résumés" texte="Votre rôle ne donne pas accès aux résumés de réunions de cette team." />
        </Carte>
      ) : null}
      {active === 'deposer' ? <FormulaireDepot theme={theme} client={client} teamId={detail.team.id} onDepose={() => setVue('miens')} /> : null}
      {active === 'miens' ? <MesDepots theme={theme} client={client} teamId={detail.team.id} /> : null}
      {active === 'bibliotheque' ? <Bibliotheque theme={theme} client={client} teamId={detail.team.id} /> : null}
      {active === 'boite' ? <BoiteResumes theme={theme} client={client} large={large} teamFixe={detail.team.id} /> : null}
      {active === 'types' ? <TypesReunion theme={theme} client={client} teamId={detail.team.id} superAdmin={detail.moi.superAdmin} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Membre

function FormulaireDepot({ theme, client, teamId, onDepose }: { theme: ThemeHub; client: ClientEsport; teamId: string; onDepose(): void }) {
  const [types, setTypes] = useState<TypeReunion[]>([]);
  const [lien, setLien] = useState('');
  const [typeId, setTypeId] = useState<string | undefined>();
  const [date, setDate] = useState(dateJour(aujourdhui()));
  const [titre, setTitre] = useState('');
  const [note, setNote] = useState('');
  const { enCours, erreur, avis, agir, setErreur } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const t = await client.typesReunion(teamId);
      setTypes(t);
      setTypeId(prec => prec ?? t[0]?.id);
    });
  }, [agir, client, teamId]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const type = types.find(t => t.id === typeId);
  return (
    <Panneau theme={theme} style={{ maxWidth: 820 }} testID="esport-depot-formulaire">
      <Intertitre theme={theme}>Nouveau dépôt</Intertitre>
      <Champ theme={theme} libelle="Lien de l’enregistrement" valeur={lien} onChanger={setLien} placeholder="https://…" maxLength={500} testID="esport-depot-lien" />
      <Choix theme={theme} libelle="Type de réunion" valeur={typeId} options={types.map(t => ({ id: t.id, nom: t.visibilite === 'staff' && !/staff/i.test(t.nom) ? `${t.nom} (staff)` : t.nom, couleur: t.couleur }))} onChoisir={setTypeId} testID="esport-depot-type" />
      {type?.visibilite === 'staff' ? <Text style={attenue}>Résumé visible du staff seulement (et de vous).</Text> : null}
      <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
        <Champ theme={theme} libelle="Date (JJ/MM/AAAA)" valeur={date} onChanger={setDate} maxLength={10} testID="esport-depot-date" style={{ minWidth: 160 }} />
        <Champ theme={theme} libelle="Titre" valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-depot-titre" style={{ flex: 1, minWidth: 220 }} />
      </View>
      <ChampNote theme={theme} libelle="Note (facultative)" valeur={note} onChanger={setNote} maxLength={2000} testID="esport-depot-note" />
      <BoutonHub
        theme={theme}
        titre={enCours === 'Dépôt' ? 'Envoi…' : 'Déposer la réunion'}
        variante="plein"
        desactive={Boolean(enCours) || !lien.trim() || titre.trim().length < 2 || !typeId}
        onPress={() => {
          const iso = lireDateSaisie(date);
          if (!iso) {
            setErreur('Date : JJ/MM/AAAA.');
            return;
          }
          void agir('Dépôt', async () => {
            await client.deposerReunion(teamId, { lien: lien.trim(), typeId: typeId!, dateReunion: iso, titre: titre.trim(), note: note.trim() || undefined });
            setLien('');
            setTitre('');
            setNote('');
            onDepose();
            return 'Réunion déposée : le rédacteur est prévenu.';
          });
        }}
        testID="esport-depot-envoyer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-depot" />
    </Panneau>
  );
}

function LigneDepot({
  theme,
  depot,
  onOuvrirPdf,
  onSupprimer,
  avecDeposant,
}: {
  theme: ThemeHub;
  depot: Depot;
  onOuvrirPdf?(telecharger: boolean): void;
  onSupprimer?(): void;
  avecDeposant?: boolean;
}) {
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8, gap: 4 }} testID={`esport-depot-${depot.id}`}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontWeight: '700', flexShrink: 1, ...police(theme.policeTexte) }}>{depot.titre}</Text>
        <PastilleStatut theme={theme} statut={depot.statut} testID={`esport-depot-statut-${depot.id}`} />
      </View>
      <Text style={attenue}>
        {depot.type?.nom ?? 'Type supprimé'} · réunion du {dateJour(depot.dateReunion)}
        {avecDeposant ? ` · déposé par ${depot.deposePar.pseudo ?? 'un compte supprimé'}` : ` · déposé le ${dateCourte(depot.creeLe)}`}
      </Text>
      {onOuvrirPdf || onSupprimer ? (
        <View style={styles.ligne}>
          {onOuvrirPdf && depot.resume ? (
            <>
              <BoutonHub theme={theme} titre="Ouvrir le PDF" variante="plein" onPress={() => onOuvrirPdf(false)} testID={`esport-depot-pdf-${depot.id}`} />
              <BoutonHub theme={theme} titre="Télécharger" onPress={() => onOuvrirPdf(true)} testID={`esport-depot-telecharger-${depot.id}`} />
            </>
          ) : null}
          {onSupprimer ? <BoutonConfirme theme={theme} titre="Retirer" confirmation="Oui, retirer ce dépôt" onConfirme={onSupprimer} testID={`esport-depot-retirer-${depot.id}`} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function MesDepots({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const [depots, setDepots] = useState<Depot[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(() => agir('', async () => setDepots(await client.mesDepots(teamId))), [agir, client, teamId]);
  useEffect(() => {
    void charger();
  }, [charger]);
  return (
    <Panneau theme={theme} testID="esport-mes-depots">
      <Intertitre theme={theme}>Mes dépôts</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-mes-depots" />
      {depots?.length === 0 ? <Text style={{ color: theme.attenue }}>Aucun dépôt pour l’instant.</Text> : null}
      {depots?.map(d => (
        <LigneDepot
          key={d.id}
          theme={theme}
          depot={d}
          onOuvrirPdf={telecharger => void agir('PDF', () => ouvrirPdf(client, teamId, d.id, { telecharger }))}
          onSupprimer={
            d.statut === 'a_resumer'
              ? () =>
                  void agir('Retrait', async () => {
                    await client.supprimerDepot(teamId, d.id);
                    setDepots(await client.mesDepots(teamId));
                    return 'Dépôt retiré.';
                  })
              : undefined
          }
        />
      ))}
    </Panneau>
  );
}

function Bibliotheque({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const [resumes, setResumes] = useState<Depot[] | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setResumes(await client.resumesTeam(teamId, 50)));
  }, [agir, client, teamId]);
  return (
    <Panneau theme={theme} testID="esport-bibliotheque">
      <Intertitre theme={theme}>Résumés de la team</Intertitre>
      <Retours theme={theme} erreur={erreur} prefixe="esport-bibliotheque" />
      {resumes?.length === 0 ? <Text style={{ color: theme.attenue }}>Aucun résumé publié pour l’instant.</Text> : null}
      {resumes?.map(d => (
        <LigneDepot key={d.id} theme={theme} depot={d} avecDeposant onOuvrirPdf={telecharger => void agir('PDF', () => ouvrirPdf(client, teamId, d.id, { telecharger }))} />
      ))}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Rédacteur

const OPTIONS_STATUT: ReadonlyArray<readonly ['' | StatutDepot, string]> = [
  ['', 'Tous'],
  ['a_resumer', 'À résumer'],
  ['en_cours', 'En cours'],
  ['termine', 'Terminé'],
];
const OPTIONS_TRI: ReadonlyArray<readonly [NonNullable<FiltresBoite['tri']>, string]> = [
  ['recent', 'Plus récents'],
  ['ancien', 'Plus anciens'],
  ['statut', 'Par statut'],
  ['date', 'Date de réunion'],
];

/**
 * Boîte de réception du rédacteur : toutes les teams accessibles (ou
 * `teamFixe`), filtres, tri, compteurs ; le détail s'ouvre à côté (PC) ou
 * en dessous (téléphone) et marque le dépôt « Vu ».
 */
export function BoiteResumes({ theme, client, large, teamFixe, onCompteurs }: { theme: ThemeHub; client: ClientEsport; large: boolean; teamFixe?: string; onCompteurs?(b: Boite): void }) {
  const [filtres, setFiltres] = useState<FiltresBoite>({ tri: 'recent' });
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [boite, setBoite] = useState<Boite | undefined>();
  const [ouvert, setOuvert] = useState<{ teamId: string; id: string } | undefined>();
  const { enCours, erreur, agir, setErreur } = useAgir();
  // Rappel du parent gardé dans une référence : une fonction recréée à chaque rendu ne relance pas le chargement.
  const rappel = useRef(onCompteurs);
  rappel.current = onCompteurs;

  const charger = useCallback(
    () =>
      agir('Boîte', async () => {
        const b = await client.boiteResumes({ ...filtres, team: teamFixe ?? filtres.team });
        setBoite(b);
        rappel.current?.(b);
      }),
    [agir, client, filtres, teamFixe],
  );
  useEffect(() => {
    void charger();
  }, [charger]);

  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const appliquerDates = () => {
    const d = du.trim() ? lireDateSaisie(du) : undefined;
    const a = au.trim() ? lireDateSaisie(au) : undefined;
    if ((du.trim() && !d) || (au.trim() && !a)) {
      setErreur('Dates : JJ/MM/AAAA.');
      return;
    }
    setFiltres(f => ({ ...f, du: d, au: a }));
  };

  const liste = (
    <View style={{ gap: 12, flex: large && ouvert ? 1 : undefined, minWidth: 0 }}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontSize: 16, fontWeight: '800', ...police(theme.policeTitre) }} testID="esport-boite-compteur">
          {boite ? `${boite.attente} en attente · ${boite.nouveaux} nouveau${boite.nouveaux > 1 ? 'x' : ''}` : 'Boîte de réception'}
        </Text>
        <BoutonHub theme={theme} titre={enCours === 'Boîte' ? 'Actualisation…' : 'Actualiser'} onPress={() => void charger()} testID="esport-boite-actualiser" />
      </View>
      <Panneau theme={theme} testID="esport-boite-filtres">
        <Segments theme={theme} libelle="Statut" valeur={filtres.statut ?? ''} options={OPTIONS_STATUT} onChoisir={v => setFiltres(f => ({ ...f, statut: v || undefined }))} testID="esport-boite-statut" />
        {!teamFixe && (boite?.teams.length ?? 0) > 1 ? (
          <Choix
            theme={theme}
            libelle="Team"
            valeur={filtres.team ?? ''}
            options={[{ id: '', nom: 'Toutes' }, ...(boite?.teams ?? []).map(t => ({ id: t.id, nom: t.nom }))]}
            onChoisir={v => setFiltres(f => ({ ...f, team: v || undefined }))}
            testID="esport-boite-team"
          />
        ) : null}
        {(boite?.types.length ?? 0) > 0 ? (
          <Choix
            theme={theme}
            libelle="Type"
            valeur={filtres.type ?? ''}
            options={[{ id: '', nom: 'Tous' }, ...(boite?.types ?? []).map(t => ({ id: t.id, nom: t.nom, couleur: t.couleur }))]}
            onChoisir={v => setFiltres(f => ({ ...f, type: v || undefined }))}
            testID="esport-boite-type"
          />
        ) : null}
        {(boite?.deposants.length ?? 0) > 1 ? (
          <Choix
            theme={theme}
            libelle="Déposant"
            valeur={filtres.deposePar ?? ''}
            options={[{ id: '', nom: 'Tous' }, ...(boite?.deposants ?? []).map(d => ({ id: d.compte, nom: d.pseudo ?? 'Compte supprimé' }))]}
            onChoisir={v => setFiltres(f => ({ ...f, deposePar: v || undefined }))}
            testID="esport-boite-deposant"
          />
        ) : null}
        <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle="Du (JJ/MM/AAAA)" valeur={du} onChanger={setDu} maxLength={10} testID="esport-boite-du" style={{ width: 150 }} />
          <Champ theme={theme} libelle="Au" valeur={au} onChanger={setAu} maxLength={10} testID="esport-boite-au" style={{ width: 150 }} />
          <BoutonHub theme={theme} titre="Appliquer" onPress={appliquerDates} testID="esport-boite-dates" />
        </View>
        <View style={styles.ligne}>
          <Case theme={theme} coche={Boolean(filtres.nouveaux)} libelle="Nouveaux seulement" onChanger={v => setFiltres(f => ({ ...f, nouveaux: v || undefined }))} testID="esport-boite-nouveaux" />
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>Nouveaux seulement</Text>
        </View>
        <Segments theme={theme} libelle="Tri" valeur={filtres.tri ?? 'recent'} options={OPTIONS_TRI} onChoisir={tri => setFiltres(f => ({ ...f, tri }))} testID="esport-boite-tri" />
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-boite" />
      <View style={{ gap: 8 }} testID="esport-boite-liste">
        {boite?.depots.length === 0 ? <Text style={attenue}>Aucun dépôt ne correspond.</Text> : null}
        {boite?.depots.map(d => {
          const choisi = ouvert?.id === d.id;
          return (
            <Pressable
              key={d.id}
              testID={`esport-boite-depot-${d.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir ${d.titre}`}
              onPress={() => setOuvert({ teamId: d.team.id, id: d.id })}
              style={{
                borderWidth: 1,
                borderColor: choisi ? theme.accent : theme.ligne,
                backgroundColor: choisi ? teinteTransparente(theme.accent, 0.1) : theme.surface,
                borderRadius: Math.min(theme.rayonMoyen, 12),
                padding: 12,
                gap: 4,
              }}>
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <View style={[styles.ligne, { flexShrink: 1 }]}>
                  {d.nouveau ? <BadgeNouveau theme={theme} testID={`esport-boite-nouveau-${d.id}`} /> : null}
                  <Text style={{ color: theme.texte, fontWeight: d.nouveau ? '800' : '600', flexShrink: 1, ...police(theme.policeTexte) }}>{d.titre}</Text>
                </View>
                <PastilleStatut theme={theme} statut={d.statut} />
              </View>
              <Text style={attenue}>
                {teamFixe ? '' : `${d.team.nom ?? 'Team'} · `}
                {d.type?.nom ?? 'Type supprimé'} · {dateJour(d.dateReunion)} · {d.deposePar.pseudo ?? 'Compte supprimé'} · déposé le {dateCourte(d.creeLe)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const detail = ouvert ? (
    <DetailDepotRedacteur
      key={ouvert.id}
      theme={theme}
      client={client}
      teamId={ouvert.teamId}
      depotId={ouvert.id}
      onChange={() => void charger()}
      onFermer={() => setOuvert(undefined)}
    />
  ) : null;

  return (
    <View testID="esport-boite" style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
      {liste}
      {detail ? <View style={large ? { flex: 1, minWidth: 0 } : undefined}>{detail}</View> : null}
    </View>
  );
}

function DetailDepotRedacteur({
  theme,
  client,
  teamId,
  depotId,
  onChange,
  onFermer,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  teamId: string;
  depotId: string;
  onChange(): void;
  onFermer(): void;
}) {
  const [d, setD] = useState<DetailDepot | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const lu = await client.depot(teamId, depotId);
      // Ouvrir un dépôt « Nouveau » le marque « Vu » (rédacteur seulement).
      if (lu.nouveau && lu.moi.redacteur) {
        setD(await client.marquerVu(teamId, depotId));
        onChange();
      } else setD(lu);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, client, teamId, depotId]);
  if (!d) return <Retours theme={theme} erreur={erreur} prefixe="esport-detail-depot" />;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const changer = (statut: StatutDepot) =>
    void agir('Statut', async () => {
      setD(await client.changerStatutDepot(teamId, depotId, statut));
      onChange();
      return `Statut : ${LIBELLES_STATUT_DEPOT[statut]}.`;
    });
  return (
    <Panneau theme={theme} testID="esport-detail-depot">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={[texte, { fontSize: 17, fontWeight: '800', flexShrink: 1 }]}>{d.titre}</Text>
        <BoutonHub theme={theme} titre="Fermer" onPress={onFermer} testID="esport-detail-fermer" />
      </View>
      <View style={styles.ligne}>
        <PastilleStatut theme={theme} statut={d.statut} testID="esport-detail-statut" />
        {d.type ? <PastilleRole theme={theme} nom={d.type.visibilite === 'staff' ? `${d.type.nom} · staff` : d.type.nom} couleur={d.type.couleur} /> : null}
        {d.vu ? <Text style={attenue}>Vu le {dateCourte(d.vu.le)}</Text> : null}
      </View>
      <Text style={attenue}>
        {d.team.nom ?? 'Team'} · réunion du {dateJour(d.dateReunion)} · déposé par {d.deposePar.pseudo ?? 'un compte supprimé'} le {dateCourte(d.creeLe)}
      </Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(d.lien)} testID="esport-detail-lien">
        <Text style={{ color: theme.accent, textDecorationLine: 'underline', ...police(theme.policeTexte) }} numberOfLines={2}>
          {d.lien}
        </Text>
      </Pressable>
      {d.note ? <NoteMarkdown theme={theme} source={d.note} testID="esport-detail-note" /> : null}
      {d.moi.redacteur ? (
        <>
          <Intertitre theme={theme}>Statut</Intertitre>
          <View style={styles.ligne}>
            {(['a_resumer', 'en_cours', 'termine'] as const).map(s => (
              <BoutonHub
                key={s}
                theme={theme}
                titre={LIBELLES_STATUT_DEPOT[s]}
                variante={d.statut === s ? 'plein' : 'normal'}
                desactive={Boolean(enCours) || d.statut === s || (s === 'termine' && !d.resume)}
                onPress={() => changer(s)}
                testID={`esport-detail-statut-${s}`}
              />
            ))}
          </View>
          {!d.resume ? <Text style={attenue}>« Terminé » se pose tout seul au dépôt du PDF.</Text> : null}
          <Intertitre theme={theme}>Résumé en PDF</Intertitre>
          {choixPdfDisponible ? (
            <BoutonHub
              theme={theme}
              titre={enCours === 'PDF' ? 'Envoi du PDF…' : d.resume ? 'Remplacer le PDF' : 'Déposer le PDF'}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('PDF', async () => {
                  const f = await choisirPdf();
                  if (!f) return;
                  if (f.taille > 20 * 1024 * 1024) throw new Error('PDF trop volumineux : 20 Mo au plus.');
                  setD(await client.envoyerPdf(teamId, depotId, f.octets, f.nom));
                  onChange();
                  return d.resume ? 'PDF remplacé (l’ancien reste dans l’historique).' : 'Résumé publié : le déposant est prévenu.';
                })
              }
              testID="esport-detail-pdf"
            />
          ) : (
            <Text style={attenue}>Déposez le PDF depuis le PC ou le site (sélecteur de fichiers).</Text>
          )}
        </>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-detail" />
      {d.fichiers.length > 0 ? (
        <View style={{ gap: 6 }} testID="esport-detail-historique">
          <Intertitre theme={theme}>{d.fichiers.length > 1 ? 'Versions du PDF' : 'PDF'}</Intertitre>
          {d.fichiers.map(f => (
            <View key={f.id} style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]} testID={`esport-detail-fichier-${f.id}`}>
              <Text style={[texte, { flex: 1, minWidth: 160, fontWeight: f.actuel ? '700' : '400' }]}>
                {f.nom} <Text style={attenue}>· {tailleLisible(f.taille)} · {dateCourte(f.le)}{f.actuel ? ' · actuel' : ' · remplacé'}</Text>
              </Text>
              <BoutonHub theme={theme} titre="Ouvrir" onPress={() => void agir('Ouvrir', () => ouvrirPdf(client, teamId, depotId, { fichierId: f.id }))} testID={`esport-detail-ouvrir-${f.id}`} />
            </View>
          ))}
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Types de réunion

function TypesReunion({ theme, client, teamId, superAdmin }: { theme: ThemeHub; client: ClientEsport; teamId: string; superAdmin: boolean }) {
  const [types, setTypes] = useState<TypeReunion[] | undefined>();
  const [nom, setNom] = useState('');
  const [visibilite, setVisibilite] = useState<'team' | 'staff'>('team');
  const { enCours, erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setTypes(await client.typesReunion(teamId)), [client, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-types-reunion">
      <Intertitre theme={theme}>Types de réunion</Intertitre>
      <Text style={attenue}>« Team » : les membres qui lisent les résumés. « Staff » : seulement les rôles qui lisent les réunions staff (et le déposant).</Text>
      {types?.map(t => {
        const modifiable = !t.global || superAdmin;
        return (
          <View key={t.id} style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]} testID={`esport-type-${t.id}`}>
            <PastilleRole theme={theme} nom={t.nom} couleur={t.couleur} />
            <Text style={[attenue, { flex: 1 }]}>{t.global ? 'Commun à toutes les teams' : 'Propre à la team'}</Text>
            {modifiable ? (
              <Segments
                theme={theme}
                libelle={`Visibilité de ${t.nom}`}
                valeur={t.visibilite}
                options={[
                  ['team', 'Team'],
                  ['staff', 'Staff'],
                ]}
                onChoisir={v =>
                  void agir('Type', async () => {
                    await client.modifierTypeReunion(teamId, t.id, { visibilite: v });
                    await recharger();
                    return `${t.nom} : visible ${v === 'staff' ? 'du staff seulement' : 'de la team'}.`;
                  })
                }
                testID={`esport-type-visibilite-${t.id}`}
              />
            ) : (
              <Text style={attenue}>{t.visibilite === 'staff' ? 'Staff' : 'Team'}</Text>
            )}
            {modifiable ? (
              <BoutonConfirme
                theme={theme}
                titre="Supprimer"
                confirmation="Oui"
                onConfirme={() =>
                  void agir('Type', async () => {
                    await client.supprimerTypeReunion(teamId, t.id);
                    await recharger();
                    return `${t.nom} supprimé (les dépôts existants le gardent).`;
                  })
                }
                testID={`esport-type-supprimer-${t.id}`}
              />
            ) : null}
          </View>
        );
      })}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle="Nouveau type" valeur={nom} onChanger={setNom} maxLength={40} testID="esport-type-nom" style={{ flex: 1, minWidth: 180 }} />
        <Segments
          theme={theme}
          libelle="Visibilité"
          valeur={visibilite}
          options={[
            ['team', 'Team'],
            ['staff', 'Staff'],
          ]}
          onChoisir={v => setVisibilite(v as 'team' | 'staff')}
          testID="esport-type-nouvelle-visibilite"
        />
        <BoutonHub
          theme={theme}
          titre="Ajouter"
          variante="plein"
          desactive={Boolean(enCours) || nom.trim().length < 2}
          onPress={() =>
            void agir('Type', async () => {
              await client.creerTypeReunion(teamId, { nom: nom.trim(), visibilite });
              setNom('');
              await recharger();
              return 'Type ajouté.';
            })
          }
          testID="esport-type-ajouter"
        />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-types" />
    </Panneau>
  );
}
