import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectDevelopmentRunConfigs } from '../src/development-server.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-agent-development-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.allSettled(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('development run configuration detection', () => {
  it('detects a conventional Vite workspace without executing package scripts', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite --port 4173', unrelated: 'node destructive-script.js' },
      devDependencies: { vite: '^7.0.0' },
    }));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toHaveLength(1);
    expect(result.configs[0]).toMatchObject({
      args: ['run', 'dev'],
      command: 'pnpm',
      framework: 'Vite',
      port: 4173,
      source: './package.json#scripts.dev',
    });
    expect(result.configs[0]?.args.join(' ')).not.toContain('unrelated');
    expect(result.recommendedConfigId).toBe(result.configs[0]?.id);
  });

  it('detects a frontend package in a conventional monorepo folder', async () => {
    const root = await temporaryRoot();
    const web = path.join(root, 'packages', 'web');
    await fs.mkdir(web, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    await fs.writeFile(path.join(web, 'package.json'), JSON.stringify({
      scripts: { start: 'next dev -p 3100' },
      dependencies: { next: '^16.0.0' },
    }));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toHaveLength(1);
    expect(result.configs[0]).toMatchObject({ cwd: 'packages/web', framework: 'Next.js', port: 3100 });
  });

  it('falls back to a bounded static server for a root index.html', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Local</title>');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({
      command: 'python',
      args: ['-m', 'http.server', '8000', '--bind', '127.0.0.1'],
      framework: 'Static HTML',
    });
  });

  it('detects Spring Boot Maven projects and honors the configured local port', async () => {
    const root = await temporaryRoot();
    await fs.mkdir(path.join(root, 'src', 'main', 'resources'), { recursive: true });
    await fs.writeFile(path.join(root, 'pom.xml'), '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
    await fs.writeFile(path.join(root, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
    await fs.writeFile(path.join(root, 'src', 'main', 'resources', 'application-local.yml'), 'server:\n  port: ${SERVER_PORT:9081}\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({
      args: ['spring-boot:run'],
      framework: 'Spring Boot',
      kind: 'java',
      port: 9081,
      source: 'pom.xml',
    });
    expect(path.basename(result.configs[0]!.command)).toBe(process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  });

  it('detects Spring Boot Gradle projects without executing the wrapper', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'build.gradle.kts'), 'plugins { id("org.springframework.boot") version "3.5.0" }');
    await fs.writeFile(path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({ args: ['bootRun'], framework: 'Spring Boot', kind: 'java', port: 8080 });
  });

  it('inherits the base server port when an active Spring profile has no server override', async () => {
    const root = await temporaryRoot();
    const resources = path.join(root, 'src', 'main', 'resources');
    await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(root, 'pom.xml'), '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
    await fs.writeFile(path.join(resources, 'application.yml'), [
      'server:',
      '  port: 9081',
      '  servlet:',
      '    context-path: /aop',
      'spring:',
      '  profiles:',
      '    active: local',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(resources, 'application-local.yml'), [
      'spring:',
      '  data:',
      '    redis:',
      '      port: ${REDIS_PORT:6379}',
      '',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({ framework: 'Spring Boot', port: 9081, url: 'http://127.0.0.1:9081/aop' });
  });
});
