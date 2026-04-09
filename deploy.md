# Deploy

Target: `if-quests.ru` — files live in `/var/www/html/` (owned by root, served by nginx/apache).

## Steps

**1. Build the site**

```bash
npm run build:site
```

Output goes to `dist/site/`.

**2. Copy files to server via /tmp (required because /var/www/html/assets/ is owned by root)**

```bash
scp dist/site/assets/index-*.js dist/site/assets/index-*.css dist/site/index.html if-quests.ru:/tmp/
```

**3. Move files into place with sudo**

```bash
ssh if-quests.ru "sudo cp /tmp/index-*.js /var/www/html/assets/ && sudo cp /tmp/index-*.css /var/www/html/assets/ && sudo cp /tmp/index.html /var/www/html/"
```

## Notes

- Game data files (`pirates/`, `steelrat/`, `games.json`) are already on the server and don't need redeployment unless games are added or updated.
- Old hashed asset files accumulate in `/var/www/html/assets/` — safe to delete unused ones manually with `sudo rm`.
- SSH key for `if-quests.ru` is in `~/.ssh/known_hosts`. No password needed if your key is authorized on the server.
