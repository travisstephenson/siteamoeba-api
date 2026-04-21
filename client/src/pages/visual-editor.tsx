import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Monitor,
  Smartphone,
  MousePointerClick,
  Save,
  X,
  CheckCircle2,
  Loader2,
  Sparkles,
  Eye,
  Play,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient, API_BASE, getAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Campaign, Variant } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

// ---- Types ----

interface ElementIdentity {
  tagName: string;
  textContent: string;
  treePath: string;
  computedStyles: {
    color: string;
    fontSize: string;
    fontWeight: string;
    fontFamily: string;
    lineHeight: string;
    letterSpacing: string;
    textTransform: string;
    fontStyle: string;
  };
  parentInfo: string;
  outerHTML: string;
  rect: { top: number; left: number; width: number; height: number };
  isImage?: boolean;
  imageSrc?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageRenderedWidth?: number;
  imageRenderedHeight?: number;
}

interface StyleOverrides {
  color: string;
  fontWeight: string;
  fontSize: string;
  lineHeight: string;
  fontStyle: string;
  textTransform: string;
  letterSpacing: string;
}

// ---- Helpers ----

function parsePx(value: string): string {
  return value?.replace("px", "") ?? "";
}

function buildProxyUrl(campaignId: number, token: string): string {
  return `https://siteamoeba-api-production.up.railway.app/api/campaigns/${campaignId}/editor-proxy?token=${encodeURIComponent(token)}`;
}

function isRealVariant(v: Variant): boolean {
  // Filter out instruction/strategy text that isn't actual replacement text
  if (!v.text) return false;
  const lower = v.text.toLowerCase();
  if (lower.startsWith("move ") || lower.startsWith("add ") || lower.startsWith("replace ") ||
      lower.startsWith("restructure ") || lower.startsWith("reposition ")) return false;
  if (lower.includes("above the fold") || lower.includes("button to appear")) return false;
  return true;
}

// ---- Main Component ----

export default function VisualEditorPage() {
  const [, params] = useRoute("/campaigns/:id/visual-editor");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const campaignId = params?.id ? parseInt(params.id) : NaN;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // UI state
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const [selectedElement, setSelectedElement] = useState<ElementIdentity | null>(null);
  const [variantText, setVariantText] = useState("");
  const [previewVariantId, setPreviewVariantId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [toolbarColor, setToolbarColor] = useState("#000000");
  const [mobileFontSize, setMobileFontSize] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const [styleOverrides, setStyleOverrides] = useState<StyleOverrides>({
    color: "",
    fontWeight: "",
    fontSize: "",
    lineHeight: "",
    fontStyle: "normal",
    textTransform: "none",
    letterSpacing: "",
  });

  // Image variant state
  const [imageUrl, setImageUrl] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");

  // ---- Data fetching ----

  const { data: campaign } = useQuery<Campaign>({
    queryKey: ["/api/campaigns", campaignId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  const { data: allVariants = [], refetch: refetchVariants } = useQuery<Variant[]>({
    queryKey: ["/api/campaigns", campaignId, "variants"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/variants`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  // Fetch the test sections so we can determine which section a variant belongs to
  // AND whether that section is actually toggled ON. A challenger that isn't linked to
  // an ACTIVE section should NOT show up as a 'live variant' in the editor.
  const { data: testSections = [] } = useQuery<any[]>({
    queryKey: ["/api/campaigns", campaignId, "test-sections"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/test-sections`);
      return res.json();
    },
    enabled: isAuthenticated && !isNaN(campaignId),
  });

  // Build a quick lookup of which sections are currently active
  const activeSectionIds = new Set(
    (testSections || []).filter((s: any) => s.isActive).map((s: any) => s.id)
  );

  // Only surface challengers that (a) are active in the DB AND (b) belong to a section
  // the user has toggled ON in the dashboard. Previously, orphaned is_active variants
  // showed up in the editor as 'Active Test' even when every section toggle was OFF.
  const activeChallengers = allVariants.filter(v =>
    !v.isControl && v.isActive && isRealVariant(v) &&
    v.testSectionId && activeSectionIds.has(v.testSectionId)
  );

  // Group challengers BY SECTION so the panel shows distinct tests separately
  // (instead of labeling a body-copy variant and a headline variant as 'A' and 'B').
  const challengersBySection = activeChallengers.reduce((acc: Record<number, { section: any; challengers: Variant[] }>, v) => {
    const sid = v.testSectionId as number;
    if (!acc[sid]) {
      const section = (testSections || []).find((s: any) => s.id === sid);
      acc[sid] = { section, challengers: [] };
    }
    acc[sid].challengers.push(v);
    return acc;
  }, {});
  const activeSectionGroups = Object.values(challengersBySection);
  const hasActiveTest = activeSectionGroups.length > 0;

  // ---- postMessage listener ----

  // Only update editor innerHTML when a new element is selected (not on every edit)
  useEffect(() => {
    if (editorRef.current && selectedElement) {
      editorRef.current.innerHTML = selectedElement.textContent;
    }
  }, [selectedElement]);

  // Rich text editor helpers
  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setVariantText(editorRef.current.innerHTML);
    }
  }

  function setSelectionFontSize(size: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    try {
      const span = document.createElement("span");
      span.style.fontSize = size;
      range.surroundContents(span);
    } catch {
      // surroundContents fails on partial selections across multiple nodes — use insertHTML fallback
      document.execCommand("insertHTML", false, `<span style="font-size:${size}">${sel.toString()}</span>`);
    }
    if (editorRef.current) setVariantText(editorRef.current.innerHTML);
  }

  function selectAiSuggestion(text: string) {
    setVariantText(text);
    if (editorRef.current) {
      editorRef.current.innerHTML = text;
    }
  }

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!event.data || event.data.type !== "SA_ELEMENT_SELECTED") return;
      const el: ElementIdentity = event.data.data;
      setSelectedElement(el);
      setVariantText(el.textContent);
      setMobileFontSize("");
      setAiSuggestions([]);
      setStyleOverrides({
        color: el.computedStyles.color || "",
        fontWeight: el.computedStyles.fontWeight || "400",
        fontSize: parsePx(el.computedStyles.fontSize) || "",
        lineHeight: parsePx(el.computedStyles.lineHeight) || "",
        fontStyle: el.computedStyles.fontStyle || "normal",
        textTransform: el.computedStyles.textTransform || "none",
        letterSpacing: parsePx(el.computedStyles.letterSpacing) || "",
      });
    },
    []
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/auth");
  }, [authLoading, isAuthenticated, navigate]);

  // ---- Preview variant in iframe ----

  function sendPreviewToIframe(variant: Variant | null) {
    if (!iframeRef.current?.contentWindow) return;
    if (!variant || variant.isControl) {
      iframeRef.current.contentWindow.postMessage({ type: "SA_RESET_VIEW" }, "*");
      setPreviewVariantId(null);
    } else {
      let elementIdentity: any = null;
      let styleOverridesData: any = null;
      try {
        const m = JSON.parse(variant.mutations || "{}");
        elementIdentity = m.elementIdentity;
        styleOverridesData = m.styleOverrides;
      } catch {}

      // FALLBACK: variants created by scan/autopilot (not the visual editor) have
      // mutations = []. Without elementIdentity the iframe has nothing to target.
      // Derive it from the test section's CSS selector + control text (same signals
      // the widget uses at runtime) so the preview still works.
      if (!elementIdentity) {
        const section = (testSections || []).find((s: any) => s.id === variant.testSectionId);
        if (section) {
          elementIdentity = {
            selector: section.selector || (variant.type === "headline" ? "h1" : variant.type === "subheadline" ? "h2" : undefined),
            currentText: section.currentText || "",
            tagName: (variant.type === "headline" ? "H1" : variant.type === "subheadline" ? "H2" : "DIV"),
          };
        }
      }

      iframeRef.current.contentWindow.postMessage({
        type: "SA_APPLY_VARIANT",
        data: { variantId: variant.id, text: variant.text, elementIdentity, styleOverrides: styleOverridesData }
      }, "*");
      setPreviewVariantId(variant.id);
    }
  }

  // ---- Generate AI suggestions ----

  async function handleGenerateAI() {
    if (!selectedElement) return;
    setIsGenerating(true);
    setAiSuggestions([]);
    try {
      const res = await apiRequest("POST", `/api/ai/generate-variants`, {
        campaignId,
        type: "headline",
        currentText: selectedElement.textContent,
        elementTag: selectedElement.tagName,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || "Generation failed");
      }
      const data = await res.json();
      const suggestions = data.variants?.map((v: any) => v.text || v) || [];
      setAiSuggestions(suggestions.filter((s: string) => typeof s === "string" && s.length > 3));
    } catch (err: any) {
      toast({ title: "AI Generation Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  // ---- Save variant mutation ----

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedElement) throw new Error("No element selected");
      const mutations = {
        elementIdentity: {
          tagName: selectedElement.tagName,
          treePath: selectedElement.treePath,
          textFingerprint: selectedElement.textContent.toLowerCase().slice(0, 80),
          originalText: selectedElement.textContent,
          originalStyles: selectedElement.computedStyles,
        },
        styleOverrides: Object.fromEntries(
          Object.entries(styleOverrides).filter(([, v]) => v !== "" && v !== "none" && v !== "normal")
        ),
        mobileFontSize: mobileFontSize || null,
      };
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/variants`, {
        type: "headline",
        text: variantText,
        testSectionId: null,
        mutations: JSON.stringify(mutations),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || "Failed to save variant");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Variant saved", description: "Your variant has been created." });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      refetchVariants();
      handleCancel();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  // ---- Handlers ----

  async function handleGenerateImage() {
    if (!imagePrompt.trim()) return;
    setIsGeneratingImage(true);
    try {
      const res = await apiRequest("POST", "/api/ai/generate-image", {
        prompt: imagePrompt,
        width: selectedElement?.imageWidth || 1024,
        height: selectedElement?.imageHeight || 1024,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Generation failed");
      }
      const data = await res.json();
      if (data.url) setImageUrl(data.url);
    } catch (err: any) {
      toast({ title: "Image Generation Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGeneratingImage(false);
    }
  }

  async function handleSaveImageVariant() {
    if (!selectedElement || !imageUrl) return;
    try {
      const mutations = {
        elementIdentity: {
          tagName: selectedElement.tagName,
          treePath: selectedElement.treePath,
          isImage: true,
          originalSrc: selectedElement.imageSrc,
          originalWidth: selectedElement.imageWidth,
          originalHeight: selectedElement.imageHeight,
        },
        newImageUrl: imageUrl,
      };
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/variants`, {
        type: "image",
        text: imageUrl,
        testSectionId: null,
        mutations: JSON.stringify(mutations),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to save");
      }
      toast({ title: "Image variant saved", description: "Your image variant has been created." });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      handleCancel();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  }

  function handleCancel() {
    setSelectedElement(null);
    setVariantText("");
    setMobileFontSize("");
    setAiSuggestions([]);
    setStyleOverrides({ color: "", fontWeight: "", fontSize: "", lineHeight: "", fontStyle: "normal", textTransform: "none", letterSpacing: "" });
    setImageUrl("");
    setImagePrompt("");
  }

  function updateStyle(key: keyof StyleOverrides, value: string) {
    setStyleOverrides((prev) => ({ ...prev, [key]: value }));
  }

  // ---- Iframe src ----

  const token = getAuthToken() || "";
  const iframeSrc = !isNaN(campaignId) && token ? buildProxyUrl(campaignId, token) : "";

  // ---- Render ----

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header Bar ── */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0 bg-background z-10">
        <Button
          variant="ghost" size="sm"
          onClick={() => navigate(`/campaigns/${campaignId}`)}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="button-back-to-campaign"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-semibold truncate max-w-xs">{campaign?.name ?? "Loading…"}</span>
        <div className="flex-1" />

        <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
          <Button variant={viewMode === "desktop" ? "secondary" : "ghost"} size="sm" className="h-7 px-2.5"
            onClick={() => setViewMode("desktop")}>
            <Monitor className="w-3.5 h-3.5 mr-1" /> Desktop
          </Button>
          <Button variant={viewMode === "mobile" ? "secondary" : "ghost"} size="sm" className="h-7 px-2.5"
            onClick={() => setViewMode("mobile")}>
            <Smartphone className="w-3.5 h-3.5 mr-1" /> Mobile
          </Button>
        </div>

        {campaign && (
          <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="text-xs">
            {campaign.status === "active" ? "Active" : campaign.status ?? "Draft"}
          </Badge>
        )}
      </header>

      {/* ── Main split layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: iframe preview */}
        <div className="flex-1 min-w-0 bg-muted/30 flex items-start justify-center overflow-auto p-4">
          <div className={`bg-white shadow-xl rounded-lg overflow-hidden transition-all duration-300 ${
            viewMode === "mobile" ? "w-[390px]" : "w-full max-w-5xl"
          }`} style={{ minHeight: "calc(100vh - 120px)" }}>
            {iframeSrc ? (
              <iframe ref={iframeRef} src={iframeSrc} sandbox="allow-scripts allow-same-origin allow-forms"
                className="w-full border-0" style={{ minHeight: "calc(100vh - 120px)", display: "block" }}
                title="Page preview" />
            ) : (
              <div className="flex items-center justify-center h-96 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading preview…
              </div>
            )}
          </div>
        </div>

        {/* Right: editing panel */}
        <div className="w-[380px] shrink-0 border-l border-border flex flex-col bg-background overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">

              {/* ── Active Tests ── one group per active section ── */}
              {hasActiveTest && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {activeSectionGroups.length === 1 ? "Active Test" : `Active Tests (${activeSectionGroups.length})`}
                      </Label>
                    </div>

                    {/* Global Control button — resets the page to its original rendering */}
                    <button onClick={() => sendPreviewToIframe(null)}
                      className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                        previewVariantId === null ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      }`}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">Control</Badge>
                        <span className="text-xs text-muted-foreground">Show the page as visitors see it</span>
                      </div>
                    </button>

                    {/* One group per active section. Each group's variants are labeled
                        A, B, C … within that section, so the labels make sense. */}
                    {activeSectionGroups.map(({ section, challengers }) => (
                      <div key={section?.id || Math.random()} className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wide px-1">
                          <span>{section?.label || "Unnamed section"}</span>
                          <span className="text-muted-foreground/50">·</span>
                          <span className="lowercase">{section?.category}</span>
                        </div>
                        {challengers.map((v, idx) => (
                          <button key={v.id} onClick={() => sendPreviewToIframe(v)}
                            className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                              previewVariantId === v.id ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                            }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={previewVariantId === v.id ? "default" : "secondary"} className="text-[10px]">
                                Variant {String.fromCharCode(65 + idx)}
                              </Badge>
                              <Eye className="w-3 h-3 text-muted-foreground" />
                            </div>
                            <p className="text-xs text-foreground leading-snug line-clamp-2">{v.text}</p>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <Separator />
                </>
              )}

              {/* ── Element selected: editing mode ── */}
              {selectedElement ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">{selectedElement.tagName}</Badge>
                        <span className="text-xs text-muted-foreground">selected</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCancel}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <Separator />

                  {selectedElement.isImage ? (
                    /* ── IMAGE EDITING PANEL ── */
                    <div className="space-y-4">
                      {/* Current image preview */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Current Image
                        </Label>
                        <div className="rounded-md border border-border overflow-hidden bg-muted/30">
                          <img
                            src={selectedElement.imageSrc}
                            alt={selectedElement.imageAlt || ""}
                            className="w-full h-auto max-h-48 object-contain"
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {selectedElement.imageWidth}×{selectedElement.imageHeight}px
                          {selectedElement.imageRenderedWidth ? ` (displayed at ${selectedElement.imageRenderedWidth}×${selectedElement.imageRenderedHeight}px)` : ""}
                        </p>
                      </div>

                      <Separator />

                      {/* Option 1: Image URL */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                          Replacement Image URL
                        </Label>
                        <Input
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="https://example.com/image.jpg"
                          className="text-xs h-8"
                          data-testid="input-image-url"
                        />
                      </div>

                      {/* Option 2: Generate with AI */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Or Generate with AI
                        </Label>
                        <Textarea
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          placeholder="Describe the image you want... e.g. 'A woman in her 60s with glowing, youthful skin, warm lighting, lifestyle photography'"
                          className="text-xs resize-none min-h-[60px]"
                          data-testid="textarea-image-prompt"
                        />
                        <Button
                          variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5"
                          onClick={handleGenerateImage}
                          disabled={isGeneratingImage || !imagePrompt.trim()}
                          data-testid="button-generate-image"
                        >
                          {isGeneratingImage
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                            : <><Sparkles className="w-3.5 h-3.5" /> Generate Image</>}
                        </Button>
                      </div>

                      {/* Preview of new image */}
                      {imageUrl && (
                        <>
                          <Separator />
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                              New Image Preview
                            </Label>
                            <div className="rounded-md border border-primary/30 overflow-hidden bg-muted/30">
                              <img src={imageUrl} alt="Preview" className="w-full h-auto max-h-48 object-contain" />
                            </div>
                          </div>
                        </>
                      )}

                      <Separator />

                      {/* Save */}
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 h-9 text-xs gap-1.5"
                          onClick={handleSaveImageVariant}
                          disabled={!imageUrl}
                          data-testid="button-save-image-variant"
                        >
                          <Save className="w-3.5 h-3.5" /> Save Image Variant
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={handleCancel}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* ── TEXT EDITING PANEL ── */
                    <div className="space-y-4">
                      {/* Original text */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Original Text
                        </Label>
                        <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                          {selectedElement.textContent}
                        </div>
                      </div>

                      {/* Generate with AI */}
                      <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5"
                        onClick={handleGenerateAI} disabled={isGenerating}>
                        {isGenerating ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5" /> Generate With AI</>
                        )}
                      </Button>

                      {/* AI suggestions */}
                      {aiSuggestions.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            AI Suggestions — click to use
                          </Label>
                          {aiSuggestions.map((s, i) => (
                            <button key={i} onClick={() => selectAiSuggestion(s)}
                              className={`w-full text-left rounded-md border px-3 py-2 text-xs leading-relaxed transition-colors ${
                                variantText === s ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                              }`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Variant text — rich text editor */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                          Variant Text
                        </Label>
                        {/* Toolbar */}
                        <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/30">
                          <button
                            onMouseDown={(e) => { e.preventDefault(); execFormat("bold"); }}
                            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-xs font-bold"
                            title="Bold"
                          >B</button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); execFormat("italic"); }}
                            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-xs italic"
                            title="Italic"
                          >I</button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); execFormat("underline"); }}
                            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-xs underline"
                            title="Underline"
                          >U</button>
                          <div className="w-px h-5 bg-border mx-0.5" />
                          <div className="relative">
                            <input
                              type="color"
                              value={toolbarColor}
                              onChange={(e) => {
                                setToolbarColor(e.target.value);
                                execFormat("foreColor", e.target.value);
                              }}
                              className="w-7 h-7 rounded border border-border cursor-pointer bg-transparent"
                              title="Text Color"
                            />
                          </div>
                          <div className="w-px h-5 bg-border mx-0.5" />
                          <select
                            onChange={(e) => {
                              if (e.target.value) setSelectionFontSize(e.target.value);
                              e.target.value = "";
                            }}
                            className="h-7 text-xs rounded border border-border bg-background px-1"
                            title="Font Size"
                            defaultValue=""
                          >
                            <option value="" disabled>Size</option>
                            {["14px","16px","18px","20px","24px","28px","32px","36px","40px","48px"].map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        {/* Contenteditable editor */}
                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                          onInput={() => {
                            if (editorRef.current) setVariantText(editorRef.current.innerHTML);
                          }}
                        />
                      </div>

                      {/* Mobile Font Size */}
                      <div className="flex items-center gap-3">
                        <Label className="text-xs w-28 shrink-0">Mobile Font Size</Label>
                        <div className="flex items-center gap-1.5 flex-1">
                          <Input
                            value={mobileFontSize}
                            onChange={(e) => setMobileFontSize(e.target.value)}
                            placeholder="e.g. 24"
                            className="text-xs h-8"
                          />
                          <span className="text-xs text-muted-foreground shrink-0">px</span>
                        </div>
                      </div>

                      <Separator />

                      {/* Style controls */}
                      <div className="space-y-3">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                          Style Controls
                        </Label>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs w-28 shrink-0">Text Color</Label>
                          <div className="flex items-center gap-2 flex-1">
                            <input type="color"
                              value={styleOverrides.color.startsWith("#") ? styleOverrides.color : "#000000"}
                              onChange={(e) => updateStyle("color", e.target.value)}
                              className="w-8 h-8 rounded border border-border cursor-pointer bg-transparent" />
                            <Input value={styleOverrides.color} onChange={(e) => updateStyle("color", e.target.value)}
                              placeholder="e.g. #d4a800" className="text-xs h-8 flex-1" />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs w-28 shrink-0">Font Weight</Label>
                          <Select value={styleOverrides.fontWeight} onValueChange={(v) => updateStyle("fontWeight", v)}>
                            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select weight" /></SelectTrigger>
                            <SelectContent>
                              {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                                <SelectItem key={w} value={w} className="text-xs">{w}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs w-28 shrink-0">Font Size</Label>
                          <div className="flex items-center gap-1.5 flex-1">
                            <Input value={styleOverrides.fontSize} onChange={(e) => updateStyle("fontSize", e.target.value)}
                              placeholder="e.g. 32" className="text-xs h-8" />
                            <span className="text-xs text-muted-foreground shrink-0">px</span>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button className="flex-1 h-9 text-xs gap-1.5"
                          onClick={() => saveMutation.mutate()}
                          disabled={saveMutation.isPending || !variantText.trim() || variantText === selectedElement.textContent}>
                          {saveMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                          ) : (
                            <><Save className="w-3.5 h-3.5" /> Save Variant</>
                          )}
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={handleCancel}
                          disabled={saveMutation.isPending}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : !hasActiveTest ? (
                /* ── No test running: prompt to start ── */
                <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <MousePointerClick className="w-7 h-7 text-primary" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold">Start a Variant Test</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Click on the text you want to test in the preview. Then generate AI alternatives or write your own variant.
                    </p>
                  </div>
                  <div className="w-full rounded-lg border border-dashed border-border p-3 space-y-2 text-left">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">How it works</p>
                    {[
                      "1. Click any headline, subheading, or text",
                      "2. Generate alternatives with AI or write your own",
                      "3. Preview how it looks, adjust styling",
                      "4. Save and start the test",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                        <span className="text-xs text-muted-foreground">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── Test running, no element selected ── */
                <div className="flex flex-col items-center justify-center text-center py-8 px-4 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Play className="w-6 h-6 text-green-500" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold">Test Running</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      You have {activeChallengers.length} active variant{activeChallengers.length !== 1 ? "s" : ""} being tested.
                      Use the preview toggle above to see each variant.
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Click on any text element to create a new variant for a different section.
                    </p>
                  </div>
                </div>
              )}

            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
