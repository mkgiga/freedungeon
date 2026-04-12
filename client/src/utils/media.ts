/**
 * Converts a full upload URL to its thumbnail URL.
 * e.g. http://localhost:8078/uploads/abc123.png → http://localhost:8078/uploads/thumbs/abc123.png
 */
export function thumbnailUrl(url: string | undefined): string | undefined {
    if (!url) return undefined
    return url.replace('/uploads/', '/uploads/thumbs/')
}
