# Sudoku duel — version Vercel

Sudoku en 1 contre 1. Cette version est adaptée à Vercel :

- les pages statiques sont servies depuis `public/` ;
- la logique de jeu tourne dans une fonction serverless, `api/game.js` ;
- l'état des parties est stocké dans **Upstash Redis**, disponible depuis le Marketplace Vercel.

Vercel ne permet pas de garder un serveur WebSocket ouvert : les navigateurs interrogent donc l'API environ une fois par seconde. C'est invisible en jeu.

## Déploiement

### 1. Mettre le code sur GitHub

Créez un dépôt (privé ou public) et poussez-y le contenu de ce dossier.

### 2. Créer le projet Vercel

Sur vercel.com, cliquez sur **Add New… → Project**, puis importez le dépôt. Laissez les réglages par défaut : `vercel.json` s'occupe de tout (preset *Other*, dossier `public`, pas de build). Cliquez sur **Deploy**.

Ce premier déploiement affichera une erreur à la création de partie : la base n'est pas encore branchée. C'est normal.

### 3. Ajouter la base Redis

1. Dans le projet, ouvrez l'onglet **Storage**.
2. Cliquez sur **Create Database** et choisissez **Upstash (Redis)** dans le Marketplace.
3. Choisissez une région européenne et l'offre gratuite.
4. Connectez la base au projet.

Vercel ajoute alors automatiquement les variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Le code accepte les deux.

### 4. Rapprocher la fonction de la base (recommandé)

Dans **Settings → Functions → Function Region**, choisissez une région proche de celle de la base, par exemple Paris (`cdg1`) ou Francfort (`fra1`). Par défaut, Vercel exécute les fonctions aux États-Unis, ce qui ralentit chaque échange.

### 5. Redéployer

Ouvrez l'onglet **Deployments**, cliquez sur **⋯** sur le dernier déploiement, puis sur **Redeploy**. Les variables d'environnement ne s'appliquent qu'aux nouveaux déploiements.

Le jeu est alors accessible à tous sur `https://<projet>.vercel.app`. Vous pouvez ajouter votre propre domaine dans **Settings → Domains**.

## Développement local

```bash
npm install
npm run dev     # http://localhost:3000, parties stockées en mémoire
```

Pour tester avec la vraie base, lancez `vercel env pull .env.local`, puis exportez ces variables avant `npm run dev`. Vous pouvez aussi utiliser `vercel dev`.

## Variables d'environnement facultatives

| Variable | Défaut | Rôle |
|---|---|---|
| `GAME_TTL_HOURS` | `6` | Durée d'inactivité avant suppression d'une partie |
| `ALLOWED_ORIGINS` | domaine de la requête | Origines autorisées, séparées par des virgules |

## Consommation

Chaque joueur connecté fait environ une requête par seconde, ce qui représente environ 3 commandes Redis. Une partie de 10 minutes coûte donc de l'ordre de 1 200 appels de fonction et 3 500 commandes Redis. C'est compatible avec les offres gratuites pour un usage entre amis. Vérifiez les quotas actuels de Vercel et d'Upstash si l'usage grandit.

## Sécurité

- **Serveur faisant autorité.** Grilles, solutions, chrono et gagnant sont gérés côté serveur. La solution n'est jamais envoyée au navigateur.
- **Jetons de joueur.** Aléatoires sur 144 bits, transmis dans le corps des requêtes et non dans l'URL, comparés en temps constant.
- **Écritures atomiques.** Un compare-and-set Lua protège les parties contre les écritures concurrentes.
- **Filtrage des requêtes.** Contrôle de l'en-tête `Origin`, JSON uniquement, corps limité à 4 Ko, limitation des créations de partie par IP.
- **En-têtes stricts.** CSP sans `unsafe-inline`, anti-iframe, `nosniff`, `no-referrer`.
- **Aucune donnée personnelle.** Les parties expirent automatiquement dans Redis.
