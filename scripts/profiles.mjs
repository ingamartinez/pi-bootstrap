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
    label: "Híbrido — DeepSeek para volumen, Claude para verificar",
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
    label: "Híbrido — DeepSeek para volumen, OpenAI para verificar",
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
    id: "full-claude",
    label: "Todo Claude (vía Claude Code / claude-bridge)",
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
    label: "Todo OpenAI",
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
    label: "Todo DeepSeek (onboarding barato)",
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
