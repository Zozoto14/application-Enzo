/**
 * App « Prospects » : carnet de prospection personnel du Fondateur.
 *
 * Bureau : filtres en segments, cartes avec leurs actions, formulaires en
 * place. Téléphone : cartes en cellules, filtres et formulaires en feuilles
 * basses, « Nouveau prospect » en bouton principal collé en bas.
 *
 * Données : `admin.donnees` (base chiffrée du compte historique), relues à
 * chaque écriture pour ne pas écraser une réception de la synchronisation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RetourHub, BoutonHub } from '../hub/Hub';
import { Avis, Champ, Panneau, Pilule, commun, styleTitre } from '../hub/admin/ui/commun';
import { chargerDonnees, enregistrerDonnees } from '../hub/admin/donnees';
import { police, teinteTransparente, type ThemeHub } from '../hub/themes';
import type { PropsRacineApp } from '../hub/types';
import { DepotFichier } from '../ui/DepotFichier';
import { BoutonPrincipal, Cellule, ChampMobile, EcranMobile, FeuilleBasse, GroupeCellules, useMobile, type NatureChamp } from '../ui/mobile';
import { CONTROLE, TEXTE } from '../ui/mobile/jetons';
import { accesProspects } from './acces';
import {
  LIBELLES_STATUT_PROSPECT,
  LIBELLES_TRI,
  RAPPEL_RGPD,
  STATUTS,
  ErreurProspect,
  ajouterEnLot,
  blocageEcrire,
  compter,
  enregistrerModele,
  enregistrerProspect,
  etiquettesUtilisees,
  exporterCsv,
  filtrerProspects,
  importerCsv,
  jourDe,
  jourFr,
  lienMailto,
  lireJour,
  modifierProspect,
  noterContact,
  nouvelId,
  rendreModele,
  saisieDe,
  saisieVide,
  supprimerModele,
  supprimerProspect,
  texteRelance,
  trierProspects,
  type DonneesProspects,
  type ModeleMessage,
  type Prospect,
  type SaisieProspect,
  type StatutProspect,
  type TriProspects,
} from './prospects';

type Ouvert =
  | { g: 'nouveau' }
  | { g: 'lot' }
  | { g: 'import' }
  | { g: 'modeles' }
  | { g: 'filtres' }
  | { g: 'fiche'; id: string }
  | { g: 'modifier'; id: string }
  | { g: 'contact'; id: string }
  | { g: 'ecrire'; id: string }
  | { g: 'supprimer'; id: string };

type Vue = 'tous' | 'relancer';

const TRIS: readonly TriProspects[] = ['relance', 'nom', 'entreprise', 'statut', 'recent'];

/** Copie dans le presse-papiers (web ou Electron) ; faux si indisponible. */
async function copier(texte: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function couleurStatut(statut: StatutProspect, theme: ThemeHub): string {
  switch (statut) {
    case 'gagne':
      return theme.ok;
    case 'perdu':
      return theme.critique;
    case 'repond':
    case 'rendez-vous':
      return theme.accent;
    case 'relance':
    case 'contacte':
      return theme.alerte;
    default:
      return theme.attenue;
  }
}

// ------------------------------------------------------------------- Racine

export function Prospects(props: PropsRacineApp) {
  if (!accesProspects(props.contexte)) {
    // Garde : la tuile n'est pas proposée, mais un écran ouvert autrement ne montre rien.
    return (
      <View style={[styles.racine, { backgroundColor: props.theme.fond }]} testID="app-prospects">
        <View style={styles.enteteMobile}>
          <RetourHub theme={props.theme} onRetour={props.onRetour} titre="Prospects" />
        </View>
        <View style={{ padding: 24 }}>
          <Avis theme={props.theme} genre="critique" texte="Réservé au Fondateur." testID="prospects-refuse" />
        </View>
      </View>
    );
  }
  return <CarnetProspects {...props} />;
}

// ------------------------------------------------------------------- État partagé

function useCarnet({ contexte }: PropsRacineApp) {
  const stockage = contexte.admin!.stockage;
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const [donnees, setDonnees] = useState<DonneesProspects>(() => chargerDonnees(stockage).prospects);
  // Données reçues d'un autre appareil (synchronisation) : relues.
  const version = contexte.profils?.versionComptes ?? 0;
  useEffect(() => {
    if (version > 0) setDonnees(chargerDonnees(stockage).prospects);
  }, [stockage, version]);
  const maj = useCallback(
    (changer: (d: DonneesProspects) => DonneesProspects): DonneesProspects => {
      // Toujours à partir de ce qui est enregistré : une réception entre-temps n'est pas écrasée.
      const admin = chargerDonnees(stockage);
      const suivantes = changer(admin.prospects);
      if (!enregistrerDonnees(stockage, { ...admin, prospects: suivantes })) {
        throw new ErreurProspect('Enregistrement impossible : réessayez.');
      }
      setDonnees(suivantes);
      return suivantes;
    },
    [stockage],
  );
  return { donnees, maj, maintenant };
}

function CarnetProspects(props: PropsRacineApp) {
  const { contexte, theme, onRetour } = props;
  const mobile = useMobile();
  const { donnees, maj, maintenant } = useCarnet(props);
  const aujourdhui = jourDe(maintenant());
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<Vue>('tous');
  const [statut, setStatut] = useState<StatutProspect | 'tous'>('tous');
  const [etiquette, setEtiquette] = useState('');
  const [tri, setTri] = useState<TriProspects>('relance');
  const [ouvert, setOuvert] = useState<Ouvert | undefined>();
  const [avis, setAvis] = useState<{ texte: string; genre: 'ok' | 'alerte' | 'critique' | 'info' } | undefined>();

  const tous = useMemo(() => Object.values(donnees.prospects), [donnees]);
  const compteurs = compter(tous, aujourdhui);
  const etiquettes = etiquettesUtilisees(tous);
  const liste = trierProspects(
    filtrerProspects(tous, { recherche, statut: statut === 'tous' ? undefined : statut, etiquette: etiquette || undefined, aRelancer: vue === 'relancer' }, aujourdhui),
    tri,
  );

  const agir = (action: () => string | undefined, fermer = true) => {
    try {
      const texte = action();
      if (texte) setAvis({ texte, genre: 'ok' });
      if (fermer) setOuvert(undefined);
    } catch (e) {
      setAvis({ texte: message(e), genre: 'critique' });
    }
  };

  const actions: Actions = {
    enregistrer: (saisie, id) =>
      agir(() => {
        let nom = '';
        maj(d => {
          const r = enregistrerProspect(d, saisie, maintenant(), id);
          nom = r.prospect.nom || r.prospect.email;
          return r.donnees;
        });
        return id ? `Fiche de ${nom} mise à jour.` : `${nom} ajouté·e au carnet.`;
      }),
    lot: (texte, source, etiquettesLot) => {
      let bilan: ReturnType<typeof ajouterEnLot> | undefined;
      agir(() => {
        maj(d => {
          bilan = ajouterEnLot(d, texte, { source, etiquettes: etiquettesLot }, maintenant());
          return bilan.donnees;
        });
        const b = bilan!;
        return `${b.ajoutes} adresse${b.ajoutes > 1 ? 's' : ''} ajoutée${b.ajoutes > 1 ? 's' : ''} · ${b.analyse.doublons.length} doublon${b.analyse.doublons.length > 1 ? 's' : ''} ignoré${b.analyse.doublons.length > 1 ? 's' : ''} · ${b.analyse.invalides.length} invalide${b.analyse.invalides.length > 1 ? 's' : ''}${b.analyse.invalides.length ? ` (${b.analyse.invalides.slice(0, 5).join(', ')}${b.analyse.invalides.length > 5 ? '…' : ''})` : ''}.`;
      });
    },
    importer: contenu =>
      agir(() => {
        let r: ReturnType<typeof importerCsv> | undefined;
        maj(d => {
          r = importerCsv(d, contenu, maintenant());
          return r.donnees;
        });
        const b = r!.bilan;
        return `Import : ${b.ajoutes} ajouté${b.ajoutes > 1 ? 's' : ''}, ${b.doublons} doublon${b.doublons > 1 ? 's' : ''} ignoré${b.doublons > 1 ? 's' : ''}, ${b.invalides} ligne${b.invalides > 1 ? 's' : ''} invalide${b.invalides > 1 ? 's' : ''}.${b.details.length ? ` ${b.details.slice(0, 3).join(' ; ')}` : ''}`;
      }),
    exporter: () => {
      const enregistrer = contexte.enregistrerFichier ?? contexte.admin?.enregistrerFichier;
      if (!enregistrer) {
        setAvis({ texte: 'Export indisponible sur cette plateforme.', genre: 'alerte' });
        return;
      }
      const nom = `prospects-${aujourdhui}.csv`;
      enregistrer(nom, exporterCsv(trierProspects(tous, 'nom')), 'text/csv;charset=utf-8').then(
        fait => setAvis(fait ? { texte: `Carnet exporté : ${nom}`, genre: 'ok' } : { texte: 'Export annulé.', genre: 'info' }),
        e => setAvis({ texte: message(e), genre: 'critique' }),
      );
    },
    supprimer: id =>
      agir(() => {
        const p = donnees.prospects[id];
        maj(d => supprimerProspect(d, id));
        return `Fiche de ${p?.nom || p?.email || 'ce prospect'} supprimée.`;
      }),
    contact: (id, contact) =>
      agir(() => {
        const t = maintenant();
        maj(d => modifierProspect(d, id, p => noterContact(p, contact, nouvelId(t)), t));
        return 'Contact noté dans l’historique.';
      }),
    changer: (id, changer, texte) =>
      agir(() => {
        maj(d => modifierProspect(d, id, changer, maintenant()));
        return texte;
      }, false),
    copierAdresse: p => {
      void copier(p.email).then(ok => setAvis(ok ? { texte: `Adresse copiée : ${p.email}`, genre: 'ok' } : { texte: `Copie automatique indisponible : ${p.email}`, genre: 'info' }));
    },
    copierTexte: (texte, quoi) => {
      void copier(texte).then(ok => setAvis(ok ? { texte: `${quoi} copié.`, genre: 'ok' } : { texte: 'Copie automatique indisponible : sélectionnez le texte.', genre: 'info' }));
    },
    ecrire: (p, modele) => {
      const lien = lienMailto(p, modele);
      if (!lien) {
        setAvis({ texte: blocageEcrire(p) ?? 'Écriture impossible.', genre: 'alerte' });
        return;
      }
      Linking.openURL(lien).catch(() => setAvis({ texte: 'Aucune messagerie n’a pu s’ouvrir : copiez le message.', genre: 'alerte' }));
    },
    modele: m =>
      agir(() => {
        maj(d => enregistrerModele(d, m));
        return `Modèle « ${m.nom.trim()} » enregistré.`;
      }, false),
    supprimerModele: id =>
      agir(() => {
        maj(d => supprimerModele(d, id));
        return 'Modèle supprimé.';
      }, false),
  };

  const commun_: PropsVue = {
    theme,
    donnees,
    liste,
    compteurs,
    etiquettes,
    aujourdhui,
    recherche,
    setRecherche,
    vue,
    setVue,
    statut,
    setStatut,
    etiquette,
    setEtiquette,
    tri,
    setTri,
    ouvert,
    setOuvert: o => {
      setAvis(undefined);
      setOuvert(o);
    },
    avis,
    actions,
    onRetour,
  };
  return mobile ? <VueMobile {...commun_} /> : <VueBureau {...commun_} />;
}

interface Actions {
  enregistrer(saisie: SaisieProspect, id?: string): void;
  lot(texte: string, source: string, etiquettes: string): void;
  importer(contenu: string): void;
  exporter(): void;
  supprimer(id: string): void;
  contact(id: string, contact: { date: string; note: string; relanceDans?: number }): void;
  changer(id: string, changer: (p: Prospect) => Prospect, texte: string): void;
  copierAdresse(p: Prospect): void;
  copierTexte(texte: string, quoi: string): void;
  ecrire(p: Prospect, modele?: ModeleMessage): void;
  modele(m: { id?: string; nom: string; sujet: string; corps: string }): void;
  supprimerModele(id: string): void;
}

interface PropsVue {
  theme: ThemeHub;
  donnees: DonneesProspects;
  liste: Prospect[];
  compteurs: ReturnType<typeof compter>;
  etiquettes: string[];
  aujourdhui: string;
  recherche: string;
  setRecherche(v: string): void;
  vue: Vue;
  setVue(v: Vue): void;
  statut: StatutProspect | 'tous';
  setStatut(v: StatutProspect | 'tous'): void;
  etiquette: string;
  setEtiquette(v: string): void;
  tri: TriProspects;
  setTri(v: TriProspects): void;
  ouvert?: Ouvert;
  setOuvert(o: Ouvert | undefined): void;
  avis?: { texte: string; genre: 'ok' | 'alerte' | 'critique' | 'info' };
  actions: Actions;
  onRetour(): void;
}

// ------------------------------------------------------------------- Briques

function ChampP({
  theme,
  mobile,
  libelle,
  valeur,
  onChanger,
  testID,
  nature = 'texte',
  placeholder,
  multiligne,
}: {
  theme: ThemeHub;
  mobile: boolean;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID: string;
  nature?: NatureChamp;
  placeholder?: string;
  multiligne?: boolean;
}) {
  if (mobile) {
    return (
      <ChampMobile
        theme={theme}
        etiquette={libelle}
        value={valeur}
        onChangeText={onChanger}
        nature={multiligne ? 'multiligne' : nature}
        placeholder={placeholder}
        testID={testID}
        style={multiligne ? { minHeight: 110 } : undefined}
      />
    );
  }
  return <Champ theme={theme} libelle={libelle} valeur={valeur} onChanger={onChanger} testID={testID} placeholder={placeholder} multiligne={multiligne} />;
}

function Bouton({
  theme,
  mobile,
  titre,
  onPress,
  testID,
  variante = 'normal',
  desactive,
}: {
  theme: ThemeHub;
  mobile: boolean;
  titre: string;
  onPress(): void;
  testID: string;
  variante?: 'normal' | 'plein' | 'danger';
  desactive?: boolean;
}) {
  if (mobile) {
    return <BoutonPrincipal theme={theme} titre={titre} onPress={onPress} testID={testID} desactive={desactive} variante={variante === 'normal' ? 'discret' : variante} />;
  }
  return <BoutonHub theme={theme} titre={titre} onPress={onPress} testID={testID} variante={variante} desactive={desactive} couleur={variante === 'plein' ? theme.teintes.quatre : undefined} />;
}

/** Choix unique en puces (44 px sur téléphone), qui passent à la ligne. */
function Puces<T extends string>({
  theme,
  mobile,
  libelle,
  valeur,
  options,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  mobile: boolean;
  libelle: string;
  valeur: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChoisir(v: T): void;
  testID: string;
}) {
  return (
    <View style={styles.puces} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {options.map(([cle, texte]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle}
            testID={`${testID}-${cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            aria-checked={actif}
            accessibilityLabel={`${libelle} : ${texte}`}
            onPress={() => onChoisir(cle)}
            style={[
              styles.puce,
              {
                minHeight: mobile ? CONTROLE.cible : 34,
                borderColor: actif ? theme.teintes.quatre : theme.ligne,
                backgroundColor: actif ? teinteTransparente(theme.teintes.quatre, 0.18) : 'transparent',
                borderRadius: theme.rayonGrand ? 999 : 4,
              },
            ]}>
            <Text style={{ color: theme.texte, fontWeight: actif ? '700' : '500', fontSize: mobile ? TEXTE.legende : 13, ...police(theme.policeTexte) }}>{texte}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Compteurs({ theme, mobile, c }: { theme: ThemeHub; mobile: boolean; c: ReturnType<typeof compter> }) {
  const elements: Array<[string, string, string]> = [
    ['total', 'Fiches', String(c.total)],
    ['relancer', 'À relancer', String(c.aRelancer)],
    ['retard', 'En retard', String(c.enRetard)],
    ['rdv', 'Rendez-vous', String(c.parStatut['rendez-vous'])],
    ['gagnes', 'Gagnés', String(c.parStatut.gagne)],
  ];
  return (
    <View style={styles.compteurs} testID="prospects-compteurs">
      {elements.map(([id, libelle, valeur]) => (
        <View key={id} style={[styles.compteur, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12), minWidth: mobile ? 96 : 110 }]} testID={`prospects-compteur-${id}`}>
          <Text style={{ color: theme.texte, fontSize: mobile ? 22 : 24, fontWeight: '700', ...police(theme.policeChiffres) }}>{valeur}</Text>
          <Text style={{ color: theme.attenue, fontSize: mobile ? TEXTE.legende : 12, ...police(theme.policeTexte) }}>{libelle}</Text>
        </View>
      ))}
    </View>
  );
}

/** Avis : celui de l'Administration sur le bureau ; texte de 15 px au moins sur téléphone. */
function AvisP({ theme, mobile, texte, genre, testID }: { theme: ThemeHub; mobile: boolean; texte: string; genre: 'ok' | 'alerte' | 'critique' | 'info'; testID?: string }) {
  if (!mobile) return <Avis theme={theme} genre={genre} texte={texte} testID={testID} />;
  const couleur = genre === 'ok' ? theme.ok : genre === 'alerte' ? theme.alerte : genre === 'critique' ? theme.critique : theme.accent;
  return (
    <Text
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.avisMobile, { color: theme.texte, borderLeftColor: couleur, backgroundColor: teinteTransparente(couleur, 0.14), ...police(theme.policeTexte) }]}>
      {texte}
    </Text>
  );
}

/** Statut lisible sur téléphone (15 px). */
function PastilleMobile({ theme, texte, couleur, testID }: { theme: ThemeHub; texte: string; couleur: string; testID?: string }) {
  return (
    <Text testID={testID} style={[styles.pastille, { color: theme.texte, borderColor: couleur, backgroundColor: teinteTransparente(couleur, 0.16), ...police(theme.policeTexte) }]}>
      {texte}
    </Text>
  );
}

function RappelRgpd({ theme, mobile }: { theme: ThemeHub; mobile: boolean }) {
  return (
    <View style={[styles.rappel, { borderLeftColor: theme.teintes.quatre, backgroundColor: teinteTransparente(theme.teintes.quatre, 0.1) }]} testID="prospects-rgpd">
      <Text style={{ color: theme.texte, fontSize: mobile ? TEXTE.legende : 13, lineHeight: mobile ? 21 : 19, ...police(theme.policeTexte) }}>{RAPPEL_RGPD}</Text>
    </View>
  );
}

// ------------------------------------------------------------------- Formulaires

function FormulaireProspect({ theme, mobile, initial, onValider, onAnnuler }: { theme: ThemeHub; mobile: boolean; initial?: Prospect; onValider(s: SaisieProspect): void; onAnnuler(): void }) {
  const [s, setS] = useState<SaisieProspect>(() => (initial ? saisieDe(initial) : saisieVide()));
  const champ = (cle: keyof SaisieProspect) => (v: string) => setS(x => ({ ...x, [cle]: v }));
  const relanceInvalide = s.relance.trim() !== '' && !lireJour(s.relance);
  return (
    <View style={styles.formulaire} testID="prospects-formulaire">
      <ChampP theme={theme} mobile={mobile} libelle="Nom" valeur={s.nom} onChanger={champ('nom')} testID="prospects-form-nom" nature="prenom" placeholder="Léa Martin" />
      <ChampP theme={theme} mobile={mobile} libelle="Entreprise" valeur={s.entreprise} onChanger={champ('entreprise')} testID="prospects-form-entreprise" />
      <ChampP theme={theme} mobile={mobile} libelle="E-mail" valeur={s.email} onChanger={champ('email')} testID="prospects-form-email" nature="email" placeholder="lea@exemple.fr" />
      <ChampP theme={theme} mobile={mobile} libelle="Téléphone" valeur={s.telephone} onChanger={champ('telephone')} testID="prospects-form-telephone" nature="nombre" />
      <ChampP theme={theme} mobile={mobile} libelle="Source (où je l’ai trouvé·e)" valeur={s.source} onChanger={champ('source')} testID="prospects-form-source" placeholder="Salon, recommandation…" />
      <ChampP theme={theme} mobile={mobile} libelle="Étiquettes (séparées par des virgules)" valeur={s.etiquettes} onChanger={champ('etiquettes')} testID="prospects-form-etiquettes" />
      <Text style={[styles.etiquette, { color: theme.texte, fontSize: mobile ? TEXTE.legende : 13 }]}>Statut</Text>
      <Puces<StatutProspect> theme={theme} mobile={mobile} libelle="Statut" valeur={s.statut} options={STATUTS.map(x => [x, LIBELLES_STATUT_PROSPECT[x]] as const)} onChoisir={v => setS(x => ({ ...x, statut: v }))} testID="prospects-form-statut" />
      <ChampP theme={theme} mobile={mobile} libelle="Prochaine relance (JJ/MM/AAAA)" valeur={s.relance} onChanger={champ('relance')} testID="prospects-form-relance" placeholder="Vide : aucune" />
      {relanceInvalide ? <AvisP theme={theme} mobile={mobile} genre="alerte" texte="Date attendue : JJ/MM/AAAA." /> : null}
      <ChampP theme={theme} mobile={mobile} libelle="Notes" valeur={s.notes} onChanger={champ('notes')} testID="prospects-form-notes" multiligne />
      <Pressable
        testID="prospects-form-ne-plus-contacter"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: s.nePlusContacter }}
        aria-checked={s.nePlusContacter}
        onPress={() => setS(x => ({ ...x, nePlusContacter: !x.nePlusContacter }))}
        style={[styles.caseLigne, { minHeight: mobile ? CONTROLE.cible : 32 }]}>
        <View style={[styles.case, { borderColor: s.nePlusContacter ? theme.critique : theme.attenue, backgroundColor: s.nePlusContacter ? theme.critique : 'transparent' }]}>
          <Text style={{ color: theme.surAccent, fontWeight: '800', fontSize: 13 }}>{s.nePlusContacter ? '✓' : ''}</Text>
        </View>
        <Text style={{ flex: 1, color: theme.texte, fontSize: mobile ? TEXTE.legende : 14, ...police(theme.policeTexte) }}>Ne plus contacter (la personne a refusé) : bloque « Écrire »</Text>
      </Pressable>
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre={initial ? 'Enregistrer' : 'Ajouter'} onPress={() => onValider(s)} testID="prospects-form-valider" />
        <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={onAnnuler} testID="prospects-form-annuler" />
      </View>
    </View>
  );
}

function FormulaireLot({ theme, mobile, onValider, onAnnuler }: { theme: ThemeHub; mobile: boolean; onValider(texte: string, source: string, etiquettes: string): void; onAnnuler(): void }) {
  const [texte, setTexte] = useState('');
  const [source, setSource] = useState('');
  const [etiquettes, setEtiquettes] = useState('');
  return (
    <View style={styles.formulaire} testID="prospects-lot">
      <Text style={{ color: theme.attenue, fontSize: mobile ? TEXTE.legende : 13, ...police(theme.policeTexte) }}>
        Collez des adresses que vous avez obtenues vous-même : une par ligne, ou séparées par des virgules ou des points-virgules. Les doublons (même adresse, quelle que soit la casse) et les adresses mal formées sont ignorés.
      </Text>
      <ChampP theme={theme} mobile={mobile} libelle="Adresses e-mail" valeur={texte} onChanger={setTexte} testID="prospects-lot-texte" multiligne placeholder={'lea@exemple.fr\nhugo@exemple.com; paul@exemple.org'} />
      <ChampP theme={theme} mobile={mobile} libelle="Source commune (facultatif)" valeur={source} onChanger={setSource} testID="prospects-lot-source" />
      <ChampP theme={theme} mobile={mobile} libelle="Étiquettes communes (facultatif)" valeur={etiquettes} onChanger={setEtiquettes} testID="prospects-lot-etiquettes" />
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre="Ajouter les adresses" onPress={() => onValider(texte, source, etiquettes)} testID="prospects-lot-valider" desactive={!texte.trim()} />
        <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={onAnnuler} testID="prospects-lot-annuler" />
      </View>
    </View>
  );
}

function FormulaireImport({ theme, mobile, onValider, onAnnuler }: { theme: ThemeHub; mobile: boolean; onValider(contenu: string): void; onAnnuler(): void }) {
  const [contenu, setContenu] = useState('');
  return (
    <View style={styles.formulaire} testID="prospects-import">
      <Text style={{ color: theme.attenue, fontSize: mobile ? TEXTE.legende : 13, ...police(theme.policeTexte) }}>
        CSV avec une ligne d’en-tête : nom, entreprise, email, telephone, source, etiquettes, statut, prochaine_relance, notes (virgule ou point-virgule). Les adresses déjà présentes ne sont pas réimportées.
      </Text>
      <DepotFichier onContenu={texte => setContenu(texte)} />
      <ChampP theme={theme} mobile={mobile} libelle="Contenu du CSV" valeur={contenu} onChanger={setContenu} testID="prospects-import-texte" multiligne placeholder={'nom,entreprise,email\nLéa Martin,Atelier Lune,lea@exemple.fr'} />
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre="Importer" onPress={() => onValider(contenu)} testID="prospects-import-valider" desactive={!contenu.trim()} />
        <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={onAnnuler} testID="prospects-import-annuler" />
      </View>
    </View>
  );
}

function FormulaireContact({ theme, mobile, aujourdhui, onValider, onAnnuler }: { theme: ThemeHub; mobile: boolean; aujourdhui: string; onValider(c: { date: string; note: string; relanceDans?: number }): void; onAnnuler(): void }) {
  const [date, setDate] = useState(jourFr(aujourdhui));
  const [note, setNote] = useState('');
  const [relance, setRelance] = useState('7');
  const jour = lireJour(date);
  return (
    <View style={styles.formulaire} testID="prospects-contact">
      <ChampP theme={theme} mobile={mobile} libelle="Date (JJ/MM/AAAA)" valeur={date} onChanger={setDate} testID="prospects-contact-date" />
      <ChampP theme={theme} mobile={mobile} libelle="Note" valeur={note} onChanger={setNote} testID="prospects-contact-note" multiligne placeholder="Appel, e-mail envoyé, réponse…" />
      <ChampP theme={theme} mobile={mobile} libelle="Relancer dans (jours, 0 : pas de relance)" valeur={relance} onChanger={v => setRelance(v.replace(/[^\d]/g, '').slice(0, 3))} testID="prospects-contact-relance" nature="nombre" />
      {!jour ? <AvisP theme={theme} mobile={mobile} genre="alerte" texte="Date attendue : JJ/MM/AAAA." /> : null}
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre="Noter le contact" onPress={() => jour && onValider({ date: jour, note, relanceDans: Number(relance) || 0 })} testID="prospects-contact-valider" desactive={!jour} />
        <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={onAnnuler} testID="prospects-contact-annuler" />
      </View>
    </View>
  );
}

function PanneauEcrire({ theme, mobile, prospect, modeles, aujourdhui, actions, onFermer }: { theme: ThemeHub; mobile: boolean; prospect: Prospect; modeles: ModeleMessage[]; aujourdhui: string; actions: Actions; onFermer(): void }) {
  const [choix, setChoix] = useState(modeles[0]?.id ?? '');
  const modele = modeles.find(m => m.id === choix);
  const blocage = blocageEcrire(prospect);
  if (blocage) {
    return (
      <View style={styles.formulaire} testID="prospects-ecrire">
        <AvisP theme={theme} mobile={mobile} genre="critique" texte={`« Écrire » est bloqué : ${blocage}`} testID="prospects-ecrire-bloque" />
        <Bouton theme={theme} mobile={mobile} titre="Fermer" onPress={onFermer} testID="prospects-ecrire-fermer" />
      </View>
    );
  }
  const sujet = modele ? rendreModele(modele.sujet, prospect) : '';
  const corps = modele ? rendreModele(modele.corps, prospect) : '';
  const texte = { color: theme.texte, fontSize: mobile ? TEXTE.legende : 13, ...police(theme.policeTexte) };
  return (
    <View style={styles.formulaire} testID="prospects-ecrire">
      <Text style={[texte, { color: theme.attenue }]}>Un seul message, ouvert dans votre messagerie : vous le relisez et l’envoyez vous-même.</Text>
      {modeles.length > 0 ? (
        <Puces<string> theme={theme} mobile={mobile} libelle="Modèle" valeur={choix} options={[...modeles.map(m => [m.id, m.nom] as const), ['', 'Sans modèle'] as const]} onChoisir={setChoix} testID="prospects-ecrire-modele" />
      ) : null}
      {modele ? (
        <View style={[styles.apercu, { borderColor: theme.ligne, backgroundColor: theme.fond }]} testID="prospects-ecrire-apercu">
          <Text style={[texte, { fontWeight: '700' }]} testID="prospects-ecrire-sujet">
            {sujet}
          </Text>
          <Text style={texte} testID="prospects-ecrire-corps">
            {corps}
          </Text>
        </View>
      ) : null}
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre={`Écrire à ${prospect.email}`} onPress={() => actions.ecrire(prospect, modele)} testID="prospects-ecrire-ouvrir" />
        {modele ? <Bouton theme={theme} mobile={mobile} titre="Copier le message" onPress={() => actions.copierTexte(`${sujet}\n\n${corps}`, 'Message')} testID="prospects-ecrire-copier" /> : null}
        <Bouton
          theme={theme}
          mobile={mobile}
          titre="Noter l’envoi (relance dans 7 j)"
          onPress={() => actions.contact(prospect.id, { date: aujourdhui, note: `E-mail envoyé${modele ? ` (modèle « ${modele.nom} »)` : ''}`, relanceDans: 7 })}
          testID="prospects-ecrire-noter"
        />
        <Bouton theme={theme} mobile={mobile} titre="Fermer" onPress={onFermer} testID="prospects-ecrire-fermer" />
      </View>
    </View>
  );
}

function EditeurModeles({ theme, mobile, modeles, actions, onFermer }: { theme: ThemeHub; mobile: boolean; modeles: ModeleMessage[]; actions: Actions; onFermer(): void }) {
  const [edite, setEdite] = useState<{ id?: string; nom: string; sujet: string; corps: string } | undefined>();
  const texte = { color: theme.texte, fontSize: mobile ? TEXTE.legende : 13, ...police(theme.policeTexte) };
  if (edite) {
    return (
      <View style={styles.formulaire} testID="prospects-modele-form">
        <Text style={[texte, { color: theme.attenue }]}>Variables : {'{prenom}'}, {'{nom}'}, {'{entreprise}'}, {'{email}'}. Gardez une ligne pour se désinscrire.</Text>
        <ChampP theme={theme} mobile={mobile} libelle="Nom du modèle" valeur={edite.nom} onChanger={v => setEdite({ ...edite, nom: v })} testID="prospects-modele-nom" />
        <ChampP theme={theme} mobile={mobile} libelle="Objet" valeur={edite.sujet} onChanger={v => setEdite({ ...edite, sujet: v })} testID="prospects-modele-sujet" />
        <ChampP theme={theme} mobile={mobile} libelle="Message" valeur={edite.corps} onChanger={v => setEdite({ ...edite, corps: v })} testID="prospects-modele-corps" multiligne />
        <View style={mobile ? styles.pileMobile : commun.actions}>
          <Bouton
            theme={theme}
            mobile={mobile}
            variante="plein"
            titre="Enregistrer le modèle"
            onPress={() => {
              actions.modele(edite);
              setEdite(undefined);
            }}
            testID="prospects-modele-valider"
          />
          <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={() => setEdite(undefined)} testID="prospects-modele-annuler" />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.formulaire} testID="prospects-modeles">
      {modeles.length === 0 ? <Text style={[texte, { color: theme.attenue }]}>Aucun modèle.</Text> : null}
      {modeles.map(m => (
        <View key={m.id} style={[styles.ligneModele, mobile && styles.ligneModeleMobile, { borderColor: theme.ligne }]} testID={`prospects-modele-${m.id}`}>
          <View style={mobile ? undefined : { flex: 1, minWidth: 160 }}>
            <Text style={[texte, { fontWeight: '700' }]}>{m.nom}</Text>
            <Text style={[texte, { color: theme.attenue }]} numberOfLines={2}>
              {m.sujet}
            </Text>
          </View>
          <Bouton theme={theme} mobile={mobile} titre="Modifier" onPress={() => setEdite({ ...m })} testID={`prospects-modele-modifier-${m.id}`} />
          <Bouton theme={theme} mobile={mobile} titre="Supprimer" variante="danger" onPress={() => actions.supprimerModele(m.id)} testID={`prospects-modele-supprimer-${m.id}`} />
        </View>
      ))}
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="plein" titre="Nouveau modèle" onPress={() => setEdite({ nom: '', sujet: 'Bonjour {prenom}', corps: 'Bonjour {prenom},\n\n\n\n—\nPour ne plus recevoir de message de ma part, répondez « stop ».' })} testID="prospects-modele-nouveau" />
        <Bouton theme={theme} mobile={mobile} titre="Fermer" onPress={onFermer} testID="prospects-modeles-fermer" />
      </View>
    </View>
  );
}

function ConfirmationSuppression({ theme, mobile, prospect, onConfirmer, onAnnuler }: { theme: ThemeHub; mobile: boolean; prospect: Prospect; onConfirmer(): void; onAnnuler(): void }) {
  return (
    <View style={styles.formulaire} testID="prospects-suppression">
      <AvisP theme={theme} mobile={mobile} genre="critique" texte={`Supprimer définitivement la fiche de ${prospect.nom || prospect.email} et son historique ? Pour garder trace d’un refus, préférez « Ne plus contacter ».`} />
      <View style={mobile ? styles.pileMobile : commun.actions}>
        <Bouton theme={theme} mobile={mobile} variante="danger" titre="Supprimer" onPress={onConfirmer} testID="prospects-confirmer-suppression" />
        <Bouton theme={theme} mobile={mobile} titre="Annuler" onPress={onAnnuler} testID="prospects-annuler-suppression" />
      </View>
    </View>
  );
}

function Historique({ theme, mobile, prospect }: { theme: ThemeHub; mobile: boolean; prospect: Prospect }) {
  if (prospect.historique.length === 0) return null;
  return (
    <View style={{ gap: 2 }} testID={`prospects-historique-${prospect.id}`}>
      {[...prospect.historique].reverse().slice(0, mobile ? 20 : 5).map(h => (
        <Text key={h.id} style={{ color: theme.attenue, fontSize: mobile ? TEXTE.legende : 12, ...police(theme.policeTexte) }}>
          {jourFr(h.date)} · {h.note || 'Contact'}
        </Text>
      ))}
    </View>
  );
}

function sousTitre(p: Prospect, aujourdhui: string): string {
  return [p.entreprise, p.email || p.telephone, p.nePlusContacter ? 'Ne plus contacter' : p.relance ? texteRelance(p, aujourdhui) : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------- Bureau

function VueBureau(v: PropsVue) {
  const { theme, donnees, liste, ouvert, setOuvert, actions, aujourdhui } = v;
  const mobile = false;
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const fermer = () => setOuvert(undefined);
  const global = ouvert && (ouvert.g === 'nouveau' || ouvert.g === 'lot' || ouvert.g === 'import' || ouvert.g === 'modeles') ? ouvert.g : undefined;
  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-prospects">
      <View style={styles.enteteBureau}>
        <RetourHub theme={theme} onRetour={v.onRetour} titre="Prospects" />
      </View>
      <ScrollView contentContainerStyle={styles.page} testID="prospects-defilement">
        <Text style={[styleTitre(theme), { fontSize: 30 }]} accessibilityRole="header">
          Prospects
        </Text>
        <Text style={[attenue, { fontSize: 14 }]}>Votre carnet de prospection : contacts, relances et modèles de messages. Visible de vous seul.</Text>
        <Compteurs theme={theme} mobile={mobile} c={v.compteurs} />
        <RappelRgpd theme={theme} mobile={mobile} />
        <View style={commun.actions}>
          <Bouton theme={theme} mobile={mobile} variante="plein" titre="Nouveau prospect" onPress={() => setOuvert({ g: 'nouveau' })} testID="prospects-nouveau" />
          <Bouton theme={theme} mobile={mobile} titre="Ajouter en lot" onPress={() => setOuvert({ g: 'lot' })} testID="prospects-ajout-lot" />
          <Bouton theme={theme} mobile={mobile} titre="Importer un CSV" onPress={() => setOuvert({ g: 'import' })} testID="prospects-ouvrir-import" />
          <Bouton theme={theme} mobile={mobile} titre="Exporter (CSV)" onPress={actions.exporter} testID="prospects-export" />
          <Bouton theme={theme} mobile={mobile} titre="Modèles de messages" onPress={() => setOuvert({ g: 'modeles' })} testID="prospects-ouvrir-modeles" />
        </View>
        {v.avis ? <Avis theme={theme} genre={v.avis.genre} texte={v.avis.texte} testID="prospects-avis" /> : null}
        {global ? (
          <Panneau theme={theme}>
            {global === 'nouveau' ? <FormulaireProspect theme={theme} mobile={mobile} onValider={s => actions.enregistrer(s)} onAnnuler={fermer} /> : null}
            {global === 'lot' ? <FormulaireLot theme={theme} mobile={mobile} onValider={actions.lot} onAnnuler={fermer} /> : null}
            {global === 'import' ? <FormulaireImport theme={theme} mobile={mobile} onValider={actions.importer} onAnnuler={fermer} /> : null}
            {global === 'modeles' ? <EditeurModeles theme={theme} mobile={mobile} modeles={donnees.modeles} actions={actions} onFermer={fermer} /> : null}
          </Panneau>
        ) : null}

        <Panneau theme={theme}>
          <Champ theme={theme} libelle="Rechercher" valeur={v.recherche} onChanger={v.setRecherche} testID="prospects-recherche" placeholder="Nom, entreprise, e-mail, note…" />
          <View style={commun.actions}>
            <Puces<Vue> theme={theme} mobile={mobile} libelle="Vue" valeur={v.vue} options={[['tous', 'Tous'], ['relancer', `À relancer aujourd’hui (${v.compteurs.aRelancer})`]]} onChoisir={v.setVue} testID="prospects-vue" />
          </View>
          <Puces<StatutProspect | 'tous'>
            theme={theme}
            mobile={mobile}
            libelle="Statut"
            valeur={v.statut}
            options={[['tous', 'Tous statuts'], ...STATUTS.map(s => [s, `${LIBELLES_STATUT_PROSPECT[s]} (${v.compteurs.parStatut[s]})`] as const)]}
            onChoisir={v.setStatut}
            testID="prospects-statut"
          />
          {v.etiquettes.length > 0 ? (
            <Puces<string> theme={theme} mobile={mobile} libelle="Étiquette" valeur={v.etiquette} options={[['', 'Toutes étiquettes'], ...v.etiquettes.map(e => [e, `#${e}`] as const)]} onChoisir={v.setEtiquette} testID="prospects-etiquette" />
          ) : null}
          <Puces<TriProspects> theme={theme} mobile={mobile} libelle="Tri" valeur={v.tri} options={TRIS.map(t => [t, `Tri : ${LIBELLES_TRI[t]}`] as const)} onChoisir={v.setTri} testID="prospects-tri" />
          <Text style={[attenue, { fontSize: 12 }]} testID="prospects-resultats">
            {liste.length} fiche{liste.length > 1 ? 's' : ''} affichée{liste.length > 1 ? 's' : ''} sur {v.compteurs.total}
          </Text>
        </Panneau>

        {liste.length === 0 ? (
          <Panneau theme={theme}>
            <Text style={attenue} testID="prospects-vide">
              {v.compteurs.total === 0 ? 'Carnet vide : ajoutez un prospect, collez une liste d’adresses ou importez un CSV.' : v.vue === 'relancer' ? 'Personne à relancer aujourd’hui.' : 'Aucune fiche ne correspond aux filtres.'}
            </Text>
          </Panneau>
        ) : null}
        <View style={styles.grille}>
          {liste.map(p => {
            const actif = ouvert && 'id' in ouvert && ouvert.id === p.id ? ouvert.g : undefined;
            const bloque = blocageEcrire(p);
            return (
              <Panneau theme={theme} key={p.id} testID={`prospects-carte-${p.id}`} style={styles.carte}>
                <View style={[commun.ligne, { flexWrap: 'wrap', paddingVertical: 0 }]}>
                  <Text style={[texte, { fontWeight: '700', fontSize: 17, flexShrink: 1 }]}>{p.nom || p.email}</Text>
                  <Pilule theme={theme} texte={LIBELLES_STATUT_PROSPECT[p.statut]} couleur={couleurStatut(p.statut, theme)} testID={`prospects-statut-${p.id}`} />
                  {p.nePlusContacter ? <Pilule theme={theme} texte="Ne plus contacter" couleur={theme.critique} testID={`prospects-refus-${p.id}`} /> : null}
                </View>
                {p.entreprise ? <Text style={[texte, { fontSize: 14 }]}>{p.entreprise}</Text> : null}
                <Text style={[attenue, { fontSize: 13 }]} selectable>
                  {[p.email, p.telephone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
                </Text>
                <Text style={[{ fontSize: 13 }, p.relance && p.relance <= aujourdhui && !p.nePlusContacter ? { color: theme.alerte, fontWeight: '600' } : attenue]} testID={`prospects-relance-${p.id}`}>
                  {texteRelance(p, aujourdhui)}
                </Text>
                {p.source || p.etiquettes.length ? (
                  <Text style={[attenue, { fontSize: 12 }]}>{[p.source && `Source : ${p.source}`, p.etiquettes.map(e => `#${e}`).join(' ')].filter(Boolean).join(' · ')}</Text>
                ) : null}
                {p.notes ? <Text style={[attenue, { fontSize: 12, fontStyle: 'italic' }]}>{p.notes}</Text> : null}
                <Historique theme={theme} mobile={mobile} prospect={p} />
                <View style={commun.actions}>
                  <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.quatre} titre="Écrire" desactive={Boolean(bloque)} libelle={bloque ? `Écrire : bloqué. ${bloque}` : `Écrire à ${p.email}`} onPress={() => setOuvert({ g: 'ecrire', id: p.id })} testID={`prospects-ecrire-${p.id}`} />
                  {p.email ? <BoutonHub theme={theme} titre="Copier l’adresse" onPress={() => actions.copierAdresse(p)} testID={`prospects-copier-${p.id}`} /> : null}
                  <BoutonHub theme={theme} titre="Noter un contact" onPress={() => setOuvert({ g: 'contact', id: p.id })} testID={`prospects-contact-${p.id}`} />
                  <BoutonHub theme={theme} titre="Modifier" onPress={() => setOuvert({ g: 'modifier', id: p.id })} testID={`prospects-modifier-${p.id}`} />
                  <BoutonHub theme={theme} titre="Supprimer" variante="danger" onPress={() => setOuvert({ g: 'supprimer', id: p.id })} testID={`prospects-supprimer-${p.id}`} />
                </View>
                {actif === 'modifier' ? <FormulaireProspect theme={theme} mobile={mobile} initial={p} onValider={s => actions.enregistrer(s, p.id)} onAnnuler={fermer} /> : null}
                {actif === 'contact' ? <FormulaireContact theme={theme} mobile={mobile} aujourdhui={aujourdhui} onValider={c => actions.contact(p.id, c)} onAnnuler={fermer} /> : null}
                {actif === 'ecrire' ? <PanneauEcrire theme={theme} mobile={mobile} prospect={p} modeles={donnees.modeles} aujourdhui={aujourdhui} actions={actions} onFermer={fermer} /> : null}
                {actif === 'supprimer' ? <ConfirmationSuppression theme={theme} mobile={mobile} prospect={p} onConfirmer={() => actions.supprimer(p.id)} onAnnuler={fermer} /> : null}
              </Panneau>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------- Téléphone

function VueMobile(v: PropsVue) {
  const { theme, donnees, liste, ouvert, setOuvert, actions, aujourdhui } = v;
  const mobile = true;
  const fermer = () => setOuvert(undefined);
  const fiche = ouvert && 'id' in ouvert ? donnees.prospects[ouvert.id] : undefined;
  const titres: Record<Ouvert['g'], string> = {
    nouveau: 'Nouveau prospect',
    lot: 'Ajouter en lot',
    import: 'Importer un CSV',
    modeles: 'Modèles de messages',
    filtres: 'Filtres et tri',
    fiche: fiche?.nom || fiche?.email || 'Fiche',
    modifier: 'Modifier la fiche',
    contact: 'Noter un contact',
    ecrire: 'Écrire',
    supprimer: 'Supprimer la fiche',
  };
  const filtresActifs = [v.statut !== 'tous' ? LIBELLES_STATUT_PROSPECT[v.statut as StatutProspect] : '', v.etiquette ? `#${v.etiquette}` : '', `tri : ${LIBELLES_TRI[v.tri].toLowerCase()}`].filter(Boolean).join(' · ');
  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-prospects">
      {/* L'en-tête compact déborde de 8 px de chaque côté : il attend la gouttière de 16 px. */}
      <View style={styles.enteteMobile}>
        <RetourHub theme={theme} onRetour={v.onRetour} titre="Prospects" />
      </View>
      <EcranMobile
        theme={theme}
        onRetour={v.onRetour}
        testID="prospects-defilement"
        pied={<BoutonPrincipal theme={theme} titre="Nouveau prospect" onPress={() => setOuvert({ g: 'nouveau' })} testID="prospects-nouveau" />}>
        <Compteurs theme={theme} mobile={mobile} c={v.compteurs} />
        {v.avis && !ouvert ? <AvisP theme={theme} mobile={mobile} genre={v.avis.genre} texte={v.avis.texte} testID="prospects-avis" /> : null}
        <ChampMobile theme={theme} etiquette="Rechercher" nature="recherche" value={v.recherche} onChangeText={v.setRecherche} placeholder="Nom, entreprise, e-mail…" testID="prospects-recherche" />
        <Puces<Vue> theme={theme} mobile={mobile} libelle="Vue" valeur={v.vue} options={[['tous', 'Tous'], ['relancer', `À relancer (${v.compteurs.aRelancer})`]]} onChoisir={v.setVue} testID="prospects-vue" />
        <GroupeCellules theme={theme}>
          <Cellule theme={theme} titre="Filtres et tri" valeur={filtresActifs} chevron onPress={() => setOuvert({ g: 'filtres' })} testID="prospects-filtres" />
        </GroupeCellules>
        {liste.length === 0 ? (
          <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }} testID="prospects-vide">
            {v.compteurs.total === 0 ? 'Carnet vide : ajoutez un prospect ou collez une liste d’adresses (Outils, plus bas).' : v.vue === 'relancer' ? 'Personne à relancer aujourd’hui.' : 'Aucune fiche ne correspond aux filtres.'}
          </Text>
        ) : (
          <GroupeCellules theme={theme} titre={`${liste.length} fiche${liste.length > 1 ? 's' : ''}`} testID="prospects-liste">
            {liste.map(p => (
              <Cellule
                key={p.id}
                theme={theme}
                titre={p.nom || p.email}
                sousTitre={sousTitre(p, aujourdhui)}
                glyphe={p.nePlusContacter ? '⊘' : (p.nom || p.email).slice(0, 1).toUpperCase()}
                teinte={p.nePlusContacter ? theme.critique : couleurStatut(p.statut, theme)}
                valeur={LIBELLES_STATUT_PROSPECT[p.statut]}
                chevron
                onPress={() => setOuvert({ g: 'fiche', id: p.id })}
                testID={`prospects-carte-${p.id}`}
              />
            ))}
          </GroupeCellules>
        )}
        <GroupeCellules theme={theme} titre="Outils">
          <Cellule theme={theme} titre="Ajouter en lot" sousTitre="Coller une liste d’adresses" glyphe="≡" chevron onPress={() => setOuvert({ g: 'lot' })} testID="prospects-ajout-lot" />
          <Cellule theme={theme} titre="Importer un CSV" glyphe="↓" chevron onPress={() => setOuvert({ g: 'import' })} testID="prospects-ouvrir-import" />
          <Cellule theme={theme} titre="Exporter (CSV)" glyphe="↑" onPress={actions.exporter} testID="prospects-export" />
          <Cellule theme={theme} titre="Modèles de messages" glyphe="✎" chevron onPress={() => setOuvert({ g: 'modeles' })} testID="prospects-ouvrir-modeles" />
        </GroupeCellules>
        <RappelRgpd theme={theme} mobile={mobile} />
      </EcranMobile>

      <FeuilleBasse theme={theme} visible={Boolean(ouvert)} titre={ouvert ? titres[ouvert.g] : ''} onFermer={fermer} testID="prospects-feuille">
        {v.avis && ouvert ? <AvisP theme={theme} mobile={mobile} genre={v.avis.genre} texte={v.avis.texte} testID="prospects-avis" /> : null}
        {ouvert?.g === 'nouveau' ? <FormulaireProspect theme={theme} mobile={mobile} onValider={s => actions.enregistrer(s)} onAnnuler={fermer} /> : null}
        {ouvert?.g === 'lot' ? <FormulaireLot theme={theme} mobile={mobile} onValider={actions.lot} onAnnuler={fermer} /> : null}
        {ouvert?.g === 'import' ? <FormulaireImport theme={theme} mobile={mobile} onValider={actions.importer} onAnnuler={fermer} /> : null}
        {ouvert?.g === 'modeles' ? <EditeurModeles theme={theme} mobile={mobile} modeles={donnees.modeles} actions={actions} onFermer={fermer} /> : null}
        {ouvert?.g === 'filtres' ? (
          <View style={styles.formulaire} testID="prospects-feuille-filtres">
            <Text style={[styles.etiquette, { color: theme.texte, fontSize: TEXTE.legende }]}>Statut</Text>
            <Puces<StatutProspect | 'tous'>
              theme={theme}
              mobile={mobile}
              libelle="Statut"
              valeur={v.statut}
              options={[['tous', 'Tous'], ...STATUTS.map(s => [s, `${LIBELLES_STATUT_PROSPECT[s]} (${v.compteurs.parStatut[s]})`] as const)]}
              onChoisir={v.setStatut}
              testID="prospects-statut"
            />
            {v.etiquettes.length > 0 ? (
              <>
                <Text style={[styles.etiquette, { color: theme.texte, fontSize: TEXTE.legende }]}>Étiquette</Text>
                <Puces<string> theme={theme} mobile={mobile} libelle="Étiquette" valeur={v.etiquette} options={[['', 'Toutes'], ...v.etiquettes.map(e => [e, `#${e}`] as const)]} onChoisir={v.setEtiquette} testID="prospects-etiquette" />
              </>
            ) : null}
            <Text style={[styles.etiquette, { color: theme.texte, fontSize: TEXTE.legende }]}>Tri</Text>
            <Puces<TriProspects> theme={theme} mobile={mobile} libelle="Tri" valeur={v.tri} options={TRIS.map(t => [t, LIBELLES_TRI[t]] as const)} onChoisir={v.setTri} testID="prospects-tri" />
            <BoutonPrincipal theme={theme} titre="Voir les fiches" onPress={fermer} testID="prospects-filtres-valider" />
          </View>
        ) : null}
        {fiche && ouvert?.g === 'fiche' ? <FicheMobile theme={theme} prospect={fiche} aujourdhui={aujourdhui} actions={actions} setOuvert={setOuvert} /> : null}
        {fiche && ouvert?.g === 'modifier' ? <FormulaireProspect theme={theme} mobile={mobile} initial={fiche} onValider={s => actions.enregistrer(s, fiche.id)} onAnnuler={() => setOuvert({ g: 'fiche', id: fiche.id })} /> : null}
        {fiche && ouvert?.g === 'contact' ? <FormulaireContact theme={theme} mobile={mobile} aujourdhui={aujourdhui} onValider={c => actions.contact(fiche.id, c)} onAnnuler={() => setOuvert({ g: 'fiche', id: fiche.id })} /> : null}
        {fiche && ouvert?.g === 'ecrire' ? <PanneauEcrire theme={theme} mobile={mobile} prospect={fiche} modeles={donnees.modeles} aujourdhui={aujourdhui} actions={actions} onFermer={() => setOuvert({ g: 'fiche', id: fiche.id })} /> : null}
        {fiche && ouvert?.g === 'supprimer' ? <ConfirmationSuppression theme={theme} mobile={mobile} prospect={fiche} onConfirmer={() => actions.supprimer(fiche.id)} onAnnuler={() => setOuvert({ g: 'fiche', id: fiche.id })} /> : null}
      </FeuilleBasse>
    </View>
  );
}

function FicheMobile({ theme, prospect: p, aujourdhui, actions, setOuvert }: { theme: ThemeHub; prospect: Prospect; aujourdhui: string; actions: Actions; setOuvert(o: Ouvert | undefined): void }) {
  const bloque = blocageEcrire(p);
  const texte = { color: theme.texte, fontSize: TEXTE.legende, ...police(theme.policeTexte) };
  return (
    <View style={styles.formulaire} testID={`prospects-fiche-${p.id}`}>
      <View style={[commun.ligne, { flexWrap: 'wrap', paddingVertical: 0 }]}>
        <PastilleMobile theme={theme} texte={LIBELLES_STATUT_PROSPECT[p.statut]} couleur={couleurStatut(p.statut, theme)} testID={`prospects-statut-${p.id}`} />
        {p.nePlusContacter ? <PastilleMobile theme={theme} texte="Ne plus contacter" couleur={theme.critique} testID={`prospects-refus-${p.id}`} /> : null}
      </View>
      {p.entreprise ? <Text style={texte}>{p.entreprise}</Text> : null}
      <Text style={texte} selectable>
        {[p.email, p.telephone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
      </Text>
      <Text style={[texte, { color: p.relance && p.relance <= aujourdhui ? theme.alerte : theme.attenue }]} testID={`prospects-relance-${p.id}`}>
        {texteRelance(p, aujourdhui)}
      </Text>
      {p.source ? <Text style={[texte, { color: theme.attenue }]}>Source : {p.source}</Text> : null}
      {p.etiquettes.length ? <Text style={[texte, { color: theme.attenue }]}>{p.etiquettes.map(e => `#${e}`).join(' ')}</Text> : null}
      {p.notes ? <Text style={[texte, { color: theme.attenue, fontStyle: 'italic' }]}>{p.notes}</Text> : null}
      <Historique theme={theme} mobile prospect={p} />
      <BoutonPrincipal theme={theme} titre={bloque ? 'Écrire (bloqué)' : 'Écrire'} libelle={bloque ? `Écrire : bloqué. ${bloque}` : `Écrire à ${p.email}`} desactive={Boolean(bloque)} onPress={() => setOuvert({ g: 'ecrire', id: p.id })} testID={`prospects-ecrire-${p.id}`} />
      {bloque ? <Text style={[texte, { color: theme.attenue }]}>{bloque}</Text> : null}
      <GroupeCellules theme={theme}>
        {p.email ? <Cellule theme={theme} titre="Copier l’adresse" glyphe="⧉" onPress={() => actions.copierAdresse(p)} testID={`prospects-copier-${p.id}`} /> : null}
        <Cellule theme={theme} titre="Noter un contact" glyphe="✓" chevron onPress={() => setOuvert({ g: 'contact', id: p.id })} testID={`prospects-contact-${p.id}`} />
        <Cellule theme={theme} titre="Modifier" glyphe="✎" chevron onPress={() => setOuvert({ g: 'modifier', id: p.id })} testID={`prospects-modifier-${p.id}`} />
        <Cellule theme={theme} titre="Supprimer" glyphe="✕" danger onPress={() => setOuvert({ g: 'supprimer', id: p.id })} testID={`prospects-supprimer-${p.id}`} />
      </GroupeCellules>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  enteteBureau: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16 },
  enteteMobile: { paddingHorizontal: 16 },
  page: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48, gap: 16 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  compteur: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, flexGrow: 1 },
  rappel: { borderLeftWidth: 4, padding: 12, borderRadius: 8 },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  puce: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'center' },
  formulaire: { gap: 12 },
  pileMobile: { gap: 10 },
  etiquette: { fontWeight: '600' },
  caseLigne: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  case: { width: 24, height: 24, borderWidth: 2, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  apercu: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  ligneModele: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderBottomWidth: 1, paddingBottom: 10 },
  ligneModeleMobile: { flexDirection: 'column', alignItems: 'stretch' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  carte: { flexGrow: 1, flexBasis: 340 },
  avisMobile: { padding: 12, borderRadius: 8, fontSize: TEXTE.legende, lineHeight: 21, borderLeftWidth: 4, overflow: 'hidden' },
  pastille: { fontSize: TEXTE.legende, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderRadius: 999, overflow: 'hidden' },
});
