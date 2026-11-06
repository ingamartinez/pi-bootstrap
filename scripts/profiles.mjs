// Matriz de perfiles de modelos: única fuente de verdad.
// Genera config/profiles/<id>.json y, en runtime, subagents.json / profiles.json / web-search.json.
//
// Regla de independencia: quien produce no debe ser quien verifica.
//   cross-provider → verificación y jueces en otra familia
//   same-family    → todo en una familia; apto para trabajo diario, no para gates críticos

const DEEPSEEK_PRO = "deepseek/deepseek-v4-pro";
const DEEPSEEK_FLASH = "deepseek/deepseek-flash";

const CLAUDE_SONNET = "claude-bridge/claude-sonnet-5-5";
const CLAUDE_OPUS = "claude-bridge/claude-opus-5-5";
const CLAUDE_HAIKU = "claude-bridge/claude-haiku-5-5";

const OA_SOL = "openai/gpt-6.1-sol";
const OA_SOL6 = "openai/gpt-6-sol";
const OA_ASTRA = "openai/gpt-6-astra";
const OA_MINI = "openai/gpt-5.4-mini";
const OA_LUNA = "openai/gpt-6-luna";

// Eje DeepSeek: por dónde se enrutan esos roles. La matriz no se duplica: se reescribe el proveedor.
//   deepseek    → API directa (DEEPSEEK_API_KEY)
//   opencode-go → catálogo de opencode-go (OPENCODE_API_KEY)
//   none        → ningún perfil que requiera DeepSeek queda disponible
// Los ids NO son isomorfos: el flash directo es `deepseek-flash`, el de opencode-go es `deepseek-v4.1-flash`.
export const DEEPSEEK_ROUTES = ["deepseek", "opencode-go", "none"];

const DEEPSEEK_MODEL_IDS = {
  deepseek: { pro: "deepseek/deepseek-v4-pro", flash: "deepseek/deepseek-flash" },
  "opencode-go": { pro: "opencode-go/deepseek-v4-pro", flash: "opencode-go/deepseek-v4.1-flash" },
};

// Modelo directo → qué variante del catálogo de opencode-go le corresponde.
const DEEPSEEK_MODEL_KIND = {
  [DEEPSEEK_MODEL_IDS.deepseek.pro]: "pro",
  [DEEPSEEK_MODEL_IDS.deepseek.flash]: "flash",
};

export function routeDeepseek(route = "deepseek") {
  if (!DEEPSEEK_ROUTES.includes(route)) {
    throw new Error(`ruta de DeepSeek desconocida: ${route} (usa: ${DEEPSEEK_ROUTES.join(", ")})`);
  }
  return route;
}

/** ¿Este perfil se puede montar con esta ruta? */
export function profileFitsRoute(profile, route = "deepseek") {
  routeDeepseek(route);
  if (route !== "none") return true;
  return !profile.requires.includes("deepseek");
}

/** Perfiles ofrecibles para una ruta, en el orden de la matriz. */
export function profilesForRoute(route = "deepseek") {
  return PROFILES.filter((p) => profileFitsRoute(p, route));
}

/**
 * Devuelve el perfil con sus modelos DeepSeek enrutados y su `requires` ajustado.
 * `deepseek` es la ruta por defecto: sin perfil enrutado el resultado es el perfil tal cual.
 */
export function profileForRoute(profile, route = "deepseek") {
  routeDeepseek(route);
  if (!profileFitsRoute(profile, route)) {
    throw new Error(`el perfil ${profile.id} requiere DeepSeek y la ruta elegida es 'none'`);
  }
  if (route === "deepseek" || !profile.requires.includes("deepseek")) return profile;

  const ids = DEEPSEEK_MODEL_IDS[route];
  const roles = Object.fromEntries(
    Object.entries(profile.roles).map(([name, role]) => {
      const kind = DEEPSEEK_MODEL_KIND[role.model];
      return [name, kind ? { ...role, model: ids[kind] } : role];
    }),
  );
  const requires = profile.requires.map((p) => (p === "deepseek" ? route : p));
  return { ...profile, roles, requires };
}

/** Los 13 roles del harness. `orchestrator` no tiene .md; refuter/validator no van en subagents.json. */
export const ROLES = [
  "orchestrator",
  "gentle-ai-explore",
  "gentle-ai-worker",
  "gentle-ai-verify",
  "review-readability",
  "review-resilience",
  "review-reliability",
  "review-risk",
  "review-refuter",
  "review-validator",
  "jd-judge-a",
  "jd-judge-b",
  "jd-fix-agent",
];

/** Roles que sí aparecen en ~/.pi/agent/subagents.json (los que tienen agente en disco). */
export const SUBAGENT_ROLES = ROLES.filter(
  (r) => r !== "orchestrator" && r !== "review-refuter" && r !== "review-validator",
);

const role = (model, thinking = "high") => ({ model, thinking });

function tiers(volume, mid, top) {
  return {
    orchestrator: role(mid),
    "gentle-ai-explore": role(volume, "low"),
    "gentle-ai-worker": role(mid),
    "gentle-ai-verify": role(top),
    "review-readability": role(volume),
    "review-resilience": role(volume),
    "review-reliability": role(volume),
    "review-risk": role(top),
    "review-refuter": role(top),
    "review-validator": role(mid),
    "jd-judge-a": role(top),
    "jd-judge-b": role(mid),
    "jd-fix-agent": role(mid),
  };
}

export const PROFILES = [
  {
    id: "hybrid-claude",
    label: "DeepSeek produce · Claude verifica",
    requires: ["deepseek", "claude"],
    independence: "cross-provider",
    roles: {
      ...tiers(DEEPSEEK_FLASH, DEEPSEEK_PRO, CLAUDE_OPUS),
      "gentle-ai-verify": role(CLAUDE_SONNET),
      "review-validator": role(CLAUDE_SONNET),
      // segunda opinión de otra familia: el juez B no comparte proveedor con el A
      "jd-judge-b": role(DEEPSEEK_PRO),
    },
    settings: { defaultProvider: "deepseek", defaultModel: "deepseek-v4-pro", defaultThinkingLevel: "high" },
    webSearch: null,
    notes: [
      "DeepSeek necesita DEEPSEEK_API_KEY propia (el modelo deepseek-v4.1-flash sólo existe en opencode-go).",
      "Claude consume cuota de subscripción vía Claude Code, no facturación por API.",
    ],
  },
  {
    id: "hybrid-openai",
    label: "DeepSeek produce · OpenAI verifica",
    requires: ["deepseek", "openai"],
    independence: "cross-provider",
    roles: {
      ...tiers(DEEPSEEK_FLASH, DEEPSEEK_PRO, OA_SOL),
      "gentle-ai-verify": role(OA_SOL6),
      "review-validator": role(OA_SOL6),
      "jd-judge-b": role(DEEPSEEK_PRO),
    },
    settings: { defaultProvider: "deepseek", defaultModel: "deepseek-v4-pro", defaultThinkingLevel: "high" },
    webSearch: { provider: "openai", model: "gpt-6-luna" },
    notes: ["DeepSeek necesita DEEPSEEK_API_KEY propia.", "OpenAI se autentica con /login dentro de pi."],
  },
  {
    // "híbrido" acá significa: quien produce no es quien verifica, y son familias distintas.
    // El nombre se lee `<productor>-<verificador>`.
    id: "claude-produces-openai-verifies",
    label: "Claude produce · OpenAI verifica",
    requires: ["claude", "openai"],
    independence: "cross-provider",
    roles: {
      ...tiers(CLAUDE_HAIKU, CLAUDE_SONNET, OA_SOL),
      "review-validator": role(OA_SOL6),
      "jd-judge-b": role(CLAUDE_OPUS),
    },
    settings: { defaultProvider: "claude-bridge", defaultModel: "claude-sonnet-5-5", defaultThinkingLevel: "high" },
    webSearch: { provider: "openai", model: "gpt-6-luna" },
    notes: [
      "Requiere el binario `claude` logueado (plan Pro/Max) y OpenAI con /login en pi.",
      "Produce con Claude y verifica con OpenAI: el gate de revisión no comparte familia.",
    ],
  },
  {
    id: "openai-produces-claude-verifies",
    label: "OpenAI produce · Claude verifica",
    requires: ["claude", "openai"],
    independence: "cross-provider",
    roles: {
      ...tiers(OA_MINI, OA_SOL6, CLAUDE_OPUS),
      "gentle-ai-verify": role(CLAUDE_SONNET),
      "review-validator": role(CLAUDE_SONNET),
      "jd-judge-b": role(OA_SOL),
      "jd-fix-agent": role(OA_LUNA),
    },
    settings: { defaultProvider: "openai", defaultModel: "gpt-6.1-sol", defaultThinkingLevel: "high" },
    webSearch: { provider: "openai", model: "gpt-6-luna" },
    notes: [
      "Espejo del anterior: mismo par de proveedores, roles invertidos.",
      "OpenAI hace volumen y Claude aporta la segunda opinión (riesgo, jueces).",
    ],
  },
  {
    id: "full-deepseek-claude-openai",
    label: "DeepSeek volumen · Claude verifica · OpenAI riesgo/jueces",
    requires: ["deepseek", "claude", "openai"],
    independence: "cross-provider",
    roles: {
      ...tiers(DEEPSEEK_FLASH, DEEPSEEK_PRO, OA_SOL),
      "gentle-ai-worker": role(DEEPSEEK_FLASH),
      "gentle-ai-verify": role(CLAUDE_SONNET),
      "review-validator": role(CLAUDE_SONNET),
      "jd-judge-b": role(CLAUDE_OPUS),
    },
    settings: { defaultProvider: "deepseek", defaultModel: "deepseek-v4-pro", defaultThinkingLevel: "high" },
    webSearch: { provider: "openai", model: "gpt-6-luna" },
    notes: [
      "Los tres proveedores: DeepSeek para volumen, Claude para verificar, OpenAI para riesgo y jueces.",
      "Aunque se llame 'full', es cross-provider: por eso sirve para gates críticos.",
    ],
  },
  {
    id: "full-claude",
    label: "Todo Claude (misma familia)",
    requires: ["claude"],
    independence: "same-family",
    roles: {
      ...tiers(CLAUDE_HAIKU, CLAUDE_SONNET, CLAUDE_OPUS),
      "review-validator": role(CLAUDE_SONNET),
      "jd-judge-b": role(CLAUDE_SONNET),
    },
    settings: { defaultProvider: "claude-bridge", defaultModel: "claude-sonnet-5-5", defaultThinkingLevel: "high" },
    webSearch: null,
    notes: [
      "Requiere el binario `claude` instalado y logueado con plan Pro/Max.",
      "Verifica con la misma familia que produce: no apto para gates críticos.",
    ],
  },
  {
    id: "full-openai",
    label: "Todo OpenAI (misma familia)",
    requires: ["openai"],
    independence: "same-family",
    roles: {
      ...tiers(OA_MINI, OA_SOL6, OA_SOL),
      "review-validator": role(OA_SOL6),
      "jd-judge-b": role(OA_SOL6),
      "jd-fix-agent": role(OA_LUNA),
      "review-refuter": role(OA_ASTRA),
      "jd-judge-a": role(OA_ASTRA),
    },
    settings: { defaultProvider: "openai", defaultModel: "gpt-6.1-sol", defaultThinkingLevel: "high" },
    webSearch: { provider: "openai", model: "gpt-6-luna" },
    notes: ["Verifica con la misma familia que produce: no apto para gates críticos."],
  },
  {
    id: "full-deepseek",
    label: "Todo DeepSeek (misma familia, barato)",
    requires: ["deepseek"],
    independence: "same-family",
    roles: {
      ...tiers(DEEPSEEK_FLASH, DEEPSEEK_PRO, DEEPSEEK_PRO),
      "jd-fix-agent": role(DEEPSEEK_FLASH),
    },
    settings: { defaultProvider: "deepseek", defaultModel: "deepseek-v4-pro", defaultThinkingLevel: "high" },
    webSearch: null,
    notes: [
      "El perfil más barato; útil para probar el harness completo con una sola key.",
      "Sin búsqueda web integrada (deepseek no expone modelo de búsqueda).",
    ],
  },
];

export function getProfile(id) {
  const found = PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`perfil desconocido: ${id}`);
  const missing = ROLES.filter((r) => !found.roles[r]);
  if (missing.length) throw new Error(`perfil ${id} sin rol(es): ${missing.join(", ")}`);
  const extra = Object.keys(found.roles).filter((r) => !ROLES.includes(r));
  if (extra.length) throw new Error(`perfil ${id} con rol(es) desconocido(s): ${extra.join(", ")}`);
  return found;
}
