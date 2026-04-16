/**
 * Revenue Funnel Builder
 * 
 * Per-campaign linear funnel step editor.
 * Users define what's sold at each step: front-end → bump → upsell → etc.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus, Trash2, GripVertical, DollarSign, Save, ArrowDown, ShoppingCart,
} from "lucide-react";

interface FunnelStep {
  id?: number;
  name: string;
  price: string;
  stepType: string;
}

const STEP_TYPES = [
  { value: "front_end", label: "Front-End Offer", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { value: "order_bump", label: "Order Bump", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  { value: "upsell", label: "Upsell", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  { value: "downsell", label: "Downsell", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { value: "recurring", label: "Recurring / Subscription", color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
];

function getStepTypeConfig(type: string) {
  return STEP_TYPES.find(t => t.value === type) || STEP_TYPES[0];
}

export function FunnelBuilder({ campaignId }: { campaignId: number }) {
  const { toast } = useToast();
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading } = useQuery<{ steps: any[] }>({
    queryKey: [`/api/campaigns/${campaignId}/funnel`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/funnel`);
      if (!res.ok) throw new Error("Failed to load funnel");
      return res.json();
    },
  });

  // Sync from API to local state
  useEffect(() => {
    if (data?.steps) {
      setSteps(data.steps.map((s: any) => ({
        id: s.id,
        name: s.name,
        price: String(s.price),
        stepType: s.step_type || "front_end",
      })));
      setHasChanges(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/funnel`, { steps });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: (result) => {
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/funnel`] });
      toast({ title: "Funnel saved", description: `${result.count} step${result.count !== 1 ? "s" : ""} configured.` });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const addStep = () => {
    const nextOrder = steps.length + 1;
    const defaultType = nextOrder === 1 ? "front_end" : nextOrder === 2 ? "order_bump" : "upsell";
    setSteps([...steps, { name: "", price: "", stepType: defaultType }]);
    setHasChanges(true);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updateStep = (index: number, field: keyof FunnelStep, value: string) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], [field]: value };
    setSteps(updated);
    setHasChanges(true);
  };

  const totalValue = steps.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Revenue Funnel
        </CardTitle>
        <CardDescription className="text-xs">
          Define what's sold at each step of your funnel. This helps track revenue per step and lets the Brain understand your offer structure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
        ) : steps.length === 0 ? (
          <div className="text-center py-6">
            <DollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-xs text-muted-foreground mb-3">No funnel steps configured yet.</p>
            <Button size="sm" variant="outline" onClick={addStep} className="gap-1.5" data-testid="button-add-first-step">
              <Plus className="w-3.5 h-3.5" />
              Add Your First Offer
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((step, i) => {
              const typeConfig = getStepTypeConfig(step.stepType);
              return (
                <div key={i} data-testid={`funnel-step-${i}`}>
                  {i > 0 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card">
                    <div className="text-[10px] text-muted-foreground/50 font-bold w-5 text-center shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <Select
                        value={step.stepType}
                        onValueChange={(val) => updateStep(i, "stepType", val)}
                      >
                        <SelectTrigger className="h-8 text-[11px] w-[140px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STEP_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Product name"
                        value={step.name}
                        onChange={(e) => updateStep(i, "name", e.target.value)}
                        className="h-8 text-xs flex-1 min-w-[120px]"
                        data-testid={`input-step-name-${i}`}
                      />
                      <div className="relative shrink-0">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                        <Input
                          placeholder="0.00"
                          value={step.price}
                          onChange={(e) => updateStep(i, "price", e.target.value.replace(/[^0-9.]/g, ""))}
                          className="h-8 text-xs w-[80px] pl-6"
                          data-testid={`input-step-price-${i}`}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeStep(i)}
                      data-testid={`button-remove-step-${i}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Add step + total */}
            <div className="flex items-center justify-between pt-2">
              <Button size="sm" variant="ghost" onClick={addStep} className="gap-1.5 text-xs text-muted-foreground" data-testid="button-add-step">
                <Plus className="w-3.5 h-3.5" />
                Add Step
              </Button>
              <div className="text-xs text-muted-foreground">
                Total funnel value: <span className="font-semibold text-foreground">${totalValue.toFixed(2)}</span>
              </div>
            </div>

            {/* Save */}
            {hasChanges && (
              <div className="pt-2 border-t border-border/50">
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-1.5 w-full"
                  data-testid="button-save-funnel"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saveMutation.isPending ? "Saving..." : "Save Funnel"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
