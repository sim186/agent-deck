// Copy to deck.local.mjs (not committed) and adjust for this machine.
export default {
  // App to bring forward after focusing an agent in herdr.
  // macOS: bundle id (iTerm2: com.googlecode.iterm2, Ghostty: com.mitchellh.ghostty).
  // Windows: window title used by AppActivate (e.g. 'Windows Terminal').
  terminal: 'com.googlecode.iterm2',

  // Optional: Handy binary for the Dictate keys, if not in the usual install folder.
  // handy: 'C:\\Program Files\\Handy\\handy.exe',

  // Optional: meeting recorder (Rec key). Defaults: ~/Documents/Meetings, default mic, no system audio.
  // meetings: {
  //   dir: '~/Documents/Meetings',
  //   mic: 'default',          // macOS: device name or "default"; Windows: dshow name, e.g. 'Microphone (Realtek Audio)'
  //   system: 'BlackHole 2ch', // loopback device for the other participants (Windows: 'Stereo Mix (Realtek Audio)' or 'CABLE Output (VB-Audio Virtual Cable)')
  //   ffmpeg: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
  // },
  // List devices: macOS  ffmpeg -f avfoundation -list_devices true -i ""
  //               Windows ffmpeg -list_devices true -f dshow -i dummy

  // Optional: deck geometry. Default is the Mirabox HSV293SV3 (6x3 grid, right column
  // is a display-only screen). For a deck with 18 real keys:
  // device: { cols: 6, rows: 3, screenCols: [] },

  // Optional: what the screen column shows, one status tile per row.
  // screen: [
  //   { kinds: ['claude'], label: 'Claude' },
  //   { kinds: ['codex'], label: 'Codex' },
  //   { kinds: ['opencode', 'pi'], label: 'OC / Pi' },
  // ],

  // One key per project in the Projects menu (max 14 on the HSV293SV3).
  // `agent` (optional) starts that agent when the workspace is first created.
  // Each project also gets a VS Code key in the Launch menu (first 12; `editor: false` skips it).
  projects: [
    { label: 'Deck', path: '~/Documents/developer/deck', agent: 'claude' },
  ],
};
