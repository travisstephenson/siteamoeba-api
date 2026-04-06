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

  // === HELPER: Apply text to an element, targeting inner text nodes correctly ===
  function applyTextToElement(el, text, testMethod) {
    if (testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(text)) {
      el.innerHTML = text;
      return;
    }
    // Find the actual text target inside the element
    var target = findTextTarget(el);
    target.textContent = text;
  }

  // === HELPER: Apply variant text to a section ===
  // DESIGN PRINCIPLE: Preserve the original page formatting.
  // Three strategies for finding the right element:
  //   1. Use the stored CSS selector directly
  //   2. If selector fails (GHL regenerates class names), find by control text fingerprint
  //   3. For buttons/CTAs, also search by element type + text content
  // When a selector targets multiple elements (multi-line headlines),
  // distribute text proportionally — each element keeps its own CSS.
  function applySectionVariant(selector, text, testMethod, controlText, category) {
    if (!text) return;

    var allElements = [];

    // Strategy 1: Use the stored CSS selector
    if (selector) {
      var parts = selector.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      for (var i = 0; i < parts.length; i++) {
        try {
          var matches = document.querySelectorAll(parts[i]);
          for (var j = 0; j < matches.length; j++) {
            if (allElements.indexOf(matches[j]) === -1) allElements.push(matches[j]);
          }
        } catch(e) {}
      }
    }

    // Strategy 2: Selector failed (stale class names) — find by control text fingerprint
    // This handles GHL's habit of regenerating unique class names on every page publish
    if (allElements.length === 0 && controlText) {
      var ctrlWords = (controlText || "").trim().toLowerCase().split(/\s+/).slice(0, 4).join(" ");
      if (ctrlWords.length > 3) {
        // Which tag to search depends on section category
        var searchTags = category === "cta" || category === "button"
          ? ["button", "a", "[class*='btn']", "[class*='cbutton']", "[class*='cta']"]
          : ["h1", "h2", "h3", "p", "[class*='cheading']", "[class*='heading']"];
        for (var st = 0; st < searchTags.length; st++) {
          try {
            var candidates = document.querySelectorAll(searchTags[st]);
            for (var sc = 0; sc < candidates.length; sc++) {
              var candidateText = (candidates[sc].textContent || "").trim().toLowerCase();
              if (candidateText.indexOf(ctrlWords) !== -1 || ctrlWords.indexOf(candidateText.substring(0, 20)) !== -1) {
                if (allElements.indexOf(candidates[sc]) === -1) allElements.push(candidates[sc]);
              }
            }
          } catch(e) {}
          if (allElements.length > 0) break;
        }
      }
    }

    if (allElements.length === 0) {
      console.log("SiteAmoeba: no element found for selector '", selector, "' and controlText '", (controlText||'').substring(0,40), "'");
      return;
    }

    // === SINGLE ELEMENT: simple replacement ===
    if (allElements.length === 1) {
      applyTextToElement(allElements[0], text, testMethod);
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
    var words = text.split(/\\s+/).filter(Boolean);
    if (words.length === 0) return;

    // Distribute words across elements proportionally
    var lines = [];
    var wordIndex = 0;
    for (var el = 0; el < allElements.length; el++) {
      var ratio = originalLengths[el] / totalOrigLen;
      // Target word count for this line (proportional to original char ratio)
      var targetWords = Math.max(1, Math.round(ratio * words.length));
      // Last element gets all remaining words
      if (el === allElements.length - 1) {
        lines.push(words.slice(wordIndex).join(" "));
      } else {
        lines.push(words.slice(wordIndex, wordIndex + targetWords).join(" "));
        wordIndex += targetWords;
        if (wordIndex >= words.length) wordIndex = words.length;
      }
    }

    // Apply each line to its corresponding element — NO style changes, just text
    for (var n = 0; n < allElements.length; n++) {
      var lineText = lines[n] || "";
      if (!lineText) {
        allElements[n].style.display = "none";
        allElements[n].setAttribute("data-sa-hidden", "true");
      } else {
        applyTextToElement(allElements[n], lineText, testMethod);
      }
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

  function handleAssignData(data) {
      // Apply headline variant — SKIP if control (let original page be the control)
      if (data.headline && data.headline.text && !data.headline.isControl) {
        applySectionVariant(
          data.headline.selector, data.headline.text,
          data.headline.testMethod || "text_swap",
          data.headline.controlText, data.headline.category || "headline"
        );
      }
      // Apply subheadline variant — SKIP if control
      if (data.subheadline && data.subheadline.text && !data.subheadline.isControl) {
        applySectionVariant(
          data.subheadline.selector, data.subheadline.text,
          data.subheadline.testMethod || "text_swap",
          data.subheadline.controlText, data.subheadline.category || "subheadline"
        );
      }
      // Apply section variants (body_copy, CTAs, etc.) — SKIP controls
      if (data.sections && Array.isArray(data.sections)) {
        data.sections.forEach(function(sv) {
          if (!sv || !sv.text || sv.isControl) return;
          applySectionVariant(
            sv.selector, sv.text, sv.testMethod || "text_swap",
            sv.controlText, sv.category
          );
        });
      }
      // Final page integrity check — only if any non-control variants were applied
      var anyApplied = (data.headline && !data.headline.isControl) || (data.subheadline && !data.subheadline.isControl);
      if (anyApplied) postReplacementCheck();


  }

  // === VARIANT ASSIGNMENT (preview vs live) ===
  if (isPreviewMode) {
    // PREVIEW MODE: fetch the specific variant from the preview-data endpoint
    var previewVid = previewMatch[1];
    fetch(API + "/api/widget/preview-data?cid=" + CID + "&variantId=" + previewVid + "&token=" + encodeURIComponent(previewToken))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Retry with delays for dynamic pages (GHL renders content after load)
        // Check if the target elements exist before considering the apply "done"
        var retries = [0, 500, 1000, 2000, 3000, 5000, 8000];
        var applied = false;
        function checkApplied(data) {
          // Check if the target elements can be found — by selector OR by control text fallback
          var varData = data.headline || data.subheadline;
          if (varData) {
            // Try stored selector first
            if (varData.selector) {
              try {
                var firstSel = varData.selector.split(",")[0].trim();
                if (document.querySelector(firstSel)) return true;
              } catch(e) {}
            }
            // Try finding by control text (handles stale selectors)
            if (varData.controlText) {
              var ctrlSnippet = (varData.controlText || "").trim().toLowerCase().substring(0, 20);
              var searchIn = document.querySelectorAll("h1, h2, h3, button, [class*='cheading']");
              for (var s = 0; s < searchIn.length; s++) {
                if ((searchIn[s].textContent || "").toLowerCase().indexOf(ctrlSnippet) !== -1) return true;
              }
            }
          }
          if (data.sections && data.sections.length > 0) {
            for (var i = 0; i < data.sections.length; i++) {
              var sv = data.sections[i];
              // Try stored selector
              if (sv.selector) {
                try {
                  if (document.querySelector(sv.selector.split(",")[0].trim())) return true;
                } catch(e) {}
              }
              // Try by control text
              if (sv.controlText) {
                var ctrlSnip = (sv.controlText || "").trim().toLowerCase().substring(0, 20);
                var btns = document.querySelectorAll("button, a, [class*='cbutton']");
                for (var b = 0; b < btns.length; b++) {
                  if ((btns[b].textContent || "").toLowerCase().indexOf(ctrlSnip) !== -1) return true;
                }
              }
            }
          }
          return false;
        }
        retries.forEach(function(delay) {
          setTimeout(function() {
            if (applied) return;
            if (checkApplied(data)) {
              handleAssignData(data);
              applied = true;
            }
          }, delay);
        });
      })
      .catch(function(e) { console.log("SiteAmoeba preview: error", e); });
  } else {
    // NORMAL MODE: standard variant assignment
    var assignUrl = API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer);
    if (utmParams.utm_source)   assignUrl += "&utm_source="   + encodeURIComponent(utmParams.utm_source);
    if (utmParams.utm_medium)   assignUrl += "&utm_medium="   + encodeURIComponent(utmParams.utm_medium);
    if (utmParams.utm_campaign) assignUrl += "&utm_campaign=" + encodeURIComponent(utmParams.utm_campaign);
    if (utmParams.utm_content)  assignUrl += "&utm_content="  + encodeURIComponent(utmParams.utm_content);
    if (utmParams.utm_term)     assignUrl += "&utm_term="     + encodeURIComponent(utmParams.utm_term);
    fetch(assignUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) { handleAssignData(data); })
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
  var maxScroll = 0;
  var device = window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";

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
    var payload = JSON.stringify({vid: vid, cid: CID, events: batch, timeOnPage: timeOnPage, maxScroll: maxScroll, device: device});
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API + "/api/widget/events", new Blob([payload], {type: "application/json"}));
    } else {
      fetch(API + "/api/widget/events", {method: "POST", headers: {"Content-Type": "application/json"}, body: payload, keepalive: true}).catch(function(){});
    }
  }

  // Send initial heartbeat after 5 seconds (captures early scroll + device)
  setTimeout(function() {
    var batch = events.splice(0, events.length);
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    sendBatch(batch, timeOnPage);
  }, 5000);

  // Heartbeat every 15 seconds — always sends scroll/time even if no events
  setInterval(function() {
    var batch = events.splice(0, events.length);
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    sendBatch(batch, timeOnPage);
  }, 15000);

  // Send on page exit
  window.addEventListener("beforeunload", function() {
    var timeOnPage = Math.round((Date.now() - startTime) / 1000);
    events.push({type: "page_exit", data: JSON.stringify({maxScroll: maxScroll, timeOnPage: timeOnPage}), ts: Date.now()});
    var batch = events.splice(0, events.length);
    sendBatch(batch, timeOnPage);
  });

  // Also send on visibility change (handles mobile tab switches / app backgrounding)
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") {
      var timeOnPage = Math.round((Date.now() - startTime) / 1000);
      var batch = events.splice(0, events.length);
      sendBatch(batch, timeOnPage);
    }
  });
})();`;
}
// deployed Sun Apr  5 19:56:57 UTC 2026
