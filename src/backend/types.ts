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
export interface PhotoBackend {
  account(): Promise<Account>;
  models(): Promise<Model[]>;
  backgrounds(): Promise<Background[]>;
  options(): Promise<PhotoOptions>;
  addPhotosFromUrls(urls: string[]): Promise<AddedPhoto[]>;
  createUploadSession(files: FileToUpload[]): Promise<UploadSession>;
  readUploadSession(sessionId: string): Promise<UploadSessionState>;
  plan(input: PlanInput): Promise<Plan>;
  launch(plan: StoredPlan, idempotencyKey: string): Promise<SessionStatus>;
  session(sessionId: string): Promise<SessionStatus>;
  cancel(sessionId: string): Promise<SessionStatus>;
  recent(limit: number, sessionId: string | null): Promise<RecentPhoto[]>;
}

/** The most product photos one call or one upload session takes. */
export const MAX_UPLOAD_FILES = 10;

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
    name?: string;
    description?: string;
  }>;
  mode: "place" | "studio";
  background_color?: string;
  model_ids?: string[];
  background_id?: string;
  place_description?: string;
  aspect_ratio: string;
  photos_per_product: number;
  shot_types?: Array<(typeof SHOT_TYPES)[number]>;
  outfit?: { style?: string; note?: string };
  direction?: string;
  resolution?: string;
  quality?: string;
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

export const SESSION_STATES = [
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export interface SessionPhoto {
  photo_id: string;
  url: string;
  /** A small JPEG of the photo, light enough to show in a chat */
  preview_url: string | null;
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
