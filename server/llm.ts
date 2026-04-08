import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "gemini" | "mistral" | "xai" | "meta" | "manus";
  apiKey: string;
  model?: string; // optional override
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
  manus: "default", // Manus uses agent profiles, not chat models
};

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<LLMConfig["provider"], string>> = {
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  meta: "https://api.groq.com/openai/v1",
};

/**
 * Resolve the LLM config for a given operation and user.
 * Priority:
 * 1. Paid user WITH own key → use their key + inject brain data
 * 2. Paid user WITHOUT key → use platform key + inject brain data
 * 3. Free BYOK user → use their key, NO brain data
 * 
 * Returns { config, useBrainData, creditCost }
 */
export function resolveLLMConfig(opts: {
  operation: LLMOperation;
  userPlan: string;
  userProvider?: string | null;
  userApiKey?: string | null;
  userModel?: string | null;
}): { config: LLMConfig; useBrainData: boolean; creditCost: number; source: "user" | "platform" } {
  const { operation, userPlan, userProvider, userApiKey, userModel } = opts;
  const isPaid = userPlan !== "free";
  const hasUserKey = !!(userProvider && userApiKey);
  const platformKey = process.env.PLATFORM_ANTHROPIC_KEY;
  const tier = OPERATION_TIERS[operation] || "fast";
  const creditCost = OPERATION_CREDIT_COSTS[operation] || 1;

  // Paid user with their own key — use it (saves us money), inject brain data
  // For fast operations (scan/classify/observation), enforce fast model to prevent timeouts
  const FAST_OPS: LLMOperation[] = ["scan", "classify", "observation"];
  if (isPaid && hasUserKey) {
    const forceFastModel = FAST_OPS.includes(operation);
    return {
      config: {
        provider: userProvider as LLMConfig["provider"],
        apiKey: userApiKey!,
        // For scan/classify: use haiku regardless of user preference to prevent timeouts
        model: forceFastModel
          ? (userProvider === "anthropic" ? "claude-haiku-4-5-20251001" : userModel || undefined)
          : (userModel || undefined),
      },
      useBrainData: true,
      creditCost,
      source: "user",
    };
  }

  // Paid user without key — use platform key
  if (isPaid && platformKey) {
    const tierConfig = PLATFORM_MODELS[tier];
    return {
      config: {
        provider: tierConfig.provider,
        apiKey: platformKey,
        model: tierConfig.model,
      },
      useBrainData: true,
      creditCost,
      source: "platform",
    };
  }

  // Free BYOK user — use their key, no brain data
  if (hasUserKey) {
    return {
      config: {
        provider: userProvider as LLMConfig["provider"],
        apiKey: userApiKey!,
        model: userModel || undefined,
      },
      useBrainData: false,
      creditCost: 0, // Free tier doesn't deduct platform credits
      source: "user",
    };
  }

  // Free user without key — allow platform key for scan/classify ONLY (the hook)
  const FREE_ALLOWED_OPS: LLMOperation[] = ["scan", "classify"];
  if (!isPaid && !hasUserKey && platformKey && FREE_ALLOWED_OPS.includes(operation)) {
    const tierConfig = PLATFORM_MODELS.fast; // Always use cheapest model for free users
    return {
      config: {
        provider: tierConfig.provider,
        apiKey: platformKey,
        model: tierConfig.model,
      },
      useBrainData: false,
      creditCost: 0,
      source: "platform",
    };
  }

  // No key available at all — will throw when called
  throw new Error("No AI key available. Add your API key in Settings or upgrade to a paid plan.");
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
  manus: "Manus",
};

export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  opts?: { maxTokens?: number }
): Promise<string> {
  const model = config.model || DEFAULT_MODELS[config.provider];
  const providerName = PROVIDER_DISPLAY_NAMES[config.provider] || config.provider;

  try {
    return await _callLLMInternal(config, messages, model, opts?.maxTokens);
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

  // Manus: autonomous agent API — creates a task, polls until complete, fetches messages for result
  if (config.provider === "manus") {
    const MANUS_BASE = "https://api.manus.ai/v2";
    const manusHeaders = {
      "Content-Type": "application/json",
      "x-manus-api-key": config.apiKey,
    };

    // Collapse messages into a single task prompt
    const systemMsg = messages.find((m) => m.role === "system");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const taskContent = [
      systemMsg ? `Context:\n${systemMsg.content}` : "",
      lastUser ? lastUser.content : "",
    ].filter(Boolean).join("\n\n");

    // 1. Create task
    const createRes = await fetch(`${MANUS_BASE}/task.create`, {
      method: "POST",
      headers: manusHeaders,
      body: JSON.stringify({ message: { content: taskContent } }),
    });
    if (!createRes.ok) {
      const errBody = await createRes.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Manus API error ${createRes.status}`);
    }
    const created = await createRes.json();
    if (!created.ok) throw new Error(created.error?.message || "Manus task creation failed");
    // task_id is at root, not nested under data
    const taskId = created.task_id;
    if (!taskId) throw new Error("Manus did not return a task ID");

    // 2. Poll task.get until status is completed/failed (max 5 min, 6s interval)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6000));
      const pollRes = await fetch(`${MANUS_BASE}/task.get?task_id=${taskId}`, {
        headers: { "x-manus-api-key": config.apiKey },
      });
      if (!pollRes.ok) continue;
      const poll = await pollRes.json();
      // status lives at poll.task.status
      const status = poll.task?.status;
      if (status === "completed" || status === "success") break;
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(`Manus task ${status}: ${poll.task?.error || "unknown error"}`);
      }
      // Still running — keep polling
    }
    if (Date.now() >= deadline) throw new Error("Manus task timed out after 5 minutes.");

    // 3. Fetch messages to get the assistant's final response
    const msgsRes = await fetch(`${MANUS_BASE}/task.listMessages?task_id=${taskId}`, {
      headers: { "x-manus-api-key": config.apiKey },
    });
    if (!msgsRes.ok) throw new Error(`Manus listMessages error ${msgsRes.status}`);
    const msgsData = await msgsRes.json();
    const msgs: any[] = msgsData.messages ?? [];
    // Find last assistant_message with content
    const assistantMsgs = msgs.filter((m: any) => m.type === "assistant_message" && m.assistant_message?.content);
    if (assistantMsgs.length > 0) {
      return assistantMsgs[assistantMsgs.length - 1].assistant_message.content;
    }
    // Fallback: last explanation content
    const explanations = msgs.filter((m: any) => m.type === "explanation" && m.explanation?.content);
    if (explanations.length > 0) {
      return explanations[explanations.length - 1].explanation.content;
    }
    throw new Error("Manus task completed but returned no readable output.");
  }

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

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens || 2048,
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
