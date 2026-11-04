/**
 * Ressources liées à une carte d'un tableau CM ou à un dossier du Drive (relation plusieurs-à-plusieurs, docs/esport/cm.md) :
 * liste des liens liés (ouverture dans un nouvel onglet), « Lier une ressource » (recherche parmi les ressources
 * existantes, ou « Créer une nouvelle ressource »), délier. Le serveur ne rend que ce que le compte voit ; sans le droit
 * de lier (cm.editer du club et droit d'écriture sur la cible), la liste reste en lecture seule. Un compte qui n'a pas
 * accès aux ressources ne voit rien (le bloc se masque). Ressource « fichier » (migration 0051) : icône de son type,
 * ouverture par lien signé (nouvel onglet) ; fichier d'un Drive que le compte ne voit pas : la mention « Fichier d'un
 * Drive auquel vous n'avez pas accès », sans lien.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { apiLiens, fichierLisible, filtrerLiens, type GenreLiaison, type LienCm, type ListeLiens } from '../../../cm/liens';
import { GLYPHES_DRIVE } from '../../../cm/drive';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import { trLi } from '../../../i18n/liens';
import { Icone } from '../../../../ui/icones';
import { useTempsReel } from '../../../tempsReel/hooks';
import { Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { Badge, ESP, Volet, attenue, texte } from '../../design';
import { FormLien } from './FormLien';
import { ouvrirAdresse } from './ouvrirAdresse';

export function LiensLies({
  theme,
  client,
  genre,
  cibleId,
  enveloppe = true,
  prefixe = `esport-cm-liens-${genre}`,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  genre: GenreLiaison;
  cibleId: string;
  /** Dans un panneau de fiche (carte) ; `false` : sans cadre (volet d'un dossier). */
  enveloppe?: boolean;
  prefixe?: string;
}) {
  const api = useMemo(() => apiLiens(client), [client]);
  const [liens, setLiens] = useState<LienCm[] | undefined>();
  const [droits, setDroits] = useState({ lier: false, creer: false });
  const [indisponible, setIndisponible] = useState(false);
  const [choix, setChoix] = useState(false);
  const [creation, setCreation] = useState(false);
  const [tous, setTous] = useState<ListeLiens | undefined>();
  const [q, setQ] = useState('');
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    try {
      const r = await api.deLaCible(genre, cibleId);
      setLiens(r.liens);
      setDroits(r.droits);
      setIndisponible(false);
    } catch {
      setIndisponible(true);
    }
  }, [api, genre, cibleId]);
  useEffect(() => {
    void charger();
  }, [charger]);
  useTempsReel(client, 'cm', () => void charger());
  const ouvrirChoix = () => {
    setChoix(true);
    setQ('');
    void agir('liste', async () => setTous(await api.lister()));
  };
  const lier = (id: string) =>
    agir('lier', async () => {
      await api.lier(id, genre, cibleId);
      await charger();
      return trLi('cible.lie');
    });
  if (indisponible || !liens) return null;
  const dedans = new Set(liens.map(l => l.id));
  const proposes = filtrerLiens(tous?.liens ?? [], { q });
  const corps = (
    <View style={{ gap: ESP.s }} testID={prefixe}>
      <Intertitre theme={theme}>{trLi('cible.titre')}</Intertitre>
      <Retours theme={theme} erreur={choix || creation ? undefined : erreur} avis={choix || creation ? undefined : avis} prefixe={prefixe} />
      {!liens.length ? <Text style={attenue(theme, 14)} testID={`${prefixe}-vide`}>{trLi('cible.vide')}</Text> : null}
      {liens.map(l => (
        <View key={l.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]} testID={`${prefixe}-${l.id}`}>
          <Icone nom={fichierLisible(l) ? GLYPHES_DRIVE[fichierLisible(l)!.genre] : l.genre === 'fichier' ? 'document' : 'globe'} taille={18} couleur={theme.accent} />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${l.genre === 'fichier' ? trLi('fichier.apercu_de', { titre: l.titre }) : trLi('ouvrir_lien', { titre: l.titre })}${l.acces === 'restreint' ? ` · ${trLi('restreint_badge')}` : ''}${l.nouveau ? ` · ${trLi('nouveau_badge')}` : ''}`}
            disabled={l.genre === 'fichier' && !fichierLisible(l)}
            onPress={() => {
              // Fichier (migration 0051) : lien signé revérifié par le serveur ; lien : nouvel onglet.
              if (l.genre === 'fichier') void ouvrirLienDiffere(async () => (await api.lienFichier(l.id)).url);
              else ouvrirAdresse(l.url);
              // Partagée et pas encore ouverte : « Nouveau » disparaît (migration 0048).
              if (l.nouveau) void api.vu(l.id).then(charger).catch(() => undefined);
            }}
            style={{ flex: 1, minWidth: 0 }}
            testID={`${prefixe}-${l.id}-ouvrir`}>
            <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }} numberOfLines={2}>
              {l.titre}
            </Text>
            {l.acces === 'restreint' || l.nouveau ? (
              <View style={[styles.ligne, { gap: ESP.xxs, flexWrap: 'wrap' }]}>
                {l.nouveau ? <Badge theme={theme} texte={trLi('nouveau_badge')} ton="accent" testID={`${prefixe}-${l.id}-nouveau`} /> : null}
                {l.acces === 'restreint' ? <Badge theme={theme} texte={trLi('restreint_badge')} icone="cadenas" testID={`${prefixe}-${l.id}-restreint`} /> : null}
              </View>
            ) : null}
            <Text style={attenue(theme, 12)} numberOfLines={1}>
              {l.genre !== 'fichier' ? l.hote : (fichierLisible(l)?.nom ?? (l.fichier?.etat === 'supprime' ? trLi('fichier.supprime') : trLi('fichier.inaccessible')))}
            </Text>
          </Pressable>
          {droits.lier && (l.droits?.modifier ?? true) ? (
            <BoutonHub theme={theme} titre={trLi('lies.delier')} libelle={trLi('cible.delier', { titre: l.titre })} onPress={() => void agir('delier', async () => { await api.delier(l.id, genre, cibleId); await charger(); return trLi('cible.delie'); })} testID={`${prefixe}-${l.id}-delier`} />
          ) : null}
        </View>
      ))}
      {droits.lier || droits.creer ? <BoutonHub theme={theme} titre={trLi('cible.lier')} icone="lien" onPress={ouvrirChoix} testID={`${prefixe}-lier`} /> : null}
    </View>
  );
  return (
    <>
      {enveloppe ? <Panneau theme={theme}>{corps}</Panneau> : corps}
      {choix ? (
        <Volet theme={theme} visible titre={trLi('cible.lier')} onFermer={() => setChoix(false)} testID={`${prefixe}-volet`} largeur={460}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`${prefixe}-volet`} />
            <Champ theme={theme} libelle={trLi('cible.cherche')} valeur={q} onChanger={setQ} maxLength={80} testID={`${prefixe}-recherche`} />
            {tous && !proposes.length ? <Text style={attenue(theme, 14)}>{trLi('cible.aucune')}</Text> : null}
            {proposes.slice(0, 50).map(l => (
              <Pressable
                key={l.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: dedans.has(l.id) }}
                disabled={dedans.has(l.id) || !droits.lier || l.droits?.modifier === false}
                onPress={() => void lier(l.id)}
                testID={`${prefixe}-choix-${l.id}`}
                style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: ESP.s, backgroundColor: dedans.has(l.id) ? teinteTransparente(theme.accent, 0.08) : theme.surface, opacity: droits.lier ? 1 : 0.6 }}>
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={2}>
                  {l.titre}
                </Text>
                <Text style={attenue(theme, 12)} numberOfLines={1}>
                  {[l.genre === 'fichier' ? (fichierLisible(l)?.nom ?? trLi('type.fichiers')) : l.hote, dedans.has(l.id) ? trLi('cible.deja') : ''].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
            {droits.creer ? <BoutonHub theme={theme} titre={trLi('cible.creer')} variante="plein" onPress={() => setCreation(true)} testID={`${prefixe}-creer`} /> : null}
            <BoutonHub theme={theme} titre={trLi('cible.fermer')} onPress={() => setChoix(false)} testID={`${prefixe}-fermer`} />
          </View>
        </Volet>
      ) : null}
      {creation && tous ? (
        <FormLien
          theme={theme}
          categories={tous.categories}
          teams={tous.teams}
          titreBouton={droits.lier ? trLi('cible.creer_lier') : undefined}
          prefixe={`${prefixe}-form`}
          optionsAcces={teamId => api.optionsAcces(teamId)}
          onFermer={() => setCreation(false)}
          onEnregistrer={async s => {
            const { lien } = await api.creer(s);
            if (droits.lier) await api.lier(lien.id, genre, cibleId);
            await charger();
            setChoix(false);
          }}
        />
      ) : null}
    </>
  );
}
