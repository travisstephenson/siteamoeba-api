/**
 * Revenue Funnel Builder
 * 
 * Per-campaign linear funnel step editor.
 * Pulls products directly from Stripe so names and prices are exact matches.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus, Trash2, DollarSign, Save, ArrowDown, ShoppingCart, ChevronsUpDown, Check,
} from "lucide-react";

interface StripeProduct {
  id: string;
  name: string;
  price: number;
  allPrices: number[];
  chargeCount: number;
}

interface FunnelStep {
  id?: number;
  name: string;
  price: string;
  stepType: string;
  stripeProductId?: string;
  stripePriceId?: string;
}

const STEP_TYPES = [
  { value: "front_end", label: "Front-End Offer" },
  { value: "order_bump", label: "Order Bump" },
  { value: "upsell", label: "Upsell" },
  { value: "downsell", label: "Downsell" },
  { value: "recurring", label: "Recurring / Subscription" },
];

export function FunnelBuilder({ campaignId }: { campaignId: number }) {
  const { toast } = useToast();
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch existing funnel steps
  const { data, isLoading } = useQuery<{ steps: any[] }>({
    queryKey: [`/api/campaigns/${campaignId}/funnel`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/funnel`);
      if (!res.ok) throw new Error("Failed to load funnel");
      return res.json();
    },
  });

  // Fetch Stripe products
  const { data: stripeData } = useQuery<{ products: StripeProduct[] }>({
    queryKey: ["/api/settings/stripe-products"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings/stripe-products");
      if (!res.ok) return { products: [] };
      return res.json();
    },
    staleTime: 60000,
  });

  const stripeProducts = stripeData?.products ?? [];
  const hasStripe = stripeProducts.length > 0;

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

  const updateStep = (index: number, updates: Partial<FunnelStep>) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], ...updates };
    setSteps(updated);
    setHasChanges(true);
  };

  // Select a Stripe product — auto-fills name and price from actual transactions
  const selectProduct = (index: number, productId: string) => {
    const product = stripeProducts.find(p => p.id === productId);
    if (!product) return;
    updateStep(index, {
      name: product.name,
      price: String(product.price),
      stripeProductId: product.id,
    });
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
          {hasStripe
            ? "Select products from your Stripe account to build your funnel. Names and prices are pulled automatically."
            : "Define what's sold at each step of your funnel. Connect Stripe in Settings to auto-populate products."}
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
          <div className="space-y-1">
            {steps.map((step, i) => (
              <div key={i} data-testid={`funnel-step-${i}`}>
                {i > 0 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowDown className="w-3 h-3 text-muted-foreground/30" />
                  </div>
                )}
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card">
                  <div className="text-[10px] text-muted-foreground/50 font-bold w-4 text-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    {/* Step type */}
                    <Select
                      value={step.stepType}
                      onValueChange={(val) => updateStep(i, { stepType: val })}
                    >
                      <SelectTrigger className="h-8 text-[11px] w-[130px] shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STEP_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Product selector (Stripe searchable) or manual input */}
                    {hasStripe ? (
                      <ProductCombobox
                        products={stripeProducts}
                        value={step.name}
                        onSelect={(product) => {
                          if (product) {
                            selectProduct(i, product.id);
                          } else {
                            updateStep(i, { name: "", price: "", stripeProductId: undefined });
                          }
                        }}
                        onCustom={(name) => updateStep(i, { name, stripeProductId: undefined })}
                      />
                    ) : (
                      <Input
                        placeholder="Product name"
                        value={step.name}
                        onChange={(e) => updateStep(i, { name: e.target.value })}
                        className="h-8 text-xs flex-1 min-w-[120px]"
                        data-testid={`input-step-name-${i}`}
                      />
                    )}

                    {/* Price — auto-filled from Stripe or manual */}
                    <div className="relative shrink-0">
                      <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        placeholder="0.00"
                        value={step.price}
                        onChange={(e) => updateStep(i, { price: e.target.value.replace(/[^0-9.]/g, "") })}
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
            ))}

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

// === Searchable Product Combobox ===
function ProductCombobox({
  products,
  value,
  onSelect,
  onCustom,
}: {
  products: StripeProduct[];
  value: string;
  onSelect: (product: StripeProduct | null) => void;
  onCustom: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 text-xs flex-1 min-w-[180px] justify-between font-normal"
        >
          <span className="truncate">{value || "Select product..."}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search products..."
            value={search}
            onValueChange={setSearch}
            className="text-xs"
          />
          <CommandList>
            <CommandEmpty>
              <div className="p-2 text-center">
                <p className="text-xs text-muted-foreground">No products found.</p>
                {search && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 text-xs"
                    onClick={() => {
                      onCustom(search);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    Use "{search}" as custom name
                  </Button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-xs"
                >
                  <Check className={`mr-2 h-3 w-3 ${value === p.name ? "opacity-100" : "opacity-0"}`} />
                  <div className="flex-1 min-w-0">
                    <span className="truncate block">{p.name}</span>
                  </div>
                  <span className="text-muted-foreground ml-2 shrink-0">
                    ${p.price.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground/50 text-[10px] ml-1 shrink-0">
                    ({p.chargeCount})
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
