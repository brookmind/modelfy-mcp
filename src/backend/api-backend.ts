import { ModelfyApi } from "../api/client";
import type { GrantProps } from "../auth/props";
import {
  BillingSchema,
  CastListSchema,
  MeSchema,
  SetListSchema,
  ShootOptionsSchema,
} from "./api-schemas";
import type {
  Account,
  Background,
  Model,
  PhotoBackend,
  PhotoOptions,
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
}
