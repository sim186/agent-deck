// Copy to deck.local.mjs (not committed) and adjust for this machine.
export default {
  // App to bring forward after focusing an agent in herdr.
  // macOS: bundle id (iTerm2: com.googlecode.iterm2, Ghostty: com.mitchellh.ghostty).
  // Windows: window title used by AppActivate (e.g. 'Windows Terminal').
  terminal: 'com.googlecode.iterm2',

  // One key per project in the Projects menu (max 17).
  // `agent` (optional) starts that agent when the workspace is first created.
  // Each project also gets a VS Code key in the Launch menu (first 12; `editor: false` skips it).
  projects: [
    { label: 'Deck', path: '~/Documents/developer/deck', agent: 'claude' },
  ],
};
