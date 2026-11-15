import type { TokenKind } from "../auth/props";

/** What the tools see. Agent-facing names; no API internals or model names. */

export interface Budget {
  maxCreditsPerSession: number;
  maxCreditsPerDay: number;
  spentToday: number;
  resetsAt: string;
}

export interface Account {
  credits: number;
  plan: string | null;
  creditsPerPhoto: number | null;
  keyKind: TokenKind;
  sandbox: boolean;
  budget: Budget | null;
}

export interface Model {
  id: string;
  name: string;
  /** "own": made by this account; "modelfy": Modelfy's ready-made models */
  source: "own" | "modelfy";
  ready: boolean;
  age: number | null;
  photoUrl: string | null;
}

export interface Background {
  id: string;
  name: string;
  source: "own" | "gallery";
  description: string | null;
  ready: boolean;
  photoUrl: string | null;
}

export interface PhotoOptions {
  aspectRatios: string[];
  photosPerProduct: { min: number; max: number; default: number };
  shotTypes: { withModel: string[]; withoutModel: string[] };
  resolutions: string[] | null;
  qualities: string[] | null;
  defaults: { resolution: string | null; quality: string | null };
  outfitStyles: string[];
  maxModels: number;
}

/** The backend of one connection: the Modelfy API, or the sandbox. */
export interface PhotoBackend extends PhotoInput, PhotoSessions {
  account(): Promise<Account>;
  models(): Promise<Model[]>;
  backgrounds(): Promise<Background[]>;
  options(): Promise<PhotoOptions>;
}

export type AddedPhoto =
  | { source_url: string; upload_id: string }
  | { source_url: string; error: string };

export interface FileToUpload {
  content_type: string;
  bytes: number;
}

export interface UploadSlot {
  upload_id: string;
  put_url: string;
  headers: Record<string, string>;
}

export interface UploadSession {
  session_id: string;
  page_url: string;
  expires_at: string;
  uploads: UploadSlot[];
}

export interface UploadSessionState {
  ready_upload_ids: string[];
  pending: number;
  rejected: Array<{ upload_id: string; reason: string }>;
}

export interface PhotoInput {
  addPhotosFromUrls(urls: string[]): Promise<AddedPhoto[]>;
  createUploadSession(files: FileToUpload[]): Promise<UploadSession>;
  readUploadSession(sessionId: string): Promise<UploadSessionState>;
}

export const SHOT_TYPES = [
  "close-up",
  "medium-shot",
  "full-body",
  "wide-shot",
  "detail",
  "flat-lay",
  "still-life",
  "hanger",
  "ghost-mannequin",
] as const;

export interface PlanInput {
  products: Array<{
    upload_ids: string[];
    name?: string | undefined;
    description?: string | undefined;
  }>;
  mode: "place" | "studio";
  background_color?: string | undefined;
  model_ids?: string[] | undefined;
  background_id?: string | undefined;
  place_description?: string | undefined;
  aspect_ratio: string;
  photos_per_product: number;
  shot_types?: Array<(typeof SHOT_TYPES)[number]> | undefined;
  outfit?:
    { style?: string | undefined; note?: string | undefined } | undefined;
  direction?: string | undefined;
  resolution?: string | undefined;
  quality?: string | undefined;
  locale: string;
}

/** What a quote keeps: everything needed to launch exactly the previewed session. */
export interface StoredPlan {
  launchBody: Record<string, unknown>;
  credits: number;
  photos: number;
}

export interface Plan {
  stored: StoredPlan;
  withModel: number;
  withoutModel: number;
  enoughCredits: boolean;
  mood: string | null;
  promptRewritten: boolean;
}

export type SessionState =
  "running" | "completed" | "partial" | "failed" | "cancelled";

export interface SessionPhoto {
  photo_id: string;
  url: string;
  product: string | null;
}

export interface SessionStatus {
  session_id: string;
  name: string;
  status: SessionState;
  total: number;
  done: number;
  failed: number;
  credits: { reserved: number; charged: number; refunded: number };
  photos: SessionPhoto[];
  web_url: string;
}

export interface RecentPhoto {
  photo_id: string;
  url: string;
  created_at: string;
  session_id: string | null;
  session_name: string | null;
}

export interface PhotoSessions {
  plan(input: PlanInput): Promise<Plan>;
  launch(plan: StoredPlan, idempotencyKey: string): Promise<SessionStatus>;
  session(sessionId: string): Promise<SessionStatus>;
  cancel(sessionId: string): Promise<SessionStatus>;
  recent(limit: number, sessionId: string | null): Promise<RecentPhoto[]>;
}
