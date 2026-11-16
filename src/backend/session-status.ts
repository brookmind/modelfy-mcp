import type { z } from "zod";
import type { ShootDetailSchema } from "./api-schemas";
import type { SessionState, SessionStatus } from "./types";

const STATES: Record<
  z.infer<typeof ShootDetailSchema>["status"],
  SessionState
> = {
  RUNNING: "running",
  COMPLETED: "completed",
  PARTIAL: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/** The API's preview link; an API without previews sends none (or nothing useful). */
function previewOf(url: string | null | undefined): string | null {
  return url === undefined || url === "" ? null : url;
}

export function toSessionStatus(
  detail: z.infer<typeof ShootDetailSchema>,
  webUrl: string,
): SessionStatus {
  const names = new Map(detail.items.map((item) => [item.id, item.name]));
  const photos = detail.shots.flatMap((shot) =>
    shot.status === "SUCCEEDED" && shot.media !== null
      ? [
          {
            photo_id: shot.media.id,
            url: shot.media.url,
            preview_url: previewOf(shot.media.previewUrl),
            product: names.get(shot.itemId) ?? null,
          },
        ]
      : [],
  );
  const counts = detail.counts;
  return {
    session_id: detail.id,
    name: detail.name,
    status: STATES[detail.status],
    total:
      counts.queued +
      counts.running +
      counts.succeeded +
      counts.failed +
      counts.cancelled,
    done: counts.succeeded,
    failed: counts.failed,
    credits: detail.credits,
    photos,
    web_url: `${webUrl}/sessions/${encodeURIComponent(detail.id)}`,
  };
}
