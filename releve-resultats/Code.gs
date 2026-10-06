/* ═══════════════════════════════════════════════════════════════
   RELEVÉ DES RÉSULTATS — Simulations relation client BTS NDRC
   À coller dans un tableur Google : Extensions > Apps Script.
   1. Reçoit le bilan de chaque simulation et l'ajoute au tableur.
   2. Tient à jour l'onglet « Synthèse » : étoiles de chaque étudiant
      (meilleure tentative par scénario) et note globale sur 20.
   3. Envoie chaque soir un récapitulatif par e-mail au formateur.
   ═══════════════════════════════════════════════════════════════ */

// ── RÉGLAGES (modifiables)
const CONFIG = {
  EMAIL: "",               // vide = l'adresse Google du propriétaire du tableur
  HEURE_RECAP: 18,         // heure d'envoi du récapitulatif quotidien (0 à 23)
  FUSEAU: "Europe/Paris",
  BILANS_PAR_EMAIL: 40,    // au-delà, le récapitulatif est découpé en plusieurs e-mails
  NB_SCENARIOS: 5,         // 4 étoiles maximum par scénario : 5 scénarios = 20 étoiles = note sur 20
};

const ONGLET = "Résultats";
const COLONNES = [
  "Reçu le", "Identifiant", "Étudiant", "Scénario", "Note /20", "Mention",
  "Précision et exactitude /5", "Vocabulaire professionnel /5", "Solutions et argumentation /5", "Relation client /5",
  "Verdict", "Humeur finale du client", "Appréciation", "Ce qui est satisfaisant", "Ce qui ne l'est pas",
  "Pistes d'amélioration", "Conseil prioritaire", "Réplique par réplique", "Conversation complète", "Envoyé par e-mail le",
  "Étoiles /4",
];
const ONGLET_SYNTHESE = "Synthèse";
// Barème : 0-5 → 1 étoile, 6-10 → 2, 11-15 → 3, 16-20 → 4
const etoiles_ = (note) => (note <= 5 ? 1 : note <= 10 ? 2 : note <= 15 ? 3 : 4);
const dessin_ = (n) => "★".repeat(n) + "☆".repeat(4 - n);
const COL = Object.fromEntries(COLONNES.map((nom, i) => [nom, i + 1]));

// ── Menu du tableur
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Simulations")
    .addItem("Installer le relevé", "installer")
    .addItem("Envoyer le récapitulatif maintenant", "envoyerRecapitulatifManuel")
    .addItem("Recalculer la synthèse", "majSynthese")
    .addToUi();
}

function installer() {
  feuille_();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "envoyerRecapitulatif")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("envoyerRecapitulatif")
    .timeBased().everyDays(1).atHour(CONFIG.HEURE_RECAP).inTimezone(CONFIG.FUSEAU).create();
  SpreadsheetApp.getUi().alert(
    "Relevé installé",
    `Les bilans de vos étudiants s'ajouteront à l'onglet « ${ONGLET} ».\n` +
    `Un récapitulatif vous sera envoyé chaque jour vers ${CONFIG.HEURE_RECAP} h à ${destinataire_()}, s'il y a de nouveaux bilans.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ── Réception d'un bilan (appelé par les pages de simulation)
function doPost(e) {
  const verrou = LockService.getScriptLock();
  try {
    verrou.waitLock(20000);
    const d = JSON.parse(e.postData.contents);
    verifier_(d);
    const sh = feuille_();
    const deja = sh.getRange(1, COL["Identifiant"], Math.max(sh.getLastRow(), 1), 1)
      .createTextFinder(d.id).matchEntireCell(true).findNext();
    if (deja) return json_({ ok: true, doublon: true });

    // Les 4 critères sont rangés dans l'ordre de la grille (colonnes G à J).
    const crit = (i) => {
      const c = (d.criteres || [])[i];
      return c ? Number(c.note) : "";
    };
    const ligne = [
      new Date(),
      d.id,
      d.etudiant,
      `S${d.scenario.num} : ${d.scenario.titre}`,
      Number(d.note),
      d.mention || "",
      crit(0), crit(1), crit(2), crit(3),
      d.verdict || "",
      d.humeur_finale || "",
      d.appreciation || "",
      puces_(d.satisfaisant),
      puces_(d.insatisfaisant),
      puces_((d.pistes || []).map((p) => p.exemple ? `${p.action} : « ${p.exemple} »` : p.action)),
      d.conseil || "",
      (d.repliques || []).map((r) =>
        `R${r.n} (${r.statut}) : ${r.texte}` +
        (r.commentaire ? `\n   → ${r.commentaire}` : "") +
        (r.suggestion && r.statut !== "Efficace" ? `\n   Mieux : ${r.suggestion}` : "")).join("\n\n"),
      d.transcription || "",
      "",
      Number(d.etoiles) || etoiles_(Number(d.note)),
    ].map(cellule_);
    sh.appendRow(ligne);
    majSynthese();
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, erreur: String(err && err.message || err) });
  } finally {
    verrou.releaseLock();
  }
}

// Permet de vérifier que le relevé est en ligne en ouvrant son adresse dans un navigateur.
function doGet() {
  return json_({ ok: true, service: "Relevé des simulations BTS NDRC" });
}

// ── Synthèse : meilleure tentative de chaque étudiant sur chaque scénario
function lireSynthese_() {
  const sh = feuille_();
  const n = sh.getLastRow() - 1;
  const parEtudiant = {};
  if (n < 1) return parEtudiant;
  sh.getRange(2, 1, n, COLONNES.length).getValues().forEach((v) => {
    const qui = String(v[COL["Étudiant"] - 1]).replace(/^'/, "");
    const m = String(v[COL["Scénario"] - 1]).match(/^S(\d+)/);
    if (!qui || !m) return;
    const note = Number(v[COL["Note /20"] - 1]);
    const et = Number(v[COL["Étoiles /4"] - 1]) || etoiles_(note);
    const e = parEtudiant[qui] || (parEtudiant[qui] = { etoiles: {}, tentatives: 0, derniere: null });
    e.etoiles[m[1]] = Math.max(e.etoiles[m[1]] || 0, et);
    e.tentatives++;
    const date = v[COL["Reçu le"] - 1];
    if (date instanceof Date && (!e.derniere || date > e.derniere)) e.derniere = date;
  });
  Object.values(parEtudiant).forEach((e) => {
    e.faits = Object.keys(e.etoiles).length;
    e.total = Object.values(e.etoiles).reduce((a, b) => a + b, 0);
    e.noteGlobale = e.faits >= CONFIG.NB_SCENARIOS ? e.total : null;
  });
  return parEtudiant;
}

function majSynthese() {
  const data = lireSynthese_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ONGLET_SYNTHESE) || ss.insertSheet(ONGLET_SYNTHESE, 1);
  const scen = Array.from({ length: CONFIG.NB_SCENARIOS }, (_, i) => `S${i + 1}`);
  const entete = ["Étudiant", ...scen, "Scénarios faits", "Étoiles cumulées", "Note globale /20", "Tentatives", "Dernière simulation"];
  const lignes = Object.keys(data).sort((a, b) => a.localeCompare(b, "fr")).map((qui) => {
    const e = data[qui];
    return [qui, ...scen.map((s) => (e.etoiles[s.slice(1)] ? dessin_(e.etoiles[s.slice(1)]) : "")),
      `${e.faits}/${CONFIG.NB_SCENARIOS}`, e.total, e.noteGlobale == null ? "en cours" : e.noteGlobale, e.tentatives, e.derniere || ""];
  });
  sh.clear();
  sh.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight("bold").setBackground("#E6F0FF");
  if (lignes.length) {
    sh.getRange(2, 1, lignes.length, entete.length).setValues(lignes);
    sh.getRange(2, 2, lignes.length, scen.length).setFontColor("#E59A00");
    sh.getRange(2, entete.length, lignes.length, 1).setNumberFormat("dd/MM/yyyy HH:mm");
  }
  sh.setFrozenRows(1);
  return data;
}

// ── Récapitulatif par e-mail
function envoyerRecapitulatifManuel() {
  const n = envoyerRecapitulatif();
  SpreadsheetApp.getUi().alert(n ? `Récapitulatif envoyé : ${n} bilan(s), à ${destinataire_()}.` : "Aucun nouveau bilan depuis le dernier récapitulatif.");
}

function envoyerRecapitulatif() {
  const sh = feuille_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const valeurs = sh.getRange(2, 1, n, COLONNES.length).getValues();
  const nouveaux = valeurs
    .map((v, i) => ({ v, ligne: i + 2 }))
    .filter((x) => !x.v[COL["Envoyé par e-mail le"] - 1]);
  if (!nouveaux.length) return 0;

  const url = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const jour = Utilities.formatDate(new Date(), CONFIG.FUSEAU, "dd/MM/yyyy");
  for (let i = 0; i < nouveaux.length; i += CONFIG.BILANS_PAR_EMAIL) {
    const lot = nouveaux.slice(i, i + CONFIG.BILANS_PAR_EMAIL);
    const partie = nouveaux.length > CONFIG.BILANS_PAR_EMAIL ? ` (partie ${i / CONFIG.BILANS_PAR_EMAIL + 1})` : "";
    MailApp.sendEmail({
      to: destinataire_(),
      subject: `Simulations clients : ${lot.length} bilan(s) au ${jour}${partie}`,
      htmlBody: courriel_(lot.map((x) => x.v), url, lireSynthese_()),
      name: "Simulations BTS NDRC",
    });
    const quand = new Date();
    lot.forEach((x) => sh.getRange(x.ligne, COL["Envoyé par e-mail le"]).setValue(quand));
  }
  return nouveaux.length;
}

function courriel_(lignes, url, synthese) {
  const g = (v, nom) => v[COL[nom] - 1];
  const h = (t) => String(t == null ? "" : t).replace(/^'/, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const heure = (d) => d instanceof Date ? Utilities.formatDate(d, CONFIG.FUSEAU, "dd/MM HH:mm") : "";
  const et = (v) => Number(g(v, "Étoiles /4")) || etoiles_(Number(g(v, "Note /20")));
  const or = (n) => `<span style="color:#E59A00;font-size:17px;letter-spacing:1px">${"★".repeat(n)}</span><span style="color:#C9D6EE;font-size:17px;letter-spacing:1px">${"★".repeat(4 - n)}</span>`;
  const moyenne = lignes.reduce((s, v) => s + et(v), 0) / lignes.length;
  const qui = [...new Set(lignes.map((v) => String(g(v, "Étudiant")).replace(/^'/, "")))];

  const tableau = lignes.map((v) => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7"><b>${h(g(v, "Étudiant"))}</b></td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7">${h(g(v, "Scénario"))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;white-space:nowrap">${or(et(v))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7">${h(g(v, "Verdict"))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;color:#46587F">${heure(g(v, "Reçu le"))}</td></tr>`).join("");

  const fiches = lignes.map((v) => `
    <div style="border:1px solid #D5E2F7;border-radius:14px;padding:18px 20px;margin:0 0 16px">
      <p style="margin:0 0 4px;font-size:17px"><b>${h(g(v, "Étudiant"))}</b>, ${h(g(v, "Scénario"))}</p>
      <p style="margin:0 0 12px">${or(et(v))} <b>${h(g(v, "Mention"))}</b> (${h(g(v, "Note /20"))}/20). ${h(g(v, "Verdict"))}, client ${h(String(g(v, "Humeur finale du client")).toLowerCase())} en fin d'échange.</p>
      <p style="margin:0 0 12px;color:#46587F">${COLONNES.slice(COL["Note /20"] + 1, COL["Note /20"] + 5).map((nom) => `${h(nom.replace(" /5", ""))} ${h(g(v, nom))}/5`).join(", ")}.</p>
      <p style="margin:0 0 12px"><i>${h(g(v, "Appréciation"))}</i></p>
      <p style="margin:0 0 4px;color:#0B8A5F"><b>Ce qui est satisfaisant</b></p><p style="margin:0 0 12px">${h(g(v, "Ce qui est satisfaisant"))}</p>
      <p style="margin:0 0 4px;color:#C8234A"><b>Ce qui ne l'est pas</b></p><p style="margin:0 0 12px">${h(g(v, "Ce qui ne l'est pas"))}</p>
      <p style="margin:0 0 4px;color:#13306E"><b>Conseil prioritaire</b></p><p style="margin:0">${h(g(v, "Conseil prioritaire"))}</p>
    </div>`).join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1F4D;max-width:760px;line-height:1.5">
    <h2 style="margin:0 0 6px">Simulations relation client</h2>
    <p style="margin:0 0 18px;color:#46587F">${lignes.length} nouveau(x) bilan(s), ${moyenne.toFixed(1).replace(".", ",")} étoile(s) en moyenne sur 4.
      Le détail réplique par réplique et les conversations complètes sont dans <a href="${url}" style="color:#1F4FFF">votre tableur de résultats</a>.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 24px">
      <tr style="background:#E6F0FF;text-align:left"><th style="padding:8px 10px">Étudiant</th><th style="padding:8px 10px">Scénario</th><th style="padding:8px 10px">Étoiles</th><th style="padding:8px 10px">Verdict</th><th style="padding:8px 10px">Reçu le</th></tr>
      ${tableau}
    </table>
    <h3 style="margin:0 0 8px">Progression des étudiants concernés</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 24px">
      <tr style="background:#E6F0FF;text-align:left"><th style="padding:8px 10px">Étudiant</th><th style="padding:8px 10px">Scénarios faits</th><th style="padding:8px 10px">Étoiles cumulées</th><th style="padding:8px 10px">Note globale</th></tr>
      ${qui.filter((q) => synthese[q]).map((q) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7"><b>${h(q)}</b></td>
        <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7">${synthese[q].faits}/${CONFIG.NB_SCENARIOS}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;color:#E59A00;font-weight:700">${synthese[q].total} ★</td>
        <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;font-weight:700">${synthese[q].noteGlobale == null ? "en cours" : synthese[q].noteGlobale + "/20"}</td></tr>`).join("")}
    </table>
    ${fiches}
  </div>`;
}

// ── Outils
function feuille_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ONGLET);
  if (!sh) sh = ss.insertSheet(ONGLET, 0);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLONNES);
    sh.getRange(1, 1, 1, COLONNES.length).setFontWeight("bold").setBackground("#E6F0FF").setWrap(true);
    sh.setFrozenRows(1);
    sh.setColumnWidth(COL["Identifiant"], 60);
    sh.hideColumns(COL["Identifiant"]);
    sh.getRange(2, COL["Reçu le"], 999, 1).setNumberFormat("dd/MM/yyyy HH:mm");
    sh.getRange(2, COL["Envoyé par e-mail le"], 999, 1).setNumberFormat("dd/MM/yyyy HH:mm");
  } else {
    // Tableur créé avec une version précédente : en-tête mis à jour (colonnes ajoutées, critères renommés).
    const actuel = sh.getRange(1, 1, 1, COLONNES.length).getValues()[0];
    if (COLONNES.some((nom, i) => actuel[i] !== nom)) {
      sh.getRange(1, 1, 1, COLONNES.length).setValues([COLONNES]).setFontWeight("bold").setBackground("#E6F0FF");
    }
  }
  return sh;
}

function verifier_(d) {
  const ok = d && typeof d.id === "string" && d.id.length <= 64 &&
    typeof d.etudiant === "string" && d.etudiant.length >= 3 && d.etudiant.length <= 40 &&
    d.scenario && typeof d.scenario.titre === "string" &&
    Number(d.note) >= 0 && Number(d.note) <= 20;
  if (!ok) throw new Error("Bilan incomplet ou invalide");
}

function destinataire_() {
  return CONFIG.EMAIL || Session.getEffectiveUser().getEmail();
}

function puces_(liste) {
  return (liste || []).filter(Boolean).map((x) => `• ${x}`).join("\n");
}

// Protège le tableur : un texte commençant par = + - @ serait lu comme une formule.
function cellule_(v) {
  if (typeof v !== "string") return v;
  const t = v.slice(0, 49000);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
