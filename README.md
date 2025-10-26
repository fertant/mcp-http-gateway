# OpenAPI to MCP Server

A tool that creates MCP (Model Context Protocol) servers from OpenAPI/Swagger specifications or GraphQL Introspection, enabling AI assistants to interact with your APIs. **Create your own [branded and customized MCPs](#customizing-and-publishing-your-own-version)** for specific APIs or services.

## Overview

This project creates a dynamic MCP server that transforms OpenAPI specifications and GraphQL Introspection into MCP tools with filter parameters. It enables seamless integration of REST APIs with AI assistants via the Model Context Protocol, turning any API into an AI-accessible tool. Description for MCP tools and parameters for each tool prepared based on description for API documentation.

## Features

- Dynamic loading of OpenAPI specs from file or HTTP/HTTPS URLs
- Dynamic loading of Introspection Query from API endpoint
- Support for [OpenAPI Overlays](#openapi-overlays) loaded from files or HTTP/HTTPS URLs
- Customizable mapping of OpenAPI operations to MCP tools
- Advanced filtering of operations using glob patterns for both operationId and URL paths
- Whitelist and bracklist of MCP parameters and tools
- Filter parameters preset for hardly discovered parameters or taxonomy preset
- Depth of API discovery for GraphQL API that limits number of fields and filters represented in MCP tools
- Comprehensive parameter handling with format preservation and location metadata
- API authentication handling from configuration or bypassing as a priority Auth key from original request to MCP server.
- OpenAPI metadata (title, version, description) used to configure the MCP server
- Hierarchical description fallbacks (operation description → operation summary → path summary)
- Custom HTTP headers support via environment variables and CLI
- X-MCP header for API request tracking and identification
- Support for custom `x-mcp` extensions at the path level to override tool names and descriptions
- Transport type SSE or Streamable HTTP

## Using with AI Assistants

This tool creates an MCP server that allows AI assistants to interact with APIs defined by OpenAPI specifications or GraphQL Introspection. The primary way to use it is by configuring your AI assistant to run it directly as an MCP tool.

## Configuration

Configuration is managed via environment variables or a JSON configuration file:

### Environment Variables

You can set these in a `.env` file or directly in your environment:

- `TYPE`: Type of the interface: GraphQL or OpenAPI
- `TRANSPORT`: Type of transport deprecated SSE or new StreamableHTTP
- `PATH_DEPTH`: Depth of the parameters discovery for GraphQL
- `OPENAPI_SPEC_PATH`: Path to OpenAPI spec file
- `OPENAPI_OVERLAY_PATHS`: Comma-separated paths to overlay JSON files
- `TARGET_API_BASE_URL`: Base URL for API calls (overrides OpenAPI servers)
- `MCP_WHITELIST_OPERATIONS`: Comma-separated list of operation IDs or URL paths to include (supports glob patterns like `getPet*` or `GET:/pets/*`)
- `MCP_BLACKLIST_OPERATIONS`: Comma-separated list of operation IDs or URL paths to exclude (supports glob patterns, ignored if whitelist used)
- `MCP_PRESET_PARAMS`: Filter parameters preset to predefined option that will be included to all requests
- `API_KEY`: API Key for the target API (if required)
- `SECURITY_SCHEME_NAME`: Name of the security scheme requiring the API Key
- `SECURITY_CREDENTIALS`: JSON string containing security credentials for multiple schemes
- `CUSTOM_HEADERS`: JSON string containing custom headers to include in all API requests
- `HEADER_*`: Any environment variable starting with `HEADER_` will be added as a custom header (e.g., `HEADER_X_API_Version=1.0.0` adds the header `X-API-Version: 1.0.0`)
- `DISABLE_X_MCP`: Set to `true` to disable adding the `X-MCP: 1` header to all API requests
- `CONFIG_FILE`: Path to a JSON configuration file
- `DESCRIPTION`: Short description of the purpose of MCP for LLM to better differentiate it among other tools.

### JSON Configuration

You can also use a JSON configuration file instead of environment variables or command-line options. The MCP server will look for configuration files in the following order:

1. Path specified by `--config` command-line option
2. Path specified by `CONFIG_FILE` environment variable
3. `config.json` in the current directory
4. `openapi-mcp.json` in the current directory
5. `.openapi-mcp.json` in the current directory

Example JSON configuration file:

```json
{
  "spec": "./path/to/openapi-spec.json",
  "overlays": "./path/to/overlay1.json,https://example.com/api/overlay.json",
  "targetUrl": "https://api.example.com",
  "whitelist": "getPets,createPet,/pets/*",
  "blacklist": "deletePet,/admin/*",
  "apiKey": "your-api-key",
  "securitySchemeName": "ApiKeyAuth",
  "securityCredentials": {
    "ApiKeyAuth": "your-api-key",
    "OAuth2": "your-oauth-token"
  },
  "headers": {
    "X-Custom-Header": "custom-value",
    "User-Agent": "OpenAPI-MCP-Client/1.0"
  },
  "disableXMcp": false
}
```

A full example configuration file with explanatory comments is available at `config.example.json` in the root directory.

### Configuration Precedence

Configuration settings are applied in the following order of precedence (highest to lowest):

1. Command-line options
2. Environment variables
3. JSON configuration file

## Development

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd mcp-http-gateway

# Install dependencies
npm install

# Build the project
npm run build
```

### Local Testing

```bash
# Start the MCP server
npm run start

# Development mode with auto-reload
npm run dev
```

### Customizing and Publishing Your Own Version

You can use this repository as a base for creating your own customized OpenAPI/GraphQ to MCP server. This section explains how to fork the repository, customize it for your specific APIs, and publish it as a package.

#### Forking and Customizing

1. **Fork the Repository**:
   Fork this repository on GitHub to create your own copy that you can customize.

2. **Add Your OpenAPI Specs**:
   ```bash
   # Create a specs directory if it doesn't exist
   mkdir -p specs
   
   # Add your OpenAPI specifications
   cp path/to/your/openapi-spec.json specs/
   
   # Add any overlay files
   cp path/to/your/overlay.json specs/
   ```

3. **Configure Default Settings**:
   Create a custom config file that will be bundled with your package:
   ```bash
   # Copy the example config
   cp config.example.json config.json
   
   # Edit the config to point to your bundled specs
   # and set any default settings
   ```

4. **Update package.json**:
   ```json
   {
     "name": "your-custom-mcp-server",
     "version": "1.0.0",
     "description": "Your customized MCP server for specific APIs",
     "files": [
       "dist/**/*",
       "config.json",
       "specs/**/*",
       "README.md"
     ]
   }
   ```

5. **Ensure Specs are Bundled**:
   The `files` field in package.json (shown above) ensures your specs and config file will be included in the published package.

## License

MIT
