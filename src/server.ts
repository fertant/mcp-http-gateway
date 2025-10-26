import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getProcessedOpenApi } from './openapiProcessor';
import { mapOpenApiToMcpTools } from './mcpMapper';
import { executeApiCall } from './apiClient';
import type { MappedTool } from './types';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z, ZodTypeAny } from 'zod';
import { JSONSchema7TypeName, JSONSchema7 } from 'json-schema';
import { introspectEndpoint } from "./graphql/introspection";
import { Graph } from "./graphql/buildGraph"
import type { OpenAPIV3 } from 'openapi-types';
import { config } from './config';

const EMPTY_OBJECT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {},
};

function parseSchema(propName: string, propSchema: JSONSchema7, required: boolean, params: Record<string, ZodTypeAny>) {
  const description = propSchema.description as string || `Parameter: ${propName}`;
  
  // Map JSON Schema types to Zod schema types
  let zodSchema;
  const schemaType = Array.isArray(propSchema.type) 
    ? propSchema.type[0] // If type is an array (for nullable union types), use first type
    : propSchema.type;
      
  // Handle different types with proper Zod schemas
  switch (schemaType) {
    case 'integer':
      zodSchema = z.number().int().describe(description);
      break;
    case 'number':
      zodSchema = z.number().describe(description);
      break;
    case 'boolean':
      zodSchema = z.boolean().describe(description);
      break;
    case 'object':
      // For objects, create a more permissive schema
      zodSchema = z.object({}).passthrough().describe(description);
      break;
    case 'array':
      // For arrays, allow any array content
      zodSchema = z.array(z.any()).describe(description);
      break;
    case 'string':
    default:
      zodSchema = z.string().describe(description);
      break;
  }    
  // Make it optional if not required
  params[propName] = required ? zodSchema : zodSchema.optional();
}

// async function getOAPIServer(): Promise<Server> {
async function getOAPIServer(req: Request) {
    console.error('Starting Dynamic OpenAPI MCP Server...');

    // Pull initial request header to propagate it further to original API.
    const headers = req.headers;
    const inputHeader = Object.keys(headers)
        .filter((key) => key.includes('auth') || key.includes('key') || key.includes('api') || key.includes('cookie'))
        .reduce((newObj: any, key) => {
            newObj[key] = headers[key];
            return newObj;
        }, {});
    const headerParameters = Object.entries(inputHeader).map(([key, value]) => ({
            name: key, 
            in: 'header'
        }));
    let openapiSpec;
    try {
        openapiSpec = await getProcessedOpenApi(inputHeader);
    } catch (error) {
        console.error('Failed to initialize OpenAPI specification. Server cannot start.', error);
        process.exit(1);
    }

    let mappedTools: MappedTool[];
    try {
        mappedTools = mapOpenApiToMcpTools(openapiSpec);
        if (mappedTools.length === 0) {
            console.error('No tools were mapped from the OpenAPI spec based on current configuration/filtering.');
            // Decide if the server should run with no tools or exit
        }
    } catch (error) {
        console.error('Failed to map OpenAPI spec to MCP tools. Server cannot start.', error);
        process.exit(1);
    }

    // Construct the server with metadata from OpenAPI spec
    const server = new McpServer({
        name: openapiSpec.info?.title || "OpenAPI to MCP Gateway",
        version: openapiSpec.info?.version || "1.0.0"
    });

    // Add OpenAPI metadata to server capabilities or log it
    if (openapiSpec.info?.description) {
        console.error(`API Description: ${openapiSpec.info.description}`);
        // Note: description is not directly supported in McpServer constructor
        // but we can log it or potentially use it elsewhere
    }

    // Register each tool with the server
    for (const tool of mappedTools) {
        const { mcpToolDefinition, apiCallDetails } = tool;
        console.error(`Registering MCP tool: ${mcpToolDefinition.name}`);

        try {
            // Convert JSON Schema properties to zod schema
            const params: any = {};
            
            if (mcpToolDefinition.inputSchema && mcpToolDefinition.inputSchema.properties) {
                // Loop through all properties and create appropriate Zod schemas based on data type
                for (const [propName, propSchema] of Object.entries(mcpToolDefinition.inputSchema.properties)) {
                    if (typeof propSchema !== 'object') continue;

                    const required = mcpToolDefinition.inputSchema.required?.includes(propName) || false;
                    if (propName == 'requestBody') {
                        for (const [bodyPropName, bodyPropSchema] of Object.entries(propSchema['properties'] as Object)) {
                            const requiredBodyProp = propSchema.required?.includes(propName) || false;
                            parseSchema(bodyPropName, bodyPropSchema, requiredBodyProp, params);
                        }
                    } else {
                        parseSchema(propName, propSchema, required, params);
                    }
                }
            }
            
            // Register the tool using proper MCP SDK format
            server.tool(
                mcpToolDefinition.name,
                `MCP description: ${config.description}. Tool description: ${mcpToolDefinition.description}`,
                params,
                // @ts-ignore
                async (toolParams: any) => {
                    const mcpInputs = { ...toolParams, ...inputHeader };

                    const requestId = 'req-' + Math.random().toString(36).substring(2, 9);
                    console.error(`MCP Tool '${mcpToolDefinition.name}' invoked. Request ID: ${requestId}`);
                    console.error(`Parameters received:`, toolParams);
                    try {
                        // Execute the API call with the provided parameters
                        if (headerParameters && headerParameters.length > 0)
                            apiCallDetails.parameters = [ ...apiCallDetails.parameters, ...headerParameters as OpenAPIV3.ParameterObject[] ];
                        const result = await executeApiCall(apiCallDetails, mcpInputs);
                        
                        if (result.success) {
                            console.error(`[Request ID: ${requestId}] Tool '${mcpToolDefinition.name}' executed successfully.`);
                            const content: Array<{ type: "text"; text: string }> = [
                              {
                                type: "text",
                                text: JSON.stringify(result.data)
                              }
                            ];
                            return { content };
                        } else {
                            console.error(`[Request ID: ${requestId}] Tool '${mcpToolDefinition.name}' execution failed: ${result.error}`);
                            
                            // Map API errors to MCP errors
                            let errorCode = ErrorCode.InternalError;
                            let errorMessage = result.error || `API Error ${result.statusCode}`;
                            
                            if (result.statusCode === 400) {
                                errorCode = ErrorCode.InvalidParams;
                                errorMessage = `Invalid parameters: ${result.error}`;
                            } else if (result.statusCode === 404) {
                                errorCode = ErrorCode.InvalidParams;
                                errorMessage = `Resource not found: ${result.error}`;
                            }
                            
                            throw new McpError(errorCode, errorMessage, result.data);
                        }
                    } catch (invocationError: any) {
                        console.error(`[Request ID: ${requestId}] Error invoking tool:`, invocationError);
                        
                        if (invocationError instanceof McpError) {
                            throw invocationError; // Re-throw known MCP errors
                        }
                        
                        throw new McpError(
                            ErrorCode.InternalError, 
                            `Internal server error: ${invocationError.message}`
                        );
                    }
                }
            );
            
            console.error(`Registered Tool: ${mcpToolDefinition.name}`);
        } catch (registerError) {
            console.error(`Failed to register tool ${mcpToolDefinition.name}:`, registerError);
        }
    }
    return server;
}

// async function getOAPIServer(): Promise<Server> {
async function getGraphQLServer(req: Request) {
  console.error('Starting Dynamic GraphQL MCP Server...');

  // Pull initial request header to propagate it further to original API.
  const headers = req.headers;
  let inputHeader = Object.keys(headers)
    .filter((key) => key.includes('auth') || key.includes('key') || key.includes('api') || key.includes('cookie'))
    .reduce((newObj: any, key) => {
        newObj[key] = headers[key];
        return newObj;
    }, {});
  const apiKey = config.securityCredentials?.[config.securitySchemeName] || config.apiKey;
  if (apiKey) 
    inputHeader = {...inputHeader, ...{"authorization": apiKey}}
  // Apply custom headers from configuration
  if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
    inputHeader = { ...inputHeader, ...config.customHeaders };
  }

  // Construct the server with metadata from GraphQL introspection
  const server = new McpServer({
    name: "GraphQL to MCP Gateway",
    version: "1.0.0"
  });

  // Experimental GraphQL parcing to MCP
  const data = await introspectEndpoint(config.targetApiBaseUrl, inputHeader);
  const graph = new Graph(data);

  // Register each tool with the server
  for (const tool of graph.graph.query) {
    if (config.filter.blacklist.includes(tool.name)) continue
    if (config.filter.whitelist !== null && !config.filter.whitelist.includes(tool.name)) continue
    console.error(`Registering MCP tool: ${tool.name}`);
    
    let params: any = {};
    if (tool?.mcpParams && tool.mcpParams.length > 0) {
      for (const param of tool.mcpParams) {
        if (config.filter.blacklist.includes(`${tool.name}.${param.name}`)) continue
        if (config.filter.whitelist !== null) {
          const filtersList = config.filter.whitelist.filter((item: string) => item.includes('.'));
          if (filtersList.length > 0 && !filtersList.includes(`${tool.name}.${param.name}`)) continue
        }
        if (Object.keys(config.filter.presetParams).includes(param.name)) continue
        const type = param?.type?.name == 'Int' ? 'integer' : param?.type?.name?.toLocaleLowerCase();
        parseSchema(param.name, { description: param?.description || '', type: type as JSONSchema7TypeName }, false, params)
      }
    }
          
    // Register the tool using proper MCP SDK format
    // @ts-ignore
    server.tool(
      tool?.name || '',
      `MCP description: ${config.description}. Tool description: ${tool?.description}`,
      params,
      // @ts-ignore
      async (toolParams: any) => {
        toolParams = {...toolParams, ...config.filter.presetParams};
        const requestId = 'req-' + Math.random().toString(36).substring(2, 9);
        
        try {
          const result = await graph.requestData(tool?.name, inputHeader, toolParams, tool?.mcpParams || []);
          
          if (result.success) {
            console.error(`[Request ID: ${requestId}] Tool '${tool.name}' executed successfully.`);
            const content: Array<{ type: "text"; text: string }> = [
              {
                type: "text",
                text: JSON.stringify(result.data)
              }
            ];
            return { content };
          } else {
            console.error(`[Request ID: ${requestId}] Tool '${tool.name}' execution failed: ${result.error}`);
            
            // Map API errors to MCP errors
            let errorCode = ErrorCode.InternalError;
            let errorMessage = result.error || `API Error ${result.statusCode}`;
            
            if (result.statusCode === 400) {
              errorCode = ErrorCode.InvalidParams;
              errorMessage = `Invalid parameters: ${result.error}`;
            } else if (result.statusCode === 404) {
              errorCode = ErrorCode.InvalidParams;
              errorMessage = `Resource not found: ${result.error}`;
            }
            
            throw new McpError(errorCode, errorMessage, result.data);
          }
        } catch (invocationError: any) {
          console.error(`[Request ID: ${requestId}] Error invoking tool:`, invocationError);
          
          if (invocationError instanceof McpError) {
            throw invocationError; // Re-throw known MCP errors
          }
          
          throw new McpError(
            ErrorCode.InternalError, 
            `Internal server error: ${invocationError.message}`
          );
        }
      }
    );
  }
  return server;
}

const app = express();
app.use(express.json());

// Configure CORS to expose Mcp-Session-Id header for browser-based clients
app.use(cors({
  origin: '*', // Allow all origins - adjust as needed for production
  exposedHeaders: ['mcp-session-Id']
}));

const transports: Record<string, SSEServerTransport> = {};
app.post('/mcp', async (req: Request, res: Response) => {
  // SSE transport init.
  if (config.transport == 'sse') {
    console.log('Received POST request to /mcp');
    
    // Extract session ID from URL query parameter
    // In the SSE protocol, this is added by the client based on the endpoint event
    const sessionId = req.query.sessionId as string | undefined;
    
    if (!sessionId) {
      console.error('No session ID provided in request URL');
      res.status(400).send('Missing sessionId parameter');
      return;
    }
    
    const transport = transports[sessionId];
    if (!transport) {
      console.error(`No active transport found for session ID: ${sessionId}`);
      res.status(404).send('Session not found');
      return;
    }
    
    try {
      // Handle the POST message with the transport
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  }
  // StreamableHTTP transport init.
  if (config.transport == 'stream') {
    // Store transports by session ID
    let server = new McpServer({name: '', version: '1.0.0'});
    if (config.type == 'openapi') {
      server = await getOAPIServer(req);
    }
    else if (config.type == 'graphql') {
      server = await getGraphQLServer(req);
    }
    try {
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        console.log('Request closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }
});

app.get('/mcp', async (req: Request, res: Response) => {
  // SSE transport init.
  if (config.transport == 'sse') {
    // Store transports by session ID
    let server = new McpServer({name: '', version: '1.0.0'});
    if (config.type == 'openapi') {
      server = await getOAPIServer(req);
    }
    else if (config.type == 'graphql') {
      server = await getGraphQLServer(req);
    }
    try {
      // Create a new SSE transport for the client
      // The endpoint for POST messages is '/mcp'
      const transport = new SSEServerTransport('/mcp', res);
        
      // Store the transport by session ID
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;
        
      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        console.log(`SSE transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };
      await server.connect(transport);
      res.on('close', () => {
        console.log('Request closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }
  if (config.transport == 'stream') {
    // StreamableHTTP transport init.
    console.log('Received GET MCP request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }));
  }
});

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});


// Start the server
const PORT = 3001;
app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});