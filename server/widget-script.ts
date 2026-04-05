/**
 * Generates the complete SiteAmoeba widget JavaScript as a string.
 * This is served via GET /api/widget/script/:campaignId with Content-Type: application/javascript.
 * It includes variant assignment + behavioral tracking.
 */
export function generateWidgetScript(apiBase: string, campaignId: number): string {
  return `(function(){
  var API = "${apiBase}";
  var CID = ${campaignId};

  // === VISITOR ID ===
  var vid = localStorage.getItem("sa_vid");
  if (!vid) {
    vid = "v_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
    localStorage.setItem("sa_vid", vid);
  }

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
          params[pair[0]] = decodeURIComponent(pair[1].replace(/\+/g, " "));
        }
      }
    }
    return params;
  })();

  // === VARIANT ASSIGNMENT ===
  var assignUrl = API + "/api/widget/assign?vid=" + vid + "&cid=" + CID + "&ref=" + encodeURIComponent(document.referrer);
  if (utmParams.utm_source)   assignUrl += "&utm_source="   + encodeURIComponent(utmParams.utm_source);
  if (utmParams.utm_medium)   assignUrl += "&utm_medium="   + encodeURIComponent(utmParams.utm_medium);
  if (utmParams.utm_campaign) assignUrl += "&utm_campaign=" + encodeURIComponent(utmParams.utm_campaign);
  if (utmParams.utm_content)  assignUrl += "&utm_content="  + encodeURIComponent(utmParams.utm_content);
  if (utmParams.utm_term)     assignUrl += "&utm_term="     + encodeURIComponent(utmParams.utm_term);
  fetch(assignUrl)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.headline && data.headline.text) {
        var h1 = document.querySelector("h1");
        if (h1) h1.innerHTML = data.headline.text;
      }
      if (data.subheadline && data.subheadline.text) {
        var sub = document.querySelector("h2");
        if (sub) sub.innerHTML = data.subheadline.text;
      }
    })
    .catch(function(e) { console.log("SiteAmoeba: using defaults", e); });

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
