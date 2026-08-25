// Content fixtures for the "Use MonoField everywhere" guide modal.
//
// Kept as a plain data module (no React imports) so the same source
// feeds both the modal UI and the agent-handoff markdown blob in
// ./agent-guide.ts. Strings here are intentionally English-only
// because they document a developer-facing CLI / HTTP / MCP surface
// — localized labels stay in i18n; this module owns the technical
// content.

export interface CodeSnippet {
  /** Tag shown above the snippet in the UI. */
  label: string;
  /** Optional language hint (used for syntax highlighting + markdown). */
  language: 'bash' | 'json' | 'http' | 'yaml' | 'ts' | 'tsx' | 'text';
  /** Source body. Multi-line allowed; do not include leading/trailing blank lines. */
  body: string;
}

export interface GuideSection {
  /** Stable id used as the React tab key. */
  id: 'overview' | 'cli' | 'mcp' | 'http' | 'skills';
  /** Short tab label. */
  tabLabel: string;
  /** Section heading inside the body. */
  heading: string;
  /** One-paragraph intro under the heading. */
  intro: string;
  /** Bulleted highlights — short value props the user should grasp first. */
  bullets: string[];
  /** Ordered code snippets — typically a "quick start" then deeper examples. */
  snippets: CodeSnippet[];
  /**
   * Optional follow-up footer (e.g. links to deeper docs). Plain text — the
   * UI renders it muted, the markdown blob inlines it as a `>` callout.
   */
  footer?: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'overview',
    tabLabel: 'Overview',
    heading: 'MonoField works wherever your agent works',
    intro:
      'MonoField is more than a window — it is a local privileged daemon ' +
      "(`monofield`) plus a Skills + Design-Systems + Atoms registry. Once it's " +
      'running on your machine, any code agent (Claude Code, Codex, Cursor, ' +
      'OpenCode/openclaw, Hermes, your own script) can drive generations, ' +
      'inspect projects, and produce design artifacts through four ' +
      'interchangeable surfaces.',
    bullets: [
      'CLI — `monofield <command>` for headless scripts, CI, and shell automation.',
      'MCP server — wires MonoField as a Model Context Protocol server so any MCP-capable agent can list skills, run scenarios, and read artifacts.',
      'HTTP API — `http://127.0.0.1:7456/api/*` REST + SSE endpoints; the same surface the web UI uses.',
      'Skills — drop-in `SKILL.md` packs (Claude-compatible) that any agent already on your PATH can invoke without MonoField at all.',
      'Standard artifacts — seed real HTML projects from Skills, bundled default plugins, and community plugin examples before the daemon starts.',
    ],
    snippets: [
      {
        label: 'Start the daemon (and web UI) locally',
        language: 'bash',
        body: 'pnpm tools-dev\n# or, if `monofield` is on your PATH:\nmonofield --port 7456',
      },
      {
        label: 'Confirm it is reachable',
        language: 'bash',
        body: 'curl -s http://127.0.0.1:7456/api/health | jq',
      },
      {
        label: 'Ingest standard artifacts before boot',
        language: 'bash',
        body:
          'pnpm seed:test-projects --offline --data-dir ./.monofield \\\n' +
          '  --decks 2 --webs 2 --default-plugins 3 --community-plugins 3\n' +
          '# Then start MonoField in the shell you normally use for dev:\n' +
          'pnpm tools-dev',
      },
    ],
    footer:
      'MonoField keeps runtime data in its local app-data directory. Set ' +
      '`MONOFIELD_DATA_DIR=~/.monofield` only when you need a custom shared location.',
  },
  {
    id: 'cli',
    tabLabel: 'CLI · monofield',
    heading: 'Drive MonoField from any shell',
    intro:
      'The `monofield` command ships with the daemon and is the same entry point used by ' +
      'Claude Code / Codex when they run a generation. Most subcommands are ' +
      'thin clients that POST to the local daemon, so they work the same ' +
      'whether you launched it via `pnpm tools-dev` or as a packaged app.',
    bullets: [
      '`monofield` (no args) — boots the daemon and opens the web UI.',
      '`monofield media generate ...` — produce image / video / audio bytes through the unified media protocol.',
      '`monofield project create` + `monofield run start` — create a project, send a message, and stream the run.',
      '`monofield plugin install <source>` / `monofield plugin apply <id>` — install and apply community plugins.',
      '`monofield skills list` / `monofield design-systems list` — inspect what is available locally.',
      '`monofield status` / `monofield doctor` — verify daemon health and detect agent CLIs on your PATH.',
    ],
    snippets: [
      {
        label: 'Generate an image (delegates to the configured media provider)',
        language: 'bash',
        body:
          'monofield media generate \\\n' +
          '  --surface image \\\n' +
          '  --model gpt-image-1 \\\n' +
          '  --aspect 1:1 \\\n' +
          '  --prompt "Editorial product shot, soft daylight, muted palette" \\\n' +
          '  --output ./out/hero.png',
      },
      {
        label: 'Use the CLI from a source checkout',
        language: 'bash',
        body:
          'corepack enable\n' +
          'pnpm install\n' +
          'pnpm build:daemon\n' +
          '\n' +
          'export MONOFIELD_NODE_BIN="${MONOFIELD_NODE_BIN:-/opt/homebrew/opt/node@24/bin/node}"\n' +
          'export MONOFIELD_BIN="$PWD/apps/daemon/dist/cli.js"\n' +
          '"$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN" daemon start --headless --serve-web --port 7456',
      },
      {
        label: 'Run a design project headlessly and stream events',
        language: 'bash',
        body:
          'DAEMON_URL=${DAEMON_URL:-http://127.0.0.1:7456}\n' +
          'PROJECT_JSON=$(monofield project create \\\n' +
          '  --name "Investor pitch" \\\n' +
          '  --skill frontend-design \\\n' +
          '  --design-system clean \\\n' +
          '  --json \\\n' +
          '  --daemon-url "$DAEMON_URL")\n' +
          'PROJECT_ID=$(jq -r \'.project.id\' <<<"$PROJECT_JSON")\n' +
          'CONVERSATION_ID=$(jq -r \'.conversationId\' <<<"$PROJECT_JSON")\n' +
          '\n' +
          'monofield run start \\\n' +
          '  --project "$PROJECT_ID" \\\n' +
          '  --conversation "$CONVERSATION_ID" \\\n' +
          '  --agent codex \\\n' +
          "  --message 'A 10-slide investor pitch for a SaaS for design teams' \\\n" +
          '  --daemon-url "$DAEMON_URL" \\\n' +
          '  --follow',
      },
      {
        label: 'Answer a discovery question form from the CLI',
        language: 'bash',
        body:
          'monofield run start \\\n' +
          '  --project "$PROJECT_ID" \\\n' +
          '  --conversation "$CONVERSATION_ID" \\\n' +
          '  --agent codex \\\n' +
          '  --message "[form answers - discovery]\n' +
          '- Audience: Seed-stage investors\n' +
          '- Format: 10-slide pitch deck\n' +
          '- Tone: Confident, concise, product-led\n' +
          '- Constraints: Use clean visuals and include traction placeholders" \\\n' +
          '  --daemon-url "$DAEMON_URL" \\\n' +
          '  --follow',
      },
      {
        label: 'Verify generated files after the stream completes',
        language: 'bash',
        body:
          'monofield files list "$PROJECT_ID" --daemon-url "$DAEMON_URL" --json\n' +
          'monofield files read "$PROJECT_ID" index.html --daemon-url "$DAEMON_URL" | head',
      },
      {
        label: 'Inventory locally available skills and design systems',
        language: 'bash',
        body: 'monofield skills list --json\nmonofield design-systems list --json',
      },
      {
        label: 'Check seeded artifacts through the CLI',
        language: 'bash',
        body:
          'monofield project list --daemon-url http://127.0.0.1:7456\n' +
          'monofield files list <seed-project-id> --daemon-url http://127.0.0.1:7456\n' +
          'monofield files read <seed-project-id> index.html --daemon-url http://127.0.0.1:7456 | head',
      },
      {
        label: 'Verify environment + detected agents (Claude, Codex, Cursor, …)',
        language: 'bash',
        body: 'monofield doctor\nmonofield status --json',
      },
    ],
    footer:
      'All subcommands accept `--daemon-url http://127.0.0.1:<port>` to ' +
      'target a specific running daemon — useful when running a sandboxed ' +
      'second instance for tests. From a source checkout, use ' +
      '`"$MONOFIELD_NODE_BIN" "$MONOFIELD_BIN"` after exporting those variables.',
  },
  {
    id: 'mcp',
    tabLabel: 'MCP server',
    heading: 'Expose MonoField as an MCP server to any coding agent',
    intro:
      'MonoField ships with a Model Context Protocol server (`monofield mcp`) ' +
      'that lets any MCP-capable client — Cursor, Claude Code, Antigravity, ' +
      'VS Code Copilot Chat, openclaw, hermes — discover MonoField tools ' +
      '(list skills, render previews, generate media, run plugins) without ' +
      'shelling out manually. The daemon publishes a ready-to-paste install ' +
      'snippet via `GET /api/mcp/install-info` for each major client.',
    bullets: [
      'Stdio transport — no extra port, the client spawns `monofield mcp` directly.',
      'Auto-discovers the live daemon URL via the local IPC status socket when launched as a sidecar.',
      'Falls back to `--daemon-url http://127.0.0.1:<port>` for plain installs so the MCP process always finds a running daemon.',
      'Pins `MONOFIELD_DATA_DIR` so the spawned MCP process uses the same local data boundary as the daemon.',
    ],
    snippets: [
      {
        label: 'Generic MCP client config (works in Cursor, Claude Code, Codex, …)',
        language: 'json',
        body:
          '{\n' +
          '  "mcpServers": {\n' +
          '    "monofield": {\n' +
          '      "command": "monofield",\n' +
          '      "args": ["mcp", "--daemon-url", "http://127.0.0.1:7456"],\n' +
          '      "env": { "MONOFIELD_DATA_DIR": "~/.monofield" }\n' +
          '    }\n' +
          '  }\n' +
          '}',
      },
      {
        label: 'Or: ask the daemon for the snippet tailored to your install',
        language: 'bash',
        body: 'curl -s http://127.0.0.1:7456/api/mcp/install-info | jq',
      },
      {
        label: 'Live-artifacts MCP variant (read & refresh dashboards)',
        language: 'bash',
        body: 'monofield mcp live-artifacts',
      },
    ],
    footer:
      'In the MonoField app, open Settings → Integrations to copy a ' +
      'client-specific install command (Cursor, Claude Code, Antigravity, ' +
      'VS Code) instead of editing JSON by hand.',
  },
  {
    id: 'http',
    tabLabel: 'HTTP API',
    heading: 'Same REST + SSE surface the web UI uses',
    intro:
      'The local daemon serves an HTTP API at `http://127.0.0.1:7456` (port ' +
      'configurable). Every endpoint the web UI calls is also fair game for ' +
      'your scripts. Streaming endpoints (chat turns, project runs) emit ' +
      'Server-Sent Events with the contract types in `packages/contracts`.',
    bullets: [
      '`GET /api/health` — daemon liveness.',
      '`GET /api/skills` and `GET /api/design-systems` — available registries.',
      '`GET /api/projects` and `POST /api/projects` — list and create projects (POST returns the project + first conversation).',
      '`GET /api/projects/:id/chat` — SSE stream of agent events for a conversation.',
      '`POST /api/plugins/:id/apply` — bind an installed plugin and get its rendered example query + inputs.',
      '`GET /api/agents` — detected code-agent CLIs on your PATH.',
    ],
    snippets: [
      {
        label: 'List installed skills (the agent will use these as templates)',
        language: 'bash',
        body: 'curl -s http://127.0.0.1:7456/api/skills | jq \'.skills[0]\'',
      },
      {
        label: 'Create a project from a prompt (full server-side flow)',
        language: 'bash',
        body:
          'curl -s -X POST http://127.0.0.1:7456/api/projects \\\n' +
          "  -H 'content-type: application/json' \\\n" +
          "  -d '{\n" +
          '    "name": "Hermes test run",\n' +
          '    "metadata": { "kind": "prototype" },\n' +
          '    "pendingPrompt": "A landing page for an AI agent CLI",\n' +
          '    "autoSendFirstMessage": true\n' +
          "  }'",
      },
      {
        label: 'Stream a chat turn (SSE — each line is JSON-Lines compatible)',
        language: 'bash',
        body:
          "curl -N \\\n  -H 'accept: text/event-stream' \\\n" +
          '  http://127.0.0.1:7456/api/projects/<projectId>/chat?conversationId=<convId>',
      },
    ],
    footer:
      'Pure TypeScript types for every request/response live in ' +
      '`packages/contracts` — import them in your script for full ' +
      'autocomplete without wiring a generator.',
  },
  {
    id: 'skills',
    tabLabel: 'Skills & headless',
    heading: 'Drop-in Skills for any agent — even without MonoField running',
    intro:
      'A Skill is a directory with a Claude-compatible `SKILL.md` ' +
      '(YAML front-matter + body). MonoField extends the format with the ' +
      '`monofield:` namespace (`mode`, `preview`, `design_system`, `inputs`, …) so ' +
      'the same artifact can be used both inside MonoField and by a vanilla ' +
      'agent like Claude Code, Codex, openclaw, or hermes. Discovery follows ' +
      'a precedence chain so projects can override their own skills.',
    bullets: [
      'Discovery: `./.claude/skills/` → `./skills/` → `~/.claude/skills/` (project wins).',
      'Symlink one skill into multiple projects to share it without copying.',
      'Each skill can declare connectors, atoms, design-system requirements, and a `preview` example output for the gallery.',
      'Headless: an agent with `monofield` on its PATH can call `monofield skills list` then run any skill; the daemon is optional for read-only flows.',
      '`pnpm seed:test-projects` exercises the same artifact shape with default plugin examples and community plugin examples, then stores the resulting `index.html` projects as reusable test data.',
    ],
    snippets: [
      {
        label: 'Minimal SKILL.md (Claude-compatible front matter + MonoField extras)',
        language: 'yaml',
        body:
          '---\n' +
          'name: editorial-pitch-deck\n' +
          'description: A 10-slide editorial pitch deck — Swiss grid + serif headlines\n' +
          'monofield:\n' +
          '  mode: deck\n' +
          '  preview: ./example.html\n' +
          '  design_system: editorial-mono\n' +
          '  inputs:\n' +
          '    - name: company\n' +
          '      type: string\n' +
          '      required: true\n' +
          '---\n' +
          '\n' +
          '# Editorial pitch deck\n' +
          '\n' +
          'Use Swiss-grid layouts with oversized serif headlines and bold drop caps.\n' +
          'Cover, vision, market, product, traction, team, ask, contact.\n',
      },
      {
        label: 'Symlink a shared skill into a project (cc-switch style)',
        language: 'bash',
        body:
          'mkdir -p .claude/skills\n' +
          'ln -s ~/.claude/skills/editorial-pitch-deck .claude/skills/editorial-pitch-deck',
      },
      {
        label: 'Headless: list skills the daemon sees right now',
        language: 'bash',
        body: 'monofield skills list --json | jq \'.skills[].name\'',
      },
      {
        label: 'Headless artifact fixture bundle',
        language: 'bash',
        body:
          'pnpm seed:test-projects --offline --data-dir ./.monofield \\\n' +
          '  --decks 2 --webs 2 \\\n' +
          '  --default-plugins 3 --community-plugins 3\n' +
          '# Shell 1: start MonoField after ingesting.\n' +
          'pnpm tools-dev\n' +
          '# Shell 2: inspect the produced projects.\n' +
          'monofield project list --json --daemon-url http://127.0.0.1:7456',
      },
    ],
    footer:
      'Spec: `docs/skills-protocol.md` and `docs/agent-adapters.md` cover ' +
      'the full adapter surface (Claude Code, Codex, Cursor, MCP-capable ' +
      'agents, BYOK API fallback) and the per-adapter skill injection ' +
      'strategies.',
  },
];
