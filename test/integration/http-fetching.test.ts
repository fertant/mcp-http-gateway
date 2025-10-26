/**
 * Test HTTP fetching for OpenAPI specs and overlays
 */

import { jest } from '@jest/globals';
import { getProcessedOpenApi } from '../../src/openapiProcessor';
import { TestHttpServer } from '../helpers/http-server';
import path from 'path';
import fs from 'fs/promises';

describe('HTTP Fetching Tests', () => {
  // Define test server properties
  const fixturesPath = 'test/fixtures';
  const testPort = 8889;
  const testServer = new TestHttpServer(fixturesPath, { port: testPort });
  
  // Keep track of original environment
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
  
  beforeAll(async () => {
    // Start the test HTTP server
    await testServer.start();
  });
  
  afterAll(async () => {
    // Stop the test HTTP server
    await testServer.stop();
    
    // Restore original environment
    process.env = originalEnv;
    process.argv = originalArgv;
  });
  
  beforeEach(() => {
    // Reset modules before each test
    jest.resetModules();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
  });
  
  it('should fetch OpenAPI spec via HTTP URL', async () => {
    // Set config to use HTTP URL for OpenAPI spec
    const specUrl = testServer.getFileUrl('petstore-openapi.json');
    
    // Mock config module to use our HTTP URL
    jest.doMock('../../src/config', () => ({
      config: {
        specPath: specUrl,
        overlayPaths: [],
        mcpPort: 8080,
        targetApiBaseUrl: undefined,
        apiKey: undefined,
        securitySchemeName: undefined,
        securityCredentials: {},
        customHeaders: {},
        disableXMcp: false,
        filter: {
          whitelist: null,
          blacklist: [],
        },
      }
    }));
    
    // Import the module with our mock applied
    const { getProcessedOpenApi: getProcessedOpenApiWithHttpSpec } = require('../../src/openapiProcessor');
    
    // Fetch and process the OpenAPI spec from HTTP URL
    const openApiSpec = await getProcessedOpenApiWithHttpSpec();
    
    // Verify the spec was loaded correctly
    expect(openApiSpec).toBeDefined();
    expect(openApiSpec.openapi).toBe('3.0.0');
    expect(openApiSpec.info.title).toBe('Petstore API');
    expect(openApiSpec.paths).toBeDefined();
    expect(openApiSpec.paths["/pets"]).toBeDefined();
    expect(openApiSpec.paths["/pets/{petId}"]).toBeDefined();
  });
  
  it('should fetch overlay via HTTP URL', async () => {
    // Set config to use local spec but HTTP URL for overlay
    const localSpecPath = path.resolve(process.cwd(), 'test/fixtures/petstore-openapi.json');
    const overlayUrl = testServer.getFileUrl('petstore-overlay.json');
    
    // Mock config module to use our HTTP URL for overlay
    jest.doMock('../../src/config', () => ({
      config: {
        specPath: localSpecPath,
        overlayPaths: [overlayUrl],
        mcpPort: 8080,
        targetApiBaseUrl: undefined,
        apiKey: undefined,
        securitySchemeName: undefined,
        securityCredentials: {},
        customHeaders: {},
        disableXMcp: false,
        filter: {
          whitelist: null,
          blacklist: [],
        },
      }
    }));
    
    // Import the module with our mock applied
    const { getProcessedOpenApi: getProcessedOpenApiWithHttpOverlay } = require('../../src/openapiProcessor');
    
    // Fetch and process the OpenAPI spec with HTTP overlay
    const openApiSpec = await getProcessedOpenApiWithHttpOverlay();
    
    // Verify the overlay was applied correctly
    expect(openApiSpec).toBeDefined();
    expect(openApiSpec.info.title).toBe('Modified Petstore API');
    expect(openApiSpec.paths["/pets"].get.summary).toBe('List all pets with overlay');
    
    // Verify parameter changes from overlay were applied
    const petIdParam = openApiSpec.paths["/pets/{petId}"].get.parameters.find(
      (p: any) => p.name === 'petId' && p.in === 'path'
    );
    expect(petIdParam).toBeDefined();
    expect(petIdParam.description).toBe('Enhanced pet ID description from overlay');
  });
  
  it('should fetch both spec and overlay via HTTP URL', async () => {
    // Set config to use HTTP URLs for both spec and overlay
    const specUrl = testServer.getFileUrl('petstore-openapi.json');
    const overlayUrl = testServer.getFileUrl('petstore-overlay.json');
    
    // Mock config module to use HTTP URLs for both
    jest.doMock('../../src/config', () => ({
      config: {
        specPath: specUrl,
        overlayPaths: [overlayUrl],
        mcpPort: 8080,
        targetApiBaseUrl: undefined,
        apiKey: undefined,
        securitySchemeName: undefined,
        securityCredentials: {},
        customHeaders: {},
        disableXMcp: false,
        filter: {
          whitelist: null,
          blacklist: [],
        },
      }
    }));
    
    // Import the module with our mock applied
    const { getProcessedOpenApi: getProcessedOpenApiWithHttpUrls } = require('../../src/openapiProcessor');
    
    // Fetch and process both from HTTP URLs
    const openApiSpec = await getProcessedOpenApiWithHttpUrls();
    
    // Verify both spec loading and overlay application worked
    expect(openApiSpec).toBeDefined();
    expect(openApiSpec.openapi).toBe('3.0.0');
    expect(openApiSpec.info.title).toBe('Modified Petstore API');
    expect(openApiSpec.paths["/pets"]).toBeDefined();
    expect(openApiSpec.paths["/pets"].get.summary).toBe('List all pets with overlay');
  });
});
