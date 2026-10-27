# Example: reading a workspace through the MCP endpoint

The share link also serves a read-only MCP endpoint at `<shareUrl>/mcp`. It is stateless (no session ID), speaks JSON-RPC 2.0 over HTTP POST, and answers with the negotiated protocol version. Currently it returns `2025-03-26`, which the official MCP TypeScript SDK (1.32.2) accepts when it asks for a newer version.

The status of this endpoint is **experimental**. It was checked with the clients listed under [Clients checked](#clients-checked), in the flow below.

## Connect and read with the official SDK

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL(`${shareUrl}/mcp`));
const client = new Client({ name: "example", version: "0.0.1" });
await client.connect(transport);

const { resources } = await client.listResources();   // handoff.md, manifest.json, ..., docs/note.md
const handoff = await client.readResource({ uri: resources[0].uri });

const { tools } = await client.listTools();           // read_projection, read_original
const note = await client.callTool({ name: "read_original", arguments: { path: "docs/note.md" } });
```

## The raw exchange

Request:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "example", "version": "0.0.1" } } }
```

Response (abridged):

```json
{ "jsonrpc": "2.0", "id": 1, "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": { "resources": {}, "tools": {} },
    "serverInfo": { "name": "agent-file-optimizer", "version": "0.1.0" },
    "instructions": "This is a stateless, read-only view of a temporary workspace. Read handoff.md first. ..." } }
```

Reading a Markdown original returns text, because the content type is inferred from the extension when the upload did not declare one:

```json
{ "jsonrpc": "2.0", "id": 2, "result": {
    "content": [ { "type": "resource", "resource": {
      "uri": "agent-file://<workspace-id>/original/docs/note.md",
      "mimeType": "text/markdown; charset=utf-8",
      "text": "# Hello\n\nA note for the agent.\n" } } ],
    "isError": false } }
```

## Expiry and revocation

After the window ends or the link is revoked, every MCP request returns HTTP `410` with `{"error":"Share link expired or revoked."}`. Batches are refused, and requests other than POST return `405`.

## What is not covered

- MCP clients other than those listed under [Clients checked](#clients-checked) have not been tested. The MCP Inspector could not be run in the environment used for these checks.
- The server always answers `initialize` with protocol version `2025-03-26`, whatever the client asked for. Every client below negotiated down to it. A client that insists on the exact version it requested would refuse to connect.
- The endpoint does not stream responses or use server-initiated messages.
- Only `read_projection` and `read_original` are exposed as tools. Nothing can write.

## Clients checked

Each ran the same flow against a local copy: connect, `resources/list`, `resources/read` of `handoff.md`, `tools/list`, and `tools/call read_original` for a file in a subfolder.

| Client | Version | Result |
| --- | --- | --- |
| Official MCP TypeScript SDK | 1.32.2 | Works. This one runs in the test suite (`tests/mcp-sdk.test.ts`). |
| Official MCP Python SDK | 1.30.0 | Works. Negotiated `2025-03-26`. |
| Official MCP Python SDK | 2.3.0 | Works, using its higher-level `Client`. |
| Claude Code | 2.1.312 | Works. Given only this server, it read `handoff.md` and a subfolder file and answered questions about both correctly. |
| Raw JSON-RPC with `curl` | n/a | `initialize` (any requested version), a notification (`202`), a batch (refused, as documented), `GET` and `DELETE` (`405`). |

Checked on 27 Oct 2026. Re-run the SDK check with `npm test`.

