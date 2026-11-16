import { AgentError } from "../mcp/errors";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
/** The photo types Modelfy takes (the API's upload rules). */
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home"];

export interface DownloadedImage {
  contentType: string;
  bytes: Uint8Array;
}

function rejected(url: string, reason: string): AgentError {
  return new AgentError(
    "PHOTO_REJECTED",
    `${url}: ${reason}`,
    "Use a public https link to the image file itself (jpg, png or webp), or create_upload_session.",
  );
}

/** Public http(s) hosts only: no IP literals, no local names. */
function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw rejected(raw, "not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw rejected(raw, "only http and https links work");
  }
  const host = url.hostname.toLowerCase();
  const ipLiteral =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[");
  if (
    ipLiteral ||
    host === "localhost" ||
    !host.includes(".") ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw rejected(raw, "the host is not a public web address");
  }
  return url;
}

async function readCapped(
  response: Response,
  url: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BYTES) throw rejected(url, "larger than 15 MB");
  if (response.body === null) throw rejected(url, "empty answer");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array))
      throw rejected(url, "unreadable answer");
    total += chunk.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw rejected(url, "larger than 15 MB");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface OpenedImage {
  contentType: string;
  response: Response;
}

/**
 * Follows a public link to an accepted image and stops at its headers: every
 * redirect hop is checked again. The body is still unread.
 */
async function openImage(
  raw: string,
  signal: AbortSignal,
): Promise<OpenedImage> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal });
    } catch {
      throw rejected(raw, "could not be downloaded");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (location === null) throw rejected(raw, "a redirect without a target");
      url = checkUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok)
      throw rejected(raw, `the server answered ${response.status}`);
    const contentType =
      (response.headers.get("Content-Type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      throw rejected(raw, "not an image");
    }
    if (!ACCEPTED_TYPES.has(contentType)) {
      throw rejected(raw, "not a jpg, png, webp or heic image");
    }
    return { contentType, response };
  }
  throw rejected(raw, "too many redirects");
}

/**
 * Downloads a product photo from a public link, safely: images only, at most
 * 15 MB, 20 s in all.
 */
export async function safeImageFetch(raw: string): Promise<DownloadedImage> {
  const { contentType, response } = await openImage(
    raw,
    AbortSignal.timeout(TIMEOUT_MS),
  );
  return { contentType, bytes: await readCapped(response, raw) };
}

/**
 * The same checks as `safeImageFetch` without downloading the photo: the
 * sandbox keeps no bytes, so it reads the headers and drops the body.
 */
export async function checkImageLink(raw: string): Promise<void> {
  const { response } = await openImage(raw, AbortSignal.timeout(TIMEOUT_MS));
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  await response.body?.cancel();
  if (declared > MAX_BYTES) throw rejected(raw, "larger than 15 MB");
}
