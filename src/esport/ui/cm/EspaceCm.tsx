/**
 * Espace CM du club (carte « CM du club » en tête de la page Teams de l'Esport) : tableaux (club et teams), file « À
 * valider », calendrier éditorial, clips des joueurs, visuels (modèles, charte, éditeur ; docs/esport/visuels.md), et pour le gestionnaire (cm.gerer) : équipe et rôles
 * CM, import Trello, réglages (suggestions automatiques), journal de la section. Page « Réseaux » (comptes, bot
 * d'annonce Discord, statistiques ; docs/esport/reseaux-stats.md) pour qui voit la section CM. Drive (dossiers et fichiers du
 * club et des teams ; docs/esport/drive.md) pour qui a un droit cm.drive.*. Rubrique « Sponsors » pour qui a
 * sponsors.voir (affectation « club ») : seule visible pour un compte qui n'a QUE les Sponsors. Tout est décidé
 * par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiCm, PORTEE_CLUB, voitDrive, type ApiCm, type CarteTransverse, type EntreeJournalCm, type ListeTableaux, type MoiCm, type ReglagesCm, type TeamCm } from '../../cm/api';
import { phraseJournalCm } from '../../cm/libelles';
import { CLES_RESEAUX, RESEAUX } from '../../cm/reseaux';
import { trCm, trnCm, type CleCm } from '../../i18n/cm';
import { tr } from '../../i18n';
import { PageEsport } from '../CadreEsport';
import { Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, Onglets, SqueletteCartes, TitreCarte, Volet, attenue, texte } from '../design';
import { Aide, BadgeStatut, FUSEAU_CLUB, PALETTE, PastilleReseau, Teinte, nomTableau, quand, useEtatCm } from './commun';
import { Tableau } from './Tableau';
import { Calendrier } from './Calendrier';
import { GalerieClips } from './Clips';
import { ImportTrello } from './ImportTrello';
import { RolesCm } from './RolesCm';
import { EspaceSponsors } from '../sponsors/EspaceSponsors';
import { EspaceReseaux } from './reseaux/EspaceReseaux';
import { Visuels } from './visuels/Visuels';
import { trVi } from '../../i18n/visuels';
import { Drive } from './drive/Drive';

export type OngletCm = 'tableaux' | 'valider' | 'calendrier' | 'clips' | 'visuels' | 'drive' | 'reseaux' | 'sponsors' | 'equipe' | 'import' | 'reglages' | 'journal';

export function EspaceCm({
  theme,
  client,
  large,
  moi,
  onExporter,
  ongletInitial,
  avant,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  moi: MoiCm;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Onglet ouvert d'abord (raccourci « Drive » de la carte « CM du club ») ; ignoré s'il n'est pas permis. */
  ongletInitial?: OngletCm;
  /** Au-dessus du titre : le lien de retour vers Teams. */
  avant?: React.ReactNode;
}) {
  const api = useMemo(() => apiCm(client), [client]);
  // Rubrique Sponsors (migration 0024) : permissions du club, indépendantes de la section CM.
  const voirCm = moi.club.includes('cm.voir') || moi.teams.some(t => t.permissions.includes('cm.voir'));
  const sponsors = Boolean(moi.sponsors?.includes('sponsors.voir'));
  // Drive (migration 0027) : du club ou d'une team, pour qui y a un droit (un compte peut n'avoir QUE le Drive).
  const drive = voitDrive(moi.club) || moi.teams.some(t => voitDrive(t.permissions));
  const [onglet, setOnglet] = useState<OngletCm>(() => {
    const permis: Partial<Record<OngletCm, boolean>> = { drive, sponsors, equipe: moi.gerer, import: moi.gerer, reglages: moi.gerer, journal: moi.gerer };
    if (ongletInitial && (permis[ongletInitial] ?? voirCm)) return ongletInitial;
    return voirCm ? 'tableaux' : drive ? 'drive' : sponsors ? 'sponsors' : 'tableaux';
  });
  const [ouvert, setOuvert] = useState<string | undefined>();
  const { etat } = useEtatCm(api, voirCm);
  const teams: TeamCm[] = moi.teams;
  const entrees = [
    ...(voirCm
      ? [
          { id: 'tableaux', libelle: trCm('espace.tableaux') },
          { id: 'valider', libelle: etat?.aValider ? trCm('espace.valider_n', { n: etat.aValider }) : trCm('espace.valider') },
          { id: 'calendrier', libelle: trCm('espace.calendrier') },
          { id: 'clips', libelle: trCm('espace.clips') },
          { id: 'visuels', libelle: trVi('espace.titre') },
        ]
      : []),
    ...(drive ? [{ id: 'drive', libelle: trCm('espace.drive') }] : []),
    // Page Réseaux (migration 0026) : comptes, annonce Discord des posts publiés, statistiques.
    ...(voirCm ? [{ id: 'reseaux', libelle: trCm('espace.reseaux') }] : []),
    ...(sponsors ? [{ id: 'sponsors', libelle: trCm('espace.sponsors') }] : []),
    ...(moi.gerer
      ? [
          { id: 'equipe', libelle: trCm('espace.equipe') },
          { id: 'import', libelle: trCm('espace.import') },
          { id: 'reglages', libelle: trCm('espace.reglages') },
          { id: 'journal', libelle: trCm('espace.journal') },
        ]
      : []),
  ];
  return (
    <PageEsport large={large} testID="esport-cm" largeur={1600}>
      <EnTetePage theme={theme} large={large} titre={trCm('espace.titre')} sous={trCm('espace.sous')} avant={avant} />
      <Onglets theme={theme} prefixe="esport-cm-onglet" testID="esport-cm-onglets" actif={onglet} onChoisir={id => setOnglet(id as OngletCm)} entrees={entrees} defilant={!large} />
      {onglet === 'sponsors' && sponsors ? (
        <EspaceSponsors
          theme={theme}
          client={client}
          large={large}
          gerer={Boolean(moi.sponsors?.includes('sponsors.gerer'))}
          teams={teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))}
          onExporter={onExporter}
          onOuvrirTableau={id => {
            setOuvert(id);
            setOnglet('tableaux');
          }}
        />
      ) : null}
      {onglet === 'tableaux' && voirCm ? (
        ouvert ? (
          <Tableau theme={theme} api={api} id={ouvert} large={large} teams={teams} versionServeur={etat?.versions[ouvert]} onRetour={() => setOuvert(undefined)} />
        ) : (
          <ListeTableauxCm theme={theme} api={api} large={large} onOuvrir={setOuvert} />
        )
      ) : null}
      {onglet === 'valider' ? <FileValidation theme={theme} api={api} large={large} version={etat?.aValider} onOuvrir={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'calendrier' ? <Calendrier theme={theme} api={api} large={large} onOuvrirTableau={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'clips' ? <GalerieClips theme={theme} api={api} large={large} teams={teams} /> : null}
      {onglet === 'reseaux' && voirCm ? <EspaceReseaux theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'visuels' && voirCm ? <Visuels theme={theme} apiCm={api} large={large} moi={moi} /> : null}
      {onglet === 'drive' && drive ? (
        <Drive
          theme={theme}
          client={client}
          large={large}
          onOuvrirTableau={
            voirCm
              ? id => {
                  setOuvert(id);
                  setOnglet('tableaux');
                }
              : undefined
          }
        />
      ) : null}
      {onglet === 'equipe' && moi.gerer ? <RolesCm theme={theme} api={api} large={large} /> : null}
      {onglet === 'import' && moi.gerer ? <ImportTrello theme={theme} api={api} large={large} onOuvrir={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'reglages' && moi.gerer ? <Reglages theme={theme} api={api} /> : null}
      {onglet === 'journal' && moi.gerer ? <JournalCm theme={theme} api={api} /> : null}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Tableaux

function ListeTableauxCm({ theme, api, large, onOuvrir }: { theme: ThemeHub; api: ApiCm; large: boolean; onOuvrir(id: string): void }) {
  const [liste, setListe] = useState<ListeTableaux | undefined>();
  const [archives, setArchives] = useState(false);
  const [nouveau, setNouveau] = useState<{ nom: string; portee: string; couleur: string; modele: 'vide' | 'contenus' } | undefined>();
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<CarteTransverse[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setListe(await api.tableaux(archives)), [api, archives]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const gerables = liste?.portees.filter(p => p.permissions.includes('cm.gerer')) ?? [];
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-tableaux">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-tableaux" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Champ theme={theme} libelle={trCm('espace.rechercher')} valeur={q} onChanger={setQ} maxLength={80} testID="esport-cm-recherche" style={{ flex: 1, minWidth: 220 }} />
        <BoutonHub theme={theme} titre={trCm('espace.chercher')} desactive={q.trim().length < 2} onPress={() => void agir('recherche', async () => setResultats((await api.recherche(q.trim())).cartes))} testID="esport-cm-recherche-ok" />
        {gerables.length ? <BoutonHub theme={theme} titre={trCm('espace.nouveau_tableau')} variante="plein" onPress={() => setNouveau({ nom: '', portee: gerables[0].portee, couleur: PALETTE[5][0], modele: 'contenus' })} testID="esport-cm-tableau-nouveau" /> : null}
        <BoutonHub theme={theme} titre={archives ? trCm('tableau.masquer_archives') : trCm('tableau.voir_archives')} onPress={() => setArchives(a => !a)} testID="esport-cm-tableaux-archives" />
      </View>
      {resultats ? (
        <Carte theme={theme} testID="esport-cm-recherche-resultats">
          <TitreCarte theme={theme} titre={trnCm('espace.resultats', resultats.length)} droite={<BoutonHub theme={theme} titre={trCm('c.fermer')} onPress={() => setResultats(undefined)} testID="esport-cm-recherche-fermer" />} />
          {resultats.map(c => (
            <BoutonHub key={c.id} theme={theme} titre={`${c.titre} · ${c.tableau ? nomTableau(c.tableau) : ''}`} onPress={() => onOuvrir(c.tableauId)} testID={`esport-cm-recherche-${c.id}`} />
          ))}
        </Carte>
      ) : null}
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.tableaux.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="▦" titre={trCm('espace.aucun_tableau')} texte={trCm('espace.aucun_tableau_texte')} />
        </Carte>
      ) : null}
      {liste?.tableaux.length ? (
        <Grille min={large ? 280 : 240} testID="esport-cm-tableaux-liste">
          {liste.tableaux.map(t => (
            <Carte key={t.id} theme={theme} dense accent={t.couleur} onPress={() => onOuvrir(t.id)} libelle={trCm('espace.ouvrir_tableau', { nom: nomTableau(t) })} testID={`esport-cm-tableau-${t.cleDefaut && !t.team ? 'club' : t.id}`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {nomTableau(t)}
              </Text>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Badge theme={theme} ton={t.team ? 'neutre' : 'accent'} texte={t.team ? (t.team.nom ?? '') : trCm('portee.club')} />
                <Badge theme={theme} texte={trnCm('espace.cartes_n', t.cartes ?? 0)} />
                {t.aValider ? <Badge theme={theme} ton="alerte" texte={trnCm('espace.a_valider_n', t.aValider)} /> : null}
                {t.trello ? <Badge theme={theme} texte="Trello" /> : null}
                {t.archive ? <Badge theme={theme} ton="alerte" texte={trCm('c.archive')} /> : null}
              </View>
            </Carte>
          ))}
        </Grille>
      ) : null}
      {nouveau ? (
        <Volet theme={theme} visible titre={trCm('espace.nouveau_tableau')} onFermer={() => setNouveau(undefined)} testID="esport-cm-tableau-volet">
          <Champ theme={theme} libelle={trCm('c.nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={80} testID="esport-cm-tableau-nom" />
          <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('espace.portee')}>
            {gerables.map(p => (
              <BoutonHub key={p.portee} theme={theme} titre={p.team ? (p.team.nom ?? '') : trCm('portee.club')} variante={nouveau.portee === p.portee ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, portee: p.portee })} testID={`esport-cm-tableau-portee-${p.portee === PORTEE_CLUB ? 'club' : p.portee}`} />
            ))}
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub theme={theme} titre={trCm('espace.modele_contenus')} variante={nouveau.modele === 'contenus' ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, modele: 'contenus' })} testID="esport-cm-tableau-modele-contenus" />
            <BoutonHub theme={theme} titre={trCm('espace.modele_vide')} variante={nouveau.modele === 'vide' ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, modele: 'vide' })} testID="esport-cm-tableau-modele-vide" />
          </View>
          <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('c.couleur')}>
            {PALETTE.map(([couleur, cle]) => (
              <Teinte key={couleur} theme={theme} couleur={couleur} choisie={nouveau.couleur === couleur} libelle={trCm(cle)} onPress={() => setNouveau({ ...nouveau, couleur })} />
            ))}
          </View>
          <BoutonHub
            theme={theme}
            titre={trCm('c.creer')}
            variante="plein"
            desactive={!nouveau.nom.trim()}
            onPress={() =>
              void agir('creer', async () => {
                const d = await api.creerTableau({ nom: nouveau.nom.trim(), portee: nouveau.portee, couleur: nouveau.couleur, modele: nouveau.modele });
                setNouveau(undefined);
                onOuvrir(d.tableau.id);
              })
            }
            testID="esport-cm-tableau-creer"
          />
        </Volet>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ À valider

function FileValidation({ theme, api, large, version, onOuvrir }: { theme: ThemeHub; api: ApiCm; large: boolean; version?: number; onOuvrir(tableauId: string): void }) {
  const [cartes, setCartes] = useState<CarteTransverse[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string | null>>({});
  const [refus, setRefus] = useState<{ id: string; motif: string } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const r = await api.aValider();
    setCartes(r.cartes);
    setNoms(r.noms);
  }, [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger, version]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-valider">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-valider" />
      {cartes && !cartes.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="✓" titre={trCm('valider.vide')} texte={trCm('valider.vide_texte')} />
        </Carte>
      ) : null}
      {cartes?.map(c => (
        <Carte key={c.id} theme={theme} testID={`esport-cm-valider-${c.id}`}>
          <TitreCarte theme={theme} titre={c.titre} sous={[c.tableau ? nomTableau(c.tableau) : '', c.team?.nom ?? '', c.soumisPar ? trCm('valider.par', { qui: noms[c.soumisPar] ?? '?' }) : '', c.datePublication ? trCm('carte.publication_le', { date: quand(c.datePublication) }) : ''].filter(Boolean).join(' · ')} droite={<BadgeStatut theme={theme} statut={c.statut} />} />
          {c.reseaux.map(r => (
            <View key={r} style={{ gap: 4 }}>
              <PastilleReseau theme={theme} reseau={r} />
              <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.s }}>
                {(['fr', 'en'] as const).map(l => (
                  <Text key={l} selectable style={{ ...texte(theme, 14), flex: large ? 1 : undefined }}>{`${l.toUpperCase()} · ${c.textes?.[r]?.[l] || '—'}`}</Text>
                ))}
              </View>
            </View>
          ))}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            {c.droits.valider ? (
              <BoutonHub
                theme={theme}
                titre={trCm('circuit.valider')}
                variante="plein"
                onPress={() =>
                  void agir('valider', async () => {
                    await api.valider(c.id, { versionAttendue: c.version });
                    await charger();
                    return trCm('circuit.valide');
                  })
                }
                testID={`esport-cm-valider-${c.id}-ok`}
              />
            ) : null}
            {c.droits.valider ? <BoutonHub theme={theme} titre={trCm('circuit.refuser')} onPress={() => setRefus({ id: c.id, motif: '' })} testID={`esport-cm-valider-${c.id}-refuser`} /> : null}
            <BoutonHub theme={theme} titre={trCm('valider.ouvrir')} onPress={() => onOuvrir(c.tableauId)} testID={`esport-cm-valider-${c.id}-ouvrir`} />
          </View>
          {refus?.id === c.id ? (
            <View style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trCm('circuit.motif')} valeur={refus.motif} onChanger={motif => setRefus({ id: c.id, motif })} multiligne maxLength={1000} testID={`esport-cm-valider-${c.id}-motif`} />
              <BoutonHub
                theme={theme}
                titre={trCm('circuit.confirmer_refus')}
                variante="danger"
                desactive={refus.motif.trim().length < 2}
                onPress={() =>
                  void agir('refuser', async () => {
                    await api.refuser(c.id, refus.motif.trim());
                    setRefus(undefined);
                    await charger();
                  })
                }
                testID={`esport-cm-valider-${c.id}-refus-ok`}
              />
            </View>
          ) : null}
        </Carte>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Réglages

function Reglages({ theme, api }: { theme: ThemeHub; api: ApiCm }) {
  const [r, setR] = useState<ReglagesCm | undefined>();
  const [hashtags, setHashtags] = useState('');
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const x = await api.reglages();
      setR(x);
      setHashtags(x.suggestions.hashtags);
    });
  }, [agir, api]);
  if (!r) return <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reglages" />;
  const s = r.suggestions;
  const changer = (x: Partial<ReglagesCm['suggestions']>) => void agir('reglages', async () => setR(await api.changerReglages({ suggestions: x })));
  return (
    <Carte theme={theme} testID="esport-cm-reglages">
      <TitreCarte theme={theme} titre={trCm('reglages.suggestions')} sous={trCm('reglages.suggestions_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reglages" />
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={texte(theme)}>{trCm('reglages.actives')}</Text>
        <Interrupteur theme={theme} libelle={trCm('reglages.actives')} valeur={s.actif} onChanger={actif => changer({ actif })} testID="esport-cm-reglages-actif" />
      </View>
      {(['tournoi', 'j1', 'jourj', 'resultat', 'final'] as const).map(t => (
        <View key={t} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={texte(theme)}>{trCm(`reglages.type.${t}` as CleCm)}</Text>
          <Interrupteur theme={theme} libelle={trCm(`reglages.type.${t}` as CleCm)} valeur={s.types[t]} desactive={!s.actif} onChanger={v => changer({ types: { ...s.types, [t]: v } })} testID={`esport-cm-reglages-${t}`} />
        </View>
      ))}
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('reglages.reseaux')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {CLES_RESEAUX.map(rs => (
          <PastilleReseau key={rs} theme={theme} reseau={rs} actif={s.reseaux.includes(rs)} onPress={() => changer({ reseaux: s.reseaux.includes(rs) ? s.reseaux.filter(x => x !== rs) : [...s.reseaux, rs] })} testID={`esport-cm-reglages-reseau-${rs}`} />
        ))}
      </View>
      <Champ theme={theme} libelle={trCm('reglages.hashtags')} valeur={hashtags} onChanger={setHashtags} maxLength={200} placeholder={trCm('reglages.hashtags_exemple')} testID="esport-cm-reglages-hashtags" />
      {hashtags !== s.hashtags ? <BoutonHub theme={theme} titre={trCm('c.enregistrer')} onPress={() => changer({ hashtags })} testID="esport-cm-reglages-hashtags-ok" /> : null}
      <Aide theme={theme}>{trCm('reglages.module_aide', { reseaux: CLES_RESEAUX.map(x => RESEAUX[x].nom).join(', ') })}</Aide>
    </Carte>
  );
}

// ------------------------------------------------------------------ Journal

function JournalCm({ theme, api }: { theme: ThemeHub; api: ApiCm }) {
  const [entrees, setEntrees] = useState<EntreeJournalCm[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string | null>>({});
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const r = await api.journal();
      setEntrees(r.entrees);
      setNoms(r.noms);
    });
  }, [agir, api]);
  return (
    <Carte theme={theme} testID="esport-cm-journal">
      <TitreCarte theme={theme} titre={trCm('espace.journal')} sous={trCm('journal.aide')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-journal" />
      {entrees && !entrees.length ? <Text style={attenue(theme)}>{trCm('journal.vide')}</Text> : null}
      {entrees?.map(e => (
        <Text key={e.id} style={texte(theme, 13)}>
          {`${quand(e.date, FUSEAU_CLUB)} · ${phraseJournalCm(e.action, e.acteur ? (noms[e.acteur] ?? (e.acteur === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.quelquun'), e.meta) ?? e.action}${e.team?.nom ? ` (${e.team.nom})` : ''}`}
        </Text>
      ))}
    </Carte>
  );
}
