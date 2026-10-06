/* ═══════════════════════════════════════════════════════════════
   CORRECTION IA DES CAS PRATIQUES — Plateforme BTS NDRC
   Complète la correction existante de index.html :
   - questions ouvertes : note sur 6, éléments acquis, manquants, erreurs, piste ;
   - QCM et mises en situation : explication personnalisée des choix de l'étudiant ;
   - synthèse : note sur 20 recalculée et conseil prioritaire.
   Si l'IA ne répond pas, l'auto-évaluation d'origine reste disponible.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // Même relais que les simulations (clé API protégée chez Cloudflare)
  const PROXY_URL = "https://simulations-ndrc.infocomluc.workers.dev/";

  const MODULES = {
    p: { panel: "cas-prospection", nom: "Prospection commerciale" },
    n: { panel: "cas-negociation", nom: "Négociation commerciale" },
    v: { panel: "cas-vente", nom: "Techniques de vente" },
    m: { panel: "cas-marketing", nom: "Marketing et data client" },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);

  // ── Lecture du cas tel que l'étudiant l'a rempli (avant que la correction ne modifie la page)
  function snapshot(mod) {
    const cfg = CONFIG[mod];
    const panel = $(MODULES[mod].panel);
    const qcm = Object.entries(cfg.qcm).map(([qn, data]) => {
      const opts = [...document.querySelectorAll(`#opts-${mod}${qn} .option-item`)];
      const choisies = opts.map((o, i) => (o.querySelector("input").checked || o.classList.contains("selected") ? i : -1)).filter((i) => i >= 0);
      const juste = choisies.length === data.correct.length && choisies.every((i) => data.correct.includes(i));
      return {
        num: Number(qn),
        type: txt($(`qb-${mod}${qn}`).querySelector(".q-type-badge")),
        enonce: txt($(`qb-${mod}${qn}`).querySelector(".q-text")),
        options: opts.map((o, i) => ({ texte: txt(o), attendue: data.correct.includes(i), choisie: choisies.includes(i) })),
        juste,
        explication: data.expl,
      };
    });
    const ouvertes = Object.entries(cfg.open).map(([qn, max]) => {
      const cor = $(`cor-${mod}${qn}`);
      const corrige = cor ? txt(cor.querySelector("p")) : "";
      return { num: Number(qn), max, enonce: txt($(`qb-${mod}${qn}`).querySelector(".q-text")), corrige, reponse: ($(`ans-${mod}${qn}`) || {}).value?.trim() || "" };
    });
    return { mod, module: MODULES[mod].nom, situation: txt(panel.querySelector(".scenario-box p")), qcm, ouvertes, total: cfg.total };
  }

  function prompt(s) {
    return `Tu es formateur en BTS NDRC (Négociation et Digitalisation de la Relation Client), référentiel 2018, bloc 1. Tu corriges le cas pratique « ${s.module} » d'un étudiant.

EXIGENCES DE CORRECTION :
- Priorité à la PRÉCISION : notions exactes, définitions justes, chiffres et calculs corrects, méthodes nommées et correctement appliquées (SONCAS, CAP, RFM, NPS, CAC…), cadre juridique exact quand il est en jeu.
- VOCABULAIRE PROFESSIONNEL : termes techniques du métier et du secteur, registre écrit professionnel. Signale les approximations, les familiarités et les termes impropres.
- APPLICATION AU CAS : l'étudiant doit exploiter les données de la mise en situation (chiffres, cible, contraintes), pas réciter un cours général.
- Les qualités relationnelles comptent, mais elles ne compensent pas une réponse imprécise ou incomplète.
- Ton bienveillant, exigeant, concret. Tu vouvoies l'étudiant. Phrases courtes. Cite brièvement ses mots entre guillemets français « ».
- Questions ouvertes : note entière de 0 au maximum indiqué. Une réponse vide vaut 0. Une réponse correcte mais générale, sans application au cas, ne dépasse pas la moitié des points. Le corrigé de référence liste les éléments attendus : une formulation différente mais juste est acceptée.
- QCM : les bonnes réponses sont déjà affichées à l'étudiant. Explique en une ou deux phrases ce que révèle SON choix (confusion de notions, raisonnement erroné) ; s'il a juste, confirme brièvement la notion clé.

FORMAT : réponds UNIQUEMENT par un objet JSON valide, sans texte autour ni balises de code. N'utilise jamais de guillemets droits (") à l'intérieur des textes, uniquement « ».
{
  "qcm": [{"num": 1, "analyse": "..."}],
  "ouvertes": [{"num": 3, "note": 0, "acquis": ["..."], "manquants": ["..."], "erreurs": ["..."], "conseil": "une phrase type ou une piste concrète"}],
  "synthese": "deux phrases sur le niveau global",
  "conseil": "le point prioritaire à retravailler"
}`;
  }

  function contenu(s) {
    const q = s.qcm.map((x) => `QUESTION ${x.num} (${x.type}) : ${x.enonce}
${x.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o.texte}${o.attendue ? "  [ATTENDUE]" : ""}${o.choisie ? "  [COCHÉE PAR L'ÉTUDIANT]" : ""}`).join("\n")}
  Résultat : ${x.juste ? "juste" : "faux"}. Explication du cours : ${x.explication}`).join("\n\n");
    const o = s.ouvertes.map((x) => `QUESTION ${x.num} (ouverte, sur ${x.max} points) : ${x.enonce}
  Corrigé de référence : ${x.corrige}
  Réponse de l'étudiant : ${x.reponse || "(aucune réponse)"}`).join("\n\n");
    return `MISE EN SITUATION : ${s.situation}\n\n${q}\n\n${o}\n\nLe champ "qcm" doit couvrir les questions ${s.qcm.map((x) => x.num).join(", ")} ; le champ "ouvertes" les questions ${s.ouvertes.map((x) => x.num).join(", ")}.`;
  }

  async function appelIA(s) {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "evaluation", max_tokens: 3000, system: prompt(s), messages: [{ role: "user", content: contenu(s) }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error?.message || `Erreur ${res.status}`);
    const raw = (data.content || []).map((b) => b.text || "").join("");
    const a = raw.indexOf("{");
    if (a < 0) throw new Error("Réponse inexploitable");
    try { return JSON.parse(raw.slice(a, raw.lastIndexOf("}") + 1)); }
    catch { return JSON.parse(window.JSONRepair.jsonrepair(raw.slice(a))); }
  }

  // ── Affichage
  function puces(titre, items, cls) {
    const l = list(items);
    return l.length ? `<div class="ia-list ${cls}"><b>${titre}</b><ul>${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  }

  function afficherQcm(mod, s, r) {
    s.qcm.forEach((q) => {
      const a = list(r.qcm).find((x) => Number(x.num) === q.num);
      const host = $(`expl-${mod}${q.num}`);
      if (!a || !a.analyse || !host) return;
      host.insertAdjacentHTML("afterend",
        `<div class="ia-card ia-card--qcm ${q.juste ? "ia-ok" : "ia-ko"}"><span class="ia-tag">Analyse de votre réponse</span><p>${esc(a.analyse)}</p></div>`);
    });
  }

  function afficherOuvertes(mod, s, r) {
    let points = 0;
    s.ouvertes.forEach((q) => {
      const a = list(r.ouvertes).find((x) => Number(x.num) === q.num) || {};
      const note = Math.max(0, Math.min(q.max, Math.round(Number(a.note) || 0)));
      points += note;
      state[mod].open[q.num] = note >= q.max / 2;
      const ev = $(`eval-${mod}${q.num}`);
      if (ev) ev.style.display = "none";
      $(`cor-${mod}${q.num}`).insertAdjacentHTML("afterend", `
        <div class="ia-card">
          <div class="ia-head"><span class="ia-tag">Correction du formateur IA</span><span class="ia-note">${note} / ${q.max}</span></div>
          ${puces("Éléments acquis", a.acquis, "ia-list--ok")}
          ${puces("Éléments manquants", a.manquants, "ia-list--miss")}
          ${puces("Erreurs ou imprécisions", a.erreurs, "ia-list--ko")}
          ${a.conseil ? `<p class="ia-tip"><b>Pour progresser :</b> ${esc(a.conseil)}</p>` : ""}
        </div>`);
    });
    return points;
  }

  function afficherSynthese(mod, s, r, pointsOuverts) {
    const pointsQcm = s.qcm.reduce((t, q) => t + (q.juste ? 2 : 0), 0);
    const score = pointsQcm + pointsOuverts;
    const note = Math.round((score / s.total) * 20 * 10) / 10;
    const syn = $(`syn-${mod}`);
    const mention = note >= 16 ? "🏆 Excellent" : note >= 14 ? "✨ Très bien" : note >= 12 ? "👍 Bien" : note >= 10 ? "📚 Passable" : "⚠️ Insuffisant";
    const lignes = [
      ...s.qcm.map((q) => ({ n: q.num, t: `Question ${q.num} (${/^QCM/i.test(q.type) ? "QCM" : "mise en situation"})`, ok: q.juste, pts: q.juste ? 2 : 0, max: 2, d: (list(r.qcm).find((x) => Number(x.num) === q.num) || {}).analyse || q.explication })),
      ...s.ouvertes.map((q) => {
        const a = list(r.ouvertes).find((x) => Number(x.num) === q.num) || {};
        const n = Math.max(0, Math.min(q.max, Math.round(Number(a.note) || 0)));
        return { n: q.num, t: `Question ${q.num} (ouverte)`, ok: n >= q.max / 2, pts: n, max: q.max, d: list(a.manquants)[0] ? `À compléter : ${list(a.manquants)[0]}` : "Réponse complète." };
      }),
    ].sort((a, b) => a.n - b.n);
    syn.innerHTML = `
      <h3>📊 Votre correction</h3>
      <div class="note-display">${String(note).replace(".", ",")} <span>/ 20</span></div>
      <div class="mention">${mention}</div>
      ${r.synthese ? `<p class="ia-syn">${esc(r.synthese)}</p>` : ""}
      ${r.conseil ? `<p class="ia-syn"><b>Priorité :</b> ${esc(r.conseil)}</p>` : ""}
      <p style="opacity:0.85;font-size:0.85rem;margin-bottom:0.5rem">Score : ${score} / ${s.total} points. Questions ouvertes corrigées par le formateur IA.</p>
      <div class="detail-corrections">${lignes.map((d) => `
        <div class="detail-item">
          <div class="di-header"><span class="${d.ok ? "icon-ok" : "icon-ko"}">${d.ok ? "✔" : "✘"}</span>${esc(d.t)} — <strong>${d.pts}/${d.max} pt${d.max > 1 ? "s" : ""}</strong></div>
          <div class="di-expl">${esc(d.d)}</div>
        </div>`).join("")}</div>
      <button class="btn-recommencer" onclick="resetCas('${mod}')">↩ Recommencer ce module</button>`;
  }

  // ── Branchement sur les fonctions existantes de index.html
  const submitOrigine = window.submitCas;
  const resetOrigine = window.resetCas;

  window.submitCas = async function (mod) {
    if (state[mod].submitted) return;
    const s = snapshot(mod);
    submitOrigine(mod); // correction d'origine : bonnes réponses, explications, corrigés
    const syn = $(`syn-${mod}`);
    const sauvegarde = syn.innerHTML;
    document.querySelectorAll(`[id^="eval-${mod}"]`).forEach((e) => (e.style.display = "none"));
    syn.innerHTML = `<div class="ia-wait"><span class="ia-spin" aria-hidden="true"></span><div><b>Le formateur IA corrige vos réponses</b><br>Comptez une vingtaine de secondes.</div></div>`;
    try {
      const r = await appelIA(s);
      afficherQcm(mod, s, r);
      const pts = afficherOuvertes(mod, s, r);
      afficherSynthese(mod, s, r, pts);
    } catch (err) {
      console.warn("Correction IA :", err);
      document.querySelectorAll(`[id^="eval-${mod}"]`).forEach((e) => (e.style.display = ""));
      syn.innerHTML = `<p class="ia-syn">La correction par l'IA n'est pas disponible pour le moment. Comparez vos réponses aux corrigés et auto-évaluez les questions ouvertes avec les boutons Oui / Non.</p>` + sauvegarde;
    }
    syn.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.resetCas = function (mod) {
    document.querySelectorAll(`#${MODULES[mod].panel} .ia-card`).forEach((e) => e.remove());
    document.querySelectorAll(`[id^="eval-${mod}"]`).forEach((e) => (e.style.display = ""));
    resetOrigine(mod);
  };

  // ── Styles
  const css = `
  .ia-card{margin-top:.8rem;padding:1rem 1.2rem;background:#eef4ff;border:1.5px solid #3b6fe0;border-radius:10px;font-size:.85rem;line-height:1.65;color:var(--text)}
  .ia-card--qcm{margin-top:.6rem;padding:.8rem 1rem}
  .ia-card--qcm.ia-ok{background:#ecfdf3;border-color:var(--green)}
  .ia-card--qcm.ia-ko{background:#fff1f1;border-color:var(--wrong)}
  .ia-card p{margin:0}
  .ia-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.5rem}
  .ia-tag{display:inline-block;font-size:.65rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#1f4fbf;margin-bottom:.3rem}
  .ia-ok .ia-tag{color:var(--green)} .ia-ko .ia-tag{color:var(--wrong)}
  .ia-note{font-family:'Playfair Display',serif;font-weight:900;font-size:1.3rem;color:#1f4fbf;white-space:nowrap}
  .ia-list{margin:.4rem 0}
  .ia-list b{font-size:.8rem}
  .ia-list ul{margin:.2rem 0 0 1.1rem}
  .ia-list--ok b{color:var(--green)} .ia-list--miss b{color:var(--partial)} .ia-list--ko b{color:var(--wrong)}
  .ia-tip{margin-top:.6rem!important;padding-top:.6rem;border-top:1px dashed #a9c0f0}
  .ia-syn{font-size:.9rem;line-height:1.6;margin-bottom:.8rem;opacity:.95}
  .ia-wait{display:flex;gap:1rem;align-items:center;font-size:.92rem;line-height:1.5}
  .ia-spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;animation:iaspin .9s linear infinite;flex-shrink:0}
  @keyframes iaspin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.ia-spin{animation:none}}`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();
