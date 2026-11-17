// Token Radar: the peer-implied token launch radar (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable protocol that records no token with the peer-implied model in
// lib/model.ts, writes the ranked board to /output/board.json and the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library. The run is deterministic: the same
// snapshot always writes the same bytes, with no network and no clock.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read the data.js beside the page. The board states its
// model, shows the peer evidence behind every value, and gives every protocol a farm plan.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const BOARD_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardText = `${JSON.stringify({ rows: board })}\n`;
if (Buffer.byteLength(boardText, 'utf8') > BOARD_MAX_BYTES) {
  process.stderr.write(`token radar: board.json is over the gate's ${BOARD_MAX_BYTES} bytes\n`);
  process.exit(1);
}
writeFileSync(join(out, 'board.json'), boardText);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/**
 * Copy a directory tree's regular files into `to`, in sorted name order, skipping names that
 * start with a dot. Returns the copied files' paths, relative to the source directory.
 */
function copyTree(from: string, to: string, rel = ''): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  const names = readdirSync(from).sort();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    const st = statSync(path);
    const child = rel === '' ? name : `${rel}/${name}`;
    if (st.isDirectory()) {
      copied.push(...copyTree(path, join(to, name), child));
    } else if (st.isFile()) {
      copyFileSync(path, join(to, name));
      copied.push(child);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes. While
// the dashboard or its screenshots are still being built, the run warns and stops short of the
// dossier rather than failing: the gate itself refuses an entry without them.
let wroteDossier = false;
if (dashFiles.length > 0 && shots.length >= 3) {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  wroteDossier = true;
} else {
  process.stderr.write(
    `token radar: warning: dashboard/ holds ${dashFiles.length} file${dashFiles.length === 1 ? '' : 's'} and screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: no dossier.json written; hand in the page and 3 screenshots before submitting\n`,
  );
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.counts.early} early, ${radar.counts.comps} live peers, ${radar.counts.ambiguous} ambiguous records set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images)` +
    (wroteDossier ? ` and ${join(out, 'dossier.json')}\n` : ' and no dossier (page or screenshots missing)\n'),
);
