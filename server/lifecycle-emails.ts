/**
 * Lifecycle email templates
 *
 * Each template is keyed by stage. When the lifecycle cron fires, it asks for
 * templateForStage(stage, user, stats) and gets back { subject, bodyHtml, bodyText }.
 *
 * Tone notes (from Travis):
 *   - Direct, founder-voice. Not marketing-team-speak.
 *   - Short. Optimized for mobile read.
 *   - Always end with a clear next step that takes 60 seconds or less.
 *   - Always offer "reply and I'll do it for you" as the easy path.
 *
 * Template versions:
 *   v1 = initial copy (Apr 28, 2026). Bump when copy is rewritten so users who
 *   got v1 can be re-emailed v2 if needed.
 */

import type { LifecycleStage } from "./lifecycle-classifier";

export const TEMPLATE_VERSIONS: Record<LifecycleStage, number> = {
  "01_signed_up_no_campaign": 1,
  "02_campaign_no_sections": 1,
  "03_sections_no_variants": 1,
  "04_variants_no_pixel_or_traffic": 1,
  "05_traffic_below_100": 1,
  "06_traffic_no_revenue": 1,
  "07_got_results": 1,
};

export interface LifecycleEmailContext {
  firstName: string;
  email: string;
  campaignCount: number;
  totalVisitors: number;
  variantsCount: number;
  activeSectionsCount: number;
  appUrl: string; // e.g. https://app.siteamoeba.com
}

export interface LifecycleEmail {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  preheader: string;
}

const SIGNATURE = `\n\n— Travis\nFounder, SiteAmoeba\nP.S. Just hit reply — I read every email.`;
const SIGNATURE_HTML = `<br><br>— Travis<br>Founder, SiteAmoeba<br><em>P.S. Just hit reply — I read every email.</em>`;

export function templateForStage(stage: LifecycleStage, ctx: LifecycleEmailContext): LifecycleEmail {
  const dashUrl = ctx.appUrl;
  const newCampUrl = `${ctx.appUrl}/campaigns?new=1`;

  switch (stage) {
    case "01_signed_up_no_campaign":
      return {
        preheader: "Your first campaign takes 30 seconds — here's how.",
        subject: `${ctx.firstName}, your SiteAmoeba account is ready — but it needs a campaign`,
        bodyText:
`Hey ${ctx.firstName},

You signed up for SiteAmoeba but haven't created your first campaign yet. That's the only thing standing between you and your first AI-driven test.

Three steps, ~30 seconds:
1. Pick the page you want to optimize (any sales page, opt-in, or product page)
2. Paste the URL — we'll auto-scan every testable section
3. Hit "Create campaign" and we generate variants for you

→ Start your first campaign: ${newCampUrl}

If you're stuck on what to test or what page to start with, just reply with your URL and I'll set it up for you personally.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>You signed up for SiteAmoeba but haven't created your first campaign yet. That's the only thing standing between you and your first AI-driven test.</p>
<p><strong>Three steps, ~30 seconds:</strong></p>
<ol>
  <li>Pick the page you want to optimize (any sales page, opt-in, or product page)</li>
  <li>Paste the URL — we'll auto-scan every testable section</li>
  <li>Hit "Create campaign" and we generate variants for you</li>
</ol>
<p><a href="${newCampUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Start your first campaign →</a></p>
<p>If you're stuck on what to test or what page to start with, just reply with your URL and I'll set it up for you personally.${SIGNATURE_HTML}</p>`,
      };

    case "02_campaign_no_sections":
      return {
        preheader: "Your scan finished — pick a section to test.",
        subject: `${ctx.firstName}, your campaign is scanned but waiting for you`,
        bodyText:
`Hey ${ctx.firstName},

You created a campaign but haven't picked any sections to test yet. The scan found everything testable on your page — headlines, CTAs, body copy, and now images. You just need to flip a few switches.

→ Pick your test sections: ${dashUrl}

Tip: start with the hero headline. It's the highest-leverage element on any page and gets results fastest.

Reply with your campaign URL if you want me to pick the first 3 for you.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>You created a campaign but haven't picked any sections to test yet. The scan found everything testable on your page — headlines, CTAs, body copy, and now images. You just need to flip a few switches.</p>
<p><a href="${dashUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Pick your test sections →</a></p>
<p><strong>Tip:</strong> start with the hero headline. It's the highest-leverage element on any page and gets results fastest.</p>
<p>Reply with your campaign URL if you want me to pick the first 3 for you.${SIGNATURE_HTML}</p>`,
      };

    case "03_sections_no_variants":
      return {
        preheader: "Your sections are picked — now generate variants.",
        subject: `${ctx.firstName}, you're one step away from a live test`,
        bodyText:
`Hey ${ctx.firstName},

You picked ${ctx.activeSectionsCount} section${ctx.activeSectionsCount === 1 ? "" : "s"} to test but haven't generated any variants yet. SiteAmoeba can write the variants for you in 10 seconds — just open a section and click "Generate with AI".

→ Generate your first variants: ${dashUrl}

You don't have to be a copywriter. The AI knows your niche and the conversion frameworks (PAS, AIDA, before-after-bridge, etc.) — it just needs you to hit the button.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>You picked <strong>${ctx.activeSectionsCount}</strong> section${ctx.activeSectionsCount === 1 ? "" : "s"} to test but haven't generated any variants yet. SiteAmoeba can write the variants for you in 10 seconds — just open a section and click "Generate with AI".</p>
<p><a href="${dashUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Generate your first variants →</a></p>
<p>You don't have to be a copywriter. The AI knows your niche and the conversion frameworks (PAS, AIDA, before-after-bridge, etc.) — it just needs you to hit the button.${SIGNATURE_HTML}</p>`,
      };

    case "04_variants_no_pixel_or_traffic":
      return {
        preheader: "We're not seeing your pixel fire — let's diagnose.",
        subject: `${ctx.firstName}, your test is live but no traffic yet`,
        bodyText:
`Hey ${ctx.firstName},

Your variants are ready, but I'm not seeing any visitors hit your page yet. There are usually three reasons:

1. The pixel isn't installed on the right page (or got removed during a publish)
2. Your page renders client-side (HighLevel, Wix, Webflow) — works, but takes a real visit to verify
3. The page just hasn't gotten traffic yet

Two ways to fix this fast:
→ Re-verify the pixel: ${dashUrl}
→ Or reply with your page URL and I'll diagnose it for you in 5 minutes.

Either way: nothing tests until traffic flows.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>Your variants are ready, but I'm not seeing any visitors hit your page yet. There are usually three reasons:</p>
<ol>
  <li>The pixel isn't installed on the right page (or got removed during a publish)</li>
  <li>Your page renders client-side (HighLevel, Wix, Webflow) — works, but takes a real visit to verify</li>
  <li>The page just hasn't gotten traffic yet</li>
</ol>
<p><a href="${dashUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Re-verify the pixel →</a></p>
<p>Or reply with your page URL and I'll diagnose it for you in 5 minutes.</p>
<p>Either way: nothing tests until traffic flows.${SIGNATURE_HTML}</p>`,
      };

    case "05_traffic_below_100": {
      const visitorsNeeded = Math.max(0, 100 - ctx.totalVisitors);
      return {
        preheader: `You're at ${ctx.totalVisitors} visitors — ${visitorsNeeded} more and we can call winners.`,
        subject: `${ctx.firstName}, ${ctx.totalVisitors} visitors in — ${visitorsNeeded} more until we can call a winner`,
        bodyText:
`Hey ${ctx.firstName},

Good news: your pixel is firing and you've got ${ctx.totalVisitors} visitors. Bad news: we need ~100 per variant before stats are meaningful.

Three fastest ways to push past 100:

1. Drive paid traffic — even a $20 Facebook test ad gets you there in a day
2. Email your list to the page (you should be doing this anyway)
3. Post the page to your highest-traffic social channel

→ See your live stats: ${dashUrl}

If you don't have a traffic source, hit reply and tell me about your business — I can usually point at one obvious lever.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>Good news: your pixel is firing and you've got <strong>${ctx.totalVisitors} visitors</strong>. Bad news: we need ~100 per variant before stats are meaningful.</p>
<p><strong>Three fastest ways to push past 100:</strong></p>
<ol>
  <li>Drive paid traffic — even a $20 Facebook test ad gets you there in a day</li>
  <li>Email your list to the page (you should be doing this anyway)</li>
  <li>Post the page to your highest-traffic social channel</li>
</ol>
<p><a href="${dashUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">See your live stats →</a></p>
<p>If you don't have a traffic source, hit reply and tell me about your business — I can usually point at one obvious lever.${SIGNATURE_HTML}</p>`,
      };
    }

    case "06_traffic_no_revenue":
      return {
        preheader: "Visitors are flowing — but we're missing the conversion signal.",
        subject: `${ctx.firstName}, you're getting traffic but no revenue events`,
        bodyText:
`Hey ${ctx.firstName},

You've got ${ctx.totalVisitors} visitors flowing through SiteAmoeba — but we haven't recorded a single revenue event. That means we can see what people see, but not what makes them buy.

Two things to check:

1. The conversion pixel — it goes on your "thank you" or post-purchase page
2. Stripe / Whop / GHL connection — connect one and we auto-track revenue

→ Set up conversion tracking: ${dashUrl}/settings/integrations

Without conversion data, our brain is flying blind. With it, every variant comparison becomes "this one made $X more per visitor" — which is the only number that matters.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>You've got <strong>${ctx.totalVisitors} visitors</strong> flowing through SiteAmoeba — but we haven't recorded a single revenue event. That means we can see what people see, but not what makes them buy.</p>
<p><strong>Two things to check:</strong></p>
<ol>
  <li>The conversion pixel — it goes on your "thank you" or post-purchase page</li>
  <li>Stripe / Whop / GHL connection — connect one and we auto-track revenue</li>
</ol>
<p><a href="${dashUrl}/settings/integrations" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Set up conversion tracking →</a></p>
<p>Without conversion data, our brain is flying blind. With it, every variant comparison becomes "this one made $X more per visitor" — which is the only number that matters.${SIGNATURE_HTML}</p>`,
      };

    case "07_got_results":
      return {
        preheader: "Your first significant test is in. Here's what to do next.",
        subject: `${ctx.firstName}, you got your first real test result`,
        bodyText:
`Hey ${ctx.firstName},

This is the email I was hoping to send you. Your campaign is past 100 visitors and we've recorded real revenue events. You're now in the small group of users actually GETTING ANSWERS from SiteAmoeba.

Three things to do this week:

1. Open the dashboard and read the variant comparison — the brain has already analyzed it
2. Promote the winner (if there is one) — the page applies it automatically
3. Start your next test on whichever section had the next-biggest opportunity

→ See your results: ${dashUrl}

Hit reply and tell me what you're testing next. I'll point at any landmines I see based on what other users in your niche have already learned.${SIGNATURE}`,
        bodyHtml:
`<p>Hey ${ctx.firstName},</p>
<p>This is the email I was hoping to send you. Your campaign is past 100 visitors and we've recorded real revenue events. You're now in the small group of users actually <strong>GETTING ANSWERS</strong> from SiteAmoeba.</p>
<p><strong>Three things to do this week:</strong></p>
<ol>
  <li>Open the dashboard and read the variant comparison — the brain has already analyzed it</li>
  <li>Promote the winner (if there is one) — the page applies it automatically</li>
  <li>Start your next test on whichever section had the next-biggest opportunity</li>
</ol>
<p><a href="${dashUrl}" style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">See your results →</a></p>
<p>Hit reply and tell me what you're testing next. I'll point at any landmines I see based on what other users in your niche have already learned.${SIGNATURE_HTML}</p>`,
      };
  }
}
