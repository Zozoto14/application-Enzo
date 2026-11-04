/**
 * Sous-onglet « Ressources » du groupe DATA de l'espace CM (docs/esport/cm.md) : les liens utiles de l'équipe CM.
 * Chaque lien : titre, domaine (aperçu sans aucune image externe : icône locale), description, étiquette, team
 * facultative, épinglage, ordre manuel ; recherche et filtres ; ajout et modification (cm.editer), suppression
 * (cm.gerer) ; ouverture dans un nouvel onglet (`noopener,noreferrer`) ; « où est-il lié » (cartes et dossiers du Drive
 * que le compte voit, avec un raccourci pour y aller). Qui voit la ressource (migration 0048) : cadenas et personnes
 * autorisées sur la ligne, « Qui voit la ressource… » et « Partager avec… » dans le menu ⋯, pastille « Nouveau » jusqu'à
 * l'ouverture, filtre « Partagé avec moi ». Tout est décidé par le serveur.
 * Fichiers (migration 0051) : « + Ajouter » → Lien ou Fichier (FormFichier.tsx : envoi depuis l'appareil, plusieurs à la
 * fois, ou choix dans un Drive) ; icône du type, taille, vignette, aperçu au clic (aperçus du Drive : image, vidéo, son,
 * PDF…), Télécharger, Remplacer le fichier (nouvelle version), filtre par type. Fichier d'un Drive que le compte ne voit
 * pas : « Fichier d'un Drive auquel vous n'avez pas accès », sans nom ni lien.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { TYPES_RESSOURCE, apiLiens, deplacerLien, fichierLisible, fichierPourApercu, filtrerLiens, type FiltreLiens, type LienCm, type Liaisons, type ListeLiens } from '../../../cm/liens';
import { GLYPHES_DRIVE, PORTEE_CLUB } from '../../../cm/drive';
import { choisirFichier, choixFichierDisponible } from '../../../medias/choixFichier';
import { trLi, trnLi } from '../../../i18n/liens';
import { Icone } from '../../../../ui/icones';
import { useTempsReel } from '../../../tempsReel/hooks';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, MenuActions, SqueletteCartes, TitreCarte, Volet, attenue, initiales, texte } from '../../design';
import { signalerEtatCm } from '../commun';
import { BarreEnvoi, useEnvoi } from '../../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import { ApercuDrive } from '../drive/ApercuDrive';
import { infosFichier } from '../drive/commun';
import { AccesRessource, PartageRessource } from './AccesRessource';
import { FormFichier, PORTEE_ENVOI_RESSOURCES } from './FormFichier';
import { FormLien } from './FormLien';
import { ouvrirAdresse } from './ouvrirAdresse';

export function Ressources({
  theme,
  client,
  large,
  onOuvrirTableau,
  onOuvrirDossier,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  onOuvrirTableau?(tableauId: string): void;
  onOuvrirDossier?(portee: string, dossierId: string): void;
}) {
  const api = useMemo(() => apiLiens(client), [client]);
  const [liste, setListe] = useState<ListeLiens | undefined>();
  const [filtre, setFiltre] = useState<FiltreLiens>({});
  const [formulaire, setFormulaire] = useState<{ lien?: LienCm } | undefined>();
  const [ou, setOu] = useState<{ lien: LienCm; liaisons?: Liaisons } | undefined>();
  const [aSupprimer, setASupprimer] = useState<LienCm | undefined>();
  const [reglageAcces, setReglageAcces] = useState<LienCm | undefined>();
  const [partage, setPartage] = useState<LienCm | undefined>();
  const [ajoutFichiers, setAjoutFichiers] = useState(false);
  const [apercu, setApercu] = useState<LienCm | undefined>();
  const envoi = useEnvoi();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setListe(await api.lister()), [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : lien ajouté, modifié, épinglé, lié ou supprimé par un autre → liste relue.
  useTempsReel(client, 'cm', () => void charger().catch(() => undefined));

  const editer = liste?.droits.editer ?? false;
  const gerer = liste?.droits.gerer ?? false;
  const filtres = Boolean(filtre.q?.trim() || filtre.categorie || filtre.team || filtre.epingles || filtre.partages || filtre.type);
  const avecFichiers = Boolean(liste?.liens.some(l => l.genre === 'fichier'));
  const affiches = useMemo(() => filtrerLiens(liste?.liens ?? [], filtre), [liste, filtre]);
  const teamsPresentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of liste?.liens ?? []) if (l.team) m.set(l.team.id, l.team.nom);
    return [...m].map(([id, nom]) => ({ id, nom }));
  }, [liste]);

  // Ressource partagée pas encore ouverte : « Nouveau » disparaît (état en base), pastille de l'onglet relue.
  const marquerVu = (lien: LienCm) => {
    if (!lien.nouveau) return;
    void api
      .vu(lien.id)
      .then(charger)
      .then(signalerEtatCm)
      .catch(() => undefined);
  };
  // Fichier : aperçu (volet) ; lien : nouvel onglet.
  const ouvrir = (lien: LienCm) => {
    if (lien.genre === 'fichier') {
      if (fichierLisible(lien)) setApercu(lien);
    } else ouvrirAdresse(lien.url);
    marquerVu(lien);
  };
  const urlFichier = (lien: LienCm, telecharger = false) => async () => (await api.lienFichier(lien.id, { telecharger })).url;
  const telecharger = (lien: LienCm) => {
    marquerVu(lien);
    void ouvrirLienDiffere(urlFichier(lien, true));
  };
  // Remplacer le fichier : envoi (portée « ressources »), puis nouvelle version (le serveur revérifie les droits).
  const remplacer = (lien: LienCm) =>
    agir('remplacer', async () => {
      const f = fichierLisible(lien);
      const fichier = await choisirFichier('', 'esport-cm-ressources-remplacer-champ');
      if (!fichier || !f) return undefined;
      const { etat, oublier } = await envoi.lancer({ client, teamId: PORTEE_ENVOI_RESSOURCES, section: 'drive', fichier });
      await api.remplacerFichier(lien.id, etat.id, f.version);
      oublier();
      envoi.effacer();
      await charger();
      return trLi('fichier.remplace');
    });
  const ouvrirOu = (lien: LienCm) => {
    marquerVu(lien);
    setOu({ lien });
    void agir('liaisons', async () => setOu({ lien, liaisons: await api.liaisons(lien.id) }));
  };
  const delier = async (lien: LienCm, genre: 'carte' | 'dossier', id: string) => {
    await agir('delier', async () => {
      setOu({ lien, liaisons: await api.delier(lien.id, genre, id) });
      await charger();
    });
  };
  const deplacer = (id: string, sens: -1 | 1) => {
    const ids = deplacerLien(liste?.liens ?? [], id, sens);
    if (ids) void agir('ordre', async () => setListe(await api.ordonner(ids)));
  };

  const ligne = (l: LienCm) => {
    const d = l.droits ?? { modifier: editer, supprimer: gerer, acces: false, partager: false };
    const fichier = fichierLisible(l);
    const ordre = editer && !filtres;
    const premier = deplacerLien(liste?.liens ?? [], l.id, -1) === null;
    const dernier = deplacerLien(liste?.liens ?? [], l.id, 1) === null;
    return (
      <Carte key={l.id} theme={theme} dense testID={`esport-cm-lien-${l.id}`} accent={l.epingle ? theme.accent : undefined}>
        <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', minWidth: 0 }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, 0.12) }}>
            <Icone nom={fichier ? GLYPHES_DRIVE[fichier.genre] : l.genre === 'fichier' ? 'document' : 'globe'} taille={20} couleur={theme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Pressable
              accessibilityRole={l.genre === 'fichier' ? 'button' : 'link'}
              accessibilityLabel={l.genre === 'fichier' ? trLi('fichier.apercu_de', { titre: l.titre }) : trLi('ouvrir_lien', { titre: l.titre })}
              disabled={l.genre === 'fichier' && !fichier}
              onPress={() => ouvrir(l)}
              testID={`esport-cm-lien-${l.id}-ouvrir`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {l.titre}
              </Text>
            </Pressable>
            {l.genre === 'fichier' ? (
              <Text style={{ ...attenue(theme, 13), color: fichier ? theme.accent : theme.attenue }} numberOfLines={2} testID={`esport-cm-lien-${l.id}-fichier`}>
                {fichier
                  ? [fichier.nom, infosFichier(fichierPourApercu(l, fichier)), fichier.source === 'drive' ? `${trLi('fichier.depuis_drive')} (${fichier.portee === PORTEE_CLUB ? trLi('fichier.drive_club') : trLi('fichier.drive_team')})` : ''].filter(Boolean).join(' · ')
                  : l.fichier?.etat === 'supprime'
                    ? trLi('fichier.supprime')
                    : trLi('fichier.inaccessible')}
              </Text>
            ) : (
              <Text style={{ ...attenue(theme, 13), color: theme.accent }} numberOfLines={1} testID={`esport-cm-lien-${l.id}-hote`}>
                {l.hote}
              </Text>
            )}
            {l.description ? (
              <Text style={attenue(theme, 14)} numberOfLines={3}>
                {l.description}
              </Text>
            ) : null}
          </View>
        </View>
        {fichier?.vignette && fichier.genre === 'image' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={trLi('fichier.apercu_de', { titre: l.titre })} onPress={() => ouvrir(l)} testID={`esport-cm-lien-${l.id}-vignette`}>
            <Image source={{ uri: fichier.vignette }} resizeMode="contain" accessibilityIgnoresInvertColors style={{ width: '100%', height: 120, borderRadius: 10, backgroundColor: teinteTransparente(theme.accent, 0.06) }} />
          </Pressable>
        ) : null}
        <View style={[styles.ligne, { gap: ESP.xxs, flexWrap: 'wrap' }]}>
          {l.nouveau ? <Badge theme={theme} texte={trLi('nouveau_badge')} ton="accent" testID={`esport-cm-lien-${l.id}-nouveau`} /> : null}
          {l.acces === 'restreint' ? (
            <View accessible accessibilityLabel={`${trLi('restreint_libelle')} ${l.autorises?.personnes.length ? trLi('autorises', { noms: l.autorises.personnes.map(p => p.pseudo).join(', ') }) : ''}`.trim()} style={[styles.ligne, { gap: ESP.xxs, flexWrap: 'wrap', alignItems: 'center' }]} testID={`esport-cm-lien-${l.id}-restreint`}>
              <Badge theme={theme} texte={trLi('restreint_badge')} icone="cadenas" />
              {l.autorises?.personnes.length ? (
                <View style={{ flexDirection: 'row', gap: 2 }} testID={`esport-cm-lien-${l.id}-autorises`}>
                  {l.autorises.personnes.map(p => (
                    <View key={p.compte} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: teinteTransparente(theme.accent, 0.25), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: theme.texte, fontSize: 9, fontWeight: '800' }}>{initiales(p.pseudo)}</Text>
                    </View>
                  ))}
                  {l.autorises.total > l.autorises.personnes.length ? <Text style={attenue(theme, 12)}>{trLi('autorises_plus', { n: l.autorises.total - l.autorises.personnes.length })}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {l.epingle ? <Badge theme={theme} texte={trLi('epingle')} ton="accent" icone="epingle" testID={`esport-cm-lien-${l.id}-epingle`} /> : null}
          {l.categorie ? <Badge theme={theme} texte={l.categorie} testID={`esport-cm-lien-${l.id}-categorie`} /> : null}
          {l.team ? <Badge theme={theme} texte={trLi('form.team_de', { nom: l.team.nom })} testID={`esport-cm-lien-${l.id}-team`} /> : null}
          {l.liaisons ? <Badge theme={theme} texte={trnLi('lies.n', l.liaisons)} icone="lien" testID={`esport-cm-lien-${l.id}-liaisons`} /> : null}
        </View>
        <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
          {l.genre !== 'fichier' ? (
            <BoutonHub theme={theme} titre={trLi('ouvrir')} icone="externe" libelle={trLi('ouvrir_lien', { titre: l.titre })} onPress={() => ouvrir(l)} testID={`esport-cm-lien-${l.id}-aller`} />
          ) : fichier ? (
            <View style={[styles.ligne, { gap: ESP.xs, flexShrink: 1 }]}>
              <BoutonHub theme={theme} titre={trLi('fichier.apercu')} icone="oeil" libelle={trLi('fichier.apercu_de', { titre: l.titre })} onPress={() => ouvrir(l)} testID={`esport-cm-lien-${l.id}-apercu`} />
              <BoutonHub theme={theme} titre={trLi('fichier.telecharger')} libelle={trLi('fichier.telecharger_de', { titre: l.titre })} onPress={() => telecharger(l)} testID={`esport-cm-lien-${l.id}-telecharger`} />
            </View>
          ) : (
            <View />
          )}
          <MenuActions
            theme={theme}
            testID={`esport-cm-lien-${l.id}-menu`}
            actions={[
              { titre: trLi('lies.voir'), onPress: () => ouvrirOu(l), testID: `esport-cm-lien-${l.id}-voir-liaisons` },
              d.partager && { titre: trLi('partage.menu'), onPress: () => setPartage(l), testID: `esport-cm-lien-${l.id}-partager` },
              d.acces && { titre: trLi('acces.menu'), onPress: () => setReglageAcces(l), testID: `esport-cm-lien-${l.id}-acces` },
              d.modifier && { titre: trLi('modifier'), onPress: () => setFormulaire({ lien: l }), testID: `esport-cm-lien-${l.id}-modifier` },
              fichier?.remplacer && choixFichierDisponible && !envoi.enCours && { titre: trLi('fichier.remplacer'), onPress: () => void remplacer(l), testID: `esport-cm-lien-${l.id}-remplacer` },
              d.modifier && { titre: l.epingle ? trLi('desepingler') : trLi('epingler'), onPress: () => void agir('epingle', async () => { await api.modifier(l.id, { epingle: !l.epingle }); await charger(); }), testID: `esport-cm-lien-${l.id}-epingler` },
              ordre && !premier && { titre: trLi('monter'), onPress: () => deplacer(l.id, -1), testID: `esport-cm-lien-${l.id}-monter` },
              ordre && !dernier && { titre: trLi('descendre'), onPress: () => deplacer(l.id, 1), testID: `esport-cm-lien-${l.id}-descendre` },
              d.supprimer && { titre: trLi('supprimer'), danger: true, onPress: () => setASupprimer(l), testID: `esport-cm-lien-${l.id}-supprimer` },
            ]}
          />
        </View>
      </Carte>
    );
  };

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-ressources">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-ressources" />
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trLi('recherche')} valeur={filtre.q ?? ''} onChanger={q => setFiltre({ ...filtre, q })} maxLength={80} testID="esport-cm-ressources-recherche" style={{ flex: 1, minWidth: 200 }} />
        {editer ? (
          <MenuActions
            theme={theme}
            titreBouton={trLi('ajouter')}
            libelle={trLi('ajouter_libelle')}
            testID="esport-cm-ressources-nouveau"
            actions={[
              { titre: trLi('ajouter.lien'), onPress: () => setFormulaire({}), testID: 'esport-cm-ressources-nouveau-lien' },
              { titre: trLi('ajouter.fichier'), onPress: () => setAjoutFichiers(true), testID: 'esport-cm-ressources-nouveau-fichier' },
            ]}
          />
        ) : null}
      </View>
      <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-cm-ressources-envoi" />
      {liste && (avecFichiers || filtre.type || liste.categories.length || teamsPresentes.length || liste.liens.some(l => l.epingle || l.partageAvecMoi)) ? (
        <View style={{ gap: ESP.xs }}>
          {avecFichiers || filtre.type ? (
            <Choix theme={theme} libelle={trLi('filtre.type')} valeur={filtre.type ?? ''} options={[{ id: '', nom: trLi('type.tous') }, ...TYPES_RESSOURCE.map(t => ({ id: t, nom: trLi(`type.${t}`) }))]} onChoisir={t => setFiltre({ ...filtre, type: (t || undefined) as FiltreLiens['type'] })} testID="esport-cm-ressources-type" />
          ) : null}
          {liste.categories.length ? (
            <Choix theme={theme} libelle={trLi('filtre.categorie')} valeur={filtre.categorie ?? ''} options={[{ id: '', nom: trLi('filtre.toutes') }, ...liste.categories.map(c => ({ id: c, nom: c }))]} onChoisir={c => setFiltre({ ...filtre, categorie: c || undefined })} testID="esport-cm-ressources-categorie" />
          ) : null}
          {teamsPresentes.length ? (
            <Choix theme={theme} libelle={trLi('filtre.team')} valeur={filtre.team ?? ''} options={[{ id: '', nom: trLi('filtre.toutes') }, { id: 'club', nom: trLi('filtre.club') }, ...teamsPresentes]} onChoisir={t => setFiltre({ ...filtre, team: t || undefined })} testID="esport-cm-ressources-team" />
          ) : null}
          <Interrupteur theme={theme} libelle={trLi('filtre.epingles')} valeur={Boolean(filtre.epingles)} onChanger={v => setFiltre({ ...filtre, epingles: v || undefined })} testID="esport-cm-ressources-epingles" />
          {liste.liens.some(l => l.partageAvecMoi) || filtre.partages ? (
            <Interrupteur theme={theme} libelle={trLi('filtre.partages')} valeur={Boolean(filtre.partages)} onChanger={v => setFiltre({ ...filtre, partages: v || undefined })} testID="esport-cm-ressources-partages" />
          ) : null}
        </View>
      ) : null}
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.liens.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="lien" titre={trLi('vide')} texte={editer ? trLi('vide_texte') : undefined} testID="esport-cm-ressources-vide" />
        </Carte>
      ) : null}
      {liste?.liens.length ? (
        <>
          <Text style={attenue(theme, 13)} testID="esport-cm-ressources-compte">
            {trnLi('compte', affiches.length)}
          </Text>
          {affiches.length ? (
            <Grille min={large ? 340 : 260} testID="esport-cm-ressources-liste">
              {affiches.map(l => ligne(l))}
            </Grille>
          ) : (
            <Text style={attenue(theme, 14)} testID="esport-cm-ressources-aucun">
              {trLi('vide_filtre')}
            </Text>
          )}
        </>
      ) : null}

      {formulaire && liste ? (
        <FormLien
          theme={theme}
          lien={formulaire.lien}
          categories={liste.categories}
          teams={liste.teams}
          optionsAcces={formulaire.lien ? undefined : teamId => api.optionsAcces(teamId)}
          onFermer={() => setFormulaire(undefined)}
          onEnregistrer={async s => {
            if (formulaire.lien) await api.modifier(formulaire.lien.id, s);
            else await api.creer(s);
            await charger();
          }}
        />
      ) : null}

      {ajoutFichiers && liste ? <FormFichier theme={theme} client={client} api={api} liste={liste} onFini={charger} onFermer={() => setAjoutFichiers(false)} /> : null}

      {apercu && fichierLisible(apercu) ? <ApercuRessource theme={theme} lien={apercu} obtenirUrl={urlFichier(apercu)} onTelecharger={() => telecharger(apercu)} onFermer={() => setApercu(undefined)} /> : null}

      {ou ? (
        <Volet theme={theme} visible titre={trLi('lies.titre')} onFermer={() => setOu(undefined)} testID="esport-cm-ressources-liaisons-volet" largeur={460}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={ou.lien.titre} />
            {!ou.liaisons ? <Text style={attenue(theme, 14)}>…</Text> : null}
            {ou.liaisons && !ou.liaisons.cartes.length && !ou.liaisons.dossiers.length ? <Text style={attenue(theme, 14)} testID="esport-cm-ressources-liaisons-vide">{trLi('lies.vide')}</Text> : null}
            {ou.liaisons?.cartes.map(c => (
              <View key={c.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
                <Icone nom="tableau" taille={18} couleur={theme.accent} />
                <Pressable accessibilityRole="link" accessibilityLabel={trLi('lies.aller_carte', { titre: c.titre })} onPress={() => onOuvrirTableau?.(c.tableauId)} disabled={!onOuvrirTableau} style={{ flex: 1, minWidth: 0 }} testID={`esport-cm-ressources-carte-${c.id}`}>
                  <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }} numberOfLines={2}>{trLi('lies.carte', { titre: c.titre, tableau: c.tableau ?? '' })}</Text>
                </Pressable>
                {ou.liaisons?.droits.editer && c.modifier ? <BoutonHub theme={theme} titre={trLi('lies.delier')} onPress={() => void delier(ou.lien, 'carte', c.id)} testID={`esport-cm-ressources-carte-${c.id}-delier`} /> : null}
              </View>
            ))}
            {ou.liaisons?.dossiers.map(d => (
              <View key={d.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
                <Icone nom="dossier" taille={18} couleur={theme.accent} />
                <Pressable accessibilityRole="link" accessibilityLabel={trLi('lies.aller_dossier', { chemin: d.chemin.join(' › ') })} onPress={() => onOuvrirDossier?.(d.portee, d.id)} disabled={!onOuvrirDossier} style={{ flex: 1, minWidth: 0 }} testID={`esport-cm-ressources-dossier-${d.id}`}>
                  <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }} numberOfLines={2}>{trLi('lies.dossier', { chemin: d.chemin.join(' › ') })}</Text>
                </Pressable>
                {ou.liaisons?.droits.editer && d.modifier ? <BoutonHub theme={theme} titre={trLi('lies.delier')} onPress={() => void delier(ou.lien, 'dossier', d.id)} testID={`esport-cm-ressources-dossier-${d.id}-delier`} /> : null}
              </View>
            ))}
          </View>
        </Volet>
      ) : null}

      {reglageAcces ? (
        <Volet theme={theme} visible titre={trLi('acces.titre')} onFermer={() => setReglageAcces(undefined)} testID="esport-cm-ressources-acces-volet" largeur={520}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={reglageAcces.titre} />
            <AccesRessource theme={theme} api={api} lien={reglageAcces} onChange={charger} />
          </View>
        </Volet>
      ) : null}

      {partage ? (
        <Volet theme={theme} visible titre={trLi('partage.titre')} onFermer={() => setPartage(undefined)} testID="esport-cm-ressources-partage-volet" largeur={480}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={partage.titre} />
            <PartageRessource theme={theme} api={api} lien={partage} onChange={charger} />
          </View>
        </Volet>
      ) : null}

      {aSupprimer ? (
        <Volet theme={theme} visible titre={trLi('supprimer')} onFermer={() => setASupprimer(undefined)} testID="esport-cm-ressources-supprimer-volet" largeur={420}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={aSupprimer.titre} />
            <Text style={attenue(theme, 14)}>{trLi('supprimer_info')}</Text>
            <BoutonConfirme
              theme={theme}
              titre={trLi('supprimer')}
              confirmation={trLi('supprimer_confirme')}
              testID="esport-cm-ressources-supprimer"
              onConfirme={() =>
                void agir('supprimer', async () => {
                  await api.supprimer(aSupprimer.id);
                  setASupprimer(undefined);
                  await charger();
                  return trLi('supprime');
                })
              }
            />
          </View>
        </Volet>
      ) : null}
    </View>
  );
}

/** Aperçu du fichier d'une ressource (volet) : aperçus du Drive (image, vidéo, son, police, texte, PDF), Télécharger. */
function ApercuRessource({ theme, lien, obtenirUrl, onTelecharger, onFermer }: { theme: ThemeHub; lien: LienCm; obtenirUrl(): Promise<string>; onTelecharger(): void; onFermer(): void }) {
  const f = fichierLisible(lien);
  // Lien signé stable pour le lecteur (un nouvel objet à chaque rendu relancerait le chargement).
  const [obtenir] = useState(() => obtenirUrl);
  if (!f) return null;
  const pourApercu = fichierPourApercu(lien, f);
  return (
    <Volet theme={theme} visible titre={lien.titre} onFermer={onFermer} testID="esport-cm-ressources-apercu-volet" largeur={620}>
      <View style={{ gap: ESP.s, padding: ESP.l }}>
        <ApercuDrive theme={theme} fichier={pourApercu} obtenirUrl={obtenir} />
        <Text style={attenue(theme, 13)} testID="esport-cm-ressources-apercu-infos">
          {[f.nom, infosFichier(pourApercu)].join(' · ')}
        </Text>
        <BoutonHub theme={theme} titre={trLi('fichier.telecharger')} variante="plein" onPress={onTelecharger} testID="esport-cm-ressources-apercu-telecharger" />
      </View>
    </Volet>
  );
}
