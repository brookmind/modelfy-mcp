---
title: Create photos
description: The workflow step by step - product photos in, choices, plan, launch, wait, show - with the rules agents must follow.
order: 4
---

# Create photos

```
product photos in  →  choices  →  plan_photos  →  generate_photos  →  get_photo_session
     (free)            (free)       (free, price)     (spends)            (free)
```

## 1. Product photos in

Every session starts from photos of the product: the front first, and optionally one detail. Each tool returns `upload_id`s for `plan_photos`.

**From links** (the store's product images, a CDN): `add_product_photos` with up to 10 `image_urls`. Each link must be the image file itself, not a web page. JPEG, PNG, WebP or HEIC, up to 15 MB. Each link succeeds or fails on its own:

```json
{
  "photos": [
    { "source_url": "https://shop.example.com/dress.jpg", "upload_id": "…" },
    { "source_url": "https://shop.example.com/page", "error": "Not an image" }
  ]
}
```

**From files**, with `create_upload_session` (up to 10 files, valid one hour):

- _An agent with code_ (Claude Code, Codex, a bot) announces each file and sends the bytes itself to the presigned URL. Never pass image bytes through the model as base64.

  ```json
  { "files": [{ "content_type": "image/jpeg", "bytes": 482113 }] }
  ```

  ```sh
  curl -X PUT "<put_url>" -H "Content-Type: image/jpeg" --data-binary @dress.jpg
  ```

  Send exactly the `headers` the tool returned for that upload.

- _A chat assistant_ (claude.ai, ChatGPT) calls it with no files and gives the person `page_url`: a Modelfy page where they drop the photos from their computer or phone.

Then `get_uploaded_photos` with the `session_id`: ready `upload_id`s, files still pending, and rejected files with the reason. Call it again while `pending` is above zero.

## 2. Choices

| Tool                | Gives                                                                                                                      | Used in `plan_photos` as                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `list_models`       | People who wear or hold the product (the account's own and Modelfy's). Only `ready: true` can be used.                     | `model_ids` (up to 3; leave empty for product-only photos)                            |
| `list_backgrounds`  | Real places (the account's own and Modelfy's gallery)                                                                      | `background_id`, or describe a place in `place_description`                           |
| `get_photo_options` | Aspect ratios, photos per product (min, max), shot types, resolutions and qualities (they change the price), outfit styles | `aspect_ratio`, `photos_per_product`, `shot_types`, `resolution`, `quality`, `outfit` |

Never invent an id. Use only ids these tools returned in this conversation.

## 3. Plan

`plan_photos` checks everything and returns the exact price. Nothing is spent.

```json
{
  "products": [
    {
      "upload_ids": ["<front upload_id>", "<detail upload_id>"],
      "name": "Linen dress"
    }
  ],
  "mode": "place",
  "model_ids": ["<model id>"],
  "place_description": "a sunny café terrace in the morning",
  "aspect_ratio": "4:5",
  "photos_per_product": 4,
  "direction": "relaxed, natural light",
  "locale": "en"
}
```

- `mode`: `place` (a real place: `background_id` or `place_description`) or `studio` (a plain background; `background_color` in words, like "light grey").
- `aspect_ratio` and `photos_per_product` are always required. If the person did not say, ask; do not pick for them.
- `direction`: the person's own words about the look.
- `locale`: the person's language.

The answer has `quote_id` (valid 30 minutes), `credits`, `photos`, `enough_credits`, `balance`, and for live keys `budget`.

## 4. Launch

`generate_photos` with the `quote_id`. In a chat, first show the person the credits and ask; only after their yes call it with `user_confirmed: true`. See [Credits and consent](credits.md).

Calling it again with the same `quote_id` returns the same session; it never charges twice.

## 5. Wait and show

`get_photo_session` with `session_id` and `wait_seconds` (up to 45) waits until the session finishes. If it is still `running`, call it again. When done, it returns every photo's link (`url`, full size) and a `preview_url` (a small JPEG, when Modelfy has one), and up to four of them as images the chat can show (the preview, or the photo itself when it is under 1 MB).

| Status      | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| `running`   | Photos are being made                                               |
| `completed` | All photos are ready                                                |
| `partial`   | Some photos failed; their credits were refunded                     |
| `failed`    | No photo could be made; everything was refunded                     |
| `cancelled` | Stopped with `cancel_photo_session`; unstarted photos were refunded |

Show the photos, or the session's `web_url` where the person can see and download them all.

## Later

- `list_recent_photos`: the latest photos of the account, or of one session.
- `cancel_photo_session`: stops a running session. Finished photos stay.
