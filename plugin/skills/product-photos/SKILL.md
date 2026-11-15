---
name: product-photos
description: Create product photos with Modelfy (a product on a model in a real place, or on a studio background) through the modelfy MCP tools. Use when the person asks for product photos, e-commerce or catalog images, lifestyle or on-model shots, or mentions Modelfy.
---

# Product photos with Modelfy

The `modelfy` MCP server does the work; this skill is how to use it well. When unsure about anything, call `get_docs` (topics: quickstart, connect, keys, photos, credits, errors).

## Before you start

- If the `modelfy` tools are missing, the server is not connected: tell the person to run `/mcp` and sign in to `modelfy`.
- Call `get_account` once: it tells you the balance, the price per photo and the kind of connection (`keyKind`). On a test key (`sandbox: true`) nothing is spent and photos are samples; say so.

## The workflow

1. **Product photos in.**
   - Links to the product's images: `add_product_photos` with the image file URLs (not product pages). A link that cannot be used comes back with an `error` instead of an `upload_id`: ask for another link, or upload the file.
   - Files on this computer: `create_upload_session` with each file's `content_type` and `bytes`, then upload every file yourself with `curl -X PUT "<put_url>" -H "<each returned header>" --data-binary @<file>`. Never read an image into the conversation or send it as base64.
   - Then `get_uploaded_photos` until nothing is pending. Use only the `upload_id`s it returns.
2. **Choices.** `get_photo_options` for formats and limits; `list_models` (only `ready: true`) and `list_backgrounds` when the person wants a model or a known place. Never invent an id.
3. **Ask what is missing.** `aspect_ratio` and `photos_per_product` are required: if the person did not say, ask in one short question with the options (for example "Vertical 4:5 or square 1:1? How many photos per product?"). Also ask where (a place in words is fine) unless they want a studio background.
4. **Plan.** `plan_photos`. Use the person's words in `direction` and their language in `locale`.
5. **Ask before spending.** Show the price: "4 photos for 80 credits (you have 880). Go ahead?" Only after a clear yes to that price, call `generate_photos` with the `quote_id` and `user_confirmed: true`. If they change anything, plan again and ask again.
6. **Wait and show.** `get_photo_session` with `wait_seconds: 45`, repeated while `status` is `running`. Then show the photos (links, and the images the tool returns) and the session's `web_url`.

## When something fails

Every error has a `code` and a `next_step`: follow the `next_step`. The usual ones:

- `CONFIRMATION_REQUIRED`: you skipped the person's yes. Ask, then retry with `user_confirmed: true`.
- `QUOTE_EXPIRED`: quotes last 30 minutes. Plan again; ask again if the price changed.
- `INSUFFICIENT_CREDITS` or `BUDGET_EXCEEDED`: tell the person and offer fewer photos.

Retrying `generate_photos` with the same `quote_id` never charges twice.

## Good defaults

- One product, one front photo; add a detail photo only when the person has one.
- Fashion and accessories: a model in a place. Small objects, cosmetics, packshots: `mode: "studio"` with a background color.
- Keep the person's creative words; do not add your own style unless they ask.
