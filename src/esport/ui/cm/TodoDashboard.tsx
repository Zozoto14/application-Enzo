/**
 * « To do » du Dashboard (migration 0074, docs/esport/cm.md, « To do ») : récap personnel des tableaux CM.
 *
 *  - Favoris en tête (étoile posée sur une carte, dans le tableau ou sa fiche), puis les cartes ASSIGNÉES au compte dans
 *    les tableaux qu'il a choisis (tous par défaut), groupées par tableau puis par colonne ;
 *  - jamais une carte terminée (colonne de fin), archivée, ni d'un tableau restreint dont le compte n'est pas (le serveur
 *    filtre : GET /cm/todo) ; tri des tableaux : urgence, puis échéance, puis ordre manuel ;
 *  - actions rapides : ouvrir la carte, « Terminer » (première colonne de fin du tableau, avec cm.editer), retirer des
 *    favoris ; réglage (tableaux, cartes assignées / favorites) mémorisé en base pour le compte ;
 *  - temps réel : relu quand une carte change (sujet `cm`) ou quand le compte touche une étoile ailleurs (`compte`).
 *
 * Rien n'est affiché pour qui n'a pas de tableau CM (403) ni face à un serveur ancien (404).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiCm, type CarteTodo, type ReglageTodo, type Todo } from '../../cm/api';
import { enRetard } from '../../cm/colonneFin';
import { trCm, trnCm } from '../../i18n/cm';
import { useTempsReel } from '../../tempsReel/hooks';
import { Retours, useAgir } from '../commun';
import { Carte, ESP, EtatVide, Squelette, TitreCarte, Volet, attenue, texte, type EtatPresse } from '../design';
import { FUSEAU_CLUB, nomListe, nomTableau, quand } from './commun';
import { PastilleUrgence, libelleUrgence } from './Drapeau';
import { EtoileFavori } from './Favori';

type TableauTodo = Todo['tableaux'][number];

/** Groupes du To do : par tableau (ordre des tableaux), puis par colonne (ordre des colonnes) ; l'ordre des cartes est gardé. */
export function grouperTodo(cartes: readonly CarteTodo[], tableaux: readonly Pick<TableauTodo, 'id'>[]): Array<{ tableauId: string; colonnes: Array<{ liste: CarteTodo['liste']; cartes: CarteTodo[] }> }> {
  const rang = new Map(tableaux.map((t, i) => [t.id, i]));
  const parTableau = new Map<string, Map<string, { liste: CarteTodo['liste']; cartes: CarteTodo[] }>>();
  for (const c of cartes) {
    if (!parTableau.has(c.tableauId)) parTableau.set(c.tableauId, new Map());
    const colonnes = parTableau.get(c.tableauId)!;
    const cle = c.liste.id ?? '';
    if (!colonnes.has(cle)) colonnes.set(cle, { liste: c.liste, cartes: [] });
    colonnes.get(cle)!.cartes.push(c);
  }
  return [...parTableau.entries()]
    .sort(([a], [b]) => (rang.get(a) ?? 1e9) - (rang.get(b) ?? 1e9))
    .map(([tableauId, colonnes]) => ({ tableauId, colonnes: [...colonnes.values()].sort((x, y) => x.liste.position - y.liste.position) }));
}

export function TodoDashboard({
  theme,
  client,
  large,
  onOuvrirCarte,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  /** Ouvre la carte (son tableau, puis sa fiche). `portee` : 'club' ou l'identifiant de la team du tableau. */
  onOuvrirCarte(c: { tableauId: string; carteId: string; portee: string }): void;
}) {
  const api = useMemo(() => apiCm(client), [client]);
  const [todo, setTodo] = useState<Todo | undefined>();
  // 403 (pas de tableau CM) ou serveur ancien : le bloc n'apparaît pas.
  const [absent, setAbsent] = useState(false);
  const [reglage, setReglage] = useState(false);
  const { erreur, avis, agir, enCours } = useAgir();
  const charger = useCallback(async () => {
    try {
      const t = await api.todo();
      if (!t || !Array.isArray(t.cartes)) throw new Error('todo');
      setTodo(t);
      setAbsent(false);
    } catch {
      setAbsent(true);
    }
  }, [api]);
  useEffect(() => {
    void charger();
  }, [charger]);
  useTempsReel(client, ['cm', 'compte'], () => void charger(), { actif: !absent });

  if (absent) return null;
  const tableaux = new Map((todo?.tableaux ?? []).map(t => [t.id, t]));
  const maintenant = Date.now();
  const total = (todo?.favoris.length ?? 0) + (todo?.cartes.length ?? 0);

  const terminer = (c: CarteTodo) =>
    void agir(`terminer-${c.id}`, async () => {
      // Tout de suite à l'écran : la carte quitte le To do (relu ensuite).
      setTodo(t => (t ? { ...t, favoris: t.favoris.filter(x => x.id !== c.id), cartes: t.cartes.filter(x => x.id !== c.id) } : t));
      try {
        await api.terminer(c.id);
      } finally {
        await charger();
      }
      return trCm('todo.terminee', { titre: c.titre });
    });
  const basculerFavori = (c: CarteTodo) =>
    void agir(`favori-${c.id}`, async () => {
      try {
        await api.favori(c.id, !c.favori);
      } finally {
        await charger();
      }
      return trCm(c.favori ? 'favori.annonce_retire' : 'favori.annonce_ajoute', { titre: c.titre });
    });

  const ligne = (c: CarteTodo, avecTableau: boolean) => {
    const tb = tableaux.get(c.tableauId);
    const retard = enRetard(c, maintenant);
    const ouvrir = () => onOuvrirCarte({ tableauId: c.tableauId, carteId: c.id, portee: tb?.portee ?? 'club' });
    const lieu = [avecTableau && tb ? nomTableau(tb) : '', avecTableau ? nomListe({ nom: c.liste.nom ?? null, cle: c.liste.cle ?? null }) : ''].filter(Boolean).join(' · ');
    return (
      <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 44, paddingHorizontal: ESP.xs, borderRadius: 10, backgroundColor: teinteTransparente(theme.attenue, 0.05) }} testID={`esport-todo-carte-${c.id}`}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[trCm('todo.ouvrir', { titre: c.titre }), c.urgence ? trCm('urgence.carte', { niveau: libelleUrgence(c.urgence) }) : '', c.echeance ? trCm('carte.echeance_le', { date: quand(c.echeance, FUSEAU_CLUB) }) : '', retard ? trCm('todo.en_retard') : '', lieu].filter(Boolean).join(', ')}
          onPress={ouvrir}
          testID={`esport-todo-carte-${c.id}-ouvrir`}
          style={(e: EtatPresse) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ESP.xs, paddingVertical: 6, borderRadius: 8, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.08) : 'transparent' })}>
          {c.urgence ? <PastilleUrgence theme={theme} niveau={c.urgence} sansLibelleAccessible testID={`esport-todo-carte-${c.id}-urgence`} /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '600' }} numberOfLines={2}>
              {c.titre}
            </Text>
            {c.echeance || lieu ? (
              <Text style={attenue(theme, 12)} numberOfLines={1}>
                {c.echeance ? <Text style={{ color: c.echeanceFaite ? theme.ok : retard ? theme.critique : theme.attenue, fontWeight: retard ? '700' : '400' }} testID={retard ? `esport-todo-carte-${c.id}-retard` : undefined}>{`⚑ ${quand(c.echeance, FUSEAU_CLUB)}`}</Text> : null}
                {c.echeance && lieu ? ' · ' : ''}
                {lieu}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {c.terminable ? <BoutonHub theme={theme} titre={trCm('todo.terminer')} libelle={trCm('todo.terminer_libelle', { titre: c.titre })} desactive={enCours === `terminer-${c.id}`} onPress={() => terminer(c)} testID={`esport-todo-carte-${c.id}-terminer`} /> : null}
        <EtoileFavori theme={theme} favori={c.favori} titre={c.titre} desactive={enCours === `favori-${c.id}`} onBasculer={() => basculerFavori(c)} testID={`esport-todo-carte-${c.id}-favori`} />
      </View>
    );
  };

  const groupes = todo ? grouperTodo(todo.cartes, todo.tableaux) : [];
  return (
    <Carte theme={theme} testID="esport-todo">
      <TitreCarte
        theme={theme}
        icone="taches"
        titre={trCm('todo.titre')}
        sous={todo ? trnCm('todo.cartes_n', total) : trCm('todo.sous')}
        droite={todo ? <BoutonHub theme={theme} titre={trCm('todo.reglages')} icone="reglages" onPress={() => setReglage(true)} testID="esport-todo-reglages" /> : undefined}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-todo" />
      {!todo ? <Squelette theme={theme} lignes={3} testID="esport-todo-chargement" /> : null}
      {todo && total === 0 ? <EtatVide theme={theme} glyphe="taches" titre={trCm('todo.vide')} texte={trCm('todo.vide_texte')} /> : null}
      {todo?.favoris.length ? (
        <View style={{ gap: ESP.xxs }} testID="esport-todo-favoris">
          <Text accessibilityRole="header" style={{ ...attenue(theme, 13), fontWeight: '700' }}>{trCm('todo.favoris')}</Text>
          {todo.favoris.map(c => ligne(c, true))}
        </View>
      ) : null}
      {groupes.length ? (
        <View style={{ gap: ESP.s }} testID="esport-todo-assignees">
          <Text accessibilityRole="header" style={{ ...attenue(theme, 13), fontWeight: '700' }}>{trCm('todo.assignees')}</Text>
          <View style={large ? { flexDirection: 'row', flexWrap: 'wrap', gap: ESP.m } : { gap: ESP.s }}>
            {groupes.map(g => {
              const tb = tableaux.get(g.tableauId);
              return (
                <View key={g.tableauId} style={{ gap: ESP.xxs, flexGrow: 1, flexBasis: large ? 320 : undefined, minWidth: 0 }} testID={`esport-todo-tableau-${g.tableauId}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tb?.couleur ?? theme.accent }} />
                    <Text style={{ ...texte(theme, 14), fontWeight: '700', flex: 1, minWidth: 0 }} numberOfLines={1}>
                      {tb ? `${nomTableau(tb)}${tb.team?.nom ? ` · ${tb.team.nom}` : ''}` : ''}
                    </Text>
                  </View>
                  {g.colonnes.map(col => (
                    <View key={col.liste.id ?? ''} style={{ gap: 4 }} testID={`esport-todo-colonne-${col.liste.id ?? ''}`}>
                      <Text style={attenue(theme, 12)}>{nomListe({ nom: col.liste.nom ?? null, cle: col.liste.cle ?? null })}</Text>
                      {col.cartes.map(c => ligne(c, false))}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      {reglage && todo ? (
        <ReglageTodoVolet
          theme={theme}
          todo={todo}
          onFermer={() => setReglage(false)}
          onEnregistrer={r =>
            void agir('reglage', async () => {
              await api.changerReglageTodo(r);
              setReglage(false);
              await charger();
              return trCm('c.enregistre');
            })
          }
        />
      ) : null}
    </Carte>
  );
}

/** Réglage du To do : tableaux (aucun coché : tous), cartes assignées, cartes favorites. */
function ReglageTodoVolet({ theme, todo, onFermer, onEnregistrer }: { theme: ThemeHub; todo: Todo; onFermer(): void; onEnregistrer(r: ReglageTodo): void }) {
  const [r, setR] = useState<ReglageTodo>(todo.reglage);
  const tous = r.tableaux.length === 0;
  const basculer = (id: string) => setR(x => ({ ...x, tableaux: x.tableaux.includes(id) ? x.tableaux.filter(y => y !== id) : [...x.tableaux, id] }));
  const ligne = (libelle: string, coche: boolean, onChanger: (v: boolean) => void, testID: string) => (
    <View key={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 40 }}>
      <Case theme={theme} coche={coche} libelle={libelle} onChanger={onChanger} testID={testID} />
      <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{libelle}</Text>
    </View>
  );
  return (
    <Volet theme={theme} visible titre={trCm('todo.reglages_titre')} onFermer={onFermer} testID="esport-todo-reglage">
      <Text style={{ ...texte(theme), fontWeight: '700' }}>{trCm('todo.afficher')}</Text>
      {ligne(trCm('todo.montrer_favoris'), r.favoris, v => setR(x => ({ ...x, favoris: v })), 'esport-todo-reglage-favoris')}
      {ligne(trCm('todo.montrer_assignees'), r.assignees, v => setR(x => ({ ...x, assignees: v })), 'esport-todo-reglage-assignees')}
      <Text style={{ ...texte(theme), fontWeight: '700' }}>{trCm('todo.tableaux')}</Text>
      <Text style={attenue(theme, 13)}>{trCm('todo.tableaux_aide')}</Text>
      {ligne(trCm('todo.tous_tableaux'), tous, v => v && setR(x => ({ ...x, tableaux: [] })), 'esport-todo-reglage-tous')}
      {todo.tableaux.map(t => ligne(`${nomTableau(t)}${t.team?.nom ? ` · ${t.team.nom}` : ''}`, r.tableaux.includes(t.id), () => basculer(t.id), `esport-todo-reglage-tableau-${t.id}`))}
      <BoutonHub theme={theme} titre={trCm('c.enregistrer')} variante="plein" onPress={() => onEnregistrer(r)} testID="esport-todo-reglage-ok" />
    </Volet>
  );
}
