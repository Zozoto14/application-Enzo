/**
 * Éditeur structuré d'un devblog (Fondateur, permission du club devblog.gerer) : date, version facultative,
 * contenu en français et en anglais (titre, intro, sections { emoji, titre, puces { nom, description } }, phrase
 * de fin) ; aperçu en direct « comme sur Discord » (messages découpés à 2000 caractères, fil français) ou « comme
 * dans l'app » ; « Préparer avec l'IA » (version anglaise proposée depuis le français, à relire) ; publication dans
 * l'app (brouillon / publié) puis sur Discord (salons, @here, aperçu exact du serveur, correction rééditée).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiDevblog, contenuVide, type ContenuDevblog, type EntreeDevblog, type EtatDiscord, type Salons } from '../../devblog/api';
import { decouperDiscord, texteDiscord } from '../../devblog/rendu';
import { trDv, type CleDv } from '../../i18n/devblog';
import { PageEsport } from '../CadreEsport';
import { BoutonConfirme, Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, TitreCarte, attenue, texte } from '../design';
import { ApercuDiscord, VueDevblog } from './Contenu';

type Langue = 'fr' | 'en';
interface Brouillon {
  date: string;
  version: string;
  fr: ContenuDevblog;
  en: ContenuDevblog;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const copie = (c: ContenuDevblog): ContenuDevblog => ({ ...c, sections: c.sections.map(s => ({ ...s, puces: s.puces.map(p => ({ ...p })) })) });

export function EditeurDevblog({ theme, client, large, entree: initiale, onRetour }: { theme: ThemeHub; client: ClientEsport; large: boolean; entree: EntreeDevblog | null; onRetour(): void }) {
  const api = useMemo(() => apiDevblog(client), [client]);
  const [entree, setEntree] = useState<EntreeDevblog | null>(initiale);
  const depuis = (e: EntreeDevblog | null): Brouillon => ({ date: e?.date ?? aujourdhui(), version: e?.version ?? '', fr: copie(e?.fr ?? contenuVide()), en: copie(e?.en ?? contenuVide()) });
  const [b, setB] = useState<Brouillon>(() => depuis(initiale));
  const [modifie, setModifie] = useState(false);
  const [langue, setLangue] = useState<Langue>('fr');
  const [apercu, setApercu] = useState<'discord' | 'app'>('discord');
  const [langueApercu, setLangueApercu] = useState<Langue>('en');
  const { enCours, erreur, avis, agir } = useAgir();

  const changer = (l: Langue, f: (c: ContenuDevblog) => ContenuDevblog) => {
    setB(x => ({ ...x, [l]: f(copie(x[l])) }));
    setModifie(true);
  };
  /** Modifie une copie du contenu d'une langue en place (champ d'une section ou d'une puce). */
  const muter = (l: Langue, f: (c: ContenuDevblog) => void) =>
    changer(l, x => {
      f(x);
      return x;
    });
  const regler = (champ: 'date' | 'version', v: string) => {
    setB(x => ({ ...x, [champ]: v }));
    setModifie(true);
  };
  const c = b[langue];

  const enregistrer = async (statut?: 'brouillon' | 'publie') => {
    const corps = { date: b.date, version: b.version, fr: b.fr, en: b.en, ...(statut ? { statut } : {}) };
    const r = entree ? await api.modifier(entree.id, corps) : await api.creer(corps);
    let e = r.entree;
    if (!entree && statut) e = (await api.modifier(e.id, { statut })).entree;
    setEntree(e);
    setB(depuis(e));
    setModifie(false);
    return e;
  };

  // Aperçu en direct (rendu local, miroir du serveur).
  const messages = useMemo(() => {
    const opts = { version: b.version, date: b.date };
    return { en: decouperDiscord(texteDiscord(b.en, 'en', { ...opts, here: true })), fr: decouperDiscord(texteDiscord(b.fr, 'fr', opts)) };
  }, [b]);

  const formulaire = (
    <Carte theme={theme} testID="esport-devblog-formulaire">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
        <Champ theme={theme} libelle={trDv('champ_date')} valeur={b.date} onChanger={v => regler('date', v)} maxLength={10} testID="esport-devblog-date" style={{ minWidth: 160, flex: 1 }} />
        <Champ theme={theme} libelle={trDv('champ_version')} valeur={b.version} onChanger={v => regler('version', v)} maxLength={20} testID="esport-devblog-version" style={{ minWidth: 140, flex: 1 }} />
      </View>
      <Segments<Langue> theme={theme} libelle={trDv('apercu_langue')} valeur={langue} options={[['fr', `🇫🇷 ${trDv('langue_fr')}`], ['en', `🇬🇧 ${trDv('langue_en')}`]]} onChoisir={setLangue} testID="esport-devblog-langue" />
      {langue === 'en' ? (
        <View style={{ gap: ESP.xs, padding: ESP.s, borderRadius: 10, backgroundColor: teinteTransparente(theme.accent, 0.08) }}>
          <Text style={attenue(theme, 13)}>{trDv('ia_aide')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={enCours === 'ia' ? trDv('ia_en_cours') : `✨ ${trDv('ia_preparer')}`}
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('ia', async () => {
                  const r = await api.traduire(b.fr);
                  setB(x => ({ ...x, en: r.en }));
                  setModifie(true);
                  setLangueApercu('en');
                  return trDv('ia_fait');
                })
              }
              testID="esport-devblog-ia"
            />
          </View>
        </View>
      ) : null}
      <Champ theme={theme} libelle={trDv('champ_titre')} placeholder={trDv('champ_titre_aide')} valeur={c.titre} onChanger={v => changer(langue, x => ({ ...x, titre: v }))} maxLength={120} testID={`esport-devblog-${langue}-titre`} />
      <Champ theme={theme} libelle={trDv('champ_intro')} placeholder={trDv('champ_intro_aide')} valeur={c.intro} onChanger={v => changer(langue, x => ({ ...x, intro: v }))} multiligne maxLength={1000} testID={`esport-devblog-${langue}-intro`} />
      {c.sections.map((s, i) => (
        <View key={i} style={{ gap: ESP.xs, padding: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 12 }} testID={`esport-devblog-${langue}-section-${i}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESP.xs, flexWrap: 'wrap' }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('section', { n: i + 1 })}</Text>
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <PetitBouton theme={theme} glyphe="↑" cle="section_monter" desactive={i === 0} onPress={() => changer(langue, x => ({ ...x, sections: deplacer(x.sections, i, -1) }))} testID={`esport-devblog-${langue}-section-${i}-monter`} />
              <PetitBouton theme={theme} glyphe="↓" cle="section_descendre" desactive={i === c.sections.length - 1} onPress={() => changer(langue, x => ({ ...x, sections: deplacer(x.sections, i, 1) }))} testID={`esport-devblog-${langue}-section-${i}-descendre`} />
              <PetitBouton theme={theme} glyphe="×" cle="section_retirer" onPress={() => changer(langue, x => ({ ...x, sections: x.sections.filter((_, k) => k !== i) }))} testID={`esport-devblog-${langue}-section-${i}-retirer`} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: ESP.xs }}>
            <Champ theme={theme} libelle={trDv('section_emoji')} valeur={s.emoji} onChanger={v => muter(langue, x => {
                  x.sections[i].emoji = v;
                })} maxLength={16} testID={`esport-devblog-${langue}-section-${i}-emoji`} style={{ width: 84 }} />
            <Champ theme={theme} libelle={trDv('section_titre')} valeur={s.titre} onChanger={v => muter(langue, x => {
                  x.sections[i].titre = v;
                })} maxLength={80} testID={`esport-devblog-${langue}-section-${i}-titre`} style={{ flex: 1 }} />
          </View>
          {s.puces.map((p, j) => (
            <View key={j} style={{ flexDirection: large ? 'row' : 'column', gap: ESP.xs, alignItems: large ? 'flex-end' : 'stretch', paddingLeft: ESP.s, borderLeftWidth: 2, borderLeftColor: teinteTransparente(theme.accent, 0.4) }}>
              <Champ theme={theme} libelle={trDv('puce_nom')} valeur={p.nom} onChanger={v => muter(langue, x => {
                  x.sections[i].puces[j].nom = v;
                })} maxLength={80} testID={`esport-devblog-${langue}-section-${i}-puce-${j}-nom`} style={large ? { width: 190 } : undefined} />
              <Champ theme={theme} libelle={trDv('puce_description')} valeur={p.description} onChanger={v => muter(langue, x => {
                  x.sections[i].puces[j].description = v;
                })} multiligne={!large} maxLength={600} testID={`esport-devblog-${langue}-section-${i}-puce-${j}-description`} style={{ flex: large ? 1 : undefined }} />
              <PetitBouton theme={theme} glyphe="×" cle="puce_retirer" vars={{ n: j + 1 }} onPress={() => muter(langue, x => {
                  x.sections[i].puces = x.sections[i].puces.filter((_, k) => k !== j);
                })} testID={`esport-devblog-${langue}-section-${i}-puce-${j}-retirer`} />
            </View>
          ))}
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={`+ ${trDv('puce_ajouter')}`} onPress={() => muter(langue, x => {
                  x.sections[i].puces = [...x.sections[i].puces, { nom: '', description: '' }];
                })} testID={`esport-devblog-${langue}-section-${i}-puce-ajouter`} />
          </View>
        </View>
      ))}
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} titre={`+ ${trDv('section_ajouter')}`} onPress={() => changer(langue, x => ({ ...x, sections: [...x.sections, { emoji: '✨', titre: '', puces: [{ nom: '', description: '' }] }] }))} testID={`esport-devblog-${langue}-section-ajouter`} />
      </View>
      <Champ theme={theme} libelle={trDv('champ_conclusion')} placeholder={trDv('champ_conclusion_aide')} valeur={c.conclusion} onChanger={v => changer(langue, x => ({ ...x, conclusion: v }))} multiligne maxLength={600} testID={`esport-devblog-${langue}-conclusion`} />
    </Carte>
  );

  const vueApercu = (
    <Carte theme={theme} testID="esport-devblog-apercu">
      <TitreCarte theme={theme} titre={trDv('apercu')} />
      <Segments<'discord' | 'app'> theme={theme} libelle={trDv('apercu')} valeur={apercu} options={[['discord', trDv('apercu_discord')], ['app', trDv('apercu_app')]]} onChoisir={setApercu} testID="esport-devblog-apercu-mode" />
      {apercu === 'app' ? (
        <>
          <Segments<Langue> theme={theme} libelle={trDv('apercu_langue')} valeur={langueApercu} options={[['fr', trDv('langue_fr')], ['en', trDv('langue_en')]]} onChoisir={setLangueApercu} testID="esport-devblog-apercu-langue" />
          <VueDevblog theme={theme} contenu={b[langueApercu]} langue={langueApercu} date={b.date} version={b.version} compact testID="esport-devblog-apercu-app" />
        </>
      ) : (
        <ApercuDiscord theme={theme} en={messages.en} fr={messages.fr} testID="esport-devblog-apercu-discord" />
      )}
    </Carte>
  );

  const statut = entree?.statut ?? 'brouillon';
  return (
    <PageEsport large={large} testID="esport-devblog-editeur">
      <EnTetePage
        theme={theme}
        large={large}
        avant={
          <Pressable accessibilityRole="link" onPress={onRetour} testID="esport-devblog-editeur-retour" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>{`‹ ${trDv('editeur_retour')}`}</Text>
          </Pressable>
        }
        titre={trDv('editeur_titre')}
        sous={b.fr.titre || b.en.titre || trDv('nouveau')}
        action={
          <BoutonHub theme={theme} titre={enCours === 'enregistrer' ? '…' : trDv('enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={() =>
              void agir('enregistrer', async () => {
                await enregistrer();
                return trDv('enregistre');
              })
            } testID="esport-devblog-enregistrer" />
        }
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
        <Badge theme={theme} texte={statut === 'publie' ? trDv('publie') : trDv('brouillon')} ton={statut === 'publie' ? 'ok' : 'alerte'} testID="esport-devblog-statut" />
        {modifie ? <Badge theme={theme} texte={trDv('modifications')} ton="accent" testID="esport-devblog-modifie" /> : null}
        <View style={{ flex: 1 }} />
        {statut === 'brouillon' ? (
          <BoutonHub theme={theme} titre={`🚀 ${trDv('publier_app')}`} desactive={Boolean(enCours)} onPress={() =>
              void agir('publier', async () => {
                await enregistrer('publie');
                return trDv('publie_app');
              })
            } testID="esport-devblog-publier-app" />
        ) : (
          <BoutonHub theme={theme} titre={trDv('repasser_brouillon')} desactive={Boolean(enCours)} onPress={() =>
              void agir('brouillon', async () => {
                await enregistrer('brouillon');
                return trDv('enregistre');
              })
            } testID="esport-devblog-depublier" />
        )}
        {entree ? (
          <BoutonConfirme
            theme={theme}
            titre={trDv('supprimer')}
            confirmation={trDv('supprimer_confirmer')}
            onConfirme={() =>
              void agir('supprimer', async () => {
                await api.supprimer(entree.id);
                onRetour();
              })
            }
            testID="esport-devblog-supprimer"
          />
        ) : null}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog-editeur" />
      {large ? (
        <View style={{ flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.15, minWidth: 0 }}>{formulaire}</View>
          <View style={{ flex: 1, minWidth: 0 }}>{vueApercu}</View>
        </View>
      ) : (
        <>
          {formulaire}
          {vueApercu}
        </>
      )}
      {entree ? <PublierDiscord theme={theme} client={client} entree={entree} modifie={modifie} /> : null}
    </PageEsport>
  );
}

function deplacer<T>(l: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= l.length) return l;
  const r = [...l];
  [r[i], r[j]] = [r[j], r[i]];
  return r;
}

function PetitBouton({ theme, glyphe, cle, vars, onPress, desactive, testID }: { theme: ThemeHub; glyphe: string; cle: CleDv; vars?: Record<string, number>; onPress(): void; desactive?: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={trDv(cle, vars)}
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: desactive ? 0.35 : 1 }}>
      <Text style={{ color: theme.texte, fontSize: 18 }}>{glyphe}</Text>
    </Pressable>
  );
}

/** Publication Discord : salons, @here, aperçu exact du serveur, état par salon ; réglage du salon d'annonces du club. */
function PublierDiscord({ theme, client, entree, modifie }: { theme: ThemeHub; client: ClientEsport; entree: EntreeDevblog; modifie: boolean }) {
  const api = useMemo(() => apiDevblog(client), [client]);
  const [salons, setSalons] = useState<Salons | undefined>();
  const [choisis, setChoisis] = useState<string[]>([]);
  const [here, setHere] = useState(true);
  const [etat, setEtat] = useState<EtatDiscord | undefined>();
  const [voirApercu, setVoirApercu] = useState(false);
  const [webhook, setWebhook] = useState({ nom: '', url: '' });
  const [bot, setBot] = useState({ id: '', nom: '' });
  const { enCours, erreur, avis, agir } = useAgir();
  const publie = entree.statut === 'publie';

  const charger = useCallback(async () => {
    const s = await api.salons();
    setSalons(s);
    setChoisis(c => (c.length ? c : s.defaut));
    if (s.salonBot) setBot(s.salonBot);
    if (publie) setEtat(await api.etatDiscord(entree.id, here));
  }, [api, entree.id, publie, here]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const dejaPublie = Boolean(etat?.publications.some(p => p.messages > 0 && choisis.includes(p.cible)));
  const resultat = (e: string) => trDv(`discord_resultat_${e}` as CleDv);
  return (
    <Carte theme={theme} testID="esport-devblog-discord">
      <TitreCarte theme={theme} titre={`📣 ${trDv('discord_titre')}`} sous={trDv('discord_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog-discord" />
      {!publie ? <Text style={attenue(theme, 14)} testID="esport-devblog-discord-brouillon">{trDv('discord_brouillon')}</Text> : null}
      <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('discord_salons')}</Text>
      {salons && salons.salons.length === 0 ? <Text style={attenue(theme, 13)}>{trDv('discord_salons_aucun')}</Text> : null}
      {salons?.salons.map(s => {
        const coche = choisis.includes(s.cle);
        const p = etat?.publications.find(x => x.cible === s.cle);
        return (
          <View key={s.cle} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
            <Case theme={theme} coche={coche} libelle={s.nom} onChanger={v => setChoisis(c => (v ? [...c, s.cle] : c.filter(x => x !== s.cle)))} testID={`esport-devblog-salon-${s.cle.replace(':', '-')}`} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={texte(theme, 14)} numberOfLines={1}>{`${s.genre === 'club' ? trDv('discord_club') : trDv('discord_team')} · ${s.nom}`}</Text>
              <Text style={attenue(theme, 12)} numberOfLines={1}>{[s.detail, s.invalide ? trDv('discord_invalide') : ''].filter(Boolean).join(' · ')}</Text>
            </View>
            {p ? (
              <Badge
                theme={theme}
                texte={`${trDv(`discord_etat_${p.statut}` as CleDv)}${p.statut === 'envoye' ? ` · ${p.aJour ? trDv('discord_a_jour') : trDv('discord_pas_a_jour')}` : ''}${p.statut === 'envoye' && !p.filFrancais ? ` · ${trDv('discord_sans_fil')}` : ''}`}
                ton={p.statut === 'abandonne' ? 'critique' : p.statut === 'envoye' && p.aJour ? 'ok' : 'alerte'}
                testID={`esport-devblog-publication-${s.cle.replace(':', '-')}`}
              />
            ) : null}
          </View>
        );
      })}
      {etat?.publications.filter(p => p.erreur).map(p => (
        <Text key={p.cible} style={{ ...attenue(theme, 12), color: theme.alerte }}>{`${p.nom ?? p.cible} : ${p.erreur}`}</Text>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
        <Case theme={theme} coche={here} libelle={trDv('discord_here')} onChanger={setHere} testID="esport-devblog-here" />
        <Text style={texte(theme, 14)}>{trDv('discord_here')}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        <BoutonHub theme={theme} titre={voirApercu ? `▾ ${trDv('discord_apercu')}` : `▸ ${trDv('discord_apercu')}`} desactive={!publie} onPress={() => setVoirApercu(v => !v)} testID="esport-devblog-discord-apercu-ouvrir" />
        <BoutonHub
          theme={theme}
          titre={dejaPublie ? trDv('discord_corriger') : trDv('discord_publier')}
          variante="plein"
          desactive={!publie || modifie || !choisis.length || Boolean(enCours)}
          onPress={() =>
            void agir('discord', async () => {
              const r = await api.publierDiscord(entree.id, choisis, here);
              setEtat(r);
              return (r.resultats ?? []).map(x => `${salons?.salons.find(s => s.cle === x.cible)?.nom ?? x.cible} : ${resultat(x.etat)}`).join(' · ');
            })
          }
          testID="esport-devblog-discord-publier"
        />
        <BoutonHub
          theme={theme}
          titre={trDv('discord_defaut')}
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('defaut', async () => {
              setSalons(await api.reglerSalons({ defaut: choisis }));
              return trDv('enregistre');
            })
          }
          testID="esport-devblog-discord-defaut"
        />
      </View>
      {voirApercu && etat ? <ApercuDiscord theme={theme} en={etat.apercu.en} fr={etat.apercu.fr} testID="esport-devblog-discord-apercu" /> : null}
      <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.m }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('discord_reglages')}</Text>
        <Text style={attenue(theme, 13)}>{trDv('discord_reglages_aide')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'flex-end' }}>
          <Champ theme={theme} libelle={trDv('discord_webhook_nom')} valeur={webhook.nom} onChanger={v => setWebhook(w => ({ ...w, nom: v }))} maxLength={60} testID="esport-devblog-webhook-nom" style={{ minWidth: 160, flex: 1 }} />
          <Champ theme={theme} libelle={trDv('discord_webhook_url')} valeur={webhook.url} onChanger={v => setWebhook(w => ({ ...w, url: v }))} secret testID="esport-devblog-webhook-url" style={{ minWidth: 220, flex: 2 }} />
          <BoutonHub
            theme={theme}
            titre={trDv('discord_webhook_ajouter')}
            desactive={!webhook.nom.trim() || !webhook.url.trim() || Boolean(enCours)}
            onPress={() =>
              void agir('webhook', async () => {
                const s = await api.reglerSalons({ webhook: { nom: webhook.nom.trim(), url: webhook.url.trim() } });
                setSalons(s);
                setChoisis(c => [...new Set([...c, ...s.defaut])]);
                setWebhook({ nom: '', url: '' });
                return trDv('enregistre');
              })
            }
            testID="esport-devblog-webhook-ajouter"
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'flex-end' }}>
          <Champ theme={theme} libelle={trDv('discord_bot_id')} valeur={bot.id} onChanger={v => setBot(x => ({ ...x, id: v.trim() }))} clavier="number-pad" maxLength={25} testID="esport-devblog-bot-id" style={{ minWidth: 200, flex: 1 }} />
          <Champ theme={theme} libelle={trDv('discord_bot_nom')} valeur={bot.nom} onChanger={v => setBot(x => ({ ...x, nom: v }))} maxLength={60} testID="esport-devblog-bot-nom" style={{ minWidth: 160, flex: 1 }} />
          <BoutonHub theme={theme} titre={trDv('discord_bot_lier')} desactive={!bot.id || Boolean(enCours)} onPress={() =>
              void agir('bot', async () => {
                setSalons(await api.reglerSalons({ salonBot: bot }));
                return trDv('enregistre');
              })
            } testID="esport-devblog-bot-lier" />
          {salons?.salonBot ? (
            <BoutonHub theme={theme} titre={trDv('discord_bot_retirer')} onPress={() =>
                void agir('bot', async () => {
                  setSalons(await api.reglerSalons({ salonBot: null }));
                  setBot({ id: '', nom: '' });
                  return trDv('enregistre');
                })
              } testID="esport-devblog-bot-retirer" />
          ) : null}
        </View>
      </View>
    </Carte>
  );
}
