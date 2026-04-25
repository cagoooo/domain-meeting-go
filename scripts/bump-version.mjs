#!/usr/bin/env node
/**
 * 一鍵同步多處版本號的 helper script。
 *
 * 用法:
 *   node scripts/bump-version.mjs 0.3.1
 *   node scripts/bump-version.mjs 0.3.1 "修復 PDF 偏右問題 + SW 註冊"
 *
 * 會同步更新:
 *   - package.json          .version
 *   - public/version.json   { version, releasedAt, notes }
 *   - public/sw.js          const SW_VERSION = 'vX.Y.Z'
 *   - README.md             ![Version](shields.io badge)
 *
 * 不會自動做的（請手動）:
 *   - CHANGELOG.md 條目
 *   - git commit + push
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const newVersion = process.argv[2];
const notes = process.argv[3] || '';

if (!newVersion || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
  console.error('❌ 用法: node scripts/bump-version.mjs X.Y.Z [notes]');
  console.error('   範例: node scripts/bump-version.mjs 0.3.1 "修復 PDF 偏右"');
  process.exit(1);
}

const updates = [];

// 1. package.json
const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const oldVersion = pkg.version;
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
updates.push(`package.json:        ${oldVersion} → ${newVersion}`);

// 2. public/version.json
const verPath = resolve(ROOT, 'public/version.json');
writeFileSync(
  verPath,
  JSON.stringify(
    {
      version: newVersion,
      releasedAt: new Date().toISOString(),
      notes: notes || `v${newVersion}`,
    },
    null,
    2
  ) + '\n'
);
updates.push(`public/version.json: ${newVersion}`);

// 3. public/sw.js
const swPath = resolve(ROOT, 'public/sw.js');
if (existsSync(swPath)) {
  let sw = readFileSync(swPath, 'utf-8');
  sw = sw.replace(
    /const\s+SW_VERSION\s*=\s*['"][^'"]+['"]/,
    `const SW_VERSION = 'v${newVersion}'`
  );
  writeFileSync(swPath, sw);
  updates.push(`public/sw.js:        SW_VERSION = 'v${newVersion}'`);
}

// 4. README.md badge
const readmePath = resolve(ROOT, 'README.md');
if (existsSync(readmePath)) {
  let readme = readFileSync(readmePath, 'utf-8');
  readme = readme.replace(
    /!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-[^)]+-blue\)/,
    `![Version](https://img.shields.io/badge/version-${newVersion}-blue)`
  );
  writeFileSync(readmePath, readme);
  updates.push(`README.md:           badge → ${newVersion}`);
}

console.log(`✅ 已 bump 到 v${newVersion}\n`);
updates.forEach((u) => console.log('  • ' + u));
console.log('\n📝 下一步：\n  1. 編輯 CHANGELOG.md 加入新條目\n  2. git commit + push');
