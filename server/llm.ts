import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "gemini" | "mistral" | "xai" | "meta";
  apiKey: string;
  model?: string; // optional override
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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

export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[]
): Promise<string> {
  const model = config.model || DEFAULT_MODELS[config.provider];
  const providerName = PROVIDER_DISPLAY_NAMES[config.provider] || config.provider;

  try {
    return await _callLLMInternal(config, messages, model);
  } catch (err: any) {
    throw new Error(classifyLLMError(err, providerName));
  }
}

async function _callLLMInternal(
  config: LLMConfig,
  messages: LLMMessage[],
  model: string
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

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
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
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content in LLM response");
  }
  return content;
}
