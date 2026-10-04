// ═══════════════════════════════════════════════════════════════
// RELAIS CLOUDFLARE WORKER — Simulations BTS NDRC
// Reçoit les requêtes des pages de la plateforme, ajoute la clé API
// (stockée en secret, jamais visible) et relaie vers Anthropic.
// ═══════════════════════════════════════════════════════════════

// 1. Seuls ces sites ont le droit d'utiliser le relais
const ALLOWED_ORIGINS = [
  "https://infocomluc-svg.github.io",              // plateforme GitHub Pages
  "https://chatbot-btsndrc-client.neocities.org",  // ancienne version Neocities
];

// 2. Modèles imposés côté serveur
//    - dialogue   : rapide et économique, pour jouer le client et le conseiller modèle
//    - evaluation : plus fin, pour le bilan (un seul appel par simulation)
const MODELS = {
  dialogue: "claude-haiku-4-5-20251001",
  evaluation: "claude-sonnet-5-5",
};

// 3. Plafonds de longueur de réponse
const MAX_TOKENS = { dialogue: 500, evaluation: 4000 };

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origine non autorisée", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ error: { message: "Méthode non autorisée" } }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Requête illisible" } }, 400, origin);
    }

    const purpose = body.purpose === "evaluation" ? "evaluation" : "dialogue";
    const payload = {
      model: MODELS[purpose],
      max_tokens: Math.min(Number(body.max_tokens) || 400, MAX_TOKENS[purpose]),
      system: body.system,
      messages: body.messages,
    };

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY, // secret défini dans Cloudflare
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
