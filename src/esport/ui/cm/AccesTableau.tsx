/**
 * « Accès au tableau » (menu ⋯ du tableau, migration 0046, docs/esport/cm.md) : tous ceux qui ont accès au CM
 * (défaut), ou RESTREINT aux personnes et aux rôles choisis (rôles CM, du club, de team), chacun « peut voir » ou
 * « peut modifier ». Le Fondateur voit toujours tout. Réservé à cm.gerer et au créateur du tableau ; le serveur
 * refuse un tableau sans personne pour le gérer, et de se retirer soi-même.
 *
 * Téléphone : chaque ligne passe sur deux rangées (nom, puis le choix du niveau) : rien ne déborde.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { AccesTableau as Acces, ApiCm, GenreAcces, NiveauAcces, ReglageAcces, RegleAcces } from '../../cm/api';
import { trCm } from '../../i18n/cm';
import { Retours, styles, useAgir } from '../commun';
import { Badge, ESP, attenue, texte } from '../design';
import { Aide } from './commun';

type Choix = NiveauAcces | 'sans';
const SANS = 'sans' as const;
const cle = (genre: GenreAcces, cible: string) => `${genre}|${cible}`;

export function AccesTableau({ theme, api, tableauId, onChange, testID = 'esport-cm-acces' }: { theme: ThemeHub; api: ApiCm; tableauId: string; onChange(): unknown; testID?: string }) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [reglage, setReglage] = useState<ReglageAcces | undefined>();
  const [acces, setAcces] = useState<Acces>('tous');
  const [niveaux, setNiveaux] = useState<Map<string, NiveauAcces>>(new Map());

  const appliquer = useCallback((r: ReglageAcces) => {
    setReglage(r);
    setAcces(r.acces);
    setNiveaux(new Map(r.regles.map(x => [cle(x.genre, x.cible), x.niveau])));
  }, []);
  useEffect(() => {
    void agir('', async () => appliquer(await api.accesTableau(tableauId)));
  }, [agir, api, appliquer, tableauId]);

  const lignes = useMemo(() => {
    if (!reglage) return [];
    const o = reglage.options;
    return [
      { genre: 'compte' as const, titre: trCm('acces.personnes'), items: o.personnes.filter(p => p.compte !== 'principal').map(p => ({ id: p.compte, nom: p.pseudo })) },
      { genre: 'role_cm' as const, titre: trCm('acces.roles_cm'), items: o.rolesCm.map(r => ({ id: r.id, nom: r.nom })) },
      { genre: 'role_club' as const, titre: trCm('acces.roles_club'), items: o.rolesClub.map(r => ({ id: r.id, nom: r.nom })) },
      { genre: 'role_team' as const, titre: trCm('acces.roles_team'), items: o.rolesTeam.map(r => ({ id: r.id, nom: r.team?.nom ? `${r.nom} · ${r.team.nom}` : r.nom })) },
    ].filter(g => g.items.length);
  }, [reglage]);

  if (!reglage) return <Retours theme={theme} erreur={erreur} prefixe={testID} />;
  const defaut = Boolean(reglage.tableau.cleDefaut);
  const choisir = (genre: GenreAcces, cible: string, v: Choix) =>
    setNiveaux(m => {
      const n = new Map(m);
      if (v === SANS) n.delete(cle(genre, cible));
      else n.set(cle(genre, cible), v);
      return n;
    });
  const enregistrer = () =>
    agir('acces', async () => {
      const regles: RegleAcces[] = [...niveaux].map(([k, niveau]) => {
        const [genre, ...reste] = k.split('|');
        return { genre: genre as GenreAcces, cible: reste.join('|'), niveau };
      });
      appliquer(await api.changerAccesTableau(tableauId, acces, regles));
      await onChange();
      return trCm('acces.enregistre');
    });
  const options: ReadonlyArray<readonly [Choix, string]> = [
    [SANS, trCm('acces.aucun')],
    ['voir', trCm('acces.niveau.voir')],
    ['modifier', trCm('acces.niveau.modifier')],
  ];

  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      <Aide theme={theme}>{trCm('acces.aide')}</Aide>
      <Segments<Acces>
        theme={theme}
        libelle={trCm('acces.titre')}
        valeur={acces}
        options={(defaut ? [['tous', trCm('acces.tous')]] : [['tous', trCm('acces.tous')], ['restreint', trCm('acces.restreint')]]) as ReadonlyArray<readonly [Acces, string]>}
        onChoisir={v => setAcces(v)}
        testID={`${testID}-mode`}
      />
      {defaut ? <Text style={attenue(theme, 13)}>{trCm('acces.defaut')}</Text> : null}
      {acces === 'restreint' ? (
        <>
          {lignes.map(g => (
            <View key={g.genre} style={{ gap: ESP.xs }} testID={`${testID}-${g.genre}`}>
              <Text style={{ ...texte(theme, 14), fontWeight: '800' }} accessibilityRole="header">
                {g.titre}
              </Text>
              {g.items.map(x => (
                <View key={x.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'wrap', justifyContent: 'space-between' }]}>
                  <Text style={{ ...texte(theme, 14), flexShrink: 1, minWidth: 120 }} numberOfLines={2}>
                    {x.nom}
                  </Text>
                  <Segments<Choix> theme={theme} libelle={trCm('acces.niveau_de', { nom: x.nom })} valeur={niveaux.get(cle(g.genre, x.id)) ?? SANS} options={options} onChoisir={v => choisir(g.genre, x.id, v)} testID={`${testID}-${g.genre}-${x.id}`} />
                </View>
              ))}
            </View>
          ))}
          <Text style={attenue(theme, 13)}>{trCm('acces.fondateur')}</Text>
        </>
      ) : null}
      {reglage.effectifs && reglage.acces === 'restreint' ? (
        <View style={{ gap: ESP.xs }} testID={`${testID}-effectifs`}>
          <Text style={{ ...texte(theme, 14), fontWeight: '800' }}>{trCm('acces.effectifs')}</Text>
          <View style={[styles.ligne, { gap: ESP.xs, flexWrap: 'wrap' }]}>
            {reglage.effectifs.map(p => (
              <Badge key={p.compte} theme={theme} icone={p.niveau === 'modifier' ? 'crayon' : 'oeil'} texte={`${p.pseudo} · ${p.niveau === 'modifier' ? trCm('acces.niveau.modifier') : trCm('acces.niveau.voir')}`} />
            ))}
          </View>
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={testID} />
      <BoutonHub theme={theme} titre={trCm('c.enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() => void enregistrer()} testID={`${testID}-enregistrer`} />
    </View>
  );
}
