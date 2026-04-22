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
    vidStore = "gen";
  }

  // CHECK URL: If this page was reached with ?sa_vid= in the URL, adopt that ID.
  // This is how cross-domain tracking works — the ID travels through checkout URLs.
  var urlVid = (window.location.search.match(/[?&]sa_vid=([^&]+)/) || [])[1];
  if (urlVid) {
    vid = decodeURIComponent(urlVid);
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
      // Canvas fingerprint — unique per GPU/driver/OS combination
      var canvasHash = "";
      try {
        var c = document.createElement("canvas");
        c.width = 200; c.height = 50;
        var ctx = c.getContext("2d");
        if (ctx) {
          ctx.textBaseline = "top";
          ctx.font = "14px Arial";
          ctx.fillStyle = "#f60";
          ctx.fillRect(125, 1, 62, 20);
          ctx.fillStyle = "#069";
          ctx.fillText("SiteAmoeba.fp", 2, 15);
          ctx.fillStyle = "rgba(102,204,0,0.7)";
          ctx.fillText("SiteAmoeba.fp", 4, 17);
          canvasHash = c.toDataURL().slice(-50);
        }
      } catch(e) {}

      // WebGL renderer — identifies GPU hardware
      var glRenderer = "";
      try {
        var gl = document.createElement("canvas").getContext("webgl");
        if (gl) {
          var dbg = gl.getExtension("WEBGL_debug_renderer_info");
          if (dbg) glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        }
      } catch(e) {}

      var raw = [
        navigator.userAgent,
        screen.width + "x" + screen.height + "x" + screen.colorDepth,
        navigator.language,
        (navigator.hardwareConcurrency || 0),
        new Date().getTimezoneOffset(),
        (typeof Intl !== "undefined" ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "") : ""),
        canvasHash,
        glRenderer,
        navigator.platform || "",
        (navigator.maxTouchPoints || 0)
      ].join("|");
      // djb2 hash
      var h = 5381;
      for (var i = 0; i < raw.length; i++) {
        h = ((h << 5) + h) ^ raw.charCodeAt(i);
        h = h & h;
      }
      return (h >>> 0).toString(36);
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
          params[pair[0]] = decodeURIComponent(pair[1].replace(/\\\+/g, " "));
        }
      }
    }
    return params;
  })();

  // === HELPER: Find the innermost text node of an element ===
  // GHL buttons, CTAs, and some headings use nested divs for text.
  // e.g. <button><div class="main-heading-group"><div class="main-heading-button">TEXT</div>...
  // We need to find the actual text-bearing child, not just set textContent on the parent.
  // findSingleWrapperText — preserves inline/class-based styling on headlines.
  //
  // The rule we enforce: if this element has exactly ONE element child AND
  // all of the element's visible text comes from that child (no sibling text
  // nodes with >2 non-whitespace chars), descend. Keep descending while the
  // chain holds. Stop at the deepest single wrapper.
  //
  // On multi-span GHL layouts (2+ element children, each carrying text) we
  // bail out immediately and the caller writes on the outer element — the
  // pre-existing correct behavior for that case.
  function findSingleWrapperText(el) {
    var cur = el;
    var guard = 0;
    while (guard++ < 6) {
      if (!cur || !cur.children || cur.children.length !== 1) break;
      var childText = (cur.children[0].textContent || "").replace(/\s+/g, " ").trim();
      var fullText  = (cur.textContent || "").replace(/\s+/g, " ").trim();
      // The single child must account for ~all the element's text. We allow
      // a tiny delta for whitespace/punctuation nodes. If there are sibling
      // text nodes with real content, we must NOT descend.
      if (!childText || !fullText) break;
      if (Math.abs(fullText.length - childText.length) > 3) break;
      // The child must be a presentational wrapper (span/strong/em/b/font/mark)
      // OR a div that carries styling. Do NOT descend into interactive or
      // structural elements like links/buttons/images.
      var tag = (cur.children[0].tagName || "").toUpperCase();
      var allow = tag === "SPAN" || tag === "STRONG" || tag === "EM" || tag === "B" ||
                  tag === "FONT" || tag === "MARK" || tag === "I" || tag === "U" ||
                  tag === "DIV";
      if (!allow) break;
      cur = cur.children[0];
    }
    return cur || el;
  }

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
  function applyTextToElement(el, text, testMethod, category, styleOverrides) {
    // IMAGE VARIANT: swap src attribute when text is an image URL
    if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('/')) && text.match(/\\.(jpg|jpeg|png|gif|webp|svg)(\\?|$)/i)) {
      var imgEl = (el.tagName && el.tagName.toUpperCase() === 'IMG') ? el : el.querySelector('img');
      if (imgEl) {
        if (!imgEl.style.width) imgEl.style.width = imgEl.offsetWidth + 'px';
        if (!imgEl.style.height) imgEl.style.height = imgEl.offsetHeight + 'px';
        imgEl.style.objectFit = 'cover';
        imgEl.src = text;
        return;
      }
    }
    // Also handle direct IMG element selected from visual editor (src swap without file extension)
    if (el.tagName && el.tagName.toUpperCase() === 'IMG' && text && (text.startsWith('http') || text.startsWith('/'))) {
      if (!el.style.width) el.style.width = el.offsetWidth + 'px';
      if (!el.style.height) el.style.height = el.offsetHeight + 'px';
      el.style.objectFit = 'cover';
      el.src = text;
      return;
    }
    if (testMethod === "html_swap" || /<[a-z][\\s\\S]*>/i.test(text)) {
      el.innerHTML = text;
      return;
    }

    // === FULL ELEMENT TEXT REPLACEMENT (style-preserving when possible) ===
    // PRINCIPLE: Replace the text but keep the authored visual style intact.
    //
    // Pages wrap headlines in different ways across builders:
    //   (a) GHL splits a headline into multiple colored spans
    //       <h1><span class="red">Hello</span><span class="blue">World</span></h1>
    //       → we must wipe all children and write textContent on the outer element.
    //   (b) Many builders (Elementor, Brizi, custom HTML, Alberto's Keto page)
    //       wrap the whole headline in ONE styled span:
    //       <h2><span style="color:magenta;font-weight:800;font-size:32px">Anche se...</span></h2>
    //       → if we write on the outer H2, the styled span gets deleted and the
    //         variant renders in plain base styles (Alberto's bug).
    //       → we should write INSIDE the wrapper so the styling stays.
    //
    // Heuristic: walk the single-child chain. As long as an element has exactly
    // one child element AND that child's textContent covers the full text
    // (i.e. no sibling text nodes with meaningful content), descend. Stop at
    // the deepest single wrapper. This handles any level of nesting while
    // correctly bailing out on the GHL multi-span case.
    var target = el;

    if (category === "cta") {
      // Buttons: drill through any wrapper class to the leaf text node.
      target = findTextTarget(el);
    } else {
      target = findSingleWrapperText(el);
    }

    // Replace the full text content on the chosen target. For the single-
    // wrapper case this preserves the span's inline styles; for multi-span
    // cases we stay at the outer element and wipe children as before.
    target.textContent = text;

    // Apply explicit style overrides ONLY if specified (from visual editor)
    // This is the ONLY way styles get changed — never automatic.
    if (styleOverrides && typeof styleOverrides === "object") {
      for (var sp in styleOverrides) {
        if (styleOverrides.hasOwnProperty(sp) && styleOverrides[sp]) {
          var cssPropName = sp.replace(/([A-Z])/g, '-$1').toLowerCase();
          target.style.setProperty(cssPropName, styleOverrides[sp]);
        }
      }
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
  // === ELEMENT LOOKUP — text-first, platform-agnostic cascade ===
  // Returns an array of DOM elements to update.
  //
  // DESIGN PRINCIPLE (April 2026 rewrite): we match by TEXT, not by TAG.
  // Two H1s on a page are not "the same element" — the hero_promise is a
  // different JOB from a secondary outcome_promise, and the user's control_text
  // captured at scan time is the ONLY reliable way to tell them apart.
  //
  // Strategy order (new):
  //   1. EXACT text match against controlText/currentText anywhere on the page
  //   2. Fuzzy text match (token scoring) against the same fingerprints
  //   3. CSS selector, but only if we also verify the result contains the
  //      expected text — otherwise fall through
  //   4. Broader token-overlap scan on block-level elements (last resort)
  function findElements(selector, currentText, controlText, category) {
    var elements = [];
    var isCTA = category === "cta" || category === "button";

    // Normalize — lowercase, collapse whitespace, strip non-word chars.
    // Keep the untouched version for a "did it match verbatim" check.
    function normalize(s) {
      return (s || "").toString().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
    }
    var controlRaw = (controlText || currentText || "").trim();
    var controlNorm = normalize(controlRaw);

    // ---------- STRATEGY 1: EXACT text match, ranked by semantic tag ----------
    // Walk block-level + interactive elements and find any whose textContent
    // (normalized) exactly equals the control text.
    //
    // When multiple elements match (e.g. GHL renders the same heading as BOTH
    // an <h1><strong> AND a <div class="c-heading"> wrapper), we PREFER the
    // one whose tag carries the strongest authored typography — headings with
    // a <strong> inside beat plain headings beat STRONG/B beat P beat SPAN
    // beat generic DIV wrappers.
    //
    // This way, writing the new text lands on the <h1> (which then descends
    // via findSingleWrapperText into <strong>/<span>, preserving bold + color)
    // instead of on a class*='heading' DIV that inherits light weight.
    if (controlNorm && controlNorm.length >= 3) {
      var scanSelector = isCTA
        ? "button, a, [role='button'], [class*='btn'], [class*='cbutton'], [class*='cta']"
        : "h1, h2, h3, h4, h5, h6, p, strong, b, em, span, div, [class*='heading'], [class*='cheading'], [class*='title']";

      function semanticRank(el) {
        var t = (el.tagName || "").toUpperCase();
        if (t === "H1" || t === "H2" || t === "H3" || t === "H4" || t === "H5" || t === "H6") {
          // Heading with bold inside — highest priority, carries richest typography
          if (el.querySelector("strong, b")) return 10;
          return 9;
        }
        if (t === "STRONG" || t === "B") return 7;
        if (t === "EM" || t === "I") return 6;
        if (t === "P") return 5;
        if (t === "SPAN") return 4;
        if (t === "DIV") return 2;
        return 3;
      }

      var rankedMatches = [];
      try {
        var candidates = document.querySelectorAll(scanSelector);
        for (var ei = 0; ei < candidates.length; ei++) {
          // Skip deeply nested parents — we want the element whose text IS the
          // control text, not a giant wrapper that happens to contain it.
          if (candidates[ei].children.length > 8) continue;
          var txt = normalize(candidates[ei].textContent);
          if (!txt) continue;
          if (txt === controlNorm) {
            rankedMatches.push({ el: candidates[ei], rank: semanticRank(candidates[ei]) });
          }
        }
      } catch(e) {}
      if (rankedMatches.length > 0) {
        // Keep only the top-rank tier. If an H1 exists, don't also swap a DIV
        // wrapper — that DIV is usually a mobile mirror that renders lighter.
        rankedMatches.sort(function(a, b) { return b.rank - a.rank; });
        var topRank = rankedMatches[0].rank;
        for (var rmi = 0; rmi < rankedMatches.length; rmi++) {
          if (rankedMatches[rmi].rank === topRank && elements.indexOf(rankedMatches[rmi].el) === -1) {
            elements.push(rankedMatches[rmi].el);
          }
        }
        return elements;
      }
    }

    // ---------- STRATEGY 2: CSS selector, verified by text ----------
    // Selector is useful but never authoritative. We only accept a selector
    // result if the returned element's text also overlaps the control text
    // (so a stale selector pointing at the wrong element fails closed).
    if (selector) {
      var parts = selector.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      var selElements = [];
      for (var i = 0; i < parts.length; i++) {
        try {
          var matches = document.querySelectorAll(parts[i]);
          for (var j = 0; j < matches.length; j++) {
            if (selElements.indexOf(matches[j]) === -1) selElements.push(matches[j]);
          }
        } catch(e) {}
      }
      if (selElements.length > 0 && controlNorm && controlNorm.length >= 3) {
        var fpTokens = controlNorm.split(/ +/).filter(function(w) { return w.length > 2; }).slice(0, 8);
        var verified = [];
        for (var fi = 0; fi < selElements.length; fi++) {
          var elTxt = normalize(selElements[fi].textContent);
          if (!elTxt) continue;
          if (elTxt === controlNorm) {
            verified.push(selElements[fi]);
            continue;
          }
          // Token-overlap check — 60%+ tokens must appear in the candidate.
          if (fpTokens.length >= 2) {
            var hits = 0;
            for (var ft = 0; ft < fpTokens.length; ft++) {
              if (elTxt.indexOf(fpTokens[ft]) !== -1) hits++;
            }
            if (hits >= Math.ceil(fpTokens.length * 0.6)) verified.push(selElements[fi]);
          }
        }
        if (verified.length > 0) return verified;
        // Selector matched, but nothing verified by text. Fall through — we
        // would rather miss a swap than apply the wrong one.
      } else if (selElements.length === 1 && !controlNorm) {
        // No control text recorded (edge case on very old sections) — trust
        // the selector if it's unique.
        return selElements;
      }
    }

    // ---------- STRATEGY 3: Fuzzy token-score text search ----------
    // Same fingerprint-based search that was the old strategy 2. Runs only
    // when exact match + selector-verified paths both failed — typically when
    // the page's text has drifted slightly since the scan.
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

    // ---------- STRATEGY 4: Broader token-overlap (last resort) ----------
    // Last resort. Searches all block-level elements for any token overlap.
    if (fingerprints.length > 0) {
      var anyTokens = (fingerprints[0] || "").trim().toLowerCase().split(/ +/)
        .filter(function(w) { return w.length > 3; }).slice(0, 3);
      if (anyTokens.length > 0) {
        var allEls = document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,button,a,li,blockquote,figcaption");
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
      pageText = pageText.trim().toLowerCase().replace(/\\s+/g, " ");
      var ctrlText = (controlText || "").trim().toLowerCase().replace(/\\s+/g, " ");
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
    if (testMethod === "html_swap" || /<[a-z][\\s\\S]*>/i.test(text)) {
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
  var previewMatch = window.location.search.match(/[?&]sa_preview=(\\\d+)/);
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
        // Check for successful application by looking for data-sa-swapped attribute,
        // NOT by checking if variant words exist on the page (they often overlap with control text)
        var retries = [0, 400, 1200, 2500, 5000];
        var applied = false;
        retries.forEach(function(delay) {
          setTimeout(function() {
            if (applied) return;
            // Check if a swap already happened (from a prior retry)
            if (document.querySelector('[data-sa-swapped="true"]')) {
              applied = true;
              return;
            }
            // Not yet applied — try now
            handleAssignData(data);
            // Check if it actually worked
            if (document.querySelector('[data-sa-swapped="true"]')) {
              applied = true;
            }
          }, delay);
        });
      })
      .catch(function(e) { console.warn("SiteAmoeba preview: fetch error", e); });
  } else {
    // NORMAL MODE: standard variant assignment
    // Include fingerprint ONLY when the browser could not supply a persistent vid
    // (localStorage/sessionStorage/cookie all failed). When storage works, each visit
    // has its own unique sa_vid — using fingerprint on top of that collapses many distinct
    // users who share a canvas/GPU/OS signature (e.g. Facebook WebView on iPhone) into
    // one visitor row, which destroys unique-visitor counts and attribution.
    var shouldSendFp = (vidStore === "none" || vidStore === "gen"); // gen = freshly generated
    var assignUrl = API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer) + (shouldSendFp && fp ? "&fp=" + fp : "");
    if (utmParams.utm_source)   assignUrl += "&utm_source="   + encodeURIComponent(utmParams.utm_source);
    if (utmParams.utm_medium)   assignUrl += "&utm_medium="   + encodeURIComponent(utmParams.utm_medium);
    if (utmParams.utm_campaign) assignUrl += "&utm_campaign=" + encodeURIComponent(utmParams.utm_campaign);
    if (utmParams.utm_content)  assignUrl += "&utm_content="  + encodeURIComponent(utmParams.utm_content);
    if (utmParams.utm_term)     assignUrl += "&utm_term="     + encodeURIComponent(utmParams.utm_term);
    // Capture click IDs for attribution (fbclid, gclid, ttclid)
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fbclid'))  assignUrl += "&fbclid="  + encodeURIComponent(urlParams.get('fbclid'));
    if (urlParams.get('gclid'))   assignUrl += "&gclid="   + encodeURIComponent(urlParams.get('gclid'));
    if (urlParams.get('ttclid'))  assignUrl += "&ttclid="  + encodeURIComponent(urlParams.get('ttclid'));
    // Send the page URL for journey tracking
    assignUrl += "&url=" + encodeURIComponent(window.location.href.split('?')[0]);
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

  // === VISITOR ID LINK DECORATION ===
  // Append sa_vid to ALL outbound links so the visitor ID travels through checkout,
  // payment processors, thank-you pages, etc. This is the foundation of cross-domain
  // attribution — the visitor ID follows the user everywhere.
  function decorateLink(url) {
    if (!url || !vid) return url;
    try {
      var u = new URL(url, window.location.origin);
      // Skip same-page anchors, javascript:, mailto:, tel:
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
      // Skip if already has sa_vid
      if (u.searchParams.has('sa_vid')) return url;
      // Add the visitor ID
      u.searchParams.set('sa_vid', vid);
      // Also add campaign ID so the conversion pixel knows which campaign
      u.searchParams.set('sa_cid', String(CID));
      return u.toString();
    } catch(e) { return url; }
  }

  // Intercept all link clicks and form submissions
  document.addEventListener('click', function(e) {
    var target = e.target;
    // Walk up to find the nearest <a> tag
    var link = null;
    var el = target;
    for (var i = 0; i < 10 && el; i++) {
      if (el.tagName === 'A' && el.href) { link = el; break; }
      el = el.parentElement;
    }
    if (link && link.href) {
      var decorated = decorateLink(link.href);
      if (decorated !== link.href) {
        link.href = decorated;
      }
    }
  }, true);

  // Also decorate form actions (checkout forms, opt-in forms)
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.action) {
      var decorated = decorateLink(form.action);
      if (decorated !== form.action) form.action = decorated;
      // Also inject sa_vid as a hidden field
      if (!form.querySelector('input[name="sa_vid"]')) {
        var hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'sa_vid';
        hidden.value = vid;
        form.appendChild(hidden);
        var cidField = document.createElement('input');
        cidField.type = 'hidden';
        cidField.name = 'sa_cid';
        cidField.value = String(CID);
        form.appendChild(cidField);
      }
    }
  }, true);

  // Expose vid globally so conversion pixels on other pages can read it
  window.__sa_vid = vid;
  window.__sa_cid = CID;
  window.__sa_fp = fp;

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
        pricing: /pricing|price.?table|price.?card|plan.?card|plan.?tier|\\btier\\b|\\bcost\\b|checkout/i,
        guarantee: /guarantee|refund|money.?back|risk.?free|no.?risk/i,
        faq: /faq|question|ask|q\\s*&\\s*a/i,
        cta: /cta|call.?to.?action|sign.?up|register|get.?started|buy.?now|\\border.?now\\b|enroll/i,
        about: /about|who.?we|our.?story|our.?mission|founder|team/i,
        bonus: /bonus|extra|free.?gift|included/i,
        scarcity: /limited|hurry|expir|countdown|urgent|only.*left/i,
        footer: /footer|copyright|bottom/i,
        video: /video|watch|play/i
      };

      function classifyEl(el) {
        // === CONTENT-FIRST CLASSIFICATION ===
        // Read the actual text in the section to determine what it's about.
        // Never classify based on CSS class names — page builders use arbitrary
        // class names (noBorder, c-row, etc.) that cause false positives.

        // 1. Get the heading — this is the strongest signal for what the section is about
        var heading = el.querySelector("h1, h2, h3, h4");
        var headingText = heading ? (heading.innerText || "").trim() : "";

        // 2. Get visible body text (first 400 chars, skip scripts/styles)
        var bodyText = "";
        try {
          var clone = el.cloneNode(true);
          var kill = clone.querySelectorAll("script, style, noscript, svg");
          for (var k = 0; k < kill.length; k++) kill[k].remove();
          bodyText = (clone.innerText || clone.textContent || "").substring(0, 400).toLowerCase();
        } catch(e) {
          bodyText = (el.innerText || "").substring(0, 400).toLowerCase();
        }

        // 3. Check for structural elements inside the section
        var hasVideo = !!el.querySelector("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia']");
        var hasForm = !!el.querySelector("form, input[type='email'], input[type='text']");
        var hasBlockquote = !!el.querySelector("blockquote");
        var hasStars = !!el.querySelector("[class*='star'], [class*='rating']");

        // 4. Content-based classification — check text meaning, not CSS
        var ht = headingText.toLowerCase();

        // Video section
        if (hasVideo && bodyText.length < 150) return "video";
        if (hasVideo && /watch|play|video|see how|guarda|mira|ver cómo|regarde/i.test(headingText)) return "video";

        // FAQ — English, Italian, Spanish, Portuguese, French, German
        if (/faq|frequently asked|common question|q\\s*[&+]\\s*a|domande frequenti|domande comuni|preguntas frecuentes|perguntas frequentes|questions fréquentes|häufig gestellt/i.test(headingText)) return "faq";
        if (/faq|frequently asked|domande frequenti|preguntas frecuentes|perguntas frequentes|questions fréquentes/i.test(bodyText) && bodyText.split("?").length >= 3) return "faq";

        // Testimonials / social proof — multilingual
        if (hasBlockquote && bodyText.length > 50) return "testimonials";
        if (hasStars) return "testimonials";
        if (/testimonial|testimoni|testimonios|depoiment|témoignage|what (people|clients|customers|members|users) (say|think|are saying)|cosa dicono|qué dicen|o que dizem|ce que disent/i.test(headingText)) return "testimonials";
        if (/\u201c|\u201d|\u2018|\u2019|«|»/i.test(bodyText) && bodyText.split(/\u201c|\u201d|«|»/).length >= 3) return "testimonials";
        if (/satisfied|happy (customer|client)|success stor|real results|people trust|soddisfatt|clienti felici|satisfech|feliz|cliente satisfeit|satisfait|\\d+[,.]?\\d*\\s*(customer|client|user|member|review|cliente|utente|utilisateur|mitglied)/i.test(bodyText)) return "social_proof";

        // Guarantee / risk reversal — multilingual
        if (/guarantee|garanzia|garantía|garantia|garantie|money.?back|risk.?free|refund|rimborso|reembolso|remboursement|soddisfatt.*rimborsat|no.?risk|senza rischio|sin riesgo|sem risco|sans risque|100%.?(satisfaction|guaranteed|garantit)/i.test(headingText)) return "guarantee";
        if (/guarantee|garanzia|garantía|garantia|garantie|money.?back|risk.?free|refund|rimborso|reembolso|remboursement/i.test(bodyText) && bodyText.length < 400) return "guarantee";

        // Pricing / offer — multilingual
        if (/pricing|prezzo|precio|preço|prix|preis|how much|quanto costa|cuánto cuesta|quanto custa|combien|investment|investimento|inversión|investissement|regular price|today.?s price|one.?time|pagamento unico|payment plan|choose your plan|scegli il tuo piano|elige tu plan|éscolhe o teu plano|choisissez votre plan/i.test(headingText)) return "pricing";
        if (/\$\\d+.*\$\\d+|€\\s*\\d+.*€\\s*\\d+|\\d+\\s*€.*\\d+\\s*€|regular price.*\$|prezzo.*normale|was \$.*now \$/i.test(bodyText)) return "pricing";

        // Bonus — multilingual
        if (/bonus|free gift|regalo gratis|omaggio|brinde|cadeau|also (get|include|receive)|extra|incluso|incluido|inclus|throw in/i.test(headingText)) return "bonus";

        // CTA / form section — multilingual
        if (hasForm) return "cta";
        if (/get (started|access|instant)|inizia|comincia|empezar|comenzar|começar|commencer|sign up|register|iscriviti|regístrate|registra|cadastra|inscris|enroll|inscrivi|claim|reclama|reserve|prenota|reserva|réserver|download now|add to cart|aggiungi al carrello|añadir al carrito|ajouter au panier|join|sì.*voglio|sí.*quiero|sim.*quero|oui.*je veux/i.test(headingText)) return "cta";

        // Problem / pain — multilingual
        if (/problem|problema|problème|struggle|lott|lucha|luta|frustrat|pain|dolor|dor|douleur|tired of|stanco di|cansad|fatigu|sick of|can't seem|non riesc|no (puedes|puede|logro)|doesn't work|non funzion|no funciona|não funciona|ne fonctionne pas|failing|broken|rott/i.test(headingText)) return "problem";
        if (/sound familiar|ring a bell|felt like|you've tried|ti è familiar|te suena|parece familiar|ça te parle/i.test(bodyText.substring(0, 300))) return "problem";

        // Solution / how it works — multilingual
        if (/how (it|this) works|come funziona|cómo funciona|como funciona|comment ça marche|the (solution|answer|method|system|secret|process)|la (soluzione|risposta|metodo|sistema|segreto)|la (solución|respuesta|método|sistema|secreto)|a (solução|resposta|método|sistema)|la (solution|réponse|méthode)|introducing|presentiamo|presentamos|apresentamos|découvrez|here'?s (how|what|why)/i.test(headingText)) return "solution";
        if (/step \\d|step.?by.?step|passo \\d|paso \\d|étape \\d|module \\d|modulo \\d|módulo \\d|phase \\d|fase \\d|pillar \\d|pilastro \\d/i.test(bodyText)) return "solution";

        // Benefits / features — multilingual
        if (/what you (get|receive|learn|discover)|cosa (ottieni|ricevi|imparerai|scoprirai)|qué (obtienes|recibes|aprendes)|o que (vais|você vai) (receber|aprender)|ce que vous (obtenez|recevez)|inside|cosa c'è dentro|qué hay dentro|o que está dentro|ce qu'il y a (dedans|à l'intérieur)|everything (you get|included)|tutto incluso|todo incluido|tout inclus|feature|caratteristic|característic|caractéristique|benefit|beneficio|benefício|bénéfice|vantaggio|vantagem|avantage|here'?s what/i.test(headingText)) return "benefits";

        // About / bio — multilingual
        if (/about (me|us|the)|chi (sono|siamo)|sobre (mí|nosotros|mim|nós)|à propos (de moi|de nous)|who (we|i) (am|are)|my (story|mission|journey)|la mia (storia|missione)|mi (historia|misión)|minha (história|missão)|mon (histoire|parcours)|meet (your|the)|founder|fondator|fundador|fondateur/i.test(headingText)) return "about";

        // Scarcity / urgency — multilingual
        if (/limited|limitat|limitad|limité|hurry|sbrigati|apúrate|apresse|dépêche|expir|scad|venc|expir|countdown|conto alla rovescia|cuenta regresiva|contagem regressiva|compte à rebours|only \\d+ (left|spot|seat)|solo \\d+ (rimast|posti|cop)|solo quedan|apenas \\d+ (restante|vaga)|seulement \\d+ (restant|place)|act (now|fast|today)|agisci ora|actúa ahora|age agora|agissez maintenant|don't (wait|miss)|non (aspettare|perdere)|no (esperes|pierdas)|não (espere|perca)|ne (tardez|manquez)/i.test(headingText)) return "scarcity";
        if (/esaurimento|agotado|esgotado|épuis|in esaurimento|scorte limitate|ultim[ei]\\s*\\d+/i.test(bodyText.substring(0, 300))) return "scarcity";

        // Hero — first section with a prominent heading
        var rect = el.getBoundingClientRect();
        var absTop = rect.top + (window.scrollY || window.pageYOffset);
        if (absTop < 200 && headingText.length > 15) return "hero";

        // Footer — multilingual
        if (/copyright|\u00a9|all rights reserved|tutti i diritti riservati|todos los derechos reservados|todos os direitos reservados|tous droits réservés|privacy|privacidad|privacidade|confidentialité|terms of (use|service)|termini d'uso|términos|termos de uso|conditions d'utilisation/i.test(bodyText) && bodyText.length < 250) return "footer";

        // LAST-RESORT HEADING FALLBACK: If we still don't know what this is but we have
        // a clear heading, return it as a slug instead of the generic "content". Gives
        // Alberto a meaningful drop-off label for his Italian sections even when we don't
        // have a perfect classifier match.
        if (headingText && headingText.length >= 5 && headingText.length <= 80) {
          var slug = headingText.toLowerCase()
            .replace(/[^a-z0-9\\s]/g, "")
            .trim()
            .split(/\\s+/)
            .slice(0, 4)
            .join("_");
          if (slug.length >= 3) return slug.substring(0, 40);
        }

        return "content";
      }

      // Find meaningful top-level sections — filter out tiny ones AND nested duplicates.
      // The correct dedup is based on DOM ancestry: if any of my ancestors is already
      // in the section map, I'm a nested child and should be skipped. Previous key-based
      // dedup collided across unrelated sections with similar position/height.
      //
      // Candidate selectors must cover all major page builders:
      //   - Plain HTML: <section>, [role='region']
      //   - Generic: [class*='section'], [class*='row'], [class*='block']
      //   - Elementor: [class*='elementor-section'], [class*='elementor-widget']
      //   - GHL / HighLevel: [id^='section-'], [id^='row-']
      //   - Divi / WPBakery: [class*='et_pb_section'], [class*='vc_row']
      //   - Generic WordPress: main > div, .container > div
      var candidates = document.querySelectorAll([
        "section",
        "[class*='section']",
        "[role='region']",
        "main > div",
        ".container > div",
        "#content > div",
        "[class*='block']",
        "[class*='row']",
        "[class*='elementor-section']",
        "[class*='elementor-widget']",
        "[class*='et_pb_section']",
        "[class*='vc_row']",
        "[class*='brz-section']",
        "[id^='section-']",
        "[id^='row-']",
        "[data-section]",
        "[data-element-type]"
      ].join(", "));
      var map = [];
      var accepted = []; // actual DOM elements we've accepted
      candidates.forEach(function(el) {
        // Skip tiny or invisible sections
        var rect = el.getBoundingClientRect();
        var absTop = rect.top + window.scrollY;
        var height = rect.height;
        if (height < 100 || rect.width < 200) return;

        // Skip if any ancestor is already accepted (true nested-section dedup)
        for (var a = 0; a < accepted.length; a++) {
          if (accepted[a].contains(el)) return;
        }

        // Skip if this element contains a section we already accepted — shouldn't
        // happen given DOM order, but defensive in case iteration is unusual
        for (var b = 0; b < accepted.length; b++) {
          if (el.contains(accepted[b])) return;
        }

        // QUALITY GATE: only count sections with a CLEAR anchor point — a heading,
        // an interactive element (form/button/CTA), or embedded media. Every other
        // div is just layout plumbing and adds noise to the drop-off chart.
        //
        // Rationale: Alberto's Elementor page has dozens of image-wrapped divs, text
        // paragraphs, and divider columns. Counting each as a section produces a wall
        // of 'content' drop-off entries that tells the user nothing. We want the
        // drop-off chart to reflect PURPOSEFUL sections — the ones a copywriter would
        // recognize as distinct steps in the page's argument.
        var heading = el.querySelector("h1, h2, h3, h4");
        var headingText = heading ? (heading.innerText || "").substring(0, 100).trim() : "";
        var anchorEl = el.querySelector(
          "form, input[type='email'], input[type='text'], blockquote, video, " +
          "iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia'], iframe[src*='vidyard'], " +
          "button, a.button, a.btn, [class*='button'], [class*='cta'], [class*='buy'], [class*='order']"
        );
        var isBigEnough = rect.height >= 250; // Large standalone sections can count even without heading

        if (!headingText && !anchorEl && !isBigEnough) return;

        // Extra filter: if we have neither heading nor anchor, the text must be
        // substantial (>= 200 chars) to count. Small dividers/captions are noise.
        if (!headingText && !anchorEl) {
          var sampleText = (el.innerText || "").trim();
          if (sampleText.length < 200) return;
        }

        accepted.push(el);
        var offsetPct = Math.round(absTop / pageH * 100);
        var label = classifyEl(el);
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
  function autoConvert(email) {
    if (!vid) return;
    var img = new Image();
    var url = API + "/api/widget/convert?vid=" + encodeURIComponent(vid) + "&cid=" + CID;
    if (email) url += "&email=" + encodeURIComponent(email);
    img.src = url;
  }

  // Extract email value from a form's email-like input (returns empty string if none)
  function extractFormEmail(form) {
    if (!form || !form.querySelector) return "";
    var input = form.querySelector('input[type="email"]')
             || form.querySelector('input[name*="email" i]')
             || form.querySelector('input[id*="email" i]')
             || form.querySelector('input[placeholder*="email" i]');
    var val = input && input.value ? String(input.value).trim() : "";
    // Basic sanity check — contains @ and a dot after it
    if (val && val.indexOf("@") > 0 && val.indexOf(".", val.indexOf("@")) > 0) return val;
    return "";
  }

  // Capture from ANY email input on the page (for success-pattern detection paths
  // that don't have a form reference handy). Prefers inputs inside forms.
  function grabPageEmail() {
    try {
      var inputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[id*="email" i]');
      for (var i = 0; i < inputs.length; i++) {
        var val = inputs[i].value ? String(inputs[i].value).trim() : "";
        if (val && val.indexOf("@") > 0 && val.indexOf(".", val.indexOf("@")) > 0) return val;
      }
    } catch(e) {}
    return "";
  }

  function initLeadTracking() {
    var convertFired = false;
    var capturedEmail = ""; // remember whatever the user typed, even before submit

    // Passive email capture — every input/change on any email field stashes the value.
    // This survives cases where the form is AJAX-submitted and the DOM is wiped before
    // autoConvert fires, or where the success-pattern observer fires after the form is gone.
    document.addEventListener("input", function(e) {
      var t = e.target;
      if (!t || t.tagName !== "INPUT") return;
      var type = (t.type || "").toLowerCase();
      var name = (t.name || "").toLowerCase();
      var id = (t.id || "").toLowerCase();
      if (type === "email" || name.indexOf("email") !== -1 || id.indexOf("email") !== -1) {
        var v = String(t.value || "").trim();
        if (v && v.indexOf("@") > 0 && v.indexOf(".", v.indexOf("@")) > 0) {
          capturedEmail = v;
        }
      }
    }, true);

    // 1. Listen for standard form submit events
    document.addEventListener("submit", function(e) {
      if (convertFired) return;
      var form = e.target;
      if (!form) return;
      var hasEmail = form.querySelector && (
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[name*="email"]') ||
        form.querySelector('input[placeholder*="email"]')
      );
      if (!hasEmail) return;
      // Grab the email NOW before any AJAX wipes the form
      var submitEmail = extractFormEmail(form) || capturedEmail;
      // Wait 2s for AJAX submission to complete, then fire
      setTimeout(function() {
        if (!convertFired) {
          convertFired = true;
          autoConvert(submitEmail);
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
            autoConvert(capturedEmail || grabPageEmail());
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
