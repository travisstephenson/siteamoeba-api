/**
 * SiteAmoeba Mutation Engine — Type Definitions
 * 
 * A mutation is a single DOM operation applied to the live page.
 * A mutation set (array of mutations) defines a complete page variant.
 * The widget applies mutations in order after page load.
 * 
 * Design principles:
 * - Every mutation is reversible (originals are captured before applying)
 * - Mutations are independent — if one fails, others still apply
 * - Style inheritance ensures injected elements match the page design
 * - Never break the page — validate after applying, revert if broken
 */

export type MutationType = 
  | "text_swap"         // Replace text content of an element
  | "html_replace"      // Replace full innerHTML of an element  
  | "visibility_toggle" // Show or hide an element
  | "section_reorder"   // Move a section above or below another
  | "style_override"    // Change CSS properties on an element
  | "html_inject"       // Insert new HTML before/after/inside an element
  | "attribute_set"     // Set an attribute (href, src, etc.)

export interface Mutation {
  id: string;                    // Unique ID for this mutation
  type: MutationType;
  
  // Target element — at least one must be provided
  selector?: string;             // CSS selector
  textFingerprint?: string;      // Text content to match (for fuzzy finding)
  category?: string;             // Section category (headline, cta, etc.)
  
  // Payload — varies by type
  text?: string;                 // For text_swap: new text content
  html?: string;                 // For html_replace / html_inject: new HTML
  styles?: Record<string, string>; // For style_override: CSS properties
  visible?: boolean;             // For visibility_toggle: true = show, false = hide
  position?: "before" | "after" | "prepend" | "append"; // For html_inject: where to insert
  targetSelector?: string;       // For section_reorder: move this element relative to target
  attribute?: string;            // For attribute_set: attribute name
  value?: string;                // For attribute_set: attribute value
  
  // Conditions — when should this mutation apply?
  deviceFilter?: "mobile" | "desktop" | "all";  // Only apply on specific devices
  sourceFilter?: string;         // Only apply for specific traffic source
  
  // Metadata
  description?: string;          // Human-readable description of what this does
  aiRationale?: string;          // Why the AI suggested this change
}

export interface MutationSet {
  id: string;
  name: string;
  description: string;
  mutations: Mutation[];
  
  // Targeting
  deviceFilter?: "mobile" | "desktop" | "all";
  sourceFilter?: string;
}
