# Support : les demandes arrivent dans Discord

Cette page a été remplacée par **[support.md](support.md)** (support version 2 : demandes rangées sur le relais,
réponses du Fondateur dans l'app, fil Discord et e-mail, diagnostic de la panne d'octobre 2026).

Chez o2switch, l'adresse du webhook se met dans `~/.appdashboard/relais.env` (`DISCORD_WEBHOOK_URL=…`), voir
[support.md](support.md) § 2. Sur l'ancien relais Cloudflare (avant la bascule), c'était un secret du Worker
(`npx --yes wrangler@4 secret put DISCORD_WEBHOOK_URL --config relais/wrangler.local.toml`).
