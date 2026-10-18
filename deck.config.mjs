// Deck layout and key behavior, shared by every machine.
// Machine-specific bits (projects, terminal app) live in deck.local.mjs.
// Rebuild after editing: ./install.sh (macOS) or .\install.ps1 (Windows).

// Category colors (top bar on each key).
const C = {
  nav: '#4f8cff',
  launch: '#2ecc71',
  project: '#1abc9c',
  prompt: '#a66bff',
  agent: '#ff8c42',
  git: '#f05033',
  editor: '#007acc',
  voice: '#eb4034',
};

const AGENTS = [
  { kind: 'claude', label: 'Claude' },
  { kind: 'codex', label: 'Codex' },
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'pi', label: 'Pi' },
];

// Slash commands differ per agent. `default` is used for kinds not listed.
// Verify against each agent's /help if one does not behave.
const SLASH = {
  clear: { claude: '/clear', default: '/new' },
  compact: { default: '/compact' },
  model: { opencode: '/models', default: '/model' },
  resume: { opencode: '/sessions', default: '/resume' },
};

const PROMPTS = [
  ['Review\ndiff', 'Review the current git diff. Report only actionable bugs, ranked by severity.'],
  ['Write\ntests', 'Write tests for the changes in the current diff, then run them.'],
  ['Explain\nerror', 'Explain the last error in this session and propose a fix.'],
  ['Fix\nlint', "Run the project's linter and type checker and fix every issue."],
  ['Plan\nfirst', 'Before changing anything, propose a short plan and wait for my OK.'],
  ['Simplify', 'Simplify the code you just changed without changing behavior.'],
  ['Continue', 'continue'],
  ['Summary', 'Summarize what you changed and what is left to do.'],
  ['Commit', 'Commit the current changes with a concise conventional commit message.'],
  ['Open\nPR', 'Push the branch and open a pull request with a clear description.'],
  // Personal skills (installed in ~/.agents/skills). Self = Simone only, never the whole team.
  ['Me\nyesterday', 'Use the team-activity skill for myself only (Simone Celestino): what did I do yesterday?'],
  ['Me\nlast week', 'Use the team-activity skill for myself only (Simone Celestino): what did I do last week?'],
];

// The work-time skill lives in pi: run it there in the background with GLM 5.3 Flash and open the answer.
const WORK_TIME = [['Work time\ntoday', 'today'], ['Work time\nweek', 'this week']].map(([label, when]) => ({
  type: 'headless', runner: 'pi', name: 'worktime', label, color: C.prompt,
  text: `Use the worktime-calc skill: calculate my work time for ${when}.`,
}));

const back = { type: 'switch', to: 'Default', label: '< Home', color: C.nav };
const menu = (to, label) => ({ type: 'switch', to, label, color: C.nav });

// Physical layout. Default: Mirabox HSV293SV3, a 6x3 grid in OpenDeck whose right
// column is a display-only screen. Override `device` in deck.local.mjs for other decks
// (e.g. { cols: 6, rows: 3, screenCols: [] } for 18 real keys).
const HSV293SV3 = { cols: 6, rows: 3, screenCols: [5] };

// Default screen: one status tile per row of the screen column.
const SCREEN = [
  { kinds: ['claude'], label: 'Claude' },
  { kinds: ['codex'], label: 'Codex' },
  { kinds: ['opencode', 'pi'], label: 'OC / Pi' },
];

// Each profile lists its pressable keys in reading order; the installer skips the
// screen cells. `null` leaves a key empty. Screen tiles are the same in every profile.
export default ({ projects = [], terminal, handy, calendar, meetings = {}, device = HSV293SV3, screen = SCREEN } = {}) => {
  const keyCount = (device.cols - device.screenCols.length) * device.rows;
  const room = keyCount - 1; // after the Back key
  const rec = (mode, label) => ({ type: 'meeting', mode, label, color: C.voice, ...meetings });
  return {
    terminal,
    handy,
    calendar,
    device,
    screen: screen.map((s) => ({ type: 'status', ...s })),
    profiles: {
      // Row 1: act on agents. Row 2: menus. Row 3: daily shortcuts.
      Default: [
        { type: 'approve' },
        { type: 'keys', label: 'Deny', keys: 'esc', states: ['blocked'], color: C.agent },
        { type: 'keys', label: 'Stop', keys: 'esc', color: C.agent },
        { type: 'dictate', label: 'Dictate', color: C.voice },
        { type: 'status', label: 'Agents' },

        menu('Launch', 'Launch'),
        menu('Projects', 'Projects'),
        menu('Prompts', 'Prompts'),
        menu('Agent', 'Agent'),
        menu('Git', 'Git'),

        { type: 'prompt', label: 'Review\ndiff', text: PROMPTS[0][1], color: C.prompt },
        rec('toggle', 'Rec'),
        menu('Meeting', 'Meeting'),
        menu('Agenda', 'Agenda'),
        { type: 'prompt', label: 'Commit', text: PROMPTS[8][1], color: C.prompt },
      ],

      // Upcoming Outlook meetings (calendar URL in deck.local.mjs); press one for a briefing.
      Agenda: [
        back,
        ...Array.from({ length: room }, (_, index) => ({ type: 'agenda', index, color: C.nav })),
      ],

      // New agent next to the focused pane, VS Code on the focused folder, then VS Code
      // per project (set `editor: false` on a project to skip it).
      Launch: [
        back,
        ...AGENTS.map((a) => ({ type: 'launch', kind: a.kind, label: `New\n${a.label}`, color: C.launch })),
        { type: 'editor', label: 'Code\nhere', color: C.editor },
        ...projects
          .filter((p) => p.editor !== false)
          .slice(0, room - AGENTS.length - 1)
          .map((p) => ({ type: 'editor', label: p.label, path: p.path, color: C.editor })),
      ],

      Projects: [
        back,
        ...projects.slice(0, room).map((p) => ({ type: 'project', color: C.project, ...p })),
      ],

      Prompts: [
        back,
        ...PROMPTS.slice(0, room - WORK_TIME.length).map(([label, text]) => ({ type: 'prompt', label, text, color: C.prompt })),
        ...WORK_TIME,
      ],

      Agent: [
        back,
        { type: 'approve' },
        { type: 'keys', label: 'Deny', keys: 'esc', states: ['blocked'], color: C.agent },
        { type: 'keys', label: 'Stop', keys: 'esc', color: C.agent },
        { type: 'keys', label: 'Ctrl+C', keys: 'ctrl+c', color: C.agent },

        { type: 'keys', label: 'Mode', keys: { claude: 'shift+tab', opencode: 'tab' }, color: C.agent },
        { type: 'prompt', label: 'Clear', text: SLASH.clear, color: C.agent },
        { type: 'prompt', label: 'Compact', text: SLASH.compact, color: C.agent },
        { type: 'prompt', label: 'Model', text: SLASH.model, color: C.agent },
        { type: 'prompt', label: 'Resume', text: SLASH.resume, color: C.agent },

        { type: 'dictate', label: 'Dictate', color: C.voice },
        { type: 'dictate', label: 'Dictate\nAI', mode: 'post', color: C.voice },
        { type: 'dictate', label: 'Cancel\ndictation', mode: 'cancel', color: C.voice },
      ],

      // Rec toggles recording; Summary asks the focused agent to summarize the last transcript.
      Meeting: [
        back,
        rec('toggle', 'Rec'),
        rec('summary', 'Summary'),
        rec('last', 'Last\ntranscript'),
        rec('folder', 'Meetings\nfolder'),
      ],

      Git: [
        back,
        { type: 'run', label: 'Status', command: 'git status -sb', color: C.git },
        { type: 'run', label: 'Diff', command: 'git diff --stat', color: C.git },
        { type: 'run', label: 'Log', command: 'git log --oneline -15', color: C.git },
        { type: 'run', label: 'Branches', command: 'git branch -vv', color: C.git },

        { type: 'run', label: 'Pull', command: 'git pull --ff-only', color: C.git },
        { type: 'run', label: 'PR\nin web', command: 'gh pr view --web', color: C.git },
        { type: 'prompt', label: 'Commit', text: PROMPTS[8][1], color: C.prompt },
        { type: 'prompt', label: 'Open\nPR', text: PROMPTS[9][1], color: C.prompt },
      ],
    },
  };
};
