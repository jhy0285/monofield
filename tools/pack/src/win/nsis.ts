import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackConfig } from "../config.js";
import { pathExists } from "./fs.js";
import { resolveWinUninstallLocalDataRoot } from "./paths.js";
import type { WinPaths } from "./types.js";

const execFileAsync = promisify(execFile);

function escapeNsisString(value: string): string {
  return value.replace(/"/g, '$\\"').replace(/\r?\n/g, "$\\r$\\n");
}

export async function writeNsisInclude(config: ToolPackConfig, paths: WinPaths): Promise<void> {
  const localDataRoot = escapeNsisString(resolveWinUninstallLocalDataRoot(config));
  await mkdir(dirname(paths.nsisIncludePath), { recursive: true });
  await writeFile(
    paths.nsisIncludePath,
    `!include LogicLib.nsh
!include nsDialogs.nsh

Var /GLOBAL odRemoveLocalData
Var /GLOBAL odRemoveLocalDataCheckbox
Var /GLOBAL odLocalDataRoot

LangString OD_REMOVE_LOCAL_DATA_TITLE 1033 "Remove local data"
LangString OD_REMOVE_LOCAL_DATA_TITLE 2052 "删除本地数据"
LangString OD_REMOVE_LOCAL_DATA_TITLE 1028 "刪除本機資料"
LangString OD_REMOVE_LOCAL_DATA_TITLE 1046 "Remover dados locais"
LangString OD_REMOVE_LOCAL_DATA_TITLE 1049 "Удалить локальные данные"
LangString OD_REMOVE_LOCAL_DATA_TITLE 1065 "حذف داده‌های محلی"

LangString OD_REMOVE_LOCAL_DATA_HINT 1033 "Choose whether the uninstaller should remove MonoField data stored on this computer."
LangString OD_REMOVE_LOCAL_DATA_HINT 2052 "请选择卸载程序是否删除此电脑上保存的 MonoField 数据。"
LangString OD_REMOVE_LOCAL_DATA_HINT 1028 "請選擇解除安裝程式是否刪除此電腦上儲存的 MonoField 資料。"
LangString OD_REMOVE_LOCAL_DATA_HINT 1046 "Escolha se o desinstalador deve remover os dados do MonoField armazenados neste computador."
LangString OD_REMOVE_LOCAL_DATA_HINT 1049 "Выберите, должен ли деинсталлятор удалить данные MonoField, сохраненные на этом компьютере."
LangString OD_REMOVE_LOCAL_DATA_HINT 1065 "انتخاب کنید که حذف‌کننده داده‌های MonoField ذخیره‌شده در این رایانه را حذف کند یا نه."

LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 1033 "Remove local MonoField data:"
LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 2052 "删除本地 MonoField 数据："
LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 1028 "刪除本機 MonoField 資料："
LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 1046 "Remover dados locais do MonoField:"
LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 1049 "Удалить локальные данные MonoField:"
LangString OD_REMOVE_LOCAL_DATA_CHECKBOX 1065 "حذف داده‌های محلی MonoField:"

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.OpenDesignLocalDataPage un.OpenDesignLocalDataPageLeave
!macroend

Function un.OpenDesignLocalDataPage
  StrCpy $odRemoveLocalData "1"
  StrCpy $odLocalDataRoot "${localDataRoot}"
  nsDialogs::Create 1018
  Pop $0
  \${If} $0 == error
    Abort
  \${EndIf}

  \${NSD_CreateLabel} 0 0 100% 24u "$(OD_REMOVE_LOCAL_DATA_HINT)"
  Pop $0
  \${NSD_CreateCheckbox} 0 34u 100% 36u "$(OD_REMOVE_LOCAL_DATA_CHECKBOX) $odLocalDataRoot"
  Pop $odRemoveLocalDataCheckbox
  \${NSD_Check} $odRemoveLocalDataCheckbox
  nsDialogs::Show
FunctionEnd

Function un.OpenDesignLocalDataPageLeave
  \${NSD_GetState} $odRemoveLocalDataCheckbox $0
  \${If} $0 == \${BST_CHECKED}
    StrCpy $odRemoveLocalData "1"
  \${Else}
    StrCpy $odRemoveLocalData "0"
  \${EndIf}
FunctionEnd

!macro customUnInstall
  \${If} $odLocalDataRoot == ""
    StrCpy $odLocalDataRoot "${localDataRoot}"
  \${EndIf}
  \${If} $odRemoveLocalData != "0"
    DetailPrint "Removing local MonoField data: $odLocalDataRoot"
    RMDir /r "$odLocalDataRoot"
  \${EndIf}
!macroend
`,
    "utf8",
  );
}


async function listChildDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

async function findNsisLanguageDirectories(root: string, depth = 4): Promise<string[]> {
  const languageDir = join(root, "Contrib", "Language files");
  if (await pathExists(join(languageDir, "Farsi.nlf"))) return [languageDir];
  if (depth <= 0) return [];
  const children = await listChildDirectories(root);
  const nested = await Promise.all(children.map((child) => findNsisLanguageDirectories(child, depth - 1)));
  return nested.flat();
}

export async function ensureNsisPersianLanguageAlias(config: ToolPackConfig): Promise<boolean> {
  const cacheRoots = [
    process.env.ELECTRON_BUILDER_CACHE,
    process.env.LOCALAPPDATA == null ? undefined : join(process.env.LOCALAPPDATA, "electron-builder", "Cache"),
    process.env.APPDATA == null ? undefined : join(process.env.APPDATA, "electron-builder", "Cache"),
    join(config.workspaceRoot, "node_modules", ".cache", "electron-builder"),
    process.env["ProgramFiles(x86)"] == null ? undefined : join(process.env["ProgramFiles(x86)"], "NSIS"),
    process.env.ProgramFiles == null ? undefined : join(process.env.ProgramFiles, "NSIS"),
    "C:\\Program Files (x86)\\NSIS",
    "C:\\Program Files\\NSIS",
  ].filter((entry): entry is string => entry != null && entry.length > 0);
  let updated = false;
  for (const cacheRoot of cacheRoots) {
    for (const languageDir of await findNsisLanguageDirectories(cacheRoot)) {
      let updatedLanguageDir = false;
      const farsiNlf = join(languageDir, "Farsi.nlf");
      const farsiNsh = join(languageDir, "Farsi.nsh");
      const persianNlf = join(languageDir, "Persian.nlf");
      const persianNsh = join(languageDir, "Persian.nsh");
      if ((await pathExists(farsiNlf)) && !(await pathExists(persianNlf))) {
        await cp(farsiNlf, persianNlf);
        updatedLanguageDir = true;
        updated = true;
      }
      if (await pathExists(farsiNsh)) {
        const farsiMessages = await readFile(farsiNsh, "utf8");
        const persianMessages = farsiMessages.replace('LANGFILE "Farsi"', 'LANGFILE "Persian"');
        const existingPersianMessages = await readFile(persianNsh, "utf8").catch(() => null);
        if (existingPersianMessages !== persianMessages) {
          await writeFile(persianNsh, persianMessages, "utf8");
          updatedLanguageDir = true;
          updated = true;
        }
      }
      if (updatedLanguageDir) {
        process.stderr.write(`[tools-pack] added NSIS Persian language alias in ${languageDir}\n`);
      }
    }
  }
  return updated;
}

export async function appendNsisLog(paths: WinPaths, message: string, meta: Record<string, unknown> = {}): Promise<void> {
  await mkdir(dirname(paths.nsisLogPath), { recursive: true });
  await appendFile(paths.nsisLogPath, `${JSON.stringify({ message, meta, timestamp: new Date().toISOString() })}\n`, "utf8");
}

export async function runTimed<T>(timingPath: string, action: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await task();
    await mkdir(dirname(timingPath), { recursive: true });
    await writeFile(timingPath, `${JSON.stringify({ action, durationMs: Date.now() - startedAt, status: "success" }, null, 2)}\n`, "utf8");
    return result;
  } catch (error) {
    await mkdir(dirname(timingPath), { recursive: true });
    await writeFile(
      timingPath,
      `${JSON.stringify({ action, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error), status: "failed" }, null, 2)}\n`,
      "utf8",
    );
    throw error;
  }
}

export type StagedNsisInvocation = {
  args: string[];
  bytes?: number;
  cleanup: () => Promise<void>;
  command: string;
  env?: NodeJS.ProcessEnv;
  sha256?: string;
  staged: boolean;
};

const NSIS_LOCAL_STAGE_RESERVE_BYTES = 64 * 1024 * 1024;

async function hashFileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

export async function stageNsisInvocation(
  command: string,
  args: string[],
  action: "install" | "uninstall",
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): Promise<StagedNsisInvocation> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { args: [...args], cleanup: async () => undefined, command, staged: false };
  }

  // NSIS validates its own executable before entering .onInit. A setup.exe on
  // an SMB/mapped drive can return a short read during that validation even
  // when its stored CRC is correct, which exits with code 2 and no installer
  // log. Run the byte-identical executable from local NTFS instead. Never use
  // /NCRC here: the lifecycle smoke must still reject genuinely corrupt files.
  const env = options.env ?? process.env;
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData == null || localAppData.length === 0) {
    throw new Error("Windows NSIS lifecycle staging requires LOCALAPPDATA so the executable runs from local NTFS");
  }
  const localTempRoot = join(localAppData, "Temp");
  await mkdir(localTempRoot, { recursive: true });
  const sourceMetadata = await stat(command);
  const filesystem = await statfs(localTempRoot);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const requiredBytes = sourceMetadata.size * 2 + NSIS_LOCAL_STAGE_RESERVE_BYTES;
  if (Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
    throw new Error(
      `insufficient local space to validate the NSIS lifecycle: need ${requiredBytes} bytes, available ${availableBytes} bytes in ${localTempRoot}`,
    );
  }
  const stageRoot = await mkdtemp(join(localTempRoot, "monofield-nsis-"));
  const stagedCommand = join(stageRoot, basename(command));
  try {
    const sourceSha256 = await hashFileSha256(command);
    await cp(command, stagedCommand);
    const stagedSha256 = await hashFileSha256(stagedCommand);
    if (sourceSha256 !== stagedSha256) {
      throw new Error(`NSIS staging checksum mismatch for ${command}`);
    }

    const stagedArgs = [...args];
    if (action === "uninstall" && !stagedArgs.some((arg) => arg.startsWith("_?="))) {
      // A staged NSIS uninstaller must be told which original install directory
      // it owns; `_?=` must remain the final argument.
      stagedArgs.push(`_?=${dirname(command)}`);
    }
    return {
      args: stagedArgs,
      bytes: sourceMetadata.size,
      cleanup: async () => {
        await rm(stageRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
      },
      command: stagedCommand,
      env: {
        ...env,
        // Keep NSIS' ns*.tmp extraction tree inside the invocation directory.
        // The finally cleanup below then removes both the staged executable and
        // any extraction residue, including interrupted smoke runs.
        TEMP: stageRoot,
        TMP: stageRoot,
        TMPDIR: stageRoot,
      },
      sha256: sourceSha256,
      staged: true,
    };
  } catch (error) {
    await rm(stageRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 }).catch(() => undefined);
    throw error;
  }
}

export async function invokeNsis(paths: WinPaths, command: string, args: string[], action: "install" | "uninstall"): Promise<void> {
  const invocation = await stageNsisInvocation(command, args, action);
  await appendNsisLog(paths, `${action} started`, {
    args: invocation.args,
    bytes: invocation.bytes,
    command,
    launchCommand: invocation.command,
    sha256: invocation.sha256,
    staged: invocation.staged,
    tempRoot: invocation.env?.TEMP,
  });
  try {
    const directoryArg = invocation.args.at(-1);
    if (
      process.platform === "win32"
      && (directoryArg?.startsWith("/D=") || directoryArg?.startsWith("_?="))
    ) {
      await execFileAsync(invocation.command, invocation.args, {
        cwd: dirname(invocation.command),
        env: invocation.env,
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    } else {
      await execFileAsync(invocation.command, invocation.args, {
        cwd: dirname(invocation.command),
        env: invocation.env,
        windowsHide: true,
      });
    }
    await appendNsisLog(paths, `${action} finished`, { code: 0, command });
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown };
    await appendNsisLog(paths, `${action} failed`, {
      code: failure.code,
      command,
      stderr: typeof failure.stderr === "string" ? failure.stderr : undefined,
      stdout: typeof failure.stdout === "string" ? failure.stdout : undefined,
    });
    throw error;
  } finally {
    await invocation.cleanup().catch(async (error) => {
      await appendNsisLog(paths, `${action} staging cleanup failed`, {
        command,
        error: error instanceof Error ? error.message : String(error),
        launchCommand: invocation.command,
      });
    });
  }
}
