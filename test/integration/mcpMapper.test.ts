import { mapOpenApiToMcpTools } from '../../src/mcpMapper';
import { getProcessedOpenApi } from '../../src/openapiProcessor';
import { testConfig } from '../fixtures/test-config';
import { TestMappedTool } from '../utils/testTypes';
import path from 'path';
import { config } from '../../src/config';

describe('MCP Mapper Integration Tests', () => {
  const originalEnv = { ...process.env };
  let openApiSpec: any;
  const originalConfig = { ...config };

  beforeAll(async () => {
    // Set up environment for tests
    process.env.OPENAPI_FILE_PATH = path.resolve(process.cwd(), testConfig.openApiFile);
    try {
      openApiSpec = await getProcessedOpenApi([]);
    } catch (error) {
      console.error('Error loading OpenAPI spec in beforeAll:', error);
      throw error;
    }
  });

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    process.env.OPENAPI_FILE_PATH = path.resolve(process.cwd(), testConfig.openApiFile);
    // Reset config to original state
    Object.assign(config, originalConfig);
  });

  afterAll(() => {
    // Restore original environment after all tests
    process.env = originalEnv;
    // Restore original config
    Object.assign(config, originalConfig);
  });

  it('should map OpenAPI operations to MCP tools', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    expect(mappedTools).toBeDefined();
    expect(Array.isArray(mappedTools)).toBe(true);
    expect(mappedTools.length).toBe(3); // Based on our sample OpenAPI with 3 operations
    
    // Verify mapped tool structure
    for (const tool of mappedTools) {
      expect(tool).toHaveProperty('mcpToolDefinition');
      expect(tool).toHaveProperty('apiCallDetails');
      
      const { mcpToolDefinition, apiCallDetails } = tool;
      
      // Check MCP tool definition
      expect(mcpToolDefinition).toHaveProperty('name');
      expect(mcpToolDefinition).toHaveProperty('description');
      expect(mcpToolDefinition).toHaveProperty('inputSchema');
      
      // Check API call details
      expect(apiCallDetails).toHaveProperty('method');
      expect(apiCallDetails).toHaveProperty('pathTemplate');
      expect(apiCallDetails).toHaveProperty('serverUrl');
    }
  });

  it('should have consistent parameter mapping', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Get the getPetById tool for testing parameter mapping
    const getPetByIdTool = mappedTools.find(t => t.mcpToolDefinition.name === 'getPetById');
    
    expect(getPetByIdTool).toBeDefined();
    if (getPetByIdTool) {
      const { apiCallDetails, mcpToolDefinition } = getPetByIdTool;
      
      // Verify path parameter is correctly mapped
      expect(apiCallDetails.pathTemplate).toContain('{petId}');
      expect(mcpToolDefinition.inputSchema.properties).toHaveProperty('petId');
      
      // Check if the schema shows it as required
      expect(mcpToolDefinition.inputSchema.required).toContain('petId');

      // Verify parameter location metadata is correctly set
      expect(mcpToolDefinition.inputSchema.properties?.petId).toHaveProperty('x-parameter-location');
      expect((mcpToolDefinition.inputSchema.properties?.petId as any)['x-parameter-location']).toBe('path');
    }
  });

  it('should preserve format and type information', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Get the tool with parameters that have formats
    const listPetsTool = mappedTools.find(t => t.mcpToolDefinition.name === 'listPets');
    
    expect(listPetsTool).toBeDefined();
    if (listPetsTool) {
      const { mcpToolDefinition } = listPetsTool;
      
      // Assuming the 'limit' parameter has a format in the test fixture
      // This checks that format information is preserved
      const limitParam = mcpToolDefinition.inputSchema.properties?.limit;
      expect(limitParam).toBeDefined();
      if (limitParam) {
        // Check type is preserved
        expect(limitParam).toHaveProperty('type');
        // If the parameter has a format in the test data, check it's preserved
        if ((limitParam as any).format) {
          expect(limitParam).toHaveProperty('format');
        }
      }
    }
  });

  it('should include path summary in tool description if available', async () => {
    // First, we create a modified OpenAPI spec with a path summary
    const modifiedSpec = JSON.parse(JSON.stringify(openApiSpec)); // Deep clone
    
    // Add summary to path but not to operation
    if (modifiedSpec.paths && modifiedSpec.paths['/pets/{petId}']) {
      const pathItem = modifiedSpec.paths['/pets/{petId}'];
      const operation = pathItem.get;
      
      // Ensure operation doesn't have summary or description
      delete operation.summary;
      delete operation.description;
      
      // Add summary to the path item
      pathItem.summary = 'Test path summary';
    }
    
    // Map the modified spec to MCP tools
    const mappedTools = mapOpenApiToMcpTools(modifiedSpec) as TestMappedTool[];
    
    // Find the getPetById tool
    const getPetByIdTool = mappedTools.find(t => t.mcpToolDefinition.name === 'getPetById');
    expect(getPetByIdTool).toBeDefined();
    
    if (getPetByIdTool) {
      // Verify the description includes the path summary
      expect(getPetByIdTool.mcpToolDefinition.description).toBe('Test path summary');
    }
  });

  it('should map request and response types correctly', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check the createPet tool for request body mapping
    const createPetTool = mappedTools.find(t => t.mcpToolDefinition.name === 'createPet');
    
    expect(createPetTool).toBeDefined();
    if (createPetTool) {
      const { mcpToolDefinition } = createPetTool;
      
      // Verify request body mapping
      expect(mcpToolDefinition.inputSchema.properties).toBeDefined();
      
      // Check for requestBody property which should contain schema
      expect(mcpToolDefinition.inputSchema.properties?.requestBody).toBeDefined();
      
      // Check if content types are included
      expect((mcpToolDefinition.inputSchema.properties?.requestBody as any)['x-content-types']).toBeDefined();
    }
  });

  it('should correctly map GET operation with query parameters', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    const listPetsTool = mappedTools.find(tool => 
      tool.mcpToolDefinition.name === 'listPets' || 
      (tool.apiCallDetails.operationId && tool.apiCallDetails.operationId === 'listPets')
    );
    
    expect(listPetsTool).toBeDefined();
    expect(listPetsTool?.mcpToolDefinition.name).toBe('listPets');
    expect(listPetsTool?.apiCallDetails.method).toBe('GET');

    if (listPetsTool) {
      // Verify query parameter location metadata
      const limitParam = listPetsTool.mcpToolDefinition.inputSchema.properties?.limit;
      if (limitParam) {
        expect((limitParam as any)['x-parameter-location']).toBe('query');
      }
    }
  });

  it('should correctly map GET operation with path parameters', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    const getPetByIdTool = mappedTools.find(tool => 
      tool.mcpToolDefinition.name === 'getPetById' || 
      (tool.apiCallDetails.operationId && tool.apiCallDetails.operationId === 'getPetById')
    );
    
    expect(getPetByIdTool).toBeDefined();
    expect(getPetByIdTool?.mcpToolDefinition.name).toBe('getPetById');
    expect(getPetByIdTool?.apiCallDetails.method).toBe('GET');
  });

  it('should correctly map POST operation with request body', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    const createPetTool = mappedTools.find(tool => 
      tool.mcpToolDefinition.name === 'createPet' || 
      (tool.apiCallDetails.operationId && tool.apiCallDetails.operationId === 'createPet')
    );
    
    expect(createPetTool).toBeDefined();
    expect(createPetTool?.mcpToolDefinition.name).toBe('createPet');
    expect(createPetTool?.apiCallDetails.method).toBe('POST');
  });

  it('should filter operations based on whitelist with exact matches', async () => {
    // Test with whitelist for exact operationId matches
    config.filter.whitelist = ['listPets', 'getPetById'];
    config.filter.blacklist = [];
    
    let filteredTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check only the expected tools are included
    const toolNames = filteredTools.map(t => t.mcpToolDefinition.name);
    expect(toolNames).toContain('listPets');
    expect(toolNames).toContain('getPetById');
    expect(toolNames).not.toContain('createPet'); // Should be filtered out
    
    // Reset config for other tests
    config.filter.whitelist = null;
    config.filter.blacklist = [];
  });

  it('should filter operations based on blacklist with exact matches', async () => {
    // Test with blacklist config
    config.filter.whitelist = null;
    config.filter.blacklist = ['createPet'];
    
    let filteredTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check excluded tools are not present
    const filteredToolNames = filteredTools.map(t => t.mcpToolDefinition.name);
    expect(filteredToolNames).not.toContain('createPet');
    expect(filteredToolNames).toContain('listPets');
    expect(filteredToolNames).toContain('getPetById');
    
    // Reset config for other tests
    config.filter.whitelist = null;
    config.filter.blacklist = [];
  });

  it('should filter operations using glob patterns for operationId', async () => {
    // Test with glob pattern for operationId
    config.filter.whitelist = ['get*'];
    config.filter.blacklist = [];
    
    let filteredTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check only tools matching the pattern are included
    const toolNames = filteredTools.map(t => t.mcpToolDefinition.name);
    expect(toolNames).toContain('getPetById'); // Should match 'get*'
    expect(toolNames).not.toContain('listPets'); // Shouldn't match 'get*'
    expect(toolNames).not.toContain('createPet'); // Shouldn't match 'get*'
    
    // Reset config for other tests
    config.filter.whitelist = null;
    config.filter.blacklist = [];
  });

  it('should filter operations using glob patterns for URL paths', async () => {
    // Test with glob pattern for URL paths - use the exact path pattern from fixtures
    config.filter.whitelist = ['GET:/pets/{petId}'];
    config.filter.blacklist = [];
    
    let filteredTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check only tools matching the URL pattern are included
    const toolNames = filteredTools.map(t => t.mcpToolDefinition.name);
    expect(toolNames).toContain('getPetById'); // Should match 'GET:/pets/{petId}'
    expect(toolNames).not.toContain('createPet'); // POST method, shouldn't match
    
    // Test with method pattern
    config.filter.whitelist = ['POST:/pets'];
    
    filteredTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Check only POST operations are included
    const postToolNames = filteredTools.map(t => t.mcpToolDefinition.name);
    expect(postToolNames).toContain('createPet'); // Should match 'POST:/pets'
    expect(postToolNames).not.toContain('getPetById'); // GET method, shouldn't match
    expect(postToolNames).not.toContain('listPets'); // GET method, shouldn't match
    
    // Reset config for other tests
    config.filter.whitelist = null;
    config.filter.blacklist = [];
  });

  it('should preserve integer types for parameters', async () => {
    const mappedTools = mapOpenApiToMcpTools(openApiSpec) as TestMappedTool[];
    
    // Find the listPets tool which should have a limit parameter of type integer
    const listPetsTool = mappedTools.find(t => t.mcpToolDefinition.name === 'listPets');
    
    expect(listPetsTool).toBeDefined();
    
    if (listPetsTool) {
      const { mcpToolDefinition } = listPetsTool;
      
      // Check if limit parameter exists
      expect(mcpToolDefinition.inputSchema.properties).toHaveProperty('limit');
      
      // The crucial test: verify the limit parameter is of type integer, not string
      const limitParam = mcpToolDefinition.inputSchema.properties?.limit;
      
      console.log('Limit parameter schema:', JSON.stringify(limitParam, null, 2));
      
      // This should be 'integer', not 'string'
      expect(limitParam).toHaveProperty('type', 'integer');
      
      // Check format is preserved
      expect(limitParam).toHaveProperty('format', 'int32');
    }
  });

  it('should use custom x-mcp extension properties for tool name and description', async () => {
    // Create a modified OpenAPI spec with x-mcp extensions for testing
    const modifiedSpec = JSON.parse(JSON.stringify(openApiSpec)); // Deep clone
    
    // Add x-mcp extension at the operation level
    if (modifiedSpec.paths && modifiedSpec.paths['/pets'] && modifiedSpec.paths['/pets']['get']) {
      modifiedSpec.paths['/pets']['get']['x-mcp'] = {
        name: 'CustomListPets',
        description: 'Custom description for list pets endpoint from x-mcp extension'
      };
    }
    
    // Add x-mcp extension at the path level for a different path
    if (modifiedSpec.paths && modifiedSpec.paths['/pets/{petId}']) {
      modifiedSpec.paths['/pets/{petId}']['x-mcp'] = {
        name: 'CustomPetByIdAPI',
        description: 'Custom path-level description for pet by ID endpoint'
      };
    }
    
    const mappedTools = mapOpenApiToMcpTools(modifiedSpec) as TestMappedTool[];
    
    // 1. Test operation-level extension (has priority)
    const operationExtensionTool = mappedTools.find(tool => 
      tool.apiCallDetails.pathTemplate === '/pets' && 
      tool.apiCallDetails.method === 'GET'
    );
    
    expect(operationExtensionTool).toBeDefined();
    if (operationExtensionTool) {
      // x-mcp extension should override the operationId
      expect(operationExtensionTool.mcpToolDefinition.name).toBe('CustomListPets');
      expect(operationExtensionTool.mcpToolDefinition.description).toBe('Custom description for list pets endpoint from x-mcp extension');
    }
    
    // 2. Test path-level extension
    const pathExtensionTool = mappedTools.find(tool => 
      tool.apiCallDetails.pathTemplate === '/pets/{petId}' && 
      tool.apiCallDetails.method === 'GET'
    );
    
    expect(pathExtensionTool).toBeDefined();
    if (pathExtensionTool) {
      // The path-level x-mcp extension should override both name and description
      expect(pathExtensionTool.mcpToolDefinition.name).toBe('CustomPetByIdAPI');
      expect(pathExtensionTool.mcpToolDefinition.description).toBe('Custom path-level description for pet by ID endpoint');
    }
    
    // 3. Verify that operations without x-mcp extension use default values
    const regularTool = mappedTools.find(tool => 
      tool.apiCallDetails.pathTemplate === '/pets' && 
      tool.apiCallDetails.method === 'POST'
    );
    
    expect(regularTool).toBeDefined();
    if (regularTool) {
      // Should use the original operationId and description
      expect(regularTool.mcpToolDefinition.name).toBe('createPet');
    }
  });
});
