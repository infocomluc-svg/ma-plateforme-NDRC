# Relevé des résultats des simulations

## 1. Principe

1.1. Avant chaque simulation, l'étudiant indique son prénom et l'initiale de son nom.
1.2. À la fin, son bilan s'ajoute automatiquement à un tableur Google Sheets qui appartient au formateur : une ligne par simulation.
1.3. Chaque soir, le formateur reçoit par e-mail un récapitulatif des nouveaux bilans : un tableau des notes, puis le bilan de chaque étudiant. Le détail réplique par réplique et la conversation complète restent dans le tableur.

## 2. Mise en service (une seule fois, environ 10 minutes)

### 2.1. Créer le tableur
1. Ouvrir https://sheets.new avec le compte Google du formateur.
2. Le renommer, par exemple `Résultats simulations NDRC`.

### 2.2. Coller le programme
1. Menu **Extensions** → **Apps Script**.
2. Tout effacer dans l'éditeur, coller le contenu de `Code.gs`, puis cliquer sur l'icône **Enregistrer**.

### 2.3. Publier le programme
1. Bouton bleu **Déployer** → **Nouveau déploiement**.
2. Roue dentée à côté de « Sélectionner le type » → **Application Web**.
3. **Exécuter en tant que** : *Moi*. **Qui a accès** : *Tout le monde*.
4. Cliquer sur **Déployer**, puis **Autoriser l'accès** et choisir son compte Google.
5. Si Google affiche « Google n'a pas validé cette application » : cliquer sur **Paramètres avancés**, puis **Accéder à … (non sécurisé)**, puis **Autoriser**. C'est normal pour un programme personnel qui n'est pas publié sur une boutique.
6. Copier l'**URL de l'application Web** (elle commence par `https://script.google.com/macros/s/`).

### 2.4. Activer l'e-mail quotidien
1. Revenir sur le tableur et recharger la page : un menu **Simulations** apparaît.
2. **Simulations** → **Installer le relevé**.

### 2.5. Brancher le relevé sur la plateforme
Dans `simulations/sim.js`, coller l'URL de l'étape 2.3 sur la ligne `const RESULTS_URL = "";`.

## 3. Réglages

3.1. En haut de `Code.gs`, le bloc `CONFIG` permet de changer l'adresse de destination, l'heure d'envoi et le fuseau horaire.
3.2. Après une modification de `Code.gs`, refaire **Déployer** → **Gérer les déploiements** → crayon → **Version : nouvelle version** → **Déployer**. L'URL ne change pas.
3.3. **Simulations** → **Envoyer le récapitulatif maintenant** envoie tout de suite les bilans pas encore transmis.

## 4. Données personnelles

4.1. Seuls le prénom et l'initiale du nom sont collectés, avec les réponses de l'étudiant pendant la simulation.
4.2. Les données restent dans le compte Google du formateur.
4.3. Informer les étudiants que leurs bilans sont transmis au formateur, et supprimer les lignes en fin d'année.
