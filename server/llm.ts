import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "gemini" | "mistral" | "xai" | "meta";
  apiKey: string;
  model?: string; // optional override
  // BYOK spend tracking: when set, each callLLM invocation will accumulate
  // an estimated cost on this user's running monthly counter. Skipped for
  // platform-keyed calls (no userId on those configs). See server/storage.
  userId?: number;
  isByok?: boolean; // true if the apiKey is the user's own (not platform's)
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---- Operation tiers: what model quality each operation needs ----
export type LLMOperation = 
  | "scan"            // Page scanning — high volume, cheap
  | "classify"        // Section classification — cheap
  | "variant"         // Variant generation — needs quality
  | "observation"     // Daily insights — mid quality
  | "chat"            // Brain Chat — mid quality
  | "autopilot"       // Autopilot decisions — needs quality
  | "autopilot_learn" // Autopilot learnings — mid quality
  | "counsel"         // Council deliberation — premium
  | "default";        // Fallback

// Model tiers: fast (cheapest), balanced, quality (most expensive)
const PLATFORM_MODELS: Record<"fast" | "balanced" | "quality", { provider: "anthropic"; model: string }> = {
  fast:     { provider: "anthropic", model: "claude-haiku-4-5-20251001" },  // Haiku 4.5 — fast + cheap
  balanced: { provider: "anthropic", model: "claude-sonnet-4-20250514" },   // Sonnet 4 — balanced
  quality:  { provider: "anthropic", model: "claude-sonnet-4-20250514" },   // Sonnet 4 — quality
};

// Map each operation to a model tier
const OPERATION_TIERS: Record<LLMOperation, "fast" | "balanced" | "quality"> = {
  scan:            "fast",
  classify:        "fast",
  variant:         "balanced",
  observation:     "fast",
  chat:            "fast",
  autopilot:       "balanced",
  autopilot_learn: "fast",
  counsel:         "quality",
  default:         "fast",
};

// Approximate credit costs per operation (used for UI display, not billing)
export const OPERATION_CREDIT_COSTS: Record<LLMOperation, number> = {
  scan: 1,
  classify: 1,
  variant: 2,
  observation: 1,
  chat: 1,
  autopilot: 2,
  autopilot_learn: 1,
  counsel: 5,
  default: 1,
};

const DEFAULT_MODELS: Record<LLMConfig["provider"], string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  mistral: "mistral-large-latest",
  xai: "grok-2",
  meta: "llama-3.1-70b-versatile",
};

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<LLMConfig["provider"], string>> = {
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  meta: "https://api.groq.com/openai/v1",
};

/**
 * Resolve the LLM config for a given operation and user.
 * Access tiers:
 * 1. Paid user -> platform key for everything + brain data
 * 2. Free user -> platform key for SCAN only (onboarding)
 *                 BYOK key for variants/classify (no brain data)
 *                 NO access to chat, counsel, autopilot, observations
 */
export function resolveLLMConfig(opts: {
  operation: LLMOperation;
  userPlan: string;
  userProvider?: string | null;
  userApiKey?: string | null;
  userModel?: string | null;
  // userId is optional for backwards compat with old call sites; when set
  // and the resolved source is "user" (BYOK), the spend reporter will
  // accumulate cost on this user's monthly counter.
  userId?: number;
}): { config: LLMConfig; useBrainData: boolean; creditCost: number; source: "user" | "platform" } {
  const { operation, userPlan, userProvider, userApiKey, userModel, userId } = opts;
  const isPaid = userPlan !== "free";
  const SUPPORTED_PROVIDERS = ["anthropic", "openai", "gemini", "mistral", "xai", "meta"];
  const providerIsSupported = SUPPORTED_PROVIDERS.includes(userProvider || "");
  const hasUserKey = !!(userProvider && userApiKey && providerIsSupported);
  const platformKey = process.env.PLATFORM_ANTHROPIC_KEY;
  const tier = OPERATION_TIERS[operation] || "fast";
  const creditCost = OPERATION_CREDIT_COSTS[operation] || 1;

  // ---------------------------------------------------------------
  // SCAN: ALWAYS uses platform key. Every user, every plan, every time.
  // This is the first check so it can never be blocked by anything else.
  // ---------------------------------------------------------------
  if (operation === "scan" && platformKey) {
    return {
      config: { provider: PLATFORM_MODELS.fast.provider, apiKey: platformKey, model: PLATFORM_MODELS.fast.model, userId, isByok: false },
      useBrainData: false,
      creditCost: isPaid ? creditCost : 0,
      source: "platform",
    };
  }

  // ---------------------------------------------------------------
  // PAID: platform key for everything, brain data included
  // ---------------------------------------------------------------
  if (isPaid && platformKey) {
    const tierConfig = PLATFORM_MODELS[tier];
    return {
      config: { provider: tierConfig.provider, apiKey: platformKey, model: tierConfig.model, userId, isByok: false },
      useBrainData: true,
      creditCost,
      source: "platform",
    };
  }

  // PAID fallback: platform key missing, use their BYOK if available
  if (isPaid && hasUserKey) {
    const FAST_OPS: LLMOperation[] = ["classify", "observation"];
    const forceFast = FAST_OPS.includes(operation);
    return {
      config: {
        provider: userProvider as LLMConfig["provider"],
        apiKey: userApiKey!,
        model: forceFast
          ? (userProvider === "anthropic" ? "claude-haiku-4-5-20251001" : userModel || undefined)
          : (userModel || undefined),
        userId,
        isByok: true,
      },
      useBrainData: true,
      creditCost,
      source: "user",
    };
  }

  // ---------------------------------------------------------------
  // FREE: restricted access
  // ---------------------------------------------------------------

  // Brain Chat, CRO Counsel, Autopilot, Observations = PAID ONLY
  const PAID_ONLY_OPS: LLMOperation[] = ["chat", "counsel", "autopilot", "autopilot_learn", "observation"];
  if (!isPaid && PAID_ONLY_OPS.includes(operation)) {
    throw new Error("UPGRADE_REQUIRED");
  }

  // BYOK for variant generation, classification, and other allowed ops
  if (!isPaid && hasUserKey) {
    return {
      config: { provider: userProvider as LLMConfig["provider"], apiKey: userApiKey!, model: userModel || undefined, userId, isByok: true },
      useBrainData: false,
      creditCost: 0,
      source: "user",
    };
  }

  // Nothing available
  throw new Error("No AI key configured. Add your own API key in Settings or upgrade to a paid plan.");
}

// Classify common LLM API errors into user-friendly messages
function classifyLLMError(err: any, provider: string): string {
  const msg = (err?.message || err?.toString() || "").toLowerCase();
  const status = err?.status || err?.statusCode || 0;

  // Credit / billing issues
  if (msg.includes("credit balance") || msg.includes("insufficient_quota") || msg.includes("billing") || 
      msg.includes("exceeded your current quota") || msg.includes("payment required") || status === 402) {
    return `Your ${provider} API key is out of credits. Please add credits at your provider's billing page.`;
  }

  // Invalid API key
  if (msg.includes("invalid api key") || msg.includes("invalid x-api-key") || msg.includes("incorrect api key") ||
      msg.includes("authentication") || msg.includes("unauthorized") || status === 401) {
    return `Your ${provider} API key is invalid or expired. Please check your key in Settings.`;
  }

  // Rate limiting
  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("overloaded") || status === 429) {
    return `${provider} rate limit reached. Please wait a moment and try again.`;
  }

  // Model not found
  if (msg.includes("model not found") || msg.includes("does not exist") || msg.includes("invalid model") || status === 404) {
    return `The AI model "${msg}" was not found. Check your model override in Settings, or remove it to use the default.`;
  }

  // Context too long
  if (msg.includes("context length") || msg.includes("too many tokens") || msg.includes("maximum")) {
    return `The page content was too long for the AI to process. Try a simpler page or contact support.`;
  }

  // Generic fallback
  return `AI provider error (${provider}): ${err?.message || "Unknown error"}. Check your API key and credits in Settings.`;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
  mistral: "Mistral",
  xai: "xAI (Grok)",
  meta: "Meta/Groq (Llama)",
};

// Rough per-1K-token blended cost in USD. Used for the "API spend this
// month" widget in the sidebar (Malik's feature request).
// These are intentionally CONSERVATIVE estimates — we'd rather understate
// than overstate to the user. Real billing happens at the provider.
const PROVIDER_BLENDED_COST_PER_1K: Record<string, number> = {
  anthropic: 0.012,  // Claude Haiku 4.5 blended ~$3/M in + $15/M out, but most calls are short
  openai: 0.010,     // gpt-4o-mini blended
  gemini: 0.004,     // Gemini Flash blended
  mistral: 0.008,
  xai: 0.010,
  meta: 0.001,       // Llama via Groq is essentially free
};

/**
 * Estimate token count from a string. Uses the standard ~4-chars-per-token
 * rule which is accurate within ~15% for English. Cheap and good enough
 * for a usage display.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

/**
 * Estimate the BYOK cost (USD) of an LLM call based on input + output
 * length. We do this client-side rather than trusting provider responses
 * because the response shapes vary across providers.
 */
function estimateLLMCostUSD(
  provider: string,
  inputText: string,
  outputText: string,
): number {
  const ratePer1K = PROVIDER_BLENDED_COST_PER_1K[provider] ?? 0.010;
  const totalTokens = estimateTokens(inputText) + estimateTokens(outputText);
  return (totalTokens / 1000) * ratePer1K;
}

/**
 * Spend reporter: called after each successful LLM call. Set ONCE at server
 * boot from server/index.ts (avoids a circular import between llm.ts and
 * storage.ts). The reporter writes to users.byok_cost_usd_month.
 */
let onBYOKSpend: ((userId: number, provider: string, costUsd: number, tokens: number) => Promise<void> | void) | null = null;

export function setBYOKSpendReporter(fn: typeof onBYOKSpend) {
  onBYOKSpend = fn;
}

export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  opts?: { maxTokens?: number }
): Promise<string> {
  const model = config.model || DEFAULT_MODELS[config.provider];
  const providerName = PROVIDER_DISPLAY_NAMES[config.provider] || config.provider;

  try {
    const output = await _callLLMInternal(config, messages, model, opts?.maxTokens);
    // Estimate spend ONLY for BYOK calls with a userId. Platform-keyed calls
    // are tracked separately via the credits system.
    if (onBYOKSpend && config.isByok && typeof config.userId === "number") {
      try {
        const inputText = messages.map(m => m.content).join("\n");
        const cost = estimateLLMCostUSD(config.provider, inputText, output);
        const tokens = estimateTokens(inputText) + estimateTokens(output);
        // Fire and forget — never let cost reporting block the response.
        Promise.resolve(onBYOKSpend(config.userId, config.provider, cost, tokens)).catch(() => {});
      } catch { /* never let cost reporting break a call */ }
    }
    return output;
  } catch (err: any) {
    throw new Error(classifyLLMError(err, providerName));
  }
}

async function _callLLMInternal(
  config: LLMConfig,
  messages: LLMMessage[],
  model: string,
  maxTokens?: number
): Promise<string> {

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });

    // Separate system message from user/assistant messages
    const systemMsg = messages.find((m) => m.role === "system");
    const conversationMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const effectiveMaxTokens = maxTokens || 2048;
    // Anthropic requires streaming for requests that may run longer than 10 minutes.
    // Any request with maxTokens > 8192 is flagged as potentially long — use the
    // streaming API and reassemble the full text. For smaller requests we keep
    // the simpler non-streaming path.
    if (effectiveMaxTokens > 8192) {
      let text = "";
      const stream = await client.messages.stream({
        model,
        max_tokens: effectiveMaxTokens,
        system: systemMsg?.content,
        messages: conversationMsgs,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          text += event.delta.text || "";
        }
      }
      if (!text) throw new Error("No text content in Anthropic streaming response");
      return text;
    }

    const response = await client.messages.create({
      model,
      max_tokens: effectiveMaxTokens,
      system: systemMsg?.content,
      messages: conversationMsgs,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text content in Anthropic response");
    }
    return textBlock.text;
  }

  if (config.provider === "gemini") {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });

    // Build chat history for Gemini (all non-system messages before the last user message)
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");
    const lastMsg = nonSystemMsgs[nonSystemMsgs.length - 1];
    const historyMsgs = nonSystemMsgs.slice(0, -1);

    // Gemini uses "model" instead of "assistant"
    const history = historyMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = geminiModel.startChat({
      history,
      systemInstruction: systemMsg?.content,
    });

    const result = await chat.sendMessage(lastMsg?.content ?? "");
    return result.response.text();
  }

  // OpenAI-compatible: openai, mistral, xai, meta
  const baseURL = OPENAI_COMPATIBLE_BASE_URLS[config.provider];
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  const openaiMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    max_tokens: maxTokens || 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content in LLM response");
  }
  return content;
}
