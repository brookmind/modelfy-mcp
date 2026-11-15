import type { GrantProps } from "../auth/props";
import { DOC_SLUGS } from "../docs";
import { spendingRule } from "./spending";

const WORKFLOW = `Modelfy creates product photos: a product on a model in a real place, or on a plain studio background.

Workflow:
1. Get the product photos in: add_product_photos (public image URLs), or create_upload_session (upload from code, or a page a person opens to drop photos). Use the upload ids it returns.
2. Look at the choices: list_models (people who wear or hold the product), list_backgrounds (places), get_photo_options (formats, photos per product, shot types).
3. plan_photos: always set aspect_ratio and photos_per_product (ask the person if they did not say). It returns the exact credits and a quote_id. Nothing is spent.
4. generate_photos with the quote_id.
5. get_photo_session with wait_seconds until it is done, then show the photos.

Rules: never invent model, background or upload ids; use the ids the tools return. Send image bytes from code, never as base64 through the model. Reply in the person's language.

Docs: get_docs has the full guide (topics: ${DOC_SLUGS.join(", ")}). After an error, follow its next_step; get_docs with topic "errors" explains every code.`;

const PERSON =
  "Spending: a person is in this conversation. Before generate_photos, show them the credits from plan_photos and ask. Call generate_photos with user_confirmed: true only after they say yes to that exact price.";
const BUDGET =
  "Spending: this API key has a credit budget per photo session and per day; Modelfy refuses a launch that would go over it (BUDGET_EXCEEDED). If a person is in the conversation, still show the price from plan_photos and ask before generate_photos.";
const SANDBOX: Record<"test" | "anonymous", string> = {
  test: "Sandbox: this is a test key. Nothing is spent and the photos are samples marked SANDBOX. Use it to build and try an integration, then switch to a live key.",
  anonymous:
    "Sandbox: this is an anonymous test key. Nothing is spent and the photos are samples marked SANDBOX. To create real photos, get a live key with device login (POST /device/code).",
};
const SANDBOX_NOTE =
  "Sandbox: this is a test key; nothing is really spent and the photos are samples marked SANDBOX, but the spending rule above applies as it would with real credits.";

function consent(props: GrantProps): string {
  const rule = spendingRule(props);
  const sandbox = props.kind === "test" || props.kind === "anonymous";
  if (rule === "person")
    return sandbox ? `${PERSON}\n\n${SANDBOX_NOTE}` : PERSON;
  if (rule === "budget")
    return sandbox ? `${BUDGET}\n\n${SANDBOX_NOTE}` : BUDGET;
  return props.kind === "test" ? SANDBOX.test : SANDBOX.anonymous;
}

export function instructionsFor(props: GrantProps): string {
  return `${WORKFLOW}\n\n${consent(props)}`;
}
