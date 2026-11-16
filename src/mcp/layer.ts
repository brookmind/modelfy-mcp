import type { z } from "zod";
import type { AgentLayer } from "../auth/props";

export type ToolName =
  | "get_account"
  | "list_models"
  | "list_backgrounds"
  | "get_photo_options"
  | "add_product_photos"
  | "create_upload_session"
  | "get_uploaded_photos"
  | "plan_photos"
  | "generate_photos"
  | "get_photo_session"
  | "list_recent_photos"
  | "cancel_photo_session";

/** Adds a description to a schema, or leaves it bare. */
export type Describe = <T extends z.ZodType>(schema: T, text: string) => T;

/**
 * Everything the server tells an agent besides the data: tool descriptions,
 * schema descriptions, guidance sentences in results, error next steps and
 * the docs. "v0" is the text as shipped; "bare" strips it, so evals can
 * measure what that text is worth. Server-side rules never change with it.
 */
export interface LayerText {
  /** The tool's description: `v0` as written at the tool, or a bare one */
  tool(name: ToolName, v0: string): string;
  describe: Describe;
  /** A sentence that tells the agent what to do next, or nothing */
  guidance(text: string): string;
  /** Whether errors carry next_step and docs_url */
  errorGuidance: boolean;
  /** Whether instructions, get_docs and the docs resources are served */
  docs: boolean;
}

const BARE_TOOLS: Record<ToolName, string> = {
  get_account: "Account info.",
  list_models: "Lists models.",
  list_backgrounds: "Lists backgrounds.",
  get_photo_options: "Lists photo options.",
  add_product_photos: "Adds product photos from URLs.",
  create_upload_session: "Creates an upload session.",
  get_uploaded_photos: "Gets uploaded photos.",
  plan_photos: "Plans a photo session.",
  generate_photos: "Generates photos.",
  get_photo_session: "Gets a photo session.",
  list_recent_photos: "Lists recent photos.",
  cancel_photo_session: "Cancels a photo session.",
};

const V0: LayerText = {
  tool: (_name, v0) => v0,
  describe: (schema, text) => schema.describe(text),
  guidance: (text) => text,
  errorGuidance: true,
  docs: true,
};

const BARE: LayerText = {
  tool: (name) => BARE_TOOLS[name],
  describe: (schema) => schema,
  guidance: () => "",
  errorGuidance: false,
  docs: false,
};

export function layerText(layer: AgentLayer): LayerText {
  return layer === "bare" ? BARE : V0;
}
