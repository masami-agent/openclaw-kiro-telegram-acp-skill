/**
 * scripts/build-skill.ts
 *
 * Skill 建置與打包腳本 — 從原始碼產生 `.skill` 檔案。
 *
 * 流程：
 *   1. 執行 TypeScript 編譯（npm run build）
 *   2. 複製編譯後的 JS 與資源檔案至 skill-src/kiro-telegram-acp/references/
 *   3. 打包 skill-src/kiro-telegram-acp/ 為 .skill（Zip）檔案
 *   4. 輸出產生的 .skill 檔案路徑與大小
 *
 * 用法：npm run build-skill
 *
 * 需求: 10.1, 10.2, 10.3
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

// ── 設定 ──────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL_SRC_DIR = join(PROJECT_ROOT, "skill-src", "kiro-telegram-acp");
const REFERENCES_DIR = join(SKILL_SRC_DIR, "references");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const OUTPUT_FILE = join(PROJECT_ROOT, "kiro-telegram-acp.skill");

/**
 * 需要從 dist/ 複製到 references/ 的編譯後 JS 檔案。
 * 這些是 skill 使用者可能需要參考的核心模組。
 */
const COMPILED_FILES_TO_COPY: Array<{ src: string; destName: string }> = [
  {
    src: "dist/src/wrapper/kiro-acp-ask.js",
    destName: "kiro-acp-ask.js",
  },
  {
    src: "dist/src/hook/handler.js",
    destName: "hook-template.ts", // 保留原始 .ts 副檔名作為範本參考
  },
];

/**
 * 額外需要複製的靜態資源檔案（從 examples/ 或 templates/）。
 */
const RESOURCE_FILES_TO_COPY: Array<{ src: string; destName: string }> = [
  {
    src: "templates/kiro-agent.json",
    destName: "kiro-agent-template.json",
  },
];

// ── Zip 工具（使用 Node.js 內建模組，無需額外依賴）──────────────

/**
 * 最小化的 Zip 檔案產生器。
 * 使用 DEFLATE 壓縮，相容標準 Zip 格式。
 */

interface ZipEntry {
  name: string; // 檔案在 zip 中的路徑
  data: Buffer; // 原始檔案內容
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

// ── 建置步驟 ──────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function logStep(step: string): void {
  console.log(`\n▸ ${step}`);
}

/**
 * 步驟 1：執行 TypeScript 編譯
 */
async function compileTypeScript(): Promise<void> {
  logStep("執行 TypeScript 編譯（npm run build）...");
  try {
    const { stdout, stderr } = await execFileAsync("npm", ["run", "build"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    if (stderr && !stderr.includes("npm warn")) {
      process.stderr.write(stderr);
    }
    log("✓ TypeScript 編譯完成");
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err);
    console.error(`✗ TypeScript 編譯失敗：${msg}`);
    process.exit(1);
  }
}

/**
 * 步驟 2：複製編譯後的 JS 與資源檔案至 skill-src/references/
 */
function copyFilesToReferences(): void {
  logStep("複製檔案至 skill-src/kiro-telegram-acp/references/ ...");

  if (!existsSync(REFERENCES_DIR)) {
    mkdirSync(REFERENCES_DIR, { recursive: true });
  }

  // 複製編譯後的 JS 檔案
  for (const file of COMPILED_FILES_TO_COPY) {
    const srcPath = join(PROJECT_ROOT, file.src);
    const destPath = join(REFERENCES_DIR, file.destName);
    if (!existsSync(srcPath)) {
      console.error(`✗ 找不到編譯後的檔案：${file.src}`);
      process.exit(1);
    }
    copyFileSync(srcPath, destPath);
    log(`✓ ${file.src} → references/${file.destName}`);
  }

  // 複製靜態資源檔案
  for (const file of RESOURCE_FILES_TO_COPY) {
    const srcPath = join(PROJECT_ROOT, file.src);
    const destPath = join(REFERENCES_DIR, file.destName);
    if (!existsSync(srcPath)) {
      console.error(`✗ 找不到資源檔案：${file.src}`);
      process.exit(1);
    }
    copyFileSync(srcPath, destPath);
    log(`✓ ${file.src} → references/${file.destName}`);
  }
}

/**
 * 遞迴收集目錄下所有檔案，回傳相對路徑列表。
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
 * 步驟 3：打包為 .skill（Zip）檔案
 */
async function packageSkill(): Promise<void> {
  logStep("打包 .skill 檔案...");

  if (!existsSync(SKILL_SRC_DIR)) {
    console.error(`✗ 找不到 skill 原始碼目錄：${SKILL_SRC_DIR}`);
    process.exit(1);
  }

  // 收集所有檔案
  const files = collectFiles(SKILL_SRC_DIR, SKILL_SRC_DIR);
  if (files.length === 0) {
    console.error("✗ skill-src 目錄中沒有任何檔案");
    process.exit(1);
  }

  log(`找到 ${files.length} 個檔案：`);
  for (const f of files) {
    log(`  - ${f}`);
  }

  // 建立 Zip entries
  const entries: ZipEntry[] = [];
  for (const file of files) {
    const fullPath = join(SKILL_SRC_DIR, file);
    const { readFileSync } = await import("node:fs");
    const data = readFileSync(fullPath);
    entries.push({ name: file, data });
  }

  // 產生 Zip 檔案
  const zipBuffer = await createZip(entries);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUTPUT_FILE, zipBuffer);

  log(`✓ 已產生 .skill 檔案`);
}

/**
 * 步驟 4：輸出檔案資訊
 */
function printResult(): void {
  logStep("建置結果");

  const stats = statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log("");
  console.log(`  📦 檔案路徑：${OUTPUT_FILE}`);
  console.log(`  📏 檔案大小：${stats.size} bytes (${sizeKB} KB)`);
  console.log("");
  console.log("  ✅ Skill 建置完成！");
  console.log("");
}

// ── 主程式 ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  🔨 Skill 建置與打包");
  console.log("═══════════════════════════════════════════");

  await compileTypeScript();
  copyFilesToReferences();
  await packageSkill();
  printResult();
}

main().catch((err) => {
  console.error("✗ 建置過程發生未預期的錯誤：", err);
  process.exit(1);
});
