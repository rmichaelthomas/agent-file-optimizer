# Example: reading a workspace through the MCP endpoint

The share link also serves a read-only MCP endpoint at `<shareUrl>/mcp`. It is stateless (no session ID), speaks JSON-RPC 2.0 over HTTP POST, and answers with the negotiated protocol version. Currently it returns `2025-03-26`, which the official MCP TypeScript SDK (1.32.2) accepts when it asks for a newer version.

The status of this endpoint is **experimental**. It was checked with one client, the official SDK, in the flow below.

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

- Other MCP clients have not been tested.
- The endpoint does not stream responses or use server-initiated messages.
- Only `read_projection` and `read_original` are exposed as tools. Nothing can write.
