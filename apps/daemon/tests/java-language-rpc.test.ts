import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { JavaLanguageRpc } from "../src/services/java/language-rpc.js";
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "close");
    }
  }
});
describe("Java stdio protocol", () => {
  it("handles split Unicode messages and diagnostic notifications", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        String.raw`
const send=m=>{const b=Buffer.from(JSON.stringify(m));const h=Buffer.from('Content-Length: '+b.length+'\r\n\r\n');process.stdout.write(h);process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),5);};
let b=Buffer.alloc(0);process.stdin.on('data',x=>{b=Buffer.concat([b,x]);while(true){const i=b.indexOf('\r\n\r\n');if(i<0)return;const n=Number(/Content-Length: (\d+)/.exec(b.subarray(0,i).toString())[1]);if(b.length<i+4+n)return;const m=JSON.parse(b.subarray(i+4,i+4+n));b=b.subarray(i+4+n);if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{label:'신호 🚦'}});else if(m.method==='initialized')send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{diagnostics:[]}});}});
`,
      ],
      { stdio: "pipe" },
    );
    children.push(child);
    const notifications: string[] = [];
    const rpc = new JavaLanguageRpc(
      child,
      (method) => notifications.push(method),
      {},
    );
    expect(await rpc.request("initialize", {})).toEqual({ label: "신호 🚦" });
    rpc.notify("initialized", {});
    for (let n = 0; n < 50 && !notifications.length; n++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifications).toEqual(["textDocument/publishDiagnostics"]);
    rpc.close();
  });
  it("times out unanswered requests and rejects pending work when stopped", async () => {
    const child = spawn(process.execPath, ["-e", "process.stdin.resume();"], {
      stdio: "pipe",
    });
    children.push(child);
    const rpc = new JavaLanguageRpc(child, () => {}, {});
    await expect(rpc.request("unknown", {}, 20)).rejects.toThrow("timed out");
    const request = rpc.request("definition", {});
    rpc.close();
    await expect(request).rejects.toThrow("closed");
  });
});
