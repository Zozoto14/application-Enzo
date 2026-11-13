/**
 * Fiche d'un lineup : les images d'abord (grande image, vignettes par rôle, visionneuse plein écran avec balayage),
 * la vidéo courte, puis le personnage et sa capacité, la zone visée, les consignes (posture, difficulté, timing,
 * visée), la mini-carte (où se placer, trajectoire, où ça tombe) et les strats qui l'utilisent.
 *
 * `compacte` : fiche ouverte à côté de la vue par map (une colonne, sans mini-carte : la grande carte la montre).
 * Aucun champ ne passe par l'assistant d'écriture : un lineup est un contenu tactique.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import type { ClientEsport } from '../../client';
import { formaterDate } from '../../i18n';
import { trLu, trLuModele, trnLu, type CleLu } from '../../i18n/lineups';
import type { ApiLineups, Lineup } from '../../lineups/api';
import { agentDe, capaciteDe, carteDe, couleurPersonnage, imagesDe, videoDe } from '../../lineups/logique';
import { apiStrats, type Strat } from '../../strats/api';
import type { Assets } from '../../strats/assets';
import { BoutonConfirme, Retours, useAgir } from '../commun';
import { Badge, ESP, attenue, rayonCarte, texte, titre } from '../design';
import { CarteTactique } from './CarteTactique';
import { LecteurVideoLineup } from './LecteurVideoLineup';
import { Difficulte, EtiquetteImage, EtiquetteSide, PuceCapacite, PucePersonnage } from './Puces';
import { Visionneuse } from './Visionneuse';

const FOND_IMAGE = '#0B0F14';

/** Grande image, vignettes par rôle et visionneuse. */
export function Galerie({ theme, lineup, repli, testID = 'esport-lineup-galerie' }: { theme: ThemeHub; lineup: Lineup; /** Affiché sans image (mini-carte du lineup). */ repli?: React.ReactNode; testID?: string }) {
  const images = useMemo(() => imagesDe(lineup).filter(m => m.lien), [lineup]);
  const [choisie, setChoisie] = useState(0);
  const [ouverte, setOuverte] = useState<number | undefined>();
  useEffect(() => setChoisie(0), [lineup.id]);
  const i = Math.min(choisie, Math.max(0, images.length - 1));
  const rayon = Math.min(rayonCarte(theme), 14);
  if (images.length === 0) {
    return (
      <View testID={`${testID}-vide`} style={{ gap: ESP.xs }}>
        {repli ?? (
          <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: rayon, backgroundColor: FOND_IMAGE, alignItems: 'center', justifyContent: 'center', gap: ESP.xs }}>
            <Icone nom="image" taille={32} couleur="rgba(232, 238, 246, 0.5)" />
            <Text style={{ color: 'rgba(232, 238, 246, 0.6)', fontSize: 13 }}>{trLu('image.sans')}</Text>
          </View>
        )}
      </View>
    );
  }
  const role = (r: string) => trLu(`role.${r}` as CleLu);
  return (
    <View testID={testID} style={{ gap: ESP.xs }}>
      <Pressable testID={`${testID}-grande`} accessibilityRole="imagebutton" accessibilityLabel={trLu('image.agrandir', { role: role(images[i].role) })} onPress={() => setOuverte(i)} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: rayon, overflow: 'hidden', backgroundColor: FOND_IMAGE }}>
        <Image source={{ uri: images[i].lien?.url }} accessibilityIgnoresInvertColors resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        <View style={{ position: 'absolute', left: 10, bottom: 10 }}>
          <EtiquetteImage texte={role(images[i].role)} />
        </View>
        <View style={{ position: 'absolute', right: 10, bottom: 10, width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(8, 12, 17, 0.82)', alignItems: 'center', justifyContent: 'center' }}>
          <Icone nom="loupe" taille={18} couleur="#FFFFFF" />
        </View>
      </Pressable>
      {images.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
          {images.map((m, k) => (
            <Pressable
              key={m.id}
              testID={`${testID}-vignette-${k}`}
              accessibilityRole="button"
              accessibilityLabel={`${role(m.role)} (${trLu('image.n', { n: k + 1, total: images.length })})`}
              accessibilityState={{ selected: k === i }}
              onPress={() => setChoisie(k)}
              style={{ width: 92, gap: 3 }}>
              <View style={{ width: 92, height: 52, borderRadius: 8, overflow: 'hidden', backgroundColor: FOND_IMAGE, borderWidth: 2, borderColor: k === i ? theme.accent : 'transparent' }}>
                <Image source={{ uri: m.lien?.url }} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width: '100%', height: '100%' }} />
              </View>
              <Text numberOfLines={1} style={{ ...attenue(theme, 11), fontWeight: k === i ? '700' : '500', color: k === i ? theme.texte : theme.attenue }}>
                {role(m.role)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {ouverte !== undefined ? <Visionneuse images={images.map(m => ({ id: m.id, url: m.lien?.url ?? '', titre: role(m.role) }))} index={ouverte} onIndex={setOuverte} onFermer={() => setOuverte(undefined)} /> : null}
    </View>
  );
}

/** Une consigne courte : libellé discret, valeur lisible. */
function Cellule({ theme, libelle, enLigne = false, children }: { theme: ThemeHub; libelle: string; /** Dans une rangée : les cellules se partagent la largeur. */ enLigne?: boolean; children: React.ReactNode }) {
  return (
    <View style={enLigne ? { flexGrow: 1, flexBasis: 96, minWidth: 0, gap: 3 } : { gap: 3 }}>
      <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{libelle}</Text>
      {children}
    </View>
  );
}

/** Bouton étoile du favori (44 px au toucher). */
export function BoutonFavori({ theme, actif, onPress, testID, surImage = false }: { theme: ThemeHub; actif: boolean; onPress(): void; testID: string; surImage?: boolean }) {
  const jaune = '#F4C542';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={trLu(actif ? 'favori.retirer' : 'favori.ajouter')}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      hitSlop={surImage ? 6 : 0}
      style={{
        width: surImage ? 32 : 44,
        height: surImage ? 32 : 44,
        borderRadius: surImage ? 8 : 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surImage ? 'rgba(8, 12, 17, 0.82)' : actif ? teinteTransparente(jaune, 0.16) : theme.surface,
        borderWidth: surImage ? 0 : 1,
        borderColor: actif ? jaune : theme.ligne,
      }}>
      <Icone nom="etoile" taille={surImage ? 18 : 20} couleur={actif ? jaune : surImage ? 'rgba(255, 255, 255, 0.75)' : theme.attenue} />
    </Pressable>
  );
}

export interface PropsFicheLineup {
  theme: ThemeHub;
  client: ClientEsport;
  api: ApiLineups;
  teamId: string;
  lineup: Lineup;
  assets: Assets | undefined;
  large: boolean;
  compacte?: boolean;
  onRetour?(): void;
  /** Fiche compacte : ouvrir la fiche complète. */
  onOuvrir?(): void;
  onModifier?(): void;
  /** Le lineup a changé (favori, statut, liens) : la liste se met à jour. */
  onChange(l: Lineup): void;
  onSupprime(l: Lineup): void;
  /** Ouvrir une strat liée dans l'éditeur. */
  onOuvrirStrat?(id: string): void;
}

export function FicheLineup({ theme, client, api, teamId, lineup, assets, large, compacte = false, onRetour, onOuvrir, onModifier, onChange, onSupprime, onOuvrirStrat }: PropsFicheLineup) {
  const { enCours, erreur, avis, agir } = useAgir();
  const agent = agentDe(assets, lineup.personnage);
  const capacite = capaciteDe(agent, lineup.capacite);
  const carte = carteDe(assets, lineup.carte.cle);
  const couleur = couleurPersonnage(agent, lineup.personnage?.nom);
  const video = videoDe(lineup);
  const aPoints = Boolean(lineup.depart || lineup.arrivee);
  const deuxColonnes = large && !compacte;
  const { width: largeurFenetre } = useWindowDimensions();
  // iPad en portrait : la mini-carte et « Utilisé dans » côte à côte plutôt qu'une carte seule à gauche.
  const moyen = !large && !compacte && largeurFenetre >= 700;
  const miniCarte = aPoints ? (
    <CarteTactique carte={carte} nom={lineup.carte.nom} trajets={[{ id: lineup.id, depart: lineup.depart, arrivee: lineup.arrivee, couleur }]} etiquettes={!compacte} testID="esport-lineup-minicarte" />
  ) : null;
  const basculerFavori = () => {
    const favori = !lineup.favori;
    onChange({ ...lineup, favori });
    void agir('favori', async () => {
      try {
        await api.favori(teamId, lineup.id, favori);
      } catch (e) {
        onChange({ ...lineup, favori: !favori });
        throw e;
      }
    });
  };
  const changerStatut = (statut: 'propose' | 'valide') =>
    void agir('statut', async () => {
      onChange(await api.modifier(teamId, lineup.id, { statut }));
      return statut === 'valide' ? trLu('fiche.validee') : undefined;
    });
  const privees = lineup.strats.filter(s => !s.ouvrable).length;
  const visibles = lineup.strats.filter(s => s.ouvrable && s.id);
  const quand = formaterDate(lineup.creeLe, { day: 'numeric', month: 'short', year: 'numeric' });

  const avecImages = imagesDe(lineup).some(m => m.lien);
  // Sans image, la mini-carte tient déjà la place de la galerie : seule la légende reste ici.
  const blocCarte = !compacte ? (
    <View style={{ gap: ESP.xs, ...(moyen ? { flexBasis: 340, flexGrow: 1, maxWidth: 420 } : null) }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trLu('fiche.minimap')}</Text>
      {aPoints && avecImages ? (
        <View style={{ maxWidth: 440, gap: ESP.xs }}>
          {miniCarte}
          <Legende theme={theme} couleur={couleur} />
        </View>
      ) : aPoints ? (
        <Legende theme={theme} couleur={couleur} />
      ) : (
        <Text style={attenue(theme, 13)}>{trLu('fiche.sans_point')}</Text>
      )}
    </View>
  ) : null;

  const medias = (
    <View style={{ gap: ESP.s, flex: deuxColonnes ? 1.45 : undefined, minWidth: 0 }}>
      <Galerie theme={theme} lineup={lineup} repli={!compacte ? (miniCarte ?? undefined) : undefined} />
      {video?.lien ? <LecteurVideoLineup theme={theme} url={video.lien.url} titre={`${trLu('video')} : ${lineup.titre}`} /> : null}
      {lineup.videoUrl ? (
        <View style={{ alignItems: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trLu('video.lien')} icone="externe" onPress={() => void Linking.openURL(lineup.videoUrl ?? '').catch(() => undefined)} testID="esport-lineup-video-lien" />
        </View>
      ) : null}
      {deuxColonnes ? blocCarte : null}
    </View>
  );

  const blocStrats = (
    <View style={{ gap: ESP.xs, ...(moyen ? { flexBasis: 280, flexGrow: 1, minWidth: 0 } : null) }} testID="esport-lineup-strats">
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trLu('strats.titre')}</Text>
      {lineup.strats.length === 0 ? <Text style={attenue(theme, 13)}>{trLu('strats.aucune')}</Text> : null}
      {visibles.map(s => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
          <Text
            testID={`esport-lineup-strat-${s.id}`}
            accessibilityRole={onOuvrirStrat ? 'link' : undefined}
            accessibilityLabel={onOuvrirStrat ? trLu('strats.ouvrir', { titre: s.titre ?? '' }) : undefined}
            onPress={onOuvrirStrat && s.id ? () => onOuvrirStrat(s.id as string) : undefined}
            style={{ ...texte(theme, 14), fontWeight: '600', flexShrink: 1, textDecorationLine: onOuvrirStrat ? 'underline' : 'none' }}>
            {s.titre}
          </Text>
          {s.etape ? <Text style={attenue(theme, 12)}>{trLu('strats.etape', { n: s.etape })}</Text> : null}
          {lineup.moi.lier ? (
            <Pressable
              testID={`esport-lineup-strat-detacher-${s.id}`}
              accessibilityRole="button"
              accessibilityLabel={trLu('strats.detacher', { titre: s.titre ?? '' })}
              onPress={() => void agir('lien', async () => onChange(await api.delierStrat(teamId, lineup.id, s.id as string)))}
              hitSlop={10}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
              <Icone nom="croix" taille={16} couleur={theme.attenue} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {privees > 0 ? <Text style={attenue(theme, 12)}>{trnLu('strats.privees', privees)}</Text> : null}
      {lineup.moi.lier ? <LierStrat theme={theme} client={client} teamId={teamId} dejaLiees={visibles.map(s => s.id as string)} onLier={(strat, etape) => agir('lien', async () => (onChange(await api.lierStrat(teamId, lineup.id, strat.id, etape)), trLu('strats.liee', { titre: strat.titre })))} /> : null}
    </View>
  );
  const actions = (
    <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap', alignItems: 'center' }}>
      {compacte && onOuvrir ? <BoutonHub theme={theme} titre={trLu('fiche.complete')} variante="plein" onPress={onOuvrir} testID="esport-lineup-ouvrir" /> : null}
      {lineup.moi.valider ? (
        lineup.statut === 'propose' ? (
          <BoutonHub theme={theme} titre={trLu('fiche.valider')} variante={compacte ? 'normal' : 'plein'} icone="coche" desactive={Boolean(enCours)} onPress={() => changerStatut('valide')} testID="esport-lineup-valider" />
        ) : (
          <BoutonHub theme={theme} titre={trLu('fiche.invalider')} desactive={Boolean(enCours)} onPress={() => changerStatut('propose')} testID="esport-lineup-invalider" />
        )
      ) : null}
      {lineup.moi.modifier && onModifier ? <BoutonHub theme={theme} titre={trLu('fiche.modifier')} icone="crayon" onPress={onModifier} testID="esport-lineup-modifier" /> : null}
      {lineup.moi.supprimer ? (
        <BoutonConfirme
          theme={theme}
          titre={trLu('fiche.supprimer')}
          confirmation={trLu('fiche.supprimer.confirmer')}
          desactive={Boolean(enCours)}
          onConfirme={() =>
            void agir('suppression', async () => {
              await api.supprimer(teamId, lineup.id);
              onSupprime(lineup);
            })
          }
          testID="esport-lineup-supprimer"
        />
      ) : null}
    </View>
  );
  const signature = (
    <Text style={attenue(theme, 12)}>
      {trLu('fiche.par', { qui: lineup.creePar.pseudo ?? trLu('fiche.inconnu'), date: quand })}
      {lineup.validePar ? ` · ${trLu('fiche.valide_par', { qui: lineup.validePar.pseudo ?? trLu('fiche.inconnu') })}` : ''}
    </Text>
  );
  // Sous les consignes : la mini-carte (à gauche sous la galerie sur PC), les strats, les actions.
  const suite = (
    <>
      {moyen ? (
        <View style={{ flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {blocCarte}
          {blocStrats}
        </View>
      ) : (
        <>
          {deuxColonnes ? null : blocCarte}
          {blocStrats}
        </>
      )}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lineup" />
      {actions}
      {signature}
    </>
  );

  const infos = (
    <View style={{ gap: ESP.m, flex: deuxColonnes ? 1 : undefined, minWidth: 0 }}>
      <View style={{ gap: ESP.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: ESP.s }}>
          <Text accessibilityRole="header" testID="esport-lineup-titre" style={{ ...titre(theme, compacte ? 18 : large ? 24 : 20), flex: 1, minWidth: 0 }}>
            {lineup.titre}
          </Text>
          <BoutonFavori theme={theme} actif={lineup.favori} onPress={basculerFavori} testID="esport-lineup-favori" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{[lineup.carte.nom, lineup.zone?.nom].filter(Boolean).join(' · ')}</Text>
          <EtiquetteSide theme={theme} side={lineup.side} />
          <Badge theme={theme} ton={lineup.statut === 'valide' ? 'ok' : 'alerte'} texte={trLu(`statut.${lineup.statut}` as CleLu)} testID="esport-lineup-statut" />
        </View>
      </View>
      {lineup.personnage || lineup.capacite ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.m, flexWrap: 'wrap' }}>
          {lineup.personnage ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
              <PucePersonnage agent={agent} nom={lineup.personnage.nom} taille={36} />
              <View>
                <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{trLuModele('filtre.personnage', lineup.modele)}</Text>
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{lineup.personnage.nom}</Text>
              </View>
            </View>
          ) : null}
          {lineup.capacite ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
              <PuceCapacite capacite={capacite} nom={lineup.capacite.nom} taille={36} />
              <View>
                <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{trLuModele('filtre.capacite', lineup.modele)}</Text>
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{lineup.capacite.nom}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <View testID="esport-lineup-consignes" style={{ gap: ESP.s, padding: ESP.m, borderRadius: Math.min(rayonCarte(theme), 12), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
        <View style={{ flexDirection: 'row', gap: ESP.m, flexWrap: 'wrap' }}>
          <Cellule theme={theme} libelle={trLu('posture')} enLigne>
            <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trLu(`posture.${lineup.posture}` as CleLu)}</Text>
          </Cellule>
          <Cellule theme={theme} libelle={trLu('difficulte')} enLigne>
            <Difficulte theme={theme} n={lineup.difficulte} avecNom />
          </Cellule>
          {lineup.timing ? (
            <Cellule theme={theme} libelle={trLu('timing')} enLigne>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{lineup.timing}</Text>
            </Cellule>
          ) : null}
        </View>
        {lineup.visee ? (
          <Cellule theme={theme} libelle={trLu('visee')}>
            <Text style={texte(theme, 14)}>{lineup.visee}</Text>
          </Cellule>
        ) : null}
        <Cellule theme={theme} libelle={trLu('consignes')}>
          <Text style={lineup.instructions ? texte(theme, 14) : attenue(theme, 13)}>{lineup.instructions || trLu('sans_consigne')}</Text>
        </Cellule>
        {lineup.tags.length ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {lineup.tags.map(t => (
              <Text key={t} style={{ ...attenue(theme, 12), fontWeight: '600' }}>{`#${t}`}</Text>
            ))}
          </View>
        ) : null}
      </View>
      {suite}
    </View>
  );

  return (
    <View testID="esport-lineup-fiche" style={{ gap: ESP.m }}>
      {onRetour ? (
        <View style={{ flexDirection: 'row' }}>
          <BoutonHub theme={theme} titre={trLu('retour')} icone="chevron-gauche" onPress={onRetour} testID="esport-lineup-retour" />
        </View>
      ) : null}
      <View style={deuxColonnes ? { flexDirection: 'row', gap: ESP.xl, alignItems: 'flex-start' } : { gap: ESP.m }}>
        {medias}
        {infos}
      </View>
    </View>
  );
}

/** Légende de la mini-carte : anneau clair (où se placer), anneau coloré (où ça tombe). */
export function Legende({ theme, couleur }: { theme: ThemeHub; couleur: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: ESP.m, flexWrap: 'wrap' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: theme.texte, backgroundColor: theme.surface }} />
        <Text style={attenue(theme, 12)}>{trLu('carte.legende.depart')}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: couleur, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: couleur }} />
        </View>
        <Text style={attenue(theme, 12)}>{trLu('carte.legende.arrivee')}</Text>
      </View>
    </View>
  );
}

/** Lier le lineup à une strat de la team (liste chargée à la demande), avec le numéro de l'étape. */
function LierStrat({ theme, client, teamId, dejaLiees, onLier }: { theme: ThemeHub; client: ClientEsport; teamId: string; dejaLiees: readonly string[]; onLier(strat: Strat, etape: number | null): Promise<boolean> }) {
  const [ouvert, setOuvert] = useState(false);
  const [strats, setStrats] = useState<Strat[] | undefined>();
  const [choix, setChoix] = useState<string | undefined>();
  const [etape, setEtape] = useState('');
  useEffect(() => {
    if (!ouvert || strats) return;
    let vivant = true;
    apiStrats(client)
      .liste(teamId)
      .then(l => vivant && setStrats(l), () => vivant && setStrats([]));
    return () => {
      vivant = false;
    };
  }, [ouvert, strats, client, teamId]);
  if (!ouvert) {
    return (
      <View style={{ flexDirection: 'row' }}>
        <BoutonHub theme={theme} titre={trLu('strats.lier')} icone="lien" onPress={() => setOuvert(true)} testID="esport-lineup-lier" />
      </View>
    );
  }
  const options = (strats ?? []).filter(s => !dejaLiees.includes(s.id)).map(s => ({ id: s.id, nom: s.titre, detail: s.carte.nom }));
  const strat = strats?.find(s => s.id === choix);
  return (
    <View testID="esport-lineup-lier-formulaire" style={{ gap: ESP.xs, padding: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10 }}>
      <SelecteurRepliable theme={theme} libelle={trLu('strats.choisir')} options={options} valeur={choix} onChoisir={setChoix} ouvertParDefaut testID="esport-lineup-lier-strat" />
      <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Champ theme={theme} libelle={trLu('strats.etape.champ')} valeur={etape} onChanger={v => setEtape(v.replace(/\D/g, '').slice(0, 2))} clavier="number-pad" maxLength={2} style={{ width: 150 }} testID="esport-lineup-lier-etape" />
        <BoutonHub
          theme={theme}
          titre={trLu('strats.lier.ok')}
          variante="plein"
          desactive={!strat}
          onPress={() => {
            if (!strat) return;
            const n = Number(etape);
            void onLier(strat, etape && n >= 1 && n <= 20 ? n : null).then(ok => {
              if (ok) {
                setOuvert(false);
                setChoix(undefined);
                setEtape('');
              }
            });
          }}
          testID="esport-lineup-lier-ok"
        />
        <BoutonHub theme={theme} titre={trLu('fermer')} onPress={() => setOuvert(false)} testID="esport-lineup-lier-fermer" />
      </View>
    </View>
  );
}

