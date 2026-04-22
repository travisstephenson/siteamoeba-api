// Visual Builder modal — the ONLY path for creating/editing variants.
//
// Flow:
//   1. Loads the campaign URL in an iframe via /api/campaigns/:id/editor-proxy
//      (widget stripped, click-select + inline-edit bridge injected)
//   2. On open, the bridge is pre-focused on the section the user launched from
//      (pre-fills the element via postMessage 'SA_COMMAND_FOCUS_BY_TEXT').
//   3. User clicks any other element to re-target; types inline to edit.
//   4. Saving posts the full capture (styles, treePath, tagName, hashed fingerprint,
//      original text) to POST /api/campaigns/:id/builder-variants.
//
// This component replaces ALL other "add/edit variant" text-only inputs.
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidateActiveTests } from "@/hooks/use-active-tests";
import { X, Save, RefreshCw, Type, AlertTriangle } from "lucide-react";

interface Section {
  id: number;
  sectionId: string;
  label: string;
  category: string;
  currentText: string | null;
  persuasionRole?: string | null;
}

interface Variant {
  id: number;
  text: string;
  isControl: boolean;
  testSectionId: number | null;
  capturedTreePath?: string | null;
  capturedTagName?: string | null;
  captureOriginalText?: string | null;
  capturedStyles?: Record<string, string> | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: number;
  // If editing an existing variant, pass it here.
  editingVariant?: Variant | null;
  // If creating a new variant, pass the section to anchor to (the user clicked
  // "Add Variant" from a specific section row).
  section: Section;
}

interface Selection {
  tagName: string;
  textContent: string;
  originalText: string;
  treePath: string;
  elementHash: string;
  computedStyles: Record<string, string>;
  isImage: boolean;
}

export function VisualBuilder({ open, onClose, campaignId, editingVariant, section }: Props) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [currentText, setCurrentText] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);

  // Bridge message handler — listens for selection/edit/commit events from the iframe.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data || {};
      if (msg.type === "SA_ELEMENT_SELECTED") {
        const d = msg.data;
        setSelection({
          tagName: d.tagName,
          textContent: d.textContent,
          originalText: d.originalText || d.textContent,
          treePath: d.treePath,
          elementHash: d.elementHash || "",
          computedStyles: d.computedStyles || {},
          isImage: !!d.isImage,
        });
        setCurrentText(d.textContent || "");
      } else if (msg.type === "SA_ELEMENT_EDITED") {
        setCurrentText(msg.data.currentText || "");
      } else if (msg.type === "SA_ELEMENT_COMMIT") {
        // User pressed Enter in the iframe — treat as Save
        handleSave(msg.data);
      } else if (msg.type === "SA_EDIT_CANCELED") {
        // Iframe reverted the edit; clear local state
        setSelection(null);
        setCurrentText("");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the iframe is ready, ask the bridge to pre-focus the section we came from.
  useEffect(() => {
    if (!iframeReady) return;
    if (!section?.currentText) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    // Small delay so the bridge has time to hook its listeners after inject
    const t = setTimeout(() => {
      iframe.contentWindow?.postMessage(
        { type: "SA_COMMAND_FOCUS_BY_TEXT", text: section.currentText },
        "*",
      );
    }, 400);
    return () => clearTimeout(t);
  }, [iframeReady, section?.currentText]);

  // When editing an existing variant, pre-focus by captureOriginalText if available,
  // else fall back to the section's currentText. Either way the bridge lands on the
  // element and the user sees the live page — they don't start from a text box.
  useEffect(() => {
    if (!iframeReady || !editingVariant) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const focusText = editingVariant.captureOriginalText || section.currentText || "";
    if (!focusText) return;
    const t = setTimeout(() => {
      iframe.contentWindow?.postMessage(
        { type: "SA_COMMAND_FOCUS_BY_TEXT", text: focusText },
        "*",
      );
    }, 500);
    return () => clearTimeout(t);
  }, [iframeReady, editingVariant, section?.currentText]);

  async function handleSave(commitData?: any) {
    if (!selection && !commitData) {
      toast({ title: "Pick an element first", description: "Click any text on the page to edit it.", variant: "destructive" });
      return;
    }
    const src = commitData || {
      treePath: selection!.treePath,
      currentText,
      originalText: selection!.originalText,
      elementHash: selection!.elementHash,
      tagName: selection!.tagName,
      computedStyles: selection!.computedStyles,
    };
    if (!src.currentText || !String(src.currentText).trim()) {
      toast({ title: "Text is empty", description: "Write the new copy before saving.", variant: "destructive" });
      return;
    }
    if (src.currentText.trim() === (src.originalText || "").trim()) {
      toast({ title: "No change", description: "The text is identical to the original. Edit it first.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        type: section.category,
        testSectionId: section.id,
        text: src.currentText,
        capturedStyles: src.computedStyles,
        capturedTreePath: src.treePath,
        capturedTagName: src.tagName,
        captureOriginalText: src.originalText,
        capturedElementHash: src.elementHash,
      };
      if (editingVariant) {
        await apiRequest("PATCH", `/api/variants/${editingVariant.id}/builder`, payload);
        toast({ title: "Variant updated", description: "Changes saved with captured styling." });
      } else {
        await apiRequest("POST", `/api/campaigns/${campaignId}/builder-variants`, payload);
        toast({ title: "Variant created", description: "Saved — your captured styling will be served to visitors." });
      }
      // Tell iframe to commit so the visible edit stays
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_COMMIT" }, "*");
      // Refresh dashboards
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      invalidateActiveTests(queryClient, campaignId);
      onClose();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message || "Something went wrong. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_CANCEL" }, "*");
    setSelection(null);
    setCurrentText("");
    onClose();
  }

  const token = getAuthToken();
  const proxyUrl = `/api/campaigns/${campaignId}/editor-proxy?token=${encodeURIComponent(token || "")}`;

  const hasValidSelection = selection && !selection.isImage && currentText.trim().length > 0;
  const isEditing = !!editingVariant;
  const mismatchWarning =
    selection && section.currentText &&
    selection.originalText.trim().toLowerCase() !== section.currentText.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 overflow-hidden">
        <div className="flex h-full">
          {/* Live iframe */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-2.5 border-b bg-gradient-to-r from-primary to-emerald-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {isEditing ? "Edit variant" : "Create variant"} · {section.label}
                </span>
                {section.persuasionRole && (
                  <Badge variant="secondary" className="text-[10px]">{section.persuasionRole.replace(/_/g, " ")}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white hover:bg-white/20 h-7 text-xs"
                  onClick={() => { setIframeReady(false); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}
                  data-testid="button-reload-builder-iframe"
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Reload
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white hover:bg-white/20 h-7 text-xs"
                  onClick={handleCancel}
                  data-testid="button-close-builder"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <iframe
              ref={iframeRef}
              src={proxyUrl}
              className="flex-1 w-full border-0"
              onLoad={() => setIframeReady(true)}
              title="Visual builder"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          </div>

          {/* Sidebar */}
          <div className="w-[360px] border-l bg-card flex flex-col">
            <div className="p-4 border-b">
              <div className="text-sm font-semibold mb-1">What you're editing</div>
              <div className="text-xs text-muted-foreground">
                Click any text on the page to retarget. Type inline to edit. Press{" "}
                <kbd className="px-1 py-0.5 rounded border text-[10px]">Enter</kbd> to save,{" "}
                <kbd className="px-1 py-0.5 rounded border text-[10px]">Esc</kbd> to cancel.
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!selection ? (
                <div className="text-xs text-muted-foreground italic">
                  Waiting for you to click an element on the page…
                </div>
              ) : selection.isImage ? (
                <div className="space-y-2">
                  <Badge variant="outline">IMG selected</Badge>
                  <p className="text-xs text-muted-foreground">Image variant swap is not supported in the builder yet. Pick a text element.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Target element</div>
                    <Badge variant="outline" className="font-mono text-[11px]">{selection.tagName}</Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Original text</div>
                    <div className="text-xs bg-muted/50 rounded px-2 py-1.5 line-clamp-3">
                      "{selection.originalText}"
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Your new text</div>
                    <div className="text-sm bg-primary/5 border border-primary/20 rounded px-2 py-1.5 min-h-[60px]">
                      {currentText || <span className="italic text-muted-foreground">(edit on the page)</span>}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Captured styles</div>
                    <div className="text-[11px] font-mono grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 bg-muted/30 rounded px-2 py-1.5">
                      {Object.entries(selection.computedStyles).slice(0, 8).map(([k, v]) => (
                        <div key={k} className="contents">
                          <span className="text-muted-foreground">{k}:</span>
                          <span className="truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {mismatchWarning && (
                    <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        The element you selected doesn't match the section's recorded text. The variant will still save but may target a different element than expected.
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t space-y-2">
              <Button
                className="w-full gap-1.5"
                disabled={!hasValidSelection || isSaving}
                onClick={() => handleSave()}
                data-testid="button-save-variant-builder"
              >
                <Save className="w-4 h-4" />
                {isSaving ? "Saving…" : isEditing ? "Save changes" : "Create variant"}
              </Button>
              <Button variant="outline" className="w-full" onClick={handleCancel} disabled={isSaving} data-testid="button-cancel-builder">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
