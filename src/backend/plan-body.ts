import { AgentError } from "../mcp/errors";
import type { PlanInput } from "./types";

/**
 * The `/v2/shoots/preview` body for a plan. The model is always Modelfy
 * Recommended; keys the agent did not set are left out, so the API applies
 * its own defaults.
 */
export function previewBody(input: PlanInput): Record<string, unknown> {
  const studio = input.mode === "studio";
  if (
    !studio &&
    input.background_id === undefined &&
    (input.place_description === undefined ||
      input.place_description.trim() === "")
  ) {
    throw new AgentError(
      "MISSING_CHOICE",
      "A photo session needs a place.",
      "Ask the person where: pick a background_id from list_backgrounds, or write a place_description (or use mode: studio with a background_color).",
    );
  }
  const body: Record<string, unknown> = {
    mode: studio ? "STUDIO" : "PHOTO_SESSION",
  };
  if (studio) body.backgroundColor = input.background_color ?? "white";
  if (input.model_ids !== undefined && input.model_ids.length > 0) {
    body.castIds = input.model_ids;
  }
  if (!studio && input.background_id !== undefined)
    body.setId = input.background_id;
  if (
    !studio &&
    input.background_id === undefined &&
    input.place_description !== undefined
  ) {
    body.location = input.place_description;
  }
  body.products = input.products.map((product) => ({
    uploadIds: product.upload_ids,
    ...(product.name !== undefined ? { name: product.name } : {}),
    ...(product.description !== undefined
      ? { description: product.description }
      : {}),
  }));
  body.photosPerProduct = input.photos_per_product;
  body.aspectRatio = input.aspect_ratio;
  if (input.shot_types !== undefined && input.shot_types.length > 0) {
    body.shotTypes = input.shot_types;
  }
  if (input.outfit !== undefined) body.outfit = input.outfit;
  if (input.direction !== undefined) body.creativeDirection = input.direction;
  if (input.resolution !== undefined) body.resolution = input.resolution;
  if (input.quality !== undefined) body.quality = input.quality;
  body.model = { recommended: true };
  body.locale = input.locale;
  return body;
}
