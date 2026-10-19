/**
 * Voice previews remain admin-only by default. A temporary release flag may
 * permit a signed-in user to audition native prebuilt voices in their own session.
 */
export function canAccessVoicePreview(
  adminAccess: boolean,
  hasAuthenticatedUserSession: boolean,
  auditionEnabled: boolean,
): boolean {
  return adminAccess || (auditionEnabled && hasAuthenticatedUserSession);
}
