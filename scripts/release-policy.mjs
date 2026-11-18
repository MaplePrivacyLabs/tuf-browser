// Git package managers may install development dependencies for these hooks,
// even when lifecycle execution is disabled. Prebuilt releases need none of them.
export const preparationScripts = [
  'build', 'prepare', 'preprepare', 'postprepare', 'preinstall', 'install',
  'postinstall', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'postpublish',
];

export function releaseManifest(source) {
  const result = structuredClone(source);
  for (const script of preparationScripts) delete result.scripts?.[script];
  delete result.workspaces;
  return result;
}
