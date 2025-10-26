import type { JSONSchema7 } from 'json-schema'; // npm install --save-dev @types/json-schema
import type { OpenAPIV3 } from 'openapi-types'; // Already installed

// Structure to hold processed info for one API operation -> MCP tool
export interface MappedTool {
    mcpToolDefinition: McpToolDefinition;
    apiCallDetails: ApiCallDetails;
}

// Based on MCP SDK structure (simplified for definition)
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: JSONSchema7;
    outputSchema?: JSONSchema7; // Optional but recommended
    annotations?: Record<string, any>;
}

// Details needed to make the actual API call
export interface ApiCallDetails {
    method: string; // GET, POST, PUT, DELETE...
    pathTemplate: string; // e.g., /users/{userId}
    serverUrl: string; // Base URL for this specific call
    parameters: OpenAPIV3.ParameterObject[]; // To help map MCP input back
    requestBody?: OpenAPIV3.RequestBodyObject; // To help map MCP input back
    securityRequirements: OpenAPIV3.SecurityRequirementObject[] | null; // From operation or global spec
    securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>; // Security scheme definitions from OpenAPI components
}

// Representing the parsed and processed OpenAPI spec
// Using `any` for now, ideally use types from a parser library or openapi-types
// export type ProcessedOpenAPI = OpenAPIV3.Document; // Using openapi-types
export type ProcessedOpenAPI = any; // Using 'any' from swagger-parser for simplicity here

// Structure for API client result
export interface ApiClientResponse {
    success: boolean;
    statusCode: number;
    data?: any;
    error?: string;
    headers?: any;
}

// MCP Content types based on the SDK schema
export type McpTextContent = {
    type: "text";
    text: string;
};

export type McpImageContent = {
    type: "image";
    data: string;
    mimeType: string;
};

export type McpAudioContent = {
    type: "audio";
    data: string;
    mimeType: string;
};

export type McpResourceContent = {
    type: "resource";
    resource: {
        text: string;
        uri: string;
        mimeType?: string;
    } | {
        uri: string;
        blob: string;
        mimeType?: string;
    };
};

export type McpContent = McpTextContent | McpImageContent | McpAudioContent | McpResourceContent;

export type McpToolResult = {
    content: McpContent[];
    _meta?: Record<string, unknown>;
};