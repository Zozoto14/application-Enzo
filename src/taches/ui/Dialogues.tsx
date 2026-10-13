/**
 * Fenêtres de Tâches : échéance (en français libre), récurrence, rappels,
 * filtres / tri / regroupement / vue enregistrée, réglages de l'app (ami,
 * partage projet par projet, exemple), réglages d'un projet (statuts,
 * listes, suppression), création d'un espace / projet / liste, rappels.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { ajouterJours, debutSemaine, JOURS_SEMAINE, jourLisible, lireDateLibre, lireHeure, MOIS } from '../dates';
import { LIBELLES_GROUPE, LIBELLES_TRI } from '../filtres';
import {
  changerStatuts,
  COULEURS,
  creerListe,
  etiquettesUtilisees,
  LIBELLES_PARTAGE,
  LIBELLES_PRIORITE,
  listesDe,
  modifierListe,
  modifierProjet,
  nouveauStatut,
  PRIORITES,
  projetsDe,
  RAPPELS_PROPOSES,
  statutsDe,
  supprimerListe,
  supprimerProjet,
  tachesVivantes,
  vivant,
  type Echeance,
  type Filtres,
  type FiltreEcheance,
  type Groupe,
  type ModePartage,
  type Recurrence,
  type Statut,
  type Tache,
  type Tri,
} from '../modele';
import { libelleDelai, type AlerteRappel } from '../rappels';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, Libelle, Options, Puce, texteDe } from './atomes';

type Fermer = () => void;

// ------------------------------------------------------------------ Échéance

export function DialogueEcheance({ a, t, onFermer }: { a: Actions; t: Tache; onFermer: Fermer }) {
  const theme = a.theme;
  const auj = a.etat.aujourdhui;
  const [texte, setTexte] = useState(t.echeance ? t.echeance.jour.split('-').reverse().join('/') : '');
  const [heure, setHeure] = useState(t.echeance?.heure ?? '');
  const lue = lireDateLibre(texte, auj);
  const heureLue = heure.trim() ? lireHeure(heure) : undefined;
  const heureErreur = heure.trim() !== '' && !heureLue;
  const enregistrer = (e: Echeance | undefined) => {
    a.changer(t.id, { echeance: e });
    onFermer();
  };
  const rapide: Array<[string, string]> = [
    ['Aujourd’hui', auj],
    ['Demain', ajouterJours(auj, 1)],
    ['Lundi prochain', ajouterJours(debutSemaine(auj), 7)],
    ['Dans 1 semaine', ajouterJours(auj, 7)],
  ];
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre="Échéance"
      description="Écrivez en français : « demain », « vendredi », « 15/11 », « dans 3 jours », « 2 décembre »."
      onFermer={onFermer}
      testID="dialogue-echeance"
      pied={
        <>
          <Bouton theme={theme} titre="Retirer" variante="discret" onPress={() => enregistrer(undefined)} testID="echeance-retirer" />
          <Bouton
            theme={theme}
            titre="Enregistrer"
            variante="plein"
            desactive={!lue || heureErreur}
            onPress={() => lue && enregistrer({ jour: lue.jour, ...(heureLue ?? lue.heure ? { heure: heureLue ?? lue.heure } : {}) })}
            testID="echeance-enregistrer"
          />
        </>
      }>
      <View style={styles.rangee}>
        {rapide.map(([l, j]) => (
          <Puce key={l} theme={theme} grand texte={l} couleur={theme.accent} actif={lue?.jour === j} onPress={() => setTexte(j.split('-').reverse().join('/'))} testID={`echeance-rapide-${j}`} />
        ))}
      </View>
      <Libelle theme={theme}>DATE</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={texte} onChangeText={setTexte} placeholder="ex. demain, 15/11" autoFocus={!a.mobile} testID="echeance-champ" accessibilityLabel="Date d’échéance" />
      <Text style={[attenueDe(theme), { color: texte && !lue ? theme.critique : theme.attenue }]} testID="echeance-lue">
        {lue ? `→ ${jourLisible(lue.jour, auj, true)}` : texte ? 'Date non reconnue' : 'Aucune date'}
      </Text>
      <Libelle theme={theme}>HEURE (FACULTATIVE)</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={heure} onChangeText={setHeure} placeholder="ex. 14h30" testID="echeance-heure" accessibilityLabel="Heure" />
      {heureErreur ? <Text style={[attenueDe(theme), { color: theme.critique }]}>Heure non reconnue (ex. 9h, 14:30).</Text> : null}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Récurrence

export function DialogueRecurrence({ a, t, onFermer }: { a: Actions; t: Tache; onFermer: Fermer }) {
  const theme = a.theme;
  const base = t.echeance?.jour ?? a.etat.aujourdhui;
  const [type, setType] = useState<Recurrence['type'] | 'aucune'>(t.recurrence?.type ?? 'aucune');
  const [intervalle, setIntervalle] = useState(String(t.recurrence?.type === 'quotidienne' ? t.recurrence.intervalle : 1));
  const [jours, setJours] = useState<number[]>(t.recurrence?.type === 'hebdo' ? t.recurrence.jours : [((new Date(`${base}T12:00:00`).getDay() + 6) % 7) + 1]);
  const [jourMois, setJourMois] = useState(String(t.recurrence?.type === 'mensuelle' ? t.recurrence.jour : Number(base.slice(8, 10))));
  const valeur = (): Recurrence | undefined => {
    switch (type) {
      case 'quotidienne':
        return { type, intervalle: Math.min(365, Math.max(1, Number(intervalle) || 1)) };
      case 'hebdo':
        return jours.length ? { type, jours: [...jours].sort() } : undefined;
      case 'mensuelle':
        return { type, jour: Math.min(31, Math.max(1, Number(jourMois) || 1)) };
      case 'annuelle':
        return { type, mois: Number(base.slice(5, 7)), jour: Number(base.slice(8, 10)) };
      default:
        return undefined;
    }
  };
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre="Récurrence"
      description="La prochaine occurrence est créée quand vous terminez la tâche."
      onFermer={onFermer}
      testID="dialogue-recurrence"
      pied={
        <Bouton
          theme={theme}
          titre="Enregistrer"
          variante="plein"
          onPress={() => {
            const r = valeur();
            a.changer(t.id, { recurrence: r, ...(r && !t.echeance ? { echeance: { jour: a.etat.aujourdhui } } : {}) });
            onFermer();
          }}
          testID="recurrence-enregistrer"
        />
      }>
      <Options
        theme={theme}
        valeur={type}
        onChoisir={v => setType(v as typeof type)}
        testID="recurrence-type"
        options={[
          { valeur: 'aucune', texte: 'Aucune' },
          { valeur: 'quotidienne', texte: 'Quotidienne' },
          { valeur: 'hebdo', texte: 'Hebdomadaire (jours choisis)' },
          { valeur: 'mensuelle', texte: 'Mensuelle (jour N)' },
          { valeur: 'annuelle', texte: `Annuelle (le ${Number(base.slice(8, 10))} ${MOIS[Number(base.slice(5, 7)) - 1]})` },
        ]}
      />
      {type === 'quotidienne' ? <Champ theme={theme} mobile={a.mobile} value={intervalle} onChangeText={setIntervalle} keyboardType="number-pad" accessibilityLabel="Tous les N jours" placeholder="Tous les N jours" testID="recurrence-intervalle" /> : null}
      {type === 'hebdo' ? (
        <View style={styles.rangee}>
          {JOURS_SEMAINE.map((j, i) => (
            <Puce key={j} theme={theme} grand texte={j.slice(0, 3)} couleur={theme.accent} actif={jours.includes(i + 1)} onPress={() => setJours(x => (x.includes(i + 1) ? x.filter(y => y !== i + 1) : [...x, i + 1]))} testID={`recurrence-jour-${i + 1}`} libelle={j} />
          ))}
        </View>
      ) : null}
      {type === 'mensuelle' ? <Champ theme={theme} mobile={a.mobile} value={jourMois} onChangeText={setJourMois} keyboardType="number-pad" accessibilityLabel="Jour du mois" placeholder="Jour du mois (1 à 31)" testID="recurrence-jour-mois" /> : null}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Rappels

export function DialogueRappels({ a, t, onFermer }: { a: Actions; t: Tache; onFermer: Fermer }) {
  const theme = a.theme;
  const [choix, setChoix] = useState<number[]>(t.rappels);
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre="Rappels"
      description={t.echeance ? 'Une notification (sur le PC) et une pastille dans le hub. Chaque rappel ne part qu’une fois.' : 'Donnez d’abord une échéance à la tâche : les rappels se calent sur elle.'}
      onFermer={onFermer}
      testID="dialogue-rappels"
      pied={
        <Bouton
          theme={theme}
          titre="Enregistrer"
          variante="plein"
          desactive={!t.echeance && choix.length > 0}
          onPress={() => {
            a.changer(t.id, { rappels: choix });
            onFermer();
          }}
          testID="rappels-enregistrer"
        />
      }>
      <Options
        theme={theme}
        multiple
        valeur={choix.map(String)}
        onChoisir={v => setChoix(c => (c.includes(Number(v)) ? c.filter(x => x !== Number(v)) : [...c, Number(v)].slice(-5)))}
        options={RAPPELS_PROPOSES.map(m => ({ valeur: String(m), texte: libelleDelai(m) }))}
        testID="rappel"
      />
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Choix simple (statut, priorité, personne, liste)

export function DialogueChoix<V extends string>({ a, titre, options, valeur, onChoisir, onFermer, testID }: { a: Actions; titre: string; options: ReadonlyArray<{ valeur: V; texte: string; couleur?: string; detail?: string }>; valeur?: V; onChoisir(v: V): void; onFermer: Fermer; testID: string }) {
  return (
    <Dialogue theme={a.theme} mobile={a.mobile} visible titre={titre} onFermer={onFermer} testID={testID}>
      <Options
        theme={a.theme}
        options={options}
        valeur={valeur}
        onChoisir={v => {
          onChoisir(v);
          onFermer();
        }}
        testID={`${testID}-option`}
      />
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Filtres

export function DialogueFiltres({
  a,
  filtres,
  tri,
  groupe,
  projetId,
  onChanger,
  onEnregistrerVue,
  onFermer,
}: {
  a: Actions;
  filtres: Filtres;
  tri: Tri;
  groupe: Groupe;
  projetId?: string;
  onChanger(f: Filtres, tri: Tri, groupe: Groupe): void;
  onEnregistrerVue(nom: string): void;
  onFermer: Fermer;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const [nomVue, setNomVue] = useState('');
  const statuts: Statut[] = projetId
    ? statutsDe(d, projetId)
    : [...new Map(projetsDe(d).flatMap(p => p.statuts).map(s => [s.id, s])).values()];
  const etiquettes = etiquettesUtilisees(tachesVivantes(d, projetId));
  const basculer = <T extends string>(liste: readonly T[], v: T): T[] => (liste.includes(v) ? liste.filter(x => x !== v) : [...liste, v]);
  const f = filtres;
  const changer = (c: Partial<Filtres>) => onChanger({ ...f, ...c }, tri, groupe);
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre="Filtres, tri et regroupement"
      onFermer={onFermer}
      testID="dialogue-filtres"
      pied={
        <>
          <Bouton theme={theme} titre="Tout effacer" variante="discret" onPress={() => onChanger({ recherche: '', statuts: [], priorites: [], etiquettes: [], assigne: 'tous', echeance: 'toutes', terminees: true }, tri, groupe)} testID="filtres-effacer" />
          <Bouton theme={theme} titre="Terminé" variante="plein" onPress={onFermer} testID="filtres-ok" />
        </>
      }>
      <Libelle theme={theme}>STATUT</Libelle>
      <View style={styles.rangee}>
        {statuts.map(s => (
          <Puce key={s.id} theme={theme} grand={a.mobile} texte={s.nom} couleur={s.couleur} actif={f.statuts.includes(s.id)} onPress={() => changer({ statuts: basculer(f.statuts, s.id) })} testID={`filtre-statut-${s.id}`} />
        ))}
      </View>
      <Libelle theme={theme}>PRIORITÉ</Libelle>
      <View style={styles.rangee}>
        {PRIORITES.map(p => (
          <Puce key={p} theme={theme} grand={a.mobile} texte={LIBELLES_PRIORITE[p]} couleur={theme.accent} actif={f.priorites.includes(p)} onPress={() => changer({ priorites: basculer(f.priorites, p) })} testID={`filtre-priorite-${p}`} />
        ))}
      </View>
      <Libelle theme={theme}>ÉCHÉANCE</Libelle>
      <View style={styles.rangee}>
        {(
          [
            ['toutes', 'Toutes'],
            ['retard', 'En retard'],
            ['aujourdhui', 'Aujourd’hui'],
            ['semaine', '7 jours'],
            ['sans', 'Sans date'],
          ] as Array<[FiltreEcheance, string]>
        ).map(([v, l]) => (
          <Puce key={v} theme={theme} grand={a.mobile} texte={l} couleur={theme.accent} actif={f.echeance === v} onPress={() => changer({ echeance: v })} testID={`filtre-echeance-${v}`} />
        ))}
      </View>
      <Libelle theme={theme}>POUR</Libelle>
      <View style={styles.rangee}>
        {(
          [
            ['tous', 'Tout le monde'],
            ['fondateur', a.etat.noms.fondateur],
            ['ami', a.etat.noms.ami],
            ['personne', 'Personne'],
          ] as Array<[Filtres['assigne'], string]>
        ).map(([v, l]) => (
          <Puce key={v} theme={theme} grand={a.mobile} texte={l} couleur={theme.accent} actif={f.assigne === v} onPress={() => changer({ assigne: v })} testID={`filtre-assigne-${v}`} />
        ))}
      </View>
      {etiquettes.length ? (
        <>
          <Libelle theme={theme}>ÉTIQUETTES</Libelle>
          <View style={styles.rangee}>
            {etiquettes.map(e => (
              <Puce key={e} theme={theme} grand={a.mobile} texte={`#${e}`} couleur={theme.teintes.anime} actif={f.etiquettes.includes(e)} onPress={() => changer({ etiquettes: basculer(f.etiquettes, e) })} testID={`filtre-etiquette-${e}`} />
            ))}
          </View>
        </>
      ) : null}
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte={f.terminees ? 'Terminées affichées' : 'Terminées masquées'} couleur={theme.ok} actif={!f.terminees} onPress={() => changer({ terminees: !f.terminees })} testID="filtre-terminees" />
      </View>
      <Libelle theme={theme}>TRIER PAR</Libelle>
      <View style={styles.rangee}>
        {(Object.keys(LIBELLES_TRI) as Tri[]).map(v => (
          <Puce key={v} theme={theme} grand={a.mobile} texte={LIBELLES_TRI[v]} couleur={theme.accent} actif={tri === v} onPress={() => onChanger(f, v, groupe)} testID={`tri-${v}`} />
        ))}
      </View>
      <Libelle theme={theme}>REGROUPER PAR (VUE LISTE)</Libelle>
      <View style={styles.rangee}>
        {(Object.keys(LIBELLES_GROUPE) as Groupe[]).map(v => (
          <Puce key={v} theme={theme} grand={a.mobile} texte={LIBELLES_GROUPE[v]} couleur={theme.accent} actif={groupe === v} onPress={() => onChanger(f, tri, v)} testID={`groupe-par-${v}`} />
        ))}
      </View>
      {a.etat.role === 'fondateur' ? (
        <>
          <Libelle theme={theme}>ENREGISTRER CETTE VUE</Libelle>
          <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
            <Champ theme={theme} mobile={a.mobile} value={nomVue} onChangeText={setNomVue} placeholder="Nom (ex. Urgent cette semaine)" style={{ flex: 1 }} testID="vue-nom" accessibilityLabel="Nom de la vue" />
            <Bouton
              theme={theme}
              titre="Enregistrer"
              desactive={!nomVue.trim()}
              onPress={() => {
                onEnregistrerVue(nomVue);
                setNomVue('');
                onFermer();
              }}
              testID="vue-enregistrer"
            />
          </View>
        </>
      ) : null}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Réglages de l'app

export function DialogueReglages({ a, amis, onFermer, onDemo, onRetirerDemo, onErreur }: { a: Actions; amis: ReadonlyArray<{ id: string; nom: string }>; onFermer: Fermer; onDemo(): void; onRetirerDemo(): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const profils = amis;
  const [enCours, setEnCours] = useState(false);
  if (a.etat.role === 'ami') {
    const projets = projetsDe(d);
    return (
      <Dialogue theme={theme} mobile={a.mobile} visible titre="Projets partagés avec vous" onFermer={onFermer} testID="dialogue-reglages">
        <Text style={texteDe(theme)}>
          {a.etat.parFondateur.charAt(0).toUpperCase() + a.etat.parFondateur.slice(1)} partage {projets.length} projet{projets.length > 1 ? 's' : ''} avec vous. Tout reste chiffré de bout en bout : le relais ne voit que des données illisibles.
        </Text>
        {projets.map(p => (
          <View key={p.id} style={styles.ligneProjet}>
            <View style={[styles.point, { backgroundColor: p.couleur }]} />
            <Text style={[texteDe(theme), { flex: 1 }]}>{p.nom}</Text>
            <Puce theme={theme} texte={LIBELLES_PARTAGE[p.partage]} couleur={p.partage === 'ecriture' ? theme.ok : theme.alerte} />
          </View>
        ))}
      </Dialogue>
    );
  }
  const ami = d.reglages.ami;
  const choisir = (id: string | undefined, nom?: string) => {
    setEnCours(true);
    a.etat
      .choisirAmi(id, nom)
      .catch(onErreur)
      .finally(() => setEnCours(false));
  };
  return (
    <Dialogue theme={theme} mobile={a.mobile} visible large titre="Réglages de Tâches" onFermer={onFermer} testID="dialogue-reglages">
      <Libelle theme={theme}>PARTAGE AVEC UN AMI (UN SEUL POUR L’INSTANT)</Libelle>
      <Text style={attenueDe(theme)}>
        L’ami choisi voit seulement les projets que vous lui partagez, en lecture ou en écriture. Il ne peut pas supprimer de projet. Tout est chiffré de bout en bout.
      </Text>
      {profils.length === 0 ? (
        <Text style={texteDe(theme)}>Aucun compte d’ami pour l’instant : créez-en un dans l’Administration.</Text>
      ) : (
        <Options
          theme={theme}
          valeur={ami ?? 'personne'}
          onChoisir={v => !enCours && (v === 'personne' ? choisir(undefined) : choisir(v, profils.find(p => p.id === v)?.nom))}
          options={[{ valeur: 'personne', texte: 'Personne (rien n’est partagé)' }, ...profils.map(p => ({ valeur: p.id, texte: p.nom }))]}
          testID="reglages-ami"
        />
      )}
      {ami ? (
        <>
          <Libelle theme={theme}>{`PROJETS PARTAGÉS AVEC ${(d.reglages.amiNom ?? 'l’ami').toUpperCase()}`}</Libelle>
          {projetsDe(d).length === 0 ? <Text style={attenueDe(theme)}>Aucun projet.</Text> : null}
          {projetsDe(d).map(p => (
            <View key={p.id} style={[styles.ligneProjet, { flexWrap: 'wrap' }]}>
              <View style={[styles.point, { backgroundColor: p.couleur }]} />
              <Text style={[texteDe(theme), { flex: 1, minWidth: 120 }]}>{p.nom}</Text>
              <View style={styles.rangee}>
                {(['aucun', 'lecture', 'ecriture'] as ModePartage[]).map(m => (
                  <Puce key={m} theme={theme} grand={a.mobile} texte={m === 'aucun' ? 'Non' : m === 'lecture' ? 'Lecture' : 'Écriture'} couleur={m === 'ecriture' ? theme.ok : m === 'lecture' ? theme.alerte : theme.attenue} actif={p.partage === m} onPress={() => a.etat.maj((x, ctx) => modifierProjet(x, p.id, { partage: m }, ctx))} testID={`partage-${p.id}-${m}`} />
                ))}
              </View>
            </View>
          ))}
        </>
      ) : null}
      <Libelle theme={theme}>DONNÉES D’EXEMPLE</Libelle>
      <Text style={attenueDe(theme)}>Un espace « Exemple » avec un projet et quelques tâches, pour découvrir les vues. Retirez-le d’un geste.</Text>
      <View style={styles.rangee}>
        {d.reglages.demo && vivant(d.espaces[d.reglages.demo]) ? (
          <Bouton theme={theme} variante="danger" titre="Retirer l’exemple" onPress={onRetirerDemo} testID="reglages-retirer-demo" />
        ) : (
          <Bouton theme={theme} titre="Ajouter l’exemple" onPress={onDemo} testID="reglages-demo" />
        )}
      </View>
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Réglages d'un projet

export function DialogueProjet({ a, projetId, onFermer, onSupprime, onErreur }: { a: Actions; projetId: string; onFermer: Fermer; onSupprime(): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const p = d.projets[projetId];
  const [nom, setNom] = useState(p?.nom ?? '');
  const [statuts, setStatuts] = useState<Statut[]>(() => statutsDe(d, projetId).map(s => ({ ...s })));
  const [nouveau, setNouveau] = useState('');
  const [nouvelleListe, setNouvelleListe] = useState('');
  const [confirmer, setConfirmer] = useState(false);
  if (!vivant(p)) return null;
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  const deplacer = (i: number, pas: number) =>
    setStatuts(s => {
      const r = [...s];
      const j = i + pas;
      if (j < 0 || j >= r.length) return s;
      [r[i], r[j]] = [r[j], r[i]];
      return r;
    });
  const nbTaches = tachesVivantes(d, projetId).length;
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre={`Projet « ${p.nom} »`}
      onFermer={onFermer}
      testID="dialogue-projet"
      pied={
        <Bouton
          theme={theme}
          titre="Enregistrer"
          variante="plein"
          onPress={() =>
            essayer(() => {
              a.etat.maj((x, ctx) => changerStatuts(modifierProjet(x, projetId, { nom }, ctx), projetId, statuts, ctx));
              onFermer();
            })
          }
          testID="projet-enregistrer"
        />
      }>
      <Libelle theme={theme}>NOM</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={nom} onChangeText={setNom} testID="projet-nom" accessibilityLabel="Nom du projet" />
      <Libelle theme={theme}>COULEUR</Libelle>
      <View style={styles.rangee}>
        {COULEURS.map(c => (
          <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: p.couleur === c }} accessibilityLabel={`Couleur ${c}`} onPress={() => a.etat.maj((x, ctx) => modifierProjet(x, projetId, { couleur: c }, ctx))} style={[styles.pastilleCouleur, { backgroundColor: c, borderColor: p.couleur === c ? theme.texte : 'transparent' }]} />
        ))}
      </View>
      <Libelle theme={theme}>STATUTS</Libelle>
      <Text style={attenueDe(theme)}>Renommez, réordonnez, marquez le statut « terminé ». Les tâches d’un statut retiré passent au premier.</Text>
      {statuts.map((s, i) => (
        <View key={s.id} style={[styles.ligneProjet, { flexWrap: 'wrap' }]} testID={`statut-ligne-${s.id}`}>
          <Pressable accessibilityRole="button" accessibilityLabel="Changer la couleur" onPress={() => setStatuts(x => x.map(y => (y.id === s.id ? { ...y, couleur: COULEURS[(COULEURS.indexOf(y.couleur as (typeof COULEURS)[number]) + 1) % COULEURS.length] } : y)))} style={[styles.pastilleCouleur, { backgroundColor: s.couleur }]} />
          <Champ theme={theme} mobile={a.mobile} value={s.nom} onChangeText={v => setStatuts(x => x.map(y => (y.id === s.id ? { ...y, nom: v } : y)))} style={{ flex: 1, minWidth: 140 }} accessibilityLabel={`Nom du statut ${i + 1}`} testID={`statut-nom-${s.id}`} />
          <Puce theme={theme} grand={a.mobile} texte={s.ferme ? 'Terminé ✓' : 'Ouvert'} couleur={s.ferme ? theme.ok : theme.attenue} actif={s.ferme} onPress={() => setStatuts(x => x.map(y => (y.id === s.id ? { ...y, ferme: !y.ferme } : y)))} testID={`statut-ferme-${s.id}`} />
          <Bouton theme={theme} compact titre="↑" libelle="Monter" desactive={i === 0} onPress={() => deplacer(i, -1)} />
          <Bouton theme={theme} compact titre="↓" libelle="Descendre" desactive={i === statuts.length - 1} onPress={() => deplacer(i, 1)} />
          <Bouton theme={theme} compact variante="discret" titre="✕" libelle={`Retirer le statut ${s.nom}`} desactive={statuts.length <= 2} onPress={() => setStatuts(x => x.filter(y => y.id !== s.id))} testID={`statut-retirer-${s.id}`} />
        </View>
      ))}
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Champ theme={theme} mobile={a.mobile} value={nouveau} onChangeText={setNouveau} placeholder="Nouveau statut" style={{ flex: 1 }} testID="statut-nouveau" accessibilityLabel="Nouveau statut" />
        <Bouton
          theme={theme}
          titre="Ajouter"
          desactive={!nouveau.trim() || statuts.length >= 12}
          onPress={() => {
            setStatuts(x => {
              const s = nouveauStatut(nouveau, x);
              const iFerme = x.findIndex(y => y.ferme);
              return iFerme < 0 ? [...x, s] : [...x.slice(0, iFerme), s, ...x.slice(iFerme)];
            });
            setNouveau('');
          }}
          testID="statut-ajouter"
        />
      </View>
      <Libelle theme={theme}>LISTES</Libelle>
      {listesDe(d, projetId).map(l => (
        <View key={l.id} style={styles.ligneProjet}>
          <Champ theme={theme} mobile={a.mobile} defaultValue={l.nom} onEndEditing={e => essayer(() => a.etat.maj((x, ctx) => modifierListe(x, l.id, { nom: e.nativeEvent.text }, ctx)))} style={{ flex: 1 }} accessibilityLabel={`Nom de la liste ${l.nom}`} />
          <Bouton theme={theme} compact variante="discret" titre="✕" libelle={`Supprimer la liste ${l.nom}`} desactive={listesDe(d, projetId).length <= 1} onPress={() => essayer(() => a.etat.maj((x, ctx) => supprimerListe(x, l.id, ctx)))} />
        </View>
      ))}
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Champ theme={theme} mobile={a.mobile} value={nouvelleListe} onChangeText={setNouvelleListe} placeholder="Nouvelle liste" style={{ flex: 1 }} testID="liste-nouvelle" accessibilityLabel="Nouvelle liste" />
        <Bouton
          theme={theme}
          titre="Ajouter"
          desactive={!nouvelleListe.trim()}
          onPress={() =>
            essayer(() => {
              a.etat.maj((x, ctx) => creerListe(x, projetId, nouvelleListe, ctx).donnees);
              setNouvelleListe('');
            })
          }
          testID="liste-ajouter"
        />
      </View>
      <Libelle theme={theme}>PARTAGE</Libelle>
      {a.etat.donnees.reglages.ami ? (
        <View style={styles.rangee}>
          {(['aucun', 'lecture', 'ecriture'] as ModePartage[]).map(m => (
            <Puce key={m} theme={theme} grand={a.mobile} texte={LIBELLES_PARTAGE[m]} couleur={m === 'ecriture' ? theme.ok : m === 'lecture' ? theme.alerte : theme.attenue} actif={p.partage === m} onPress={() => a.etat.maj((x, ctx) => modifierProjet(x, projetId, { partage: m }, ctx))} testID={`projet-partage-${m}`} />
          ))}
        </View>
      ) : (
        <Text style={attenueDe(theme)}>Choisissez d’abord un ami dans les réglages de Tâches (⚙︎).</Text>
      )}
      <View style={[styles.zoneDanger, { borderColor: teinteTransparente(theme.critique, 0.5), borderRadius: 10 }]}>
        {confirmer ? (
          <>
            <Text style={texteDe(theme)}>Supprimer le projet et ses {nbTaches} tâche(s) ? {p.partage !== 'aucun' ? 'Il disparaîtra aussi chez votre ami.' : ''}</Text>
            <View style={styles.rangee}>
              <Bouton
                theme={theme}
                variante="danger"
                titre="Supprimer définitivement"
                onPress={() =>
                  essayer(() => {
                    a.etat.maj((x, ctx) => supprimerProjet(x, projetId, ctx));
                    onSupprime();
                  })
                }
                testID="projet-supprimer-confirmer"
              />
              <Bouton theme={theme} titre="Annuler" onPress={() => setConfirmer(false)} />
            </View>
          </>
        ) : (
          <Bouton theme={theme} variante="danger" titre="Supprimer le projet" onPress={() => setConfirmer(true)} testID="projet-supprimer" style={{ alignSelf: 'flex-start' }} />
        )}
      </View>
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Création (espace, projet)

export function DialogueNom({ a, titre, description, placeholder, onValider, onFermer, testID }: { a: Actions; titre: string; description?: string; placeholder: string; onValider(nom: string): void; onFermer: Fermer; testID: string }) {
  const [nom, setNom] = useState('');
  const valider = () => {
    if (!nom.trim()) return;
    onValider(nom);
    onFermer();
  };
  return (
    <Dialogue theme={a.theme} mobile={a.mobile} visible titre={titre} description={description} onFermer={onFermer} testID={testID} pied={<Bouton theme={a.theme} titre="Créer" variante="plein" desactive={!nom.trim()} onPress={valider} testID={`${testID}-creer`} />}>
      <Champ theme={a.theme} mobile={a.mobile} value={nom} onChangeText={setNom} onSubmitEditing={valider} placeholder={placeholder} autoFocus={!a.mobile} testID={`${testID}-nom`} accessibilityLabel={placeholder} />
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Rappels non lus

export function DialogueRappelsRecus({ a, rappels, onOuvrir, onToutLu, onFermer }: { a: Actions; rappels: readonly AlerteRappel[]; onOuvrir(id: string): void; onToutLu(): void; onFermer: Fermer }) {
  const theme = a.theme;
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre="Rappels"
      onFermer={onFermer}
      testID="dialogue-rappels-recus"
      pied={rappels.length ? <Bouton theme={theme} titre="Tout marquer comme lu" variante="plein" onPress={onToutLu} testID="rappels-tout-lu" /> : undefined}>
      {rappels.length === 0 ? <Text style={attenueDe(theme)}>Aucun rappel en attente.</Text> : null}
      {[...rappels].reverse().map(r => (
        <Pressable key={r.cle} accessibilityRole="button" onPress={() => onOuvrir(r.tacheId)} style={[styles.ligneProjet, { borderColor: theme.ligne, borderWidth: 1, borderRadius: 10, padding: 10 }]} testID={`rappel-recu-${r.tacheId}`}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[texteDe(theme), { fontWeight: '700' }]}>{r.titre}</Text>
            <Text style={attenueDe(theme)}>
              {r.texte} · {new Date(r.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </Pressable>
      ))}
    </Dialogue>
  );
}


const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  ligneProjet: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  point: { width: 12, height: 12, borderRadius: 6 },
  pastilleCouleur: { width: 30, height: 30, borderRadius: 15, borderWidth: 3 },
  zoneDanger: { borderWidth: 1, padding: 12, gap: 8, marginTop: 8 },
});
