/**
 * Choisir un fichier dans le Drive (pièce jointe d'une carte CM, image de l'éditeur de visuels, logo de la
 * charte, pièce d'un sponsor) : Drives permis, dossiers, fichiers acceptés (`accepter`). Rien n'est copié :
 * le serveur réutilise les octets du Drive et revérifie l'accès.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { GLYPHES_DRIVE, apiDrive, type ContenuDrive, type FichierDrive, type PorteeDrive } from '../../../cm/drive';
import { trDr } from '../../../i18n/drive';
import { Glyphe } from '../../../../ui/icones';
import { Choix, Retours, useAgir } from '../../commun';
import { ESP, Volet, attenue, texte, type EtatPresse } from '../../design';
import { infosFichier, nomDossier, nomPortee } from './commun';

export function ChoixDrive({
  theme,
  client,
  visible,
  portees: permises,
  accepter = () => true,
  aide,
  onChoisir,
  onFermer,
  testID = 'esport-drive-choix',
}: {
  theme: ThemeHub;
  client: ClientEsport;
  visible: boolean;
  /** Drives où chercher (« club », une team) ; tous ceux de l'acteur sinon. */
  portees?: string[];
  accepter?(f: FichierDrive): boolean;
  aide?: string;
  onChoisir(f: FichierDrive): void;
  onFermer(): void;
  testID?: string;
}) {
  const api = useMemo(() => apiDrive(client), [client]);
  const [portees, setPortees] = useState<PorteeDrive[] | undefined>();
  const [portee, setPortee] = useState<string | undefined>();
  const [dossier, setDossier] = useState<string | null>(null);
  const [contenu, setContenu] = useState<ContenuDrive | undefined>();
  const { erreur, agir } = useAgir();
  const cles = (permises ?? []).join();
  useEffect(() => {
    if (!visible) return;
    void agir('', async () => {
      const r = (await api.portees()).portees.filter(p => p.droits.voir && (!cles || cles.split(',').includes(p.portee)));
      setPortees(r);
      setPortee(p => (p && r.some(x => x.portee === p) ? p : r[0]?.portee));
    });
  }, [agir, api, cles, visible]);
  const charger = useCallback(async () => {
    if (portee) setContenu(await api.lister(portee, dossier));
  }, [api, portee, dossier]);
  useEffect(() => {
    if (visible) void agir('', charger);
  }, [agir, charger, visible]);
  if (!visible) return null;
  const fichiers = (contenu?.fichiers ?? []).filter(accepter);
  const ligne = (cle: string, glyphe: string, nom: string, sous: string, onPress: () => void, id: string) => (
    <Pressable
      key={cle}
      accessibilityRole="button"
      accessibilityLabel={nom}
      onPress={onPress}
      testID={`${testID}-${id}`}
      style={(e: EtatPresse) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: ESP.s, paddingHorizontal: ESP.xs, borderRadius: 8, backgroundColor: e.hovered ? teinteTransparente(theme.accent, 0.08) : 'transparent' })}>
      <Glyphe valeur={glyphe} style={{ fontSize: 20, color: theme.attenue }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={1}>
          {nom}
        </Text>
        {sous ? (
          <Text style={attenue(theme, 12)} numberOfLines={1}>
            {sous}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
  return (
    <Volet theme={theme} visible titre={trDr('choix.titre')} onFermer={onFermer} testID={testID}>
      <Retours theme={theme} erreur={erreur} prefixe={testID} />
      {aide ? <Text style={attenue(theme)}>{aide}</Text> : null}
      {portees && portees.length > 1 ? (
        <Choix
          theme={theme}
          libelle={trDr('portee')}
          valeur={portee}
          options={portees.map(p => ({ id: p.portee, nom: nomPortee(p) }))}
          onChoisir={p => {
            setPortee(p);
            setDossier(null);
          }}
          testID={`${testID}-portee`}
        />
      ) : null}
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{[trDr('racine'), ...(contenu?.chemin ?? []).map(nomDossier)].join(' › ')}</Text>
      <View style={{ gap: 2 }}>
        {contenu?.dossier ? ligne('parent', '↰', trDr('choix.remonter'), '', () => setDossier(contenu.dossier?.parentId ?? null), 'parent') : null}
        {(contenu?.dossiers ?? []).map(d => ligne(d.id, GLYPHES_DRIVE.dossier, nomDossier(d), '', () => setDossier(d.id), d.id))}
        {fichiers.map(f => ligne(f.id, GLYPHES_DRIVE[f.genre], f.nom, infosFichier(f), () => onChoisir(f), f.id))}
      </View>
      {contenu && !fichiers.length ? <Text style={attenue(theme)}>{trDr('choix.aucun')}</Text> : null}
    </Volet>
  );
}
