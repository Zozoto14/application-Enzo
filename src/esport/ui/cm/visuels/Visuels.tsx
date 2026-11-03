/**
 * Onglet « Visuels » de l'espace CM : galerie des modèles (11 modèles par défaut qui suivent la charte, et
 * les modèles du club : ouvrir dans l'éditeur, dupliquer, versions, supprimer), visuels générés (aperçu,
 * retouche, génération sans carte), charte graphique du club. Modèles et visuels se rangent dans des dossiers
 * (migration 0040, Dossiers.tsx : dans le style du Drive, glisser-déposer compris), par club ou par team.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiCm, MoiCm } from '../../../cm/api';
import { apiVisuels, estRefDefaut, refDefaut, type DossierVisuel, type ListeModeles, type ModeleResume, type Visuel } from '../../../cm/visuels/api';
import { CHARTE_DEFAUT, lireCharte } from '../../../cm/visuels/charte';
import { donneesExemple } from '../../../cm/visuels/champs';
import { documentsDefaut, modeleDefaut } from '../../../cm/visuels/modeles';
import { TYPES_VISUEL, type Charte, type DocumentVisuel, type TypeVisuel } from '../../../cm/visuels/types';
import { langueCourante } from '../../../i18n';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, Onglets, TitreCarte, attenue, texte } from '../../design';
import { Apercu } from './Apercu';
import { CharteClub } from './Charte';
import { EditeurDiffere } from './EditeurDiffere';
import { GenererVisuel } from './Generer';
import { ExplorateurVisuels } from './Dossiers';
import type { CibleEditeur } from './typesEditeur';
import { useTempsReel } from '../../../tempsReel/hooks';

type SousOnglet = 'modeles' | 'visuels' | 'charte';

export function Visuels({ theme, apiCm, large, moi }: { theme: ThemeHub; apiCm: ApiCm; large: boolean; moi: MoiCm }) {
  const api = useMemo(() => apiVisuels(apiCm.client), [apiCm]);
  const [onglet, setOnglet] = useState<SousOnglet>('modeles');
  const [charte, setCharte] = useState<Charte>(CHARTE_DEFAUT);
  const [liste, setListe] = useState<ListeModeles | undefined>();
  const [visuels, setVisuels] = useState<Visuel[] | undefined>();
  const [edition, setEdition] = useState<CibleEditeur | undefined>();
  const [generer, setGenerer] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const editerClub = moi.club.includes('cm.editer');
  const porteeEdition = editerClub ? 'club' : (moi.teams.find(t => t.permissions.includes('cm.editer'))?.id ?? null);
  // Dossiers (migration 0040) : une arborescence par portée (club ou team), commune aux modèles et aux visuels.
  const porteesDossiers = [
    ...(moi.club.includes('cm.voir') || moi.club.includes('cm.editer') || moi.teams.some(t => t.permissions.includes('cm.voir')) ? [{ id: 'club', nom: trVi('espace.club') }] : []),
    ...moi.teams.filter(t => t.permissions.includes('cm.voir') || t.permissions.includes('cm.editer')).map(t => ({ id: t.id, nom: t.nom ?? '' })),
  ];
  const [portee, setPortee] = useState<string>(porteeEdition ?? porteesDossiers[0]?.id ?? 'club');
  const [dossiers, setDossiers] = useState<{ editer: boolean; dossiers: DossierVisuel[] }>({ editer: false, dossiers: [] });
  const [courant, setCourant] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const [c, m, v, d] = await Promise.all([api.charte(), api.modeles(portee), api.visuels({ portee }), api.dossiers(portee).catch(() => ({ editer: false, dossiers: [] as DossierVisuel[] }))]);
    setCharte(lireCharte(c.charte));
    setListe(m);
    setVisuels(v.visuels);
    setDossiers({ editer: d.editer, dossiers: d.dossiers });
    setCourant(x => (x && d.dossiers.some(y => y.id === x) ? x : null));
  }, [api, portee]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : charte, modèle ou visuel changé par un autre.
  useTempsReel(api.client, 'cm', ms => {
    if (ms.length === 0 || ms.some(m => !m.cle || /^cm-(?:modele|visuel):/.test(m.cle))) void charger().catch(() => undefined);
  });

  const exemple = useMemo(() => donneesExemple('serie'), []);
  const apercusDefaut = useMemo(() => Object.fromEntries(TYPES_VISUEL.map(t => [t, modeleDefaut(t, 'portrait')])) as Record<TypeVisuel, DocumentVisuel>, []);
  const langue = langueCourante();

  const dupliquerDefaut = (type: TypeVisuel) =>
    agir(`dupliquer-${type}`, async () => {
      if (!porteeEdition) return undefined;
      const r = await api.creerModele({ portee: porteeEdition, nom: trVi('espace.copie_de', { nom: trVi(`type.${type}` as CleVi) }), type, base: refDefaut(type), documents: documentsDefaut(type), dossierId: portee === porteeEdition && courant ? courant : undefined });
      await charger();
      setEdition({ genre: 'modele', type, modele: r.modele, portee: r.modele.portee });
      return trVi('espace.duplique');
    });
  const ouvrirModele = (m: ModeleResume) =>
    agir(`ouvrir-${m.id}`, async () => {
      const r = await api.modele(m.id);
      setEdition({ genre: 'modele', type: m.type, modele: r.modele, portee: m.portee });
      return undefined;
    });
  const dupliquerModele = (m: ModeleResume) =>
    agir(`copie-${m.id}`, async () => {
      await api.dupliquerModele(m.id, { nom: trVi('espace.copie_de', { nom: m.nom }) });
      await charger();
      return trVi('espace.duplique');
    });
  const supprimerModele = (m: ModeleResume) =>
    agir(`supprimer-${m.id}`, async () => {
      await api.supprimerModele(m.id);
      await charger();
      return undefined;
    });
  const ouvrirVisuel = (v: Visuel) =>
    agir(`visuel-${v.id}`, async () => {
      const r = await api.visuel(v.id);
      const modele = estRefDefaut(v.modele) ? null : ((await api.modele(v.modele).catch(() => null))?.modele ?? null);
      setEdition({ genre: 'visuel', visuel: r.visuel, modele });
      return undefined;
    });

  if (edition) {
    return (
      <Modal visible animationType="none" onRequestClose={() => setEdition(undefined)}>
        <ScrollView style={{ flex: 1, backgroundColor: theme.fond }} contentContainerStyle={{ padding: ESP.l }}>
          <EditeurDiffere
            theme={theme}
            api={api}
            large={large}
            charte={charte}
            cible={edition}
            onFermer={change => {
              setEdition(undefined);
              if (change) void agir('', charger);
            }}
          />
        </ScrollView>
      </Modal>
    );
  }

  return (
    <View style={{ gap: ESP.m }} testID="esport-vi">
      <Onglets
        theme={theme}
        prefixe="esport-vi-onglet"
        actif={onglet}
        onChoisir={id => setOnglet(id as SousOnglet)}
        entrees={[
          { id: 'modeles', libelle: trVi('espace.modeles') },
          { id: 'visuels', libelle: trVi('espace.visuels') },
          { id: 'charte', libelle: trVi('espace.charte') },
        ]}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi" />
      {onglet !== 'charte' && porteesDossiers.length > 1 ? (
        <Choix
          theme={theme}
          libelle={trVi('dossiers.portee')}
          valeur={portee}
          options={porteesDossiers}
          onChoisir={p => {
            setPortee(p);
            setCourant(null);
          }}
          testID="esport-vi-portee"
        />
      ) : null}
      {onglet === 'modeles' ? (
        <ExplorateurVisuels
          theme={theme}
          api={api}
          large={large}
          portee={portee}
          dossiers={dossiers.dossiers}
          editer={dossiers.editer}
          courant={courant}
          onOuvrir={setCourant}
          onChange={charger}
          testID="esport-vi-modeles"
          avant={
            <View style={{ gap: ESP.m }}>
              <TitreCarte theme={theme} titre={trVi('espace.par_defaut')} sous={trVi('espace.par_defaut_aide')} />
              <Grille min={large ? 240 : 160} testID="esport-vi-defauts">
                {TYPES_VISUEL.map(t => (
                  <Carte key={t} theme={theme} dense testID={`esport-vi-defaut-${t}`}>
                    <Apercu theme={theme} api={api} charte={charte} document={apercusDefaut[t]} donnees={exemple} langue={langue} largeur={large ? 200 : 140} libelle={trVi(`type.${t}` as CleVi)} />
                    <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trVi(`type.${t}` as CleVi)}</Text>
                    {porteeEdition ? (
                      <View style={[styles.ligne, { gap: 4 }]}>
                        <BoutonHub theme={theme} titre={trVi('espace.ouvrir')} onPress={() => setEdition({ genre: 'modele', type: t, modele: null, portee: porteeEdition })} testID={`esport-vi-defaut-${t}-ouvrir`} />
                        <BoutonHub theme={theme} titre={trVi('espace.dupliquer')} onPress={() => void dupliquerDefaut(t)} testID={`esport-vi-defaut-${t}-dupliquer`} />
                      </View>
                    ) : null}
                  </Carte>
                ))}
              </Grille>
              <TitreCarte theme={theme} titre={trVi('espace.personnalises')} />
              {liste && !liste.modeles.some(m => m.portee === portee) ? <Text style={attenue(theme)}>{trVi('espace.aucun_modele')}</Text> : null}
            </View>
          }
          elements={(liste?.modeles ?? [])
            .filter(m => m.portee === portee)
            .map(m => {
              const peutEditer = Boolean(m.portee === 'club' ? liste?.editer.club : liste?.editer.teams.includes(m.portee));
              return {
                genre: 'modele' as const,
                id: m.id,
                nom: m.nom,
                dossierId: m.dossierId ?? null,
                modifiable: peutEditer,
                sous: [trVi(`type.${m.type}` as CleVi), trVi('espace.formats_n', { n: m.formats.length }), `v${m.version}`].join(' · '),
                onOuvrir: () => void ouvrirModele(m),
                badges: (
                  <View style={[styles.ligne, { gap: 4 }]}>
                    <Badge theme={theme} texte={trVi(`type.${m.type}` as CleVi)} />
                    <Badge theme={theme} texte={m.portee === 'club' ? trVi('espace.club') : (moi.teams.find(t => t.id === m.portee)?.nom ?? '')} />
                    <Badge theme={theme} texte={trVi('espace.formats_n', { n: m.formats.length })} />
                    <Badge theme={theme} texte={`v${m.version}`} />
                  </View>
                ),
                actions: (
                  <View style={[styles.ligne, { gap: 4 }]}>
                    <BoutonHub theme={theme} titre={trVi('espace.ouvrir')} onPress={() => void ouvrirModele(m)} testID={`esport-vi-modele-${m.id}-ouvrir`} />
                    {porteeEdition ? <BoutonHub theme={theme} titre={trVi('espace.dupliquer')} onPress={() => void dupliquerModele(m)} testID={`esport-vi-modele-${m.id}-dupliquer`} /> : null}
                    {peutEditer ? <BoutonConfirme theme={theme} titre={trVi('espace.supprimer')} confirmation={trVi('espace.supprimer_confirmer')} onConfirme={() => void supprimerModele(m)} testID={`esport-vi-modele-${m.id}-supprimer`} /> : null}
                  </View>
                ),
              };
            })}
        />
      ) : null}
      {onglet === 'visuels' ? (
        <View style={{ gap: ESP.m }}>
          {porteeEdition ? (
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={trVi('espace.generer')} variante="plein" onPress={() => setGenerer(true)} testID="esport-vi-generer" />
            </View>
          ) : null}
          {visuels && !visuels.length && !dossiers.dossiers.length ? (
            <Carte theme={theme}>
              <EtatVide theme={theme} glyphe="◈" titre={trVi('espace.visuels')} texte={trVi('espace.aucun_visuel')} />
            </Carte>
          ) : null}
          <ExplorateurVisuels
            theme={theme}
            api={api}
            large={large}
            portee={portee}
            dossiers={dossiers.dossiers}
            editer={dossiers.editer}
            courant={courant}
            onOuvrir={setCourant}
            onChange={charger}
            testID="esport-vi-visuels"
            elements={(visuels ?? []).map(v => ({
              genre: 'visuel' as const,
              id: v.id,
              nom: v.nom,
              dossierId: v.dossierId ?? null,
              modifiable: dossiers.editer,
              sous: [trVi(`type.${v.type}` as CleVi), trVi(`format.${v.format}` as CleVi), v.langue.toUpperCase()].join(' · '),
              onOuvrir: () => void ouvrirVisuel(v),
              badges: (
                <View style={[styles.ligne, { gap: 4 }]}>
                  <Badge theme={theme} texte={trVi(`type.${v.type}` as CleVi)} />
                  <Badge theme={theme} texte={trVi(`format.${v.format}` as CleVi)} />
                  <Badge theme={theme} texte={v.langue.toUpperCase()} />
                  {v.retouche ? <Badge theme={theme} texte={trVi('carte.retouche')} /> : null}
                  {!v.fichierId ? <Badge theme={theme} ton="alerte" texte={trVi('carte.pas_rendu')} /> : null}
                </View>
              ),
            }))}
          />
        </View>
      ) : null}
      {onglet === 'charte' ? <CharteClub theme={theme} api={api} large={large} onChange={setCharte} /> : null}
      {generer && porteeEdition ? (
        <GenererVisuel
          theme={theme}
          api={api}
          apiCm={apiCm}
          portee={porteeEdition}
          teams={moi.teams.filter(t => t.permissions.includes('cm.editer'))}
          charte={charte}
          dossiers={portee === porteeEdition ? dossiers.dossiers : undefined}
          dossierInitial={portee === porteeEdition ? courant : null}
          onFermer={() => setGenerer(false)}
          onCree={() => {
            setGenerer(false);
            void agir('', charger);
          }}
        />
      ) : null}
    </View>
  );
}

