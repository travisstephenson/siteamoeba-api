/**
 * autopilot-engine.ts
 *
 * Core engine that manages the autopilot loop for a campaign.
 * Automatically evaluates running tests, declares winners, and advances
 * to the next section in the playbook.
 */

import { storage } from "./storage";
import { callLLM, type LLMConfig } from "./llm";
import {
  buildHeadlineGenerationPrompt,
  buildSubheadlineGenerationPrompt,
  buildSectionGenerationPrompt,
  buildTestLessonPrompt,
  type GenerationContext,
} from "./prompts";
import { getPlaybook, type PlaybookStep } from "./autopilot-playbooks";
import type { Campaign, User, Variant } from "@shared/schema";

// ============================================================
// Types
// ============================================================

export interface AutopilotState {
  enabled: boolean;
  currentStep: number;     // which playbook step (0-indexed) we're on
  currentSectionId: number | null; // which test_section is being tested
  status: "idle" | "generating" | "testing" | "evaluating" | "advancing" | "paused" | "completed";
  lastEvaluatedAt: string | null;
  playbook: PlaybookStep[];
  currentPlaybookStep: PlaybookStep | null;
}

export interface AutopilotAction {
  action: "declared_winner" | "advancing" | "no_action";
  winnerId?: number;
  winnerText?: string;
  sectionType?: string;
  advancingTo?: string;
  message?: string;
}

// ============================================================
// Shared declare-winner logic (used by both the API route and the autopilot engine)
// ============================================================

export async function declareWinnerForSection(
  campaign: Campaign,
  winningVariantId: number,
  sectionType: string,
  user: User | undefined
): Promise<{ winner: Variant; lesson: any }> {
  const winningVariant = await storage.getVariant(winningVariantId);
  if (!winningVariant || winningVariant.campaignId !== campaign.id) {
    throw new Error("Variant not found in this campaign");
  }

  const allVariants = await storage.getVariantsByCampaign(campaign.id);
  const typeVariants = allVariants.filter((v) => v.type === sectionType);

  // Gather stats before deactivating (for test lesson)
  const variantStats = await storage.getVariantStats(campaign.id);
  const typeStats = variantStats.filter((v) => v.type === sectionType);
  const winnerStats = typeStats.find((v) => v.variantId === winningVariant.id);
  const controlStats = typeStats.find(
    (v) => v.isControl && v.variantId !== winningVariant.id
  );

  // Deactivate all variants of this type, remove control flag
  for (const v of typeVariants) {
    await storage.updateVariant(v.id, { isActive: false, isControl: false } as any);
  }

  // Mark the winner as the new control (and keep it active)
  await storage.updateVariant(winningVariant.id, {
    isActive: true,
    isControl: true,
  } as any);

  // Deactivate the test section itself (it's been completed)
  const testSectionsList = await storage.getTestSectionsByCampaign(campaign.id);
  const matchingSection = testSectionsList.find((s) => s.category === sectionType);
  if (matchingSection) {
    await storage.updateTestSection(matchingSection.id, { isActive: false } as any);
  }

  // === TEST LESSON: Auto-generate and store a lesson from this result ===
  let lesson: any = null;
  try {
    if (
      winnerStats &&
      controlStats &&
      winnerStats.impressions >= 10 &&
      controlStats.impressions >= 10
    ) {
      const loserVariant =
        typeVariants.find((v) => v.id === controlStats.variantId) ||
        typeVariants.find((v) => v.id !== winningVariant.id);

      const winnerCvr = winnerStats.conversionRate;
      const loserCvr = controlStats.conversionRate;
      const liftPct =
        loserCvr > 0 ? ((winnerCvr - loserCvr) / loserCvr) * 100 : 0;
      const sampleSize = winnerStats.impressions + controlStats.impressions;

      let winnerStrategy: string | undefined;
      let loserStrategy: string | undefined;
      try {
        const winnerTags = winningVariant.persuasionTags
          ? JSON.parse(winningVariant.persuasionTags)
          : [];
        winnerStrategy = Array.isArray(winnerTags) ? winnerTags[0] : undefined;
      } catch { /* ignore */ }
      if (loserVariant) {
        try {
          const loserTags = loserVariant.persuasionTags
            ? JSON.parse(loserVariant.persuasionTags)
            : [];
          loserStrategy = Array.isArray(loserTags) ? loserTags[0] : undefined;
        } catch { /* ignore */ }
      }

      const lessonData: any = {
        campaignId: campaign.id,
        sectionType,
        pageType: campaign.pageType || "sales_page",
        niche: campaign.niche || undefined,
        pricePoint: campaign.pricePoint || undefined,
        winnerText: winningVariant.text,
        loserText: loserVariant
          ? loserVariant.text
          : controlStats.text,
        winnerConversionRate: winnerCvr,
        loserConversionRate: loserCvr,
        liftPercent: liftPct,
        winnerStrategy,
        loserStrategy,
        sampleSize,
        confidence: winnerStats.confidence,
      };

      // Try to generate an LLM lesson summary if user has an LLM configured
      if (user?.llmProvider && user?.llmApiKey) {
        try {
          const llmConfig: LLMConfig = {
            provider: user.llmProvider as any,
            apiKey: user.llmApiKey,
            model: user.llmModel || undefined,
          };
          const lessonMessages = buildTestLessonPrompt({
            sectionType,
            pageType: campaign.pageType || undefined,
            niche: campaign.niche || undefined,
            pricePoint: campaign.pricePoint || undefined,
            winnerText: winningVariant.text,
            loserText: loserVariant ? loserVariant.text : controlStats.text,
            winnerConversionRate: winnerCvr,
            loserConversionRate: loserCvr,
            liftPercent: liftPct,
            winnerStrategy,
            loserStrategy,
            sampleSize,
            confidence: winnerStats.confidence,
          });
          const lessonText = await callLLM(llmConfig, lessonMessages);
          lessonData.lesson = lessonText.trim();
        } catch (err) {
          console.warn("Could not generate LLM lesson summary:", err);
        }
      }

      lesson = await storage.createTestLesson(lessonData);
    }
  } catch (err) {
    console.warn("Test lesson creation failed:", err);
  }

  return { winner: winningVariant, lesson };
}

// ============================================================
// Core autopilot functions
// ============================================================

/**
 * Check if the currently active test for a campaign should be auto-declared.
 * Safe to call multiple times — idempotent.
 */
export async function evaluateAutopilotTests(
  campaignId: number
): Promise<AutopilotAction | null> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign || !campaign.autopilotEnabled) return null;
  if (campaign.autopilotStatus === "paused" || campaign.autopilotStatus === "completed") return null;
  if (campaign.autopilotStatus === "generating" || campaign.autopilotStatus === "advancing") return null;

  const playbook = getPlaybook(campaign.pageType || "landing_page");
  const currentStepIndex = campaign.autopilotStep ?? 0;
  if (currentStepIndex >= playbook.length) {
    // All steps complete
    await storage.updateCampaign(campaignId, { autopilotStatus: "completed" } as any);
    return { action: "no_action", message: "All playbook steps completed" };
  }

  const currentPlaybookStep = playbook[currentStepIndex];

  // Find the active test section matching the current playbook step category
  const sections = await storage.getTestSectionsByCampaign(campaignId);
  const activeSection = sections.find(
    (s) => s.isActive && s.category === currentPlaybookStep.sectionCategory
  );

  if (!activeSection) {
    // No active section for this step — nothing to evaluate
    return null;
  }

  // Get the user's statistical settings
  const user = await getUserForCampaign(campaign);
  if (!user) return null;

  const minVisitors = user.minVisitorsPerVariant ?? 100;
  const winThreshold = user.winConfidenceThreshold ?? 95;

  // Get variant stats for the active section type
  const variantStats = await storage.getVariantStats(campaignId);
  const sectionStats = variantStats.filter(
    (v) => v.type === currentPlaybookStep.sectionCategory
  );

  const controlStats = sectionStats.find((v) => v.isControl);
  if (!controlStats) return null;

  // Check minimum sample size
  if (controlStats.impressions < minVisitors) {
    // Not enough data yet
    return null;
  }

  // Check if any variant has reached the confidence threshold
  const challenger = sectionStats
    .filter((v) => !v.isControl && v.impressions >= minVisitors)
    .find((v) => v.confidence >= winThreshold);

  if (!challenger) {
    // No winner yet
    return null;
  }

  // We have a winner — update status to evaluating
  await storage.updateCampaign(campaignId, { autopilotStatus: "evaluating" } as any);

  // Declare the winner
  try {
    await declareWinnerForSection(
      campaign,
      challenger.variantId,
      currentPlaybookStep.sectionCategory,
      user
    );

    // Advance the autopilot step
    const nextStep = currentStepIndex + 1;
    const isCompleted = nextStep >= playbook.length;

    await storage.updateCampaign(campaignId, {
      autopilotStep: nextStep,
      autopilotStatus: isCompleted ? "completed" : "advancing",
    } as any);

    // If not completed, advance to next step asynchronously
    if (!isCompleted) {
      // Fire-and-forget the advance (variant generation is slow)
      advanceAutopilot(campaignId, user.id).catch((err) => {
        console.error("Autopilot advance failed:", err);
        storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any).catch(() => {});
      });
    }

    return {
      action: "declared_winner",
      winnerId: challenger.variantId,
      winnerText: challenger.text,
      sectionType: currentPlaybookStep.sectionCategory,
      advancingTo: isCompleted ? undefined : playbook[nextStep]?.sectionCategory,
      message: isCompleted
        ? "All playbook steps completed. Autopilot finished."
        : `Winner declared for ${currentPlaybookStep.sectionCategory}. Advancing to ${playbook[nextStep]?.sectionCategory}.`,
    };
  } catch (err) {
    console.error("Autopilot declare winner failed:", err);
    await storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any);
    return null;
  }
}

/**
 * Advance to the next playbook step: activate the section and generate variants.
 */
export async function advanceAutopilot(
  campaignId: number,
  userId: number
): Promise<void> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const user = await storage.getUserById(userId);
  if (!user) throw new Error("User not found");

  const playbook = getPlaybook(campaign.pageType || "landing_page");
  const currentStepIndex = campaign.autopilotStep ?? 0;

  if (currentStepIndex >= playbook.length) {
    await storage.updateCampaign(campaignId, { autopilotStatus: "completed" } as any);
    return;
  }

  const step = playbook[currentStepIndex];

  // Find the section that matches this playbook step category
  const sections = await storage.getTestSectionsByCampaign(campaignId);
  let targetSection = sections.find(
    (s) => s.category === step.sectionCategory
  );

  if (!targetSection) {
    // No section found for this step — skip it and try the next one
    console.log(
      `Autopilot: no section found for category "${step.sectionCategory}" in campaign ${campaignId}. Skipping.`
    );
    const nextStep = currentStepIndex + 1;
    if (nextStep < playbook.length) {
      await storage.updateCampaign(campaignId, {
        autopilotStep: nextStep,
        autopilotStatus: "advancing",
      } as any);
      return advanceAutopilot(campaignId, userId);
    } else {
      await storage.updateCampaign(campaignId, { autopilotStatus: "completed" } as any);
      return;
    }
  }

  // Activate this section
  await storage.updateTestSection(targetSection.id, { isActive: true } as any);

  // Generate variants for it
  await storage.updateCampaign(campaignId, { autopilotStatus: "generating" } as any);

  await generateAutopilotVariants(campaignId, userId, step, targetSection.id);

  // Update status to testing
  await storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any);
}

/**
 * Generate variants for the current autopilot step and save them to the DB.
 */
export async function generateAutopilotVariants(
  campaignId: number,
  userId: number,
  step?: PlaybookStep,
  testSectionId?: number
): Promise<void> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const user = await storage.getUserById(userId);
  if (!user) throw new Error("User not found");

  if (!user.llmProvider || !user.llmApiKey) {
    // No LLM configured — cannot generate variants
    await storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any);
    return;
  }

  const playbook = getPlaybook(campaign.pageType || "landing_page");
  const currentStepIndex = campaign.autopilotStep ?? 0;
  const currentStep = step || playbook[currentStepIndex];

  if (!currentStep) return;

  const type = currentStep.sectionCategory;

  // Build generation context
  const allVariants = await storage.getVariantsByCampaign(campaignId);
  const typeVariants = allVariants.filter((v) => v.type === type);
  const controlHeadlineVariant = allVariants.find(
    (v) => v.type === "headline" && v.isControl
  );
  const controlSubheadlineVariant = allVariants.find(
    (v) => v.type === "subheadline" && v.isControl
  );

  const existingTags: string[] = [];
  for (const v of typeVariants) {
    if (v.persuasionTags) {
      try {
        const tags = JSON.parse(v.persuasionTags);
        if (Array.isArray(tags)) existingTags.push(...tags);
      } catch { /* ignore */ }
    }
  }

  // Get section info for context
  const sections = await storage.getTestSectionsByCampaign(campaignId);
  const matchingSection = sections.find(
    (s) => s.category === type && (testSectionId == null || s.id === testSectionId)
  );

  const context: GenerationContext = {
    campaignName: campaign.name,
    pageUrl: campaign.url,
    currentVariants: typeVariants.map((v) => v.text),
    controlHeadline: controlHeadlineVariant?.text,
    controlSubheadline: controlSubheadlineVariant?.text,
    existingPersuasionTags:
      existingTags.length > 0 ? Array.from(new Set(existingTags)) : undefined,
    type,
    pageType: campaign.pageType || undefined,
    pageGoal: campaign.pageGoal || undefined,
    pricePoint: campaign.pricePoint || undefined,
    niche: campaign.niche || undefined,
  };

  if (matchingSection) {
    context.controlText = matchingSection.currentText || undefined;
    context.sectionLabel = matchingSection.label;
    context.sectionPurpose = matchingSection.purpose || undefined;
  }

  const llmConfig: LLMConfig = {
    provider: user.llmProvider as any,
    apiKey: user.llmApiKey,
    model: user.llmModel || undefined,
  };

  let messages;
  if (type === "headline") {
    messages = buildHeadlineGenerationPrompt(context);
  } else if (type === "subheadline") {
    messages = buildSubheadlineGenerationPrompt(context);
  } else {
    messages = buildSectionGenerationPrompt(context);
  }

  let rawResponse: string;
  try {
    rawResponse = await callLLM(llmConfig, messages);
  } catch (err: any) {
    console.error("Autopilot: LLM call failed:", err);
    await storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any);
    return;
  }

  // Parse the JSON response
  let generatedVariants: { text: string; strategy: string; reasoning: string }[];
  try {
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    generatedVariants = JSON.parse(cleaned);
    if (!Array.isArray(generatedVariants)) throw new Error("Expected JSON array");
  } catch (err) {
    console.error("Autopilot: Failed to parse LLM response:", rawResponse);
    await storage.updateCampaign(campaignId, { autopilotStatus: "testing" } as any);
    return;
  }

  const sanitized = generatedVariants
    .filter((v) => v && typeof v.text === "string" && v.text.trim())
    .map((v) => ({
      text: v.text.trim(),
      strategy: v.strategy || "unknown",
      reasoning: v.reasoning || "",
    }))
    .slice(0, 3);

  // Check if a control variant already exists for this type
  const existingControl = typeVariants.find((v) => v.isControl);

  // If no existing control and there's a currentText in the section, create control first
  if (!existingControl && matchingSection?.currentText) {
    await storage.createVariant({
      campaignId,
      type,
      text: matchingSection.currentText,
      isControl: true,
      isActive: true,
      persuasionTags: null,
      testSectionId: matchingSection?.id ?? null,
    });
  }

  // Save the generated variants
  for (const v of sanitized) {
    await storage.createVariant({
      campaignId,
      type,
      text: v.text,
      isControl: false,
      isActive: true,
      persuasionTags: JSON.stringify([v.strategy]),
      testSectionId: matchingSection?.id ?? null,
    });
  }
}

// ============================================================
// Helper
// ============================================================

async function getUserForCampaign(campaign: Campaign): Promise<User | undefined> {
  return storage.getUserById(campaign.userId);
}
