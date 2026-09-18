// Reusable Imgur upload service shared by the Table Maker, the Jotter editor
// (drag/drop, paste, toolbar, Image Library) and anything else that needs a
// stable CDN URL for a local image.
//
// Anonymous uploads need ONLY the public Client-ID — no secret, no OAuth token,
// no Google login. Keep the client secret out of the frontend and OAuth out of
// the picture; authenticated flow (accessToken) stays available for later.
//
// The authoritative URL is always the API-returned data.link. Never hand-assemble
// https://i.imgur.com/<id>.png — Imgur may re-encode images (PNG grids mixed in
// with text render badly otherwise).

export const IMGUR_CLIENT_ID = "d70305e7c3ac5c6";
export const IMGUR_API = "https://api.imgur.com/3/image";
export const LARGE_IMAGE_BYTES = 1024 * 1024;

// Upload a local Blob/File and return the structured image asset:
//   { id, url (data.link), provider: "imgur", type, width, height, size }
// throws a user-facing Error on failure; 413 maps to a dedicated message.
export async function uploadImageToImgur(blob, filename = "image.png", { accessToken = null } = {}) {
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` };

  let response;
  try {
    const body = new FormData();
    body.append("image", blob, filename);
    response = await fetch(IMGUR_API, { method: "POST", headers, body });
  } catch {
    throw new Error("Upload failed — check your connection and try again.");
  }
  if (response.status === 413) {
    throw new Error("That image is too large for Imgur. Use a smaller screenshot or scale it down.");
  }
  if (!response.ok) {
    throw new Error(`Imgur upload failed (HTTP ${response.status}).`);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error("Imgur returned an unreadable response.");
  }
  if (!json || json.success !== true || !json.data) {
    throw new Error(json?.data?.error?.message || json?.data?.error || "Imgur upload failed.");
  }
  const d = json.data;
  return {
    id: d.id || "",
    url: d.link || "",
    provider: "imgur",
    type: d.type || blob.type || "image/png",
    width: d.width || 0,
    height: d.height || 0,
    size: d.size || blob.size || 0,
  };
}