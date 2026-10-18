// Run a one-shot prompt through a coding-agent CLI (pi or opencode) without a terminal and
// save the answer as markdown. The prompt travels as an attached file, so calendar text or
// quotes can never break the command line (pi/opencode are .cmd shims on Windows).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const WIN = process.platform === 'win32';
export const DEFAULT_MODEL = 'opencode-go/glm-5.3-flash';
const INSTRUCTION = 'Carry out the instructions in the attached file and answer in markdown.';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_');

export function outputDir(settings) {
  return (settings.outDir ?? '~/Documents/AgentDeck').replace(/^~(?=$|[\\/])/, os.homedir());
}

// Resolves with the path of the markdown answer; rejects with the CLI's last error line.
export function runHeadless({ runner = 'opencode', model = DEFAULT_MODEL, prompt, name = 'answer', bin, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = `${name}-${stamp()}`;
  const promptFile = path.join(os.tmpdir(), `agentdeck-${base}.md`);
  fs.writeFileSync(promptFile, prompt);
  const args = runner === 'pi'
    ? ['-p', '--no-session', '--model', model, `@${promptFile}`, INSTRUCTION]
    : ['run', INSTRUCTION, '-m', model, '-f', promptFile]; // -f takes a list, so it goes last
  const exe = bin ?? runner;
  const stdio = ['ignore', 'pipe', 'pipe'];
  const child = WIN
    ? spawn([exe, ...args].map((a) => `"${a.replace(/"/g, '')}"`).join(' '), { shell: true, windowsHide: true, stdio })
    : spawn(exe, args, { stdio });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve, reject) => {
    const finish = () => fs.rmSync(promptFile, { force: true });
    child.on('error', (e) => { finish(); reject(e); });
    child.on('exit', (code) => {
      finish();
      const text = stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      if (code || !text) return reject(new Error(stderr.trim().split('\n').pop() || `${runner} exit ${code}`));
      const out = path.join(outDir, `${base}.md`);
      fs.writeFileSync(out, `${text}\n`);
      resolve(out);
    });
  });
}
