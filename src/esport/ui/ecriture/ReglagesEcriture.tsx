/**
 * Administration IA › « Assistant d'écriture » (Fondateur) : l'activer ou non, et choisir qui peut s'en servir
 * (par défaut : le Fondateur SEUL ; il ajoute des rôles ou des personnes ; pour les autres, les boutons sont cachés).
 * Serveur : esport/noyau/ia/ecriture.mjs.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub, Case, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport, CompteEsport } from '../../client';
import { apiEcriture, etatEcriture, type ReglagesEcriture as Reglages } from '../../ecriture/api';
import { trEc, type CleEc } from '../../i18n/ecriture';
import { Choix } from '../commun';
import { Carte, ESP, TitreCarte, attenue, texte } from '../design';

const GROUPES = ['club', 'cm', 'staff_teams', 'joueurs'] as const;

export function ReglagesEcriture({ theme, client }: { theme: ThemeHub; client: ClientEsport }) {
  const api = useMemo(() => apiEcriture(client), [client]);
  const [r, setR] = useState<Reglages | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [comptes, setComptes] = useState<CompteEsport[]>([]);
  useEffect(() => {
    let actif = true;
    Promise.resolve()
      .then(() => client.annuaire())
      .then(a => actif && Array.isArray(a?.comptes) && setComptes(a.comptes))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [client]);
  useEffect(() => {
    let actif = true;
    Promise.resolve()
      .then(() => api.reglages())
      .then(x => actif && x && typeof x === 'object' && Array.isArray(x.groupes) && setR(x))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [api]);
  if (!r) return null;
  const regler = async (c: { actif?: boolean; groupes?: string[]; comptes?: string[] }) => {
    setErreur(undefined);
    setAvis(undefined);
    try {
      setR(await api.regler(c));
      void etatEcriture(client, true);
      setAvis(trEc('enregistre'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Carte theme={theme} testID="esport-ecriture-reglages">
      <TitreCarte theme={theme} icone="etincelles" titre={trEc('reglages_titre')} sous={trEc('reglages_sous')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESP.s }}>
        <Text style={{ ...texte(theme, 14), flex: 1 }}>{trEc('reglages_actif')}</Text>
        <Interrupteur theme={theme} libelle={trEc('reglages_actif')} valeur={r.actif} onChanger={v => void regler({ actif: v })} testID="esport-ecriture-actif" />
      </View>
      {r.actif ? (
        <View style={{ gap: ESP.xs }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trEc('reglages_groupes')}</Text>
          {GROUPES.map(g => (
            <View key={g} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
              <Case theme={theme} coche={r.groupes.includes(g)} libelle={trEc(`groupe.${g}` as CleEc)} onChanger={v => void regler({ groupes: v ? [...r.groupes, g] : r.groupes.filter(x => x !== g) })} testID={`esport-ecriture-groupe-${g}`} />
              <Text style={{ ...texte(theme, 13), flex: 1 }}>{trEc(`groupe.${g}` as CleEc)}</Text>
            </View>
          ))}
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trEc('reglages_personnes')}</Text>
          {(r.comptes ?? []).length ? null : <Text style={attenue(theme, 12)}>{trEc('reglages_personne_aucune')}</Text>}
          {(r.comptes ?? []).map(c => (
            <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
              <Text style={{ ...texte(theme, 13), flex: 1 }}>{comptes.find(x => x.compte === c)?.pseudo ?? c}</Text>
              <BoutonHub theme={theme} titre={trEc('reglages_retirer')} onPress={() => void regler({ comptes: (r.comptes ?? []).filter(x => x !== c) })} testID={`esport-ecriture-compte-${c}-retirer`} />
            </View>
          ))}
          {comptes.some(x => x.compte !== 'principal' && !(r.comptes ?? []).includes(x.compte)) ? (
            <Choix
              theme={theme}
              libelle={trEc('reglages_ajouter_personne')}
              valeur={undefined}
              options={comptes.filter(x => x.compte !== 'principal' && !(r.comptes ?? []).includes(x.compte)).map(x => ({ id: x.compte, nom: x.pseudo || x.compte }))}
              onChoisir={c => void regler({ comptes: [...(r.comptes ?? []), c] })}
              testID="esport-ecriture-ajouter-compte"
            />
          ) : null}
          <Text style={attenue(theme, 12)}>{trEc('reglages_fondateur')}</Text>
        </View>
      ) : null}
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="esport-ecriture-reglages-erreur" /> : null}
      {avis ? <Avis theme={theme} genre="ok" texte={avis} testID="esport-ecriture-reglages-avis" /> : null}
    </Carte>
  );
}
