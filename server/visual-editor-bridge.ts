/**
 * Visual Editor Bridge Script
 * 
 * Injected into the user's page when loaded in the WYSIWYG editor iframe.
 * Communicates with the parent SiteAmoeba dashboard via postMessage.
 * 
 * Responsibilities:
 * - Highlight testable text sections on hover
 * - Make sections click-to-select, then contentEditable
 * - Send edits back to the parent frame
 * - Handle DOM quirks across all page builders (GHL, ClickFunnels, WordPress, etc.)
 * - Apply variant text for preview with live visual feedback
 */

export function generateEditorBridgeScript(
  testSections: Array<{
    id: number;
    sectionId: string;
    label: string;
    selector: string;
    category: string;
    currentText: string | null;
    testMethod: string;
  }>,
  variants: Array<{
    id: number;
    text: string;
    type: string;
    isControl: boolean;
    testSectionId: number | null;
  }>,
  campaignId: number
): string {
  return `
<script>
(function() {
  // === SiteAmoeba Visual Editor Bridge ===
  var SA_EDITOR = {
    selectedElement: null,
    selectedSectionId: null,
    originalTexts: {},   // sectionId -> original DOM text
    appliedTexts: {},    // sectionId -> currently applied text
    elementMap: {},      // sectionId -> DOM element
    hoveredElement: null,
    isEditing: false,
    sections: ${JSON.stringify(testSections)},
    variants: ${JSON.stringify(variants)},
    campaignId: ${campaignId}
  };

  // === PLATFORM-AGNOSTIC ELEMENT FINDER ===
  // Reuses the same 3-strategy cascade from the live widget
  // to guarantee WYSIWYG accuracy: what you edit = what visitors see

  // Known GHL text container classes
  var GHL_TEXT_CLASSES = [
    "main-heading-button", "main-heading", "button-text",
    "text-output", "heading-text", "hl-text"
  ];

  function findTextTarget(el) {
    for (var k = 0; k < GHL_TEXT_CLASSES.length; k++) {
      var inner = el.querySelector("." + GHL_TEXT_CLASSES[k]);
      if (inner && (inner.textContent || "").trim().length > 0) return inner;
    }
    var candidates = el.querySelectorAll("*");
    var bestLeaf = el;
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

  function findElementForSection(section) {
    var selector = section.selector;
    var currentText = section.currentText || "";
    var category = section.category;
    var elements = [];

    // STRATEGY 1: CSS selector
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

    // Filter multi-matches by text fingerprint
    if (elements.length > 1 && currentText) {
      var fp = currentText.trim().toLowerCase();
      var fpTokens = fp.split(/ +/).filter(function(w) { return w.length > 2; }).slice(0, 6);
      if (fpTokens.length >= 2) {
        var filtered = [];
        for (var fi = 0; fi < elements.length; fi++) {
          var elTxt = (elements[fi].textContent || "").trim().toLowerCase();
          var hits = 0;
          for (var ft = 0; ft < fpTokens.length; ft++) {
            if (elTxt.indexOf(fpTokens[ft]) !== -1) hits++;
          }
          if (hits >= Math.ceil(fpTokens.length * 0.5)) filtered.push(elements[fi]);
        }
        if (filtered.length > 0) elements = filtered;
      }
    }
    if (elements.length > 0) return elements[0];

    // STRATEGY 2: Text fingerprint search
    if (currentText) {
      var tokens = currentText.trim().toLowerCase().split(/ +/).filter(function(w) { return w.length > 2; });
      if (tokens.length > 0) {
        var isCTA = category === "cta" || category === "button";
        var tagSets = isCTA
          ? ["button", "[class*='btn']", "[class*='cbutton']", "[class*='cta']", "a[href*='#']", "a"]
          : ["h1", "h2", "h3", "[class*='heading']", "[class*='cheading']", "[class*='title']", "p", "span"];
        var bestScore = 0;
        var bestEl = null;
        for (var ts = 0; ts < tagSets.length; ts++) {
          try {
            var candidates = document.querySelectorAll(tagSets[ts]);
            for (var ci = 0; ci < candidates.length; ci++) {
              var candidateText = (candidates[ci].textContent || "").trim().toLowerCase();
              if (candidateText.length < 2) continue;
              var score = 0;
              for (var ti = 0; ti < tokens.length; ti++) {
                if (candidateText.indexOf(tokens[ti]) !== -1) score++;
              }
              var threshold = Math.max(1, Math.ceil(tokens.length * 0.6));
              if (score >= threshold && score > bestScore) {
                bestScore = score;
                bestEl = candidates[ci];
              }
            }
          } catch(e) {}
        }
        if (bestEl) return bestEl;
      }
    }

    // STRATEGY 3: Broad fallback
    if (currentText) {
      var anyTokens = currentText.trim().toLowerCase().split(/ +/)
        .filter(function(w) { return w.length > 3; }).slice(0, 4);
      if (anyTokens.length > 0) {
        var allEls = document.querySelectorAll("h1,h2,h3,h4,p,button,a,span,div");
        for (var ai = 0; ai < allEls.length; ai++) {
          if (allEls[ai].children.length > 5) continue;
          var t = (allEls[ai].textContent || "").trim().toLowerCase();
          if (t.length < 3 || t.length > 500) continue;
          var matchCount = 0;
          for (var at = 0; at < anyTokens.length; at++) {
            if (t.indexOf(anyTokens[at]) !== -1) matchCount++;
          }
          if (matchCount >= Math.ceil(anyTokens.length * 0.5)) return allEls[ai];
        }
      }
    }

    return null;
  }

  // === MAP SECTIONS TO DOM ELEMENTS ===
  function mapSections() {
    var mapped = 0;
    for (var i = 0; i < SA_EDITOR.sections.length; i++) {
      var section = SA_EDITOR.sections[i];
      var el = findElementForSection(section);
      if (el) {
        SA_EDITOR.elementMap[section.id] = el;
        SA_EDITOR.originalTexts[section.id] = el.textContent || "";
        el.setAttribute("data-sa-editor-section", String(section.id));
        el.setAttribute("data-sa-editor-category", section.category);
        el.setAttribute("data-sa-editor-label", section.label);
        mapped++;
      }
    }
    // Notify parent how many sections were found
    window.parent.postMessage({
      type: "sa-editor-ready",
      mapped: mapped,
      total: SA_EDITOR.sections.length,
      sections: SA_EDITOR.sections.map(function(s) {
        return {
          id: s.id,
          sectionId: s.sectionId,
          label: s.label,
          category: s.category,
          found: !!SA_EDITOR.elementMap[s.id],
          originalText: SA_EDITOR.originalTexts[s.id] || s.currentText || ""
        };
      })
    }, "*");
  }

  // === HOVER HIGHLIGHT ===
  var hoverOverlay = document.createElement("div");
  hoverOverlay.id = "sa-editor-hover";
  hoverOverlay.style.cssText = "position:absolute;pointer-events:none;border:2px dashed #14b8a6;border-radius:4px;z-index:999998;transition:all 0.15s ease;display:none;";
  document.body.appendChild(hoverOverlay);

  var hoverLabel = document.createElement("div");
  hoverLabel.style.cssText = "position:absolute;top:-24px;left:0;background:#14b8a6;color:#fff;font-size:11px;font-family:system-ui,sans-serif;padding:2px 8px;border-radius:3px 3px 0 0;white-space:nowrap;pointer-events:none;";
  hoverOverlay.appendChild(hoverLabel);

  // === SELECTION HIGHLIGHT ===
  var selectOverlay = document.createElement("div");
  selectOverlay.id = "sa-editor-select";
  selectOverlay.style.cssText = "position:absolute;pointer-events:none;border:2px solid #0ea5e9;border-radius:4px;z-index:999999;box-shadow:0 0 0 4px rgba(14,165,233,0.15);display:none;";
  document.body.appendChild(selectOverlay);

  var selectLabel = document.createElement("div");
  selectLabel.style.cssText = "position:absolute;top:-26px;left:0;background:#0ea5e9;color:#fff;font-size:11px;font-family:system-ui,sans-serif;padding:2px 8px;border-radius:3px 3px 0 0;white-space:nowrap;pointer-events:none;font-weight:600;";
  selectOverlay.appendChild(selectLabel);

  function positionOverlay(overlay, el) {
    var rect = el.getBoundingClientRect();
    var scrollX = window.scrollX || window.pageXOffset;
    var scrollY = window.scrollY || window.pageYOffset;
    overlay.style.top = (rect.top + scrollY - 2) + "px";
    overlay.style.left = (rect.left + scrollX - 2) + "px";
    overlay.style.width = (rect.width + 4) + "px";
    overlay.style.height = (rect.height + 4) + "px";
    overlay.style.display = "block";
  }

  function updateOverlays() {
    if (SA_EDITOR.hoveredElement && SA_EDITOR.hoveredElement !== SA_EDITOR.selectedElement) {
      positionOverlay(hoverOverlay, SA_EDITOR.hoveredElement);
    } else {
      hoverOverlay.style.display = "none";
    }
    if (SA_EDITOR.selectedElement) {
      positionOverlay(selectOverlay, SA_EDITOR.selectedElement);
    }
  }

  // Reposition overlays on scroll/resize
  window.addEventListener("scroll", updateOverlays, { passive: true });
  window.addEventListener("resize", updateOverlays, { passive: true });

  // === MOUSE EVENTS ===
  document.addEventListener("mousemove", function(e) {
    if (SA_EDITOR.isEditing) return; // Don't change hover while editing
    var target = e.target;
    // Walk up to find an SA editor section element
    var sectionEl = null;
    var el = target;
    for (var i = 0; i < 10 && el && el !== document.body; i++) {
      if (el.getAttribute && el.getAttribute("data-sa-editor-section")) {
        sectionEl = el;
        break;
      }
      el = el.parentElement;
    }
    if (sectionEl && sectionEl !== SA_EDITOR.selectedElement) {
      SA_EDITOR.hoveredElement = sectionEl;
      hoverLabel.textContent = sectionEl.getAttribute("data-sa-editor-label") || "Section";
      positionOverlay(hoverOverlay, sectionEl);
      document.body.style.cursor = "pointer";
    } else if (!sectionEl) {
      SA_EDITOR.hoveredElement = null;
      hoverOverlay.style.display = "none";
      document.body.style.cursor = "";
    }
  }, { passive: true });

  // === CLICK TO SELECT ===
  document.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var target = e.target;
    // Walk up to find an SA editor section element
    var sectionEl = null;
    var el = target;
    for (var i = 0; i < 10 && el && el !== document.body; i++) {
      if (el.getAttribute && el.getAttribute("data-sa-editor-section")) {
        sectionEl = el;
        break;
      }
      el = el.parentElement;
    }

    if (sectionEl) {
      selectSection(sectionEl);
    }
  }, true);

  function selectSection(el) {
    // Deselect previous
    if (SA_EDITOR.selectedElement && SA_EDITOR.selectedElement !== el) {
      SA_EDITOR.selectedElement.removeAttribute("contenteditable");
      SA_EDITOR.selectedElement.style.outline = "";
      SA_EDITOR.isEditing = false;
    }

    SA_EDITOR.selectedElement = el;
    SA_EDITOR.selectedSectionId = parseInt(el.getAttribute("data-sa-editor-section"));
    var label = el.getAttribute("data-sa-editor-label") || "Section";
    var category = el.getAttribute("data-sa-editor-category") || "";
    selectLabel.textContent = "Editing: " + label;
    positionOverlay(selectOverlay, el);
    hoverOverlay.style.display = "none";

    // Make it contentEditable
    el.setAttribute("contenteditable", "true");
    el.style.outline = "none"; // Remove browser's default contenteditable outline
    el.focus();
    SA_EDITOR.isEditing = true;

    // Notify parent
    window.parent.postMessage({
      type: "sa-editor-section-selected",
      sectionId: SA_EDITOR.selectedSectionId,
      label: label,
      category: category,
      currentText: el.textContent || "",
      originalText: SA_EDITOR.originalTexts[SA_EDITOR.selectedSectionId] || "",
      innerHTML: el.innerHTML
    }, "*");
  }

  // === LIVE TEXT CHANGE TRACKING ===
  document.addEventListener("input", function(e) {
    if (!SA_EDITOR.selectedElement || !SA_EDITOR.isEditing) return;
    var el = SA_EDITOR.selectedElement;
    var newText = el.textContent || "";
    var sectionId = SA_EDITOR.selectedSectionId;
    SA_EDITOR.appliedTexts[sectionId] = newText;

    // Debounced notify to parent
    clearTimeout(SA_EDITOR._inputDebounce);
    SA_EDITOR._inputDebounce = setTimeout(function() {
      window.parent.postMessage({
        type: "sa-editor-text-changed",
        sectionId: sectionId,
        text: newText,
        innerHTML: el.innerHTML,
        originalText: SA_EDITOR.originalTexts[sectionId] || ""
      }, "*");
      // Reposition overlay since text may have changed element size
      positionOverlay(selectOverlay, el);
    }, 150);
  }, true);

  // === RECEIVE COMMANDS FROM PARENT ===
  window.addEventListener("message", function(e) {
    var data = e.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case "sa-editor-apply-text":
        // Apply text from parent (e.g., from variant selection or Brain suggestion).
        // CRITICAL: must use the same write-strategy as the production widget
        // (server/widget-script.ts:applyTextToElement) so the visual editor preview
        // matches what users will actually see when the variant goes live.
        // Without this, complex headlines (multi-span H1s like FunnelMites/Brizy)
        // render correctly in production but show garbled "original + variant"
        // text in the editor preview, breaking trust in the WYSIWYG promise.
        var targetEl = SA_EDITOR.elementMap[data.sectionId];
        if (targetEl) {
          var category = targetEl.getAttribute("data-sa-editor-category") || "";
          var newText = data.text || "";
          var isHtml = data.html && (data.testMethod === "html_swap" || /<[a-z][\\s\\S]*>/i.test(newText));

          if (isHtml) {
            targetEl.innerHTML = newText;
          } else if (category === "cta") {
            var textTarget = findTextTarget(targetEl);
            textTarget.textContent = newText;
          } else {
            // === MULTI-STYLED-CHILDREN COLLAPSE ===
            // Mirror server/widget-script.ts:333-405. When an H1/H2 has multiple
            // sibling styled wrappers (e.g. Brizy/FunnelMites:
            //   <h1>
            //     <strong><em>Original line one</em></strong>
            //     <br>
            //     <em>Original line two</em>
            //   </h1>
            // ), writing textContent on the H1 sometimes left siblings behind
            // (depending on whether textContent or innerHTML path was taken).
            // The widget collapses to the first styled wrapper and removes the
            // others; we do the same here so the preview matches production.
            var styledTags = { SPAN:1, STRONG:1, EM:1, B:1, I:1, U:1, FONT:1, MARK:1 };
            var presentationTags = { BR:1, HR:1, IMG:1 };
            var elChildren = targetEl.children || [];
            var collapsedMulti = false;
            var writeTarget = targetEl;

            if (elChildren.length >= 2 && elChildren.length <= 8) {
              var firstStyled = null;
              var allOk = true;
              for (var ci = 0; ci < elChildren.length; ci++) {
                var ctag = (elChildren[ci].tagName || "").toUpperCase();
                if (styledTags[ctag]) {
                  if (!firstStyled) firstStyled = elChildren[ci];
                } else if (!presentationTags[ctag]) {
                  allOk = false;
                  break;
                }
              }
              if (allOk && firstStyled) {
                // Remove every OTHER child (later styled siblings + br/hr/img filler)
                var toRemove = [];
                for (var rc = 0; rc < elChildren.length; rc++) {
                  if (elChildren[rc] !== firstStyled) toRemove.push(elChildren[rc]);
                }
                for (var rr = 0; rr < toRemove.length; rr++) {
                  try { toRemove[rr].parentNode && toRemove[rr].parentNode.removeChild(toRemove[rr]); } catch (e) {}
                }
                // Strip whitespace-only text nodes between siblings
                var nn = targetEl.childNodes;
                for (var nx = nn.length - 1; nx >= 0; nx--) {
                  if (nn[nx].nodeType === 3 && !/\\S/.test(nn[nx].nodeValue || "")) {
                    try { targetEl.removeChild(nn[nx]); } catch (e) {}
                  }
                }
                writeTarget = firstStyled;
                collapsedMulti = true;
              }
            }

            // Even when not collapsing, drill into a single styled wrapper so the
            // variant inherits its color/weight (same as widget findSingleWrapperText).
            if (!collapsedMulti) {
              var hop = targetEl;
              while (hop && hop.children && hop.children.length === 1 &&
                     styledTags[(hop.children[0].tagName || "").toUpperCase()] &&
                     (hop.children[0].textContent || "").length === (hop.textContent || "").length) {
                hop = hop.children[0];
              }
              writeTarget = hop;
            }

            // Preserve text color in case writing on the outer element loses it.
            var computedColor = "";
            try {
              var colorSource = writeTarget.querySelector("span, strong, em, b, i") || writeTarget;
              computedColor = window.getComputedStyle(colorSource).color || "";
            } catch(e) {}

            writeTarget.textContent = newText;

            if (computedColor && computedColor !== "rgb(0, 0, 0)" && computedColor !== "rgba(0, 0, 0, 0)") {
              writeTarget.style.color = computedColor;
            }
          }

          SA_EDITOR.appliedTexts[data.sectionId] = newText;
          // Select this element
          selectSection(targetEl);
          // Scroll into view
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        break;

      case "sa-editor-revert":
        // Revert a section to its original text
        var revertEl = SA_EDITOR.elementMap[data.sectionId];
        if (revertEl) {
          var origText = SA_EDITOR.originalTexts[data.sectionId];
          if (origText !== undefined) {
            revertEl.textContent = origText;
            delete SA_EDITOR.appliedTexts[data.sectionId];
          }
          window.parent.postMessage({
            type: "sa-editor-text-changed",
            sectionId: data.sectionId,
            text: origText || "",
            originalText: origText || "",
            reverted: true
          }, "*");
        }
        break;

      case "sa-editor-scroll-to":
        // Scroll to a section
        var scrollEl = SA_EDITOR.elementMap[data.sectionId];
        if (scrollEl) {
          scrollEl.scrollIntoView({ behavior: "smooth", block: "center" });
          selectSection(scrollEl);
        }
        break;

      case "sa-editor-deselect":
        if (SA_EDITOR.selectedElement) {
          SA_EDITOR.selectedElement.removeAttribute("contenteditable");
          SA_EDITOR.selectedElement.style.outline = "";
          SA_EDITOR.isEditing = false;
          SA_EDITOR.selectedElement = null;
          SA_EDITOR.selectedSectionId = null;
          selectOverlay.style.display = "none";
        }
        break;

      case "sa-editor-get-state":
        // Return full current state to parent
        var state = {};
        for (var sid in SA_EDITOR.elementMap) {
          var stateEl = SA_EDITOR.elementMap[sid];
          state[sid] = {
            currentText: stateEl.textContent || "",
            originalText: SA_EDITOR.originalTexts[sid] || "",
            hasChanges: (stateEl.textContent || "") !== (SA_EDITOR.originalTexts[sid] || "")
          };
        }
        window.parent.postMessage({
          type: "sa-editor-state",
          state: state
        }, "*");
        break;
    }
  });

  // === BLOCK ALL NAVIGATION ===
  document.addEventListener("click", function(e) {
    // Allow clicks on SA editor elements, block everything else
    var target = e.target;
    if (target.tagName === "A" || target.closest("a")) {
      e.preventDefault();
    }
  }, false);
  document.addEventListener("submit", function(e) { e.preventDefault(); }, true);

  // === KEYBOARD SHORTCUTS ===
  document.addEventListener("keydown", function(e) {
    // Escape deselects
    if (e.key === "Escape" && SA_EDITOR.selectedElement) {
      SA_EDITOR.selectedElement.removeAttribute("contenteditable");
      SA_EDITOR.selectedElement.style.outline = "";
      SA_EDITOR.isEditing = false;
      SA_EDITOR.selectedElement = null;
      selectOverlay.style.display = "none";
      window.parent.postMessage({ type: "sa-editor-deselected" }, "*");
    }
  });

  // === INJECT EDITOR TOOLBAR CSS ===
  var style = document.createElement("style");
  style.textContent = [
    "[data-sa-editor-section] { transition: box-shadow 0.15s ease !important; }",
    "[data-sa-editor-section]:hover { box-shadow: inset 0 0 0 1px rgba(20, 184, 166, 0.3) !important; }",
    "[data-sa-editor-section][contenteditable='true'] { box-shadow: inset 0 0 0 2px rgba(14, 165, 233, 0.4) !important; cursor: text !important; }",
    "[data-sa-editor-section][contenteditable='true']:focus { outline: none !important; }",
    // Don't let the page's own hover effects interfere
    "#sa-editor-hover, #sa-editor-select { font-family: system-ui, -apple-system, sans-serif !important; }",
  ].join("\\n");
  document.head.appendChild(style);

  // === INIT: Map sections after DOM is ready ===
  function init() {
    // Try immediately, then retry for dynamically rendered pages (GHL, CF, etc.)
    var retries = [0, 500, 1500, 3000, 5000];
    var lastMapped = 0;
    retries.forEach(function(delay) {
      setTimeout(function() {
        // Re-map to catch late-loading elements
        SA_EDITOR.elementMap = {};
        SA_EDITOR.originalTexts = {};
        mapSections();
      }, delay);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>
<style>
  /* Editor mode indicator bar */
  body::before {
    content: "SiteAmoeba Visual Editor — Click any highlighted section to edit";
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 999999;
    background: linear-gradient(135deg, #0ea5e9, #6366f1);
    color: white;
    text-align: center;
    padding: 8px 0;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  body { padding-top: 34px !important; }
</style>`;
}
