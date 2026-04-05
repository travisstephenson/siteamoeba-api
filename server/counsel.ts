import { callLLM, type LLMConfig, type LLMMessage } from "./llm";
import { storage } from "./storage";

// Three specialist roles with their domain expertise
const SPECIALISTS = {
  copywriter: {
    name: "Direct-Response Copywriter",
    role: "copywriter",
    basePrompt: `You are a world-class direct-response copywriter who has studied David Ogilvy, Gary Halbert, Dan Kennedy, and Eugene Schwartz. You think in terms of hooks, emotional triggers, curiosity gaps, pattern interrupts, and power words. You evaluate copy effectiveness by how well it captures attention, creates desire, and drives action.

Your analysis focuses on:
- What psychological trigger is the headline/copy using?
- Is the hook strong enough to stop the scroll?
- Does it create an irresistible knowledge or curiosity gap?
- Is the CTA using urgency, scarcity, or social proof effectively?
- What proven formula (AIDA, PAS, 4Us) would work best here?
- Power words, sentence rhythm, and emotional amplification

Always ground your analysis in specific copywriting principles and techniques.`,
    postMortemPrompt: `You are a direct-response copywriter analyzing a completed A/B test result. Extract COPYWRITING-SPECIFIC learnings:

1. What copy TECHNIQUE made the winner effective? (e.g. curiosity gap, specificity, power words, pattern interrupt)
2. What formula or structure did the winner use? (AIDA, PAS, storytelling, direct benefit)
3. What was WEAK about the losing copy from a copywriting perspective?
4. What specific words, phrases, or hooks drove the difference?
5. What reusable copywriting principle can be extracted for future tests?

Be specific. Name the exact techniques. This learning will be stored and used to make future copy recommendations better.
Return a concise 2-3 sentence insight focused purely on copywriting technique. Start with "COPY INSIGHT:"`
  },
  psychologist: {
    name: "Behavioral Psychologist",
    role: "psychologist",
    basePrompt: `You are a behavioral psychologist specializing in consumer decision-making, persuasion science, and cognitive biases. You've studied Cialdini, Kahneman, Thaler, and Ariely extensively.

Your analysis focuses on:
- Cognitive biases: anchoring, loss aversion, social proof, authority, scarcity, reciprocity
- Decision architecture: how the page structures choices
- Friction and resistance points in the buyer journey
- Trust signals and credibility markers
- Micro-commitments and the consistency principle
- The buyer's psychological state at each stage of the page
- Emotional vs rational triggers and when each is appropriate

Always explain WHY something works from a psychological perspective, citing specific principles.`,
    postMortemPrompt: `You are a behavioral psychologist analyzing a completed A/B test result. Extract PSYCHOLOGY-SPECIFIC learnings:

1. What cognitive bias or psychological principle made the winner convert better?
2. What was the decision-making friction in the losing variant?
3. What emotional state does the winner create vs the loser?
4. What persuasion principle (Cialdini's 6, Kahneman's System 1/2, etc.) is at work?
5. What reusable psychological insight can be extracted for future page optimization?

Be specific. Name the exact principle. This learning will be stored and used to make future recommendations better.
Return a concise 2-3 sentence insight focused purely on behavioral psychology. Start with "PSYCH INSIGHT:"`
  },
  analyst: {
    name: "Statistical Analyst & CRO Expert",
    role: "analyst",
    basePrompt: `You are a senior conversion rate optimization analyst with deep expertise in A/B testing methodology, statistical significance, and data-driven decision making.

Your analysis focuses on:
- Sample sizes, confidence intervals, and statistical power
- Conversion rate benchmarks by industry and page type
- Visitor behavior patterns: scroll depth, time on page, click paths
- Revenue per visitor and lifetime value metrics
- Traffic source quality and attribution
- When results are statistically meaningful vs noise
- Segmentation: does the result hold across devices, sources, times?

Always provide specific numbers, benchmarks, and data-backed recommendations. If data is insufficient, say so clearly.`,
    postMortemPrompt: `You are a CRO data analyst analyzing a completed A/B test result. Extract DATA-SPECIFIC learnings:

1. Is this result statistically reliable? (sample size, confidence level, test duration)
2. What conversion rate benchmark does this compare to for this page type/niche?
3. What is the projected revenue impact of this improvement?
4. Are there any data red flags (too-small sample, extreme outlier, single-source traffic)?
5. What data pattern can be extracted for future test prioritization?

Be specific with numbers. This learning will be stored and used to make future analytical recommendations better.
Return a concise 2-3 sentence insight focused purely on data/statistics. Start with "DATA INSIGHT:"`
  }
};

export interface CounselResult {
  specialists: {
    role: string;
    name: string;
    analysis: string;
  }[];
  synthesis: string;
  creditCost: number;
}

/**
 * Build a specialist's full system prompt by injecting their accumulated learnings
 */
async function buildSpecialistPrompt(
  role: string,
  basePrompt: string,
  pageType?: string,
  sectionType?: string
): Promise<string> {
  // Fetch this specialist's accumulated learnings
  try {
    const learnings = await storage.getSpecialistKnowledge(role, { pageType, sectionType, limit: 8 });
    if (learnings.length > 0) {
      const learningText = learnings.map((l: any, i: number) => 
        `${i + 1}. [${l.section_type || 'general'}${l.page_type ? ', ' + l.page_type : ''}] ${l.insight}`
      ).join('\n');
      
      return basePrompt + `\n\nYOUR ACCUMULATED KNOWLEDGE FROM PAST TEST ANALYSES:\nYou have analyzed ${learnings.length}+ real A/B tests. Here are your most relevant learnings:\n${learningText}\n\nUse these learnings to inform your analysis. Reference specific past test results when relevant.`;
    }
  } catch (err) {
    console.warn(`Failed to fetch specialist knowledge for ${role}:`, err);
  }
  return basePrompt;
}

/**
 * Run a counsel deliberation: 3 specialists analyze in parallel, then a chairman synthesizes.
 */
export async function runCounsel(
  llmConfig: LLMConfig,
  question: string,
  context: string,
  opts?: { pageType?: string; sectionType?: string }
): Promise<CounselResult> {
  // Build specialist prompts with their accumulated knowledge (in parallel)
  const specialistEntries = Object.entries(SPECIALISTS);
  const enrichedPrompts = await Promise.all(
    specialistEntries.map(([key, spec]) =>
      buildSpecialistPrompt(spec.role, spec.basePrompt, opts?.pageType, opts?.sectionType)
    )
  );

  // Run all 3 specialists in parallel
  const specialistPromises = specialistEntries.map(async ([key, spec], i) => {
    const messages: LLMMessage[] = [
      { role: "system", content: enrichedPrompts[i] + "\n\nYou are part of a panel of experts. Give your focused expert analysis. Be specific and actionable. Keep your response under 300 words." },
      { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION:\n${question}` }
    ];

    try {
      const analysis = await callLLM(llmConfig, messages);
      return { role: key, name: spec.name, analysis: analysis.trim() };
    } catch (err: any) {
      return { role: key, name: spec.name, analysis: `[Analysis unavailable: ${err.message?.slice(0, 100)}]` };
    }
  });

  const specialists = await Promise.all(specialistPromises);

  // Chairman synthesis
  const chairmanMessages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the Chairman of an expert panel on conversion rate optimization. Three specialists have analyzed a question. Your job is to:
1. Identify the strongest and most actionable insights from each specialist
2. Resolve any contradictions by explaining the tradeoffs
3. Synthesize a single, clear, actionable recommendation
4. Note which specialist's perspective is most relevant to this specific question

Write in a direct, clear style. The user should walk away knowing exactly what to do. Do NOT repeat the specialists' full analyses — synthesize and add value. Keep under 400 words.`
    },
    {
      role: "user",
      content: `ORIGINAL QUESTION:\n${question}\n\nCONTEXT:\n${context}\n\n--- SPECIALIST ANALYSES ---\n\n**${specialists[0].name}:**\n${specialists[0].analysis}\n\n**${specialists[1].name}:**\n${specialists[1].analysis}\n\n**${specialists[2].name}:**\n${specialists[2].analysis}\n\n--- END ANALYSES ---\n\nSynthesize the best answer.`
    }
  ];

  let synthesis: string;
  try {
    synthesis = await callLLM(llmConfig, chairmanMessages);
  } catch (err: any) {
    synthesis = specialists.map(s => `**${s.name}:** ${s.analysis}`).join("\n\n");
  }

  return {
    specialists,
    synthesis: synthesis.trim(),
    creditCost: 4,
  };
}

/**
 * Post-mortem: Each specialist analyzes a completed test result from their domain.
 * Called when a winner is declared. Runs all 3 in parallel (fire-and-forget).
 * Stores each specialist's learning in specialist_knowledge table.
 */
export async function runPostMortem(
  llmConfig: LLMConfig,
  testResult: {
    sectionType: string;
    pageType: string;
    niche?: string;
    winnerText: string;
    loserText: string;
    winnerConversionRate: number;
    loserConversionRate: number;
    liftPercent: number;
    sampleSize: number;
    confidence: number;
    campaignId: number;
    userId: number;
  }
): Promise<void> {
  const contextMsg = `TEST RESULT:
Section: ${testResult.sectionType}
Page type: ${testResult.pageType}${testResult.niche ? ` (${testResult.niche})` : ''}
Sample size: ${testResult.sampleSize} visitors
Confidence: ${testResult.confidence.toFixed(0)}%
Winner conversion rate: ${(testResult.winnerConversionRate * 100).toFixed(2)}%
Loser conversion rate: ${(testResult.loserConversionRate * 100).toFixed(2)}%
Lift: +${testResult.liftPercent.toFixed(1)}%

WINNING VARIANT:
"${testResult.winnerText.replace(/<[^>]*>/g, '').slice(0, 500)}"

LOSING VARIANT:
"${testResult.loserText.replace(/<[^>]*>/g, '').slice(0, 500)}"`;

  // Run all 3 specialist post-mortems in parallel
  const postMortems = Object.entries(SPECIALISTS).map(async ([key, spec]) => {
    try {
      const messages: LLMMessage[] = [
        { role: "system", content: spec.postMortemPrompt },
        { role: "user", content: contextMsg }
      ];
      const insight = await callLLM(llmConfig, messages);
      
      // Store the specialist's learning
      await storage.addSpecialistKnowledge({
        specialistRole: spec.role,
        knowledgeType: "post_mortem",
        pageType: testResult.pageType,
        niche: testResult.niche,
        sectionType: testResult.sectionType,
        insight: insight.trim().slice(0, 500),
        winnerText: testResult.winnerText.replace(/<[^>]*>/g, '').slice(0, 300),
        loserText: testResult.loserText.replace(/<[^>]*>/g, '').slice(0, 300),
        liftPercent: testResult.liftPercent,
        sampleSize: testResult.sampleSize,
        confidence: testResult.confidence,
        campaignId: testResult.campaignId,
        userId: testResult.userId,
      });
    } catch (err) {
      console.warn(`Post-mortem failed for ${spec.role}:`, err);
    }
  });

  await Promise.all(postMortems);
}
