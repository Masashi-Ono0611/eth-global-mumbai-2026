// Private HF Space auth: the hub iframe URL carries a ?__sign JWT, but
// subresource requests normally rely on a *.static.hf.space cookie that
// browsers often block inside the iframe (third-party cookie blocking),
// which 401s every same-origin fetch. Appending the JWT to each request
// authenticates them regardless of cookie policy. No-op locally.
//
// Only ASSET requests (meshes, policies, XML, audio, images) go through
// this now: application code ships in the Vite bundle, which the page load
// itself already authenticated.
const HF_SIGN = new URLSearchParams(location.search).get("__sign");

// Vitaquack: the meshes, GLB, MJCF and policies are not in our repository (their
// licences forbid it); every page-relative asset URL is rebased onto Pollen's
// Hugging Face Space, pinned to the commit this engine was vendored from.
export const ASSET_BASE =
  "https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/ad9d41a763f30dc770817c33d92dcfec0205db1e/app/public";
const rebase = (url) => (url.startsWith("./") ? `${ASSET_BASE}/${url.slice(2)}` : url);

export const signed = (url) =>
  HF_SIGN ? `${rebase(url)}${url.includes("?") ? "&" : "?"}__sign=${encodeURIComponent(HF_SIGN)}` : rebase(url);
