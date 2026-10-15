/**
 * Pick the supported Vertex Live WebSocket API version for the configured model.
 * Gemini 3.8 Live is documented on the GA v1 endpoint; older Live previews stay
 * on v1beta1 to avoid breaking existing deployments that override GEMINI_MODEL.
 */
export function buildLiveWebSocketUrl(host: string, model: string): string {
  if (!host || /[\r\n/]/.test(host)) throw new TypeError("Invalid Vertex Live host");
  if (!model || /[\r\n]/.test(model)) throw new TypeError("Invalid Live model");
  const apiVersion = /^gemini-3\.8-live(?:$|[-.])/i.test(model) ? "v1" : "v1beta1";
  return `https://${host}/ws/google.cloud.aiplatform.${apiVersion}.LlmBidiService/BidiGenerateContent`;
}
