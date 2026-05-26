import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function findGeneratedProjectDir(outputDir) {
  const entries = readdirSync(outputDir, { withFileTypes: true });
  const projectDir = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('project-'));
  assert.ok(projectDir, `Expected generated project directory inside ${outputDir}`);
  return path.join(outputDir, projectDir.name);
}

function listFilesRecursive(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function assertAnyGeneratedFileContains(projectDir, pattern, message) {
  const files = listFilesRecursive(projectDir);
  const matchedFile = files.find((filePath) => {
    try {
      return pattern.test(readFileSync(filePath, 'utf-8'));
    } catch {
      return false;
    }
  });

  assert.ok(matchedFile, message);
}

function assertFileLacksPattern(filePath, pattern, message) {
  const content = readFileSync(filePath, 'utf-8');
  assert.ok(!pattern.test(content), message);
}

function runAgentFixture({ name, idea, injectedEnv, assertInjectedFailure }) {
  const outputDir = mkdtempSync(path.join(tmpdir(), `ai-agent-wordpress-${name}-`));

  try {
    const result = spawnSync('node', ['dist/agent.js', idea], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        FORCE_MOCK_MODE: 'true',
        AUTO_APPROVE: 'true',
        LOG_LEVEL: 'ERROR',
        OUTPUT_DIR: outputDir,
        ...injectedEnv,
      },
      encoding: 'utf-8',
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    assert.notStrictEqual(
      result.status,
      0,
      `${name}: expected non-zero exit status when hard checks detect a broken include. Output:\n${output}`
    );
    assert.match(
      output,
      /Agent: 3 › Code Generator[\s\S]*Status: ✗ FAILED/,
      `${name}: expected the code generator step to fail before later stages. Output:\n${output}`
    );

    const projectDir = findGeneratedProjectDir(outputDir);
    assertInjectedFailure(projectDir, output);

    console.log(`PASS ${name}`);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

runAgentFixture({
  name: 'theme-missing-include',
  idea: 'build a landing page for selling batteries',
  injectedEnv: {
    MOCK_BROKEN_THEME_INCLUDE: 'true',
  },
  assertInjectedFailure(projectDir) {
    assertAnyGeneratedFileContains(
      projectDir,
      /inc\/missing-fixture\.php/,
      'theme-missing-include: expected injected missing include in generated theme files'
    );
  },
});

runAgentFixture({
  name: 'plugin-missing-include',
  idea: 'build a wordpress plugin for battery quote requests',
  injectedEnv: {
    MOCK_BROKEN_PLUGIN_INCLUDE: 'true',
  },
  assertInjectedFailure(projectDir) {
    assertAnyGeneratedFileContains(
      projectDir,
      /includes\/class-missing-fixture\.php/,
      'plugin-missing-include: expected injected missing include in generated plugin files'
    );
  },
});

runAgentFixture({
  name: 'plugin-missing-header',
  idea: 'build a wordpress plugin for battery quote requests',
  injectedEnv: {
    MOCK_BROKEN_PLUGIN_HEADER: 'true',
  },
  assertInjectedFailure(projectDir) {
    const bootstrapPath = path.join(projectDir, 'build-a-wordpress-plugin-for-battery-quo.php');
    assertFileLacksPattern(
      bootstrapPath,
      /Plugin Name:/,
      'plugin-missing-header: expected generated bootstrap file to be missing the Plugin Name header'
    );
  },
});

console.log('All hard-check fixtures passed.');
