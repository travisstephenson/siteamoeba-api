/**
 * Generates the complete SiteAmoeba widget JavaScript as a string.
 * This is served via GET /api/widget/script/:campaignId with Content-Type: application/javascript.
 * It includes variant assignment + behavioral tracking.
 */
export function generateWidgetScript(apiBase: string, campaignId: number): string {
  return `(function(){
  var API = "${apiBase}";
  var CID = ${campaignId};

  // === VISITOR ID (resilient fallback chain) ===
  var vid = null;
  var vidStore = "none";

  // Try 1: localStorage (most common, survives page reloads)
  try {
    vid = localStorage.getItem("sa_vid");
    if (vid) vidStore = "ls";
  } catch(e) {}

  // Try 2: sessionStorage (survives within same tab session)
  if (!vid) {
    try {
      vid = sessionStorage.getItem("sa_vid");
      if (vid) vidStore = "ss";
    } catch(e) {}
  }

  // Try 3: Cookie fallback (works when storage APIs are blocked)
  if (!vid) {
    var match = document.cookie.match(/sa_vid=([^;]+)/);
    if (match) { vid = match[1]; vidStore = "ck"; }
  }

  // Generate new ID if none found
  if (!vid) {
    vid = "v_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
  }

  // Store in ALL available locations for maximum persistence
  try { localStorage.setItem("sa_vid", vid); } catch(e) {}
  try { sessionStorage.setItem("sa_vid", vid); } catch(e) {}
  try { document.cookie = "sa_vid=" + vid + ";path=/;max-age=31536000;SameSite=Lax"; } catch(e) {}

  // === DEVICE FINGERPRINT (4th fallback for Safari ITP + private mode) ===
  // Deterministic hash of stable browser attributes — lets server re-identify
  // returning visitors even when all client-side storage is cleared.
  var fp = (function() {
    try {
      var raw = [
        navigator.userAgent,
        screen.width + "x" + screen.height + "x" + screen.colorDepth,
        navigator.language,
        (navigator.hardwareConcurrency || 0),
        new Date().getTimezoneOffset(),
        (typeof Intl !== "undefined" ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "") : "")
      ].join("|");
      // Simple djb2-style hash
      var h = 5381;
      for (var i = 0; i < raw.length; i++) {
        h = ((h << 5) + h) ^ raw.charCodeAt(i);
        h = h & h; // keep 32-bit
      }
      return (h >>> 0).toString(36); // unsigned hex-like string
    } catch(e) { return ""; }
  })();

  // === UTM PARAMETERS ===
  var utmParams = (function() {
    var params = {};
    var search = window.location.search;
    if (search) {
      var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
      var pairs = search.substring(1).split("&");
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        if (pair.length === 2 && keys.indexOf(pair[0]) !== -1) {
          params[pair[0]] = decodeURIComponent(pair[1].replace(/\\+/g, " "));
        }
      }
    }
    return params;
  })();

  // === HELPER: Find the innermost text node of an element ===
  // GHL buttons, CTAs, and some headings use nested divs for text.
  // e.g. <button><div class="main-heading-group"><div class="main-heading-button">TEXT</div>...
  // We need to find the actual text-bearing child, not just set textContent on the parent.
  function findTextTarget(el) {
    // Known GHL text container classes
    var GHL_TEXT_CLASSES = [
      "main-heading-button", "main-heading", "button-text",
      "text-output", "heading-text", "hl-text"
    ];
    for (var k = 0; k < GHL_TEXT_CLASSES.length; k++) {
      var inner = el.querySelector("." + GHL_TEXT_CLASSES[k]);
      if (inner && (inner.textContent || "").trim().length > 0) return inner;
    }
    // Fallback: find the deepest child that has meaningful text and no sub-elements with text
    var candidates = el.querySelectorAll("*");
    var bestLeaf = el; // default to the element itself
    for (var c = 0; c < candidates.length; c++) {
      var candidate = candidates[c];
      var directText = (candidate.textContent || "").trim();
      if (directText.length > 2 && candidate.children.length === 0) {
        bestLeaf = candidate;
        break;
      }
    }
    return bestLeaf;
  }

  // === HELPER: Apply text to an element ===
  // category is required to choose the right strategy:
  //   - Buttons/CTAs: drill into the inner text-bearing child (GHL buttons are deeply nested)
  //   - Everything else (headlines, paragraphs, etc.): set textContent directly on the element.
  //     Setting textContent on the element replaces ALL child nodes cleanly.
  //     Do NOT drill into child spans — that would put the new text inside a colored span
  //     (e.g. the orange "Offer-Ad Loop" span) instead of replacing the whole headline.
  function applyTextToElement(el, text, testMethod, category) {
    if (testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(text)) {
      el.innerHTML = text;
      return;
    }
    if (category === "cta") {
      // Buttons have deeply nested text in GHL — find the actual text child
      var target = findTextTarget(el);
      target.textContent = text;
      return;
    }
    // === PRESERVE TEXT COLOR ===
    // Many page builders (GHL, Wix, WordPress Elementor) put text inside
    // <span style="color: white"> or similar. When we set textContent, the span
    // is destroyed and the text falls back to black (browser default).
    // Solution: capture the computed color BEFORE the swap, then apply it
    // directly to the parent element after replacement.
    var computedColor = "";
    try {
      // Check the first text-bearing child for its color
      var colorSource = el.querySelector("span, strong, em, b, i") || el;
      var cs = window.getComputedStyle(colorSource);
      computedColor = cs.color || "";
      // Also capture font-family if it's set on the inner span (not inherited from body)
      var computedFont = cs.fontFamily || "";
      var bodyFont = window.getComputedStyle(document.body).fontFamily || "";
    } catch(e) {}

    // Replace the entire element's content
    el.textContent = text;

    // Restore the color if it was set (and isn't just black/default)
    if (computedColor && computedColor !== "rgb(0, 0, 0)" && computedColor !== "rgba(0, 0, 0, 0)") {
      el.style.color = computedColor;
    }
    // Restore font-family if the inner span had a custom one
    if (computedFont && computedFont !== bodyFont) {
      el.style.fontFamily = computedFont;
    }
  }

  // === HELPER: Apply variant text to a section ===
  // DESIGN PRINCIPLE: Preserve the original page formatting.
  // Three strategies for finding the right element:
  //   1. Use the stored CSS selector directly
  //   2. If selector fails (GHL regenerates class names), find by control text fingerprint
  //   3. For buttons/CTAs, also search by element type + text content
  // When a selector targets multiple elements (multi-line headlines),
  // distribute text proportionally — each element keeps its own CSS.
  // === ELEMENT LOOKUP — platform-agnostic, 3-strategy cascade ===
  // Returns an array of DOM elements to update.
  // Strategy order is designed to work across GHL, Shopify, WordPress, Clickfunnels, etc.
  function findElements(selector, currentText, controlText, category) {
    var elements = [];

    // STRATEGY 1: Exact CSS selector
    // Fastest. Works if the page hasn't been republished since the scan.
    // GHL, Clickfunnels, and some builders regenerate these on every publish,
    // so this may fail — that's why we have fallbacks.
    if (selector) {
      var parts = selector.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      for (var i = 0; i < parts.length; i++) {
        try {
          var matches = document.querySelectorAll(parts[i]);
          for (var j = 0; j < matches.length; j++) {
            if (elements.indexOf(matches[j]) === -1) elements.push(matches[j]);
          }
        } catch(e) {}
      }
    }
    // CRITICAL: If the selector matched multiple elements (e.g. "h1:first-of-type" on a GHL page
    // matches EVERY h1 that is first-in-its-parent), filter down to only the element that actually
    // contains the expected control text. Without this, text gets distributed across 20+ H1s.
    if (elements.length > 1) {
      var fp = (currentText || controlText || "").trim().toLowerCase();
      var fpTokens = fp.split(/ +/).filter(function(w) { return w.length > 2; }).slice(0, 6);
      if (fpTokens.length >= 2) {
        var filtered = [];
        for (var fi = 0; fi < elements.length; fi++) {
          var elTxt = (elements[fi].textContent || "").trim().toLowerCase();
          var hits = 0;
          for (var ft = 0; ft < fpTokens.length; ft++) { if (elTxt.indexOf(fpTokens[ft]) !== -1) hits++; }
          // Require 50%+ of tokens to match — enough to be confident it's the right element
          if (hits >= Math.ceil(fpTokens.length * 0.5)) filtered.push(elements[fi]);
        }
        if (filtered.length > 0) elements = filtered;
      }
    }
    if (elements.length > 0) return elements;

    // STRATEGY 2: Find by actual page text captured at scan time (currentText)
    // This is the PRIMARY cross-platform approach. Text content is platform-agnostic.
    // Works on GHL, Shopify, WordPress, Webflow, Clickfunnels, custom HTML — everything.
    // Uses token scoring so minor text changes (added words, punctuation) still match.
    var fingerprints = [currentText, controlText].filter(Boolean);
    for (var fp = 0; fp < fingerprints.length; fp++) {
      var tokens = (fingerprints[fp] || "").trim().toLowerCase().split(/ +/).filter(function(w) { return w.length > 2; });
      if (tokens.length === 0) continue;

      // Choose candidate tags based on element category
      var isCTA = category === "cta" || category === "button";
      var tagSets = isCTA
        ? ["button", "[class*='btn']", "[class*='cbutton']", "[class*='cta']", "a[href*='#']", "a"]
        : ["h1", "h2", "h3", "[class*='heading']", "[class*='cheading']", "[class*='title']", "p"];

      var bestScore = 0;
      var bestEl = null;
      for (var ts = 0; ts < tagSets.length; ts++) {
        try {
          var candidates = document.querySelectorAll(tagSets[ts]);
          for (var ci = 0; ci < candidates.length; ci++) {
            var candidateText = (candidates[ci].textContent || "").trim().toLowerCase();
            if (candidateText.length < 2) continue;
            // Score: how many of our tokens appear in this candidate?
            var score = 0;
            for (var ti = 0; ti < tokens.length; ti++) {
              if (candidateText.indexOf(tokens[ti]) !== -1) score++;
            }
            // Require 60%+ token match (generous enough for minor text changes,
            // strict enough to avoid false positives on unrelated elements)
            var threshold = Math.max(1, Math.ceil(tokens.length * 0.6));
            if (score >= threshold && score > bestScore) {
              bestScore = score;
              bestEl = candidates[ci];
            }
          }
        } catch(e) {}
      }
      if (bestEl) { elements.push(bestEl); break; }
    }
    if (elements.length > 0) return elements;

    // STRATEGY 3: Broader fallback — any visible text node that partially overlaps
    // Last resort. Searches all block-level elements for any token overlap.
    if (fingerprints.length > 0) {
      var anyTokens = (fingerprints[0] || "").trim().toLowerCase().split(/ +/)
        .filter(function(w) { return w.length > 3; }).slice(0, 3);
      if (anyTokens.length > 0) {
        var allEls = document.querySelectorAll("h1,h2,h3,h4,p,button,a,span,div");
        for (var ai = 0; ai < allEls.length; ai++) {
          if (allEls[ai].children.length > 5) continue; // skip complex containers
          var t = (allEls[ai].textContent || "").trim().toLowerCase();
          if (t.length < 3 || t.length > 500) continue;
          for (var at = 0; at < anyTokens.length; at++) {
            if (t.indexOf(anyTokens[at]) !== -1) {
              elements.push(allEls[ai]);
              break;
            }
          }
          if (elements.length >= 3) break;
        }
      }
    }

    return elements;
  }

  // === POST-APPLY VALIDATION ===
  // Checks that the variant text actually appeared in the element after the swap.
  // Returns true if the render looks correct, false if it appears broken.
  // Broken = fewer than 40% of the first 6 content words of the variant are found in the element.
  function validateRender(el, variantText) {
    if (!el || !variantText) return true;
    var actual = (el.textContent || "").trim().toLowerCase();
    var words = variantText.trim().toLowerCase().split(/ +/).filter(function(w) { return w.length > 2; }).slice(0, 6);
    if (words.length < 2) return true; // too short to validate
    var found = 0;
    for (var i = 0; i < words.length; i++) { if (actual.indexOf(words[i]) !== -1) found++; }
    return found >= Math.ceil(words.length * 0.4);
  }

  // Reports a display issue to the server — fire and forget via image beacon.
  // Never throws; failures are swallowed so a logging error can't affect the page.
  function reportDisplayIssue(variantId, reason, extra) {
    try {
      var img = new Image();
      var url = API + "/api/widget/flag-variant?vid=" + encodeURIComponent(vid || "")
              + "&variantId=" + encodeURIComponent(variantId || "")
              + "&cid=" + encodeURIComponent(String(CID))
              + "&reason=" + encodeURIComponent(reason || "display_check_failed");
      if (extra && extra.matchRatio !== undefined) {
        url += "&matchRatio=" + extra.matchRatio.toFixed(2);
      }
      img.src = url;
    } catch(e) {}
  }

  function applySectionVariant(selector, text, testMethod, controlText, category, currentText, variantId) {
    if (!text) return;

    var allElements = findElements(selector, currentText, controlText, category);
    console.log("[SA] applySectionVariant", category, "found", allElements.length, "elements", "selector:", selector);

    // === CONTENT MISMATCH DETECTION ===
    // If the page's actual content has changed since the scan (user edited their page),
    // the control text won't match what's on the page. Swapping in a variant would
    // replace NEW content the user intentionally put there, causing confusion.
    // Skip the swap and report the mismatch so the user knows to re-scan.
    if (allElements.length > 0 && controlText) {
      var pageText = "";
      for (var pt = 0; pt < allElements.length; pt++) pageText += " " + (allElements[pt].textContent || "");
      pageText = pageText.trim().toLowerCase().replace(/\s+/g, " ");
      var ctrlText = (controlText || "").trim().toLowerCase().replace(/\s+/g, " ");
      // Tokenize and check overlap
      var ctrlTokens = ctrlText.split(" ").filter(function(w) { return w.length > 3; });
      var matchCount = 0;
      for (var mt = 0; mt < ctrlTokens.length; mt++) {
        if (pageText.indexOf(ctrlTokens[mt]) !== -1) matchCount++;
      }
      var matchRatio = ctrlTokens.length > 0 ? matchCount / ctrlTokens.length : 1;
      if (matchRatio < 0.35 && ctrlTokens.length >= 3) {
        // Page content has changed significantly since the scan
        console.warn("[SA] CONTENT MISMATCH: page " + category + " text does not match control (" + (matchRatio * 100).toFixed(0) + "% match). Skipping swap. Please re-scan your page.");
        console.warn("[SA]   Page has: '" + pageText.substring(0, 80) + "...'");
        console.warn("[SA]   Control: '" + ctrlText.substring(0, 80) + "...'");
        // Report the mismatch to the server so it shows in the dashboard
        reportDisplayIssue(variantId, "content_mismatch", {
          pageText: pageText.substring(0, 200),
          controlText: ctrlText.substring(0, 200),
          matchRatio: matchRatio
        });
        return; // Do NOT apply the swap
      }
    }

    // For headline/subheadline/cta: ensure we have the right element(s).
    // On GHL, CSS selectors with comma-separated classes (multi-line headings) may
    // correctly return 2-3 elements that form ONE visual headline — keep them all.
    // On GHL with generic selectors (h1:first-of-type), Strategy 1 returns many wrong
    // elements — in that case, search all page elements for the best text match.
    var isInlineCategory = category === "headline" || category === "subheadline" || category === "cta" || category === "button";
    if (isInlineCategory && allElements.length !== 0) {
      // Check if the combined text of allElements matches the control text well
      var combinedText = "";
      for (var ce = 0; ce < allElements.length; ce++) combinedText += " " + (allElements[ce].textContent || "");
      combinedText = combinedText.trim().toLowerCase();
      var fp2 = (currentText || controlText || "").trim().toLowerCase();
      var fpToks2 = fp2.split(/ +/).filter(function(w) { return w.length > 2; });
      var combinedScore = 0;
      for (var cs = 0; cs < fpToks2.length; cs++) { if (combinedText.indexOf(fpToks2[cs]) !== -1) combinedScore++; }
      console.log("[SA] combined score:", combinedScore + "/" + fpToks2.length, "elements:", allElements.length);
      
      // If combined elements match well (>60%), keep them all (multi-line heading)
      if (combinedScore >= Math.ceil(fpToks2.length * 0.6)) {
        // Good match — keep allElements as-is for text distribution
      } else {
        // Poor match — CSS selector returned wrong elements.
        // Search ALL page elements for the single best text match.
        var tagSearch = category === "cta" || category === "button"
          ? ["button", "a", "span"]
          : ["h1", "h2", "h3", "[class*='heading']", "[class*='cheading']", "[class*='title']"];
        var bestEl2 = null;
        var bestScore2 = 0;
        for (var ts2 = 0; ts2 < tagSearch.length; ts2++) {
          try {
            var cands2 = document.querySelectorAll(tagSearch[ts2]);
            for (var ci2 = 0; ci2 < cands2.length; ci2++) {
              var elTxt2 = (cands2[ci2].textContent || "").trim().toLowerCase();
              var sc2 = 0;
              for (var bj = 0; bj < fpToks2.length; bj++) { if (elTxt2.indexOf(fpToks2[bj]) !== -1) sc2++; }
              if (sc2 > bestScore2) { bestScore2 = sc2; bestEl2 = cands2[ci2]; }
            }
          } catch(e2) {}
        }
        if (bestEl2 && bestScore2 >= Math.ceil(fpToks2.length * 0.5)) {
          console.log("[SA] fallback best match:", bestScore2 + "/" + fpToks2.length, "text:", (bestEl2.textContent||"").substring(0,60));
          allElements = [bestEl2];
        }
      }
    }

    if (allElements.length === 0) {
      console.log("[SA] element not found | selector:", selector, "| fingerprint:", (currentText || controlText || "").substring(0, 40));
      return;
    }

    // Skip if already applied (prevents retry loops from double-swapping)
    if (allElements[0] && allElements[0].getAttribute("data-sa-swapped") === "true") {
      return;
    }

    // Save originals for safe revert if validation fails
    var originals = [];
    for (var oi = 0; oi < allElements.length; oi++) {
      originals.push(allElements[oi].textContent || "");
    }

    // === SINGLE ELEMENT: simple replacement ===
    if (allElements.length === 1) {
      applyTextToElement(allElements[0], text, testMethod, category);
      // === SAFETY CHECK ===
      if (!validateRender(allElements[0], text)) {
        allElements[0].textContent = originals[0]; // revert to control — safe state
        reportDisplayIssue(variantId, "single_element_mismatch");
        console.warn("SiteAmoeba: variant display check failed, reverted to control", selector);
      } else {
        allElements[0].setAttribute("data-sa-swapped", "true");
      }
      return;
    }

    // === MULTI-ELEMENT: distribute text proportionally ===
    // Measure original char counts to establish the visual ratio
    var originalLengths = [];
    var totalOrigLen = 0;
    for (var m = 0; m < allElements.length; m++) {
      var len = (allElements[m].textContent || "").trim().length || 1;
      originalLengths.push(len);
      totalOrigLen += len;
    }

    // Split variant text into words
    var words = text.split(/ +/).filter(Boolean);
    if (words.length === 0) return;

    // Distribute words across elements proportionally
    var lines = [];
    var wordIndex = 0;
    for (var el = 0; el < allElements.length; el++) {
      var ratio = originalLengths[el] / totalOrigLen;
      var targetWords = Math.max(1, Math.round(ratio * words.length));
      if (el === allElements.length - 1) {
        lines.push(words.slice(wordIndex).join(" "));
      } else {
        lines.push(words.slice(wordIndex, wordIndex + targetWords).join(" "));
        wordIndex += targetWords;
        if (wordIndex >= words.length) wordIndex = words.length;
      }
    }

    // Apply each line to its corresponding element
    for (var n = 0; n < allElements.length; n++) {
      var lineText = lines[n] || "";
      if (!lineText) {
        allElements[n].style.display = "none";
        allElements[n].setAttribute("data-sa-hidden", "true");
      } else {
        applyTextToElement(allElements[n], lineText, testMethod, category);
      }
    }

    // === SAFETY CHECK for multi-element ===
    // Validate that the primary element shows a reasonable portion of the variant text.
    // If distribution looks wrong, revert all elements to originals.
    var renderOk = validateRender(allElements[0], text);
    console.log("[SA] validateRender:", renderOk, "| el text after swap:", (allElements[0].textContent||"").substring(0,60));
    if (!renderOk) {
      for (var rv = 0; rv < allElements.length; rv++) {
        allElements[rv].textContent = originals[rv];
        allElements[rv].style.display = "";
        allElements[rv].removeAttribute("data-sa-hidden");
      }
      reportDisplayIssue(variantId, "multi_element_mismatch");
      console.warn("[SA] validateRender FAILED — reverted to original. selector:", selector);
    }
  }

  // === HELPER: Fallback for legacy responses without selector ===
  function applyLegacyVariant(tagName, text, testMethod) {
    if (!text) return;
    var el = document.querySelector(tagName);
    if (!el) return;
    if (testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(text)) {
      el.innerHTML = text;
    } else {
      el.textContent = text;
    }
  }

  // === POST-REPLACEMENT INTEGRITY CHECK ===
  // After applying all variants, scan for duplicate visible text that would look broken
  function postReplacementCheck() {
    // Gather all visible H1 text on the page
    var h1s = document.querySelectorAll("h1");
    var visibleTexts = [];
    for (var i = 0; i < h1s.length; i++) {
      if (h1s[i].offsetParent !== null && !h1s[i].getAttribute("data-sa-hidden")) {
        var t = (h1s[i].textContent || "").trim();
        if (t.length > 10) visibleTexts.push({ el: h1s[i], text: t });
      }
    }
    // Check for substantial text overlap between visible H1s
    for (var a = 0; a < visibleTexts.length; a++) {
      for (var b = a + 1; b < visibleTexts.length; b++) {
        // If one H1's text contains or substantially overlaps another's, hide the duplicate
        if (visibleTexts[a].text.indexOf(visibleTexts[b].text) !== -1 ||
            visibleTexts[b].text.indexOf(visibleTexts[a].text) !== -1) {
          // Hide the shorter/later one
          visibleTexts[b].el.style.display = "none";
          visibleTexts[b].el.setAttribute("data-sa-hidden", "true");
        }
      }
    }
  }

  // === PREVIEW MODE DETECTION ===
  // If URL has ?sa_preview=VARIANT_ID, skip normal assignment and apply that specific variant.
  // This lets the dashboard show an accurate preview on the ACTUAL live page.
  var previewMatch = window.location.search.match(/[?&]sa_preview=(\\d+)/);
  var previewToken = (window.location.search.match(/[?&]sa_token=([^&]+)/) || [])[1] || "";
  var isPreviewMode = !!previewMatch;

  // Direct text finder — searches ALL elements of a type for the best text match.
  // Simpler and more reliable than the selector+fallback cascade, used for preview mode.
  function directTextFind(controlText, category) {
    var tags = category === "cta" ? "button, a, [class*='btn']" : "h1, h2, h3, [class*='heading'], [class*='title']";
    var candidates = document.querySelectorAll(tags);
    var ctrlWords = (controlText || "").trim().toLowerCase().split(/ +/).filter(function(w) { return w.length > 3; });
    if (ctrlWords.length === 0) return null;
    var bestEl = null;
    var bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var elText = (el.textContent || "").trim().toLowerCase();
      if (elText.length < 10) continue;
      var score = 0;
      for (var j = 0; j < ctrlWords.length; j++) {
        if (elText.indexOf(ctrlWords[j]) !== -1) score++;
      }
      if (score > bestScore) { bestScore = score; bestEl = el; }
    }
    // Require at least 40% word overlap
    if (bestEl && bestScore >= Math.ceil(ctrlWords.length * 0.4)) {
      console.log("[SA] directTextFind: matched", bestScore + "/" + ctrlWords.length, "words in", bestEl.tagName, "text:", (bestEl.textContent||"").substring(0,50));
      return bestEl;
    }
    console.log("[SA] directTextFind: no match found. Best:", bestScore + "/" + ctrlWords.length);
    return null;
  }

  function handleAssignData(data) {
      // Apply headline variant — SKIP if control (let original page be the control)
      if (data.headline && data.headline.text && !data.headline.isControl) {
        // In preview mode, try a direct text-match approach first
        // (more reliable on pages with many H1s where selector-based matching struggles)
        if (isPreviewMode && data.headline.controlText) {
          var directMatch = directTextFind(data.headline.controlText, "headline");
          if (directMatch) {
            applyTextToElement(directMatch, data.headline.text, data.headline.testMethod || "text_swap", "headline");
            directMatch.setAttribute("data-sa-swapped", "true");
            console.log("[SA] preview: direct text match applied for headline");
          } else {
            // Fall back to normal approach
            applySectionVariant(
              data.headline.selector, data.headline.text,
              data.headline.testMethod || "text_swap",
              data.headline.controlText, data.headline.category || "headline",
              data.headline.currentText, data.headline.id
            );
          }
        } else {
          applySectionVariant(
            data.headline.selector, data.headline.text,
            data.headline.testMethod || "text_swap",
            data.headline.controlText, data.headline.category || "headline",
            data.headline.currentText, data.headline.id
          );
        }
      }
      // Apply subheadline variant — SKIP if control
      if (data.subheadline && data.subheadline.text && !data.subheadline.isControl) {
        if (isPreviewMode && data.subheadline.controlText) {
          var directSubMatch = directTextFind(data.subheadline.controlText, "subheadline");
          if (directSubMatch) {
            applyTextToElement(directSubMatch, data.subheadline.text, data.subheadline.testMethod || "text_swap", "subheadline");
            directSubMatch.setAttribute("data-sa-swapped", "true");
            console.log("[SA] preview: direct text match applied for subheadline");
          } else {
            applySectionVariant(
              data.subheadline.selector, data.subheadline.text,
              data.subheadline.testMethod || "text_swap",
              data.subheadline.controlText, data.subheadline.category || "subheadline",
              data.subheadline.currentText, data.subheadline.id
            );
          }
        } else {
          applySectionVariant(
            data.subheadline.selector, data.subheadline.text,
            data.subheadline.testMethod || "text_swap",
            data.subheadline.controlText, data.subheadline.category || "subheadline",
            data.subheadline.currentText, data.subheadline.id
          );
        }
      }
      // Apply section variants (body_copy, CTAs, etc.) — SKIP controls
      if (data.sections && Array.isArray(data.sections)) {
        data.sections.forEach(function(sv) {
          if (!sv || !sv.text || sv.isControl) return;
          applySectionVariant(
            sv.selector, sv.text, sv.testMethod || "text_swap",
            sv.controlText, sv.category, sv.currentText, sv.id
          );
        });
      }
      // Final page integrity check — only if any non-control variants were applied
      var anyApplied = (data.headline && !data.headline.isControl) || (data.subheadline && !data.subheadline.isControl);
      if (anyApplied) postReplacementCheck();

      // Activate auto lead conversion tracking for lead_gen campaigns
      if (data.campaignType === "lead_gen" && !window._saLeadTrackingInited) {
        window._saLeadTrackingInited = true;
        if (typeof window._saInitLeadTracking === "function") {
          window._saInitLeadTracking();
        }
      }
  }

  // === VARIANT ASSIGNMENT (preview vs live) ===
  if (isPreviewMode) {
    // PREVIEW MODE: fetch the specific variant from the preview-data endpoint
    var previewVid = previewMatch[1];
    fetch(API + "/api/widget/preview-data?cid=" + CID + "&variantId=" + previewVid + "&token=" + encodeURIComponent(previewToken))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Surface API errors (e.g. invalid/expired token) instead of silently failing
        if (data.error) {
          console.warn("SiteAmoeba preview error:", data.error);
          return;
        }
        // Retry with delays for dynamic pages (GHL, Webflow etc. render content after load)
        // In preview mode: attempt to apply on every retry until it succeeds
        // Retry with delays for dynamic pages — but only apply ONCE
        var retries = [0, 400, 1200, 2500, 5000];
        var applied = false;
        retries.forEach(function(delay) {
          setTimeout(function() {
            if (applied) return;
            // Check if the variant text is already on the page (from a prior retry)
            var checks = [];
            if (data.headline && !data.headline.isControl) checks.push(data.headline);
            if (data.subheadline && !data.subheadline.isControl) checks.push(data.subheadline);
            if (data.sections) data.sections.forEach(function(s) { if (!s.isControl) checks.push(s); });
            for (var i = 0; i < checks.length; i++) {
              var v = checks[i];
              if (!v || !v.text) continue;
              var variantWords = v.text.toLowerCase().split(/ +/).filter(function(w) { return w.length > 4; }).slice(0, 5);
              var pageText = document.body.textContent.toLowerCase();
              var hits = 0;
              for (var w = 0; w < variantWords.length; w++) {
                if (pageText.indexOf(variantWords[w]) !== -1) hits++;
              }
              if (hits >= Math.ceil(variantWords.length * 0.5)) { applied = true; return; }
            }
            // Not yet applied — try now
            handleAssignData(data);
            // Mark as applied optimistically (the safety checks inside will revert if it failed)
            applied = true;
          }, delay);
        });
      })
      .catch(function(e) { console.warn("SiteAmoeba preview: fetch error", e); });
  } else {
    // NORMAL MODE: standard variant assignment
    var assignUrl = API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer) + (fp ? "&fp=" + fp : "");
    if (utmParams.utm_source)   assignUrl += "&utm_source="   + encodeURIComponent(utmParams.utm_source);
    if (utmParams.utm_medium)   assignUrl += "&utm_medium="   + encodeURIComponent(utmParams.utm_medium);
    if (utmParams.utm_campaign) assignUrl += "&utm_campaign=" + encodeURIComponent(utmParams.utm_campaign);
    if (utmParams.utm_content)  assignUrl += "&utm_content="  + encodeURIComponent(utmParams.utm_content);
    if (utmParams.utm_term)     assignUrl += "&utm_term="     + encodeURIComponent(utmParams.utm_term);
    fetch(assignUrl)
      .then(function(r) {
        if (!r.ok) { console.log("SiteAmoeba: assign error", r.status); return null; }
        return r.json();
      })
      .then(function(data) { if (data) handleAssignData(data); })
      .catch(function(e) { console.log("SiteAmoeba: using defaults", e); });
  }

  // Capture element styles for dashboard preview (fire-and-forget)
  // Runs once on first page load; subsequent loads are skipped server-side if styles already stored
  try {
    var styleElements = {};
    var selectors = {"h1": "headline", "h2": "subheadline", "h3": "section_header"};
    // Also try common button/CTA selectors
    var ctaSelectors = ["a.btn", "button.cta", "a.cta", ".hero a", ".hero button", "a[href*='checkout']", "a[href*='order']", ".btn-primary", ".cta-button", ".button", "button[type='submit']"];

    Object.keys(selectors).forEach(function(sel) {
      var el = document.querySelector(sel);
      if (el) {
        var cs = window.getComputedStyle(el);
        var bgColor = cs.backgroundColor;
        // Walk up the DOM to find a non-transparent background color
        if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {
          var parent = el.parentElement;
          while (parent && parent !== document.body) {
            var pcs = window.getComputedStyle(parent);
            if (pcs.backgroundColor !== "transparent" && pcs.backgroundColor !== "rgba(0, 0, 0, 0)") {
              bgColor = pcs.backgroundColor;
              break;
            }
            parent = parent.parentElement;
          }
          if (bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {
            bgColor = window.getComputedStyle(document.body).backgroundColor;
          }
        }
        styleElements[selectors[sel]] = {
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          color: cs.color,
          backgroundColor: bgColor,
          textAlign: cs.textAlign,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform
        };
      }
    });

    // Try CTA selectors
    for (var i = 0; i < ctaSelectors.length; i++) {
      var ctaEl = document.querySelector(ctaSelectors[i]);
      if (ctaEl) {
        var ctaCs = window.getComputedStyle(ctaEl);
        styleElements["cta"] = {
          fontFamily: ctaCs.fontFamily,
          fontSize: ctaCs.fontSize,
          fontWeight: ctaCs.fontWeight,
          color: ctaCs.color,
          backgroundColor: ctaCs.backgroundColor,
          textAlign: ctaCs.textAlign,
          lineHeight: ctaCs.lineHeight,
          letterSpacing: ctaCs.letterSpacing,
          textTransform: ctaCs.textTransform,
          borderRadius: ctaCs.borderRadius,
          padding: ctaCs.padding
        };
        break;
      }
    }

    if (Object.keys(styleElements).length > 0) {
      fetch(API + "/api/widget/styles", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({cid: CID, styles: styleElements})
      }).catch(function(){});
    }
  } catch(e) {}

  // === BEHAVIORAL TRACKING ===
  var events = [];
  var startTime = Date.now();
  var activeTime = 0;          // milliseconds of VISIBLE time only
  var tabHiddenAt = 0;         // timestamp when tab was hidden (0 = currently visible)
  var maxScroll = 0;
  var device = window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";

  // Single visibilitychange handler — manages active time AND sends data
  // This fires BEFORE the heartbeat and beforeunload handlers below
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") {
      // Accumulate active time and mark as hidden
      if (tabHiddenAt === 0) {
        activeTime += (Date.now() - startTime);
        tabHiddenAt = Date.now();
      }
    } else {
      // Tab visible again — reset the start reference
      if (tabHiddenAt > 0) {
        startTime = Date.now();
        tabHiddenAt = 0;
      }
    }
  });

  function getActiveSeconds() {
    // activeTime = accumulated ms from previous visible periods
    // If tab is currently visible, add the current visible period
    var current = tabHiddenAt === 0 ? (Date.now() - startTime) : 0;
    var total = Math.round((activeTime + current) / 1000);
    // Cap at 30 minutes — anything over is a backgrounded/abandoned tab
    return Math.min(total, 1800);
  }

  // Scroll tracking (throttled) — always update maxScroll, push events at milestones
  var scrollTimeout;
  var scrollMilestones = {};
  window.addEventListener("scroll", function() {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function() {
      var depth = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);
      if (depth > maxScroll) {
        maxScroll = depth;
        // Push milestone events for key thresholds (only once each)
        var milestones = [25, 50, 75, 100];
        for (var m = 0; m < milestones.length; m++) {
          if (depth >= milestones[m] && !scrollMilestones[milestones[m]]) {
            scrollMilestones[milestones[m]] = true;
            events.push({type: "scroll", data: JSON.stringify({depth: milestones[m]}), ts: Date.now()});
          }
        }
      }
    }, 200);
  });

  // Section visibility (Intersection Observer)
  if (window.IntersectionObserver) {
    var sections = document.querySelectorAll("section, [class*='section'], [id*='section'], .container > div, main > div");
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id || entry.target.className.split(" ")[0] || "section_" + Array.from(entry.target.parentNode.children).indexOf(entry.target);
          events.push({type: "section_view", data: JSON.stringify({section: id}), ts: Date.now()});
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    sections.forEach(function(s) { observer.observe(s); });
  }

  // === SECTION MAP: Build a structured map of page sections for drop-off analysis ===
  var sectionMap = null;
  var sectionMapSent = false;
  function buildSectionMap() {
    try {
      var pageH = document.documentElement.scrollHeight || 1;
      // Classify section by its content — look for keywords in headings, ids, classes
      var classifyKeywords = {
        hero: /hero|banner|above.?fold|masthead|jumbotron/i,
        headline: /^h[12]$|headline|main.?title/i,
        subheadline: /subtitle|sub.?head|tagline/i,
        problem: /problem|pain|struggle|frustrat|challenge/i,
        solution: /solution|answer|resolve|how.?it.?works/i,
        benefits: /benefit|advantage|feature|what.?you.?get/i,
        social_proof: /social.?proof|as.?seen|logo|trust|partner/i,
        testimonials: /testimonial|review|what.?people|customer.?say|success.?stor/i,
        case_study: /case.?study|result|outcome/i,
        pricing: /pricing|price|plan|tier|cost|buy|purchase|order|checkout/i,
        guarantee: /guarantee|refund|money.?back|risk.?free|no.?risk/i,
        faq: /faq|question|ask|q\s*&\s*a/i,
        cta: /cta|call.?to.?action|sign.?up|register|get.?started|buy.?now|order.?now|enroll/i,
        about: /about|who.?we|our.?story|our.?mission|founder|team/i,
        bonus: /bonus|extra|free.?gift|included/i,
        scarcity: /limited|hurry|expir|countdown|urgent|only.*left/i,
        footer: /footer|copyright|bottom/i,
        video: /video|watch|play/i
      };

      function classifyEl(el) {
        // Check id, class, and heading text for classification keywords
        var searchText = (el.id || "") + " " + (el.className || "") + " ";
        // Get the first heading inside
        var heading = el.querySelector("h1, h2, h3, h4");
        var headingText = heading ? (heading.innerText || "").substring(0, 120) : "";
        searchText += headingText;
        // Also check for specific elements
        if (el.querySelector("video, iframe[src*='youtube'], iframe[src*='vimeo']")) searchText += " video";
        if (el.querySelector("form")) searchText += " form cta";
        if (el.querySelector("[class*='price'], [class*='pricing']")) searchText += " pricing";
        if (el.querySelector("blockquote, [class*='testimonial'], [class*='review']")) searchText += " testimonial";
        for (var key in classifyKeywords) {
          if (classifyKeywords[key].test(searchText)) return key;
        }
        return "content";
      }

      // Find meaningful top-level sections — filter out tiny ones
      var candidates = document.querySelectorAll("section, [class*='section'], [role='region'], main > div, .container > div, #content > div, [class*='block'], [class*='row']");
      var map = [];
      var seen = {};
      candidates.forEach(function(el) {
        // Skip tiny sections (< 100px tall) and invisible ones
        var rect = el.getBoundingClientRect();
        var absTop = rect.top + window.scrollY;
        var height = rect.height;
        if (height < 100 || rect.width < 200) return;
        // Skip nested sections — if parent is already in our list, skip
        var key = Math.round(absTop / 50) + "_" + Math.round(height / 50);
        if (seen[key]) return;
        seen[key] = true;
        var offsetPct = Math.round(absTop / pageH * 100);
        var label = classifyEl(el);
        var heading = el.querySelector("h1, h2, h3, h4");
        var headingText = heading ? (heading.innerText || "").substring(0, 100).trim() : "";
        map.push({
          idx: map.length,
          offsetPct: offsetPct,
          heightPct: Math.round(height / pageH * 100),
          label: label,
          heading: headingText,
          id: el.id || ""
        });
      });
      // Sort by position and limit to top 20
      map.sort(function(a, b) { return a.offsetPct - b.offsetPct; });
      map = map.slice(0, 20);
      // Re-index
      map.forEach(function(s, i) { s.idx = i; });
      if (map.length >= 3) sectionMap = map;
    } catch(e) { /* non-fatal */ }
  }
  // Build after DOM is likely stable
  setTimeout(buildSectionMap, 3000);

  // Click tracking
  document.addEventListener("click", function(e) {
    var target = e.target;
    var tag = target.tagName;
    var text = (target.innerText || "").substring(0, 50);
    var cls = (target.className || "").substring(0, 50);
    if (tag === "BUTTON" || tag === "A" || target.closest("button") || target.closest("a")) {
      events.push({type: "click", data: JSON.stringify({tag: tag, text: text, class: cls}), ts: Date.now()});
    }
  });

  // Video play tracking
  document.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia']").forEach(function(v) {
    if (v.tagName === "VIDEO") {
      v.addEventListener("play", function() { events.push({type: "video_play", data: "{}", ts: Date.now()}); });
      v.addEventListener("ended", function() { events.push({type: "video_complete", data: "{}", ts: Date.now()}); });
    }
  });

  function sendBatch(batch, timeOnPage) {
    var pageHeight = document.documentElement.scrollHeight || 0;
    var screenWidth = window.innerWidth || 0;
    var payloadObj = {vid: vid, cid: CID, events: batch, timeOnPage: timeOnPage, maxScroll: maxScroll, device: device, pageHeight: pageHeight, screenWidth: screenWidth};
    // Include section map on first send only
    if (sectionMap && !sectionMapSent) {
      payloadObj.sectionMap = sectionMap;
      sectionMapSent = true;
    }
    var payload = JSON.stringify(payloadObj);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API + "/api/widget/events", new Blob([payload], {type: "application/json"}));
    } else {
      fetch(API + "/api/widget/events", {method: "POST", headers: {"Content-Type": "application/json"}, body: payload, keepalive: true}).catch(function(){});
    }
  }

  // Send initial heartbeat after 5 seconds (captures early scroll + device)
  setTimeout(function() {
    var batch = events.splice(0, events.length);
    sendBatch(batch, getActiveSeconds());
  }, 5000);

  // Heartbeat every 15 seconds — skip if tab is hidden
  setInterval(function() {
    if (document.visibilityState === "hidden") return; // don't fire while backgrounded
    var batch = events.splice(0, events.length);
    sendBatch(batch, getActiveSeconds());
  }, 15000);

  // Send on page exit
  window.addEventListener("beforeunload", function() {
    var t = getActiveSeconds();
    events.push({type: "page_exit", data: JSON.stringify({maxScroll: maxScroll, timeOnPage: t}), ts: Date.now()});
    var batch = events.splice(0, events.length);
    sendBatch(batch, t);
  });

  // Send data snapshot whenever tab goes hidden (beacon before browser suspends JS)
  // Note: the visibilitychange handler above has already updated activeTime at this point
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") {
      var batch = events.splice(0, events.length);
      sendBatch(batch, getActiveSeconds());
    }
  });

  // ============================================================
  // AUTO LEAD CONVERSION DETECTION (lead_gen campaigns only)
  // Fires the conversion pixel when a form is successfully
  // submitted on the page — handles GHL inline AJAX success,
  // redirect-based funnels, and any other form framework.
  // ============================================================
  function autoConvert() {
    if (!vid) return;
    var img = new Image();
    img.src = API + "/api/widget/convert?vid=" + encodeURIComponent(vid) + "&cid=" + CID;
  }

  function initLeadTracking() {
    var convertFired = false;

    // 1. Listen for standard form submit events
    document.addEventListener("submit", function(e) {
      if (convertFired) return;
      // Only fire for forms that look like opt-in forms (have an email field)
      var form = e.target;
      if (!form) return;
      var hasEmail = form.querySelector && (
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[name*="email"]') ||
        form.querySelector('input[placeholder*="email"]')
      );
      if (!hasEmail) return;
      // Wait 2s for AJAX submission to complete, then fire
      setTimeout(function() {
        if (!convertFired) {
          convertFired = true;
          autoConvert();
        }
      }, 2000);
    }, true);

    // 2. GHL / funnel builder success state detection via MutationObserver
    // Watches for thank-you text, success messages, or form disappearing
    var successPatterns = [
      "thank you", "thanks!", "you're in", "you are in",
      "check your email", "almost there", "confirmation",
      "successfully", "subscribed", "registered", "signed up"
    ];
    var observer = new MutationObserver(function() {
      if (convertFired) { observer.disconnect(); return; }
      // Check for success text appearing in DOM
      var bodyText = (document.body && document.body.innerText || "").toLowerCase();
      for (var i = 0; i < successPatterns.length; i++) {
        if (bodyText.indexOf(successPatterns[i]) !== -1) {
          // Verify page was NOT showing this text on initial load
          // (checked 3s after widget loaded to establish baseline)
          if (!window._saBaselineText || window._saBaselineText.indexOf(successPatterns[i]) === -1) {
            convertFired = true;
            observer.disconnect();
            autoConvert();
            return;
          }
        }
      }
    });

    // Capture baseline text after 3s (page has fully rendered)
    setTimeout(function() {
      window._saBaselineText = (document.body && document.body.innerText || "").toLowerCase();
      // Start observing after baseline is captured
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true, characterData: false });
      }
    }, 3000);

    // 3. Pass sa_vid through redirect URLs (appends to form action, hidden inputs, and checkout links)
    // This ensures thank-you page pixels can read the vid from URL even when localStorage is unavailable
    // (e.g. cross-domain Stripe/PayPal/ThriveCart checkout then redirected back to same domain)
    function injectSaVid() {
      // 3a. Append to all form action URLs + hidden input
      var forms = document.querySelectorAll("form");
      for (var f = 0; f < forms.length; f++) {
        var action = forms[f].getAttribute("action");
        if (action && action.indexOf("sa_vid") === -1) {
          forms[f].setAttribute("action", action + (action.indexOf("?") !== -1 ? "&" : "?") + "sa_vid=" + vid);
        }
        try {
          var existing = forms[f].querySelector('input[name="sa_vid"]');
          if (!existing) {
            var hidden = document.createElement("input");
            hidden.type = "hidden"; hidden.name = "sa_vid"; hidden.value = vid;
            forms[f].appendChild(hidden);
          }
        } catch(e) {}
      }

      // 3b. Append sa_vid to all checkout/payment links so it survives cross-domain redirect
      // Covers Stripe, ThriveCart, PayPal, Whop, Kajabi, ClickFunnels, GHL, etc.
      // For Stripe Payment Links (buy.stripe.com) we ALSO inject client_reference_id=sa_vid
      // so the Stripe webhook can attribute the purchase directly to this visitor.
      var CHECKOUT_PATTERNS = [
        'checkout.stripe.com', 'buy.stripe.com',
        'thrivecart.com', 'whop.com', 'paypal.com', 'pay.paypal.com',
        'checkout.kajabi.com', 'checkout.clickfunnels.com',
        'squareup.com', 'shop.app', '/checkout', '/buy', '/order'
      ];
      var links = document.querySelectorAll("a[href]");
      for (var l = 0; l < links.length; l++) {
        try {
          var href = links[l].getAttribute("href") || "";
          var isCheckout = false;
          for (var p = 0; p < CHECKOUT_PATTERNS.length; p++) {
            if (href.indexOf(CHECKOUT_PATTERNS[p]) !== -1) { isCheckout = true; break; }
          }
          if (isCheckout && href.indexOf("sa_vid") === -1) {
            var sep = href.indexOf("?") !== -1 ? "&" : "?";
            href = href + sep + "sa_vid=" + vid;
            // For Stripe Payment Links, also inject client_reference_id so the
            // server-side webhook can match the purchase directly to this visitor.
            if (href.indexOf("buy.stripe.com") !== -1 || href.indexOf("checkout.stripe.com") !== -1) {
              href = href + "&client_reference_id=" + vid;
            }
            links[l].setAttribute("href", href);
          }
        } catch(e) {}
      }

      // 3c. Click-time injection: intercept clicks on ANY link and add sa_vid if it goes to a checkout
      // Handles dynamically-generated links and buttons that aren't in the DOM at load time
      if (!window._saClickInjected) {
        window._saClickInjected = true;
        document.addEventListener('click', function(e) {
          try {
            var el = e.target;
            // Walk up to find an anchor
            for (var i = 0; i < 5 && el && el.tagName !== 'A'; i++) el = el.parentElement;
            if (!el || el.tagName !== 'A') return;
            var href = el.getAttribute('href') || '';
            var isCheckout = false;
            for (var p = 0; p < CHECKOUT_PATTERNS.length; p++) {
              if (href.indexOf(CHECKOUT_PATTERNS[p]) !== -1) { isCheckout = true; break; }
            }
            if (isCheckout && href.indexOf('sa_vid') === -1) {
              el.setAttribute('href', href + (href.indexOf('?') !== -1 ? '&' : '?') + 'sa_vid=' + vid);
            }
          } catch(e) {}
        }, true);
      }
    }
    setTimeout(injectSaVid, 800);
    // Re-inject after 3s to catch dynamically rendered checkout buttons (e.g. GHL, ClickFunnels)
    setTimeout(injectSaVid, 3000);
  }

  // initLeadTracking is called after assign response confirms lead_gen campaign
  // (stored globally so handleAssignData can call it)
  window._saInitLeadTracking = initLeadTracking;
  window._saLeadTrackingInited = false;

})();`;
}
// deployed Sun Apr  5 19:56:57 UTC 2026
