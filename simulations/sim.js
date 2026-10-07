/* ═══════════════════════════════════════════════════════════════
   MOTEUR DES SIMULATIONS RELATION CLIENT — BTS NDRC
   Un seul fichier pour les 5 scénarios. Chaque page chatbot-sX.html
   ne contient que sa configuration (window.SCENARIO).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── À RENSEIGNER UNE SEULE FOIS : adresse de votre relais Cloudflare Worker
  const PROXY_URL = "https://simulations-ndrc.infocomluc.workers.dev/";

  // ── Relevé des résultats (Google Sheets + e-mail). Laisser vide pour ne rien transmettre.
  const RESULTS_URL = "https://script.google.com/macros/s/AKfycbzpJW-GoEdCC5ZMw9YZd936CC6PTX7gNKWNPwNflQfZ_F-5O62GWValhiAKiKp-aBER/exec";

  const S = window.SCENARIO;
  const MODEL_TURNS = S.modelTurns ?? 3;   // répliques du conseiller modèle
  const MIN_REPLIES = S.minReplies ?? 5;   // répliques avant de pouvoir demander le bilan
  const MAX_REPLIES = S.maxReplies ?? 15;  // répliques maximum de l'étudiant
  const LEVEL_TONES = { 1: "#1C6FE8", 2: "#0B5FD9", 3: "#0B1F4D" };
  const MOODS = [
    { face: "😡", label: "Furieux" },
    { face: "😠", label: "Agacé" },
    { face: "😐", label: "Méfiant" },
    { face: "🙂", label: "Rassuré" },
    { face: "😊", label: "Satisfait" },
  ];

  const state = {
    who: null,           // {prenom, initiale}
    simId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
    phase: "intro",      // intro | model | student | done
    transcript: [],      // {role:'client'|'advisor'|'student', text, api?, mood?}
    mood: 1,
    moods: [],           // {mood, at:index dans transcript}
    studentCount: 0,
    handoverAt: null,
    busy: false,
    skip: false,
  };

  // ── Outils
  const $ = (id) => document.getElementById(id);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => esc(s).replace(/\n+/g, "<br>");
  const proxyMissing = () => PROXY_URL.includes("VOTRE-WORKER");
  const resultsOn = () => /^https:\/\/script\.google\.com\//.test(RESULTS_URL);

  // ── Identité de l'étudiant : prénom et initiale du nom, mémorisés dans ce navigateur
  const WHO_KEY = "ndrc-simulations-etudiant";
  function loadWho() {
    try { const w = JSON.parse(localStorage.getItem(WHO_KEY)); return w && w.prenom ? w : null; } catch { return null; }
  }
  function saveWho(w) { try { localStorage.setItem(WHO_KEY, JSON.stringify(w)); } catch { /* navigation privée */ } }
  const whoLabel = (w) => `${w.prenom} ${w.initiale}.`;

  // ── Étoiles : 0-5 → 1, 6-10 → 2, 11-15 → 3, 16-20 → 4. La meilleure tentative de chaque scénario compte.
  const MAX_STARS = 4;
  const NB_SCENARIOS = 5;
  const toStars = (t) => (t <= 5 ? 1 : t <= 10 ? 2 : t <= 15 ? 3 : 4);
  const STAR_LABELS = { 1: "À retravailler", 2: "En progrès", 3: "Bien joué", 4: "Excellent" };
  const STARS_KEY = "ndrc-simulations-etoiles";
  function loadStars() { try { return JSON.parse(localStorage.getItem(STARS_KEY)) || {}; } catch { return {}; } }
  function saveBest(who, num, stars) {
    const all = loadStars();
    const mine = all[who] || {};
    const improved = !mine["s" + num] || stars > mine["s" + num];
    if (improved) mine["s" + num] = stars;
    all[who] = mine;
    try { localStorage.setItem(STARS_KEY, JSON.stringify(all)); } catch { /* navigation privée */ }
    return { mine, improved };
  }
  const starIcon = (on) => `<svg class="star${on ? " star--on" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.8 6.1 6.6.7-4.9 4.5 1.4 6.5L12 17.1l-5.9 3.3 1.4-6.5L2.6 9.4l6.6-.7z"/></svg>`;
  const starRow = (n, max = MAX_STARS) => Array.from({ length: max }, (_, i) => starIcon(i < n)).join("");
  // ── Historique des bilans : relisibles à tout moment depuis « Mes bilans »
  const BILANS_KEY = "ndrc-simulations-bilans";
  const BILANS_MAX = 40;
  function loadBilans() { try { return JSON.parse(localStorage.getItem(BILANS_KEY)) || []; } catch { return []; } }
  function storeBilan(rec) {
    let all = loadBilans().filter((b) => b.id !== rec.id);
    all.unshift(rec);
    all = all.slice(0, BILANS_MAX);
    // Si le navigateur manque de place, on retire les plus anciens jusqu'à ce que ça rentre.
    while (all.length) {
      try { localStorage.setItem(BILANS_KEY, JSON.stringify(all)); return true; }
      catch { all.pop(); }
    }
    return false;
  }
  const LEVELS = ["À travailler", "À travailler", "Fragile", "En progrès", "Solide", "Maîtrisé"];
  const cap = (t) => t.toLocaleLowerCase("fr").replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("fr"));

  // ── Consignes ajoutées aux prompts
  const CLIENT_RULES = `CONSIGNES TECHNIQUES (jamais mentionnées dans tes réponses) :
- Termine CHAQUE message par [[humeur:N]], N allant de 1 (furieux) à 5 (satisfait), selon ton état après la dernière réplique du conseiller. Tu commences à 1.
- Ton humeur remonte surtout quand le conseiller est précis : informations exactes, délais et montants chiffrés, procédure claire, droits correctement cités, termes justes du métier. L'empathie te touche, mais elle ne te suffit pas : des paroles compréhensives sans contenu concret te font douter. Ton humeur baisse s'il est vague, approximatif, se trompe sur tes droits, emploie un vocabulaire familier, répète des formules toutes faites, est défensif ou impoli. Quand une réponse reste floue, demande des précisions : « c'est-à-dire ? », « quel délai exactement ? », « sur quel fondement ? ».
- Messages de 2 à 5 phrases, en français oral, sans didascalies ni astérisques. Tu ne sors jamais de ton rôle.`;

  const ADVISOR_RULES = `Réponds uniquement par la réplique du conseiller : 3 à 5 phrases, français oral professionnel, sans didascalies ni astérisques. Tu ne joues jamais le client.
Modèle à démontrer : précision et technicité d'abord. Emploie le vocabulaire exact du métier et du secteur, donne des informations vérifiables (délais, montants, étapes, documents, références de garantie ou de procédure), prends des engagements datés. L'empathie est brève et sincère, une phrase au plus, jamais répétée mécaniquement.`;

  // Le client ne peut conclure l'appel qu'une fois que l'étudiant a fait le minimum de répliques.
  // Avant, il relance toujours : c'est ce qui laisse à l'étudiant de la matière pour s'entraîner.
  const KEEP_GOING = `- L'appel n'est PAS terminé : ne conclus jamais, ne dis pas au revoir. Même si une réponse te satisfait en partie, relance toujours avec une question, un doute ou une exigence nouvelle : délai précis, garantie que cela ne se reproduira pas, compensation du préjudice, suivi, interlocuteur à rappeler, sort de ta commande ou de ton dossier.`;
  const MAY_END = `- Quand ton problème est réglé de façon satisfaisante et que tu n'as plus rien à demander, conclus poliment et ajoute [[fin]]. Sinon, continue de relancer.`;
  const clientSystem = () => {
    const mayEnd = state.phase === "student" && state.studentCount >= MIN_REPLIES;
    return `${S.clientPrompt}\n\n${CLIENT_RULES}\n${mayEnd ? MAY_END : KEEP_GOING}`;
  };
  const advisorSystem = () => `${S.advisorPrompt}\n\n${ADVISOR_RULES}`;

  function evalSystem(n) {
    const focus = (S.evalFocus || []).map((f) => `- ${f}`).join("\n");
    return `Tu es formateur en BTS NDRC (Négociation et Digitalisation de la Relation Client). Tu débriefes un étudiant qui vient de traiter, au téléphone, un client mécontent.

SITUATION : ${S.evalContext}

Tu évalues UNIQUEMENT les répliques de l'étudiant, repérées [R1], [R2]… Les répliques du conseiller modèle servaient d'exemple et ne sont pas notées.

POINTS ATTENDUS DANS CE SCÉNARIO :
${focus}

GRILLE (4 critères notés de 0 à 5, entiers) :
1. Précision et exactitude : informations exactes et vérifiables (délais, montants, étapes de la procédure), droits du client et cadre juridique correctement cités, engagements chiffrés et datés, aucune promesse vague ou irréaliste.
2. Vocabulaire professionnel : termes techniques du métier et du secteur employés à bon escient, registre professionnel, syntaxe correcte, absence de familiarités, de tics de langage et de formules toutes faites répétées.
3. Solutions et argumentation : questions de diagnostic pertinentes, solutions concrètes et réalistes, argumentation technique ou juridique, geste commercial proportionné au préjudice.
4. Relation client : écoute, reformulation, empathie, reprise de confiance, engagement de suivi et conclusion de l'échange.

PONDÉRATION DE L'EXIGENCE :
- La précision, le vocabulaire et la technicité priment. Les qualités relationnelles restent attendues mais ne comptent que pour un critère sur quatre.
- L'empathie seule ne suffit pas : une réplique chaleureuse mais imprécise, vague ou sans contenu technique est « a_revoir ».
- Pénalise les formules d'empathie répétées à chaque réplique (« je comprends votre frustration ») quand elles remplacent une information.
- Valorise les termes exacts (nom de la garantie, délai légal, référence de procédure, étape logistique, document à fournir) et les engagements vérifiables.

EXIGENCES DU RETOUR :
- Bienveillant mais exigeant. Tu vouvoies l'étudiant. Phrases courtes et concrètes.
- Appuie chaque constat sur ses propres mots : cite-les brièvement entre guillemets français « ».
- Sois concis : chaque commentaire et chaque suggestion tient en une ou deux phrases.
- "satisfaisant" et "insatisfaisant" : 2 à 4 constats précis chacun.
- "pistes" : 3 actions concrètes, chacune avec une phrase type qu'il pourra réutiliser.
- "repliques" : exactement ${n} éléments, de R1 à R${n}. Statut "bien", "a_revoir" ou "a_eviter". Pour tout statut autre que "bien", donne dans "suggestion" la formulation qu'il aurait pu dire à la place : style oral professionnel, précise, avec le vocabulaire exact du métier et des éléments concrets (délai, montant, procédure). Pour "bien", "suggestion" peut rester vide.
- Note réaliste : une prestation moyenne se situe autour de 10 à 12 sur 20.

FORMAT : réponds UNIQUEMENT par un objet JSON valide, sans texte autour ni balises de code. À l'intérieur des textes, n'utilise JAMAIS de guillemets droits ("), uniquement des guillemets français « » ; pas de retour à la ligne dans les textes.
{
  "criteres": [
    {"nom": "Précision et exactitude", "note": 0, "commentaire": "..."},
    {"nom": "Vocabulaire professionnel", "note": 0, "commentaire": "..."},
    {"nom": "Solutions et argumentation", "note": 0, "commentaire": "..."},
    {"nom": "Relation client", "note": 0, "commentaire": "..."}
  ],
  "appreciation": "une phrase de synthèse",
  "verdict": "fidelise | mitige | perdu",
  "satisfaisant": ["..."],
  "insatisfaisant": ["..."],
  "pistes": [{"action": "...", "exemple": "..."}],
  "repliques": [{"n": 1, "statut": "bien", "commentaire": "...", "suggestion": ""}],
  "conseil": "le conseil prioritaire pour la prochaine simulation"
}`;
  }

  // ── Appel au relais
  async function callAI(system, messages, maxTokens, purpose) {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, messages, max_tokens: maxTokens, purpose }),
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Le relais IA a répondu de façon illisible (code ${res.status}).`); }
    if (!res.ok || data.error) throw new Error(data.error?.message || `Le relais IA a renvoyé l'erreur ${res.status}.`);
    return (data.content || []).map((b) => b.text || "").join("").trim();
  }

  // ── Historiques vus par chaque IA
  function pushMerged(out, role, content) {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content;
    else out.push({ role, content });
  }
  function clientMessages() {
    const out = [{ role: "user", content: `${S.company}, service client, bonjour. Je vous écoute.` }];
    state.transcript.forEach((e) => pushMerged(out, e.role === "client" ? "assistant" : "user", e.role === "client" ? e.api : e.text));
    return out;
  }
  function advisorMessages() {
    const out = [];
    state.transcript.forEach((e) => pushMerged(out, e.role === "client" ? "user" : "assistant", e.text));
    return out;
  }

  // ── Rendu de la page
  function render() {
    document.title = `${S.title} — Simulation BTS NDRC`;
    document.body.style.setProperty("--tone", S.tone || LEVEL_TONES[S.level] || "#1F4FFF");
    const goals = ["Être précis : délais, montants, procédure, droits exacts", "Employer le vocabulaire professionnel du secteur", ...S.tips]
      .map((t) => `<li>${esc(t)}</li>`).join("");
    const segs = MOODS.map(() => "<i></i>").join("");
    document.body.innerHTML = `
<div class="app">
  <header class="topbar">
    <a class="back" href="index.html"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Scénarios</a>
    <div class="topbar-title">
      <span class="topbar-emoji" aria-hidden="true">${S.emoji}</span>
      <div><strong>${esc(S.title)}</strong><span>${esc(S.company)}</span></div>
    </div>
    <div class="progress"><span id="progressText">Observation</span><div class="progress-track"><div class="progress-fill" id="progressFill"></div></div></div>
    <button class="brief-toggle" id="briefToggle" aria-expanded="false" aria-controls="brief">Fiche client</button>
  </header>
  <div class="layout">
    <aside class="brief" id="brief">
      <button class="brief-close" id="briefClose">Fermer la fiche</button>
      <section class="client-card">
        <div class="client-id">
          <div class="client-face" id="clientFace" aria-hidden="true">😡</div>
          <div><h2>${esc(S.clientName)}</h2><p>${esc(S.clientDesc)}</p></div>
        </div>
        <div class="gauge">
          <div class="gauge-head"><span>Humeur du client</span><strong id="moodLabel">Furieux</strong></div>
          <div class="gauge-track" id="gauge" role="meter" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1" aria-label="Humeur du client">${segs}</div>
          <div class="gauge-scale"><span>Furieux</span><span>Satisfait</span></div>
        </div>
      </section>
      <section><h3>La situation</h3><p>${esc(S.context)}</p></section>
      <section><h3>Ce qu'on attend de vous</h3><ul class="goals">${goals}</ul></section>
    </aside>
    <main class="chat">
      <div class="phase" id="phase">Observation : le conseiller modèle répond</div>
      <div class="messages" id="messages" aria-live="polite"></div>
      <div class="composer">
        <div class="composer-row">
          <label class="sr-only" for="input">Votre réponse au client</label>
          <textarea id="input" rows="1" disabled placeholder="Observez d'abord le conseiller modèle"></textarea>
          <button class="send" id="send" disabled aria-label="Envoyer"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="composer-foot">
          <span class="hint" id="hint">La simulation démarre dans un instant.</span>
          <button class="btn btn--ghost" id="takeOver">Je prends la main</button>
          <button class="btn btn--primary" id="finish" hidden disabled>Terminer et voir mon bilan</button>
        </div>
      </div>
    </main>
  </div>
</div>

<div class="intro" id="intro">
  <div class="intro-card">
    <div class="intro-tile" aria-hidden="true">${S.emoji}</div>
    <p class="intro-co">${esc(S.company)}, ${esc(S.sector)}</p>
    <h1>${esc(S.title)}</h1>
    <p class="intro-pitch">${esc(S.pitch)}</p>
    <ol class="steps">
      <li><div><strong>Observez</strong><span>Un conseiller modèle répond à ${esc(S.clientName)} pendant quelques échanges. Repérez ses techniques.</span></div></li>
      <li><div><strong>Prenez la main</strong><span>Vous devenez le conseiller. Le client réagit à vos vraies réponses, et son humeur aussi.</span></div></li>
      <li><div><strong>Recevez votre bilan</strong><span>Jusqu'à 4 étoiles, ce qui fonctionne, ce qui coince, et une meilleure formulation pour chaque réplique à retravailler.</span></div></li>
    </ol>
    ${proxyMissing() ? `<p class="config-warn">Le relais IA n'est pas encore configuré : renseignez l'adresse du Worker sur la ligne PROXY_URL du fichier sim.js.</p>` : ""}
    <form class="who" id="who" novalidate>
      <p class="who-title">Qui s'entraîne ?</p>
      <div class="who-row">
        <label class="who-field">Prénom<input id="whoFirst" name="prenom" autocomplete="given-name" maxlength="30" required></label>
        <label class="who-field who-field--initial">Initiale du nom<input id="whoInitial" name="initiale" maxlength="1" required autocomplete="off" autocapitalize="characters"></label>
      </div>
      <p class="who-note">${resultsOn() ? "Votre bilan sera transmis à votre formateur sous ce nom." : "Ce nom figurera sur votre bilan."}</p>
      <p class="who-error" id="whoError" role="alert" hidden></p>
    </form>
    <button class="btn btn--primary btn--xl" id="start" form="who" type="submit" ${proxyMissing() ? "disabled" : ""}>Lancer la simulation</button>
    <a class="intro-back" href="index.html">Choisir un autre scénario</a>
  </div>
</div>

<div class="debrief" id="debrief" hidden></div>`;
  }

  // ── Affichage des messages
  function scrollDown() { const m = $("messages"); m.scrollTop = m.scrollHeight; }

  function addBubble(e) {
    const who = e.role === "client" ? S.clientName : e.role === "advisor" ? "Conseiller modèle" : "Vous";
    const badge = e.role === "client" ? `<span class="msg-mood" title="${MOODS[e.mood - 1].label}">${MOODS[e.mood - 1].face}</span>` : "";
    const div = document.createElement("div");
    div.className = `msg msg--${e.role}`;
    div.innerHTML = `<div class="msg-who">${badge}${esc(who)}</div><div class="bubble">${fmt(e.text)}</div>`;
    $("messages").appendChild(div);
    scrollDown();
  }

  function note(html, mod = "") {
    const div = document.createElement("div");
    div.className = `note ${mod}`;
    div.innerHTML = html;
    $("messages").appendChild(div);
    scrollDown();
    return div;
  }

  function errorNote(err, retry) {
    const n = note(`<p>${esc(err.message)}</p><button class="btn btn--ghost">Réessayer</button>`, "note--error");
    n.querySelector("button").addEventListener("click", () => { n.remove(); retry(); });
  }

  function showTyping(role) {
    hideTyping();
    const div = document.createElement("div");
    div.className = `msg msg--${role}`;
    div.id = "typing";
    div.innerHTML = `<div class="msg-who">${role === "client" ? esc(S.clientName) : "Conseiller modèle"} écrit</div><div class="bubble bubble--typing"><span></span><span></span><span></span></div>`;
    $("messages").appendChild(div);
    scrollDown();
  }
  function hideTyping() { $("typing")?.remove(); }

  function updateMood(m) {
    state.mood = m;
    $("clientFace").textContent = MOODS[m - 1].face;
    $("moodLabel").textContent = MOODS[m - 1].label;
    $("gauge").setAttribute("aria-valuenow", m);
    $("gauge").querySelectorAll("i").forEach((seg, i) => seg.classList.toggle("on", i < m));
  }

  function updateProgress() {
    if (state.phase === "model") {
      $("progressText").textContent = "Observation";
      $("progressFill").style.width = "0%";
    } else {
      $("progressText").textContent = `Réplique ${state.studentCount} sur ${MAX_REPLIES}`;
      $("progressFill").style.width = `${(state.studentCount / MAX_REPLIES) * 100}%`;
    }
  }

  function setInput(enabled) {
    $("input").disabled = !enabled;
    $("send").disabled = !enabled;
    $("finish").disabled = state.studentCount < MIN_REPLIES || state.busy || state.phase !== "student";
    if (enabled) $("input").focus();
  }

  // ── Transcription
  function push(entry) { state.transcript.push(entry); addBubble(entry); }

  function pushClient(raw) {
    const m = raw.match(/\[\[\s*humeur\s*:\s*([1-5])\s*\]\]/i);
    const fin = /\[\[\s*fin\s*\]\]/i.test(raw);
    const text = raw.replace(/\[\[[^\]]*\]\]/g, "").trim();
    const mood = m ? Number(m[1]) : state.mood;
    state.moods.push({ mood, at: state.transcript.length });
    updateMood(mood);
    push({ role: "client", text, api: raw, mood });
    return { fin };
  }

  // ── Phase 1 : observation
  async function runModel() {
    try {
      while (!state.skip && state.transcript.filter((e) => e.role === "advisor").length < MODEL_TURNS) {
        const last = state.transcript[state.transcript.length - 1];
        if (last.role === "client") {
          showTyping("advisor");
          const a = await callAI(advisorSystem(), advisorMessages(), 350, "dialogue");
          hideTyping();
          push({ role: "advisor", text: a.replace(/\[\[[^\]]*\]\]/g, "").trim() });
        } else {
          showTyping("client");
          pushClient(await callAI(clientSystem(), clientMessages(), 350, "dialogue"));
          hideTyping();
        }
        await wait(600);
      }
      if (state.transcript[state.transcript.length - 1].role !== "client") {
        showTyping("client");
        pushClient(await callAI(clientSystem(), clientMessages(), 350, "dialogue"));
        hideTyping();
      }
      handover();
    } catch (err) {
      hideTyping();
      errorNote(err, runModel);
    }
  }

  function handover() {
    state.phase = "student";
    state.handoverAt = state.transcript.length;
    note(`<strong>À vous de jouer.</strong> Vous êtes maintenant le conseiller ${esc(S.company)}. Répondez au dernier message de ${esc(S.clientName)} : son humeur dépend de vos réponses.`, "note--handover");
    $("phase").textContent = "À vous : vous êtes le conseiller";
    $("phase").classList.add("phase--student");
    $("takeOver").hidden = true;
    $("finish").hidden = false;
    $("input").placeholder = `Votre réponse à ${S.clientName}`;
    $("hint").textContent = `Entrée pour envoyer, Maj + Entrée pour aller à la ligne. Bilan disponible après ${MIN_REPLIES} répliques.`;
    updateProgress();
    setInput(true);
  }

  // ── Phase 2 : l'étudiant joue
  async function send() {
    if (state.phase !== "student" || state.busy) return;
    const text = $("input").value.trim();
    if (!text) return;
    $("input").value = "";
    autosize();
    push({ role: "student", text });
    state.studentCount++;
    updateProgress();
    await clientReact();
  }

  async function clientReact() {
    state.busy = true;
    setInput(false);
    try {
      await wait(500);
      showTyping("client");
      const { fin } = pushClient(await callAI(clientSystem(), clientMessages(), 350, "dialogue"));
      hideTyping();
      state.busy = false;
      if (fin && state.studentCount >= MIN_REPLIES) {
        note(`${esc(S.clientName)} considère son problème réglé. Place au bilan.`);
        return endConversation();
      }
      if (state.studentCount >= MAX_REPLIES) {
        note("Vous avez atteint le nombre maximal de répliques. Place au bilan.");
        return endConversation();
      }
      if (state.studentCount === MIN_REPLIES) $("hint").textContent = "Vous pouvez continuer ou demander votre bilan à tout moment.";
      setInput(true);
    } catch (err) {
      hideTyping();
      state.busy = false;
      errorNote(err, clientReact);
    }
  }

  async function endConversation() {
    state.phase = "done";
    setInput(false);
    $("phase").textContent = "Échange terminé";
    await wait(900);
    evaluate();
  }

  // ── Bilan
  function transcriptForEval() {
    let k = 0;
    const lines = state.transcript.map((e) => {
      if (e.role === "client") return `CLIENT (humeur ${e.mood}/5) : ${e.text}`;
      if (e.role === "advisor") return `CONSEILLER MODÈLE (exemple, non évalué) : ${e.text}`;
      k++;
      return `ÉTUDIANT [R${k}] : ${e.text}`;
    });
    return `Transcription complète de l'échange :\n\n${lines.join("\n\n")}\n\nL'étudiant a produit ${k} répliques : le champ "repliques" doit en contenir exactement ${k}, de R1 à R${k}.`;
  }

  // Lecture du bilan : JSON strict d'abord, puis réparation automatique
  // (guillemets non échappés, réponse coupée…) grâce à la bibliothèque jsonrepair.
  function parseJSON(raw) {
    const start = raw.indexOf("{");
    if (start < 0) throw new Error("Le formateur IA n'a pas renvoyé de bilan exploitable.");
    const end = raw.lastIndexOf("}");
    const body = end > start ? raw.slice(start, end + 1) : raw.slice(start);
    try { return JSON.parse(body); } catch { /* on tente la réparation */ }
    try {
      return JSON.parse(window.JSONRepair.jsonrepair(raw.slice(start).replace(/```\s*$/, "")));
    } catch {
      throw new Error("Le bilan reçu est incomplet ou mal formé.");
    }
  }

  async function evaluate() {
    const box = $("debrief");
    box.hidden = false;
    document.body.classList.add("is-debrief");
    box.innerHTML = `<div class="db-loading"><div class="spinner" aria-hidden="true"></div><p class="db-loading-title">Votre formateur relit vos répliques</p><p>Comptez une trentaine de secondes.</p></div>`;
    box.scrollTop = 0;
    const attempt = async () => {
      const raw = await callAI(evalSystem(state.studentCount), [{ role: "user", content: transcriptForEval() }], 4000, "evaluation");
      return parseJSON(raw);
    };
    try {
      let data;
      try { data = await attempt(); }
      catch (first) {
        // Une seconde tentative automatique règle la plupart des incidents passagers.
        console.warn("Bilan, 1re tentative :", first);
        box.querySelector(".db-loading p:last-child").textContent = "Encore quelques secondes, seconde lecture en cours.";
        data = await attempt();
      }
      renderDebrief(data);
    } catch (err) {
      console.error("Bilan :", err);
      box.innerHTML = `<div class="db-loading"><p class="db-loading-title">Le bilan n'a pas pu être produit</p><p>Votre conversation est conservée : vous pouvez relancer l'analyse.</p><p class="db-error-detail">Détail technique : ${esc(err.message)}</p>
        <div class="db-actions db-actions--center"><button class="btn btn--primary" id="dbRetry">Relancer l'analyse</button><button class="btn btn--ghost" id="dbBack">Revenir à la conversation</button></div></div>`;
      $("dbRetry").addEventListener("click", evaluate);
      $("dbBack").addEventListener("click", () => { box.hidden = true; document.body.classList.remove("is-debrief"); });
    }
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
  const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);


  function moodChart() {
    const pts = state.moods;
    if (pts.length < 2) return "";
    const W = 640, H = 170, L = 44, R = 16, T = 16, B = 30;
    const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
    const y = (m) => T + ((5 - m) * (H - T - B)) / 4;
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`).join(" ");
    const area = `${x(0)},${H - B} ${line} ${x(pts.length - 1)},${H - B}`;
    const hIdx = pts.findIndex((p) => p.at >= state.handoverAt);
    const hx = hIdx > 0 ? (x(hIdx - 1) + x(hIdx)) / 2 : null;
    const grid = [1, 2, 3, 4, 5].map((m) => `<line x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}" class="mc-grid"/><text x="${L - 12}" y="${y(m) + 5}" text-anchor="end" class="mc-face">${MOODS[m - 1].face}</text>`).join("");
    const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.mood)}" r="${i >= hIdx && hIdx > -1 ? 5 : 3.5}" class="${i >= hIdx && hIdx > -1 ? "mc-dot" : "mc-dot mc-dot--model"}"/>`).join("");
    const marker = hx ? `<line x1="${hx}" x2="${hx}" y1="${T - 6}" y2="${H - B}" class="mc-hand"/><text x="${hx + 6}" y="${H - 10}" class="mc-label">Vous prenez la main</text>` : "";
    return `<figure class="mood-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de l'humeur du client, de ${MOODS[pts[0].mood - 1].label} à ${MOODS[pts[pts.length - 1].mood - 1].label}">${grid}<polygon points="${area}" class="mc-area"/><polyline points="${line}" class="mc-line"/>${marker}${dots}</svg></figure>`;
  }

  function renderDebrief(d, replay = null) {
    const crit = list(d.criteres).slice(0, 4).map((c) => ({ nom: c.nom, note: clamp(c.note, 0, 5), commentaire: c.commentaire }));
    const total = crit.reduce((s, c) => s + c.note, 0);
    const stars = toStars(total);
    const { mine, improved } = replay
      ? { mine: loadStars()[whoLabel(state.who)] || {}, improved: true }
      : saveBest(whoLabel(state.who), S.num, stars);
    const when = replay ? new Date(replay.date) : new Date();
    const stored = replay ? true : storeBilan({
      id: state.simId, date: when.toISOString(), who: state.who, num: S.num, title: S.title,
      page: location.pathname.split("/").pop() || `chatbot-s${S.num}.html`, stars, d,
      transcript: state.transcript.map((e) => ({ role: e.role, text: e.text, mood: e.mood })),
      moods: state.moods, handoverAt: state.handoverAt, mood: state.mood,
    });
    const done = Object.keys(mine).length;
    const cumul = Object.values(mine).reduce((a, b) => a + b, 0);
    const verdicts = { fidelise: "Client fidélisé", mitige: "Résultat mitigé", perdu: "Client perdu" };
    const vKey = String(d.verdict || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const verdict = vKey.includes("fidel") ? "fidelise" : vKey.includes("perdu") ? "perdu" : "mitige";
    const statusLabel = { bien: "Efficace", a_revoir: "À retravailler", a_eviter: "À éviter" };

    const students = state.transcript.filter((e) => e.role === "student");
    const replies = students.map((s, i) => {
      const r = list(d.repliques).find((x) => Number(x.n) === i + 1) || {};
      const st = statusLabel[r.statut] ? r.statut : "a_revoir";
      return `<article class="reply">
        <div class="reply-head"><span class="reply-n">R${i + 1}</span><span class="chip chip--${st}">${statusLabel[st]}</span></div>
        <p class="reply-said"><b>Vous avez dit :</b> ${esc(s.text)}</p>
        ${r.commentaire ? `<p class="reply-comment">${esc(r.commentaire)}</p>` : ""}
        ${r.suggestion && st !== "bien" ? `<div class="reply-better"><b>Formulation plus efficace</b>${esc(r.suggestion)}</div>` : ""}
      </article>`;
    }).join("");

    $("debrief").innerHTML = `
<div class="sheet">
  <header class="db-head">
    <div class="db-stars" role="img" aria-label="${stars} étoile${stars > 1 ? "s" : ""} sur ${MAX_STARS}">${starRow(stars)}</div>
    <div class="db-summary">
      <p class="db-mention">${STAR_LABELS[stars]}</p>
      <p class="db-appr">${esc(d.appreciation || "")}</p>
      <span class="verdict verdict--${verdict}">${verdicts[verdict]}</span>
    </div>
    <p class="db-meta">${replay ? "Relecture du bilan" : "Bilan"} de ${esc(whoLabel(state.who))}, le ${when.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} à ${when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. ${esc(S.title)}, ${esc(S.company)}. ${students.length} répliques analysées.</p>
  </header>

  <section class="db-progress">
    <div>
      <h2>Votre collection d'étoiles</h2>
      <p>${done < NB_SCENARIOS
        ? `${done} scénario${done > 1 ? "s" : ""} sur ${NB_SCENARIOS} réussi${done > 1 ? "s" : ""}. Terminez les ${NB_SCENARIOS} pour obtenir votre note globale : chaque étoile vaut un point sur 20.`
        : `Les ${NB_SCENARIOS} scénarios sont faits : votre note globale est de <b>${cumul}/20</b>. Rejouez un scénario pour améliorer votre total.`}
      ${improved ? "" : " Votre meilleur score sur ce scénario reste celui d'une tentative précédente."}</p>
    </div>
    <div class="db-progress-total"><span>${cumul}</span><small>/ ${NB_SCENARIOS * MAX_STARS} étoiles</small></div>
  </section>

  <section class="db-block"><h2>L'humeur du client au fil de l'échange</h2>${moodChart()}</section>

  <section class="db-block"><h2>Votre grille</h2>
    ${crit.map((c) => `<div class="crit"><span class="crit-name">${esc(c.nom)}</span><div class="crit-bar"><i style="width:${c.note * 20}%"></i></div><span class="crit-note">${LEVELS[c.note]}</span>${c.commentaire ? `<p>${esc(c.commentaire)}</p>` : ""}</div>`).join("")}
  </section>

  <div class="db-cols">
    <section class="db-col db-col--ok"><h2>Ce qui est satisfaisant</h2><ul>${list(d.satisfaisant).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
    <section class="db-col db-col--ko"><h2>Ce qui ne l'est pas</h2><ul>${list(d.insatisfaisant).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
  </div>

  <section class="db-block"><h2>Pistes d'amélioration</h2>
    <ol class="tracks">${list(d.pistes).map((p) => `<li><div><strong>${esc(p.action || p)}</strong>${p.exemple ? `<q>${esc(p.exemple)}</q>` : ""}</div></li>`).join("")}</ol>
  </section>

  <section class="db-block"><h2>Réplique par réplique</h2>${replies}</section>

  ${d.conseil ? `<section class="db-advice"><h2>Pour la prochaine fois</h2><p>${esc(d.conseil)}</p></section>` : ""}

  ${resultsOn() && !replay ? `<p class="db-sent" id="dbSent" role="status">Transmission du bilan à votre formateur…</p>` : ""}
  ${!replay && stored ? `<p class="db-kept">Ce bilan reste disponible : retrouvez-le à tout moment dans « Mes bilans », sur la page des scénarios.</p>` : ""}

  <div class="db-actions">
    <a class="btn btn--primary" id="dbRestart" href="${location.pathname.split("/").pop()}">${replay ? "Rejouer ce scénario" : "Recommencer ce scénario"}</a>
    <button class="btn btn--ghost" id="dbPrint">Enregistrer en PDF</button>
    <a class="btn btn--ghost" href="index.html#mes-bilans">${replay ? "Retour à mes bilans" : "Changer de scénario"}</a>
  </div>
</div>`;
    $("dbPrint").addEventListener("click", () => window.print());
    $("debrief").scrollTop = 0;

    if (resultsOn() && !replay) {
      sendResults({
        id: state.simId,
        date: new Date().toISOString(),
        etudiant: whoLabel(state.who),
        scenario: { num: S.num, titre: S.title, entreprise: S.company, niveau: S.level },
        note: total,
        etoiles: stars,
        mention: STAR_LABELS[stars],
        criteres: crit,
        verdict: verdicts[verdict],
        appreciation: d.appreciation || "",
        satisfaisant: list(d.satisfaisant),
        insatisfaisant: list(d.insatisfaisant),
        pistes: list(d.pistes).map((p) => ({ action: p.action || String(p), exemple: p.exemple || "" })),
        conseil: d.conseil || "",
        repliques: students.map((s, i) => {
          const r = list(d.repliques).find((x) => Number(x.n) === i + 1) || {};
          return { n: i + 1, statut: statusLabel[r.statut] || "À retravailler", texte: s.text, commentaire: r.commentaire || "", suggestion: r.suggestion || "" };
        }),
        humeur_finale: MOODS[state.mood - 1].label,
        transcription: state.transcript.map((e) =>
          `${e.role === "client" ? S.clientName : e.role === "advisor" ? "Conseiller modèle" : whoLabel(state.who)} : ${e.text}`).join("\n\n"),
      });
    }
  }

  // ── Transmission au relevé Google (Apps Script). Le serveur ignore les doublons (même id).
  async function sendResults(payload) {
    const el = $("dbSent");
    const body = JSON.stringify(payload);
    const done = (ok) => {
      if (!el) return;
      el.classList.add(ok ? "db-sent--ok" : "db-sent--ko");
      el.textContent = ok
        ? "Votre bilan a été transmis à votre formateur."
        : "Le bilan n'a pas pu être transmis à votre formateur. Enregistrez-le en PDF pour le lui remettre.";
    };
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(RESULTS_URL, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=utf-8" } });
        const data = await res.json();
        if (data.ok) return done(true);
        console.warn("Relevé :", data);
      } catch (err) {
        console.warn("Relevé :", err);
      }
      await wait(1500);
    }
    done(false);
  }

  // ── Démarrage
  function autosize() {
    const t = $("input");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 160) + "px";
  }

  function readWho() {
    const prenom = cap($("whoFirst").value.trim().replace(/\s+/g, " "));
    const initiale = $("whoInitial").value.trim().toLocaleUpperCase("fr");
    const err = $("whoError");
    let msg = "";
    if (!/^\p{L}[\p{L}' -]{0,29}$/u.test(prenom)) msg = "Indiquez votre prénom, en lettres uniquement.";
    else if (!/^\p{L}$/u.test(initiale)) msg = "Indiquez la première lettre de votre nom de famille.";
    err.hidden = !msg;
    err.textContent = msg;
    if (msg) { (prenom ? $("whoInitial") : $("whoFirst")).focus(); return null; }
    return { prenom, initiale };
  }

  async function start(e) {
    e?.preventDefault();
    const who = readWho();
    if (!who) return;
    state.who = who;
    saveWho(who);
    $("intro").remove();
    state.phase = "model";
    updateProgress();
    await wait(400);
    pushClient(`${S.firstMessage} [[humeur:1]]`);
    await wait(700);
    runModel();
  }

  function openSaved(id) {
    const rec = loadBilans().find((b) => b.id === id);
    if (!rec) return false;
    state.who = rec.who;
    state.simId = rec.id;
    state.transcript = rec.transcript || [];
    state.moods = rec.moods || [];
    state.handoverAt = rec.handoverAt;
    state.phase = "done";
    updateMood(rec.mood || 1);
    state.transcript.forEach(addBubble);
    $("intro").remove();
    $("phase").textContent = "Relecture d'un bilan";
    $("debrief").hidden = false;
    document.body.classList.add("is-debrief");
    renderDebrief(rec.d, rec);
    return true;
  }

  function init() {
    render();
    updateMood(1);
    const savedId = new URLSearchParams(location.search).get("bilan");
    if (savedId && openSaved(savedId)) return;
    $("who").addEventListener("submit", start);
    const known = loadWho();
    if (known) { $("whoFirst").value = known.prenom; $("whoInitial").value = known.initiale; }
    $("whoInitial").addEventListener("input", (e) => { e.target.value = e.target.value.toLocaleUpperCase("fr"); });
    $("who").addEventListener("input", () => { $("whoError").hidden = true; });
    $("send").addEventListener("click", send);
    $("input").addEventListener("input", autosize);
    $("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $("takeOver").addEventListener("click", (e) => {
      state.skip = true;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = "Passage de relais…";
    });
    $("finish").addEventListener("click", () => {
      if (state.studentCount >= MIN_REPLIES && !state.busy) endConversation();
    });
    const setBrief = (open) => {
      $("brief").classList.toggle("open", open);
      $("briefToggle").setAttribute("aria-expanded", open);
    };
    $("briefToggle").addEventListener("click", () => setBrief(!$("brief").classList.contains("open")));
    $("briefClose").addEventListener("click", () => setBrief(false));
    $("messages").addEventListener("click", () => setBrief(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setBrief(false); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
