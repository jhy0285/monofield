import type { VerificationRun } from "@open-design/contracts";
/** Translate actual module command coordinates into the root catalog.
 * Source hashes, outcomes, time and receipt ID remain the original evidence.
 */
export function workspaceVerificationReceipt(
  run: VerificationRun,
  projectPath: string,
): VerificationRun {
  if (projectPath === ".") return run;
  if (run.projectPath !== projectPath)
    throw new Error("Verification receipt module does not match");
  return {
    ...run,
    steps: run.steps.map((step) => ({
      ...step,
      check: {
        ...step.check,
        id: `${projectPath}::${step.check.id}`,
        source: `${projectPath}/${step.check.source}`,
        projectPath,
      },
    })),
  };
}
