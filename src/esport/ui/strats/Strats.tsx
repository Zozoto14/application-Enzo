/**
 * Module « Strats » (phase 6) : bibliothèque des strats de la team (grille
 * avec miniatures, filtres), création, duplication, partage (visibilité
 * team ou privée, lien de lecture seule révocable), ajout au playbook, et
 * l'éditeur :
 *  - site et app PC : éditeur Konva (Editeur.web.tsx, Konva chargé à la
 *    demande) ;
 *  - app iOS native (pas de WebView) : miniature et notes en lecture seule
 *    (Editeur.tsx).
 *
 * Droits (vérifiés par le serveur) : strats.view|create|update|delete|share.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Intertitre, Panneau, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import { apiStrats, type FiltresStrats, type PartageStrat, type Strat } from '../../strats/api';
import type { Side, TypeStrat } from '../../strats/document';
import { LIBELLES_SIDE, LIBELLES_TYPE_STRAT, TYPES_STRAT, lireTags } from '../../strats/libelles';
import { BoutonConfirme, Choix, Retours, TitreSection, styles, useAgir } from '../commun';
import type { PropsModule } from '../modules';
import { Editeur } from './Editeur';
import { Etiquette, Filtre, MentionRiot, Miniature, prendreStratDemandee, useAssets } from './commun';

export function Strats({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiStrats(client), [client]);
  const assets = useAssets();
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const [ouverte, setOuverte] = useState<string | undefined>(() => prendreStratDemandee());
  const [strats, setStrats] = useState<Strat[] | undefined>();
  const [filtres, setFiltres] = useState<FiltresStrats>({});
  const [recherche, setRecherche] = useState('');
  const [creation, setCreation] = useState(false);
  const [partage, setPartage] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => setStrats(await api.liste(teamId, { ...filtres, q: recherche.trim() || undefined })), [api, teamId, filtres, recherche]);
  useEffect(() => {
    if (!ouverte) void agir('', recharger);
  }, [agir, recharger, ouverte]);

  if (ouverte) {
    return (
      <Editeur
        theme={theme}
        api={api}
        teamId={teamId}
        stratId={ouverte}
        large={large}
        assets={assets}
        onRetour={() => setOuverte(undefined)}
        onOuvrir={id => setOuverte(id)}
      />
    );
  }

  const cartes = assets?.cartes ?? [];
  const playbookActif = detail.modules.some(m => m.cle === 'playbook' && m.active) && peut('playbook.manage');
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: 14 }} testID="esport-strats">
      <TitreSection theme={theme} titre="Strats" sous="Stratégies dessinées sur la minimap, étape par étape. Ouvrez-en une pour l’éditer, ou ajoutez-la au playbook." />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-strats" />
      <View style={styles.ligne}>
        {peut('strats.create') ? <BoutonHub theme={theme} titre={creation ? 'Fermer' : 'Nouvelle strat'} variante={creation ? 'normal' : 'plein'} onPress={() => setCreation(!creation)} testID="esport-strats-nouvelle" /> : null}
        <Champ theme={theme} libelle="Rechercher" valeur={recherche} onChanger={setRecherche} placeholder="Titre, carte, tag…" maxLength={60} style={{ flex: 1, minWidth: 180 }} testID="esport-strats-recherche" />
      </View>
      {creation ? (
        <NouvelleStrat
          theme={theme}
          cartes={cartes.map(c => ({ cle: c.cle, nom: c.nom, image: c.minimap }))}
          onCreer={corps =>
            void agir('Création', async () => {
              const s = await api.creer(teamId, corps);
              setCreation(false);
              setOuverte(s.id);
            })
          }
          enCours={Boolean(enCours)}
        />
      ) : null}
      <Panneau theme={theme} testID="esport-strats-filtres">
        <Filtre theme={theme} libelle="Carte" valeur={filtres.carte ?? ''} options={[['', 'Toutes'], ...cartes.map(c => [c.cle, c.nom] as const)]} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-strats-filtre-carte" />
        <Filtre<Side> theme={theme} libelle="Side" valeur={filtres.side ?? ''} options={[['', 'Les deux'], ['attaque', 'Attaque'], ['defense', 'Défense']]} onChoisir={v => setFiltres(f => ({ ...f, side: v || undefined }))} testID="esport-strats-filtre-side" />
        <Filtre<TypeStrat> theme={theme} libelle="Type" valeur={filtres.type ?? ''} options={[['', 'Tous'], ...TYPES_STRAT.map(t => [t, LIBELLES_TYPE_STRAT[t]] as const)]} onChoisir={v => setFiltres(f => ({ ...f, type: v || undefined }))} testID="esport-strats-filtre-type" />
      </Panneau>
      {strats?.length === 0 ? <Text style={attenue}>Aucune strat {Object.keys(filtres).some(k => filtres[k as keyof FiltresStrats]) || recherche ? 'pour ces filtres' : 'pour l’instant'}.</Text> : null}
      <View style={[styles.ligne, { alignItems: 'stretch' }]}>
        {strats?.map(s => (
          <Panneau key={s.id} theme={theme} style={{ width: large ? 260 : '100%', gap: 8 }} testID={`esport-strat-${s.id}`}>
            <Miniature theme={theme} url={s.miniature?.url} carte={s.carte.nom} taille={large ? 130 : 180} testID="esport-strat-miniature" />
            <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} numberOfLines={2}>
              {s.titre}
            </Text>
            <View style={[styles.ligne, { gap: 4 }]}>
              <Etiquette theme={theme} texte={s.carte.nom} />
              <Etiquette theme={theme} texte={LIBELLES_SIDE[s.side]} couleur={s.side === 'attaque' ? theme.critique : theme.accent} />
              <Etiquette theme={theme} texte={LIBELLES_TYPE_STRAT[s.type]} />
              {s.visibilite === 'privee' ? <Etiquette theme={theme} texte="Privée" couleur={theme.alerte} /> : null}
              {s.tags.map(t => (
                <Etiquette key={t} theme={theme} texte={`#${t}`} />
              ))}
            </View>
            <Text style={attenue}>
              Modifiée {dateCourte(s.majLe)} par {s.majPar.pseudo ?? '?'} · version {s.revision}
            </Text>
            <View style={[styles.ligne, { gap: 6 }]}>
              <BoutonHub theme={theme} titre="Ouvrir" variante="plein" onPress={() => setOuverte(s.id)} testID={`esport-strat-ouvrir-${s.id}`} />
              {peut('strats.create') ? (
                <BoutonHub
                  theme={theme}
                  titre="Dupliquer"
                  onPress={() =>
                    void agir('Duplication', async () => {
                      const copie = await api.dupliquer(teamId, s.id);
                      await recharger();
                      return `Copie créée : « ${copie.titre} ».`;
                    })
                  }
                  testID={`esport-strat-dupliquer-${s.id}`}
                />
              ) : null}
              {playbookActif && s.visibilite === 'team' ? (
                <BoutonHub
                  theme={theme}
                  titre="Au playbook"
                  onPress={() =>
                    void agir('Playbook', async () => {
                      await api.creerEntree(teamId, { stratId: s.id, tags: s.tags });
                      onAller('module:playbook');
                    })
                  }
                  testID={`esport-strat-playbook-${s.id}`}
                />
              ) : null}
              {s.moi.partager ? <BoutonHub theme={theme} titre="Lien" onPress={() => setPartage(partage === s.id ? undefined : s.id)} testID={`esport-strat-lien-${s.id}`} /> : null}
              {s.moi.supprimer ? (
                <BoutonConfirme
                  theme={theme}
                  titre="Supprimer"
                  confirmation="Oui, supprimer"
                  onConfirme={() =>
                    void agir('Suppression', async () => {
                      await api.supprimer(teamId, s.id);
                      await recharger();
                      return 'Strat supprimée.';
                    })
                  }
                  testID={`esport-strat-supprimer-${s.id}`}
                />
              ) : null}
            </View>
            {partage === s.id ? <Partages theme={theme} api={api} teamId={teamId} strat={s} /> : null}
          </Panneau>
        ))}
      </View>
      <MentionRiot theme={theme} />
    </View>
  );
}

function NouvelleStrat({
  theme,
  cartes,
  onCreer,
  enCours,
}: {
  theme: ThemeHub;
  cartes: Array<{ cle: string; nom: string; image: string | null }>;
  onCreer(corps: { titre: string; type: TypeStrat; carte: { cle: string; nom: string; image: string | null }; side: Side; tags: string[]; visibilite: 'team' | 'privee' }): void;
  enCours: boolean;
}) {
  const [titre, setTitre] = useState('');
  const [carte, setCarte] = useState<string | undefined>();
  const [side, setSide] = useState<Side>('attaque');
  const [type, setType] = useState<TypeStrat>('default');
  const [tags, setTags] = useState('');
  const [privee, setPrivee] = useState(false);
  const choisie = cartes.find(c => c.cle === carte);
  return (
    <Panneau theme={theme} testID="esport-strats-creation">
      <Intertitre theme={theme}>Nouvelle strat</Intertitre>
      <Champ theme={theme} libelle="Titre" valeur={titre} onChanger={setTitre} maxLength={80} placeholder="Exécution A, retake B…" testID="esport-strats-titre" />
      <Choix theme={theme} libelle="Carte" valeur={carte} options={cartes.map(c => ({ id: c.cle, nom: c.nom }))} onChoisir={setCarte} testID="esport-strats-carte" />
      <Segments<Side> theme={theme} libelle="Side" valeur={side} options={[['attaque', 'Attaque'], ['defense', 'Défense']]} onChoisir={setSide} testID="esport-strats-side" />
      <Choix<TypeStrat> theme={theme} libelle="Type" valeur={type} options={TYPES_STRAT.map(t => ({ id: t, nom: LIBELLES_TYPE_STRAT[t] }))} onChoisir={setType} testID="esport-strats-type" />
      <Champ theme={theme} libelle="Tags (séparés par des virgules)" valeur={tags} onChanger={setTags} maxLength={200} testID="esport-strats-tags" />
      <Segments<'team' | 'privee'> theme={theme} libelle="Visibilité" valeur={privee ? 'privee' : 'team'} options={[['team', 'Partagée avec la team'], ['privee', 'Privée (brouillon)']]} onChoisir={v => setPrivee(v === 'privee')} testID="esport-strats-visibilite" />
      <BoutonHub
        theme={theme}
        titre="Créer et ouvrir l’éditeur"
        variante="plein"
        desactive={enCours || titre.trim().length < 2 || !choisie}
        onPress={() => choisie && onCreer({ titre: titre.trim(), type, carte: choisie, side, tags: lireTags(tags), visibilite: privee ? 'privee' : 'team' })}
        testID="esport-strats-creer"
      />
    </Panneau>
  );
}

/** Liens de lecture seule d'une strat : créer (le lien n'est montré qu'une fois), lister, révoquer. */
function Partages({ theme, api, teamId, strat }: { theme: ThemeHub; api: ReturnType<typeof apiStrats>; teamId: string; strat: Strat }) {
  const [liens, setLiens] = useState<PartageStrat[] | undefined>();
  const [nouveau, setNouveau] = useState<PartageStrat | undefined>();
  const [jours, setJours] = useState('');
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setLiens(await api.partages(teamId, strat.id)), [api, teamId, strat.id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID="esport-strat-partages">
      <Text style={attenue}>Un lien de lecture seule montre la strat (étapes et notes) sans compte. Révocable à tout moment.</Text>
      <View style={styles.ligne}>
        <Champ theme={theme} libelle="Validité (jours, vide : sans fin)" valeur={jours} onChanger={v => setJours(v.replace(/\D/g, ''))} clavier="number-pad" maxLength={3} style={{ minWidth: 140 }} testID="esport-strat-partage-jours" />
        <BoutonHub
          theme={theme}
          titre="Créer un lien"
          onPress={() =>
            void agir('Lien', async () => {
              setNouveau(await api.creerPartage(teamId, strat.id, jours ? { jours: Number(jours) } : {}));
              await charger();
            })
          }
          testID="esport-strat-partage-creer"
        />
      </View>
      {nouveau?.url ? (
        <Text selectable style={{ color: theme.texte, fontSize: 12 }} testID="esport-strat-partage-url">
          {nouveau.url}
        </Text>
      ) : null}
      {liens?.map(l => (
        <View key={l.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ color: l.revoque ? theme.attenue : theme.texte, fontSize: 12, textDecorationLine: l.revoque ? 'line-through' : 'none' }}>
            {l.libelle} · {dateCourte(l.creeLe)}
            {l.expireLe ? ` · expire ${dateCourte(l.expireLe)}` : ''}
            {l.dernierAcces ? ` · vu ${dateCourte(l.dernierAcces)}` : ''}
          </Text>
          {!l.revoque ? (
            <BoutonHub
              theme={theme}
              titre="Révoquer"
              variante="danger"
              onPress={() =>
                void agir('Révocation', async () => {
                  await api.revoquerPartage(teamId, strat.id, l.id);
                  await charger();
                })
              }
              testID={`esport-strat-partage-revoquer-${l.id}`}
            />
          ) : null}
        </View>
      ))}
      <Retours theme={theme} erreur={erreur} prefixe="esport-strat-partage" />
    </View>
  );
}
