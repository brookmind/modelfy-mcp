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
export interface PhotoBackend extends PhotoInput {
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
