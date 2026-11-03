/**
 * Drive de la section CM (docs/esport/drive.md) : Drive du club et des teams, dossiers (fil d'Ariane, dossiers
 * par défaut, dossiers restreints), fichiers en grille ou en liste, tri, recherche et filtres (type, étiquette,
 * auteur, dates, favoris), envoi multiple et glisser-déposer (envoi par morceaux avec reprise), sélection et
 * actions groupées (déplacer, copier, corbeille), corbeille, espace utilisé, réglages du rangement automatique.
 *
 * Tout est décidé par le serveur (droits, visibilité) ; l'écran n'affiche que ce que la réponse permet. Un
 * joueur sans droit sur le Drive ne voit que le dossier « Dépôt joueurs » et ses propres fichiers.
 *
 * Migration 0038 : déplacer à la souris (glisser-déposer sur un dossier, le fil d'Ariane ou l'arborescence
 * latérale ; Ctrl / Maj-clic et cadre de sélection ; toast « Annuler » ; appui long sur écran tactile, menu
 * « Déplacer vers… » partout) et pastilles de nouveautés par dossier (état « vu » gardé par le serveur).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import {
  GENRES_DRIVE,
  GLYPHES_DRIVE,
  apiDrive,
  groupesAnnulation,
  refusDeplacement,
  lienInterneDrive,
  lireLienDrive,
  trierFichiers,
  type ContenuDrive,
  type CorbeilleDrive,
  type DossierDrive,
  type ElementDeplacable,
  type ElementDrive,
  type FichierDrive,
  type FiltresRecherche,
  type GenreDrive,
  type PorteeDrive,
  type ReglagesDrive,
  type ResultatRechercheDrive,
  type TriDrive,
} from '../../../cm/drive';
import { choisirFichiers, choixFichierDisponible, type FichierNavigateur } from '../../../medias/choixFichier';
import { signalerNouveautesDrive } from '../../../cm/nouveautesDrive';
import { tr } from '../../../i18n';
import { trDr, trnDr, type CleDr } from '../../../i18n/drive';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, Compteur, ESP, EtatVide, Grille, MenuActions, Pliable, SqueletteCartes, Volet, attenue, texte, type EtatPresse } from '../../design';
import { ToastAnnuler } from '../../strats/Suppression';
import { BarreEnvoi, useEnvoi } from '../../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import { Aide, copierTexte, quand } from '../commun';
import { BarreQuota, ChoixDestination, Vignette, infosFichier, nomDossier, nomGenre, nomPortee, taille } from './commun';
import { DetailFichier } from './DetailFichier';
import { GestionTags } from './GestionTags';
import { ZoneDepot } from './ZoneDepot';
import { useTempsReel } from '../../../tempsReel/hooks';
import { ArbreDossiers, FilAriane, styleCible, type NoeudArbre } from './explorateur';
import { useGlisser } from './glisser';

type Dialogue =
  | { genre: 'dossier'; nom: string; restreint: boolean }
  | { genre: 'renommer'; id: string; nom: string; systeme: boolean }
  | { genre: 'destination'; action: 'deplacer' | 'copier'; elements: ElementDrive[] }
  | { genre: 'tags' }
  | { genre: 'reglages' };

const cle = (e: ElementDrive) => `${e.genre}:${e.id}`;

export function Drive({
  theme,
  client,
  large,
  porteeFixe,
  onOuvrirTableau,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  /** Drive d'une seule portée (onglet CM d'une team). */
  porteeFixe?: string;
  onOuvrirTableau?(id: string): void;
}) {
  const api = useMemo(() => apiDrive(client), [client]);
  const [portees, setPortees] = useState<PorteeDrive[] | undefined>();
  const [portee, setPortee] = useState<string | undefined>(porteeFixe);
  const [dossier, setDossier] = useState<string | null>(null);
  const [contenu, setContenu] = useState<ContenuDrive | undefined>();
  const [vue, setVue] = useState<'grille' | 'liste'>(large ? 'grille' : 'liste');
  const [tri, setTri] = useState<TriDrive>('nom');
  const [inverse, setInverse] = useState(false);
  const [q, setQ] = useState('');
  const [filtres, setFiltres] = useState<FiltresRecherche>({});
  const [resultats, setResultats] = useState<ResultatRechercheDrive | undefined>();
  const [optionsFiltres, setOptionsFiltres] = useState<{ tags: Array<{ tag: string; n: number }>; auteurs: Array<{ compte: string; pseudo: string | null }> } | undefined>();
  const [selection, setSelection] = useState<Map<string, ElementDrive>>(new Map());
  const [enSelection, setEnSelection] = useState(false);
  const [detail, setDetail] = useState<string | undefined>();
  const [dialogue, setDialogue] = useState<Dialogue | undefined>();
  const [corbeille, setCorbeille] = useState(false);
  const [versionTags, setVersionTags] = useState(0);
  const [file, setFile] = useState<{ i: number; n: number; nom: string } | undefined>();
  // Arborescence complète (écran large : arbre latéral ; et refus des cycles pendant le glisser).
  const [arbre, setArbre] = useState<Array<{ id: string; parentId: string | null; nom: string | null; cle: DossierDrive['cle']; restreint: boolean }> | undefined>();
  const [versionArbre, setVersionArbre] = useState(0);
  const [toast, setToast] = useState<{ cle: string; texte: string; annuler?: () => void } | undefined>();
  const [ancre, setAncre] = useState<string | undefined>();
  const envoi = useEnvoi();
  const { erreur, avis, agir, setAvis, setErreur } = useAgir();

  const chargerPortees = useCallback(async () => {
    const r = await api.portees();
    setPortees(r.portees);
    setPortee(p => p ?? r.portees[0]?.portee);
  }, [api]);
  useEffect(() => {
    void agir('', chargerPortees);
  }, [agir, chargerPortees]);
  const charger = useCallback(async () => {
    if (!portee) return;
    // `vu` : le dossier ouvert est marqué vu (pastilles de nouveautés, par compte, côté serveur).
    setContenu(await api.lister(portee, dossier, { vu: true }));
    signalerNouveautesDrive();
  }, [api, portee, dossier]);
  useEffect(() => {
    setSelection(new Map());
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : fichier ou dossier ajouté, renommé, déplacé par un autre → relu (la sélection est gardée).
  useTempsReel(client, 'cm:drive', () => void charger().catch(() => undefined));

  const infoPortee = portees?.find(p => p.portee === portee);
  const droits = contenu?.droits ?? infoPortee?.droits;
  const depot = Boolean(droits?.depot);
  useEffect(() => {
    if (!portee || depot || !droits) return undefined;
    let vivant = true;
    api.arbre(portee).then(
      r => vivant && setArbre(r.dossiers),
      () => undefined,
    );
    return () => {
      vivant = false;
    };
  }, [api, portee, depot, droits, versionArbre]);
  const ouvrirDossier = (id: string | null) => {
    setResultats(undefined);
    setCorbeille(false);
    setDossier(id);
  };
  const changerPortee = (p: string) => {
    setPortee(p);
    setDossier(null);
    setArbre(undefined);
    setResultats(undefined);
    setCorbeille(false);
    setOptionsFiltres(undefined);
  };

  // ---------------------------------------------------------------- Envoi (plusieurs fichiers, glisser-déposer)
  const envoyer = (fichiers: FichierNavigateur[]) =>
    agir('envoi', async () => {
      if (!portee || !contenu) return undefined;
      const max = contenu.quota.fichierMax;
      const refuses: string[] = [];
      let ajoutes = 0;
      for (let i = 0; i < fichiers.length; i++) {
        const f = fichiers[i];
        setFile({ i: i + 1, n: fichiers.length, nom: f.nom });
        if (f.taille > max) {
          refuses.push(trDr('envoi.trop_gros', { nom: f.nom, max: taille(max) }));
          continue;
        }
        try {
          const { etat, oublier } = await envoi.lancer({ client, teamId: portee, section: 'drive', fichier: f });
          await api.ajouter({ portee, dossierId: contenu.dossier?.id ?? null, envoi: etat.id });
          oublier();
          ajoutes++;
        } catch (e) {
          if ((e as { code?: string }).code === 'annule') break;
          refuses.push(`${f.nom} : ${e instanceof Error ? e.message : String(e)}`);
          if ((e as { code?: string }).code === 'quota-drive') break;
        }
      }
      setFile(undefined);
      envoi.effacer();
      await charger();
      if (refuses.length) setErreur(trDr('envoi.echecs', { n: refuses.length, liste: refuses.join(' · ') }));
      return ajoutes ? trnDr('envoi.fini', ajoutes) : undefined;
    });
  const peutDeposer = Boolean(droits?.envoyer || droits?.depot) && !corbeille && !resultats;

  // ---------------------------------------------------------------- Recherche
  const chercher = (f: FiltresRecherche = filtres, texteQ: string = q) =>
    agir('recherche', async () => {
      if (!portee) return undefined;
      const lien = lireLienDrive(texteQ);
      if (lien) {
        // Lien interne collé : on ouvre l'élément (s'il est visible).
        const el = await api.element(lien).catch(() => {
          throw new Error(trDr('lien.introuvable'));
        });
        setQ('');
        setPortee(el.portee);
        setDossier(el.genre === 'dossier' ? el.id : el.dossierId);
        setResultats(undefined);
        if (el.genre === 'fichier') setDetail(el.id);
        return undefined;
      }
      setCorbeille(false);
      setResultats(await api.rechercher(portee, { ...f, q: texteQ.trim() || undefined }));
      return undefined;
    });
  const filtresActifs = Boolean(filtres.genre || filtres.tag || filtres.auteur || filtres.du || filtres.au || filtres.favoris || filtres.dossier);
  // Étiquettes et auteurs proposés par les filtres (une requête par Drive ouvert).
  const voit = Boolean(droits?.voir);
  useEffect(() => {
    if (!portee || !voit) return undefined;
    let vivant = true;
    api.filtres(portee).then(
      x => vivant && setOptionsFiltres(x),
      () => undefined,
    );
    return () => {
      vivant = false;
    };
  }, [api, portee, voit, versionTags]);

  // ---------------------------------------------------------------- Actions
  const telecharger = (f: FichierDrive) => void ouvrirLienDiffere(async () => (await api.lien(f.id, { telecharger: true })).url);
  const zip = (d: DossierDrive) =>
    void agir('zip', async () => {
      await ouvrirLienDiffere(async () => (await api.zip(d.id)).url);
    });
  const recharger = () => void agir('', charger);
  const action = (cleAction: string, a: () => Promise<unknown>, message: string = trDr('action.fait')) =>
    agir(cleAction, async () => {
      await a();
      setSelection(new Map());
      setVersionArbre(v => v + 1);
      await charger();
      if (resultats && portee) setResultats(await api.rechercher(portee, { ...filtres, q: q.trim() || undefined }));
      return message;
    });
  const enLot = (a: 'deplacer' | 'copier' | 'corbeille', elements: ElementDrive[], dossierId?: string | null, porteeCible?: string) =>
    action(a, async () => {
      const r = await api.lot({ action: a, elements, dossierId, portee: porteeCible });
      if (r.erreurs.length) throw new Error(trDr('action.erreurs', { n: r.erreurs.length, liste: r.erreurs.map(x => x.erreur).join(' · ') }));
    });
  const lienInterne = async (id: string) => {
    const lien = lienInterneDrive(id);
    setAvis((await copierTexte(lien)) ? trDr('action.lien_copie') : trDr('action.lien_non_copie', { lien }));
  };
  const basculer = (e: ElementDrive) =>
    setSelection(s => {
      const n = new Map(s);
      if (n.has(cle(e))) n.delete(cle(e));
      else n.set(cle(e), e);
      return n;
    });

  // ---------------------------------------------------------------- Déplacer (glisser-déposer, menu), avec « Annuler »
  const nomCible = (id: string | null): string => {
    if (!id) return trDr('racine');
    const d = arbre?.find(x => x.id === id) ?? contenu?.dossiers.find(x => x.id === id) ?? contenu?.chemin.find(x => x.id === id);
    return d ? nomDossier(d) : trDr('dossier.sans_nom');
  };
  const rechargerApresDeplacement = async () => {
    setSelection(new Map());
    setVersionArbre(v => v + 1);
    await charger();
    if (resultats && portee) setResultats(await api.rechercher(portee, { ...filtres, q: q.trim() || undefined }));
  };
  const deplacer = (elements: ElementDeplacable[], cible: string | null) =>
    agir('deplacer', async () => {
      const refs = elements.map(e => ({ genre: e.genre, id: e.id }));
      const r = await api.lot({ action: 'deplacer', elements: refs, dossierId: cible });
      await rechargerApresDeplacement();
      if (r.erreurs.length) setErreur(trDr('action.erreurs', { n: r.erreurs.length, liste: r.erreurs.map(x => x.erreur).join(' · ') }));
      if (!r.faits.length) return undefined;
      const faits = refs.filter(e => r.faits.includes(e.id));
      const avant = r.avant ?? {};
      setToast({
        cle: `${Date.now()}`,
        texte: trnDr('deplace.n', faits.length, { nom: nomCible(cible) }),
        annuler: () => {
          setToast(undefined);
          void agir('annuler', async () => {
            for (const g of groupesAnnulation(faits, avant)) await api.lot({ action: 'deplacer', elements: g.elements, dossierId: g.dossierId });
            await rechargerApresDeplacement();
            setToast({ cle: `${Date.now()}`, texte: trDr('deplace.annule') });
            return undefined;
          });
        },
      });
      return undefined;
    });

  // ---------------------------------------------------------------- Éléments affichés
  const dossiers: DossierDrive[] = resultats ? resultats.dossiers : (contenu?.dossiers ?? []);
  const fichiers: FichierDrive[] = trierFichiers(resultats ? resultats.fichiers : (contenu?.fichiers ?? []), tri, inverse);
  const dossiersTries = [...dossiers].sort((a, b) => (a.cle && !b.cle ? -1 : !a.cle && b.cle ? 1 : nomDossier(a).localeCompare(nomDossier(b))));
  const noms = { ...(contenu?.noms ?? {}), ...(resultats?.noms ?? {}) };
  const nomDe = (c: string | null) => (c ? (noms[c] ?? (c === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.compte_supprime'));
  const tous: ElementDrive[] = [...dossiersTries.map(d => ({ genre: 'dossier' as const, id: d.id })), ...fichiers.map(f => ({ genre: 'fichier' as const, id: f.id }))];
  const infos = new Map<string, ElementDeplacable & { nom: string }>([
    ...dossiersTries.map(d => [`dossier:${d.id}`, { genre: 'dossier' as const, id: d.id, parentId: d.parentId, modifiable: d.modifiable, systeme: d.systeme, nom: nomDossier(d) }] as const),
    ...fichiers.map(f => [`fichier:${f.id}`, { genre: 'fichier' as const, id: f.id, parentId: f.dossierId, modifiable: f.modifiable, nom: f.nom }] as const),
  ]);
  const nouveautes = contenu?.nouveautes ?? null;
  const arbreConnu: Array<{ id: string; parentId: string | null }> = arbre ?? dossiersTries;
  const raisonRefus = (r: string) => trDr(`glisser.refus.${r}` as CleDr);
  const glisser = useGlisser({
    actif: Boolean(droits && !droits.depot && !corbeille),
    couleurs: { fond: theme.surface, texte: theme.texte, accent: theme.accent, critique: theme.critique },
    sources: c => (selection.has(c) ? [...selection.keys()] : [c]).filter(x => infos.has(x)),
    texteSources: src => (src.length === 1 ? (infos.get(src[0])?.nom ?? '') : trnDr('glisser.n', src.length)),
    verifier: (src, c) => {
      const cible = c === 'racine' ? null : c;
      const els = src.map(x => infos.get(x)).filter((x): x is ElementDeplacable & { nom: string } => Boolean(x));
      const refus = refusDeplacement(els, cible, arbreConnu);
      const restreint = cible ? Boolean(arbre?.find(x => x.id === cible)?.restreint ?? contenu?.dossiers.find(x => x.id === cible)?.restreint) : false;
      return { refus: refus ? raisonRefus(refus) : null, libelle: nomCible(cible), note: restreint ? trDr('glisser.restreint') : undefined };
    },
    lacher: (src, c) => {
      const els = src.map(x => infos.get(x)).filter((x): x is ElementDeplacable & { nom: string } => Boolean(x));
      void deplacer(els, c === 'racine' ? null : c);
    },
    refuse: r => setErreur(r),
    cadre: (cles, ajout) =>
      setSelection(s => {
        const n = ajout ? new Map(s) : new Map<string, ElementDrive>();
        for (const c of cles) {
          const i = infos.get(c);
          if (i) n.set(c, { genre: i.genre, id: i.id });
        }
        return n;
      }),
    videClique: () => setSelection(new Map()),
  });
  /** Clic sur un élément : Ctrl / Cmd ajoute ou retire, Maj étend la sélection ; sinon il s'ouvre. */
  const clic = (e: ElementDrive, ouvrir: () => void) => {
    if (glisser.vientDeGlisser()) return;
    const m = glisser.modificateurs();
    if (m.plage && ancre) {
      const i = tous.findIndex(x => cle(x) === ancre);
      const j = tous.findIndex(x => cle(x) === cle(e));
      if (i >= 0 && j >= 0) {
        setSelection(s => {
          const n = new Map(s);
          for (const x of tous.slice(Math.min(i, j), Math.max(i, j) + 1)) n.set(cle(x), x);
          return n;
        });
        return;
      }
    }
    if (m.ajout || m.plage || enSelection || selection.size) {
      basculer(e);
      setAncre(cle(e));
      return;
    }
    setAncre(cle(e));
    ouvrir();
  };
  const selectionVisible = enSelection || selection.size > 0;

  const menuDossier = (d: DossierDrive) => (
    <MenuActions
      theme={theme}
      testID={`esport-drive-dossier-${d.id}-menu`}
      actions={[
        { titre: trDr('action.ouvrir'), onPress: () => ouvrirDossier(d.id) },
        droits?.voir && { titre: trDr('action.zip'), onPress: () => zip(d) },
        { titre: d.favori ? trDr('action.retirer_favori') : trDr('action.favori'), onPress: () => void action('favori', () => api.favori('dossier', d.id, !d.favori)) },
        { titre: trDr('action.lien_interne'), onPress: () => void lienInterne(d.id) },
        d.modifiable && { titre: trDr('action.renommer'), onPress: () => setDialogue({ genre: 'renommer', id: d.id, nom: d.nom ?? nomDossier(d), systeme: d.systeme }) },
        d.modifiable && !d.systeme && { titre: trDr('action.deplacer'), onPress: () => setDialogue({ genre: 'destination', action: 'deplacer', elements: [{ genre: 'dossier', id: d.id }] }) },
        droits?.gerer && { titre: d.restreint ? trDr('action.ouvrir_a_tous') : trDr('action.restreindre'), onPress: () => void action('restreint', () => api.modifierDossier(d.id, { restreint: !d.restreint })) },
        d.modifiable && !d.systeme && { titre: trDr('action.corbeille'), danger: true, onPress: () => void action('corbeille', () => api.corbeilleDossier(d.id)) },
      ]}
    />
  );
  const menuFichier = (f: FichierDrive) => (
    <MenuActions
      theme={theme}
      testID={`esport-drive-fichier-${f.id}-menu`}
      actions={[
        { titre: trDr('action.details'), onPress: () => setDetail(f.id) },
        { titre: trDr('action.telecharger'), onPress: () => telecharger(f) },
        { titre: f.favori ? trDr('action.retirer_favori') : trDr('action.favori'), onPress: () => void action('favori', () => api.favori('fichier', f.id, !f.favori)) },
        { titre: trDr('action.lien_interne'), onPress: () => void lienInterne(f.id) },
        f.modifiable && { titre: trDr('action.renommer'), onPress: () => setDialogue({ genre: 'renommer', id: f.id, nom: f.nom, systeme: false }) },
        f.modifiable && !droits?.depot && { titre: trDr('action.deplacer'), onPress: () => setDialogue({ genre: 'destination', action: 'deplacer', elements: [{ genre: 'fichier', id: f.id }] }) },
        droits?.envoyer && { titre: trDr('action.copier'), onPress: () => setDialogue({ genre: 'destination', action: 'copier', elements: [{ genre: 'fichier', id: f.id }] }) },
        f.modifiable && { titre: trDr('action.corbeille'), danger: true, onPress: () => void action('corbeille', () => api.corbeilleFichier(f.id)) },
      ]}
    />
  );
  const caseSelection = (e: ElementDrive, nom: string) => (selectionVisible ? <Case theme={theme} coche={selection.has(cle(e))} libelle={trDr('element.selectionner', { nom })} onChanger={() => basculer(e)} testID={`esport-drive-${e.genre}-${e.id}-case`} /> : null);
  const sousTitreFichier = (f: FichierDrive) => [infosFichier(f), nomDe(f.creePar), quand(f.majLe)].join(' · ');
  const cheminResultat = (dossierId: string | null) => (resultats && dossierId ? trDr('recherche.dans', { chemin: (resultats.chemins[dossierId] ?? []).map(nomDossier).join(' › ') }) : '');

  const elementGrille = (contenuEl: React.ReactNode, e: ElementDrive, nom: string, onOuvrir: () => void, menu: React.ReactNode) => (
    <View style={{ position: 'relative', opacity: glisser.glisses.includes(cle(e)) ? 0.45 : 1, userSelect: 'none' } as object} {...glisser.marque({ source: cle(e), cible: e.genre === 'dossier' ? e.id : undefined })}>
      <Carte theme={theme} dense onPress={() => clic(e, onOuvrir)} libelle={trDr('element.ouvrir', { nom })} testID={`esport-drive-${e.genre}-${e.id}`} style={[selection.has(cle(e)) ? { borderColor: theme.accent, borderWidth: 2 } : undefined, e.genre === 'dossier' ? styleCible(theme, glisser, e.id) : undefined]}>
        {contenuEl}
      </Carte>
      <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        {caseSelection(e, nom)}
        {menu}
      </View>
    </View>
  );

  const vueGrille = (
    <Grille min={large ? 170 : 140} gap={ESP.s} testID="esport-drive-grille">
      {dossiersTries.map(d =>
        elementGrille(
          <View style={{ gap: 6 }}>
            <Vignette theme={theme} f={null} cote={64} />
            <View style={[styles.ligne, { gap: 6, flexWrap: 'nowrap' }]}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700', flex: 1 }} numberOfLines={2}>{`${nomDossier(d)}${d.restreint ? ' 🔒' : ''}${d.favori ? ' ★' : ''}`}</Text>
              <Compteur theme={theme} n={nouveautes?.dossiers[d.id] ?? 0} testID={`esport-drive-dossier-${d.id}-nouveautes`} />
            </View>
            <Text style={attenue(theme, 12)} numberOfLines={1}>{cheminResultat(d.parentId) || trnDr('element.fichiers', d.fichiers)}</Text>
          </View>,
          { genre: 'dossier', id: d.id },
          nomDossier(d),
          () => ouvrirDossier(d.id),
          menuDossier(d),
        ),
      )}
      {fichiers.map(f =>
        elementGrille(
          <View style={{ gap: 6 }}>
            <Vignette theme={theme} f={f} cote={large ? 110 : 90} />
            <Text style={{ ...texte(theme, 13), fontWeight: '700' }} numberOfLines={2}>{`${f.nom}${f.favori ? ' ★' : ''}`}</Text>
            <Text style={attenue(theme, 12)} numberOfLines={1}>{cheminResultat(f.dossierId) || infosFichier(f)}</Text>
            {f.version > 1 ? <Badge theme={theme} texte={trDr('element.version', { n: f.version })} /> : null}
          </View>,
          { genre: 'fichier', id: f.id },
          f.nom,
          () => setDetail(f.id),
          menuFichier(f),
        ),
      )}
    </Grille>
  );

  const ligneListe = (e: ElementDrive, glyphe: string, nom: string, sous: string, onOuvrir: () => void, menu: React.ReactNode, extra?: React.ReactNode) => (
    <View
      key={cle(e)}
      {...glisser.marque({ source: cle(e), cible: e.genre === 'dossier' ? e.id : undefined })}
      style={[styles.ligne, { gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingVertical: 6, flexWrap: 'nowrap', opacity: glisser.glisses.includes(cle(e)) ? 0.45 : 1, userSelect: 'none' } as object, e.genre === 'dossier' ? styleCible(theme, glisser, e.id) : undefined]}
      testID={`esport-drive-${e.genre}-${e.id}`}>
      {caseSelection(e, nom)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={trDr('element.ouvrir', { nom })}
        onPress={() => clic(e, onOuvrir)}
        onLongPress={glisser.disponible ? undefined : () => { setEnSelection(true); basculer(e); }}
        testID={`esport-drive-${e.genre}-${e.id}-ouvrir`}
        style={(p: EtatPresse) => ({ flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ESP.s, borderRadius: 8, paddingHorizontal: 4, backgroundColor: selection.has(cle(e)) ? teinteTransparente(theme.accent, 0.16) : p.hovered ? teinteTransparente(theme.accent, 0.06) : 'transparent' })}>
        <Text style={{ fontSize: 22 }}>{glyphe}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={1}>
            {nom}
          </Text>
          <Text style={attenue(theme, 12)} numberOfLines={1}>
            {sous}
          </Text>
        </View>
        {extra}
      </Pressable>
      {menu}
    </View>
  );
  const vueListe = (
    <View testID="esport-drive-liste">
      {dossiersTries.map(d => ligneListe({ genre: 'dossier', id: d.id }, GLYPHES_DRIVE.dossier, `${nomDossier(d)}${d.restreint ? ' 🔒' : ''}${d.favori ? ' ★' : ''}`, cheminResultat(d.parentId) || trnDr('element.fichiers', d.fichiers), () => ouvrirDossier(d.id), menuDossier(d), <Compteur theme={theme} n={nouveautes?.dossiers[d.id] ?? 0} testID={`esport-drive-dossier-${d.id}-nouveautes`} />))}
      {fichiers.map(f =>
        ligneListe({ genre: 'fichier', id: f.id }, GLYPHES_DRIVE[f.genre], `${f.nom}${f.favori ? ' ★' : ''}`, cheminResultat(f.dossierId) || sousTitreFichier(f), () => setDetail(f.id), menuFichier(f), f.tags.length && large ? <Text style={attenue(theme, 12)}>{f.tags.map(t => `#${t}`).join(' ')}</Text> : null),
      )}
    </View>
  );

  if (!portees && !erreur) return <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} />;
  const vide = contenu && !resultats && !dossiers.length && !fichiers.length;

  return (
    <View ref={glisser.ref as never} style={{ gap: ESP.m }} testID="esport-drive">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-drive" />
      {!porteeFixe && portees && portees.length > 1 ? (
        <Choix theme={theme} libelle={trDr('portee')} valeur={portee} options={portees.map(p => ({ id: p.portee, nom: nomPortee(p) }))} onChoisir={changerPortee} testID="esport-drive-portee" />
      ) : null}

      {/* Barre d'outils */}
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
        {droits?.envoyer && !corbeille ? <BoutonHub theme={theme} titre={trDr('barre.nouveau_dossier')} onPress={() => setDialogue({ genre: 'dossier', nom: '', restreint: false })} testID="esport-drive-nouveau-dossier" /> : null}
        {peutDeposer && choixFichierDisponible ? (
          <BoutonHub theme={theme} titre={trDr('barre.envoyer')} variante="plein" desactive={envoi.enCours} onPress={() => void choisirFichiers('', 'esport-drive-fichiers').then(f => (f.length ? envoyer(f) : undefined))} testID="esport-drive-envoyer" />
        ) : null}
        {droits?.voir ? (
          <BoutonHub
            theme={theme}
            titre={corbeille ? trDr('barre.retour_drive') : trDr('barre.corbeille')}
            onPress={() => {
              setResultats(undefined);
              setCorbeille(c => !c);
            }}
            testID="esport-drive-corbeille"
          />
        ) : null}
        {!corbeille && droits?.voir ? <BoutonHub theme={theme} titre={selectionVisible ? trDr('selection.annuler') : trDr('barre.selection')} onPress={() => { setEnSelection(!selectionVisible); setSelection(new Map()); }} testID="esport-drive-selection" /> : null}
        {nouveautes?.total && portee ? (
          <BoutonHub
            theme={theme}
            titre={`${trDr('nouveautes.tout_vu')} (${nouveautes.total})`}
            onPress={() =>
              void agir('tout-vu', async () => {
                await api.toutVu(portee);
                await charger();
                return trDr('nouveautes.tout_vu_fait');
              })
            }
            testID="esport-drive-tout-vu"
          />
        ) : null}
        {!corbeille && droits?.gerer ? <BoutonHub theme={theme} titre={trDr('tags.gerer')} onPress={() => setDialogue({ genre: 'tags' })} testID="esport-drive-tags-gerer" /> : null}
        {portees?.some(p => p.portee === 'club' && p.droits.gerer) ? <BoutonHub theme={theme} titre={trDr('barre.reglages')} onPress={() => setDialogue({ genre: 'reglages' })} testID="esport-drive-reglages" /> : null}
        {contenu && !droits?.depot ? <BarreQuota theme={theme} quota={contenu.quota} /> : null}
      </View>

      {corbeille && portee ? (
        <Corbeille theme={theme} api={api} portee={portee} onChange={recharger} />
      ) : (
        <View style={{ flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' }}>
          {large && !depot && arbre ? (
            <View style={{ width: 250, flexShrink: 0, borderRightWidth: 1, borderRightColor: theme.ligne, paddingRight: ESP.xs }}>
              <ArbreDossiers
                theme={theme}
                titre={trDr('arbre.titre')}
                racine={trDr('racine')}
                dossiers={arbre.map((d): NoeudArbre => ({ id: d.id, parentId: d.parentId, nom: nomDossier(d), restreint: d.restreint }))}
                courant={resultats ? null : (contenu?.dossier?.id ?? null)}
                onOuvrir={ouvrirDossier}
                compteurs={nouveautes?.dossiers}
                glisser={glisser}
                testID="esport-drive-arbre"
              />
            </View>
          ) : null}
          <View style={{ flex: 1, minWidth: 0, gap: ESP.m }}>
          {/* Recherche et filtres */}
          {!droits?.depot ? (
            <View style={{ gap: ESP.xs }}>
              <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
                <Champ theme={theme} libelle={trDr('recherche.champ')} valeur={q} onChanger={setQ} maxLength={120} testID="esport-drive-recherche" style={{ flex: 1, minWidth: 200 }} />
                <BoutonHub theme={theme} titre={trDr('recherche.lancer')} desactive={!q.trim() && !filtresActifs} onPress={() => void chercher()} testID="esport-drive-recherche-ok" />
                {resultats ? (
                  <BoutonHub
                    theme={theme}
                    titre={trDr('recherche.effacer')}
                    onPress={() => {
                      setResultats(undefined);
                      setQ('');
                      setFiltres({});
                    }}
                    testID="esport-drive-recherche-effacer"
                  />
                ) : null}
              </View>
              <View>
                <Pliable theme={theme} titre={trDr('recherche.filtres')} resume={filtresActifs ? '●' : undefined} testID="esport-drive-filtres">
                  <Choix
                    theme={theme}
                    libelle={trDr('recherche.type')}
                    valeur={filtres.genre ?? 'tous'}
                    options={[{ id: 'tous', nom: trDr('recherche.tous') }, ...GENRES_DRIVE.map(g => ({ id: g, nom: nomGenre(g) }))]}
                    onChoisir={g => setFiltres({ ...filtres, genre: g === 'tous' ? undefined : (g as GenreDrive) })}
                    testID="esport-drive-filtre-genre"
                  />
                  {optionsFiltres?.tags.length ? (
                    <Choix theme={theme} libelle={trDr('recherche.tag')} valeur={filtres.tag ?? 'tous'} options={[{ id: 'tous', nom: trDr('recherche.tous') }, ...optionsFiltres.tags.map(t => ({ id: t.tag, nom: `#${t.tag} (${t.n})` }))]} onChoisir={t => setFiltres({ ...filtres, tag: t === 'tous' ? undefined : t })} testID="esport-drive-filtre-tag" />
                  ) : null}
                  {optionsFiltres?.auteurs.length ? (
                    <Choix theme={theme} libelle={trDr('recherche.auteur')} valeur={filtres.auteur ?? 'tous'} options={[{ id: 'tous', nom: trDr('recherche.tous') }, ...optionsFiltres.auteurs.map(a => ({ id: a.compte, nom: a.pseudo ?? a.compte }))]} onChoisir={a => setFiltres({ ...filtres, auteur: a === 'tous' ? undefined : a })} testID="esport-drive-filtre-auteur" />
                  ) : null}
                  <View style={[styles.ligne, { gap: ESP.xs }]}>
                    <Champ theme={theme} libelle={trDr('recherche.du')} valeur={filtres.du ?? ''} onChanger={du => setFiltres({ ...filtres, du: du || undefined })} placeholder="2026-10-01" maxLength={10} testID="esport-drive-filtre-du" style={{ minWidth: 150 }} />
                    <Champ theme={theme} libelle={trDr('recherche.au')} valeur={filtres.au ?? ''} onChanger={au => setFiltres({ ...filtres, au: au || undefined })} placeholder="2026-10-31" maxLength={10} testID="esport-drive-filtre-au" style={{ minWidth: 150 }} />
                  </View>
                  <View style={[styles.ligne, { gap: ESP.s }]}>
                    <Text style={texte(theme, 13)}>{trDr('recherche.favoris')}</Text>
                    <Interrupteur theme={theme} libelle={trDr('recherche.favoris')} valeur={Boolean(filtres.favoris)} onChanger={v => setFiltres({ ...filtres, favoris: v || undefined })} testID="esport-drive-filtre-favoris" />
                    {contenu?.dossier ? (
                      <>
                        <Text style={texte(theme, 13)}>{trDr('recherche.ici')}</Text>
                        <Interrupteur theme={theme} libelle={trDr('recherche.ici')} valeur={Boolean(filtres.dossier)} onChanger={v => setFiltres({ ...filtres, dossier: v ? contenu.dossier?.id : undefined })} testID="esport-drive-filtre-ici" />
                      </>
                    ) : null}
                  </View>
                  <BoutonHub theme={theme} titre={trDr('recherche.lancer')} variante="plein" onPress={() => void chercher()} testID="esport-drive-filtres-ok" />
                </Pliable>
              </View>
            </View>
          ) : (
            <Aide theme={theme} testID="esport-drive-depot-aide">{trDr('depot.joueur')}</Aide>
          )}

          {/* Fil d'Ariane, affichage, tri */}
          <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
            {resultats ? (
              <Text style={{ ...texte(theme, 15), fontWeight: '700' }} testID="esport-drive-resultats">
                {trnDr('recherche.resultats', resultats.fichiers.length + resultats.dossiers.length)}
              </Text>
            ) : (
              <FilAriane theme={theme} racine={trDr('racine')} chemin={(contenu?.chemin ?? []).map(m => ({ id: m.id, nom: nomDossier(m) }))} onOuvrir={ouvrirDossier} glisser={glisser} masquerRacine={depot} testID="esport-drive-ariane" />
            )}
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={vue === 'grille' ? `☰ ${trDr('barre.liste')}` : `▦ ${trDr('barre.grille')}`} libelle={trDr('barre.vue')} onPress={() => setVue(v => (v === 'grille' ? 'liste' : 'grille'))} testID="esport-drive-vue" />
              <MenuActions
                theme={theme}
                titreBouton={`${trDr('barre.tri')} : ${trDr(`tri.${tri}` as CleDr)}`}
                libelle={trDr('barre.tri')}
                testID="esport-drive-tri"
                actions={[...(['nom', 'date', 'taille', 'type'] as const).map(t => ({ titre: trDr(`tri.${t}` as CleDr), onPress: () => setTri(t), testID: `esport-drive-tri-${t}` })), { titre: trDr('barre.inverser'), onPress: () => setInverse(i => !i), testID: 'esport-drive-tri-inverse' }]}
              />
            </View>
          </View>

          {/* Sélection : actions groupées */}
          {selectionVisible ? (
            <View style={[styles.ligne, { gap: ESP.xs }]} testID="esport-drive-barre-selection">
              <Text style={texte(theme, 13)}>{trnDr('selection.n', selection.size)}</Text>
              <BoutonHub theme={theme} titre={trDr('selection.tout')} onPress={() => setSelection(new Map(tous.map(e => [cle(e), e])))} testID="esport-drive-selection-tout" />
              {selection.size && !droits?.depot ? <BoutonHub theme={theme} titre={trDr('action.deplacer')} onPress={() => setDialogue({ genre: 'destination', action: 'deplacer', elements: [...selection.values()] })} testID="esport-drive-selection-deplacer" /> : null}
              {selection.size && droits?.envoyer && [...selection.values()].every(e => e.genre === 'fichier') ? <BoutonHub theme={theme} titre={trDr('action.copier')} onPress={() => setDialogue({ genre: 'destination', action: 'copier', elements: [...selection.values()] })} testID="esport-drive-selection-copier" /> : null}
              {selection.size ? <BoutonConfirme theme={theme} titre={trDr('action.corbeille')} confirmation={trDr('action.corbeille')} onConfirme={() => void enLot('corbeille', [...selection.values()])} testID="esport-drive-selection-corbeille" /> : null}
            </View>
          ) : null}

          {file ? <Text style={attenue(theme)} testID="esport-drive-file">{trDr('envoi.n', file)}</Text> : null}
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-drive-envoi" />

          <ZoneDepot theme={theme} actif={peutDeposer && choixFichierDisponible} onFichiers={f => void envoyer(f)} testID="esport-drive-zone">
            <View style={{ minHeight: 160, gap: ESP.s }} {...glisser.marque({ zone: true })}>
              {!contenu && !erreur ? <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} /> : null}
              {vide ? (
                <Carte theme={theme}>
                  <EtatVide theme={theme} glyphe={GLYPHES_DRIVE.dossier} titre={trDr('vide.titre')} texte={droits?.depot ? trDr('vide.depot') : trDr('vide.texte')} />
                </Carte>
              ) : null}
              {contenu && !vide ? (vue === 'grille' ? vueGrille : vueListe) : null}
              {peutDeposer ? <Aide theme={theme}>{choixFichierDisponible ? trDr('depot.aide', { max: taille(contenu?.quota.fichierMax ?? 0) }) : trDr('depot.mobile')}</Aide> : null}
              {contenu && !depot && !vide ? <Aide theme={theme}>{glisser.disponible ? trDr('glisser.aide') : trDr('glisser.aide_mobile')}</Aide> : null}
            </View>
          </ZoneDepot>
          </View>
        </View>
      )}

      <DetailFichier
        theme={theme}
        api={api}
        id={detail}
        onFermer={() => setDetail(undefined)}
        onChange={recharger}
        onDeplacer={id => setDialogue({ genre: 'destination', action: 'deplacer', elements: [{ genre: 'fichier', id }] })}
        onCopier={id => setDialogue({ genre: 'destination', action: 'copier', elements: [{ genre: 'fichier', id }] })}
        onOuvrirCarte={onOuvrirTableau}
      />

      {dialogue?.genre === 'dossier' && portee ? (
        <Volet theme={theme} visible titre={trDr('barre.nouveau_dossier')} onFermer={() => setDialogue(undefined)} testID="esport-drive-volet-dossier">
          <Champ theme={theme} libelle={trDr('dialogue.nom')} valeur={dialogue.nom} onChanger={nom => setDialogue({ ...dialogue, nom })} maxLength={140} testID="esport-drive-dossier-nom" />
          {droits?.gerer ? (
            <View style={[styles.ligne, { gap: ESP.s }]}>
              <Interrupteur theme={theme} libelle={trDr('dialogue.restreint')} valeur={dialogue.restreint} onChanger={restreint => setDialogue({ ...dialogue, restreint })} testID="esport-drive-dossier-restreint" />
              <Text style={texte(theme, 13)}>{trDr('dialogue.restreint')}</Text>
            </View>
          ) : null}
          <BoutonHub
            theme={theme}
            titre={trDr('dialogue.creer')}
            variante="plein"
            desactive={!dialogue.nom.trim()}
            onPress={() =>
              void action('dossier', async () => {
                await api.creerDossier({ portee, parentId: contenu?.dossier?.id ?? null, nom: dialogue.nom.trim(), restreint: dialogue.restreint || undefined });
                setDialogue(undefined);
              })
            }
            testID="esport-drive-dossier-creer"
          />
        </Volet>
      ) : null}
      {dialogue?.genre === 'renommer' ? (
        <Volet theme={theme} visible titre={trDr('action.renommer')} onFermer={() => setDialogue(undefined)} testID="esport-drive-volet-renommer">
          <Champ theme={theme} libelle={trDr('dialogue.nom')} valeur={dialogue.nom} onChanger={nom => setDialogue({ ...dialogue, nom })} maxLength={140} testID="esport-drive-renommer-nom" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trDr('dialogue.enregistrer')}
              variante="plein"
              desactive={!dialogue.nom.trim()}
              onPress={() =>
                void action('renommer', async () => {
                  const estDossier = dossiers.some(d => d.id === dialogue.id);
                  if (estDossier) await api.modifierDossier(dialogue.id, { nom: dialogue.nom.trim() });
                  else await api.modifier(dialogue.id, { nom: dialogue.nom.trim() });
                  setDialogue(undefined);
                })
              }
              testID="esport-drive-renommer-ok"
            />
            {dialogue.systeme ? (
              <BoutonHub
                theme={theme}
                titre={trDr('dialogue.nom_defaut')}
                onPress={() =>
                  void action('renommer', async () => {
                    await api.modifierDossier(dialogue.id, { nom: null });
                    setDialogue(undefined);
                  })
                }
                testID="esport-drive-renommer-defaut"
              />
            ) : null}
          </View>
        </Volet>
      ) : null}
      {dialogue?.genre === 'destination' && portee && portees ? (
        <Volet theme={theme} visible titre={dialogue.action === 'copier' ? trDr('action.copier') : trDr('action.deplacer')} onFermer={() => setDialogue(undefined)} testID="esport-drive-volet-destination">
          <ChoixDestination
            theme={theme}
            api={api}
            portees={portees}
            porteeInitiale={portee}
            changerPortee={dialogue.action === 'copier'}
            exclure={dialogue.elements.filter(e => e.genre === 'dossier').map(e => e.id)}
            titreBouton={dialogue.action === 'copier' ? trDr('dialogue.copier_ici') : trDr('dialogue.deplacer_ici')}
            onChoisir={(p, dossierId) => {
              const elements = dialogue.elements;
              setDialogue(undefined);
              if (dialogue.action === 'deplacer') void deplacer(elements.map(x => infos.get(cle(x)) ?? { ...x, parentId: null, modifiable: true }), dossierId);
              else void enLot(dialogue.action, elements, dossierId, p);
            }}
          />
        </Volet>
      ) : null}
      {dialogue?.genre === 'tags' && portee ? (
        <Volet theme={theme} visible titre={trDr('tags.titre')} onFermer={() => setDialogue(undefined)} testID="esport-drive-volet-tags">
          <GestionTags
            theme={theme}
            api={api}
            portee={portee}
            onChange={() => {
              setFiltres(f => (f.tag ? { ...f, tag: undefined } : f));
              setVersionTags(v => v + 1);
              void agir('', charger);
              if (resultats) setResultats(undefined);
            }}
          />
        </Volet>
      ) : null}
      {dialogue?.genre === 'reglages' ? (
        <Volet theme={theme} visible titre={trDr('reglages.titre')} onFermer={() => setDialogue(undefined)} testID="esport-drive-volet-reglages">
          <ReglagesRangement theme={theme} api={api} />
        </Volet>
      ) : null}
      {toast ? <ToastAnnuler theme={theme} cle={toast.cle} texte={toast.texte} action={toast.annuler ? { titre: trDr('deplace.annuler'), onPress: toast.annuler } : undefined} onFermer={() => setToast(undefined)} testID="esport-drive-toast" /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Corbeille

function Corbeille({ theme, api, portee, onChange }: { theme: ThemeHub; api: ReturnType<typeof apiDrive>; portee: string; onChange(): void }) {
  const [c, setC] = useState<CorbeilleDrive | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setC(await api.corbeille(portee)), [api, portee]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const faire = (cleAction: string, a: () => Promise<string | undefined>) =>
    agir(cleAction, async () => {
      const m = await a();
      await charger();
      onChange();
      return m;
    });
  const nomDe = (x: string | null | undefined) => (x ? (c?.noms[x] ?? (x === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.compte_supprime'));
  return (
    <Carte theme={theme} testID="esport-drive-corbeille-vue">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-drive-corbeille" />
      <Text style={{ ...texte(theme, 16), fontWeight: '800' }}>{trDr('corbeille.titre')}</Text>
      <Aide theme={theme}>{trDr('corbeille.aide', { n: c?.dureeJours ?? 30 })}</Aide>
      {c && !c.elements.length ? <Text style={attenue(theme)}>{trDr('corbeille.vide')}</Text> : null}
      {c?.elements.map(e => (
        <View key={e.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }]} testID={`esport-drive-corbeille-${e.id}`}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={1}>{`${e.element === 'dossier' ? GLYPHES_DRIVE.dossier : GLYPHES_DRIVE[e.genre]} ${e.element === 'dossier' ? nomDossier(e) : e.nom}`}</Text>
            <Text style={attenue(theme, 12)}>
              {[e.element === 'dossier' ? trnDr('corbeille.contenu', e.contenu.n) : taille(e.taille), trDr('corbeille.par', { qui: nomDe(e.supprimePar) }), trDr('corbeille.expire', { date: quand(e.expireLe) })].join(' · ')}
            </Text>
          </View>
          {e.restaurable ? (
            <BoutonHub
              theme={theme}
              titre={trDr('corbeille.restaurer')}
              onPress={() =>
                void faire('restaurer', async () => {
                  const r = await api.restaurer(e.id);
                  return r.dossierId === null && (e.element === 'dossier' ? e.parentId : e.dossierId) ? trDr('corbeille.restaure_racine') : trDr('corbeille.restaure');
                })
              }
              testID={`esport-drive-corbeille-${e.id}-restaurer`}
            />
          ) : null}
          {c.droits.gerer ? (
            <BoutonConfirme
              theme={theme}
              titre={trDr('corbeille.supprimer')}
              confirmation={trDr('corbeille.confirmer')}
              onConfirme={() =>
                void faire('supprimer', async () => {
                  await api.supprimerDefinitivement(e.id);
                  return undefined;
                })
              }
              testID={`esport-drive-corbeille-${e.id}-supprimer`}
            />
          ) : null}
        </View>
      ))}
      {c?.droits.gerer && c.elements.length ? (
        <BoutonConfirme
          theme={theme}
          titre={trDr('corbeille.vider')}
          confirmation={trDr('corbeille.confirmer')}
          onConfirme={() =>
            void faire('vider', async () => {
              await api.viderCorbeille(portee);
              return trDr('corbeille.videe');
            })
          }
          testID="esport-drive-corbeille-vider"
        />
      ) : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ Réglages

function ReglagesRangement({ theme, api }: { theme: ThemeHub; api: ReturnType<typeof apiDrive> }) {
  const [r, setR] = useState<ReglagesDrive | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setR(await api.reglages()));
  }, [agir, api]);
  const changer = (x: Partial<ReglagesDrive>) => void agir('reglages', async () => setR(await api.changerReglages(x)));
  return (
    <View style={{ gap: ESP.s }} testID="esport-drive-reglages-vue">
      <Retours theme={theme} erreur={erreur} prefixe="esport-drive-reglages" />
      {r ? (
        <>
          {(['rangementVisuels', 'rangementClips'] as const).map(k => (
            <View key={k} style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme, 14), flex: 1 }}>{trDr(k === 'rangementVisuels' ? 'reglages.visuels' : 'reglages.clips')}</Text>
              <Interrupteur theme={theme} libelle={trDr(k === 'rangementVisuels' ? 'reglages.visuels' : 'reglages.clips')} valeur={r[k]} onChanger={v => changer({ [k]: v })} testID={`esport-drive-reglage-${k}`} />
            </View>
          ))}
          <Aide theme={theme}>{trDr('reglages.aide')}</Aide>
        </>
      ) : null}
    </View>
  );
}
