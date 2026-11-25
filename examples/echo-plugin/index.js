import readline from "node:readline";

const tools = [{
  name: "echo",
  description: "Return supplied text exactly as received.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false
  }
}];

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    if (request.method === "tools/list") {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } })}\n`);
      return;
    }
    if (request.method === "tools/call" && request.params?.name === "echo") {
      const text = String(request.params.arguments?.text ?? "");
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text }] } })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: "Unknown method or tool." } })}\n`);
  } catch {
    // A plugin must never write non-protocol diagnostics to stdout.
  }
});
