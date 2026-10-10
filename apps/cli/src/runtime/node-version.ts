/**
 * The Node.js floor, checked before anything else is loaded. Kept free of imports on purpose: on an
 * unsupported Node the rest of the program may not even parse, and the person must still get a clear
 * message instead of a stack trace.
 */
export const MIN_NODE = { major: 22, minor: 13 } as const;

export function isSupportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

/** How to get a supported Node on this platform, in two or three lines. */
export function nodeInstallHint(platform: string): string {
  const floor = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  const common = `Install Node.js ${floor} or newer (the current LTS is fine): https://nodejs.org/en/download`;
  if (platform === 'win32') {
    return `${common}\n  PowerShell:  winget install OpenJS.NodeJS.LTS   (then open a new terminal)`;
  }
  if (platform === 'darwin') {
    return `${common}\n  Homebrew:    brew install node`;
  }
  return `${common}\n  Or with nvm: nvm install --lts && nvm use --lts`;
}

export function unsupportedNodeMessage(version: string, platform: string): string {
  return `ExitOS needs Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer, but this is Node.js ${version}.\n  ${nodeInstallHint(platform)}\nCheck with: node --version`;
}
