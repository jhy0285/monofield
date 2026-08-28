import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyDevelopmentRunOverrides,
  DevelopmentServerService,
  detectDevelopmentRunConfigs,
  selectExecutableCandidate,
} from '../src/development-server.js';

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
  it('prefers an executable Windows command shim over an extensionless npm shim', () => {
    expect(selectExecutableCandidate([
      'C:\\nvm4w\\nodejs\\npm',
      'C:\\nvm4w\\nodejs\\npm.cmd',
    ], 'win32')).toBe('C:\\nvm4w\\nodejs\\npm.cmd');
  });

  it('ignores Windows Store aliases when an installed executable is available', () => {
    expect(selectExecutableCandidate([
      'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
      'C:\\Python313\\python.exe',
    ], 'win32')).toBe('C:\\Python313\\python.exe');
  });

  it('applies Spring profile and application argument overrides without a shell', () => {
    const overridden = applyDevelopmentRunOverrides({
      id: 'spring-local',
      label: 'Spring Boot · Maven · local',
      kind: 'java',
      framework: 'Spring Boot',
      cwd: '.',
      command: 'mvn',
      args: ['spring-boot:run', '-Dspring-boot.run.profiles=local'],
      source: 'pom.xml',
      profile: 'local',
      port: 8080,
      url: 'http://127.0.0.1:8080',
    }, { profile: 'prod', applicationArgs: ['--feature=orders', '--dry-run'] });

    expect(overridden.profile).toBe('prod');
    expect(overridden.args).toEqual([
      'spring-boot:run',
      '-Dspring-boot.run.profiles=prod',
      '-Dspring-boot.run.arguments=--feature=orders --dry-run',
    ]);
    expect(overridden.id).not.toBe('spring-local');
  });

  it('bypasses the workspace discovery cache for an explicit refresh', async () => {
    const root = await temporaryRoot();
    const firstRoot = path.join(root, 'service-a');
    await fs.mkdir(firstRoot);
    await fs.writeFile(path.join(firstRoot, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }));

    const initial = await detectDevelopmentRunConfigs(root);
    expect(initial.projects?.map((project) => project.path)).toContain('service-a');

    const secondRoot = path.join(root, 'service-b');
    await fs.mkdir(secondRoot);
    await fs.writeFile(path.join(secondRoot, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }));

    const cached = await detectDevelopmentRunConfigs(root);
    expect(cached.projects?.map((project) => project.path)).not.toContain('service-b');
    const refreshed = await detectDevelopmentRunConfigs(root, null, true);
    expect(refreshed.projects?.map((project) => project.path)).toContain('service-b');
  });

  it('reuses detected run configurations until an explicit refresh', async () => {
    const root = await temporaryRoot();
    const packagePath = path.join(root, 'package.json');
    await fs.writeFile(packagePath, JSON.stringify({ scripts: { dev: 'vite --port 5111' }, devDependencies: { vite: 'latest' } }));

    const first = await detectDevelopmentRunConfigs(root);
    await fs.writeFile(packagePath, JSON.stringify({ scripts: { dev: 'vite --port 5222' }, devDependencies: { vite: 'latest' } }));

    const cached = await detectDevelopmentRunConfigs(root);
    const refreshed = await detectDevelopmentRunConfigs(root, null, true);

    expect(first.configs[0]?.port).toBe(5111);
    expect(cached.configs[0]?.port).toBe(5111);
    expect(refreshed.configs[0]?.port).toBe(5222);
  });

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

  it('identifies the UI framework behind Vite without changing the safe package script command', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      dependencies: { vue: '^3.5.0' },
      devDependencies: { vite: '^7.0.0', '@vitejs/plugin-vue': '^6.0.0' },
    }));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({ framework: 'Vue · Vite', command: 'npm', args: ['run', 'dev'] });
  });

  it('detects named Vue CLI serve scripts used by enterprise projects', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { 'serve.local': 'vue-cli-service serve --mode local', 'build.prod': 'vue-cli-service build' },
      dependencies: { vue: '^3.5.0' },
      devDependencies: { '@vue/cli-service': '^5.0.0', vite: '^7.0.0' },
    }));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({ framework: 'Vue CLI', args: ['run', 'serve.local'], port: 8080 });
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

  it('detects a conventional FastAPI application without importing it', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\ndependencies = ["fastapi", "uvicorn"]\n');
    await fs.writeFile(path.join(root, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({
      args: ['-m', 'uvicorn', 'main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
      command: 'python',
      framework: 'FastAPI',
      kind: 'python',
      port: 8000,
    });
  });

  it('detects Poetry-managed Streamlit without importing application code', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.poetry]\nname = "demo"\n[tool.poetry.dependencies]\nstreamlit = "*"\n');
    await fs.writeFile(path.join(root, 'poetry.lock'), '');
    await fs.writeFile(path.join(root, 'streamlit_app.py'), 'import streamlit as st\nst.write("hello")\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs[0]).toMatchObject({
      framework: 'Streamlit',
      command: 'poetry',
      args: ['run', 'python', '-m', 'streamlit', 'run', 'streamlit_app.py', '--server.address', '127.0.0.1', '--server.port', '8501'],
      port: 8501,
    });
  });

  it('detects Go cmd servers, Air, and Makefile targets', async () => {
    const root = await temporaryRoot();
    await fs.mkdir(path.join(root, 'cmd', 'server'), { recursive: true });
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.test/service\ngo 1.24\n');
    await fs.writeFile(path.join(root, 'cmd', 'server', 'main.go'), 'package main\nfunc main() {}\n');
    await fs.writeFile(path.join(root, '.air.toml'), 'root = "."\n');
    await fs.writeFile(path.join(root, 'Makefile'), 'dev:\n\tgo run ./cmd/server\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toEqual(expect.arrayContaining([
      expect.objectContaining({ framework: 'Go · Air', command: 'air' }),
      expect.objectContaining({ framework: 'Go', args: ['run', './cmd/server'] }),
      expect.objectContaining({ framework: 'Make', command: 'make', args: ['dev'] }),
    ]));
  });

  it('discovers bounded workspace projects and scopes detection to the selected module', async () => {
    const root = await temporaryRoot();
    const api = path.join(root, 'services', 'api');
    const web = path.join(root, 'apps', 'web');
    await fs.mkdir(api, { recursive: true });
    await fs.mkdir(web, { recursive: true });
    await fs.writeFile(path.join(api, 'go.mod'), 'module example.test/api\ngo 1.24\n');
    await fs.writeFile(path.join(api, 'main.go'), 'package main\nfunc main() {}\n');
    await fs.writeFile(path.join(web, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0', vite: '^7.0.0' } }));

    const result = await detectDevelopmentRunConfigs(root, 'apps/web');

    expect(result.activeProjectPath).toBe('apps/web');
    expect(result.projects?.map((project) => project.path)).toEqual(expect.arrayContaining(['apps/web', 'services/api']));
    expect(result.configs[0]).toMatchObject({ framework: 'React · Vite', cwd: '.' });
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

    const local = result.configs.find((config) => config.profile === 'local');
    expect(local).toMatchObject({
      args: ['spring-boot:run', '-Dspring-boot.run.profiles=local'],
      framework: 'Spring Boot',
      kind: 'java',
      profile: 'local',
      port: 9081,
      source: expect.stringContaining('application-local.yml'),
    });
    expect(result.recommendedConfigId).toBe(local?.id);
    expect(path.basename(local!.command)).toBe(process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
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

    const localConfigs = result.configs.filter((config) => config.profile === 'local');
    expect(localConfigs).toHaveLength(1);
    expect(localConfigs[0]).toMatchObject({
      args: ['spring-boot:run'],
      framework: 'Spring Boot',
      port: 9081,
      url: 'http://127.0.0.1:9081/aop',
    });
  });

  it('creates selectable Spring Boot run configurations for local, dev, and prod profiles', async () => {
    const root = await temporaryRoot();
    const resources = path.join(root, 'src', 'main', 'resources');
    await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(root, 'pom.xml'), '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
    await fs.writeFile(path.join(resources, 'application-local.yml'), 'server:\n  port: 8081\n');
    await fs.writeFile(path.join(resources, 'application-dev.yml'), 'server:\n  port: 8082\n');
    await fs.writeFile(path.join(resources, 'application-prod.yml'), 'server:\n  port: 8083\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs.filter((config) => config.framework === 'Spring Boot').map((config) => ({
      profile: config.profile ?? 'default',
      port: config.port,
      args: config.args,
    }))).toEqual(expect.arrayContaining([
      { profile: 'default', port: 8080, args: ['spring-boot:run'] },
      { profile: 'local', port: 8081, args: ['spring-boot:run', '-Dspring-boot.run.profiles=local'] },
      { profile: 'dev', port: 8082, args: ['spring-boot:run', '-Dspring-boot.run.profiles=dev'] },
      { profile: 'prod', port: 8083, args: ['spring-boot:run', '-Dspring-boot.run.profiles=prod'] },
    ]));
    expect(result.configs.find((config) => config.id === result.recommendedConfigId)?.profile).toBe('local');
  });

  it('returns a starting server immediately and lets the user stop it before readiness', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'node server.js --port 63991' },
    }));
    const detected = await detectDevelopmentRunConfigs(root);
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => ({
      accepted: true as const,
      action: input.action,
      error: null,
      logs: [],
      pid: input.action === 'terminate' ? null : 4512,
      projectId: input.projectId,
      running: input.action !== 'terminate',
    }));
    const service = new DevelopmentServerService(broker);

    const started = await service.start('project-fast-stop', root, detected.configs[0]!.id);
    expect(started).toMatchObject({ state: 'starting', pid: 4512 });

    const stopped = await service.stop('project-fast-stop');
    expect(stopped).toMatchObject({ state: 'idle', pid: null, error: null });
    expect(broker).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminate', projectId: 'project-fast-stop' }));
  });

  it.runIf(process.platform === 'win32')('keeps the captured failure reason when the desktop broker later has no error', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'node server.js --port 63990' },
    }));
    const detected = await detectDevelopmentRunConfigs(root);
    let statusCalls = 0;
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => {
      if (input.action === 'start') {
        return { accepted: true as const, action: input.action, error: null, logs: [], pid: 4513, projectId: input.projectId, running: true };
      }
      statusCalls += 1;
      return {
        accepted: true as const,
        action: input.action,
        error: statusCalls === 1 ? 'Development server exited (1)' : null,
        logs: [],
        pid: null,
        projectId: input.projectId,
        running: false,
      };
    });
    const service = new DevelopmentServerService(broker);

    await service.start('project-preserve-error', root, detected.configs[0]!.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const failed = await service.statusAsync('project-preserve-error');

    expect(failed).toMatchObject({ state: 'failed', error: 'Development server exited (1)' });
  });

  it('keeps sibling module servers independent when their generated config ids match', async () => {
    const root = await temporaryRoot();
    for (const moduleName of ['service-a', 'service-b']) {
      const moduleRoot = path.join(root, moduleName);
      await fs.mkdir(moduleRoot, { recursive: true });
      await fs.writeFile(path.join(moduleRoot, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js --port 63992' } }));
      await fs.writeFile(path.join(moduleRoot, 'server.js'), 'setInterval(() => {}, 1000);\n');
    }
    const firstDetected = await detectDevelopmentRunConfigs(root, 'service-a');
    const secondDetected = await detectDevelopmentRunConfigs(root, 'service-b');
    expect(firstDetected.configs[0]?.id).toBe(secondDetected.configs[0]?.id);

    let pid = 6100;
    const running = new Map<string, number>();
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => {
      if (input.action === 'start') { pid += 1; running.set(input.projectId, pid); }
      if (input.action === 'terminate') running.delete(input.projectId);
      return {
        accepted: true as const,
        action: input.action,
        error: null,
        logs: [],
        pid: running.get(input.projectId) ?? null,
        projectId: input.projectId,
        running: running.has(input.projectId),
      };
    });
    const service = new DevelopmentServerService(broker);

    const first = await service.start('project-modules', root, firstDetected.configs[0]!.id, 'service-a');
    const second = await service.start('project-modules', root, secondDetected.configs[0]!.id, 'service-b');

    expect(first).toMatchObject({ projectPath: 'service-a', pid: 6101 });
    expect(second).toMatchObject({ projectPath: 'service-b', pid: 6102 });
    expect(broker.mock.calls.map(([input]) => input.action).filter((action) => action !== 'status'))
      .toEqual(['start', 'start']);
    expect(await service.statusAsync('project-modules', 'service-a')).toMatchObject({
      projectPath: 'service-a',
      pid: 6101,
    });
    expect(await service.statusAsync('project-modules', 'service-b')).toMatchObject({
      projectPath: 'service-b',
      pid: 6102,
    });
    expect(service.statuses('project-modules')).toHaveLength(2);

    await service.stop('project-modules', 'service-b');
    expect(await service.statusAsync('project-modules', 'service-a')).toMatchObject({ pid: 6101 });
    expect(await service.statusAsync('project-modules', 'service-b')).toMatchObject({ state: 'idle', pid: null });
    await service.stopAll('project-modules');
  });

  it('refuses to treat an unrelated process on the detected port as the selected server', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const address = blocker.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
      const root = await temporaryRoot();
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
        scripts: { dev: `node server.js --port ${address.port}` },
      }));
      const detected = await detectDevelopmentRunConfigs(root);
      const broker = vi.fn();
      const service = new DevelopmentServerService(broker);

      await expect(service.start('project-port-conflict', root, detected.configs[0]!.id))
        .rejects.toThrow(`Port ${address.port} is already in use`);
      expect(broker).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
