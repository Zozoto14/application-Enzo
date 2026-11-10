/**
 * Rendez-vous de l'équipe CM : un membre propose des créneaux (« rendez-vous avec la Responsable CM »), les autres en
 * réservent un. Le serveur garantit qu'un créneau n'est jamais réservé deux fois (409 pour le second). Le rendez-vous
 * réservé arrive dans l'agenda des deux personnes (privé : l'équipe ne le voit pas).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { dateValide, heureValide, murale, type ApiReunions, type LieuGenre, type MoiReunions, type Noms, type OffreRdv } from '../../../cm/reunions';
import { trRe } from '../../../i18n/reunions';
import { Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, TitreCarte, Volet, attenue, texte } from '../../design';
import { ChoixBoutons, jourCourt } from './commun';
import { ChampDate, ChampHeure } from '../../../../ui/dates';

export function RendezVous({ theme, api, large, moi, fuseau }: { theme: ThemeHub; api: ApiReunions; large: boolean; moi: MoiReunions; fuseau: string }) {
  const [offres, setOffres] = useState<OffreRdv[] | undefined>();
  const [noms, setNoms] = useState<Noms>({});
  const [nouvelle, setNouvelle] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const recevoir = useCallback((r: { offres: OffreRdv[]; noms: Noms }) => {
    setOffres(r.offres);
    setNoms(r.noms);
  }, []);
  const charger = useCallback(async () => recevoir(await api.rdv()), [api, recevoir]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const miennes = offres?.filter(o => o.mienne) ?? [];
  const autres = offres?.filter(o => !o.mienne) ?? [];
  const carteOffre = (o: OffreRdv) => {
    const parJour = new Map<string, OffreRdv['creneaux']>();
    for (const c of o.creneaux) {
      const j = murale(c.debut, fuseau).date;
      if (!parJour.has(j)) parJour.set(j, []);
      parJour.get(j)!.push(c);
    }
    return (
      <Carte key={o.id} theme={theme} testID={`esport-cm-rdv-${o.id}`} accent={o.mienne ? theme.accent : theme.ok}>
        <TitreCarte theme={theme} titre={o.titre} sous={[o.mienne ? '' : trRe('rdv.par', { qui: o.proprietairePseudo ?? '—' }), trRe('form.duree_min', { n: o.dureeMinutes }), o.lieuGenre !== 'aucun' ? trRe(`form.lieu.${o.lieuGenre}`) : ''].filter(Boolean).join(' · ')} droite={!o.ouverte ? <Badge theme={theme} ton="alerte" texte={trRe('rdv.fermee')} /> : undefined} />
        {o.description ? <Text style={texte(theme, 13)}>{o.description}</Text> : null}
        {!o.creneaux.some(c => !c.reserve) && !o.mienne ? <Text style={attenue(theme)}>{trRe('rdv.aucun_creneau')}</Text> : null}
        {[...parJour].map(([j, liste]) => (
          <View key={j} style={{ gap: ESP.xxs }}>
            <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{jourCourt(j)}</Text>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              {liste.map(c => {
                const heure = murale(c.debut, fuseau).heure;
                if (o.mienne) return <Badge key={c.id} theme={theme} ton={c.reserve ? 'ok' : 'neutre'} texte={c.reserve ? trRe('rdv.reserve_par', { heure, qui: noms[c.reservePar ?? ''] ?? '—' }) : trRe('rdv.libre', { heure })} testID={`esport-cm-rdv-creneau-${c.id}`} />;
                if (c.reservePar === moi.compte) return <Badge key={c.id} theme={theme} ton="accent" texte={trRe('rdv.mon_rdv', { heure })} testID={`esport-cm-rdv-creneau-${c.id}`} />;
                return (
                  <BoutonHub
                    key={c.id}
                    theme={theme}
                    titre={trRe('rdv.reserver', { heure })}
                    libelle={trRe('rdv.reserver_libelle', { date: jourCourt(j), heure })}
                    onPress={() =>
                      void agir('reserver', async () => {
                        await api.reserver(c.id);
                        await charger();
                        return trRe('rdv.reserve');
                      })
                    }
                    testID={`esport-cm-rdv-creneau-${c.id}`}
                  />
                );
              })}
            </View>
          </View>
        ))}
        {o.mienne ? (
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub theme={theme} titre={o.ouverte ? trRe('rdv.fermer') : trRe('rdv.rouvrir')} onPress={() => void agir('', async () => recevoir(await api.fermerOffre(o.id, !o.ouverte)))} testID={`esport-cm-rdv-${o.id}-ouverte`} />
            <BoutonHub theme={theme} titre={trRe('rdv.supprimer')} variante="danger" onPress={() => void agir('', async () => recevoir(await api.supprimerOffre(o.id)))} testID={`esport-cm-rdv-${o.id}-supprimer`} />
          </View>
        ) : null}
      </Carte>
    );
  };
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-rdv">
      <View style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.s }]}>
        <Text style={{ ...attenue(theme, 13), flex: 1, minWidth: 220 }}>{trRe('rdv.aide')}</Text>
        <BoutonHub theme={theme} titre={trRe('rdv.proposer')} variante="plein" onPress={() => setNouvelle(true)} testID="esport-cm-rdv-nouvelle" />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-rdv" />
      {offres && !offres.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="◷" titre={trRe('rdv.vide')} texte={trRe('rdv.aide')} />
        </Carte>
      ) : null}
      {autres.length ? <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{trRe('rdv.offres')}</Text> : null}
      {autres.length ? <Grille min={large ? 360 : 260}>{autres.map(carteOffre)}</Grille> : null}
      {miennes.length ? <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{trRe('rdv.mes_offres')}</Text> : null}
      {miennes.length ? <Grille min={large ? 360 : 260}>{miennes.map(carteOffre)}</Grille> : null}
      {nouvelle ? <NouvelleOffre theme={theme} api={api} fuseau={fuseau} onFermer={() => setNouvelle(false)} onPublie={r => { recevoir(r); setNouvelle(false); }} /> : null}
    </View>
  );
}

function NouvelleOffre({ theme, api, fuseau, onFermer, onPublie }: { theme: ThemeHub; api: ApiReunions; fuseau: string; onFermer(): void; onPublie(r: { offres: OffreRdv[]; noms: Noms }): void }) {
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [duree, setDuree] = useState('30');
  const [lieuGenre, setLieuGenre] = useState<LieuGenre>('discord');
  const [lien, setLien] = useState('');
  const [plages, setPlages] = useState<Array<{ date: string; heureDebut: string; heureFin: string }>>([]);
  const [plage, setPlage] = useState({ date: murale(new Date(Date.now() + 86_400_000).toISOString(), fuseau).date, heureDebut: '14:00', heureFin: '17:00' });
  const { erreur, avis, agir } = useAgir();
  return (
    <Volet theme={theme} visible titre={trRe('rdv.proposer')} onFermer={onFermer} testID="esport-cm-rdv-form">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-rdv-form" />
      <Champ theme={theme} libelle={trRe('rdv.titre_offre')} valeur={titre} onChanger={setTitre} maxLength={140} testID="esport-cm-rdv-form-titre" />
      <Champ theme={theme} libelle={trRe('rdv.description')} valeur={description} onChanger={setDescription} multiligne maxLength={1000} testID="esport-cm-rdv-form-description" />
      <ChoixBoutons theme={theme} libelle={trRe('rdv.duree')} valeur={duree} options={(['15', '20', '30', '45', '60'] as const).map(d => [d, trRe('form.duree_min', { n: d })] as const)} onChoisir={setDuree} testID="esport-cm-rdv-form-duree" />
      <ChoixBoutons theme={theme} libelle={trRe('form.lieu')} valeur={lieuGenre} options={(['discord', 'lien', 'aucun'] as const).map(l => [l, trRe(`form.lieu.${l}`)] as const)} onChoisir={setLieuGenre} testID="esport-cm-rdv-form-lieu" />
      {lieuGenre !== 'aucun' ? <Champ theme={theme} libelle={lieuGenre === 'discord' ? trRe('form.lien_discord') : trRe('form.lien')} valeur={lien} onChanger={setLien} maxLength={2000} testID="esport-cm-rdv-form-lien" /> : null}
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRe('rdv.plages')}</Text>
      {plages.map((p, i) => (
        <View key={`${p.date}-${p.heureDebut}`} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={texte(theme, 13)}>{trRe('rdv.plage', { date: jourCourt(p.date), debut: p.heureDebut, fin: p.heureFin })}</Text>
          <BoutonHub theme={theme} titre="✕" libelle={trRe('rdv.supprimer')} onPress={() => setPlages(l => l.filter((_, k) => k !== i))} testID={`esport-cm-rdv-form-plage-${i}-suppr`} />
        </View>
      ))}
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <ChampDate theme={theme} libelle={trRe('form.date')} valeur={plage.date} onChanger={date => setPlage({ ...plage, date })} testID="esport-cm-rdv-form-date" style={{ minWidth: 130, flexGrow: 1 }} />
        <ChampHeure theme={theme} libelle={trRe('dispos.debut')} valeur={plage.heureDebut} onChanger={heureDebut => setPlage({ ...plage, heureDebut })} testID="esport-cm-rdv-form-debut" style={{ minWidth: 90, flexGrow: 1 }} />
        <ChampHeure theme={theme} libelle={trRe('dispos.fin')} valeur={plage.heureFin} onChanger={heureFin => setPlage({ ...plage, heureFin })} testID="esport-cm-rdv-form-fin" style={{ minWidth: 90, flexGrow: 1 }} />
      </View>
      <BoutonHub theme={theme} titre={trRe('rdv.ajouter_plage')} desactive={!dateValide(plage.date) || !heureValide(plage.heureDebut) || !heureValide(plage.heureFin)} onPress={() => setPlages(l => [...l, plage])} testID="esport-cm-rdv-form-plage-ajouter" />
      <BoutonHub
        theme={theme}
        titre={trRe('rdv.publier')}
        variante="plein"
        desactive={titre.trim().length < 2 || !plages.length}
        onPress={() =>
          void agir('publier', async () => {
            onPublie(await api.creerOffre({ titre: titre.trim(), description: description.trim(), dureeMinutes: Number(duree), fuseau, lieuGenre, lien: lien.trim() || undefined, plages }));
          })
        }
        testID="esport-cm-rdv-form-ok"
      />
    </Volet>
  );
}
