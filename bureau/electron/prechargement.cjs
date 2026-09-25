/**
 * Pont entre la fenêtre et le système.
 *
 * C'est la **totalité** de ce que l'interface peut demander au disque et au
 * système. Elle n'a ni `require`, ni `fs`, ni chemin : elle nomme un fichier
 * logique — « portefeuille », « coffre » — et le processus principal décide
 * seul de ce que ce nom désigne.
 *
 * Le fichier est en CommonJS à dessein : un préchargement de bac à sable ne
 * charge pas de module ES.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('applibourse', {
  /** Vrai dans l'application installée, absent dans un simple navigateur. */
  bureau: true,

  fichiers: {
    lire: nom => ipcRenderer.invoke('fichier:lire', nom),
    ecrire: (nom, octets) => ipcRenderer.invoke('fichier:ecrire', nom, octets),
    existe: nom => ipcRenderer.invoke('fichier:existe', nom),
    dossier: () => ipcRenderer.invoke('fichier:dossier'),
    enregistrerSous: (nom, contenu) =>
      ipcRenderer.invoke('systeme:enregistrer-sous', nom, contenu),
  },

  systeme: {
    notifier: (titre, corps) => ipcRenderer.invoke('systeme:notifier', titre, corps),
    ouvrir: url => ipcRenderer.invoke('systeme:ouvrir', url),
  },

  yahoo: {
    /** Réponse JSON d'une adresse Yahoo Finance autorisée. */
    json: url => ipcRenderer.invoke('yahoo:json', url),
  },

  voix: {
    /** Voix naturelles proposées. */
    liste: () => ipcRenderer.invoke('voix:liste'),
    /** MP3 d'une phrase lue par une voix naturelle. */
    synthetiser: (texte, voix, vitesse) => ipcRenderer.invoke('voix:synthetiser', texte, voix, vitesse),
  },

  maj: {
    /** Compare la version installée à celle de GitHub. */
    verifier: () => ipcRenderer.invoke('maj:verifier'),
    /** Lance `npm run maj-pc` dans une fenêtre, puis ferme l'application. */
    installer: () => ipcRenderer.invoke('maj:installer'),
  },
});
