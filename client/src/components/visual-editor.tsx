/**
 * Visual Editor Component
 * 
 * Full-screen WYSIWYG editor that loads the user's page in an iframe
 * with the editor bridge script. Users can:
 * - See all scanned sections highlighted on hover
 * - Click to select and edit inline (contentEditable)
 * - See a sidebar with the section list, original text, and current edits
 * - Save edits as variants or revert to original
 * 
 * Communicates with the iframe via postMessage.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import {
  X, Save, RotateCcw, MousePointerClick, Check, ChevronRight,
  Eye, Loader2, Sparkles, Maximize2, Minimize2, PanelLeftClose, PanelLeft,
} from "lucide-react";

interface SectionInfo {
  id: number;
  sectionId: string;
  label: string;
  category: string;
  found: boolean;
  originalText: string;
}

interface EditState {
  sectionId: number;
  currentText: string;
  originalText: string;
  hasChanges: boolean;
}

interface VisualEditorProps {
  campaignId: number;
  campaignUrl: string;
  token: string;
  onClose: () => void;
  onSaved?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  headline: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  subheadline: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  cta: "bg-green-500/15 text-green-400 border-green-500/30",
  button: "bg-green-500/15 text-green-400 border-green-500/30",
  body: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  social_proof: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  testimonials: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  faq: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  guarantee: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pricing: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

export function VisualEditor({ campaignId, campaignUrl, token, onClose, onSaved }: VisualEditorProps) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [mappedCount, setMappedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const editorUrl = `${API_BASE}/api/campaigns/${campaignId}/visual-editor?token=${encodeURIComponent(token)}`;

  // Listen for messages from the iframe bridge
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type?.startsWith("sa-editor-")) return;

      switch (data.type) {
        case "sa-editor-ready":
          setReady(true);
          setMappedCount(data.mapped);
          setTotalCount(data.total);
          setSections(data.sections || []);
          // Initialize edit state for all found sections
          const initial: Record<number, EditState> = {};
          for (const s of data.sections || []) {
            if (s.found) {
              initial[s.id] = {
                sectionId: s.id,
                currentText: s.originalText,
                originalText: s.originalText,
                hasChanges: false,
              };
            }
          }
          setEdits(initial);
          break;

        case "sa-editor-section-selected":
          setSelectedSection(data.sectionId);
          break;

        case "sa-editor-text-changed":
          setEdits(prev => ({
            ...prev,
            [data.sectionId]: {
              sectionId: data.sectionId,
              currentText: data.text,
              originalText: data.originalText,
              hasChanges: data.text !== data.originalText,
            },
          }));
          break;

        case "sa-editor-deselected":
          setSelectedSection(null);
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Send command to iframe
  const sendToIframe = useCallback((msg: any) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // Scroll to and select a section in the iframe
  const selectSection = (sectionId: number) => {
    setSelectedSection(sectionId);
    sendToIframe({ type: "sa-editor-scroll-to", sectionId });
  };

  // Revert a section to its original text
  const revertSection = (sectionId: number) => {
    sendToIframe({ type: "sa-editor-revert", sectionId });
    setEdits(prev => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        currentText: prev[sectionId]?.originalText || "",
        hasChanges: false,
      },
    }));
  };

  // Apply text to a section from the sidebar
  const applyText = (sectionId: number, text: string) => {
    sendToIframe({ type: "sa-editor-apply-text", sectionId, text });
  };

  // Count sections with changes
  const changedSections = Object.values(edits).filter(e => e.hasChanges);

  // Save all edits as variants
  const saveEdits = async () => {
    if (changedSections.length === 0) return;
    setSaving(true);
    try {
      const editPayload = changedSections.map(e => ({
        sectionId: e.sectionId,
        text: e.currentText,
      }));
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/visual-editor/save`, { edits: editPayload });
      const result = await res.json();
      toast({
        title: "Variants saved",
        description: `${result.count} section${result.count !== 1 ? "s" : ""} saved as test variants. They'll start being shown to visitors.`,
      });
      // Reset change tracking
      setEdits(prev => {
        const updated = { ...prev };
        for (const e of changedSections) {
          updated[e.sectionId] = { ...updated[e.sectionId], hasChanges: false, originalText: e.currentText };
        }
        return updated;
      });
      onSaved?.();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "#0a0e17" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-[380px] shrink-0 flex flex-col border-r border-white/10" style={{ background: "#0f1420" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-semibold text-white">Visual Editor</h2>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSidebarOpen(false)} className="h-7 w-7 p-0 text-white/50 hover:text-white">
                <PanelLeftClose className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-white/50 hover:text-white">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Status bar */}
          <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2">
            {ready ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs text-white/60">
                  {mappedCount} of {totalCount} sections found
                </span>
              </>
            ) : (
              <>
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                <span className="text-xs text-white/60">Loading page and mapping sections...</span>
              </>
            )}
          </div>

          {/* Section list */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sections.filter(s => s.found).map(section => {
                const edit = edits[section.id];
                const isSelected = selectedSection === section.id;
                const hasChanges = edit?.hasChanges;
                const catColor = CATEGORY_COLORS[section.category] || "bg-slate-500/15 text-slate-400 border-slate-500/30";

                return (
                  <div
                    key={section.id}
                    data-testid={`section-item-${section.id}`}
                    className={`rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-sky-500/10 border border-sky-500/30"
                        : "border border-transparent hover:bg-white/5"
                    }`}
                    onClick={() => selectSection(section.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={`text-[9px] px-1.5 h-4 ${catColor}`}>
                        {section.category}
                      </Badge>
                      <span className="text-[11px] font-medium text-white/80 truncate">{section.label}</span>
                      {hasChanges && (
                        <span className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-white/40 line-clamp-2 leading-relaxed">
                      {edit?.currentText || section.originalText || "—"}
                    </p>

                    {/* Expanded edit area when selected */}
                    {isSelected && (
                      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div>
                          <label className="text-[9px] text-white/30 uppercase tracking-wider">Original</label>
                          <p className="text-[10px] text-white/50 mt-0.5 line-clamp-3">
                            {edit?.originalText || "—"}
                          </p>
                        </div>
                        <div>
                          <label className="text-[9px] text-white/30 uppercase tracking-wider">Current edit</label>
                          <Textarea
                            value={edit?.currentText || ""}
                            onChange={(e) => {
                              const newText = e.target.value;
                              setEdits(prev => ({
                                ...prev,
                                [section.id]: {
                                  ...prev[section.id],
                                  currentText: newText,
                                  hasChanges: newText !== (prev[section.id]?.originalText || ""),
                                },
                              }));
                              // Apply to iframe live
                              applyText(section.id, newText);
                            }}
                            rows={3}
                            className="text-xs mt-1 bg-white/5 border-white/10 text-white/90 resize-none"
                            data-testid={`textarea-edit-${section.id}`}
                          />
                        </div>
                        <div className="flex gap-1.5">
                          {hasChanges && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px] text-white/50 hover:text-white gap-1"
                              onClick={() => revertSection(section.id)}
                            >
                              <RotateCcw className="w-3 h-3" />
                              Revert
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unmapped sections */}
              {sections.filter(s => !s.found).length > 0 && (
                <div className="mt-3 px-3">
                  <p className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Not found on page</p>
                  {sections.filter(s => !s.found).map(s => (
                    <div key={s.id} className="text-[10px] text-white/20 py-0.5">{s.label}</div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Save bar */}
          <div className="px-4 py-3 border-t border-white/10">
            <Button
              className="w-full h-9 text-sm font-medium gap-2"
              style={{
                background: changedSections.length > 0
                  ? "linear-gradient(135deg, #10b981 0%, #0ea5e9 100%)"
                  : "rgba(255,255,255,0.06)",
                color: changedSections.length > 0 ? "#fff" : "rgba(255,255,255,0.3)",
              }}
              disabled={changedSections.length === 0 || saving}
              onClick={saveEdits}
              data-testid="button-save-variants"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Saving...</>
              ) : (
                <><Save className="w-4 h-4" />Save {changedSections.length} Variant{changedSections.length !== 1 ? "s" : ""}</>
              )}
            </Button>
            {changedSections.length > 0 && (
              <p className="text-[10px] text-white/30 text-center mt-1.5">
                {changedSections.length} section{changedSections.length !== 1 ? "s" : ""} modified
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sidebar toggle when collapsed */}
      {!sidebarOpen && (
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSidebarOpen(true)}
            className="h-8 px-2 gap-1.5 bg-black/60 backdrop-blur text-white/70 hover:text-white border border-white/10"
          >
            <PanelLeft className="w-4 h-4" />
            <span className="text-xs">Sections</span>
            {changedSections.length > 0 && (
              <span className="ml-1 w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                {changedSections.length}
              </span>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-8 w-8 p-0 bg-black/60 backdrop-blur text-white/70 hover:text-white border border-white/10">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Iframe */}
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src={editorUrl}
          className="w-full h-full border-0"
          style={{ background: "#fff" }}
          sandbox="allow-scripts allow-same-origin allow-forms"
          data-testid="iframe-visual-editor"
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="text-center">
              <Loader2 className="w-8 h-8 text-teal-400 animate-spin mx-auto mb-3" />
              <p className="text-sm text-white/70">Loading page...</p>
              <p className="text-xs text-white/40 mt-1">{campaignUrl}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
