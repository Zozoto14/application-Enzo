/**
 * Page « Jeux » de l'Esport (premier niveau, permission globale `jeux.gerer` : le Fondateur et ses
 * délégués) : les PROFILS DE JEU configurés avant la création des teams. Voir docs/esport/profils-jeu.md.
 *
 * Quatre onglets :
 *  - Profils : la liste (formats, maps du pool, personnages, roster, teams), création à la main,
 *    fiche d'un jeu (édition versionnée, historique et restauration, vérification par l'IA, mise à jour
 *    automatique, archivage) ;
 *  - Mises à jour : différences proposées par l'IA (ajout, modification, retrait), avec sources et
 *    confiance, acceptées ou refusées UNE PAR UNE (rien n'est appliqué tout seul) ;
 *  - Assistant IA : « Préparer avec l'IA » (nom du jeu, pages de référence facultatives) → brouillon à
 *    relire et corriger, puis à valider ;
 *  - Administration IA (Fondateur) : fournisseur et modèle détectés, clé présente ou absente (jamais sa
 *    valeur), plafonds mensuels et compteur d'usage, dernier appel, test de connexion, délégations.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport, type ClientEsport, type CompteEsport } from '../../client';
import { dateCourte } from '../../libelles';
import { apiJeux, type ApiJeux, type EtatIa, type Gestionnaire, type JeuListe, type ListeJeux, type ProfilJeu, type PropositionJeu, type TravailIa, type VersionJeu, type ModeIa } from '../../jeux/api';
import { donneesVides, hote, oublierProfilsTeams } from '../../jeux/profil';
import { trJeux, trnJeux } from '../../i18n/jeux';
import { PageEsport } from '../CadreEsport';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, MenuActions, Onglets, SqueletteCartes, TitreCarte, attenue, texte } from '../design';
import { EditeurProfil, libelleChemin, libelleRaison } from './EditeurProfil';

type Onglet = 'profils' | 'maj' | 'ia' | 'admin';
type Vue = { v: 'liste' } | { v: 'nouveau' } | { v: 'fiche'; cle: string } | { v: 'brouillon'; id: string };

/** Message d'une erreur de l'API, avec le chemin et la raison d'un profil invalide. */
function messageErreur(e: unknown): string {
  if (e instanceof ErreurEsport && e.code === 'profil-invalide' && e.details && typeof e.details.chemin === 'string') {
    return trJeux('jeux.profil_invalide', { chemin: libelleChemin(String(e.details.chemin)), raison: libelleRaison(String(e.details.raison ?? '')) });
  }
  if (e instanceof ErreurEsport && e.code === 'version-conflit') return trJeux('jeux.conflit');
  return e instanceof Error ? e.message : String(e);
}

/** Pastille du jeu : son icône n'est pas chargée (site tiers) ; initiales sur sa couleur. */
export function PastilleJeu({ theme, jeu, taille = 40 }: { theme: ThemeHub; jeu: { nom: string; couleur: string }; taille?: number }) {
  const lettres = jeu.nom.split(/\s+/).filter(Boolean).map(m => m[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <View style={{ width: taille, height: taille, borderRadius: taille / 4, backgroundColor: jeu.couleur, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontWeight: '800', fontSize: taille * 0.38, ...police(theme.policeTitre) }}>{lettres}</Text>
    </View>
  );
}

export function Jeux({ theme, client, large, fondateur }: { theme: ThemeHub; client: ClientEsport; large: boolean; fondateur: boolean }) {
  const api = useMemo(() => apiJeux(client), [client]);
  const [onglet, setOnglet] = useState<Onglet>('profils');
  const [vue, setVue] = useState<Vue>({ v: 'liste' });
  const [liste, setListe] = useState<ListeJeux | undefined>();
  const [propositions, setPropositions] = useState<PropositionJeu[] | undefined>();
  const { erreur, avis, agir, setAvis } = useAgir();

  const recharger = useCallback(async () => {
    const [l, p] = await Promise.all([api.liste(true), api.propositions().catch(() => [] as PropositionJeu[])]);
    setListe(l);
    setPropositions(p);
  }, [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const iaDisponible = Boolean(liste?.ia?.disponible);
  const entrees = [
    { id: 'profils', libelle: trJeux('jeux.onglet.profils') },
    { id: 'maj', libelle: propositions?.length ? trJeux('jeux.onglet.maj_n', { n: propositions.length }) : trJeux('jeux.onglet.maj') },
    { id: 'ia', libelle: trJeux('jeux.onglet.ia') },
    ...(fondateur ? [{ id: 'admin', libelle: trJeux('jeux.onglet.admin') }] : []),
  ];
  const retourListe = (message?: string) => {
    setVue({ v: 'liste' });
    oublierProfilsTeams();
    void agir('', async () => {
      await recharger();
      return message;
    });
  };

  let contenu: React.ReactNode;
  if (vue.v === 'nouveau') {
    contenu = <NouveauProfil theme={theme} api={api} large={large} onFini={retourListe} />;
  } else if (vue.v === 'fiche') {
    contenu = <FicheJeu theme={theme} api={api} cle={vue.cle} large={large} iaDisponible={iaDisponible} onRetour={retourListe} onPropositions={() => { setVue({ v: 'liste' }); setOnglet('maj'); }} />;
  } else if (vue.v === 'brouillon') {
    contenu = <RelectureBrouillon theme={theme} api={api} id={vue.id} large={large} onFini={retourListe} />;
  } else if (onglet === 'maj') {
    contenu = <Propositions theme={theme} api={api} large={large} propositions={propositions} onDecide={m => retourListe(m)} />;
  } else if (onglet === 'ia') {
    contenu = <AssistantIa theme={theme} api={api} large={large} liste={liste} onRelire={id => setVue({ v: 'brouillon', id })} />;
  } else if (onglet === 'admin' && fondateur) {
    contenu = <AdministrationIa theme={theme} api={api} client={client} large={large} />;
  } else {
    contenu = (
      <ListeProfils
        theme={theme}
        large={large}
        liste={liste}
        onOuvrir={cle => setVue({ v: 'fiche', cle })}
        onNouveau={() => setVue({ v: 'nouveau' })}
        onIa={() => setOnglet('ia')}
      />
    );
  }

  return (
    <PageEsport large={large} testID="esport-jeux">
      <EnTetePage theme={theme} large={large} titre={trJeux('jeux.titre')} sous={trJeux('jeux.sous_titre')} />
      {vue.v === 'liste' ? (
        <Onglets theme={theme} entrees={entrees} actif={onglet} onChoisir={id => { setAvis(undefined); setOnglet(id as Onglet); }} prefixe="esport-jeux-onglet" defilant={!large} />
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-jeux" />
      {contenu}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Liste

function ListeProfils({ theme, large, liste, onOuvrir, onNouveau, onIa }: { theme: ThemeHub; large: boolean; liste: ListeJeux | undefined; onOuvrir(cle: string): void; onNouveau(): void; onIa(): void }) {
  const ia = liste?.ia;
  return (
    <View style={{ gap: ESP.m }}>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <BoutonHub theme={theme} titre={trJeux('jeux.nouveau_profil')} variante="plein" onPress={onNouveau} testID="esport-jeux-nouveau" />
        <BoutonHub theme={theme} titre={trJeux('jeux.preparer_ia')} desactive={!ia?.disponible} onPress={onIa} testID="esport-jeux-preparer-ia" />
      </View>
      {ia && !ia.disponible ? <Text style={attenue(theme, 13)} testID="esport-jeux-ia-indisponible">{trJeux('jeux.ia_indisponible')}</Text> : null}
      {!liste ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && liste.jeux.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="◈" titre={trJeux('jeux.aucun_profil')} texte={trJeux('jeux.aucun_profil_texte')} />
        </Carte>
      ) : null}
      <Grille min={large ? 300 : 280}>
        {liste?.jeux.map(j => (
          <CarteJeu key={j.cle} theme={theme} jeu={j} onPress={() => onOuvrir(j.cle)} />
        ))}
      </Grille>
    </View>
  );
}

function CarteJeu({ theme, jeu, onPress }: { theme: ThemeHub; jeu: JeuListe; onPress(): void }) {
  const r = jeu.resume;
  return (
    <Carte theme={theme} onPress={onPress} testID={`esport-jeu-${jeu.cle}`} libelle={trJeux('jeux.ouvrir', { nom: jeu.nom })}>
      <View style={[styles.ligne, { gap: ESP.s, alignItems: 'center' }]}>
        <PastilleJeu theme={theme} jeu={jeu} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...texte(theme, 17), fontWeight: '700' }} numberOfLines={1}>{jeu.nom}</Text>
          <Text style={attenue(theme, 12)}>{trJeux('jeux.version_n', { n: jeu.version })}</Text>
        </View>
        {jeu.statut === 'archive' ? <Badge theme={theme} texte={trJeux('jeux.archive')} /> : null}
        {jeu.propositions ? <Badge theme={theme} texte={trnJeux('jeux.n_propositions', jeu.propositions)} ton="alerte" testID={`esport-jeu-${jeu.cle}-propositions`} /> : null}
      </View>
      <Text style={texte(theme, 14)}>{r.formats.length ? r.formats.map(f => `${f.libelle}${f.bo.length ? ` (${f.bo.map(b => `BO${b}`).join('/')})` : ''}`).join(' · ') : trJeux('jeux.aucun_format')}</Text>
      <Text style={attenue(theme, 13)}>
        {[
          r.cartes ? trJeux('jeux.resume_cartes', { n: r.cartesActives, total: r.cartes }) : '',
          r.personnages ? trnJeux('jeux.resume_personnages', r.personnages) : '',
          r.roster ? trJeux('jeux.resume_roster', { titulaires: r.roster.titulaires, remplacants: r.roster.remplacants }) : '',
          r.score ? trJeux(`jeux.score.${r.score}`) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {jeu.teams !== undefined ? <Text style={attenue(theme, 12)}>{trnJeux('jeux.n_teams', jeu.teams)}</Text> : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ Création, fiche

function NouveauProfil({ theme, api, large, onFini }: { theme: ThemeHub; api: ApiJeux; large: boolean; onFini(m?: string): void }) {
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  return (
    <EditeurProfil
      theme={theme}
      large={large}
      nouveau
      initial={{ nom: '', couleur: '#5b8cff', icone: null, donnees: donneesVides() }}
      titreAction={trJeux('jeux.creer_profil')}
      enCours={enCours}
      erreur={erreur}
      onAnnuler={() => onFini()}
      onEnregistrer={s => {
        setEnCours(true);
        setErreur(undefined);
        api
          .creer(s)
          .then(p => onFini(trJeux('jeux.profil_cree', { nom: p.nom })))
          .catch(e => setErreur(messageErreur(e)))
          .finally(() => setEnCours(false));
      }}
    />
  );
}

function FicheJeu({ theme, api, cle, large, iaDisponible, onRetour, onPropositions }: { theme: ThemeHub; api: ApiJeux; cle: string; large: boolean; iaDisponible: boolean; onRetour(m?: string): void; onPropositions(): void }) {
  const [profil, setProfil] = useState<ProfilJeu | undefined>();
  const [versions, setVersions] = useState<VersionJeu[] | undefined>();
  const [cleEditeur, setCleEditeur] = useState(0);
  const [erreurEdition, setErreurEdition] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const [p, v] = await Promise.all([api.detail(cle), api.versions(cle)]);
    setProfil(p);
    setVersions(v);
    setCleEditeur(n => n + 1);
  }, [api, cle]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  if (!profil) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-jeu-fiche" /> : <SqueletteCartes theme={theme} n={2} large={large} />;

  const editeur = (
    <EditeurProfil
      key={`${profil.version}-${cleEditeur}`}
      theme={theme}
      large={large}
      nouveau={false}
      initial={{ cle: profil.cle, nom: profil.nom, couleur: profil.couleur, icone: profil.icone, donnees: profil.donnees, version: profil.version }}
      titreAction={trJeux('jeux.enregistrer_version')}
      enCours={enCours}
      erreur={erreurEdition}
      onAnnuler={() => onRetour()}
      onEnregistrer={s => {
        setEnCours(true);
        setErreurEdition(undefined);
        api
          .modifier(cle, { nom: s.nom, couleur: s.couleur, icone: s.icone, donnees: s.donnees, version: profil.version })
          .then(() => {
            oublierProfilsTeams();
            return charger();
          })
          .then(() => setErreurEdition(undefined))
          .catch(e => setErreurEdition(messageErreur(e)))
          .finally(() => setEnCours(false));
      }}
    />
  );
  const cote = (
    <View style={{ gap: ESP.m, width: large ? 340 : '100%' }}>
      <Carte theme={theme} testID="esport-jeu-actions">
        <View style={[styles.ligne, { gap: ESP.s, alignItems: 'center' }]}>
          <PastilleJeu theme={theme} jeu={profil} taille={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...texte(theme, 16), fontWeight: '700' }}>{profil.nom}</Text>
            <Text style={attenue(theme, 12)}>{`${profil.cle} · ${trJeux('jeux.version_n', { n: profil.version })}${profil.base === 'valorant' ? ` · ${trJeux('jeux.base_valorant')}` : ''}`}</Text>
          </View>
          <MenuActions
            theme={theme}
            testID="esport-jeu-menu"
            actions={[
              { titre: profil.statut === 'archive' ? trJeux('jeux.desarchiver') : trJeux('jeux.archiver'), onPress: () => void agir('archiver', async () => { await api.archiver(cle, profil.statut !== 'archive'); await charger(); return profil.statut === 'archive' ? trJeux('jeux.desarchive_ok') : trJeux('jeux.archive_ok'); }), testID: 'esport-jeu-archiver' },
              !profil.teams && { titre: trJeux('jeux.supprimer'), onPress: () => void agir('supprimer', async () => { await api.supprimer(cle); onRetour(trJeux('jeux.supprime_ok', { nom: profil.nom })); }), danger: true, testID: 'esport-jeu-supprimer' },
            ]}
          />
        </View>
        <Text style={attenue(theme, 13)}>{trnJeux('jeux.n_teams', profil.teams ?? 0)}</Text>
        {profil.statut === 'archive' ? <Badge theme={theme} texte={trJeux('jeux.archive_aide')} /> : null}
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-jeu-fiche" />
      </Carte>
      <Carte theme={theme} testID="esport-jeu-maj">
        <TitreCarte theme={theme} titre={trJeux('jeux.maj_titre')} sous={trJeux('jeux.maj_aide')} />
        <Segments<'oui' | 'non'>
          theme={theme}
          libelle={trJeux('jeux.maj_auto')}
          valeur={profil.majAuto ? 'oui' : 'non'}
          options={[['oui', trJeux('jeux.maj_auto_oui')], ['non', trJeux('jeux.maj_auto_non')]]}
          onChoisir={v => void agir('maj', async () => { setProfil(await api.reglerMaj(cle, { majAuto: v === 'oui' })); return v === 'oui' ? trJeux('jeux.maj_auto_active') : trJeux('jeux.maj_auto_coupee'); })}
          testID="esport-jeu-maj-auto"
        />
        <Choix<string>
          theme={theme}
          libelle={trJeux('jeux.frequence')}
          valeur={String(profil.frequenceJours ?? 7)}
          options={['7', '14', '30'].map(n => ({ id: n, nom: trJeux('jeux.tous_les_n_jours', { n }) }))}
          onChoisir={n => void agir('maj', async () => { setProfil(await api.reglerMaj(cle, { frequenceJours: Number(n) })); })}
          testID="esport-jeu-frequence"
        />
        <Text style={attenue(theme, 12)}>{profil.derniereVerif ? trJeux('jeux.derniere_verif', { date: dateCourte(profil.derniereVerif) }) : trJeux('jeux.jamais_verifie')}</Text>
        <BoutonHub
          theme={theme}
          titre={trJeux('jeux.verifier_maintenant')}
          desactive={!iaDisponible}
          onPress={() =>
            void agir('verifier', async () => {
              const t = await api.verifier(cle);
              await charger();
              if (t.statut === 'echec') throw new Error(t.erreur?.message ?? trJeux('jeux.verification_echec'));
              return t.statut === 'termine' ? trnJeux('jeux.verification_faite', t.resultat?.propositions ?? 0) : trJeux('jeux.verification_lancee');
            })
          }
          testID="esport-jeu-verifier"
        />
        {!iaDisponible ? <Text style={attenue(theme, 12)}>{trJeux('jeux.ia_indisponible_court')}</Text> : null}
        {profil.propositions ? <BoutonHub theme={theme} titre={trnJeux('jeux.voir_propositions', profil.propositions)} variante="plein" onPress={onPropositions} testID="esport-jeu-voir-propositions" /> : null}
      </Carte>
      <Carte theme={theme} testID="esport-jeu-historique">
        <TitreCarte theme={theme} titre={trJeux('jeux.historique')} />
        {(versions ?? []).slice(0, 30).map(v => (
          <View key={v.version} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-jeu-version-${v.version}`}>
            <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trJeux('jeux.version_motif', { n: v.version, motif: trJeux(`jeux.motif.${motifConnu(v.motif)}`) })}</Text>
            <Text style={attenue(theme, 12)}>{`${dateCourte(v.le)}${v.auteur?.pseudo ? ` · ${v.auteur.pseudo}` : ''}`}</Text>
            {resumeVersion(v) ? <Text style={attenue(theme, 12)}>{resumeVersion(v)}</Text> : null}
            {v.version !== profil.version ? (
              <BoutonConfirme
                theme={theme}
                titre={trJeux('jeux.restaurer')}
                confirmation={trJeux('jeux.restaurer_confirmer', { n: v.version })}
                onConfirme={() => void agir('restaurer', async () => { await api.restaurer(cle, v.version, profil.version); oublierProfilsTeams(); await charger(); return trJeux('jeux.restaure_ok', { n: v.version }); })}
                testID={`esport-jeu-restaurer-${v.version}`}
              />
            ) : null}
          </View>
        ))}
      </Carte>
    </View>
  );
  return (
    <View style={{ gap: ESP.m }}>
      <Pressable accessibilityRole="link" onPress={() => onRetour()} testID="esport-jeu-retour" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600', ...police(theme.policeTexte) }}>{`‹ ${trJeux('jeux.titre')}`}</Text>
      </Pressable>
      <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.m, alignItems: 'flex-start' }}>
        {large ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{editeur}</View>
            {cote}
          </>
        ) : (
          <>
            {cote}
            <View style={{ width: '100%' }}>{editeur}</View>
          </>
        )}
      </View>
    </View>
  );
}

const MOTIFS = ['creation', 'modification', 'restauration', 'ia-brouillon', 'ia-maj', 'preconfiguration'] as const;
const motifConnu = (m: string): (typeof MOTIFS)[number] => ((MOTIFS as readonly string[]).includes(m) ? (m as (typeof MOTIFS)[number]) : 'modification');

/** « Maps : +Nouvelle, ~Breeze ; Score » */
function resumeVersion(v: VersionJeu): string {
  return Object.entries(v.resume)
    .map(([section, r]) => {
      const nom = trJeux(`jeux.section.${(['formats', 'modes', 'cartes', 'classes', 'personnages', 'rolesJoueurs', 'champs', 'score', 'roster', 'libelles', 'sources'] as const).find(x => x === section) ?? 'champs'}`);
      if (r === true) return ['nom', 'couleur', 'icone'].includes(section) ? trJeux('jeux.section.identite') : nom;
      const parts = [...r.ajouts.map(x => `+${x}`), ...r.modifications.map(x => `~${x}`), ...r.retraits.map(x => `−${x}`)];
      return `${nom} : ${parts.slice(0, 6).join(', ')}${parts.length > 6 ? '…' : ''}`;
    })
    .filter((x, i, l) => l.indexOf(x) === i)
    .join(' ; ');
}

// ------------------------------------------------------------------ Assistant IA (brouillons)

const STATUTS_EN_COURS = ['attente', 'en_cours'];

/** Minutes écoulées depuis une date ISO (0 si illisible) : progression d'un brouillon en cours. */
function minutesDepuis(iso: string | null | undefined): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60_000)) : 0;
}

function AssistantIa({ theme, api, large, liste, onRelire }: { theme: ThemeHub; api: ApiJeux; large: boolean; liste: ListeJeux | undefined; onRelire(id: string): void }) {
  const [nom, setNom] = useState('');
  const [urls, setUrls] = useState('');
  const [consignes, setConsignes] = useState('');
  const [completer, setCompleter] = useState('');
  const [travaux, setTravaux] = useState<TravailIa[] | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const disponible = Boolean(liste?.ia?.disponible);
  const charger = useCallback(async () => setTravaux(await api.travaux({ genre: 'brouillon' })), [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Brouillon en préparation : la liste se met à jour toute seule.
  const attente = travaux?.some(t => STATUTS_EN_COURS.includes(t.statut));
  useEffect(() => {
    if (!attente) return undefined;
    const minuterie = setInterval(() => void charger().catch(() => undefined), 4000);
    return () => clearInterval(minuterie);
  }, [attente, charger]);

  return (
    <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.m, alignItems: 'flex-start' }}>
      <Carte theme={theme} testID="esport-jeux-ia-formulaire" style={{ flex: large ? 1 : undefined, width: large ? undefined : '100%' }}>
        <TitreCarte theme={theme} titre={trJeux('jeux.preparer_ia')} sous={trJeux('jeux.preparer_ia_aide')} />
        {!disponible ? <Badge theme={theme} texte={trJeux('jeux.ia_indisponible')} ton="alerte" testID="esport-jeux-ia-desactivee" /> : null}
        <Champ theme={theme} libelle={trJeux('jeux.nom_du_jeu')} valeur={nom} onChanger={setNom} maxLength={60} placeholder={trJeux('jeux.exemple_jeu')} testID="esport-jeux-ia-nom" />
        <Champ theme={theme} libelle={trJeux('jeux.pages_reference')} valeur={urls} onChanger={setUrls} multiligne maxLength={2600} placeholder="https://" testID="esport-jeux-ia-urls" />
        <Text style={attenue(theme, 12)}>{trJeux('jeux.pages_reference_aide')}</Text>
        <Champ theme={theme} libelle={trJeux('jeux.consignes')} valeur={consignes} onChanger={setConsignes} multiligne maxLength={1000} testID="esport-jeux-ia-consignes" />
        {liste?.jeux.length ? (
          <Choix<string> theme={theme} libelle={trJeux('jeux.completer_profil')} valeur={completer} options={[{ id: '', nom: trJeux('jeux.nouveau_jeu') }, ...liste.jeux.map(j => ({ id: j.cle, nom: j.nom }))]} onChoisir={setCompleter} testID="esport-jeux-ia-completer" />
        ) : null}
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-jeux-ia" />
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub
            theme={theme}
            titre={enCours === 'lancer' ? trJeux('jeux.preparation') : trJeux('jeux.lancer_preparation')}
            variante="plein"
            desactive={!disponible || Boolean(enCours) || nom.trim().length < 2}
            onPress={() =>
              void agir('lancer', async () => {
                const liste = urls.split(/\s+/).map(u => u.trim()).filter(Boolean).slice(0, 5);
                const t = await api.lancerBrouillon({ nom: nom.trim(), ...(liste.length ? { urls: liste } : {}), ...(consignes.trim() ? { consignes: consignes.trim() } : {}), ...(completer ? { jeu: completer } : {}) });
                await charger();
                if (t.statut === 'pret') {
                  onRelire(t.id);
                  return undefined;
                }
                if (t.statut === 'echec') throw new Error(t.erreur?.message ?? trJeux('jeux.brouillon_echec'));
                return trJeux('jeux.brouillon_lance');
              })
            }
            testID="esport-jeux-ia-lancer"
          />
        </View>
        <Text style={attenue(theme, 12)}>{trJeux('jeux.ia_donnees_non_fiables')}</Text>
      </Carte>
      <Carte theme={theme} testID="esport-jeux-ia-brouillons" style={{ width: large ? 380 : '100%' }}>
        <TitreCarte theme={theme} titre={trJeux('jeux.brouillons')} />
        {travaux && travaux.length === 0 ? <Text style={attenue(theme, 13)}>{trJeux('jeux.aucun_brouillon')}</Text> : null}
        {travaux?.map(t => (
          <View key={t.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-jeux-brouillon-${t.id}`}>
            <View style={[styles.ligne, { gap: 6, alignItems: 'center' }]}>
              <Text style={{ ...texte(theme, 14), fontWeight: '600', flex: 1 }}>{t.demande.nom ?? '?'}</Text>
              <Badge theme={theme} texte={trJeux(`jeux.statut.${t.statut}`)} ton={t.statut === 'pret' ? 'accent' : t.statut === 'echec' ? 'critique' : t.statut === 'valide' ? 'ok' : 'neutre'} />
            </View>
            <Text style={attenue(theme, 12)}>{`${dateCourte(t.creeLe)}${t.demandePar?.pseudo ? ` · ${t.demandePar.pseudo}` : ''}`}</Text>
            {t.statut === 'en_cours' ? <Text style={attenue(theme, 12)} testID={`esport-jeux-brouillon-${t.id}-depuis`}>{trnJeux('jeux.en_cours_depuis', minutesDepuis(t.majLe))}</Text> : null}
            {t.erreur ? <Text style={{ color: theme.critique, fontSize: 12 }}>{t.erreur.message}</Text> : null}
            {t.statut === 'pret' ? <BoutonHub theme={theme} titre={trJeux('jeux.relire')} variante="plein" onPress={() => onRelire(t.id)} testID={`esport-jeux-brouillon-${t.id}-relire`} /> : null}
          </View>
        ))}
      </Carte>
    </View>
  );
}

function RelectureBrouillon({ theme, api, id, large, onFini }: { theme: ThemeHub; api: ApiJeux; id: string; large: boolean; onFini(m?: string): void }) {
  const [travail, setTravail] = useState<TravailIa | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.travail(id).then(setTravail).catch(e => setErreur(messageErreur(e)));
  }, [api, id]);
  if (!travail) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-jeu-brouillon" /> : <SqueletteCartes theme={theme} n={2} large={large} />;
  const r = travail.resultat;
  if (travail.statut !== 'pret' || !r?.donnees) {
    return (
      <Carte theme={theme}>
        <Text style={texte(theme)}>{trJeux(`jeux.statut.${travail.statut}`)}</Text>
        <BoutonHub theme={theme} titre={trJeux('jeux.retour')} onPress={() => onFini()} testID="esport-jeu-brouillon-retour" />
      </Carte>
    );
  }
  return (
    <View style={{ gap: ESP.m }}>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <BoutonHub theme={theme} titre={`‹ ${trJeux('jeux.titre')}`} onPress={() => onFini()} testID="esport-jeu-brouillon-retour" />
        <BoutonConfirme theme={theme} titre={trJeux('jeux.abandonner')} confirmation={trJeux('jeux.abandonner_confirmer')} onConfirme={() => void api.abandonner(id).then(() => onFini(trJeux('jeux.brouillon_abandonne'))).catch(e => setErreur(messageErreur(e)))} testID="esport-jeu-brouillon-abandonner" />
      </View>
      <EditeurProfil
        theme={theme}
        large={large}
        nouveau={!travail.jeu}
        testID="esport-jeu-brouillon"
        initial={{ cle: r.cle ?? '', nom: r.nom ?? travail.demande.nom ?? '', couleur: r.couleur ?? '#8b8b9a', icone: null, donnees: r.donnees, ...(typeof r.version === 'number' ? { version: r.version } : {}) }}
        meta={{ incertitudes: travail.incertitudes, avertissements: travail.avertissements, pagesLues: r.pagesLues ?? [], pagesEchecs: r.pagesEchecs ?? [] }}
        titreAction={trJeux('jeux.valider_brouillon')}
        enCours={enCours}
        erreur={erreur}
        onAnnuler={() => onFini()}
        onEnregistrer={s => {
          setEnCours(true);
          setErreur(undefined);
          api
            .validerBrouillon(id, s)
            .then(p => onFini(trJeux('jeux.brouillon_valide', { nom: p.nom })))
            .catch(e => setErreur(messageErreur(e)))
            .finally(() => setEnCours(false));
        }}
      />
    </View>
  );
}

// ------------------------------------------------------------------ Mises à jour proposées

type Decision = 'accepter' | 'refuser' | 'attendre';

/** Champs qui changent entre deux versions d'un élément (« actif : oui → non »). */
function differencesChamps(avant: Record<string, unknown> | null, apres: Record<string, unknown> | null): Array<[string, string, string]> {
  const v = (x: unknown): string => (x === null || x === undefined ? '—' : typeof x === 'boolean' ? (x ? trJeux('jeux.oui') : trJeux('jeux.non')) : Array.isArray(x) ? x.map(y => (typeof y === 'object' ? JSON.stringify(y) : String(y))).join(', ') : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const cles = [...new Set([...Object.keys(avant ?? {}), ...Object.keys(apres ?? {})])].filter(k => k !== 'cle');
  return cles.filter(k => JSON.stringify(avant?.[k]) !== JSON.stringify(apres?.[k])).map(k => [k, v(avant?.[k]), v(apres?.[k])]);
}

function Propositions({ theme, api, large, propositions, onDecide }: { theme: ThemeHub; api: ApiJeux; large: boolean; propositions: PropositionJeu[] | undefined; onDecide(message?: string): void }) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [noms, setNoms] = useState<Record<string, string>>({});
  const { enCours, erreur, avis, agir } = useAgir();
  const parJeu = useMemo(() => {
    const m = new Map<string, PropositionJeu[]>();
    for (const p of propositions ?? []) m.set(p.jeu, [...(m.get(p.jeu) ?? []), p]);
    return [...m.entries()];
  }, [propositions]);
  if (!propositions) return <SqueletteCartes theme={theme} n={2} large={large} />;
  if (propositions.length === 0) {
    return (
      <Carte theme={theme} testID="esport-jeux-maj-vide">
        <EtatVide theme={theme} glyphe="✓" titre={trJeux('jeux.aucune_proposition')} texte={trJeux('jeux.aucune_proposition_texte')} />
      </Carte>
    );
  }
  return (
    <View style={{ gap: ESP.m }}>
      <Text style={attenue(theme, 13)}>{trJeux('jeux.propositions_aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-jeux-maj" />
      {parJeu.map(([cle, liste]) => {
        const choisies = liste.filter(p => decisions[p.id] && decisions[p.id] !== 'attendre');
        return (
          <Carte key={cle} theme={theme} testID={`esport-jeux-maj-${cle}`}>
            <TitreCarte theme={theme} titre={liste[0].jeuNom} sous={trnJeux('jeux.n_propositions', liste.length)} />
            {liste.map(p => {
              const decision = decisions[p.id] ?? 'attendre';
              const elementNom = String((p.apres?.nom ?? p.avant?.nom ?? p.cle ?? trJeux(`jeux.section.${p.section}`)) as string);
              return (
                <View key={p.id} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={`esport-jeux-proposition-${p.id}`}>
                  <View style={[styles.ligne, { gap: 6, alignItems: 'center' }]}>
                    <Badge theme={theme} texte={trJeux(`jeux.operation.${p.operation}`)} ton={p.operation === 'retrait' ? 'critique' : p.operation === 'ajout' ? 'ok' : 'accent'} />
                    <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{`${trJeux(`jeux.section.${p.section}`)} · ${elementNom}`}</Text>
                    <Badge theme={theme} texte={trJeux('jeux.confiance_x', { confiance: trJeux(`jeux.confiance.${p.confiance}`) })} ton={p.confiance === 'basse' ? 'alerte' : 'neutre'} />
                  </View>
                  {p.justification ? <Text style={texte(theme, 14)}>{p.justification}</Text> : null}
                  {differencesChamps(p.avant, p.operation === 'retrait' ? null : p.apres).map(([champ, a, b]) => (
                    <Text key={champ} style={attenue(theme, 13)} testID={`esport-jeux-proposition-${p.id}-diff-${champ}`}>{`${champ} : ${a} → ${b}`}</Text>
                  ))}
                  {p.sources.map(s => (
                    <Pressable key={s.url} accessibilityRole="link" onPress={() => void Linking.openURL(s.url)}>
                      <Text style={{ color: theme.accent, fontSize: 12, ...police(theme.policeTexte) }}>{`${hote(s.url)}${s.titre ? ` · ${s.titre}` : ''}`}</Text>
                    </Pressable>
                  ))}
                  {p.sources.length === 0 ? <Text style={attenue(theme, 12)}>{trJeux('jeux.sans_source')}</Text> : null}
                  <Segments<Decision>
                    theme={theme}
                    libelle={trJeux('jeux.decision')}
                    valeur={decision}
                    options={[['accepter', trJeux('jeux.accepter')], ['refuser', trJeux('jeux.refuser')], ['attendre', trJeux('jeux.plus_tard')]]}
                    onChoisir={d => setDecisions(x => ({ ...x, [p.id]: d }))}
                    testID={`esport-jeux-proposition-${p.id}-decision`}
                  />
                  {decision === 'accepter' && p.operation !== 'retrait' && typeof p.apres?.nom === 'string' && !['score', 'roster'].includes(p.section) ? (
                    <Champ theme={theme} libelle={trJeux('jeux.corriger_nom')} valeur={noms[p.id] ?? String(p.apres.nom)} onChanger={v => setNoms(x => ({ ...x, [p.id]: v }))} maxLength={60} testID={`esport-jeux-proposition-${p.id}-nom`} />
                  ) : null}
                </View>
              );
            })}
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub
                theme={theme}
                titre={trnJeux('jeux.appliquer_decisions', choisies.length)}
                variante="plein"
                desactive={choisies.length === 0 || Boolean(enCours)}
                onPress={() =>
                  void agir('decider', async () => {
                    const acceptees = choisies.filter(p => decisions[p.id] === 'accepter');
                    const corrections = Object.fromEntries(acceptees.filter(p => noms[p.id] !== undefined && noms[p.id] !== p.apres?.nom).map(p => [p.id, { ...p.apres, nom: noms[p.id] }]));
                    const r = await api.decider(cle, { acceptees: acceptees.map(p => p.id), refusees: choisies.filter(p => decisions[p.id] === 'refuser').map(p => p.id), corrections });
                    oublierProfilsTeams();
                    onDecide(trJeux('jeux.decisions_appliquees', { acceptees: r.acceptees, refusees: r.refusees, obsoletes: r.obsoletes }));
                  })
                }
                testID={`esport-jeux-maj-${cle}-appliquer`}
              />
            </View>
          </Carte>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Administration de l'IA (Fondateur)

/** Moteur de l'IA (locale, clé d'API, locale d'abord) et état de l'IA locale installée sur le serveur. */
function CarteIaLocale({ theme, etat, enCours, ligne, onMode, onTester, test }: {
  theme: ThemeHub;
  etat: EtatIa;
  enCours: string | undefined;
  ligne: (libelle: string, valeur: string, testID?: string) => React.ReactElement;
  onMode: (m: ModeIa) => void;
  onTester: () => void;
  test: string | undefined;
}) {
  const l = etat.local;
  const mode: ModeIa = etat.mode ?? etat.reglages.mode ?? 'api';
  const possibles = etat.modesPossibles?.length ? etat.modesPossibles : [mode];
  const options = (['local', 'api', 'local-api'] as const).filter(m => m === mode || possibles.includes(m));
  const marche = !l?.installe ? trJeux('jeux.local_non_installee') : l.demarrage ? trJeux('jeux.local_demarrage') : l.enMarche ? trJeux('jeux.local_en_marche') : trJeux('jeux.local_arretee');
  const vitesse = l?.derniereVitesse ? trJeux('jeux.local_vitesse_valeur', { n: Math.round(l.derniereVitesse.jetonsParSeconde * 10) / 10 }) : '—';
  return (
    <Carte theme={theme} testID="esport-jeux-admin-local">
      <TitreCarte theme={theme} titre={trJeux('jeux.moteur_ia')} sous={trJeux('jeux.moteur_ia_aide')} droite={<Badge theme={theme} texte={marche} ton={l?.installe ? 'ok' : 'alerte'} />} />
      {options.length > 1 ? (
        <Segments<ModeIa>
          theme={theme}
          libelle={trJeux('jeux.mode_ia')}
          valeur={mode}
          options={options.map(m => [m, trJeux(`jeux.mode_ia.${m}`)] as [ModeIa, string])}
          onChoisir={onMode}
          testID="esport-jeux-admin-mode"
        />
      ) : (
        ligne(trJeux('jeux.mode_ia'), trJeux(`jeux.mode_ia.${mode}`), 'esport-jeux-admin-mode-seul')
      )}
      {l?.installe ? (
        <>
          {ligne(trJeux('jeux.modele'), l.nomModele ?? l.modele ?? '—', 'esport-jeux-admin-local-modele')}
          {ligne(trJeux('jeux.local_fils'), l.threads ? String(l.threads) : '—')}
          {ligne(trJeux('jeux.local_vitesse'), vitesse, 'esport-jeux-admin-local-vitesse')}
          {ligne(trJeux('jeux.local_temps_reponse'), l.dernierTempsReponseMs != null ? `${Math.round(l.dernierTempsReponseMs / 100) / 10} s` : '—', 'esport-jeux-admin-local-temps')}
          {l.file ? ligne(trJeux('jeux.local_file'), String(l.file)) : null}
          {l.derniereErreur ? ligne(trJeux('jeux.local_erreur'), l.derniereErreur) : null}
          <Text style={attenue(theme, 12)}>{trJeux('jeux.local_aide')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={enCours === 'test-local' ? trJeux('jeux.test_local_en_cours') : trJeux('jeux.tester_local')} desactive={Boolean(enCours)} onPress={onTester} testID="esport-jeux-admin-tester-local" />
          </View>
          {test ? <Text style={texte(theme, 13)} testID="esport-jeux-admin-test-local">{test}</Text> : null}
        </>
      ) : (
        <Text style={attenue(theme, 13)} testID="esport-jeux-admin-local-absente">{trJeux('jeux.local_installer')}</Text>
      )}
    </Carte>
  );
}

function AdministrationIa({ theme, api, client, large }: { theme: ThemeHub; api: ApiJeux; client: ClientEsport; large: boolean }) {
  const [etat, setEtat] = useState<EtatIa | undefined>();
  const [quotaAppels, setQuotaAppels] = useState('');
  const [quotaVerifs, setQuotaVerifs] = useState('');
  const [test, setTest] = useState<string | undefined>();
  const [testLocal, setTestLocal] = useState<string | undefined>();
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[] | undefined>();
  const [comptes, setComptes] = useState<CompteEsport[] | undefined>();
  const [ajout, setAjout] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  const appliquer = (e: EtatIa) => {
    setEtat(e);
    setQuotaAppels(String(e.reglages.quotaAppels));
    setQuotaVerifs(String(e.reglages.quotaVerifications));
  };
  useEffect(() => {
    void agir('', async () => {
      appliquer(await api.etatIa());
      setGestionnaires(await api.gestionnaires());
      setComptes((await client.annuaire().catch(() => undefined))?.comptes);
    });
  }, [agir, api, client]);
  if (!etat) return <SqueletteCartes theme={theme} n={2} large={large} />;
  const ligne = (libelle: string, valeur: string, testID?: string) => (
    <View style={[styles.ligne, { gap: ESP.s, justifyContent: 'space-between' }]} testID={testID}>
      <Text style={attenue(theme, 13)}>{libelle}</Text>
      <Text style={{ ...texte(theme, 14), fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{valeur}</Text>
    </View>
  );
  const candidats = (comptes ?? []).filter(c => c.compte !== 'principal' && !c.horsEsport && !(gestionnaires ?? []).some(g => g.compte === c.compte));
  return (
    <View style={{ gap: ESP.m }}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-jeux-admin" />
      <Grille min={large ? 340 : 280}>
        <CarteIaLocale theme={theme} etat={etat} enCours={enCours} ligne={ligne}
          onMode={mode => void agir('mode', async () => { appliquer(await api.reglerIa({ mode })); return trJeux('jeux.mode_enregistre'); })}
          onTester={() =>
            void agir('test-local', async () => {
              const r = await api.testerIa('local');
              appliquer(r.etat);
              setTestLocal(r.ok ? trJeux('jeux.test_ok', { duree: Math.round((r.dureeMs ?? 0) / 100) / 10 }) : trJeux('jeux.test_echec', { message: r.erreur?.message ?? '' }));
            })
          }
          test={testLocal}
        />
        <Carte theme={theme} testID="esport-jeux-admin-etat">
          <TitreCarte theme={theme} titre={trJeux('jeux.admin_etat')} droite={<Badge theme={theme} texte={etat.disponible ? trJeux('jeux.ia_active') : trJeux('jeux.ia_inactive')} ton={etat.disponible ? 'ok' : 'alerte'} />} />
          {ligne(trJeux('jeux.fournisseur'), etat.fournisseur ? trJeux(`jeux.fournisseur.${(['openai', 'mistral', 'gemini', 'deepseek', 'groq'] as const).find(f => f === etat.fournisseur) ?? 'autre'}`) : '—')}
          {ligne(trJeux('jeux.modele'), etat.modele ?? '—', 'esport-jeux-admin-modele')}
          {ligne(trJeux('jeux.adresse_api'), etat.hote ?? '—')}
          {ligne(trJeux('jeux.cle_api'), etat.cle === 'presente' ? trJeux('jeux.cle_presente') : trJeux('jeux.cle_absente'), 'esport-jeux-admin-cle')}
          {ligne(trJeux('jeux.recherche'), trJeux(`jeux.recherche.${etat.recherche}`))}
          {!etat.configure ? <Text style={attenue(theme, 13)} testID="esport-jeux-admin-explication">{trJeux('jeux.admin_explication', { raison: trJeux(`jeux.raison_ia.${(['cle-absente', 'modele-absent', 'url-invalide'] as const).find(r => r === etat.raison) ?? 'cle-absente'}`) })}</Text> : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={enCours === 'test' ? trJeux('jeux.test_en_cours') : trJeux('jeux.tester')}
              desactive={(etat.mode && etat.mode !== 'api' ? etat.cle !== 'presente' || !etat.configure : !etat.disponible) || Boolean(enCours)}
              onPress={() =>
                void agir('test', async () => {
                  const r = await api.testerIa(etat.mode && etat.mode !== 'api' ? 'api' : undefined);
                  appliquer(r.etat);
                  setTest(r.ok ? trJeux('jeux.test_ok', { duree: Math.round((r.dureeMs ?? 0) / 100) / 10 }) : trJeux('jeux.test_echec', { message: r.erreur?.message ?? '' }));
                })
              }
              testID="esport-jeux-admin-tester"
            />
          </View>
          {test ? <Text style={texte(theme, 13)} testID="esport-jeux-admin-test">{test}</Text> : null}
        </Carte>
        <Carte theme={theme} testID="esport-jeux-admin-quota">
          <TitreCarte theme={theme} titre={trJeux('jeux.quota')} sous={trJeux('jeux.quota_aide', { mois: etat.usage.mois })} />
          {ligne(trJeux('jeux.appels_mois'), `${etat.usage.appels} / ${etat.usage.plafondAppels}`, 'esport-jeux-admin-usage-appels')}
          {etat.usage.appelsLocaux ? ligne(trJeux('jeux.appels_locaux_mois'), String(etat.usage.appelsLocaux), 'esport-jeux-admin-usage-locaux') : null}
          {ligne(trJeux('jeux.verifications_mois'), `${etat.usage.verifications} / ${etat.usage.plafondVerifications}`, 'esport-jeux-admin-usage-verifications')}
          <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJeux('jeux.plafond_appels')} valeur={quotaAppels} onChanger={v => setQuotaAppels(v.replace(/\D/g, ''))} clavier="number-pad" maxLength={5} testID="esport-jeux-admin-quota-appels" style={{ width: 150 }} />
            <Champ theme={theme} libelle={trJeux('jeux.plafond_verifications')} valeur={quotaVerifs} onChanger={v => setQuotaVerifs(v.replace(/\D/g, ''))} clavier="number-pad" maxLength={5} testID="esport-jeux-admin-quota-verifications" style={{ width: 150 }} />
          </View>
          <Segments<'oui' | 'non'>
            theme={theme}
            libelle={trJeux('jeux.auto_global')}
            valeur={etat.reglages.autoActif ? 'oui' : 'non'}
            options={[['oui', trJeux('jeux.maj_auto_oui')], ['non', trJeux('jeux.maj_auto_non')]]}
            onChoisir={v => void agir('auto', async () => { appliquer(await api.reglerIa({ autoActif: v === 'oui' })); })}
            testID="esport-jeux-admin-auto"
          />
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={trJeux('jeux.enregistrer')}
              variante="plein"
              desactive={Boolean(enCours) || quotaAppels === '' || quotaVerifs === ''}
              onPress={() => void agir('quota', async () => { appliquer(await api.reglerIa({ quotaAppels: Number(quotaAppels), quotaVerifications: Number(quotaVerifs) })); return trJeux('jeux.quota_enregistre'); })}
              testID="esport-jeux-admin-quota-enregistrer"
            />
          </View>
        </Carte>
        <Carte theme={theme} testID="esport-jeux-admin-dernier">
          <TitreCarte theme={theme} titre={trJeux('jeux.dernier_appel')} />
          {etat.dernierAppel ? (
            <>
              {ligne(trJeux('jeux.date'), dateCourte(etat.dernierAppel.le))}
              {ligne(trJeux('jeux.genre'), trJeux(`jeux.genre.${(['brouillon', 'sources', 'verification', 'test'] as const).find(g => g === etat.dernierAppel?.genre) ?? 'test'}`))}
              {ligne(trJeux('jeux.resultat'), etat.dernierAppel.statut === 'ok' ? trJeux('jeux.reussi') : etat.dernierAppel.erreur ?? trJeux('jeux.echec'))}
              {etat.dernierAppel.dureeMs !== null ? ligne(trJeux('jeux.duree'), `${Math.round(etat.dernierAppel.dureeMs / 100) / 10} s`) : null}
            </>
          ) : (
            <Text style={attenue(theme, 13)}>{trJeux('jeux.aucun_appel')}</Text>
          )}
          {etat.verifications.length ? <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trJeux('jeux.dernieres_verifications')}</Text> : null}
          {etat.verifications.slice(0, 5).map(v => (
            <Text key={v.id} style={attenue(theme, 12)}>{`${dateCourte(v.le)} · ${v.jeu} · ${trJeux(`jeux.declenchement.${v.declenchement === 'auto' ? 'auto' : 'manuel'}`)} · ${trJeux(`jeux.statut.${(['attente', 'en_cours', 'pret', 'echec', 'valide', 'abandonne', 'termine'] as const).find(s => s === v.statut) ?? 'echec'}`)}${v.erreur ? ` (${v.erreur.message})` : ''}`}</Text>
          ))}
        </Carte>
        <Carte theme={theme} testID="esport-jeux-admin-gestionnaires">
          <TitreCarte theme={theme} titre={trJeux('jeux.delegations')} sous={trJeux('jeux.delegations_aide')} />
          {(gestionnaires ?? []).length === 0 ? <Text style={attenue(theme, 13)}>{trJeux('jeux.aucune_delegation')}</Text> : null}
          {(gestionnaires ?? []).map(g => (
            <View key={g.compte} style={[styles.ligne, { gap: ESP.s, alignItems: 'center' }]}>
              <Text style={{ ...texte(theme, 14), flex: 1 }}>{g.pseudo ?? g.compte}</Text>
              <BoutonHub theme={theme} titre={trJeux('jeux.retirer')} onPress={() => void agir('delegation', async () => setGestionnaires(await api.reglerGestionnaires({ retirer: [g.compte] })))} testID={`esport-jeux-admin-retirer-${g.compte}`} />
            </View>
          ))}
          {candidats.length ? (
            <>
              <Choix<string> theme={theme} libelle={trJeux('jeux.ajouter_delegue')} valeur={ajout} options={candidats.slice(0, 40).map(c => ({ id: c.compte, nom: c.pseudo }))} onChoisir={setAjout} testID="esport-jeux-admin-delegue" />
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={trJeux('jeux.accorder')} desactive={!ajout} onPress={() => void agir('delegation', async () => { setGestionnaires(await api.reglerGestionnaires({ ajouter: [ajout] })); setAjout(''); })} testID="esport-jeux-admin-accorder" />
              </View>
            </>
          ) : null}
        </Carte>
      </Grille>
    </View>
  );
}

