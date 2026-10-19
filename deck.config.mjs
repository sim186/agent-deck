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
];

// Personal skills run in pi in the background with GLM 5.3 Flash; the answer opens as markdown.
// team-activity is limited to myself (Simone Celestino), never the whole team.
const skill = (name, label, text) => ({ type: 'headless', runner: 'pi', name, label, text, color: C.prompt });
const WORK_TIME = [
  skill('activity', 'Me\nyesterday', 'Use the team-activity skill for myself only (Simone Celestino): what did I do yesterday?'),
  skill('activity', 'Me\nlast week', 'Use the team-activity skill for myself only (Simone Celestino): what did I do last week?'),
  skill('worktime', 'Work time\ntoday', 'Use the worktime-calc skill: calculate my work time for today.'),
  skill('worktime', 'Work time\nweek', 'Use the worktime-calc skill: calculate my work time for this week.'),
];

const back = { type: 'switch', to: 'Default', label: '< Home', color: C.nav };
const menu = (to, label) => ({ type: 'switch', to, label, color: C.nav });

// Physical layout. Default: Mirabox HSV293SV3, a 6x3 grid in OpenDeck whose right
// column is a display-only screen. Override `device` in deck.local.mjs for other decks
// (e.g. { cols: 6, rows: 3, screenCols: [] } for 18 real keys).
const HSV293SV3 = { cols: 6, rows: 3, screenCols: [5] };

// Usage limit tiles at the end of the Agent profile (press one to refresh). `window` is
// session (5h), weekly or monthly. OpenCode Go comes from its usage API (local cost estimate as fallback).
const LIMITS = [
  { type: 'limit', provider: 'claude', window: 'weekly' },
  { type: 'limit', provider: 'codex', window: 'weekly' },
  { type: 'limit', provider: 'opencode', window: 'monthly' },
];

// Default screen: one status tile per row of the screen column.
const SCREEN = [
  { kinds: ['claude'], label: 'Claude' },
  { kinds: ['codex', 'opencode', 'pi'], label: 'Others' },
  { type: 'clock', label: 'Next' }, // current time + countdown to the next Outlook meeting
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
      // Left-hand layout (deck left of the keyboard). The far-left column holds Dictate and Rec,
      // which reach best; Approve/Deny sit beside the screen. Rarer menus fill the middle.
      Default: [
        menu('Launch', 'Launch'),
        menu('Projects', 'Projects'),
        menu('Prompts', 'Prompts'),
        { type: 'keys', label: 'Deny', keys: 'esc', states: ['blocked'], color: C.agent },
        { type: 'approve' },

        { type: 'dictate', label: 'Dictate', color: C.voice },
        menu('Git', 'Git'),
        menu('Meeting', 'Meeting'),
        { type: 'keys', label: 'Stop', keys: 'esc', color: C.agent },
        menu('Agent', 'Agent'),

        rec('toggle', 'Rec'),
        { type: 'prompt', label: 'Commit', text: PROMPTS[8][1], color: C.prompt },
        menu('Agenda', 'Agenda'),
        { type: 'status', label: 'Agents' },
        { type: 'prompt', label: 'Review\ndiff', text: PROMPTS[0][1], color: C.prompt },
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

      // Controls on the first row, then one tile per running herdr agent (project, kind, state);
      // press a tile to jump to that agent.
      Agent: [
        back,
        { type: 'approve' },
        { type: 'keys', label: 'Stop', keys: 'esc', color: C.agent },
        { type: 'keys', label: 'Mode', keys: { claude: 'shift+tab', opencode: 'tab' }, color: C.agent },
        menu('Session', 'More'),

        ...Array.from({ length: keyCount - 5 - LIMITS.length }, (_, index) => ({ type: 'agentlist', index })),
        ...LIMITS,
      ],

      // Less frequent session controls (slash commands are mapped per agent).
      Session: [
        { type: 'switch', to: 'Agent', label: '< Agents', color: C.nav },
        { type: 'keys', label: 'Deny', keys: 'esc', states: ['blocked'], color: C.agent },
        { type: 'keys', label: 'Ctrl+C', keys: 'ctrl+c', color: C.agent },
        { type: 'prompt', label: 'Clear', text: SLASH.clear, color: C.agent },
        { type: 'prompt', label: 'Compact', text: SLASH.compact, color: C.agent },

        { type: 'prompt', label: 'Model', text: SLASH.model, color: C.agent },
        { type: 'prompt', label: 'Resume', text: SLASH.resume, color: C.agent },
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
