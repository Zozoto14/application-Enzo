/**
 * Créer ou modifier une réunion de l'équipe CM : titre, date, heure, durée, fuseau, lieu (salon vocal Discord, lien
 * de visio, sur place), participants (équipe CM, autres membres du club), récurrence hebdomadaire, rappel, ordre du
 * jour (confidentiel). « Trouver un créneau » propose les meilleurs créneaux où tous (ou le plus) de participants sont
 * libres ; « Qui est libre à ce créneau ? » montre qui est libre, occupé ou absent à l'horaire choisi.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { dateValide, heurePlus, heureValide, murale, type ApiReunions, type LieuGenre, type MoiReunions, type Noms, type Proposition, type Reunion } from '../../../cm/reunions';
import { trRe } from '../../../i18n/reunions';
import { Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, Volet, attenue, texte } from '../../design';
import { ChoixBoutons, jourCourt } from './commun';

const DUREES = [15, 30, 45, 60, 90, 120] as const;
const RAPPELS = ['', '5', '15', '30', '60', '1440'] as const;

export function FormReunion({ theme, api, moi, fuseau, reunion, dateInitiale, onFermer, onEnregistre }: { theme: ThemeHub; api: ApiReunions; moi: MoiReunions; fuseau: string; reunion?: Reunion; dateInitiale: string; onFermer(): void; onEnregistre(r: Reunion): void }) {
  const fz = reunion?.fuseau ?? fuseau;
  const [titre, setTitre] = useState(reunion?.titre ?? '');
  const [date, setDate] = useState(reunion ? murale(reunion.debut, fz).date : dateInitiale);
  const [heure, setHeure] = useState(reunion ? murale(reunion.debut, fz).heure : '18:00');
  const [duree, setDuree] = useState(reunion ? Math.round((Date.parse(reunion.fin) - Date.parse(reunion.debut)) / 60_000) : 60);
  const [fuseauSaisi, setFuseauSaisi] = useState(fz);
  const [lieuGenre, setLieuGenre] = useState<LieuGenre>(reunion?.lieuGenre ?? 'discord');
  const [lien, setLien] = useState(reunion?.lien ?? '');
  const [lieu, setLieu] = useState(reunion?.lieu ?? '');
  const [participants, setParticipants] = useState<string[]>(reunion ? reunion.participants.map(p => p.compte).filter(c => c !== reunion.organisateur) : []);
  const [hebdo, setHebdo] = useState(Boolean(reunion?.recurrence));
  const [nombre, setNombre] = useState(reunion?.recurrence?.nombre ? String(reunion.recurrence.nombre) : '');
  const [rappel, setRappel] = useState<string>(reunion ? (reunion.rappelMinutes === null ? '' : String(reunion.rappelMinutes)) : '15');
  const [ordre, setOrdre] = useState(reunion?.notes?.ordreDuJour ?? '');
  const [q, setQ] = useState('');
  const [trouves, setTrouves] = useState<Array<{ compte: string; pseudo: string; equipe: boolean }>>([]);
  const [noms, setNoms] = useState<Noms>(() => Object.fromEntries(moi.equipe.map(m => [m.compte, m.pseudo])));
  const [propositions, setPropositions] = useState<Proposition[] | undefined>();
  const [verif, setVerif] = useState<Proposition | null | undefined>();
  const { erreur, avis, agir } = useAgir();

  useEffect(() => {
    if (q.trim().length < 2) {
      setTrouves([]);
      return;
    }
    let actif = true;
    void api.comptes(q.trim()).then(
      r => {
        if (actif) setTrouves(r.comptes.filter(c => c.compte !== moi.compte).slice(0, 12));
      },
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [api, q, moi.compte]);

  const nom = (c: string) => noms[c] ?? c;
  const basculer = (c: string, pseudo?: string | null) => {
    if (pseudo) setNoms(n => ({ ...n, [c]: pseudo }));
    setParticipants(l => (l.includes(c) ? l.filter(x => x !== c) : [...l, c]));
  };
  const valide = titre.trim().length >= 2 && dateValide(date) && heureValide(heure);
  const saisie = () => ({
    titre: titre.trim(),
    date,
    heureDebut: heure,
    heureFin: heurePlus(heure, duree),
    fuseau: fuseauSaisi.trim(),
    lieuGenre,
    lieu: lieuGenre === 'lieu' || lieuGenre === 'discord' ? lieu.trim() : '',
    lien: lieuGenre === 'lien' || lieuGenre === 'discord' ? lien.trim() : '',
    participants,
    recurrence: hebdo ? { freq: 'hebdo' as const, nombre: nombre.trim() ? Number(nombre) : null } : null,
    rappelMinutes: rappel ? Number(rappel) : null,
    ordreDuJour: ordre,
  });
  const listeNoms = (l: string[]) => l.map(nom).join(', ');

  const resume = (p: Proposition, testID: string) => (
    <View style={{ gap: 2 }} testID={testID}>
      {p.libres.length ? <Text style={{ ...attenue(theme, 12), color: theme.ok }}>{trRe('creneaux.libres', { noms: listeNoms(p.libres) })}</Text> : null}
      {p.inconnus.length ? <Text style={attenue(theme, 12)}>{trRe('creneaux.inconnus', { noms: listeNoms(p.inconnus) })}</Text> : null}
      {p.occupes.length ? <Text style={{ ...attenue(theme, 12), color: theme.alerte }}>{trRe('creneaux.occupes', { noms: listeNoms(p.occupes) })}</Text> : null}
      {p.absents.length ? <Text style={{ ...attenue(theme, 12), color: theme.critique }}>{trRe('creneaux.absents', { noms: listeNoms(p.absents) })}</Text> : null}
    </View>
  );

  return (
    <Volet theme={theme} visible titre={reunion ? trRe('form.modifier') : trRe('form.nouvelle')} onFermer={onFermer} testID="esport-cm-reunion-form" largeur={680}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunion-form" />
      <Champ theme={theme} libelle={trRe('form.titre')} valeur={titre} onChanger={setTitre} maxLength={140} testID="esport-cm-reunion-form-titre" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Champ theme={theme} libelle={trRe('form.date')} valeur={date} onChanger={setDate} maxLength={10} placeholder="2026-11-05" testID="esport-cm-reunion-form-date" style={{ minWidth: 130, flexGrow: 1 }} />
        <Champ theme={theme} libelle={trRe('form.heure')} valeur={heure} onChanger={setHeure} maxLength={5} placeholder="18:00" testID="esport-cm-reunion-form-heure" style={{ minWidth: 100, flexGrow: 1 }} />
        <Champ theme={theme} libelle={trRe('form.fuseau')} valeur={fuseauSaisi} onChanger={setFuseauSaisi} maxLength={60} testID="esport-cm-reunion-form-fuseau" style={{ minWidth: 160, flexGrow: 2 }} />
      </View>
      <ChoixBoutons theme={theme} libelle={trRe('form.duree')} valeur={String(duree)} options={DUREES.map(d => [String(d), d >= 60 && d % 60 === 0 ? trRe('form.duree_h', { n: d / 60 }) : trRe('form.duree_min', { n: d })] as const)} onChoisir={v => setDuree(Number(v))} testID="esport-cm-reunion-form-duree" />

      <View style={{ gap: ESP.xs }}>
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRe('form.participants')}</Text>
        <Text style={attenue(theme, 12)}>{trRe('form.equipe')}</Text>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          {moi.equipe
            .filter(m => m.compte !== moi.compte)
            .map(m => (
              <BoutonHub key={m.compte} theme={theme} titre={m.pseudo ?? m.compte} variante={participants.includes(m.compte) ? 'plein' : 'normal'} onPress={() => basculer(m.compte, m.pseudo)} testID={`esport-cm-reunion-form-p-${m.compte}`} />
            ))}
        </View>
        <Champ theme={theme} libelle={`${trRe('form.autres')} · ${trRe('form.chercher')}`} valeur={q} onChanger={setQ} maxLength={40} testID="esport-cm-reunion-form-chercher" />
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          {trouves
            .filter(c => !moi.equipe.some(m => m.compte === c.compte))
            .map(c => (
              <BoutonHub key={c.compte} theme={theme} titre={c.pseudo} variante={participants.includes(c.compte) ? 'plein' : 'normal'} onPress={() => basculer(c.compte, c.pseudo)} testID={`esport-cm-reunion-form-p-${c.compte}`} />
            ))}
          {participants
            .filter(c => !moi.equipe.some(m => m.compte === c) && !trouves.some(t => t.compte === c))
            .map(c => (
              <BoutonHub key={c} theme={theme} titre={`${nom(c)} ✕`} variante="plein" onPress={() => basculer(c)} testID={`esport-cm-reunion-form-p-${c}`} />
            ))}
        </View>
      </View>

      <Carte theme={theme} dense testID="esport-cm-reunion-creneaux">
        <Text style={{ ...texte(theme, 14), fontWeight: '800' }}>{trRe('creneaux.titre')}</Text>
        <Text style={attenue(theme, 12)}>{trRe('creneaux.aide')}</Text>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub
            theme={theme}
            titre={trRe('creneaux.chercher')}
            variante="plein"
            desactive={!dateValide(date)}
            onPress={() =>
              void agir('creneaux', async () => {
                const r = await api.creneaux({ participants, duree, du: date, jours: 7, fuseau: fuseauSaisi.trim(), sauf: reunion?.id });
                setNoms(n => ({ ...n, ...r.noms }));
                setPropositions(r.propositions);
              })
            }
            testID="esport-cm-reunion-creneaux-chercher"
          />
          <BoutonHub
            theme={theme}
            titre={trRe('creneaux.verifier')}
            desactive={!valide}
            onPress={() =>
              void agir('verifier', async () => {
                const r = await api.creneaux({ participants, duree, du: date, jours: 1, fuseau: fuseauSaisi.trim(), heureMin: heure, heureMax: heurePlus(heure, duree), sauf: reunion?.id, max: 1 });
                setNoms(n => ({ ...n, ...r.noms }));
                setVerif(r.propositions[0] ?? null);
              })
            }
            testID="esport-cm-reunion-creneaux-verifier"
          />
        </View>
        {verif !== undefined ? (
          verif ? (
            <View style={{ gap: 2 }}>
              <Badge theme={theme} ton={verif.tous ? 'ok' : 'alerte'} texte={verif.tous ? trRe('creneaux.tous') : trRe('creneaux.n_sur', { n: verif.n, total: verif.total })} />
              {resume(verif, 'esport-cm-reunion-verif')}
            </View>
          ) : (
            <Text style={attenue(theme, 12)}>{trRe('creneaux.aucun')}</Text>
          )
        ) : null}
        {propositions && !propositions.length ? <Text style={attenue(theme)}>{trRe('creneaux.aucun')}</Text> : null}
        {propositions?.map((p, i) => (
          <View key={p.debut} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-cm-reunion-proposition-${i}`}>
            <View style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.xs }]}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{`${jourCourt(p.local.date)} · ${p.local.heure}–${p.local.heureFin}`}</Text>
              <Badge theme={theme} ton={p.tous ? 'ok' : 'alerte'} texte={p.tous ? trRe('creneaux.tous') : trRe('creneaux.n_sur', { n: p.n, total: p.total })} />
            </View>
            {resume(p, `esport-cm-reunion-proposition-${i}-qui`)}
            <BoutonHub
              theme={theme}
              titre={trRe('creneaux.choisir', { date: jourCourt(p.local.date), heure: p.local.heure })}
              onPress={() => {
                setDate(p.local.date);
                setHeure(p.local.heure);
                setVerif(p);
                setPropositions(undefined);
              }}
              testID={`esport-cm-reunion-proposition-${i}-choisir`}
            />
          </View>
        ))}
      </Carte>

      <ChoixBoutons theme={theme} libelle={trRe('form.lieu')} valeur={lieuGenre} options={(['discord', 'lien', 'lieu', 'aucun'] as const).map(l => [l, trRe(`form.lieu.${l}`)] as const)} onChoisir={setLieuGenre} testID="esport-cm-reunion-form-lieu" />
      {lieuGenre === 'lien' || lieuGenre === 'discord' ? <Champ theme={theme} libelle={lieuGenre === 'discord' ? trRe('form.lien_discord') : trRe('form.lien')} valeur={lien} onChanger={setLien} maxLength={2000} testID="esport-cm-reunion-form-lien" /> : null}
      {lieuGenre === 'lieu' || lieuGenre === 'discord' ? <Champ theme={theme} libelle={trRe('form.adresse')} valeur={lieu} onChanger={setLieu} maxLength={200} testID="esport-cm-reunion-form-adresse" /> : null}
      <ChoixBoutons theme={theme} libelle={trRe('form.recurrence')} valeur={hebdo ? 'hebdo' : 'aucune'} options={[['aucune', trRe('form.recurrence.aucune')], ['hebdo', trRe('form.recurrence.hebdo')]]} onChoisir={v => setHebdo(v === 'hebdo')} testID="esport-cm-reunion-form-recurrence" />
      {hebdo ? <Champ theme={theme} libelle={trRe('form.nombre')} valeur={nombre} onChanger={v => setNombre(v.replace(/\D/g, ''))} maxLength={3} clavier="number-pad" testID="esport-cm-reunion-form-nombre" /> : null}
      <ChoixBoutons theme={theme} libelle={trRe('form.rappel')} valeur={rappel} options={RAPPELS.map(x => [x, x === '' ? trRe('form.rappel.aucun') : x === '1440' ? trRe('form.rappel.jour') : trRe('form.rappel.min', { n: x })] as const)} onChoisir={setRappel} testID="esport-cm-reunion-form-rappel" />
      {!reunion ? <Champ theme={theme} libelle={trRe('form.ordre_du_jour')} valeur={ordre} onChanger={setOrdre} multiligne maxLength={8000} testID="esport-cm-reunion-form-ordre" /> : null}
      <BoutonHub
        theme={theme}
        titre={reunion ? trRe('action.enregistrer') : trRe('action.creer')}
        variante="plein"
        desactive={!valide}
        onPress={() =>
          void agir('enregistrer', async () => {
            const s = saisie();
            const d = reunion ? await api.modifier(reunion.id, { ...s, ordreDuJour: undefined, version: reunion.version }) : await api.creer(s);
            onEnregistre(d.reunion);
          })
        }
        testID="esport-cm-reunion-form-ok"
      />
      {!valide ? <Text style={attenue(theme, 12)}>{trRe('form.invalide')}</Text> : null}
    </Volet>
  );
}
