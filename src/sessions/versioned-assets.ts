/**
 * Ensure cached browser assets are tied to the Worker release serving their HTML.
 * APP_VERSION is operator-controlled deployment config; reject anything outside semver.
 */
export function versionCopilotAssetUrls(html: string, appVersion: string): string {
  const safeVersion = /^\d+\.\d+\.\d+$/.test(appVersion) ? appVersion : "0.0.0";
  return html.replace(
    /(\/copilot\.(?:css|js)\?v=)[^"'&\s]+/g,
    `$1${safeVersion}`,
  );
}

/** Remove the app-only Co-Pilot bundle even when the URL has a cache-busting query. */
export function removeCopilotClientScript(html: string): string {
  return html.replace(
    /<script src="\/copilot\.js(?:\?[^"]*)?" defer><\/script>/g,
    "",
  );
}
