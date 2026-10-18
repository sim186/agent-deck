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

const back = { type: 'switch', to: 'Default', label: '< Home', color: C.nav };
const menu = (to, label) => ({ type: 'switch', to, label, color: C.nav });

// Each profile is a list of keys in reading order (6 per row on the HSV293S).
// `null` leaves a key empty.
export default ({ projects = [], terminal } = {}) => ({
  terminal,
  profiles: {
    Default: [
      ...AGENTS.map((a) => ({ type: 'status', ...a })),
      { type: 'approve' },
      { type: 'keys', label: 'Stop', keys: 'esc', color: C.agent },

      menu('Launch', 'Launch'),
      menu('Projects', 'Projects'),
      menu('Prompts', 'Prompts'),
      menu('Agent', 'Agent'),
      menu('Git', 'Git'),
    ],

    // Row 1: new agent next to the focused pane, VS Code on the focused folder.
    // Rows 2-3: VS Code per project (set `editor: false` on a project to skip it).
    Launch: [
      back,
      ...AGENTS.map((a) => ({ type: 'launch', kind: a.kind, label: `New\n${a.label}`, color: C.launch })),
      { type: 'editor', label: 'Code\nhere', color: C.editor },
      ...projects
        .filter((p) => p.editor !== false)
        .slice(0, 12)
        .map((p) => ({ type: 'editor', label: p.label, path: p.path, color: C.editor })),
    ],

    Projects: [
      back,
      ...projects.slice(0, 17).map((p) => ({ type: 'project', color: C.project, ...p })),
    ],

    Prompts: [
      back,
      ...PROMPTS.map(([label, text]) => ({ type: 'prompt', label, text, color: C.prompt })),
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
});
