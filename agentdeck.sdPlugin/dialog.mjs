// Small native dialog for headless keys that need a value at press time (e.g. "which
// period?"): an editable combobox (pick a preset or type anything) and, when `days` is
// set >= 1, a checkbox list of the last N days (today first). Ticked days win over the
// combobox; the joined labels become the answer ("Tuesday 21 Oct, Friday 24 Oct").
// Resolves with the trimmed text, or null when cancelled or left empty.
import { spawn } from 'node:child_process';

const WIN = process.platform === 'win32';
// PowerShell single-quoted strings: embedded single quotes are doubled.
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function askDialog({ title = 'AgentDeck', message = 'Value?', options = [], days = 0 }) {
  return WIN ? askWindows({ title, message, options, days }) : askMac({ title, message, options });
}

const dayLabel = (date) => date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const lastDays = (n) => Array.from({ length: n }, (_, i) => dayLabel(new Date(Date.now() - i * 86400000)));

// Powershell + WinForms, shipped base64-encoded so no shell quoting can bite.
// windowsHide and -WindowStyle Hidden must both stay off: either poisons the form's
// show-state and the dialog comes up invisible (IsWindowVisible=false while the message
// loop runs). Price: the PowerShell console window flashes briefly until the dialog
// replaces it as the top window.
function askWindows({ title, message, options, days }) {
  const dayItems = lastDays(Math.max(0, Math.round(days)));
  const comboY = 34;
  const daysY = 62;
  const daysH = dayItems.length > 0 ? dayItems.length * 17 + 4 : 0;
  const buttonsY = dayItems.length > 0 ? daysY + daysH + 10 : comboY + 36;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = ${psQuote(title)}
$f.FormBorderStyle = 'FixedDialog'
$f.StartPosition = 'CenterScreen'
$f.TopMost = $true
$f.MaximizeBox = $false
$f.ClientSize = New-Object System.Drawing.Size(320,${buttonsY + 34})
$l = New-Object System.Windows.Forms.Label
$l.Text = ${psQuote(message)}
$l.AutoSize = $true
$l.Location = New-Object System.Drawing.Point(12,10)
$cb = New-Object System.Windows.Forms.ComboBox
foreach ($o in @(${options.map(psQuote).join(',')})) { [void]$cb.Items.Add($o) }
$cb.Location = New-Object System.Drawing.Point(12,${comboY})
$cb.Size = New-Object System.Drawing.Size(296,23)
$dclb = New-Object System.Windows.Forms.CheckedListBox
$dclb.CheckOnClick = $true
foreach ($d in @(${dayItems.map(psQuote).join(',')})) { [void]$dclb.Items.Add($d) }
$dclb.Location = New-Object System.Drawing.Point(12,${daysY})
$dclb.Size = New-Object System.Drawing.Size(296,${daysH})
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'OK'
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$ok.Location = New-Object System.Drawing.Point(112,${buttonsY})
$ok.Size = New-Object System.Drawing.Size(90,28)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.Location = New-Object System.Drawing.Point(210,${buttonsY})
$cancel.Size = New-Object System.Drawing.Size(90,28)
$f.Controls.AddRange(@($l,$cb,$dclb,$ok,$cancel))
$f.AcceptButton = $ok
$f.CancelButton = $cancel
$f.ActiveControl = $cb
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $picked = @()
  for ($i = 0; $i -lt $dclb.Items.Count; $i++) { if ($dclb.GetItemChecked($i)) { $picked += $dclb.Items[$i] } }
  if ($picked.Count -gt 0) { [Console]::Out.Write(($picked -join ', ')) }
  elseif ($cb.Text.Trim()) { [Console]::Out.Write($cb.Text.Trim()) }
};
`;
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('exit', () => resolve(out.trim() || null));
  });
}

// osascript 'display dialog' gives a text field; cancelled dialogs exit non-zero.
function askMac({ title, message }) {
  const script = `display dialog ${JSON.stringify(message)} with title ${JSON.stringify(title)}`
    + ` buttons {"Cancel","OK"} default button "OK" default answer ""`;
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => {
      const text = code === 0 && out.match(/text returned:(.*)/)?.[1]?.trim();
      resolve(text || null);
    });
  });
}
