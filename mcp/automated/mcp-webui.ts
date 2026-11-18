import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { ensureLogin } from "../mcp-setup";

dotenv.config({ path: path.resolve(__dirname, "mcp.env") });

const storageStatePath = path.resolve(".auth/mcp_auth.json");
const prompt = fs.readFileSync(
  path.resolve("mcp/virtualstudent.prompt"),
  "utf8",
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

/**
 * Based on https://modelcontextprotocol.io/docs/develop/build-client#node
 */

class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.mcp = new Client({ name: "playwright-theia-mcp", version: "1.0.0" });
  }

  async connectToServer() {
    this.transport = new StdioClientTransport({
      command: "npx",
      args: [
        "@playwright/mcp@latest",
        `--storage-state=${storageStatePath}`,
        "--isolated",
      ],
    });

    this.mcp.connect(this.transport);

    const toolsResult = await this.mcp.listTools();
    this.tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    console.log(
      "Connected to MCP server with tools:",
      this.tools.map((t) => t.name),
    );
  }

  async processQuery(query: string) {
    /**
     * Process a query using Claude and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    // Initial Claude API call
    const response = await this.anthropic.messages.create({
      model: "claude-opus-4-0",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // Process response and handle tool calls

    for (const content of response.content) {
      if (content.type === "text") {
        console.log("LLM thinking: " + content.text);
      } else if (content.type === "tool_use") {
        // Execute tool call
        const toolName = content.name;
        const toolArgs = content.input as { [x: string]: unknown } | undefined;

        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        console.log(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
        );

        // Continue conversation with tool results
        messages.push({
          role: "user",
          content: result.content as string,
        });

        // Get next response from Claude
        const response = await this.anthropic.messages.create({
          model: "claude-opus-4-0",
          max_tokens: 1000,
          messages,
        });

        console.log(
          response.content[0].type === "text" ? response.content[0].text : "",
        );
      }
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}

(async () => {
  const client = new MCPClient();
  try {
    await ensureLogin();
    await client.connectToServer();
    await client.processQuery(prompt);
    console.log("=== LLM Finished ===\n");
  } finally {
    await client.cleanup();
    process.exit(0);
  }
})();
