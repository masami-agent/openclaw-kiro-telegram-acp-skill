/**
 * scripts/build-skill.ts
 *
 * Skill build and packaging script — generates a `.skill` file from source.
 *
 * Flow:
 *   1. Run TypeScript compilation (npm run build)
 *   2. Copy compiled JS and resource files to skill-src/kiro-telegram-acp/references/
 *   3. Package skill-src/kiro-telegram-acp/ into a .skill (Zip) file
 *   4. Output the generated .skill file path and size
 *
 * Usage: npm run build-skill
 *
 * Requirements: 10.1, 10.2, 10.3
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createWriteStream,
  createReadStream,
  readdirSync,
  statSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { Writable, Readable } from "node:stream";
import { createDeflateRaw } from "node:zlib";

const execFileAsync = promisify(execFile);

// ── Configuration ─────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL_SRC_DIR = join(PROJECT_ROOT, "skill-src", "kiro-telegram-acp");
const REFERENCES_DIR = join(SKILL_SRC_DIR, "references");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const OUTPUT_FILE = join(PROJECT_ROOT, "kiro-telegram-acp.skill");

/**
 * Compiled JS files to copy from dist/ to references/.
 * These are core modules that skill users may need to reference.
 */
const COMPILED_FILES_TO_COPY: Array<{ src: string; destName: string }> = [
  {
    src: "dist/src/hook/handler.js",
    destName: "hook-template.ts", // Keep original .ts extension as a template reference
  },
];

/**
 * Additional static resource files to copy (from examples/ or templates/).
 */
const RESOURCE_FILES_TO_COPY: Array<{ src: string; destName: string }> = [
  {
    src: "templates/kiro-agent.json",
    destName: "kiro-agent-template.json",
  },
];

// ── Zip utility (using Node.js built-in modules, no extra dependencies) ──

/**
 * Minimal Zip file generator.
 * Uses DEFLATE compression, compatible with standard Zip format.
 */

interface ZipEntry {
  name: string; // File path within the zip
  data: Buffer; // Raw file content
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deflateSync(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const deflater = createDeflateRaw();
    const chunks: Buffer[] = [];
    deflater.on("data", (chunk: Buffer) => chunks.push(chunk));
    deflater.on("end", () => resolve(Buffer.concat(chunks)));
    deflater.on("error", reject);
    deflater.end(data);
  });
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dateVal =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: dateVal };
}

async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  const now = new Date();
  const { time: dosTime, date: dosDate } = dosDateTime(now);

  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = await deflateSync(entry.data);
    const uncompressedSize = entry.data.length;
    const compressedSize = compressed.length;

    // Local file header (30 bytes + name + compressed data)
    const local = Buffer.alloc(30 + nameBuffer.length + compressedSize);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // compression: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuffer.copy(local, 30);
    compressed.copy(local, 30 + nameBuffer.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // compression: deflate
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuffer.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  // End of central directory (22 bytes)
  const centralDirSize = centralHeaders.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// ── Build steps ───────────────────────────────────────────────

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function logStep(step: string): void {
  console.log(`\n▸ ${step}`);
}

/**
 * Step 1: Run TypeScript compilation
 */
async function compileTypeScript(): Promise<void> {
  logStep("Running TypeScript compilation (npm run build)...");
  try {
    const { stdout, stderr } = await execFileAsync("npm", ["run", "build"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    if (stderr && !stderr.includes("npm warn")) {
      process.stderr.write(stderr);
    }
    log("✓ TypeScript compilation complete");
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err);
    console.error(`✗ TypeScript compilation failed: ${msg}`);
    process.exit(1);
  }
}

/**
 * Step 2: Copy compiled JS and resource files to skill-src/references/
 */
function copyFilesToReferences(): void {
  logStep("Copying files to skill-src/kiro-telegram-acp/references/ ...");

  if (!existsSync(REFERENCES_DIR)) {
    mkdirSync(REFERENCES_DIR, { recursive: true });
  }

  // Copy compiled JS files
  for (const file of COMPILED_FILES_TO_COPY) {
    const srcPath = join(PROJECT_ROOT, file.src);
    const destPath = join(REFERENCES_DIR, file.destName);
    if (!existsSync(srcPath)) {
      console.error(`✗ Compiled file not found: ${file.src}`);
      process.exit(1);
    }
    copyFileSync(srcPath, destPath);
    log(`✓ ${file.src} → references/${file.destName}`);
  }

  // Copy static resource files
  for (const file of RESOURCE_FILES_TO_COPY) {
    const srcPath = join(PROJECT_ROOT, file.src);
    const destPath = join(REFERENCES_DIR, file.destName);
    if (!existsSync(srcPath)) {
      console.error(`✗ Resource file not found: ${file.src}`);
      process.exit(1);
    }
    copyFileSync(srcPath, destPath);
    log(`✓ ${file.src} → references/${file.destName}`);
  }
}

/**
 * Recursively collect all files in a directory, returning relative paths.
 */
function collectFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(relative(baseDir, fullPath));
    }
  }
  return results;
}

/**
 * Step 3: Package into a .skill (Zip) file
 */
async function packageSkill(): Promise<void> {
  logStep("Packaging .skill file...");

  if (!existsSync(SKILL_SRC_DIR)) {
    console.error(`✗ Skill source directory not found: ${SKILL_SRC_DIR}`);
    process.exit(1);
  }

  // Collect all files
  const files = collectFiles(SKILL_SRC_DIR, SKILL_SRC_DIR);
  if (files.length === 0) {
    console.error("✗ No files found in skill-src directory");
    process.exit(1);
  }

  log(`Found ${files.length} files:`);
  for (const f of files) {
    log(`  - ${f}`);
  }

  // Create Zip entries
  const entries: ZipEntry[] = [];
  for (const file of files) {
    const fullPath = join(SKILL_SRC_DIR, file);
    const { readFileSync } = await import("node:fs");
    const data = readFileSync(fullPath);
    entries.push({ name: file, data });
  }

  // Generate Zip file
  const zipBuffer = await createZip(entries);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUTPUT_FILE, zipBuffer);

  log(`✓ .skill file generated`);
}

/**
 * Step 4: Output file information
 */
function printResult(): void {
  logStep("Build result");

  const stats = statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log("");
  console.log(`  📦 File path: ${OUTPUT_FILE}`);
  console.log(`  📏 File size: ${stats.size} bytes (${sizeKB} KB)`);
  console.log("");
  console.log("  ✅ Skill build complete!");
  console.log("");
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  🔨 Skill Build and Package");
  console.log("═══════════════════════════════════════════");

  await compileTypeScript();
  copyFilesToReferences();
  await packageSkill();
  printResult();
}

main().catch((err) => {
  console.error("✗ Unexpected error during build:", err);
  process.exit(1);
});
