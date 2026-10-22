import { expect, test } from '@/playwright/suite';
import { applyStorageConfig } from '../lib/playwright/mock-factory.js';
import { gotoEntryHome, openSettingsDialog } from '../lib/playwright/amr.js';
import { T } from '@/timeouts';

test('REA can be selected and saved from real MCP settings and its handover skill is discoverable', async ({page}, testInfo) => {
  test.setTimeout(T.xlong);
  await applyStorageConfig(page);
  const original = await (await page.request.get('/api/mcp/servers')).json();
  expect(original.templates.find((t: {id:string})=>t.id==='rea')).toMatchObject({command:'npx',args:['-y','rea-agents@6.7.0','--mcp']});
  const skills = await (await page.request.get('/api/skills')).json();
  expect(JSON.stringify(skills)).toContain('legacy-system-handover');
  await gotoEntryHome(page);
  const dialog = await openSettingsDialog(page);
  await dialog.getByRole('button', {name:'External MCP',exact:true}).click();
  await dialog.getByRole('button',{name:'Add server',exact:true}).click();
  await dialog.getByPlaceholder('Filter by name, transport, capability…').fill('REA');
  await dialog.getByRole('button').filter({hasText:'REA (Reverse Engineer Anything)'}).click();
  await dialog.getByRole('button',{name:'Expand this MCP server',exact:true}).click();
  await expect(dialog.locator('input[value="npx"]')).toBeVisible();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect.poll(async()=>{
    const saved=await (await page.request.get('/api/mcp/servers')).json();
    return saved.servers.some((s:{templateId?:string;enabled:boolean})=>s.templateId==='rea'&&s.enabled);
  }).toBe(true);
  await page.screenshot({path:testInfo.outputPath('rea-settings.png'),fullPage:true});
  await page.reload();
  const saved=await (await page.request.get('/api/mcp/servers')).json();
  expect(saved.servers.find((s:{templateId?:string})=>s.templateId==='rea')).toMatchObject({enabled:true,command:'npx',args:['-y','rea-agents@6.7.0','--mcp']});
});
