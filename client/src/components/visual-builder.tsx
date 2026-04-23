// Visual Builder v2 — sidebar-driven variant creation.
//
// UX model:
//   - Iframe is a LIVE PREVIEW. Never an editing surface.
//   - User can click any element on the page to re-target the variant.
//   - All text + style edits happen in the sidebar. Every keystroke posts
//     back to the iframe so the user sees changes live on the real page.
//   - Two creation modes: Write My Own OR Generate with AI.
//   - Device toggle (desktop / mobile) resizes the iframe viewport — mobile
//     variants are saved separately (viewport tagged at save time).
//   - After save, user can flip between Control / Variant preview and then
//     hit "Deploy Variant Test" to activate it and close the builder.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidateActiveTests } from "@/hooks/use-active-tests";
import {
  X, Save, RefreshCw, Type, Sparkles, PencilLine, Smartphone, Monitor,
  Rocket, Check, Eye, Wand2, AlertTriangle, Image as ImageIcon, Upload, Link as LinkIcon, Loader2,
} from "lucide-react";

// ---------- Types ----------
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
  editingVariant?: Variant | null;
  section: Section;
}
interface Selection {
  tagName: string;
  originalText: string;
  treePath: string;
  elementHash: string;
  computedStyles: Record<string, string>;
  isImage: boolean;
}
interface AISuggestion {
  text: string;
  strategy: string;
  reasoning: string;
  recommended?: boolean;
}

// ---------- Component ----------
export function VisualBuilder({ open, onClose, campaignId, editingVariant, section }: Props) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [variantText, setVariantText] = useState<string>("");
  // Image-mode state — only used when the selection is an <img>
  const [imageUrl, setImageUrl] = useState<string>("");             // final URL to save as variant.text
  const [imageMode, setImageMode] = useState<"choose" | "upload" | "ai" | "url">("choose");
  const [imagePrompt, setImagePrompt] = useState<string>("");
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"choose" | "manual" | "ai">("choose");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [chosenAiIndex, setChosenAiIndex] = useState<number | null>(null);
  const [styleOverrides, setStyleOverrides] = useState<Record<string, string>>({});
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [iframeReady, setIframeReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedVariantId, setSavedVariantId] = useState<number | null>(null);
  const [compareShowing, setCompareShowing] = useState<"variant" | "control">("variant");

  // ---------- Iframe message bridge ----------
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data || {};
      if (msg.type === "SA_ELEMENT_SELECTED") {
        const d = msg.data;
        // Reset editing state fully when a different element is selected.
        // This prevents old textarea text from getting written onto the
        // newly selected element via the debounced preview effect.
        setVariantText("");
        setMode("choose");
        setStyleOverrides({});
        setSavedVariantId(null);
        setAiSuggestions([]);
        setChosenAiIndex(null);
        // Brief pause so the reset propagates before the new selection lands
        // (prevents a stale SA_COMMAND_PREVIEW_TEXT from firing on the new el)
        // Reset image-mode state too when the selection changes
        setImageUrl("");
        setImageMode("choose");
        setImagePrompt("");
        setTimeout(() => {
          setSelection({
            tagName: d.tagName,
            originalText: d.originalText,
            treePath: d.treePath,
            elementHash: d.elementHash || "",
            computedStyles: d.computedStyles || {},
            isImage: !!d.isImage,
          });
        }, 80);
      } else if (msg.type === "SA_FOCUS_NOT_FOUND") {
        // Section text wasn't found on the live page. User must click manually.
        // Don't toast — the sidebar empty state already tells them what to do.
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ---------- Auto-focus the section's element when the iframe is ready ----------
  useEffect(() => {
    if (!iframeReady) return;
    const seedText = editingVariant?.captureOriginalText || section.currentText;
    if (!seedText) return;
    const t = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SA_COMMAND_FOCUS_BY_TEXT", text: seedText },
        "*",
      );
    }, 500);
    return () => clearTimeout(t);
  }, [iframeReady, editingVariant, section.currentText]);

  // ---------- Push variantText → iframe live preview on change ----------
  useEffect(() => {
    if (!iframeReady || !selection) return;
    // Only push a preview when the text differs from the original. When
    // variantText is empty (user cleared it, or a fresh selection reset it),
    // do NOT send any command — let the current page state persist. Clicking
    // a new element already reset the prior one in the bridge.
    const trimmed = variantText.trim();
    if (trimmed === "") return;
    if (trimmed === (selection.originalText || "").trim()) {
      // Same text as original — tell the iframe to revert so any prior preview clears
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_REVERT" }, "*");
      return;
    }
    // Debounce to avoid flooding the iframe on every keystroke
    const t = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SA_COMMAND_PREVIEW_TEXT", text: variantText },
        "*",
      );
    }, 60);
    return () => clearTimeout(t);
  }, [variantText, selection, iframeReady]);

  // ---------- Push style overrides → iframe ----------
  useEffect(() => {
    if (!iframeReady || !selection) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "SA_COMMAND_APPLY_STYLES", styles: styleOverrides },
      "*",
    );
  }, [styleOverrides, selection, iframeReady]);

  // ---------- Compare mode toggles what the iframe shows ----------
  useEffect(() => {
    if (!savedVariantId || !iframeReady) return;
    if (compareShowing === "control") {
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_REVERT" }, "*");
    } else {
      // Re-apply the variant text + style overrides
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SA_COMMAND_PREVIEW_TEXT", text: variantText },
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SA_COMMAND_APPLY_STYLES", styles: styleOverrides },
        "*",
      );
    }
  }, [compareShowing, savedVariantId, iframeReady, variantText, styleOverrides]);

  // ---------- Generate with AI ----------
  async function handleGenerateWithAI() {
    setMode("ai");
    setAiLoading(true);
    setAiSuggestions([]);
    setChosenAiIndex(null);
    try {
      const resp = await apiRequest("POST", `/api/ai/generate-variants`, {
        campaignId, type: section.category, sectionId: section.id,
      });
      const data = await resp.json();
      // Normalize: some paths return { variants } others { suggestions }
      const items: AISuggestion[] = (data.variants || data.suggestions || []).map((v: any, i: number) => ({
        text: v.text || v.content || "",
        strategy: v.strategy || "",
        reasoning: v.reasoning || v.rationale || "",
        recommended: i === 0, // the endpoint returns strongest-first; first gets the badge
      }));
      setAiSuggestions(items.slice(0, 3));
    } catch (err: any) {
      toast({
        title: "Couldn't generate variants",
        description: err?.message || "AI provider error. Try again or use Write My Own.",
        variant: "destructive",
      });
      setMode("choose");
    } finally {
      setAiLoading(false);
    }
  }

  function pickAiSuggestion(idx: number) {
    setChosenAiIndex(idx);
    const t = aiSuggestions[idx].text;
    setVariantText(t);
    // Force preview immediately instead of waiting for the debounced useEffect.
    // This guarantees the user sees the picked suggestion on the page the
    // instant they click it, even if React batches the state update.
    iframeRef.current?.contentWindow?.postMessage(
      { type: "SA_COMMAND_PREVIEW_TEXT", text: t },
      "*",
    );
  }

  // ---------- Image helpers ----------
  // Convert a File to a base64 dataURL for our /api/images/upload endpoint.
  // (We deliberately avoid multer on the server so there's no extra dependency.)
  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function handleImageFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Pick a JPG, PNG, WebP, or GIF file.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 5MB. Try compressing or resizing first.", variant: "destructive" });
      return;
    }
    setImageBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await apiRequest("POST", "/api/images/upload", { dataUrl });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || "Upload failed");
      setImageUrl(j.url);
      // Push to the iframe so the user sees it instantly
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_PREVIEW_TEXT", text: j.url }, "*");
      toast({ title: "Image ready", description: "Previewed on the page. Hit Deploy to launch the test." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Try a different file.", variant: "destructive" });
    } finally {
      setImageBusy(false);
    }
  }

  async function handleImageGenerate() {
    if (!imagePrompt.trim()) {
      toast({ title: "Prompt required", description: "Describe the image you want to test.", variant: "destructive" });
      return;
    }
    setImageBusy(true);
    try {
      const r = await apiRequest("POST", "/api/ai/generate-image", { prompt: imagePrompt });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || "Generation failed");
      setImageUrl(j.url);
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_PREVIEW_TEXT", text: j.url }, "*");
      toast({ title: "Image generated", description: "Previewed on the page. Hit Deploy to launch." });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err?.message || "Try a different prompt.", variant: "destructive" });
    } finally {
      setImageBusy(false);
    }
  }

  async function handleImageFromUrl(url: string) {
    const trimmed = url.trim();
    if (!/^https?:\/\//.test(trimmed)) {
      toast({ title: "Invalid URL", description: "Paste a full image URL (https://...)", variant: "destructive" });
      return;
    }
    setImageBusy(true);
    try {
      const r = await apiRequest("POST", "/api/images/from-url", { url: trimmed });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || "Mirror failed");
      setImageUrl(j.url);
      iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_PREVIEW_TEXT", text: j.url }, "*");
      toast({ title: "Image mirrored", description: "Previewed on the page. Hit Deploy to launch." });
    } catch (err: any) {
      toast({ title: "Mirror failed", description: err?.message || "The URL may be unreachable.", variant: "destructive" });
    } finally {
      setImageBusy(false);
    }
  }

  // ---------- Save ----------
  async function handleSave(activateAfter: boolean) {
    if (!selection) {
      toast({ title: "Pick an element", description: "Click the element on the page you want to vary.", variant: "destructive" });
      return;
    }

    // Image branch — save variant.text = image URL (widget auto-detects and does an src swap)
    if (selection.isImage) {
      if (!imageUrl) {
        toast({ title: "No image selected", description: "Upload, generate, or paste an image URL first.", variant: "destructive" });
        return;
      }
      setIsSaving(true);
      try {
        const payload = {
          type: section.category,
          testSectionId: section.id,
          text: imageUrl,
          capturedStyles: selection.computedStyles,
          capturedTreePath: selection.treePath,
          capturedTagName: selection.tagName,
          captureOriginalText: selection.originalText,
          capturedElementHash: selection.elementHash,
          device,
          isActive: activateAfter,
        };
        let variant;
        if (editingVariant) {
          const r = await apiRequest("PATCH", `/api/variants/${editingVariant.id}/builder`, payload);
          variant = await r.json();
        } else {
          const r = await apiRequest("POST", `/api/campaigns/${campaignId}/builder-variants`, payload);
          variant = await r.json();
        }
        setSavedVariantId(variant.id);
        queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
        queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
        invalidateActiveTests(queryClient, campaignId);
        if (activateAfter) {
          toast({ title: "Image test deployed", description: "The new image is live and splitting traffic." });
          onClose();
        } else {
          toast({ title: "Image variant saved", description: "Ready to deploy when you are." });
        }
      } catch (err: any) {
        toast({ title: "Save failed", description: err?.message || "Something went wrong.", variant: "destructive" });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const trimmed = variantText.trim();
    if (!trimmed) {
      toast({ title: "Text is empty", description: "Write or generate new copy first.", variant: "destructive" });
      return;
    }
    if (trimmed === selection.originalText.trim()) {
      toast({ title: "No change", description: "The new text is identical to the original.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      // Build the final captured_styles payload: start from the element's
      // computed styles, then overlay any user overrides. This is what the
      // widget will replay at serve time.
      const finalStyles = { ...selection.computedStyles, ...styleOverrides };
      const payload = {
        type: section.category,
        testSectionId: section.id,
        text: trimmed,
        capturedStyles: finalStyles,
        capturedTreePath: selection.treePath,
        capturedTagName: selection.tagName,
        captureOriginalText: selection.originalText,
        capturedElementHash: selection.elementHash,
        device, // desktop | mobile — carried as metadata
        isActive: activateAfter,
      };
      let variant;
      if (editingVariant) {
        const r = await apiRequest("PATCH", `/api/variants/${editingVariant.id}/builder`, payload);
        variant = await r.json();
      } else {
        const r = await apiRequest("POST", `/api/campaigns/${campaignId}/builder-variants`, payload);
        variant = await r.json();
      }
      setSavedVariantId(variant.id);
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
      invalidateActiveTests(queryClient, campaignId);
      if (activateAfter) {
        toast({ title: "Test deployed", description: "The variant is live and splitting traffic now." });
        onClose();
      } else {
        toast({ title: "Variant saved", description: "Review the comparison below, or deploy the test." });
      }
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
    iframeRef.current?.contentWindow?.postMessage({ type: "SA_COMMAND_CLEAR" }, "*");
    onClose();
  }

  // ---------- Iframe URL ----------
  const token = getAuthToken();
  const proxyUrl = `/api/campaigns/${campaignId}/editor-proxy?token=${encodeURIComponent(token || "")}`;

  const iframeWidth = device === "mobile" ? 375 : "100%";
  const iframeHeight = device === "mobile" ? 812 : "100%";

  // ---------- Derived state ----------
  const hasEdit = selection && variantText.trim().length > 0 &&
                  variantText.trim() !== selection.originalText.trim();
  const capturedStylesMerged = useMemo(
    () => ({ ...(selection?.computedStyles || {}), ...styleOverrides }),
    [selection, styleOverrides],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent className="max-w-[97vw] w-[97vw] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col">
        <div className="flex h-full min-h-0">
          {/* LEFT: live preview iframe */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-2.5 border-b bg-gradient-to-r from-primary to-emerald-500 text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Type className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium truncate">
                  {editingVariant ? "Edit variant" : "Create variant"} · {section.label}
                </span>
                {section.persuasionRole && (
                  <Badge variant="secondary" className="text-[10px] capitalize whitespace-nowrap">
                    {section.persuasionRole.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Device toggle */}
                <div className="flex items-center rounded-md bg-white/10">
                  <button
                    className={`px-2 py-1 text-xs rounded-l-md ${device === "desktop" ? "bg-white/20" : "opacity-70"}`}
                    onClick={() => setDevice("desktop")}
                    data-testid="button-device-desktop"
                  >
                    <Monitor className="w-3.5 h-3.5 inline mr-1" /> Desktop
                  </button>
                  <button
                    className={`px-2 py-1 text-xs rounded-r-md ${device === "mobile" ? "bg-white/20" : "opacity-70"}`}
                    onClick={() => setDevice("mobile")}
                    data-testid="button-device-mobile"
                  >
                    <Smartphone className="w-3.5 h-3.5 inline mr-1" /> Mobile
                  </button>
                </div>
                {savedVariantId && (
                  <div className="flex items-center rounded-md bg-white/10">
                    <button
                      className={`px-2 py-1 text-xs rounded-l-md ${compareShowing === "control" ? "bg-white/20" : "opacity-70"}`}
                      onClick={() => setCompareShowing("control")}
                      data-testid="button-compare-control"
                    >
                      Control
                    </button>
                    <button
                      className={`px-2 py-1 text-xs rounded-r-md ${compareShowing === "variant" ? "bg-white/20" : "opacity-70"}`}
                      onClick={() => setCompareShowing("variant")}
                      data-testid="button-compare-variant"
                    >
                      Variant
                    </button>
                  </div>
                )}
                <Button
                  size="sm" variant="ghost"
                  className="text-white hover:bg-white/20 h-7 text-xs"
                  onClick={() => { setIframeReady(false); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}
                  data-testid="button-reload-builder-iframe"
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Reload
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="text-white hover:bg-white/20 h-7 text-xs"
                  onClick={handleCancel}
                  data-testid="button-close-builder"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {/* Tip banner — tells user they can click any text to re-target */}
            <div className="px-4 py-1.5 text-xs bg-muted/40 border-b text-muted-foreground flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              <span>
                Click any text on the page to select a different target. The sidebar controls the variant — the page is a live preview.
              </span>
            </div>
            {/* Iframe container with device-aware sizing */}
            <div className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900 flex items-start justify-center">
              <div
                style={{ width: iframeWidth, height: iframeHeight, maxWidth: "100%" }}
                className={device === "mobile" ? "shadow-xl my-4 rounded-lg overflow-hidden bg-white" : "w-full h-full"}
              >
                <iframe
                  ref={iframeRef}
                  src={proxyUrl}
                  className="w-full h-full border-0"
                  onLoad={() => setIframeReady(true)}
                  title="Visual builder"
                  sandbox="allow-same-origin allow-scripts allow-forms"
                />
              </div>
            </div>
          </div>

          {/* RIGHT: sidebar — flex column where the middle is the only scrollable
              region. min-h-0 is REQUIRED on the column so the overflow-y child
              actually scrolls (flex children ignore overflow without it). */}
          <div className="w-[380px] border-l bg-card flex flex-col shrink-0 min-h-0">
            {/* Selection info */}
            <div className="p-4 border-b space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[11px]">
                  {selection?.tagName || "—"}
                </Badge>
                {section.persuasionRole && (
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {section.persuasionRole.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
              {selection ? (
                <div className="text-xs text-muted-foreground">
                  Original: "
                  <span className="text-foreground">
                    {selection.originalText.slice(0, 80)}{selection.originalText.length > 80 ? "…" : ""}
                  </span>"
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  Click any text on the page to select it.
                </div>
              )}
            </div>

            {/* Main body: scrollable. min-h-0 here too, belt and braces. */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Image mode — only when the selected element is an <img> */}
              {selection && selection.isImage && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ImageIcon className="w-4 h-4 text-primary" />
                    Image variant
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Pick a new image. The widget will swap the image source for
                    visitors in the variant group. Original stays for control visitors.
                  </div>

                  {/* Mode toggle */}
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      variant={imageMode === "upload" ? "default" : "outline"}
                      onClick={() => setImageMode("upload")}
                      data-testid="button-image-mode-upload"
                      className="gap-1.5 h-9"
                    >
                      <Upload className="w-3.5 h-3.5" /> Upload
                    </Button>
                    <Button
                      size="sm"
                      variant={imageMode === "ai" ? "default" : "outline"}
                      onClick={() => setImageMode("ai")}
                      data-testid="button-image-mode-ai"
                      className="gap-1.5 h-9"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> AI
                    </Button>
                    <Button
                      size="sm"
                      variant={imageMode === "url" ? "default" : "outline"}
                      onClick={() => setImageMode("url")}
                      data-testid="button-image-mode-url"
                      className="gap-1.5 h-9"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> URL
                    </Button>
                  </div>

                  {/* Upload panel */}
                  {imageMode === "upload" && (
                    <div className="border-2 border-dashed rounded-md p-4 text-center">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageFileSelect(f);
                          e.target.value = ""; // allow re-select of same file
                        }}
                        data-testid="input-image-file"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={imageBusy}
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-1.5"
                        data-testid="button-pick-image-file"
                      >
                        {imageBusy
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                          : <><Upload className="w-3.5 h-3.5" /> Choose image</>}
                      </Button>
                      <div className="text-[11px] text-muted-foreground mt-2">
                        JPG, PNG, WebP or GIF. Max 5MB.
                      </div>
                    </div>
                  )}

                  {/* AI generate panel */}
                  {imageMode === "ai" && (
                    <div className="space-y-2">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Describe the image
                      </Label>
                      <Textarea
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                        rows={3}
                        className="text-sm"
                        placeholder="e.g. A confident female entrepreneur with a laptop in a sunlit home office, natural lighting, editorial photography"
                        data-testid="textarea-image-prompt"
                      />
                      <Button
                        size="sm"
                        disabled={imageBusy || !imagePrompt.trim()}
                        onClick={handleImageGenerate}
                        className="w-full gap-1.5"
                        data-testid="button-generate-image"
                      >
                        {imageBusy
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                          : <><Sparkles className="w-3.5 h-3.5" /> Generate (5 credits)</>}
                      </Button>
                      <div className="text-[11px] text-muted-foreground">
                        DALL-E 3 image, auto-hosted on our CDN so it never expires.
                      </div>
                    </div>
                  )}

                  {/* URL paste panel */}
                  {imageMode === "url" && (
                    <div className="space-y-2">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Image URL
                      </Label>
                      <Input
                        placeholder="https://example.com/image.jpg"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleImageFromUrl((e.target as HTMLInputElement).value);
                        }}
                        data-testid="input-image-url"
                      />
                      <Button
                        size="sm"
                        disabled={imageBusy}
                        onClick={() => {
                          const input = document.querySelector('[data-testid="input-image-url"]') as HTMLInputElement | null;
                          if (input) handleImageFromUrl(input.value);
                        }}
                        className="w-full gap-1.5"
                      >
                        {imageBusy
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mirroring…</>
                          : <><LinkIcon className="w-3.5 h-3.5" /> Use this URL</>}
                      </Button>
                      <div className="text-[11px] text-muted-foreground">
                        We'll copy the image to our storage so it stays available.
                      </div>
                    </div>
                  )}

                  {/* Selected-image preview */}
                  {imageUrl && (
                    <div className="rounded-md border p-2 bg-muted/30">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        Current challenger image
                      </div>
                      <img
                        src={imageUrl}
                        alt="Variant preview"
                        className="w-full h-auto rounded"
                        style={{ maxHeight: 180, objectFit: "contain" }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Mode chooser */}
              {mode === "choose" && selection && !selection.isImage && (
                <div className="p-4 space-y-3">
                  <div className="text-sm font-semibold">How do you want to create this variant?</div>
                  <Button
                    className="w-full justify-start gap-2 h-14"
                    variant="outline"
                    onClick={() => { setMode("manual"); setVariantText(selection.originalText); }}
                    data-testid="button-mode-manual"
                  >
                    <PencilLine className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <div className="text-sm font-medium">Write my own</div>
                      <div className="text-xs text-muted-foreground font-normal">Full control — craft the copy yourself</div>
                    </div>
                  </Button>
                  <Button
                    className="w-full justify-start gap-2 h-14"
                    variant="outline"
                    onClick={handleGenerateWithAI}
                    data-testid="button-mode-ai"
                  >
                    <Sparkles className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <div className="text-sm font-medium">Generate with AI</div>
                      <div className="text-xs text-muted-foreground font-normal">3 data-backed suggestions, pick one to refine</div>
                    </div>
                  </Button>
                </div>
              )}

              {/* AI suggestions */}
              {mode === "ai" && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5 text-primary" />
                      AI Suggestions
                    </div>
                    <button
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={handleGenerateWithAI}
                      data-testid="button-regenerate-ai"
                    >
                      Regenerate
                    </button>
                  </div>
                  {aiLoading && (
                    <div className="text-xs text-muted-foreground italic">
                      Generating 3 variants grounded in your page context…
                    </div>
                  )}
                  {!aiLoading && aiSuggestions.length === 0 && (
                    <div className="text-xs text-muted-foreground">No suggestions yet. Try Regenerate.</div>
                  )}
                  {aiSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => pickAiSuggestion(i)}
                      className={`w-full text-left rounded-md border p-3 transition ${
                        chosenAiIndex === i
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50 hover:bg-primary/5"
                      }`}
                      data-testid={`button-ai-suggestion-${i}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="text-sm font-medium">{s.text}</div>
                        {chosenAiIndex === i && <Check className="w-4 h-4 text-primary shrink-0" />}
                      </div>
                      {s.strategy && (
                        <Badge variant="outline" className="text-[10px] mr-1 mb-1">{s.strategy}</Badge>
                      )}
                      {s.recommended && (
                        <Badge className="text-[10px] mb-1">Recommended</Badge>
                      )}
                      {s.reasoning && (
                        <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{s.reasoning}</div>
                      )}
                    </button>
                  ))}
                  <button
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setMode("manual")}
                    data-testid="button-switch-to-manual"
                  >
                    or write my own →
                  </button>
                </div>
              )}

              {/* Manual / post-AI editor */}
              {(mode === "manual" || (mode === "ai" && chosenAiIndex !== null)) && selection && (
                <div className="p-4 space-y-4">
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Variant text</Label>
                    <Textarea
                      value={variantText}
                      onChange={(e) => setVariantText(e.target.value)}
                      rows={4}
                      className="mt-1 text-sm"
                      placeholder="Write your new variant…"
                      data-testid="textarea-variant-text"
                    />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Updates the page live as you type.
                    </div>
                  </div>

                  {/* Font controls */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Style overrides (optional)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Weight</Label>
                        <select
                          className="w-full h-8 rounded-md border bg-background text-xs px-2"
                          value={styleOverrides.fontWeight || capturedStylesMerged.fontWeight || ""}
                          onChange={(e) =>
                            setStyleOverrides((s) => ({ ...s, fontWeight: e.target.value }))
                          }
                          data-testid="select-font-weight"
                        >
                          {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                            <option key={w} value={w}>{w}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Size (px)</Label>
                        <Input
                          className="h-8 text-xs"
                          value={styleOverrides.fontSize || capturedStylesMerged.fontSize || ""}
                          onChange={(e) =>
                            setStyleOverrides((s) => ({ ...s, fontSize: e.target.value }))
                          }
                          placeholder="48px"
                          data-testid="input-font-size"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[10px] text-muted-foreground">Color</Label>
                        <Input
                          className="h-8 text-xs"
                          value={styleOverrides.color || capturedStylesMerged.color || ""}
                          onChange={(e) =>
                            setStyleOverrides((s) => ({ ...s, color: e.target.value }))
                          }
                          placeholder="#fff or rgb(255,255,255)"
                          data-testid="input-color"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Save-success state */}
              {savedVariantId && (
                <div className="p-4 border-t bg-primary/5">
                  <div className="flex items-center gap-2 text-primary text-sm font-medium mb-1">
                    <Check className="w-4 h-4" /> Variant saved
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Toggle <kbd className="px-1 py-0.5 rounded border text-[10px]">Control</kbd> /{" "}
                    <kbd className="px-1 py-0.5 rounded border text-[10px]">Variant</kbd> in the header to compare. Deploy the test when you're ready.
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer */}
            <div className="p-4 border-t space-y-2">
              {!savedVariantId ? (
                <>
                  <Button
                    className="w-full gap-1.5"
                    disabled={!hasEdit || isSaving}
                    onClick={() => handleSave(false)}
                    data-testid="button-save-variant-builder"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? "Saving…" : editingVariant ? "Save changes" : "Save variant"}
                  </Button>
                  <Button
                    className="w-full gap-1.5"
                    variant="default"
                    disabled={!hasEdit || isSaving}
                    onClick={() => handleSave(true)}
                    data-testid="button-deploy-test-builder"
                  >
                    <Rocket className="w-4 h-4" />
                    {isSaving ? "Deploying…" : "Save & Deploy Test"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    className="w-full gap-1.5"
                    onClick={async () => {
                      // Activate the saved variant then close
                      try {
                        await apiRequest("PATCH", `/api/variants/${savedVariantId}`, { isActive: true });
                        invalidateActiveTests(queryClient, campaignId);
                        queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "stats"] });
                        toast({ title: "Test deployed", description: "Splitting traffic now." });
                        onClose();
                      } catch (e: any) {
                        toast({ title: "Deploy failed", description: e?.message, variant: "destructive" });
                      }
                    }}
                    data-testid="button-deploy-variant-test"
                  >
                    <Rocket className="w-4 h-4" />
                    Deploy Variant Test
                  </Button>
                  <Button variant="outline" className="w-full" onClick={onClose} data-testid="button-done-builder">
                    Done
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={handleCancel} data-testid="button-cancel-builder">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
