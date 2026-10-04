/* ═══════════════════════════════════════════════════════════════
   RELEVÉ DES RÉSULTATS — Simulations relation client BTS NDRC
   À coller dans un tableur Google : Extensions > Apps Script.
   1. Reçoit le bilan de chaque simulation et l'ajoute au tableur.
   2. Envoie chaque soir un récapitulatif par e-mail au formateur.
   ═══════════════════════════════════════════════════════════════ */

// ── RÉGLAGES (modifiables)
const CONFIG = {
  EMAIL: "",               // vide = l'adresse Google du propriétaire du tableur
  HEURE_RECAP: 18,         // heure d'envoi du récapitulatif quotidien (0 à 23)
  FUSEAU: "Europe/Paris",
  BILANS_PAR_EMAIL: 40,    // au-delà, le récapitulatif est découpé en plusieurs e-mails
};

const ONGLET = "Résultats";
const COLONNES = [
  "Reçu le", "Identifiant", "Étudiant", "Scénario", "Note /20", "Mention",
  "Écoute et empathie /5", "Professionnalisme /5", "Solutions et argumentation /5", "Fidélisation /5",
  "Verdict", "Humeur finale du client", "Appréciation", "Ce qui est satisfaisant", "Ce qui ne l'est pas",
  "Pistes d'amélioration", "Conseil prioritaire", "Réplique par réplique", "Conversation complète", "Envoyé par e-mail le",
];
const COL = Object.fromEntries(COLONNES.map((nom, i) => [nom, i + 1]));

// ── Menu du tableur
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Simulations")
    .addItem("Installer le relevé", "installer")
    .addItem("Envoyer le récapitulatif maintenant", "envoyerRecapitulatifManuel")
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

    const crit = (nom) => {
      const c = (d.criteres || []).find((x) => String(x.nom || "").indexOf(nom) === 0);
      return c ? Number(c.note) : "";
    };
    const ligne = [
      new Date(),
      d.id,
      d.etudiant,
      `S${d.scenario.num} : ${d.scenario.titre}`,
      Number(d.note),
      d.mention || "",
      crit("Écoute"), crit("Professionnalisme"), crit("Solutions"), crit("Fidélisation"),
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
    ].map(cellule_);
    sh.appendRow(ligne);
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
      htmlBody: courriel_(lot.map((x) => x.v), url),
      name: "Simulations BTS NDRC",
    });
    const quand = new Date();
    lot.forEach((x) => sh.getRange(x.ligne, COL["Envoyé par e-mail le"]).setValue(quand));
  }
  return nouveaux.length;
}

function courriel_(lignes, url) {
  const g = (v, nom) => v[COL[nom] - 1];
  const h = (t) => String(t == null ? "" : t).replace(/^'/, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const heure = (d) => d instanceof Date ? Utilities.formatDate(d, CONFIG.FUSEAU, "dd/MM HH:mm") : "";
  const couleur = (note) => note >= 14 ? "#0B8A5F" : note >= 10 ? "#1F4FFF" : "#C8234A";
  const moyenne = lignes.reduce((s, v) => s + Number(g(v, "Note /20") || 0), 0) / lignes.length;

  const tableau = lignes.map((v) => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7"><b>${h(g(v, "Étudiant"))}</b></td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7">${h(g(v, "Scénario"))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;text-align:center;color:${couleur(g(v, "Note /20"))};font-weight:700">${h(g(v, "Note /20"))}/20</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7">${h(g(v, "Verdict"))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D5E2F7;color:#46587F">${heure(g(v, "Reçu le"))}</td></tr>`).join("");

  const fiches = lignes.map((v) => `
    <div style="border:1px solid #D5E2F7;border-radius:14px;padding:18px 20px;margin:0 0 16px">
      <p style="margin:0 0 4px;font-size:17px"><b>${h(g(v, "Étudiant"))}</b>, ${h(g(v, "Scénario"))}</p>
      <p style="margin:0 0 12px;color:${couleur(g(v, "Note /20"))};font-weight:700">${h(g(v, "Note /20"))}/20, ${h(g(v, "Mention"))}. ${h(g(v, "Verdict"))}, client ${h(String(g(v, "Humeur finale du client")).toLowerCase())} en fin d'échange.</p>
      <p style="margin:0 0 12px;color:#46587F">Écoute ${h(g(v, "Écoute et empathie /5"))}/5, professionnalisme ${h(g(v, "Professionnalisme /5"))}/5, solutions ${h(g(v, "Solutions et argumentation /5"))}/5, fidélisation ${h(g(v, "Fidélisation /5"))}/5.</p>
      <p style="margin:0 0 12px"><i>${h(g(v, "Appréciation"))}</i></p>
      <p style="margin:0 0 4px;color:#0B8A5F"><b>Ce qui est satisfaisant</b></p><p style="margin:0 0 12px">${h(g(v, "Ce qui est satisfaisant"))}</p>
      <p style="margin:0 0 4px;color:#C8234A"><b>Ce qui ne l'est pas</b></p><p style="margin:0 0 12px">${h(g(v, "Ce qui ne l'est pas"))}</p>
      <p style="margin:0 0 4px;color:#13306E"><b>Conseil prioritaire</b></p><p style="margin:0">${h(g(v, "Conseil prioritaire"))}</p>
    </div>`).join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1F4D;max-width:760px;line-height:1.5">
    <h2 style="margin:0 0 6px">Simulations relation client</h2>
    <p style="margin:0 0 18px;color:#46587F">${lignes.length} nouveau(x) bilan(s), note moyenne ${moyenne.toFixed(1).replace(".", ",")}/20.
      Le détail réplique par réplique et les conversations complètes sont dans <a href="${url}" style="color:#1F4FFF">votre tableur de résultats</a>.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 24px">
      <tr style="background:#E6F0FF;text-align:left"><th style="padding:8px 10px">Étudiant</th><th style="padding:8px 10px">Scénario</th><th style="padding:8px 10px">Note</th><th style="padding:8px 10px">Verdict</th><th style="padding:8px 10px">Reçu le</th></tr>
      ${tableau}
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
