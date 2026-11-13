/**
 * Formulaire d'un lineup (création, correction) : map, personnage et capacité du profil de jeu, side ou mode, zone
 * visée (callout de la map ou texte libre), consignes, difficulté, tags, pose des deux points sur la minimap (un
 * toucher : site, app PC, iPad), images (rôle : position, visée, résultat, autre) et vidéo courte.
 *
 * Les fichiers choisis sont envoyés à l'enregistrement (par morceaux, comme les vidéos de review) puis rattachés au
 * lineup. AUCUN champ n'est proposé à l'assistant d'écriture : un lineup est un contenu tactique.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { ErreurEsport, type ClientEsport } from '../../client';
import { langueCourante } from '../../i18n';
import { trLu, trLuModele, type CleLu } from '../../i18n/lineups';
import { cleDe } from '../../jeux/profil';
import { POSTURES, ROLES_IMAGE, type ApiLineups, type DroitsLineups, type Lineup, type ListeLineups, type PointCarte, type PostureLineup, type Reference, type RoleImage, type RoleMedia, type SaisieLineup, type StatutLineup } from '../../lineups/api';
import { allegerImage } from '../../lineups/image';
import { agentDe, carteDe, couleurPersonnage, sidesDuModele } from '../../lineups/logique';
import { choisirFichier, choixFichierDisponible, type FichierNavigateur } from '../../medias/choixFichier';
import { tailleMedia } from '../../medias/envoi';
import type { Assets } from '../../strats/assets';
import { lireTags } from '../../strats/libelles';
import type { ModeleStrat } from '../../strats/modeles';
import { useVerrouOptimiste } from '../../tempsReel/hooks';
import { BandeauConflit } from '../../tempsReel/ui';
import { Choix, Retours, message, useAgir } from '../commun';
import { ESP, attenue, texte, titre } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import { CarteTactique } from './CarteTactique';
import { nomSide } from './Puces';

const ACCEPT_IMAGE = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';
const ACCEPT_VIDEO = 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm';
const ZONE_LIBRE = '__libre';

interface EnAttente {
  cle: string;
  fichier: FichierNavigateur;
  role: RoleMedia;
}

interface Etat {
  titre: string;
  carte: string;
  carteLibre: string;
  personnage: string;
  personnageLibre: string;
  capacite: string;
  capaciteLibre: string;
  side: string;
  zone: string;
  zoneLibre: string;
  posture: PostureLineup;
  visee: string;
  timing: string;
  instructions: string;
  difficulte: number;
  tags: string;
  depart: PointCarte | null;
  arrivee: PointCarte | null;
  videoUrl: string;
  statut: StatutLineup;
}

function etatInitial(l: Lineup | undefined, gere: boolean): Etat {
  return {
    titre: l?.titre ?? '',
    carte: l?.carte.cle ?? '',
    carteLibre: l?.carte.nom ?? '',
    personnage: l?.personnage?.cle ?? '',
    personnageLibre: l?.personnage && !l.personnage.cle ? l.personnage.nom : '',
    capacite: l?.capacite?.cle ?? '',
    capaciteLibre: l?.capacite && !l.capacite.cle ? l.capacite.nom : '',
    side: l?.side ?? '',
    zone: l?.zone ? (l.zone.cle ?? ZONE_LIBRE) : '',
    zoneLibre: l?.zone && !l.zone.cle ? l.zone.nom : '',
    posture: l?.posture ?? 'debout',
    visee: l?.visee ?? '',
    timing: l?.timing ?? '',
    instructions: l?.instructions ?? '',
    difficulte: l?.difficulte ?? 1,
    tags: (l?.tags ?? []).join(', '),
    depart: l?.depart ?? null,
    arrivee: l?.arrivee ?? null,
    videoUrl: l?.videoUrl ?? '',
    statut: l?.statut ?? (gere ? 'valide' : 'propose'),
  };
}

/** Rôle d'une image : quatre pastilles compactes. */
function ChoixRole({ theme, valeur, onChoisir, testID }: { theme: ThemeHub; valeur: RoleImage; onChoisir(r: RoleImage): void; testID: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={trLu('form.medias.role')} style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
      {ROLES_IMAGE.map(r => {
        const actif = r === valeur;
        return (
          <Pressable
            key={r}
            testID={`${testID}-${r}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${trLu('form.medias.role')} : ${trLu(`role.${r}` as CleLu)}`}
            onPress={() => onChoisir(r)}
            style={{ minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: actif ? theme.accent : theme.ligne, backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : 'transparent' }}>
            <Text style={{ ...texte(theme, 12), fontWeight: actif ? '700' : '500' }}>{trLu(`role.${r}` as CleLu)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface PropsFormulaireLineup {
  theme: ThemeHub;
  client: ClientEsport;
  api: ApiLineups;
  teamId: string;
  assets: Assets | undefined;
  modele: ModeleStrat;
  /** Lineup à corriger ; absent : création. */
  lineup?: Lineup;
  droits: DroitsLineups;
  limites: ListeLineups['limites'];
  large: boolean;
  /** Map proposée à la création (filtre ou vue par map en cours). */
  carteInitiale?: string;
  onFini(l: Lineup, message: string): void;
  onAnnuler(): void;
}

export function FormulaireLineup({ theme, client, api, teamId, assets, modele, lineup, droits, limites, large, carteInitiale, onFini, onAnnuler }: PropsFormulaireLineup) {
  const [courant, setCourant] = useState<Lineup | undefined>(lineup);
  const [s, setS] = useState<Etat>(() => ({ ...etatInitial(lineup, droits.gerer), ...(lineup ? {} : { carte: carteInitiale ?? '' }) }));
  const [pose, setPose] = useState<'depart' | 'arrivee'>(lineup?.depart && !lineup.arrivee ? 'arrivee' : 'depart');
  const [attente, setAttente] = useState<EnAttente[]>([]);
  const [envoiNom, setEnvoiNom] = useState<string | undefined>();
  const { enCours, erreur, avis, agir, setErreur } = useAgir();
  const envoi = useEnvoi();
  const verrou = useVerrouOptimiste(client, courant ? `/teams/${teamId}/lineups/${courant.id}` : undefined);
  const maj = (p: Partial<Etat>) => setS(x => ({ ...x, ...p }));
  useEffect(() => {
    if (lineup && lineup.id !== courant?.id) {
      setCourant(lineup);
      setS(etatInitial(lineup, droits.gerer));
    }
  }, [lineup, courant?.id, droits.gerer]);

  const cartes = useMemo(() => (assets?.cartes ?? []).filter(c => c.actif !== false || c.cle === s.carte), [assets, s.carte]);
  const carte = carteDe(assets, s.carte);
  const agents = useMemo(() => (assets?.agents ?? []).filter(a => a.actif !== false || a.cle === s.personnage), [assets, s.personnage]);
  const agent = agentDe(assets, s.personnage ? { cle: s.personnage, nom: '' } : null);
  const capacites = agent?.capacites ?? [];
  const sides = sidesDuModele(modele);
  const zones = useMemo(() => {
    const vues = new Set<string>();
    const sortie: Array<{ id: string; nom: string }> = [];
    for (const z of [...(carte?.reperes ?? []).filter(r => r.type === 'site' || r.type === 'cashout'), ...(carte?.zones ?? [])]) {
      if (!z.cle || !z.nom || vues.has(z.cle)) continue;
      vues.add(z.cle);
      sortie.push({ id: z.cle, nom: z.nom });
    }
    return sortie;
  }, [carte]);
  const couleur = couleurPersonnage(agent, s.personnageLibre);
  const images = (courant?.medias ?? []).filter(m => m.genre === 'image');
  const video = (courant?.medias ?? []).find(m => m.genre === 'video');
  const nImages = images.length + attente.filter(a => a.role !== 'video').length;
  const aVideo = Boolean(video) || attente.some(a => a.role === 'video');
  const langue = langueCourante();

  /** Corps envoyé au serveur (références : clé du profil et nom recopié). */
  const corps = (): SaisieLineup => {
    const ref = (cle: string, libre: string, noms: ReadonlyArray<{ cle: string; nom: string }>): Reference | null => {
      if (cle) return { cle, nom: noms.find(x => x.cle === cle)?.nom ?? cle };
      return libre.trim() ? { cle: null, nom: libre.trim() } : null;
    };
    const nomCarte = carte?.nom ?? s.carteLibre.trim();
    return {
      titre: s.titre.trim(),
      carte: { cle: s.carte || cleDe(s.carteLibre), nom: nomCarte || s.carte },
      personnage: ref(s.personnage, s.personnageLibre, assets?.agents ?? []),
      capacite: ref(s.capacite, s.capaciteLibre, capacites),
      side: s.side,
      zone: s.zone === ZONE_LIBRE ? (s.zoneLibre.trim() ? { cle: null, nom: s.zoneLibre.trim() } : null) : s.zone ? { cle: s.zone, nom: zones.find(z => z.id === s.zone)?.nom ?? courant?.zone?.nom ?? s.zone } : null,
      posture: s.posture,
      visee: s.visee.trim(),
      timing: s.timing.trim(),
      instructions: s.instructions.trim(),
      difficulte: s.difficulte,
      tags: lireTags(s.tags),
      depart: s.depart,
      arrivee: s.arrivee,
      videoUrl: s.videoUrl.trim() || null,
      ...(droits.gerer ? { statut: s.statut } : {}),
    };
  };
  const complet = s.titre.trim().length >= 2 && Boolean(s.carte || cleDe(s.carteLibre));

  const ajouter = async (role: RoleMedia) => {
    const f = await choisirFichier(role === 'video' ? ACCEPT_VIDEO : ACCEPT_IMAGE, role === 'video' ? 'esport-lineup-fichier-video' : 'esport-lineup-fichier-image');
    if (!f) return;
    const max = role === 'video' ? limites.tailleVideo : limites.tailleImage;
    // Une image trop lourde sera allégée avant l'envoi ; une vidéo trop lourde est refusée tout de suite.
    if (role === 'video' && f.taille > max) {
      setErreur(trLu('form.medias.trop_video', { max: tailleMedia(max, langue) }));
      return;
    }
    setErreur(undefined);
    const prochain = ROLES_IMAGE.find(r => ![...images.map(m => m.role), ...attente.map(a => a.role)].includes(r)) ?? 'autre';
    setAttente(a => [...a, { cle: `${Date.now()}-${f.nom}`, fichier: f, role: role === 'video' ? 'video' : prochain }]);
  };

  const enregistrer = () =>
    void agir('enregistrement', async () => {
      if (!complet) throw new Error(trLu('form.incomplet'));
      let l: Lineup;
      try {
        l = courant ? await api.modifier(teamId, courant.id, corps()) : await api.creer(teamId, corps());
      } catch (e) {
        if (verrou.signalerConflit(e)) return undefined;
        throw e;
      }
      const creation = !courant;
      setCourant(l);
      // Fichiers choisis : envoyés un par un, puis rattachés ; un refus laisse le formulaire ouvert (lineup déjà enregistré).
      for (const a of attente) {
        setEnvoiNom(a.fichier.nom);
        try {
          const fichier = a.role === 'video' ? a.fichier : await allegerImage(a.fichier);
          if (a.role !== 'video' && fichier.taille > limites.tailleImage) throw new Error(trLu('form.medias.trop_image', { max: tailleMedia(limites.tailleImage, langue) }));
          const { etat, oublier } = await envoi.lancer({ client, teamId, section: 'lineups', fichier });
          l = await api.ajouterMedia(teamId, l.id, etat.id, a.role);
          oublier();
          setCourant(l);
          setAttente(liste => liste.filter(x => x.cle !== a.cle));
        } catch (e) {
          setEnvoiNom(undefined);
          envoi.effacer();
          throw new Error(trLu('form.media_refuse', { nom: a.fichier.nom, raison: e instanceof ErreurEsport ? e.message : message(e) }));
        }
      }
      setEnvoiNom(undefined);
      envoi.effacer();
      onFini(l, creation && l.statut === 'propose' ? trLu('form.propose') : trLu('form.enregistre'));
      return undefined;
    });

  const recharger = async () => {
    if (!courant) return;
    const l = await api.detail(teamId, courant.id);
    setCourant(l);
    setS(etatInitial(l, droits.gerer));
  };

  const toucher = (p: PointCarte) => {
    if (pose === 'depart') {
      maj({ depart: p });
      // Le premier toucher pose la position, le suivant l'arrivée.
      if (!s.arrivee) setPose('arrivee');
    } else maj({ arrivee: p });
  };

  const champs = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      <Champ theme={theme} libelle={trLu('form.titre')} valeur={s.titre} onChanger={v => maj({ titre: v })} maxLength={80} placeholder={trLu('form.titre.aide')} testID="esport-lineup-form-titre" />
      {cartes.length > 0 ? (
        <Choix theme={theme} libelle={trLu('form.carte')} valeur={s.carte || undefined} options={cartes.map(c => ({ id: c.cle, nom: c.nom }))} onChoisir={v => maj({ carte: v, zone: '', depart: null, arrivee: null })} testID="esport-lineup-form-carte" />
      ) : (
        <Champ theme={theme} libelle={trLu('form.carte')} valeur={s.carteLibre} onChanger={v => maj({ carteLibre: v, carte: '' })} maxLength={40} testID="esport-lineup-form-carte-libre" />
      )}
      {agents.length > 0 ? (
        <Choix theme={theme} libelle={trLuModele('filtre.personnage', modele)} valeur={s.personnage} options={[{ id: '', nom: trLu('form.personnage.aucun') }, ...agents.map(a => ({ id: a.cle, nom: a.nom }))]} onChoisir={v => maj({ personnage: v, capacite: '' })} testID="esport-lineup-form-personnage" />
      ) : (
        <Champ theme={theme} libelle={trLuModele('filtre.personnage', modele)} valeur={s.personnageLibre} onChanger={v => maj({ personnageLibre: v })} maxLength={60} testID="esport-lineup-form-personnage-libre" />
      )}
      {capacites.length > 0 ? (
        <Choix theme={theme} libelle={trLuModele('filtre.capacite', modele)} valeur={s.capacite} options={[{ id: '', nom: trLu('form.personnage.aucun') }, ...capacites.map(c => ({ id: c.cle, nom: c.touche ? `${c.nom} (${c.touche})` : c.nom }))]} onChoisir={v => maj({ capacite: v, capaciteLibre: '' })} testID="esport-lineup-form-capacite" />
      ) : (
        <Champ theme={theme} libelle={trLu('form.capacite.libre')} valeur={s.capaciteLibre} onChanger={v => maj({ capaciteLibre: v, capacite: '' })} maxLength={60} testID="esport-lineup-form-capacite-libre" />
      )}
      {sides.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trLu(aDesSides(modele) ? 'filtre.side' : 'filtre.mode')}</Text>
          <Segments theme={theme} libelle={trLu(aDesSides(modele) ? 'filtre.side' : 'filtre.mode')} valeur={s.side} options={[['', trLu('partout')], ...sides.map(x => [x, nomSide(x)] as const)]} onChoisir={v => maj({ side: v })} testID="esport-lineup-form-side" />
        </View>
      ) : null}
      {zones.length > 0 ? <Choix theme={theme} libelle={trLu('form.zone')} valeur={s.zone} options={[{ id: '', nom: trLu('form.zone.aucune') }, ...zones, { id: ZONE_LIBRE, nom: trLu('form.zone.autre') }]} onChoisir={v => maj({ zone: v })} testID="esport-lineup-form-zone" /> : null}
      {zones.length === 0 || s.zone === ZONE_LIBRE ? <Champ theme={theme} libelle={trLu('form.zone.libre')} valeur={s.zoneLibre} onChanger={v => maj({ zoneLibre: v, zone: ZONE_LIBRE })} maxLength={60} testID="esport-lineup-form-zone-libre" /> : null}
      <View style={{ gap: 4 }}>
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trLu('posture')}</Text>
        <Segments theme={theme} libelle={trLu('posture')} valeur={s.posture} options={POSTURES.map(p => [p, trLu(`posture.${p}` as CleLu)] as const)} onChoisir={v => maj({ posture: v })} testID="esport-lineup-form-posture" />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trLu('difficulte')}</Text>
        <Segments theme={theme} libelle={trLu('difficulte')} valeur={String(s.difficulte)} options={[['1', trLu('difficulte.1')], ['2', trLu('difficulte.2')], ['3', trLu('difficulte.3')]]} onChoisir={v => maj({ difficulte: Number(v) })} testID="esport-lineup-form-difficulte" />
      </View>
      <Champ theme={theme} libelle={trLu('form.visee')} valeur={s.visee} onChanger={v => maj({ visee: v })} maxLength={500} placeholder={trLu('form.visee.aide')} testID="esport-lineup-form-visee" />
      <Champ theme={theme} libelle={trLu('form.timing')} valeur={s.timing} onChanger={v => maj({ timing: v })} maxLength={120} placeholder={trLu('form.timing.aide')} testID="esport-lineup-form-timing" />
      <Champ theme={theme} libelle={trLu('form.instructions')} valeur={s.instructions} onChanger={v => maj({ instructions: v })} maxLength={4000} multiligne placeholder={trLu('form.instructions.aide')} testID="esport-lineup-form-instructions" />
      <Champ theme={theme} libelle={trLu('form.tags')} valeur={s.tags} onChanger={v => maj({ tags: v })} maxLength={200} testID="esport-lineup-form-tags" />
      {droits.gerer ? (
        <View style={{ gap: 4 }}>
          <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trLu('form.statut')}</Text>
          <Segments<StatutLineup> theme={theme} libelle={trLu('form.statut')} valeur={s.statut} options={[['valide', trLu('statut.valide')], ['propose', trLu('statut.propose')]]} onChoisir={v => maj({ statut: v })} testID="esport-lineup-form-statut" />
        </View>
      ) : null}
    </View>
  );

  const etatPoint = (p: PointCarte | null) => trLu(p ? 'form.points.etat.pose' : 'form.points.etat.absent');
  const points = (
    <View style={{ gap: ESP.xs }} testID="esport-lineup-form-points">
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trLu('form.points')}</Text>
      {s.carte || cleDe(s.carteLibre) ? (
        <>
          <Text style={attenue(theme, 12)}>{trLu('form.points.aide')}</Text>
          <Segments<'depart' | 'arrivee'>
            theme={theme}
            libelle={trLu('form.points.pose')}
            valeur={pose}
            options={[
              ['depart', `${trLu('form.points.depart')} (${etatPoint(s.depart)})`],
              ['arrivee', `${trLu('form.points.arrivee')} (${etatPoint(s.arrivee)})`],
            ]}
            onChoisir={setPose}
            testID="esport-lineup-form-pose"
          />
          <View style={{ maxWidth: 560 }}>
            <CarteTactique
              carte={carte}
              nom={carte?.nom ?? s.carteLibre}
              trajets={[{ id: 'form', depart: s.depart, arrivee: s.arrivee, couleur }]}
              onToucher={toucher}
              libelleToucher={trLu('form.points.toucher', { carte: carte?.nom ?? s.carteLibre, point: trLu(pose === 'depart' ? 'form.points.depart' : 'form.points.arrivee') })}
              testID="esport-lineup-form-carte-points"
            />
          </View>
          {s.depart || s.arrivee ? (
            <View style={{ flexDirection: 'row' }}>
              <BoutonHub
                theme={theme}
                titre={trLu('form.points.effacer')}
                onPress={() => {
                  maj({ depart: null, arrivee: null });
                  setPose('depart');
                }}
                testID="esport-lineup-form-points-effacer"
              />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={attenue(theme, 13)}>{trLu('form.points.sans_carte')}</Text>
      )}
    </View>
  );

  const ligneMedia = (cle: string, vignette: React.ReactNode, nom: string, detail: string | undefined, role: RoleMedia, surRole: ((r: RoleImage) => void) | undefined, surRetrait: () => void) => (
    <View key={cle} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
      <View style={{ width: 72, height: 44, borderRadius: 6, overflow: 'hidden', backgroundColor: '#0B0F14', alignItems: 'center', justifyContent: 'center' }}>{vignette}</View>
      <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
        <Text numberOfLines={1} style={{ ...texte(theme, 13), fontWeight: '600' }}>
          {nom}
          {detail ? <Text style={{ ...attenue(theme, 12), fontWeight: '400' }}>{`  ${detail}`}</Text> : null}
        </Text>
        {role !== 'video' && surRole ? <ChoixRole theme={theme} valeur={role} onChoisir={surRole} testID={`esport-lineup-form-role-${cle}`} /> : <Text style={attenue(theme, 12)}>{trLu('role.video')}</Text>}
      </View>
      <Pressable testID={`esport-lineup-form-retirer-${cle}`} accessibilityRole="button" accessibilityLabel={trLu('form.medias.retirer', { nom })} onPress={surRetrait} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icone nom="croix" taille={18} couleur={theme.critique} />
      </Pressable>
    </View>
  );
  const medias = (
    <View style={{ gap: ESP.xs }} testID="esport-lineup-form-medias">
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trLu('form.medias')}</Text>
      <Text style={attenue(theme, 12)}>{trLu('form.medias.aide', { n: limites.images })}</Text>
      {(courant?.medias ?? []).map(m =>
        ligneMedia(
          m.id,
          m.genre === 'image' && m.lien ? <Image source={{ uri: m.lien.url }} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width: '100%', height: '100%' }} /> : <Icone nom="video" taille={20} couleur="#FFFFFF" />,
          m.nom,
          tailleMedia(m.taille, langue),
          m.role,
          m.genre === 'image' ? r => void agir('media', async () => setCourant(await api.modifierMedia(teamId, courant?.id ?? '', m.id, { role: r }))) : undefined,
          () => void agir('media', async () => setCourant(await api.retirerMedia(teamId, courant?.id ?? '', m.id))),
        ),
      )}
      {attente.map(a =>
        ligneMedia(
          a.cle,
          <Icone nom={a.role === 'video' ? 'video' : 'image'} taille={20} couleur="#FFFFFF" />,
          a.fichier.nom,
          trLu('form.medias.en_attente'),
          a.role,
          r => setAttente(liste => liste.map(x => (x.cle === a.cle ? { ...x, role: r } : x))),
          () => setAttente(liste => liste.filter(x => x.cle !== a.cle)),
        ),
      )}
      {envoiNom ? (
        <View style={{ gap: 4 }}>
          <Text style={attenue(theme, 12)}>{trLu('form.medias.envoi', { nom: envoiNom })}</Text>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-lineup-form-envoi" />
        </View>
      ) : null}
      {choixFichierDisponible ? (
        <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
          <BoutonHub theme={theme} titre={trLu('form.medias.image')} icone="image" desactive={nImages >= limites.images || Boolean(enCours)} onPress={() => void ajouter('position')} testID="esport-lineup-form-ajouter-image" />
          <BoutonHub theme={theme} titre={trLu('form.medias.video')} icone="video" desactive={aVideo || Boolean(enCours)} onPress={() => void ajouter('video')} testID="esport-lineup-form-ajouter-video" />
        </View>
      ) : (
        <Text style={attenue(theme, 12)}>{trLu('form.medias.natif')}</Text>
      )}
      <Champ theme={theme} libelle={trLu('form.video_url')} valeur={s.videoUrl} onChanger={v => maj({ videoUrl: v })} maxLength={500} placeholder="https://" testID="esport-lineup-form-video-url" />
    </View>
  );

  return (
    <View testID="esport-lineup-formulaire" style={{ gap: ESP.m }}>
      <Text accessibilityRole="header" style={titre(theme, large ? 22 : 20)}>
        {trLu(courant ? 'form.modifier' : 'form.nouveau')}
      </Text>
      {courant ? <BandeauConflit theme={theme} verrou={verrou} onRecharger={recharger} testID="esport-lineup-form-conflit" /> : null}
      <View style={large ? { flexDirection: 'row', gap: ESP.xl, alignItems: 'flex-start' } : { gap: ESP.m }}>
        {champs}
        <View style={{ gap: ESP.l, flex: large ? 1 : undefined, minWidth: 0 }}>
          {points}
          {medias}
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lineup-form" />
      <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
        <BoutonHub theme={theme} titre={trLu(courant ? 'form.enregistrer' : droits.gerer ? 'form.creer' : 'form.proposer')} variante="plein" desactive={Boolean(enCours) || !complet} onPress={enregistrer} testID="esport-lineup-form-enregistrer" />
        <BoutonHub theme={theme} titre={trLu('form.annuler')} onPress={onAnnuler} testID="esport-lineup-form-annuler" />
      </View>
    </View>
  );
}

/** Le modèle du jeu a-t-il des sides (attaque / défense) plutôt que des modes ? */
function aDesSides(modele: ModeleStrat): boolean {
  return modele !== 'thefinals';
}
