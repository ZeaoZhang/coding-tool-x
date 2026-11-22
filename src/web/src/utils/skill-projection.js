export function isProjectionUnsupported(skill) {
  return skill?.projection?.mode === 'unsupported'
    || skill?.projection?.state === 'unsupported'
}
