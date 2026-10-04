# Relais IA des simulations client

## 1. À quoi sert ce relais

1.1. GitHub Pages n'héberge que des pages publiques : tout le monde peut lire leur code.
1.2. La clé API Anthropic ne doit donc jamais figurer dans ces pages, sinon n'importe qui pourrait la copier et dépenser votre crédit.
1.3. Le relais (`worker.js`) est un petit programme gratuit hébergé chez Cloudflare. Il garde la clé secrète et transmet les échanges entre les simulations et l'IA.
1.4. Seul le site `https://infocomluc-svg.github.io` a le droit de l'utiliser.

## 2. Mise en service (une seule fois, environ 10 minutes)

### 2.1. Créer la clé API
1. Ouvrir https://console.anthropic.com, rubrique **API Keys**.
2. Cliquer sur **Create Key**, la nommer `relais-simulations-ndrc`.
3. Copier la clé (elle commence par `sk-ant-`). Elle ne s'affiche qu'une seule fois.
4. Conseillé : dans **Limits**, fixer un plafond de dépense mensuel.

### 2.2. Créer le relais sur Cloudflare
1. Créer un compte gratuit sur https://dash.cloudflare.com.
2. Menu **Workers & Pages** → **Create** → **Create Worker**.
3. Nommer le relais `simulations-ndrc`, puis cliquer sur **Deploy**.
4. Cliquer sur **Edit code**, tout effacer, coller le contenu du fichier `worker.js`, puis **Deploy**.

### 2.3. Ranger la clé dans le coffre-fort du relais
1. Revenir sur la page du relais → onglet **Settings** → **Variables and Secrets** → **Add**.
2. Type : **Secret**. Nom : `ANTHROPIC_API_KEY` (exactement). Valeur : la clé copiée à l'étape 2.1.
3. Cliquer sur **Deploy**.

### 2.4. Brancher le relais sur la plateforme
1. Copier l'adresse du relais affichée par Cloudflare, de la forme `https://simulations-ndrc.VOTRE-COMPTE.workers.dev`.
2. Dans le fichier `simulations/sim.js`, remplacer l'adresse de la ligne `const PROXY_URL = "…";` par celle-ci.

## 3. Coût et réglages

3.1. Une simulation complète coûte quelques centimes : le dialogue utilise un modèle économique, le bilan un modèle plus fin.
3.2. Les modèles et les plafonds se règlent en haut de `worker.js` (`MODELS` et `MAX_TOKENS`).
3.3. Pour couper l'accès à tout moment : désactiver la clé dans la Console Anthropic.
