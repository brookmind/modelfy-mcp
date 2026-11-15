---
title: Errors
description: Every error code the tools return, what it means and the next step; plus the HTTP errors of the endpoint itself.
order: 6
---

# Errors

A tool that fails returns `isError: true` with one sentence for the model and this JSON:

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "This launch would go over the key's daily budget.",
    "next_step": "Make fewer photos, wait until the daily budget resets, or ask the key's owner to raise its budget.",
    "docs_url": "https://mcp.modelfy.ai/docs/errors#BUDGET_EXCEEDED"
  }
}
```

`code` is stable: branch on it, not on the message. Follow `next_step`.

## Tool errors

### CONFIRMATION_REQUIRED

An OAuth connection called `generate_photos` without `user_confirmed: true`. Nothing was spent. Show the person the price from `plan_photos` and call again with `user_confirmed: true` only if they agree.

### INSUFFICIENT_CREDITS

The account does not have enough credits. Tell the person; they can buy credits or change plan at https://beta.modelfy.ai/plans. Or plan fewer photos.

### BUDGET_EXCEEDED

The launch would go over the live key's budget per session or per day. Nothing was spent. The error includes `budget`. Plan fewer photos, wait until the daily budget resets (`budget.resetsAt` in `get_account`), or ask the key's owner to raise its budget in the Modelfy web. See [Credits and consent](credits.md).

### QUOTE_EXPIRED

The `quote_id` does not exist or is older than 30 minutes. Call `plan_photos` again and use the new `quote_id`. If the price changed, ask the person again.

### QUOTE_NOT_YOURS

The quote was made by another connection. Call `plan_photos` with this connection.

### MISSING_CHOICE

`plan_photos` lacks a choice the session needs: for example `mode: "place"` with neither `background_id` nor `place_description`. The message names it. Ask the person, or use the catalog tools, then plan again.

### INVALID_INPUT

An input was refused (an unknown id, a format not in `get_photo_options`, a model that is not ready). Fix it as the message says and call again. Never guess ids: list them again.

### NOT_FOUND

The id does not exist for this account (a session, an upload). List the items again to get a valid one.

### PHOTO_REJECTED

A product photo could not be used: the link is not public, it is not an image file (JPEG, PNG, WebP, HEIC), it is over 15 MB, or the upload to Modelfy failed. `add_product_photos` reports this per link. Use a public https link to the image file itself, or upload the file with `create_upload_session`.

### CONNECTION_REVOKED

The connection was revoked or expired: the person disconnected the assistant or revoked the key. For OAuth, the client signs in again on the next request. For an API key, ask the person for a new one or use [device login](keys.md#device-login).

### RATE_LIMITED

Too many requests. Wait a minute and try again.

### MODELFY_ERROR

Modelfy could not complete the request. Try again in a moment; if it keeps failing, tell the person. Retrying `generate_photos` with the same `quote_id` is always safe.

## HTTP errors of the endpoint

| Status | Body                         | Meaning                                                                                                      |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `401`  | `{"error": "invalid_token"}` | Missing, wrong, expired or revoked token. OAuth clients refresh or sign in again; with an API key, check it. |
| `429`  | `{"error": "rate_limited"}`  | An anonymous sandbox key made 300 calls in the last hour. Wait, or get your own key with device login.       |
