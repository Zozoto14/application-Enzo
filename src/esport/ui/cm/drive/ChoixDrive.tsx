/**
 * Choisir un fichier dans le Drive (pièce jointe d'une carte CM, image de l'éditeur de visuels, logo de la
 * charte, pièce d'un sponsor) : choix du Drive (club ou une team : seuls ceux que l'utilisateur voit), dossiers,
 * recherche (dans le Drive choisi ou dans tous), fichiers acceptés (`accepter`). Rien n'est copié : le serveur
 * réutilise les octets du Drive et revérifie l'accès (docs/esport/drive.md, « Choisir dans quel Drive »).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { GLYPHES_DRIVE, apiDrive, type ContenuDrive, type FichierDrive, type MaillonDrive, type PorteeDrive } from '../../../cm/drive';
import { trDr, trnDr } from '../../../i18n/drive';
import { Glyphe } from '../../../../ui/icones';
import { Choix, Retours, useAgir } from '../../commun';
import { ESP, Volet, attenue, couleurTeam, texte, type EtatPresse } from '../../design';
import { infosFichier, nomDossier } from './commun';

const PORTEE_CLUB = 'club';

/** Nom d'un Drive dans le choix : « Drive du club (CM) » ou le nom de la team. */
export const nomDriveChoix = (p: { portee: string; team: { nom: string | null } | null }): string => (p.portee === PORTEE_CLUB ? trDr('choix.drive_club') : trDr('choix.drive_team', { team: p.team?.nom ?? '—' }));

interface ResultatDrive {
  portee: string;
  fichiers: FichierDrive[];
  chemins: Record<string, MaillonDrive[]>;
}

export function ChoixDrive({
  theme,
  client,
  visible,
  portees: permises,
  defaut,
  libres,
  avisAutreDrive,
  accepter = () => true,
  aide,
  onChoisir,
  onFermer,
  testID = 'esport-drive-choix',
}: {
  theme: ThemeHub;
  client: ClientEsport;
  visible: boolean;
  /** Restreint les Drives proposés (« club », une team) ; sans : tous ceux que l'acteur voit. */
  portees?: string[];
  /** Drive ouvert au départ (celui de la portée courante) ; le premier Drive proposé sinon. */
  defaut?: string;
  /** Drives « sans réserve » pour cet usage : un fichier d'un autre Drive affiche `avisAutreDrive`. */
  libres?: string[];
  avisAutreDrive?: string;
  accepter?(f: FichierDrive): boolean;
  aide?: string;
  onChoisir(f: FichierDrive): void;
  onFermer(): void;
  testID?: string;
}) {
  const api = useMemo(() => apiDrive(client), [client]);
  const [portees, setPortees] = useState<PorteeDrive[] | undefined>();
  const [limite, setLimite] = useState(false);
  const [portee, setPortee] = useState<string | undefined>();
  const [dossier, setDossier] = useState<string | null>(null);
  const [contenu, setContenu] = useState<ContenuDrive | undefined>();
  const [q, setQ] = useState('');
  const [tous, setTous] = useState(false);
  const [resultats, setResultats] = useState<ResultatDrive[] | undefined>();
  const jeton = useRef(0);
  const { erreur, agir } = useAgir();
  const cles = (permises ?? []).join();
  useEffect(() => {
    if (!visible) return;
    void agir('', async () => {
      const tout = (await api.portees()).portees.filter(p => p.droits.voir);
      const r = tout.filter(p => !cles || cles.split(',').includes(p.portee));
      setPortees(r);
      setLimite(r.length < tout.length);
      setPortee(p => (p && r.some(x => x.portee === p) ? p : (r.find(x => x.portee === defaut) ?? r[0])?.portee));
    });
  }, [agir, api, cles, defaut, visible]);
  const recherche = q.trim();
  const charger = useCallback(async () => {
    if (portee) setContenu(await api.lister(portee, dossier));
  }, [api, portee, dossier]);
  useEffect(() => {
    if (visible) void agir('', charger);
  }, [agir, charger, visible]);
  // Recherche : dans le Drive choisi, ou dans tous ceux de l'utilisateur (résultats regroupés par Drive). Changer
  // de Drive garde le texte cherché. Un Drive qui répond en erreur ne masque pas les autres.
  const cibles = useMemo(() => (tous ? (portees ?? []).map(p => p.portee) : portee ? [portee] : []), [tous, portees, portee]);
  const ciblesCle = cibles.join();
  useEffect(() => {
    if (!visible || !recherche || !ciblesCle) {
      setResultats(undefined);
      return;
    }
    const mon = ++jeton.current;
    const t = setTimeout(() => {
      void Promise.all(
        ciblesCle.split(',').map(async (p): Promise<ResultatDrive | null> => {
          try {
            const r = await api.rechercher(p, { q: recherche });
            return { portee: p, fichiers: r.fichiers, chemins: r.chemins };
          } catch {
            return null;
          }
        }),
      ).then(r => {
        if (mon === jeton.current) setResultats(r.filter((x): x is ResultatDrive => x !== null));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [api, recherche, ciblesCle, visible]);
  if (!visible) return null;
  const courant = portees?.find(p => p.portee === portee);
  const fichiers = (contenu?.fichiers ?? []).filter(accepter);
  const parPortee = new Map((portees ?? []).map(p => [p.portee, p]));
  const groupes = (resultats ?? []).map(r => ({ ...r, fichiers: r.fichiers.filter(accepter) })).filter(r => r.fichiers.length);
  const total = groupes.reduce((n, g) => n + g.fichiers.length, 0);
  const choisir = (f: FichierDrive) => onChoisir(f);
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
  const avis = avisAutreDrive && libres && courant && !libres.includes(courant.portee) && !tous ? avisAutreDrive : undefined;
  return (
    <Volet theme={theme} visible titre={trDr('choix.titre')} onFermer={onFermer} testID={testID}>
      <Retours theme={theme} erreur={erreur} prefixe={testID} />
      {aide ? <Text style={attenue(theme)}>{aide}</Text> : null}
      {limite ? (
        <Text style={attenue(theme, 12)} testID={`${testID}-limite`}>
          {trDr('choix.drive_limite')}
        </Text>
      ) : null}
      {portees && portees.length > 1 ? (
        <Choix
          theme={theme}
          libelle={trDr('choix.drive')}
          valeur={portee}
          options={portees.map(p => ({ id: p.portee, nom: nomDriveChoix(p), couleur: p.team ? couleurTeam(p.team.slug ?? p.team.id) : theme.accent }))}
          onChoisir={p => {
            setPortee(p);
            setDossier(null);
          }}
          testID={`${testID}-portee`}
        />
      ) : null}
      <Champ theme={theme} libelle={trDr('choix.recherche')} valeur={q} onChanger={setQ} maxLength={80} testID={`${testID}-recherche`} />
      {portees && portees.length > 1 ? <Interrupteur theme={theme} libelle={trDr('choix.tous')} valeur={tous} onChanger={setTous} testID={`${testID}-tous`} /> : null}
      {avis ? (
        <Text style={attenue(theme, 12)} testID={`${testID}-avis`}>
          {avis}
        </Text>
      ) : null}
      {recherche ? (
        <View style={{ gap: 2 }} testID={`${testID}-resultats`}>
          {resultats ? <Text style={attenue(theme, 12)}>{trnDr('choix.resultats', total)}</Text> : null}
          {groupes.map(g => {
            const p = parPortee.get(g.portee);
            return (
              <View key={g.portee} style={{ gap: 2 }} testID={`${testID}-groupe-${g.portee}`}>
                {tous && p ? <Text style={{ ...texte(theme, 13), fontWeight: '700', color: p.team ? couleurTeam(p.team.slug ?? p.team.id) : theme.accent }}>{nomDriveChoix(p)}</Text> : null}
                {g.fichiers.map(f => ligne(f.id, GLYPHES_DRIVE[f.genre], f.nom, [(f.dossierId ? (g.chemins[f.dossierId] ?? []) : []).map(nomDossier).join(' › '), infosFichier(f)].filter(Boolean).join(' · '), () => choisir(f), f.id))}
              </View>
            );
          })}
          {resultats && !groupes.length ? <Text style={attenue(theme)}>{trDr('choix.aucun_resultat')}</Text> : null}
        </View>
      ) : (
        <>
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }} testID={`${testID}-chemin`}>
            {[courant ? nomDriveChoix(courant) : trDr('racine'), ...(contenu?.chemin ?? []).map(nomDossier)].join(' › ')}
          </Text>
          <View style={{ gap: 2 }}>
            {contenu?.dossier ? ligne('parent', '↰', trDr('choix.remonter'), '', () => setDossier(contenu.dossier?.parentId ?? null), 'parent') : null}
            {(contenu?.dossiers ?? []).map(d => ligne(d.id, GLYPHES_DRIVE.dossier, nomDossier(d), '', () => setDossier(d.id), d.id))}
            {fichiers.map(f => ligne(f.id, GLYPHES_DRIVE[f.genre], f.nom, infosFichier(f), () => choisir(f), f.id))}
          </View>
          {contenu && !fichiers.length ? <Text style={attenue(theme)}>{trDr('choix.aucun')}</Text> : null}
        </>
      )}
    </Volet>
  );
}
