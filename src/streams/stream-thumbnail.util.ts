/**
 * Stream / archive cover image: the first chosen product's current first image,
 * read at request time so product image edits show on cards and share links.
 * Falls back to the stored thumbnail, then the store logo.
 */
export function resolveStreamThumbnail(params: {
  firstProductImages?: (string | null)[] | null;
  thumbnailUrl?: string | null;
  sellerLogoUrl?: string | null;
}): string | null {
  return (
    params.firstProductImages?.[0]?.trim() ||
    params.thumbnailUrl?.trim() ||
    params.sellerLogoUrl?.trim() ||
    null
  );
}
