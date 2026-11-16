import { ApiFailure, ModelfyApi } from "../api/client";
import type { GrantProps } from "../auth/props";
import { AgentError } from "../mcp/errors";
import {
  BillingSchema,
  CastListSchema,
  ConfirmedUploadSchema,
  CreatedUploadSchema,
  LibrarySchema,
  MeSchema,
  OkSchema,
  PreviewSchema,
  ShootDetailSchema,
  SetListSchema,
  ShootOptionsSchema,
  UploadSessionSchema,
  UploadSessionStateSchema,
} from "./api-schemas";
import { safeImageFetch } from "./download";
import { previewBody } from "./plan-body";
import { toSessionStatus } from "./session-status";
import type {
  Account,
  AddedPhoto,
  Background,
  FileToUpload,
  Model,
  PhotoBackend,
  PhotoOptions,
  Plan,
  PlanInput,
  RecentPhoto,
  SessionStatus,
  StoredPlan,
  UploadSession,
  UploadSessionState,
} from "./types";

const READY_CAST = new Set(["READY", "PARTIAL"]);
const UPLOADS_AT_ONCE = 3;

/** A live key or an OAuth connection: the real Modelfy API with the user's token. */
export class ApiBackend implements PhotoBackend {
  readonly #api: ModelfyApi;
  readonly #props: GrantProps;
  readonly #webUrl: string;

  constructor(env: Env, props: GrantProps, apiToken: string) {
    this.#api = new ModelfyApi(env, apiToken);
    this.#props = props;
    this.#webUrl = env.WEB_URL;
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
    // A few at a time: each photo (up to 15 MB) is held in memory until sent
    for (let at = 0; at < urls.length; at += UPLOADS_AT_ONCE) {
      const group = urls.slice(at, at + UPLOADS_AT_ONCE);
      added.push(...(await Promise.all(group.map((url) => this.#add(url)))));
    }
    return added;
  }

  async #add(url: string): Promise<AddedPhoto> {
    try {
      return { source_url: url, upload_id: await this.#upload(url) };
    } catch (error) {
      if (error instanceof AgentError) {
        return { source_url: url, error: error.message };
      }
      if (error instanceof ApiFailure && error.status === 400) {
        // Modelfy rejected this file; the other links still go through
        return { source_url: url, error: `${url}: ${error.message}` };
      }
      throw error;
    }
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
    const uploads = await Promise.all(
      files.map(async (file) => {
        const slot = await this.#api.post(
          `/v2/upload-sessions/${encodeURIComponent(session.id)}/uploads`,
          { contentType: file.content_type, bytes: file.bytes },
          CreatedUploadSchema,
        );
        return {
          upload_id: slot.uploadId,
          put_url: slot.uploadUrl,
          headers: slot.headers,
        };
      }),
    );
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

  async plan(input: PlanInput): Promise<Plan> {
    const body = previewBody(input);
    const preview = await this.#api.post(
      "/v2/shoots/preview",
      body,
      PreviewSchema,
    );
    const launchBody: Record<string, unknown> = {
      ...body,
      seed: preview.seed,
      creativePrompt: preview.creativePrompt,
      ...(preview.moodPhrase !== null
        ? { moodPhrase: preview.moodPhrase }
        : {}),
      ...(preview.direction !== null ? { direction: preview.direction } : {}),
    };
    return {
      stored: {
        launchBody,
        credits: preview.credits,
        photos: preview.summary.shots,
      },
      withModel: preview.summary.withModel,
      withoutModel: preview.summary.withoutModel,
      enoughCredits: preview.balanceOk,
      mood: preview.moodPhrase,
      promptRewritten: preview.moderation !== null,
    };
  }

  async launch(
    plan: StoredPlan,
    idempotencyKey: string,
  ): Promise<SessionStatus> {
    const detail = await this.#api.post(
      "/v2/shoots",
      { ...plan.launchBody, idempotencyKey },
      ShootDetailSchema,
    );
    return toSessionStatus(detail, this.#webUrl);
  }

  async session(sessionId: string): Promise<SessionStatus> {
    const detail = await this.#api.get(
      `/v2/shoots/${encodeURIComponent(sessionId)}`,
      ShootDetailSchema,
    );
    return toSessionStatus(detail, this.#webUrl);
  }

  async cancel(sessionId: string): Promise<SessionStatus> {
    await this.#api.post(
      `/v2/shoots/${encodeURIComponent(sessionId)}/cancel`,
      undefined,
      OkSchema,
    );
    return this.session(sessionId);
  }

  async recent(
    limit: number,
    sessionId: string | null,
  ): Promise<RecentPhoto[]> {
    const query = new URLSearchParams({ type: "image", limit: String(limit) });
    if (sessionId !== null) query.set("shootId", sessionId);
    const library = await this.#api.get(
      `/v2/library?${query.toString()}`,
      LibrarySchema,
    );
    return library.items.map((item) => ({
      photo_id: item.id,
      url: item.url,
      created_at: item.createdAt,
      session_id: item.shoot?.id ?? null,
      session_name: item.shoot?.name ?? null,
    }));
  }
}
