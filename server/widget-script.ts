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

  // === HELPER: Apply variant text to a section ===
  // DESIGN PRINCIPLE: Preserve the original page formatting.
  // When a selector targets multiple elements (e.g., 3 H1s forming one visual headline),
  // we DISTRIBUTE the variant text across all elements proportionally by word count.
  // Each element keeps its own CSS (colors, sizes, weights) — we only change the text.
  // This ensures the visual rhythm, color accents, and layout remain intact.
  function applySectionVariant(selector, text, testMethod) {
    if (!selector || !text) return;

    // Split comma-separated selectors into individual parts
    var parts = selector.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
    var allElements = [];
    for (var i = 0; i < parts.length; i++) {
      try {
        var matches = document.querySelectorAll(parts[i]);
        for (var j = 0; j < matches.length; j++) {
          if (allElements.indexOf(matches[j]) === -1) allElements.push(matches[j]);
        }
      } catch(e) {}
    }

    if (allElements.length === 0) return;

    // === SINGLE ELEMENT: simple replacement ===
    if (allElements.length === 1) {
      if (testMethod === "html_swap" || /<[a-z][\s\S]*>/i.test(text)) {
        allElements[0].innerHTML = text;
      } else {
        allElements[0].textContent = text;
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
        // If a line is empty (variant text shorter than # of elements), hide it
        allElements[n].style.display = "none";
        allElements[n].setAttribute("data-sa-hidden", "true");
      } else {
        allElements[n].textContent = lineText;
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
        if (data.headline.selector) {
          applySectionVariant(data.headline.selector, data.headline.text, data.headline.testMethod || "text_swap");
        } else {
          applyLegacyVariant("h1", data.headline.text, "text_swap");
        }
      }
      // Apply subheadline variant — SKIP if control
      if (data.subheadline && data.subheadline.text && !data.subheadline.isControl) {
        if (data.subheadline.selector) {
          applySectionVariant(data.subheadline.selector, data.subheadline.text, data.subheadline.testMethod || "text_swap");
        } else {
          applyLegacyVariant("h2", data.subheadline.text, "text_swap");
        }
      }
      // Apply section variants (body_copy, CTAs, etc.) — SKIP controls
      if (data.sections && Array.isArray(data.sections)) {
        data.sections.forEach(function(sv) {
          if (!sv || !sv.text || sv.isControl) return;
          if (sv.selector) {
            applySectionVariant(sv.selector, sv.text, sv.testMethod || "text_swap");
          }
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
          // For headline/subheadline, check if the selector elements exist
          var varData = data.headline || data.subheadline;
          if (varData && varData.selector) {
            var firstSel = varData.selector.split(",")[0].trim();
            try { return !!document.querySelector(firstSel); } catch(e) { return false; }
          }
          // For sections, check if any section selector exists
          if (data.sections && data.sections.length > 0) {
            for (var i = 0; i < data.sections.length; i++) {
              if (data.sections[i].selector) {
                try { return !!document.querySelector(data.sections[i].selector.split(",")[0].trim()); } catch(e) {}
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
