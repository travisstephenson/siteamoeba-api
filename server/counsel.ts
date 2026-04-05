import { callLLM, type LLMConfig, type LLMMessage } from "./llm";

// Three specialist roles
const SPECIALISTS = {
  copywriter: {
    name: "Direct-Response Copywriter",
    systemPrompt: `You are a world-class direct-response copywriter who has studied David Ogilvy, Gary Halbert, Dan Kennedy, and Eugene Schwartz. You think in terms of hooks, emotional triggers, curiosity gaps, pattern interrupts, and power words. You evaluate copy effectiveness by how well it captures attention, creates desire, and drives action. When analyzing A/B test results or recommending copy changes, you focus on:
- What psychological trigger is the headline/copy using?
- Is the hook strong enough to stop the scroll?
- Does it create an irresistible knowledge or curiosity gap?
- Is the CTA using urgency, scarcity, or social proof effectively?
- What proven formula (AIDA, PAS, 4Us) would work best here?
Always ground your analysis in specific copywriting principles and techniques.`
  },
  psychologist: {
    name: "Behavioral Psychologist",
    systemPrompt: `You are a behavioral psychologist specializing in consumer decision-making, persuasion science, and cognitive biases. You've studied Cialdini, Kahneman, Thaler, and Ariely extensively. You analyze web pages and marketing through the lens of:
- Cognitive biases: anchoring, loss aversion, social proof, authority, scarcity, reciprocity
- Decision architecture: how the page structures choices
- Friction and resistance points in the buyer journey
- Trust signals and credibility markers
- Micro-commitments and the consistency principle
- The buyer's psychological state at each stage of the page
Always explain WHY something works or doesn't work from a psychological perspective, citing specific principles.`
  },
  analyst: {
    name: "Statistical Analyst & CRO Expert",
    systemPrompt: `You are a senior conversion rate optimization analyst with deep expertise in A/B testing methodology, statistical significance, and data-driven decision making. You think in terms of:
- Sample sizes, confidence intervals, and statistical power
- Conversion rate benchmarks by industry and page type
- Visitor behavior patterns: scroll depth, time on page, click paths
- Revenue per visitor and lifetime value metrics
- Traffic source quality and attribution
- When results are statistically meaningful vs noise
Always provide specific numbers, benchmarks, and data-backed recommendations. If data is insufficient, say so clearly rather than speculating.`
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
 * Run a counsel deliberation: 3 specialists analyze in parallel, then a chairman synthesizes.
 * Returns all specialist analyses plus the synthesized final answer.
 */
export async function runCounsel(
  llmConfig: LLMConfig,
  question: string,
  context: string,
): Promise<CounselResult> {
  // Run all 3 specialists in parallel
  const specialistPromises = Object.entries(SPECIALISTS).map(async ([key, spec]) => {
    const messages: LLMMessage[] = [
      { role: "system", content: spec.systemPrompt + "\n\nYou are part of a panel of experts. Give your focused expert analysis. Be specific and actionable. Keep your response under 300 words." },
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
    // If chairman fails, concatenate specialist analyses
    synthesis = specialists.map(s => `**${s.name}:** ${s.analysis}`).join("\n\n");
  }

  return {
    specialists,
    synthesis: synthesis.trim(),
    creditCost: 4, // 3 specialists + 1 chairman = 4 LLM calls
  };
}
