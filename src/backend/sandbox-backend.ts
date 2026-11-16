import { z } from "zod";
import type { GrantProps } from "../auth/props";
import { randomBase64Url } from "../crypto";
import { AgentError } from "../mcp/errors";
import { ApiBackend } from "./api-backend";
import { safeImageFetch } from "./download";
import { previewBody } from "./plan-body";
import {
  demoImage,
  SANDBOX_BACKGROUNDS,
  SANDBOX_MODELS,
  SANDBOX_OPTIONS,
  samplePhotoUrl,
} from "./sandbox-fixtures";
import type {
  Account,
  AddedPhoto,
  Background,
  Budget,
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

export const SANDBOX_CREDITS = 10_000;
export const SANDBOX_PRICE_PER_PHOTO = 20;
/** A sandbox session finishes this long after its launch. */
export const SANDBOX_SESSION_MS = 4000;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const UPLOAD_TTL_SECONDS = 60 * 60;
export const MAX_SANDBOX_FILES = 10;

const UploadStateSchema = z.object({
  owner: z.string(),
  files: z.record(z.string(), z.enum(["pending", "ready"])),
  expiresAt: z.string(),
});
export type SandboxUploadState = z.infer<typeof UploadStateSchema>;

const SessionSchema = z.object({
  owner: z.string(),
  name: z.string(),
  photos: z.number(),
  credits: z.number(),
  product: z.string().nullable(),
  fail: z.boolean(),
  createdAt: z.number(),
  cancelledAt: z.number().nullable(),
});
type SandboxSession = z.infer<typeof SessionSchema>;

export function uploadKey(id: string): string {
  return `sbx-upload:${id}`;
}

function sessionKey(id: string): string {
  return `sbx-session:${id}`;
}

function sessionsOfKey(owner: string): string {
  return `sbx-sessions:${owner}`;
}

const SPENT_TTL_SECONDS = 2 * 24 * 60 * 60;

function nextUtcMidnight(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/** Credits a bot key launched today (UTC), like a live key's daily spend. */
function spentKey(owner: string, now: Date = new Date()): string {
  return `sbx-spent:${owner}:${now.toISOString().slice(0, 10)}`;
}

export async function readUploadState(
  kv: KVNamespace,
  id: string,
): Promise<SandboxUploadState | null> {
  const parsed = UploadStateSchema.safeParse(
    await kv.get(uploadKey(id), "json"),
  );
  return parsed.success ? parsed.data : null;
}

export async function writeUploadState(
  kv: KVNamespace,
  id: string,
  state: SandboxUploadState,
): Promise<void> {
  await kv.put(uploadKey(id), JSON.stringify(state), {
    expirationTtl: UPLOAD_TTL_SECONDS,
  });
}

/**
 * Test keys (design §7): the real catalog, everything else canned. Nothing
 * reaches a paid route, no credit is spent, no provider is called.
 */
export class SandboxBackend implements PhotoBackend {
  readonly #env: Env;
  readonly #props: GrantProps;
  readonly #owner: string;
  readonly #catalog: ApiBackend | null;
  readonly #anonymous: boolean;

  constructor(env: Env, props: GrantProps, owner: string) {
    this.#env = env;
    this.#props = props;
    this.#owner = owner;
    this.#anonymous = props.kind === "anonymous";
    const catalogToken = this.#anonymous
      ? env.SANDBOX_ACCOUNT_KEY
      : props.apiToken;
    this.#catalog =
      // SANDBOX_ACCOUNT_KEY may be unset: the sandbox then uses its fixtures
      typeof catalogToken === "string" && catalogToken !== ""
        ? new ApiBackend(env, props, catalogToken)
        : null;
  }

  async account(): Promise<Account> {
    return {
      credits: SANDBOX_CREDITS,
      plan: "Sandbox",
      creditsPerPhoto: SANDBOX_PRICE_PER_PHOTO,
      keyKind: this.#props.kind,
      sandbox: true,
      budget: await this.#budget(),
    };
  }

  /** A bot key's budget, like a live key's: per session and per UTC day. */
  async #budget(): Promise<Budget | null> {
    const limits = this.#props.budget;
    if (limits === null) return null;
    return {
      ...limits,
      spentToday: await this.#spentToday(),
      resetsAt: nextUtcMidnight().toISOString(),
    };
  }

  async #spentToday(): Promise<number> {
    const value = await this.#env.OAUTH_KV.get(spentKey(this.#owner));
    const spent = Number(value ?? "0");
    return Number.isFinite(spent) ? spent : 0;
  }

  /**
   * Refuses a launch over the budget, as the Modelfy API does for live keys.
   * Approximate: KV has no atomic increment, so launches fired at the same
   * moment can each pass the daily check (the API reserves atomically).
   */
  async #spend(credits: number): Promise<void> {
    const budget = await this.#budget();
    if (budget === null) return;
    const details = (limit: "session" | "day"): Record<string, unknown> => ({
      budget: { limit, requested: credits, ...budget },
    });
    const nextStep =
      "Make fewer photos, wait until the daily budget resets, or ask the key's owner to raise its budget.";
    if (credits > budget.maxCreditsPerSession) {
      throw new AgentError(
        "BUDGET_EXCEEDED",
        `This launch needs ${credits} credits; this key allows ${budget.maxCreditsPerSession} per photo session.`,
        nextStep,
        details("session"),
      );
    }
    const left = budget.maxCreditsPerDay - budget.spentToday;
    if (credits > left) {
      throw new AgentError(
        "BUDGET_EXCEEDED",
        `This launch needs ${credits} credits; this key has ${Math.max(0, left)} left today.`,
        nextStep,
        details("day"),
      );
    }
    await this.#env.OAUTH_KV.put(
      spentKey(this.#owner),
      String(budget.spentToday + credits),
      { expirationTtl: SPENT_TTL_SECONDS },
    );
  }

  async models(): Promise<Model[]> {
    const models = await this.#read(
      () => this.#catalog?.models(),
      SANDBOX_MODELS,
    );
    return this.#anonymous
      ? models.filter((model) => model.source !== "own")
      : models;
  }

  async backgrounds(): Promise<Background[]> {
    const backgrounds = await this.#read(
      () => this.#catalog?.backgrounds(),
      SANDBOX_BACKGROUNDS,
    );
    return this.#anonymous
      ? backgrounds.filter((background) => background.source !== "own")
      : backgrounds;
  }

  options(): Promise<PhotoOptions> {
    return this.#read(() => this.#catalog?.options(), SANDBOX_OPTIONS);
  }

  /** The real catalog when it can be read; the fixtures otherwise. */
  async #read<T>(load: () => Promise<T> | undefined, fallback: T): Promise<T> {
    try {
      return (await load()) ?? fallback;
    } catch {
      return fallback;
    }
  }

  async addPhotosFromUrls(urls: string[]): Promise<AddedPhoto[]> {
    const added: AddedPhoto[] = [];
    const demo = `${this.#env.PUBLIC_URL}/sandbox/demo/`;
    for (const url of urls) {
      // A Worker may not fetch its own domain: the demo is resolved here
      if (url.startsWith(demo)) {
        added.push(
          demoImage(url.slice(demo.length)) === null
            ? { source_url: url, error: `${url}: not an image` }
            : { source_url: url, upload_id: `sbx_${randomBase64Url(12)}` },
        );
        continue;
      }
      try {
        await safeImageFetch(url);
        added.push({
          source_url: url,
          upload_id: `sbx_${randomBase64Url(12)}`,
        });
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
        added.push({ source_url: url, error: error.message });
      }
    }
    return added;
  }

  async createUploadSession(files: FileToUpload[]): Promise<UploadSession> {
    const id = randomBase64Url(16);
    const state: SandboxUploadState = {
      owner: this.#owner,
      files: {},
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
    const uploads = files.slice(0, MAX_SANDBOX_FILES).map((file) => {
      const uploadId = `sbx_${randomBase64Url(12)}`;
      state.files[uploadId] = "pending";
      return {
        upload_id: uploadId,
        put_url: `${this.#env.PUBLIC_URL}/sandbox/put/${id}/${uploadId}`,
        headers: { "Content-Type": file.content_type },
      };
    });
    await writeUploadState(this.#env.OAUTH_KV, id, state);
    return {
      session_id: id,
      page_url: `${this.#env.PUBLIC_URL}/sandbox/upload/${id}`,
      expires_at: state.expiresAt,
      uploads,
    };
  }

  async readUploadSession(sessionId: string): Promise<UploadSessionState> {
    const state = await readUploadState(this.#env.OAUTH_KV, sessionId);
    if (state === null || state.owner !== this.#owner) {
      throw new AgentError(
        "NOT_FOUND",
        "This upload session is unknown or expired.",
        "Call create_upload_session again.",
      );
    }
    const entries = Object.entries(state.files);
    return {
      ready_upload_ids: entries
        .filter(([, s]) => s === "ready")
        .map(([id]) => id),
      pending: entries.filter(([, s]) => s === "pending").length,
      rejected: [],
    };
  }

  plan(input: PlanInput): Promise<Plan> {
    const body = previewBody(input);
    const names = input.products.map((product) => product.name ?? "");
    if (names.includes("sandbox:insufficient_credits")) {
      throw new AgentError(
        "INSUFFICIENT_CREDITS",
        "The account does not have enough credits for this (sandbox trigger).",
        "Tell the person; they can buy credits or change plan at the Modelfy web (/plans).",
      );
    }
    if (names.includes("sandbox:budget_exceeded")) {
      throw new AgentError(
        "BUDGET_EXCEEDED",
        "This launch needs more credits than this key's budget allows (sandbox trigger).",
        "Make fewer photos, wait until the daily budget resets, or ask the key's owner to raise its budget.",
        {
          budget: {
            limit: "day",
            requested: 80,
            maxCreditsPerSession: 100,
            maxCreditsPerDay: 100,
            spentToday: 60,
            resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        },
      );
    }
    for (const product of input.products) {
      if (product.upload_ids.some((id) => !id.startsWith("sbx_"))) {
        throw new AgentError(
          "INVALID_INPUT",
          "In the sandbox, use the upload ids the sandbox returned (they start with sbx_).",
          "Add the photos again with add_product_photos or create_upload_session using this key.",
        );
      }
    }
    const photos = input.products.length * input.photos_per_product;
    const withModel = (input.model_ids?.length ?? 0) > 0 ? photos : 0;
    const stored: StoredPlan = {
      launchBody: {
        ...body,
        sandboxName: input.products[0]?.name ?? "Sandbox session",
        sandboxFail: names.includes("sandbox:fail"),
      },
      credits: photos * SANDBOX_PRICE_PER_PHOTO,
      photos,
    };
    return Promise.resolve({
      stored,
      withModel,
      withoutModel: photos - withModel,
      enoughCredits: stored.credits <= SANDBOX_CREDITS,
      mood: "Sandbox sample",
      promptRewritten: false,
    });
  }

  async launch(plan: StoredPlan): Promise<SessionStatus> {
    await this.#spend(plan.credits);
    const id = `sbx_${randomBase64Url(12)}`;
    const name = plan.launchBody.sandboxName;
    const session: SandboxSession = {
      owner: this.#owner,
      name: typeof name === "string" ? name : "Sandbox session",
      photos: plan.photos,
      credits: plan.credits,
      product: typeof name === "string" ? name : null,
      fail: plan.launchBody.sandboxFail === true,
      createdAt: Date.now(),
      cancelledAt: null,
    };
    const kv = this.#env.OAUTH_KV;
    await kv.put(sessionKey(id), JSON.stringify(session), {
      expirationTtl: TTL_SECONDS,
    });
    const list = z
      .array(z.string())
      .safeParse(await kv.get(sessionsOfKey(this.#owner), "json"));
    const ids = [id, ...(list.success ? list.data : [])].slice(0, 10);
    await kv.put(sessionsOfKey(this.#owner), JSON.stringify(ids), {
      expirationTtl: TTL_SECONDS,
    });
    return this.#status(id, session);
  }

  async session(sessionId: string): Promise<SessionStatus> {
    return this.#status(sessionId, await this.#load(sessionId));
  }

  async cancel(sessionId: string): Promise<SessionStatus> {
    const session = await this.#load(sessionId);
    // A second cancel keeps the first time, so a cancelled session stays cancelled
    const cancelled: SandboxSession = {
      ...session,
      cancelledAt: session.cancelledAt ?? Date.now(),
    };
    await this.#env.OAUTH_KV.put(
      sessionKey(sessionId),
      JSON.stringify(cancelled),
      {
        expirationTtl: TTL_SECONDS,
      },
    );
    return this.#status(sessionId, cancelled);
  }

  async recent(
    limit: number,
    sessionId: string | null,
  ): Promise<RecentPhoto[]> {
    const list = z
      .array(z.string())
      .safeParse(
        await this.#env.OAUTH_KV.get(sessionsOfKey(this.#owner), "json"),
      );
    const ids =
      sessionId !== null ? [sessionId] : list.success ? list.data : [];
    const photos: RecentPhoto[] = [];
    for (const id of ids) {
      const status = await this.session(id).catch(() => null);
      for (const photo of status?.photos ?? []) {
        photos.push({
          photo_id: photo.photo_id,
          url: photo.url,
          created_at: new Date().toISOString(),
          session_id: id,
          session_name: status?.name ?? null,
        });
      }
    }
    return photos.slice(0, limit);
  }

  async #load(sessionId: string): Promise<SandboxSession> {
    const parsed = SessionSchema.safeParse(
      await this.#env.OAUTH_KV.get(sessionKey(sessionId), "json"),
    );
    if (!parsed.success || parsed.data.owner !== this.#owner) {
      throw new AgentError(
        "NOT_FOUND",
        "This sandbox session is unknown.",
        "Check the session_id returned by generate_photos.",
      );
    }
    return parsed.data;
  }

  /** Progress follows the clock: done after SANDBOX_SESSION_MS. */
  #status(id: string, session: SandboxSession): SessionStatus {
    const end = session.cancelledAt ?? Date.now();
    const progress = Math.min(
      1,
      (end - session.createdAt) / SANDBOX_SESSION_MS,
    );
    const finished = progress >= 1;
    const done = session.fail ? 0 : Math.floor(session.photos * progress);
    const failed = session.fail && finished ? session.photos : 0;
    const status: SessionStatus["status"] =
      session.cancelledAt !== null && !finished
        ? "cancelled"
        : !finished
          ? "running"
          : session.fail
            ? "failed"
            : "completed";
    const cancelled = status === "cancelled" ? session.photos - done : 0;
    const perPhoto = session.photos > 0 ? session.credits / session.photos : 0;
    return {
      session_id: id,
      name: session.name,
      status,
      total: session.photos,
      done,
      failed,
      credits: {
        reserved: session.credits,
        charged: done * perPhoto,
        refunded: (failed + cancelled) * perPhoto,
      },
      photos: Array.from({ length: done }, (_, index) => ({
        photo_id: `${id}_${index}`,
        url: samplePhotoUrl(this.#env.PUBLIC_URL, index),
        product: session.product,
      })),
      web_url: `${this.#env.PUBLIC_URL}/sandbox/sessions/${id}`,
    };
  }
}
