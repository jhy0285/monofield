import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopDevelopmentProcessInput } from '@open-design/sidecar-proto';

import {
  applyDevelopmentRunOverrides,
  desktopDevelopmentProcessKey,
  DevelopmentServerService,
  detectDevelopmentRunConfigs,
  selectExecutableCandidate,
  validatedDevelopmentEnvironment,
} from '../src/development-server.js';
import { resolveDevelopmentProjectRoot } from '../src/development-projects.js';

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
  it('reserves every environment variable owned by the run-port broker', () => {
    expect(validatedDevelopmentEnvironment({ FEATURE_ORDERS: 'true' })).toEqual({ FEATURE_ORDERS: 'true' });
    for (const key of ['PORT', 'BROWSER', 'SERVER_PORT', 'ASPNETCORE_URLS', 'GRADIO_SERVER_PORT', 'STREAMLIT_SERVER_PORT']) {
      expect(() => validatedDevelopmentEnvironment({ [key]: '9000' })).toThrow(/reserved/i);
    }
  });

  it('uses bridge-safe, distinct process keys for sibling workspace modules', () => {
    const first = desktopDevelopmentProcessKey('project-modules', 'services/api-a');
    const second = desktopDevelopmentProcessKey('project-modules', 'services/api-b');
    expect(first).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(first).not.toBe(second);
    expect(desktopDevelopmentProcessKey('project-modules', '.')).toBe('project-modules');
  });

  it('includes the normalized workspace and process cwd in the Desktop process identity', () => {
    const first = desktopDevelopmentProcessKey(
      'project-folder-switch',
      '.',
      'C:\\work\\workspace-a',
      'C:\\work\\workspace-a\\server',
    );
    const equivalent = desktopDevelopmentProcessKey(
      'project-folder-switch',
      '.',
      'C:\\work\\workspace-a\\.',
      'C:\\work\\workspace-a\\server\\.',
    );
    const second = desktopDevelopmentProcessKey(
      'project-folder-switch',
      '.',
      'C:\\work\\workspace-b',
      'C:\\work\\workspace-b\\server',
    );

    expect(first).toBe(equivalent);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });

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
    }, {
      profile: 'prod',
      applicationArgs: ['--feature=orders', '--dry-run'],
      port: 9180,
      url: 'http://localhost:9180/orders',
    });

    expect(overridden.profile).toBe('prod');
    expect(overridden.args).toEqual([
      'spring-boot:run',
      '-Dspring-boot.run.profiles=prod',
      '-Dspring-boot.run.arguments=--server.port=9180 --feature=orders --dry-run',
    ]);
    expect(overridden.id).not.toBe('spring-local');
    expect(overridden.port).toBe(9180);
    expect(overridden.url).toBe('http://localhost:9180/orders');
  });

  it.each([
    { command: 'mvn', baseArgs: ['spring-boot:run'], prefix: '-Dspring-boot.run.arguments=' },
    { command: 'gradle', baseArgs: ['bootRun'], prefix: '--args=' },
  ])('preserves quoted and empty Spring application argv boundaries for $command', ({ command, baseArgs, prefix }) => {
    const overridden = applyDevelopmentRunOverrides({
      id: `spring-${command}`,
      label: `Spring Boot · ${command}`,
      kind: 'java',
      framework: 'Spring Boot',
      cwd: '.',
      command,
      args: baseArgs,
      source: command === 'mvn' ? 'pom.xml' : 'build.gradle',
      port: 8080,
      url: 'http://127.0.0.1:8080',
    }, {
      applicationArgs: ['--label=Order service', '', '--json={"name":"A B"}', 'C:\\Program Files\\MonoField'],
    });

    expect(overridden.args.find((value) => value.startsWith(prefix))).toBe(
      `${prefix}"--label=Order service" "" "--json={\\"name\\":\\"A B\\"}" "C:\\\\Program Files\\\\MonoField"`,
    );
  });

  it('does not apply generic application overrides to Spring Framework servlet-plugin commands', () => {
    const config = {
      id: 'spring-framework-tomcat',
      label: 'Spring Framework · Tomcat · Maven',
      kind: 'java' as const,
      framework: 'Spring Framework',
      cwd: '.',
      command: 'mvn',
      args: ['tomcat7:run'],
      source: 'pom.xml · tomcat7-maven-plugin',
      launchMode: 'auto' as const,
      port: 8080,
      url: 'http://127.0.0.1:8080',
    };

    expect(() => applyDevelopmentRunOverrides(config, { applicationArgs: ['--debug'] }))
      .toThrow('defined by their build plugin');
    expect(() => applyDevelopmentRunOverrides(config, { profile: 'local' }))
      .toThrow('defined by their build plugin');
    expect(() => applyDevelopmentRunOverrides(config, { port: 8081 }))
      .toThrow('defined by their build plugin');
    expect(() => applyDevelopmentRunOverrides(config, { url: 'http://127.0.0.1:8080/other' }))
      .toThrow('defined by their build plugin');
    expect(() => applyDevelopmentRunOverrides({
      ...config,
      framework: 'Java Servlet',
      runSettingsMode: 'build-plugin',
    }, { port: 8081 })).toThrow('defined by their build plugin');
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

  it('rejects an explicitly selected module that was not discovered instead of running the first server', async () => {
    const root = await temporaryRoot();
    const serviceRoot = path.join(root, 'aauserver');
    await fs.mkdir(serviceRoot);
    await fs.writeFile(path.join(serviceRoot, 'pom.xml'), '<project />');

    await expect(resolveDevelopmentProjectRoot(root, 'aopserver'))
      .rejects.toThrow('Development project was not found: aopserver');
  });

  it('falls back from a missing stored module only when the caller explicitly allows it', async () => {
    const root = await temporaryRoot();
    const serviceRoot = path.join(root, 'aauserver');
    await fs.mkdir(serviceRoot);
    await fs.writeFile(path.join(serviceRoot, 'pom.xml'), '<project />');

    await expect(detectDevelopmentRunConfigs(root, 'removed-server'))
      .rejects.toThrow('Development project was not found: removed-server');
    const fallback = await detectDevelopmentRunConfigs(root, 'removed-server', false, true);
    expect(fallback.activeProjectPath).toBe('aauserver');
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

  it('detects a Spring Framework Maven WAR with an embedded Tomcat plugin as auto-runnable', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <packaging>war</packaging>',
      '  <dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '  <build><plugins><plugin><artifactId>tomcat7-maven-plugin</artifactId><configuration><port>9181</port><path>/orders</path></configuration></plugin></plugins></build>',
      '</project>',
    ].join('\n'));
    await fs.writeFile(path.join(root, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: ['tomcat7:run'],
      framework: 'Spring Framework',
      launchMode: 'auto',
      port: 9181,
      source: expect.stringContaining('tomcat7-maven-plugin'),
      url: 'http://127.0.0.1:9181/orders',
    }));
    expect(path.basename(result.configs[0]!.command)).toBe(process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  });

  it('detects a Spring Framework Maven WAR with a Jetty plugin as auto-runnable', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <packaging>war</packaging>',
      '  <dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '  <build><plugins><plugin><artifactId>jetty-maven-plugin</artifactId><configuration><httpPort>9192</httpPort><contextPath>/catalog</contextPath></configuration></plugin></plugins></build>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: ['jetty:run'],
      framework: 'Spring Framework',
      launchMode: 'auto',
      port: 9192,
      source: expect.stringContaining('jetty-maven-plugin'),
      url: 'http://127.0.0.1:9192/catalog',
    }));
  });

  it('keeps inherited Spring WAR modules runnable through an active Maven servlet plugin', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <parent><groupId>com.example.platform</groupId><artifactId>corporate-spring-parent</artifactId></parent>',
      '  <packaging>war</packaging>',
      '  <build><plugins><plugin><artifactId>jetty-maven-plugin</artifactId></plugin></plugins></build>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: ['jetty:run'],
      framework: 'Java Servlet',
      launchMode: 'auto',
      runSettingsMode: 'build-plugin',
    }));
  });

  it('detects an active Cargo Maven servlet container with its configured URL', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project><packaging>war</packaging>',
      '<dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '<build><plugins><plugin>',
      '  <groupId>org.codehaus.cargo</groupId><artifactId>cargo-maven3-plugin</artifactId>',
      '  <configuration><container><containerId>tomcat10x</containerId></container>',
      '  <configuration><properties><cargo.servlet.port>9294</cargo.servlet.port></properties></configuration>',
      '  <deployables><deployable><properties><context>/legacy</context></properties></deployable></deployables>',
      '  </configuration>',
      '</plugin></plugins></build></project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: ['cargo:run'],
      framework: 'Spring Framework',
      launchMode: 'auto',
      port: 9294,
      source: 'pom.xml · cargo-maven3-plugin',
      url: 'http://127.0.0.1:9294/legacy',
    }));
  });

  it('does not classify a Maven aggregator with a servlet plugin as a runnable Spring application', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project><packaging>pom</packaging>',
      '<dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '<build><plugins><plugin><artifactId>jetty-maven-plugin</artifactId></plugin></plugins></build>',
      '<modules><module>service-a</module></modules>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs.some((config) => config.framework === 'Spring Framework' || config.framework === 'Java Servlet')).toBe(false);
  });

  it('does not classify a non-web Maven plugin project as Spring Framework', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project><packaging>jar</packaging>',
      '<build><plugins><plugin><artifactId>jetty-maven-plugin</artifactId></plugin></plugins></build>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs.some((config) => config.framework === 'Spring Framework' || config.framework === 'Java Servlet')).toBe(false);
  });

  it('does not mistake Boot BOMs, comments, or plugin management for runnable Boot or servlet plugins', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <!-- <parent><artifactId>spring-boot-starter-parent</artifactId></parent> -->',
      '  <packaging>war</packaging>',
      '  <dependencyManagement><dependencies><dependency>',
      '    <groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId>',
      '  </dependency></dependencies></dependencyManagement>',
      '  <dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '  <build><pluginManagement><plugins>',
      '    <plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin>',
      '    <plugin><artifactId>tomcat7-maven-plugin</artifactId></plugin>',
      '  </plugins></pluginManagement></build>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs.some((config) => config.framework === 'Spring Boot')).toBe(false);
    expect(result.configs).toContainEqual(expect.objectContaining({
      args: [],
      framework: 'Spring Framework',
      launchMode: 'manual',
    }));
  });

  it('detects an explicit Gradle Gretty plugin and reads only its selected configuration block', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'build.gradle'), [
      "// id 'org.springframework.boot'",
      "plugins { id 'org.gretty' }",
      "dependencies { implementation 'org.springframework:spring-webmvc:6.2.0' }",
      "server { port = 6553; contextPath = '/wrong' }",
      "gretty { httpPort = 9193; contextPath = '/store' }",
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: ['appRun'],
      framework: 'Spring Framework',
      launchMode: 'auto',
      port: 9193,
      source: expect.stringContaining('Gretty plugin'),
      url: 'http://127.0.0.1:9193/store',
    }));
    expect(result.configs.some((config) => config.framework === 'Spring Boot')).toBe(false);
  });

  it('does not treat servlet plugins applied only inside Gradle subprojects as root run configurations', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'build.gradle'), [
      "plugins { id 'org.gretty' version '4.1.1' apply false }",
      "subprojects {",
      "  apply plugin: 'org.gretty'",
      "  apply plugin: 'war'",
      "  dependencies { implementation 'org.springframework:spring-webmvc:6.2.0' }",
      "  gretty { httpPort = 9301; contextPath = '/nested' }",
      "}",
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs.some((config) => config.args.includes('appRun'))).toBe(false);
  });

  it('keeps a plain Spring Framework WAR manual when no embedded container plugin is configured', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <packaging>war</packaging>',
      '  <dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-webmvc</artifactId></dependency></dependencies>',
      '</project>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);
    const manual = result.configs.find((config) => config.framework === 'Spring Framework');

    expect(manual).toMatchObject({
      args: [],
      launchMode: 'manual',
      manualSetup: expect.stringContaining('Tomcat, Jetty, or Cargo'),
      source: 'pom.xml · Servlet/WAR project',
    });
    await expect(new DevelopmentServerService().start('manual-war', root, manual!.id))
      .rejects.toThrow('Add an active Tomcat, Jetty, or Cargo build plugin');
  });

  it('keeps a Maven WAR with parent-inherited Spring dependencies visible from web.xml evidence', async () => {
    const root = await temporaryRoot();
    const webInf = path.join(root, 'src', 'main', 'webapp', 'WEB-INF');
    await fs.mkdir(webInf, { recursive: true });
    await fs.writeFile(path.join(root, 'pom.xml'), [
      '<project>',
      '  <parent><groupId>com.example.platform</groupId><artifactId>corporate-spring-parent</artifactId></parent>',
      '  <packaging>war</packaging>',
      '</project>',
    ].join('\n'));
    await fs.writeFile(path.join(webInf, 'web.xml'), [
      '<web-app>',
      '  <servlet>',
      '    <servlet-name>dispatcher</servlet-name>',
      '    <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>',
      '  </servlet>',
      '</web-app>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: [],
      framework: 'Spring Framework',
      launchMode: 'manual',
      source: 'pom.xml · Servlet/WAR project',
    }));
  });

  it('keeps a Gradle WAR with inherited Spring dependencies visible from web.xml evidence', async () => {
    const root = await temporaryRoot();
    const webInf = path.join(root, 'src', 'main', 'webapp', 'WEB-INF');
    await fs.mkdir(webInf, { recursive: true });
    await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'war' }\n");
    await fs.writeFile(path.join(webInf, 'web.xml'), [
      '<web-app>',
      '  <listener>',
      '    <listener-class>org.springframework.web.context.ContextLoaderListener</listener-class>',
      '  </listener>',
      '</web-app>',
    ].join('\n'));

    const result = await detectDevelopmentRunConfigs(root);

    expect(result.configs).toContainEqual(expect.objectContaining({
      args: [],
      framework: 'Spring Framework',
      launchMode: 'manual',
      source: 'build.gradle · Servlet/WAR project',
    }));
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
    const startInput = broker.mock.calls
      .map(([input]) => input)
      .find((input) => input.action === 'start');
    expect(startInput?.projectId).toMatch(/^mf-/);
    expect(broker).toHaveBeenCalledWith(expect.objectContaining({
      action: 'terminate',
      projectId: startInput?.projectId,
    }));
  });

  it.runIf(process.platform === 'win32')('keeps the captured failure reason when the desktop broker later has no error', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'node server.js --port 63990' },
    }));
    const detected = await detectDevelopmentRunConfigs(root);
    let statusCalls = 0;
    const broker = vi.fn(async (input: DesktopDevelopmentProcessInput) => {
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
    const broker = vi.fn(async (input: {
      action: 'start' | 'status' | 'terminate';
      environment?: Record<string, string>;
      port?: number;
      projectId: string;
    }) => {
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

    const first = await service.start('project-modules', root, firstDetected.configs[0]!.id, 'service-a', {
      port: 63982,
      url: 'http://127.0.0.1:63982/service-a',
      environment: { FEATURE_SERVICE_A: 'true' },
    });
    const second = await service.start('project-modules', root, secondDetected.configs[0]!.id, 'service-b', {
      port: 63983,
      url: 'http://127.0.0.1:63983/service-b',
    });

    expect(first).toMatchObject({
      projectPath: 'service-a',
      pid: 6101,
      url: 'http://127.0.0.1:63982/service-a',
      config: { args: ['run', 'dev', '--', '--port', '63982'], port: 63982 },
    });
    expect(second).toMatchObject({
      projectPath: 'service-b',
      pid: 6102,
      url: 'http://127.0.0.1:63983/service-b',
      config: { args: ['run', 'dev', '--', '--port', '63983'], port: 63983 },
    });
    const startedProcessKeys = broker.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action === 'start')
      .map((input) => input.projectId);
    expect(startedProcessKeys).toHaveLength(2);
    expect(startedProcessKeys[0]).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(new Set(startedProcessKeys)).toHaveProperty('size', 2);
    const startInputs = broker.mock.calls
      .map(([input]) => input)
      .filter((input): input is Extract<DesktopDevelopmentProcessInput, { action: 'start' }> => input.action === 'start');
    expect(startInputs.map((input) => input.port)).toEqual([63982, 63983]);
    expect(startInputs[0]?.args.join(' ')).toContain('--port 63982');
    expect(startInputs[1]?.args.join(' ')).toContain('--port 63983');
    expect(startInputs[0]).toMatchObject({ environment: { FEATURE_SERVICE_A: 'true' } });
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

  it.runIf(process.platform === 'win32')('restarts instead of reusing a process when the same project id moves to another workspace root', async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    for (const root of [firstRoot, secondRoot]) {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
        scripts: { dev: 'node server.js --port 63871' },
      }));
      await fs.writeFile(path.join(root, 'server.js'), 'setInterval(() => {}, 1000);\n');
    }
    const firstDetected = await detectDevelopmentRunConfigs(firstRoot);
    const secondDetected = await detectDevelopmentRunConfigs(secondRoot);
    expect(firstDetected.configs[0]?.id).toBe(secondDetected.configs[0]?.id);

    let pid = 8100;
    const running = new Map<string, number>();
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => {
      if (input.action === 'start') running.set(input.projectId, ++pid);
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

    const first = await service.start('project-folder-switch', firstRoot, firstDetected.configs[0]!.id, null, {
      port: 63871,
      url: 'http://127.0.0.1:63871',
    });
    const second = await service.start('project-folder-switch', secondRoot, secondDetected.configs[0]!.id, null, {
      port: 63872,
      url: 'http://127.0.0.1:63872',
    });

    expect(first.pid).toBe(8101);
    expect(second.pid).toBe(8102);
    expect(second.url).toBe('http://127.0.0.1:63872');
    const lifecycle = broker.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action !== 'status');
    expect(lifecycle.map((input) => input.action)).toEqual(['start', 'terminate', 'start']);
    expect(lifecycle[0]?.projectId).not.toBe(lifecycle[2]?.projectId);
    await service.stopAll('project-folder-switch');
  });

  it.runIf(process.platform === 'win32')('reports every stop-all failure together with the still-running status', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js --port 63873' } }));
    const detected = await detectDevelopmentRunConfigs(root);
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => {
      if (input.action === 'terminate') throw new Error('taskkill denied');
      return {
        accepted: true as const,
        action: input.action,
        error: null,
        logs: [],
        pid: 8201,
        projectId: input.projectId,
        running: true,
      };
    });
    const service = new DevelopmentServerService(broker);
    await service.start('project-stop-all-failure', root, detected.configs[0]!.id, null, {
      port: 63873,
      url: 'http://127.0.0.1:63873',
    });

    const result = await service.stopAll('project-stop-all-failure');

    expect(result.failures).toEqual([expect.objectContaining({
      projectPath: '.',
      error: 'taskkill denied',
    })]);
    expect(result.servers).toEqual([expect.objectContaining({ pid: 8201, state: 'starting' })]);
  });

  it.runIf(process.platform === 'win32')('restarts a module when its session environment is cleared', async () => {
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'node server.js --port 63981' },
    }));
    const detected = await detectDevelopmentRunConfigs(root);
    let pid = 7200;
    let runningPid: number | null = null;
    const broker = vi.fn(async (input: {
      action: 'start' | 'status' | 'terminate';
      environment?: Record<string, string>;
      projectId: string;
    }) => {
      if (input.action === 'start') runningPid = ++pid;
      if (input.action === 'terminate') runningPid = null;
      return {
        accepted: true as const,
        action: input.action,
        error: null,
        logs: [],
        pid: runningPid,
        projectId: input.projectId,
        running: runningPid != null,
      };
    });
    const service = new DevelopmentServerService(broker);

    await service.start('project-env-clear', root, detected.configs[0]!.id, null, {
      environment: { FEATURE_ORDERS: 'enabled' },
    });
    const restarted = await service.start('project-env-clear', root, detected.configs[0]!.id);

    expect(restarted.pid).toBe(7202);
    expect(broker.mock.calls
      .map(([input]) => input.action)
      .filter((action) => action !== 'status'))
      .toEqual(['start', 'terminate', 'start']);
    const startInputs = broker.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action === 'start');
    expect(startInputs[0]?.environment).toEqual({ FEATURE_ORDERS: 'enabled' });
    expect(startInputs[1]?.environment).toBeUndefined();
    await service.stopAll('project-env-clear');
  });

  it('does not restore a stale desktop PID when a status response finishes after stop', async () => {
    if (process.platform !== 'win32') return;
    const root = await temporaryRoot();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js --port 63991' } }));
    await fs.writeFile(path.join(root, 'server.js'), 'setInterval(() => {}, 1000);\n');
    const detected = await detectDevelopmentRunConfigs(root);
    let resolveStatus: ((value: {
      accepted: true;
      action: 'status';
      error: null;
      logs: string[];
      pid: number;
      projectId: string;
      running: true;
    }) => void) | null = null;
    let notifyStatusStarted: (() => void) | null = null;
    const statusStarted = new Promise<void>((resolve) => { notifyStatusStarted = resolve; });
    const broker = vi.fn(async (input: { action: 'start' | 'status' | 'terminate'; projectId: string }) => {
      if (input.action === 'status') {
        notifyStatusStarted?.();
        return await new Promise<{
          accepted: true;
          action: 'status';
          error: null;
          logs: string[];
          pid: number;
          projectId: string;
          running: true;
        }>((resolve) => { resolveStatus = resolve; });
      }
      return {
        accepted: true as const,
        action: input.action,
        error: null,
        logs: [],
        pid: input.action === 'start' ? 7311 : null,
        projectId: input.projectId,
        running: input.action === 'start',
      };
    });
    const service = new DevelopmentServerService(broker);

    await service.start('project-stop-race', root, detected.configs[0]!.id);
    await statusStarted;
    await service.stop('project-stop-race');
    const settleStatus = resolveStatus as unknown as (value: {
      accepted: true;
      action: 'status';
      error: null;
      logs: string[];
      pid: number;
      projectId: string;
      running: true;
    }) => void;
    settleStatus({
      accepted: true,
      action: 'status',
      error: null,
      logs: ['old process still running'],
      pid: 7311,
      projectId: 'project-stop-race',
      running: true,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(service.status('project-stop-race')).toMatchObject({ state: 'idle', pid: null });
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
