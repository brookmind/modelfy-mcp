import { ModelfyApi } from "../api/client";
import type { GrantProps } from "../auth/props";
import { AgentError } from "../mcp/errors";
import {
  BillingSchema,
  CastListSchema,
  ConfirmedUploadSchema,
  CreatedUploadSchema,
  MeSchema,
  SetListSchema,
  ShootOptionsSchema,
  UploadSessionSchema,
  UploadSessionStateSchema,
} from "./api-schemas";
import { safeImageFetch } from "./download";
import type {
  Account,
  AddedPhoto,
  Background,
  FileToUpload,
  Model,
  PhotoBackend,
  PhotoOptions,
  UploadSession,
  UploadSessionState,
} from "./types";

const READY_CAST = new Set(["READY", "PARTIAL"]);

/** A live key or an OAuth connection: the real Modelfy API with the user's token. */
export class ApiBackend implements PhotoBackend {
  readonly #api: ModelfyApi;
  readonly #props: GrantProps;

  constructor(env: Env, props: GrantProps, apiToken: string) {
    this.#api = new ModelfyApi(env, apiToken);
    this.#props = props;
  }

  async account(): Promise<Account> {
    const [me, billing] = await Promise.all([
      this.#api.get("/v2/connections/me", MeSchema),
      this.#api.get("/v2/billing", BillingSchema),
    ]);
    return {
      credits: me.credits,
      plan: billing.current?.name ?? null,
      creditsPerPhoto: billing.creditsPer.photo,
      keyKind: this.#props.kind,
      sandbox: false,
      budget: me.budget,
    };
  }

  async models(): Promise<Model[]> {
    const list = await this.#api.get("/v2/cast?limit=50", CastListSchema);
    return list.items.map((item) => ({
      id: item.id,
      name: item.name,
      source: item.source === "user" ? "own" : "modelfy",
      ready: READY_CAST.has(item.status),
      age: item.age,
      photoUrl: item.references[0]?.url ?? null,
    }));
  }

  async backgrounds(): Promise<Background[]> {
    const list = await this.#api.get("/v2/sets?limit=50", SetListSchema);
    return list.items.map((item) => ({
      id: item.id,
      name: item.name,
      source: item.source === "user" ? "own" : "gallery",
      description: item.description,
      ready: item.usable,
      photoUrl: item.plates[0]?.url ?? null,
    }));
  }

  async options(): Promise<PhotoOptions> {
    const options = await this.#api.get(
      "/v2/shoots/options?mode=PHOTO_SESSION",
      ShootOptionsSchema,
    );
    return {
      aspectRatios: options.aspectRatios,
      photosPerProduct: options.photosPerProduct,
      shotTypes: options.shotTypes,
      resolutions: options.resolutions,
      qualities: options.qualities,
      defaults: {
        resolution: options.defaults.resolution ?? null,
        quality: options.defaults.quality ?? null,
      },
      outfitStyles: options.outfitStyles,
      maxModels: options.castMax,
    };
  }

  async addPhotosFromUrls(urls: string[]): Promise<AddedPhoto[]> {
    const added: AddedPhoto[] = [];
    for (const url of urls) {
      try {
        added.push({ source_url: url, upload_id: await this.#upload(url) });
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
        added.push({ source_url: url, error: error.message });
      }
    }
    return added;
  }

  /** Download, create an upload, PUT the bytes to R2, confirm. */
  async #upload(url: string): Promise<string> {
    const image = await safeImageFetch(url);
    const created = await this.#api.post(
      "/v2/uploads",
      { contentType: image.contentType, bytes: image.bytes.byteLength },
      CreatedUploadSchema,
    );
    const put = await fetch(created.uploadUrl, {
      method: "PUT",
      headers: created.headers,
      body: image.bytes,
    });
    if (!put.ok) {
      throw new AgentError(
        "PHOTO_REJECTED",
        `${url}: the upload to Modelfy failed`,
        "Try again, or use create_upload_session.",
      );
    }
    const confirmed = await this.#api.post(
      `/v2/uploads/${encodeURIComponent(created.uploadId)}/confirm`,
      undefined,
      ConfirmedUploadSchema,
    );
    return confirmed.uploadId;
  }

  async createUploadSession(files: FileToUpload[]): Promise<UploadSession> {
    const session = await this.#api.post(
      "/v2/upload-sessions",
      undefined,
      UploadSessionSchema,
    );
    const uploads = [];
    for (const file of files) {
      const slot = await this.#api.post(
        `/v2/upload-sessions/${encodeURIComponent(session.id)}/uploads`,
        { contentType: file.content_type, bytes: file.bytes },
        CreatedUploadSchema,
      );
      uploads.push({
        upload_id: slot.uploadId,
        put_url: slot.uploadUrl,
        headers: slot.headers,
      });
    }
    return {
      session_id: session.id,
      page_url: session.pageUrl,
      expires_at: session.expiresAt,
      uploads,
    };
  }

  async readUploadSession(sessionId: string): Promise<UploadSessionState> {
    const state = await this.#api.get(
      `/v2/upload-sessions/${encodeURIComponent(sessionId)}`,
      UploadSessionStateSchema,
    );
    return {
      ready_upload_ids: state.confirmed.map((upload) => upload.uploadId),
      pending: state.pending,
      rejected: state.rejected.map((file) => ({
        upload_id: file.uploadId,
        reason: file.reason,
      })),
    };
  }
}
