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
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { apiRequest, queryClient, API_BASE } from "@/lib/queryClient";
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
  // Strip "px" so the input shows just the number
  return value?.replace("px", "") ?? "";
}

function buildProxyUrl(campaignId: number): string {
  const base = API_BASE.startsWith("__") ? "" : API_BASE;
  return `${base}/api/campaigns/${campaignId}/editor-proxy`;
}

// ---- Main Component ----

export default function VisualEditorPage() {
  const [, params] = useRoute("/campaigns/:id/visual-editor");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const campaignId = params?.id ? parseInt(params.id) : NaN;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const [selectedElement, setSelectedElement] = useState<ElementIdentity | null>(null);
  const [variantText, setVariantText] = useState("");
  const [styleOverrides, setStyleOverrides] = useState<StyleOverrides>({
    color: "",
    fontWeight: "",
    fontSize: "",
    lineHeight: "",
    fontStyle: "normal",
    textTransform: "none",
    letterSpacing: "",
  });

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

  // Only show variants that have a mutations field (visual editor variants)
  const visualVariants = allVariants.filter((v) => {
    if (!v.mutations) return false;
    try {
      const m = JSON.parse(v.mutations);
      return !!m?.elementIdentity?.treePath;
    } catch {
      return false;
    }
  });

  // ---- postMessage listener ----

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!event.data || event.data.type !== "SA_ELEMENT_SELECTED") return;
      const el: ElementIdentity = event.data.data;
      setSelectedElement(el);
      setVariantText(el.textContent);
      // Seed style overrides from computed styles
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

  // ---- Auth redirect ----

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/auth");
    }
  }, [authLoading, isAuthenticated, navigate]);

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
      toast({ title: "Variant saved", description: "Your visual variant has been created." });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId, "variants"] });
      refetchVariants();
      handleCancel();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err.message || "Could not save the variant.",
        variant: "destructive",
      });
    },
  });

  // ---- Handlers ----

  function handleCancel() {
    setSelectedElement(null);
    setVariantText("");
    setStyleOverrides({
      color: "",
      fontWeight: "",
      fontSize: "",
      lineHeight: "",
      fontStyle: "normal",
      textTransform: "none",
      letterSpacing: "",
    });
  }

  function updateStyle(key: keyof StyleOverrides, value: string) {
    setStyleOverrides((prev) => ({ ...prev, [key]: value }));
  }

  // ---- Iframe src ----

  const iframeSrc = !isNaN(campaignId) ? buildProxyUrl(campaignId) : "";

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
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/campaigns/${campaignId}`)}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="button-back-to-campaign"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Campaign
        </Button>

        <Separator orientation="vertical" className="h-5" />

        <span className="text-sm font-semibold truncate max-w-xs" data-testid="text-campaign-name">
          {campaign?.name ?? "Loading…"}
        </span>

        <div className="flex-1" />

        {/* Viewport toggle */}
        <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
          <Button
            variant={viewMode === "desktop" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5"
            onClick={() => setViewMode("desktop")}
            data-testid="button-view-desktop"
          >
            <Monitor className="w-3.5 h-3.5 mr-1" />
            Desktop
          </Button>
          <Button
            variant={viewMode === "mobile" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5"
            onClick={() => setViewMode("mobile")}
            data-testid="button-view-mobile"
          >
            <Smartphone className="w-3.5 h-3.5 mr-1" />
            Mobile
          </Button>
        </div>

        {/* Campaign status badge */}
        {campaign && (
          <Badge
            variant={campaign.status === "active" ? "default" : "secondary"}
            className="text-xs"
            data-testid="badge-campaign-status"
          >
            {campaign.status === "active" ? "Active" : campaign.status ?? "Draft"}
          </Badge>
        )}
      </header>

      {/* ── Main split layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: iframe preview — 70% */}
        <div
          className="flex-1 min-w-0 bg-muted/30 flex items-start justify-center overflow-auto p-4"
          data-testid="panel-iframe-preview"
        >
          <div
            className={`bg-white shadow-xl rounded-lg overflow-hidden transition-all duration-300 ${
              viewMode === "mobile" ? "w-[390px]" : "w-full max-w-5xl"
            }`}
            style={{ minHeight: "calc(100vh - 120px)" }}
          >
            {iframeSrc ? (
              <iframe
                ref={iframeRef}
                src={iframeSrc}
                sandbox="allow-scripts allow-same-origin allow-forms"
                className="w-full border-0"
                style={{ minHeight: "calc(100vh - 120px)", display: "block" }}
                title="Page preview"
                data-testid="iframe-page-preview"
              />
            ) : (
              <div className="flex items-center justify-center h-96 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading preview…
              </div>
            )}
          </div>
        </div>

        {/* Right: editing panel — 30% */}
        <div
          className="w-[380px] shrink-0 border-l border-border flex flex-col bg-background overflow-hidden"
          data-testid="panel-editor-right"
        >
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {!selectedElement ? (
                /* ── State A: nothing selected ── */
                <div
                  className="flex flex-col items-center justify-center text-center py-16 px-4 space-y-4"
                  data-testid="panel-empty-state"
                >
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <MousePointerClick className="w-7 h-7 text-primary" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold">Click to Select an Element</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Click on any text element in the preview to select it. Then create a variant
                      with custom text and styling.
                    </p>
                  </div>
                  <div className="w-full rounded-lg border border-dashed border-border p-3 space-y-1.5 text-left">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      What you can test
                    </p>
                    {["Headlines (H1, H2, H3)", "Body copy & paragraphs", "Subheadings & labels"].map(
                      (item) => (
                        <div key={item} className="flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">{item}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ) : (
                /* ── State B: element selected ── */
                <div className="space-y-4" data-testid="panel-element-selected">
                  {/* Selected element header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono" data-testid="badge-element-tag">
                          {selectedElement.tagName}
                        </Badge>
                        <span className="text-xs text-muted-foreground">selected</span>
                      </div>
                      <p
                        className="text-xs text-muted-foreground truncate max-w-[240px]"
                        title={selectedElement.treePath}
                        data-testid="text-element-path"
                      >
                        {selectedElement.treePath}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={handleCancel}
                      data-testid="button-cancel-selection"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <Separator />

                  {/* Original text */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Original Text
                    </Label>
                    <div
                      className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground leading-relaxed"
                      data-testid="text-original-content"
                    >
                      {selectedElement.textContent}
                    </div>
                  </div>

                  {/* Variant text */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      Variant Text
                    </Label>
                    <Textarea
                      value={variantText}
                      onChange={(e) => setVariantText(e.target.value)}
                      placeholder="Enter your variant text…"
                      className="text-sm resize-none min-h-[80px]"
                      data-testid="textarea-variant-text"
                    />
                  </div>

                  <Separator />

                  {/* Style controls */}
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                      Style Controls
                    </Label>

                    {/* Color */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Text Color</Label>
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="color"
                          value={styleOverrides.color.startsWith("#") ? styleOverrides.color : "#000000"}
                          onChange={(e) => updateStyle("color", e.target.value)}
                          className="w-8 h-8 rounded border border-border cursor-pointer bg-transparent"
                          data-testid="input-color"
                        />
                        <Input
                          value={styleOverrides.color}
                          onChange={(e) => updateStyle("color", e.target.value)}
                          placeholder="e.g. #d4a800"
                          className="text-xs h-8 flex-1"
                          data-testid="input-color-text"
                        />
                      </div>
                    </div>

                    {/* Font Weight */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Font Weight</Label>
                      <Select
                        value={styleOverrides.fontWeight}
                        onValueChange={(v) => updateStyle("fontWeight", v)}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-font-weight">
                          <SelectValue placeholder="Select weight" />
                        </SelectTrigger>
                        <SelectContent>
                          {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                            <SelectItem key={w} value={w} className="text-xs">
                              {w}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Font Size */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Font Size</Label>
                      <div className="flex items-center gap-1.5 flex-1">
                        <Input
                          value={styleOverrides.fontSize}
                          onChange={(e) => updateStyle("fontSize", e.target.value)}
                          placeholder="e.g. 32"
                          className="text-xs h-8"
                          data-testid="input-font-size"
                        />
                        <span className="text-xs text-muted-foreground shrink-0">px</span>
                      </div>
                    </div>

                    {/* Line Height */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Line Height</Label>
                      <div className="flex items-center gap-1.5 flex-1">
                        <Input
                          value={styleOverrides.lineHeight}
                          onChange={(e) => updateStyle("lineHeight", e.target.value)}
                          placeholder="e.g. 1.4"
                          className="text-xs h-8"
                          data-testid="input-line-height"
                        />
                      </div>
                    </div>

                    {/* Font Style */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Font Style</Label>
                      <Select
                        value={styleOverrides.fontStyle}
                        onValueChange={(v) => updateStyle("fontStyle", v)}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-font-style">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                          <SelectItem value="italic" className="text-xs">Italic</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Text Transform */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Text Transform</Label>
                      <Select
                        value={styleOverrides.textTransform}
                        onValueChange={(v) => updateStyle("textTransform", v)}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-text-transform">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-xs">None</SelectItem>
                          <SelectItem value="uppercase" className="text-xs">Uppercase</SelectItem>
                          <SelectItem value="lowercase" className="text-xs">Lowercase</SelectItem>
                          <SelectItem value="capitalize" className="text-xs">Capitalize</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Letter Spacing */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-28 shrink-0">Letter Spacing</Label>
                      <div className="flex items-center gap-1.5 flex-1">
                        <Input
                          value={styleOverrides.letterSpacing}
                          onChange={(e) => updateStyle("letterSpacing", e.target.value)}
                          placeholder="e.g. 0.05"
                          className="text-xs h-8"
                          data-testid="input-letter-spacing"
                        />
                        <span className="text-xs text-muted-foreground shrink-0">em</span>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 h-8 text-xs gap-1.5"
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || !variantText.trim()}
                      data-testid="button-save-variant"
                    >
                      {saveMutation.isPending ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          Save as Variant
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={handleCancel}
                      disabled={saveMutation.isPending}
                      data-testid="button-cancel-edit"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Saved Variants ── */}
              {visualVariants.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Saved Visual Variants ({visualVariants.length})
                      </Label>
                    </div>
                    <div className="space-y-2" data-testid="list-saved-variants">
                      {visualVariants.map((v) => {
                        let parsedMutations: any = null;
                        try {
                          parsedMutations = JSON.parse(v.mutations!);
                        } catch {}
                        const tag = parsedMutations?.elementIdentity?.tagName ?? "?";
                        return (
                          <div
                            key={v.id}
                            className="rounded-lg border border-border bg-card p-3 space-y-1"
                            data-testid={`card-visual-variant-${v.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                {tag}
                              </Badge>
                              {!v.isActive && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <p
                              className="text-xs text-foreground leading-snug line-clamp-2"
                              data-testid={`text-visual-variant-${v.id}`}
                            >
                              {v.text}
                            </p>
                            {parsedMutations?.elementIdentity?.treePath && (
                              <p className="text-[10px] text-muted-foreground font-mono truncate">
                                {parsedMutations.elementIdentity.treePath}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
