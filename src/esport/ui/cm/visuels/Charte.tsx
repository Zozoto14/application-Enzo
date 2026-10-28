/**
 * Charte graphique du club (Esport › CM › Visuels › Charte) : nom du club, palette (9 couleurs), polices
 * (titres, sous-titres, texte, chiffres — polices embarquées, licence OFL), effets (néon, glitch, scanlines,
 * grain), logos (club et une par team, images importées). Modifiable avec cm.gerer ; changer la charte
 * change tous les modèles qui l'utilisent (aperçu en direct).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiVisuels, ReponseCharte } from '../../../cm/visuels/api';
import { lireCharte } from '../../../cm/visuels/charte';
import { donneesExemple } from '../../../cm/visuels/champs';
import { modeleDefaut } from '../../../cm/visuels/modeles';
import { CLES_COULEURS, POLICES, ROLES_POLICES, type Charte, type CleCouleur, type Police, type RolePolice } from '../../../cm/visuels/types';
import { choisirFichier, choixFichierDisponible } from '../../../medias/choixFichier';
import { ChoixDrive } from '../drive/ChoixDrive';
import { IMAGES_DRIVE } from '../../../cm/drive';
import { trDr } from '../../../i18n/drive';
import { envoyerFichier } from '../../../medias/envoi';
import { langueCourante } from '../../../i18n';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { BoutonConfirme, Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { ESP, attenue, texte } from '../../design';
import { Apercu } from './Apercu';
import { ChampNombre, Pastilles } from './controles';

const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,image/gif';

export function CharteClub({ theme, api, large, onChange }: { theme: ThemeHub; api: ApiVisuels; large: boolean; onChange?(c: Charte): void }) {
  const [r, setR] = useState<ReponseCharte | undefined>();
  const [c, setC] = useState<Charte | undefined>();
  const [hex, setHex] = useState<Partial<Record<CleCouleur, string>>>({});
  const [logoDrive, setLogoDrive] = useState<string | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const x = await api.charte();
      setR(x);
      setC(lireCharte(x.charte));
    });
  }, [agir, api]);
  const exemple = useMemo(() => modeleDefaut('annonce', 'carre'), []);
  const donnees = useMemo(() => donneesExemple('serie'), []);
  if (!r || !c) return <Retours theme={theme} erreur={erreur} prefixe="esport-vi-charte" />;
  const gerer = r.gerer;
  const maj = (x: Partial<Charte>) => setC({ ...c, ...x });
  const importerLogo = (cible: 'club' | string) =>
    agir('logo', async () => {
      const f = await choisirFichier(ACCEPT_IMAGES, 'esport-vi-logo-fichier');
      if (!f) return undefined;
      const { etat, oublier } = await envoyerFichier({ client: api.client, teamId: 'club', section: 'cm', fichier: f });
      const img = await api.importerImage('club', etat.id);
      oublier();
      setC(prev => (prev ? { ...prev, logos: cible === 'club' ? { ...prev.logos, club: img.fichierId } : { ...prev.logos, teams: { ...prev.logos.teams, [cible]: img.fichierId } } } : prev));
      return undefined;
    });
  // Logo pris dans le Drive du club (migration 0027) : importé comme image du club, sans copie des octets.
  const logoDepuisDrive = (cible: 'club' | string, fichierDrive: string) =>
    agir('logo', async () => {
      const img = await api.importerImageDepuisDrive('club', fichierDrive);
      setC(prev => (prev ? { ...prev, logos: cible === 'club' ? { ...prev.logos, club: img.fichierId } : { ...prev.logos, teams: { ...prev.logos.teams, [cible]: img.fichierId } } } : prev));
      return undefined;
    });
  const retirerLogo = (cible: 'club' | string) => setC({ ...c, logos: cible === 'club' ? { ...c.logos, club: null } : { ...c.logos, teams: Object.fromEntries(Object.entries(c.logos.teams).filter(([k]) => k !== cible)) } });
  const enregistrer = () =>
    agir('enregistrer', async () => {
      // Logos retirés : envoyés à null (le serveur fusionne les logos des teams).
      const teams: Record<string, string | null> = { ...c.logos.teams };
      for (const id of Object.keys(r.charte.logos.teams)) if (!(id in teams)) teams[id] = null;
      const x = await api.changerCharte({ ...c, logos: { club: c.logos.club, teams: teams as Record<string, string> } }, r.version);
      setR(x);
      setC(lireCharte(x.charte));
      onChange?.(lireCharte(x.charte));
      return trVi('charte.enregistree');
    });
  const reinitialiser = () =>
    agir('reinitialiser', async () => {
      const x = await api.reinitialiserCharte();
      setR(x);
      setC(lireCharte(x.charte));
      onChange?.(lireCharte(x.charte));
      return trVi('charte.enregistree');
    });

  const ligneLogo = (cible: 'club' | string, libelle: string, fichier: string | null | undefined) => (
    <View key={cible} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
      <Text style={texte(theme)}>{`${libelle} · ${fichier ? '✓' : trVi('charte.logo_aucun')}`}</Text>
      {gerer ? (
        <View style={[styles.ligne, { gap: 4 }]}>
          {choixFichierDisponible ? <BoutonHub theme={theme} titre={trVi('charte.logo_choisir')} onPress={() => void importerLogo(cible)} testID={`esport-vi-logo-${cible}`} /> : null}
          <BoutonHub theme={theme} titre={trDr('choix.depuis_drive')} onPress={() => setLogoDrive(cible)} testID={`esport-vi-logo-${cible}-drive`} />
          {fichier ? <BoutonHub theme={theme} titre={trVi('charte.logo_retirer')} onPress={() => retirerLogo(cible)} testID={`esport-vi-logo-${cible}-retirer`} /> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: ESP.m }} testID="esport-vi-charte">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi-charte" />
      <ChoixDrive
        theme={theme}
        client={api.client}
        visible={logoDrive !== undefined}
        portees={['club']}
        accepter={f => IMAGES_DRIVE.includes(f.meta.format ?? '')}
        aide={trDr('choix.images')}
        onFermer={() => setLogoDrive(undefined)}
        onChoisir={f => {
          const cible = logoDrive ?? 'club';
          setLogoDrive(undefined);
          void logoDepuisDrive(cible, f.id);
        }}
        testID="esport-vi-logo-choix-drive"
      />
      <Text style={attenue(theme)}>{trVi('charte.aide')}</Text>
      {!gerer ? <Text style={attenue(theme)}>{trVi('charte.lecture_seule')}</Text> : null}
      <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.m, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: ESP.m, minWidth: 0 }}>
          <Panneau theme={theme}>
            <Champ theme={theme} libelle={trVi('charte.club')} valeur={c.club} maxLength={60} onChanger={club => gerer && maj({ club })} testID="esport-vi-charte-club" />
            <Champ theme={theme} libelle={trVi('charte.nom')} valeur={c.nom} maxLength={60} onChanger={nom => gerer && maj({ nom })} testID="esport-vi-charte-nom" />
          </Panneau>
          <Panneau theme={theme} testID="esport-vi-charte-couleurs">
            <Intertitre theme={theme}>{trVi('charte.couleurs')}</Intertitre>
            <View style={[styles.ligne, { gap: ESP.s }]}>
              {CLES_COULEURS.map(k => (
                <View key={k} style={{ width: 150, gap: 4 }}>
                  <View style={{ height: 36, borderRadius: 8, backgroundColor: c.couleurs[k], borderWidth: 1, borderColor: theme.ligne }} />
                  <Champ
                    theme={theme}
                    libelle={trVi(`charte.couleur.${k}` as CleVi)}
                    valeur={hex[k] ?? c.couleurs[k]}
                    maxLength={7}
                    testID={`esport-vi-charte-couleur-${k}`}
                    onChanger={v => {
                      if (!gerer) return;
                      setHex({ ...hex, [k]: v });
                      if (/^#[0-9a-fA-F]{6}$/.test(v.trim())) maj({ couleurs: { ...c.couleurs, [k]: v.trim().toLowerCase() } });
                    }}
                  />
                </View>
              ))}
            </View>
          </Panneau>
          <Panneau theme={theme} testID="esport-vi-charte-polices">
            <Intertitre theme={theme}>{trVi('charte.polices')}</Intertitre>
            {ROLES_POLICES.map((role: RolePolice) => (
              <Pastilles<Police> key={role} theme={theme} libelle={trVi(`charte.police.${role}` as CleVi)} valeur={c.polices[role]} options={POLICES.map(p => [p, p] as const)} onChoisir={p => gerer && maj({ polices: { ...c.polices, [role]: p } })} testID={`esport-vi-charte-police-${role}`} />
            ))}
          </Panneau>
          <Panneau theme={theme} testID="esport-vi-charte-effets">
            <Intertitre theme={theme}>{trVi('charte.effets')}</Intertitre>
            <View style={[styles.ligne, { gap: ESP.s }]}>
              {(['neon', 'scanlines', 'grain'] as const).map(k => (
                <ChampNombre key={k} theme={theme} libelle={trVi(`charte.effet.${k}`)} valeur={c.effets[k]} min={0} max={1} largeur={130} onChanger={v => gerer && maj({ effets: { ...c.effets, [k]: v } })} testID={`esport-vi-charte-effet-${k}`} />
              ))}
            </View>
            <Interrupteur theme={theme} libelle={trVi('charte.effet.glitch')} valeur={c.effets.glitch} desactive={!gerer} onChanger={glitch => maj({ effets: { ...c.effets, glitch } })} testID="esport-vi-charte-glitch" />
          </Panneau>
          <Panneau theme={theme} testID="esport-vi-charte-logos">
            <Intertitre theme={theme}>{trVi('charte.logos')}</Intertitre>
            {ligneLogo('club', trVi('charte.logo_club'), c.logos.club)}
            {r.teams.map(t => ligneLogo(t.id, trVi('charte.logo_team', { team: t.nom ?? '' }), c.logos.teams[t.id]))}
          </Panneau>
          {gerer ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={trVi('charte.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID="esport-vi-charte-enregistrer" />
              <BoutonConfirme theme={theme} titre={trVi('charte.reinitialiser')} confirmation={trVi('charte.reinitialiser_confirmer')} onConfirme={() => void reinitialiser()} testID="esport-vi-charte-reinitialiser" />
            </View>
          ) : null}
        </View>
        <View style={{ gap: ESP.xs }}>
          <Intertitre theme={theme}>{trVi('charte.apercu')}</Intertitre>
          <Apercu theme={theme} api={api} charte={c} document={exemple} donnees={donnees} langue={langueCourante()} largeur={large ? 320 : 260} libelle={trVi('type.annonce')} testID="esport-vi-charte-apercu" />
        </View>
      </View>
    </View>
  );
}
