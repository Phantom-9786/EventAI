# Category covers

In **Admin → Overview → Event categories**, creating a category requires a cover image in the UI. Existing categories expose **Preview cover**, **Change cover**, and **Deactivate**. Replacement is saved only after selecting **Save cover**. Preview uses the same wording and image treatment as the homepage.

Uploads use the admin-only `POST /api/categories/upload-cover` multipart endpoint (`file`). JPEG, PNG, and WebP files are limited to 5 MB and checked by their binary signatures. Files are stored through the existing Cloudinary provider router in `eventai/categories`; the asset record uses `kind=category`. Admins do not need organizer profiles. Upload policy and provider usage limits still apply.

The nullable `categories.cover_image` column stores the HTTPS image URL. Category creation/update accepts `coverImage`; the API keeps this optional for existing clients. Both public category responses and homepage spotlights include the saved cover. Category changes invalidate the category caches. A migration adds the column, and API startup also ensures this additive column exists for deployments that do not run migrations separately.

Top-two selection still uses recent paid ticket sales, published upcoming events, and stable daily rotation for equal sales. Saved category images take priority; event photos and the previous category imagery remain fallbacks for categories without saved covers. Homepage copy is predefined per built-in category with generic wording for new categories; no model call is needed to render a cover.

Eight initial category covers were imported from existing public Unsplash images into Cloudinary during setup. Their source URLs and upload results are recorded in the local, ignored category-cover manifest. Replacing a cover does not delete the previous Cloudinary asset automatically, preserving the ability to recover it.
