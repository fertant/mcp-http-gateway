import {
  GraphQLSchema,
  IntrospectionQuery,
  buildClientSchema,
} from "graphql";
import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import { config } from '../config';

/** ---- Introspection types (minimal) ---- */
type IntrospectionTypeRef = { 
  kind: string; 
  name?: string | null; 
  ofType?: IntrospectionTypeRef | null
};

type IntrospectionField = {
  name: string;
  description?: string | null;
  type?: IntrospectionTypeRef;
  kind?: string;
  args?: Array<{ name: string; type: IntrospectionTypeRef }>;
};

type IntrospectionInputField = {
  name: string;
  description?: string;
  type?: IntrospectionTypeRef;
  path?: string[];
  fieldsPath?: string[];
  inputFields?: IntrospectionInputField[] | null;
};

type IntrospectionType = {
  kind: string;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: IntrospectionInputField[] | null;
  path?: string[];
  where?: IntrospectionInputField;
  pagination?: IntrospectionInputField[];
  mcpParams?: IntrospectionInputField[];
};

type Introspection = {
  __schema?: {
    queryType?: IntrospectionType,
    mutationType?: IntrospectionType,
    types?: IntrospectionType[];
  };
};

type GraphType = {
  query: IntrospectionType[],
  mutation: IntrospectionType[],
}

type BuildOptions = {
  rootFieldName: string;
  mcpParams?: IntrospectionInputField[];
  filters?: Record<string, any>;
};

export class Graph {
  graph: GraphType = {query: [], mutation: []};
  types: IntrospectionType[] = [];
  schema: GraphQLSchema;

  constructor(schema: Introspection) {
    // @ts-ignore
    this.schema = buildClientSchema(schema as IntrospectionQuery);
    this.types = schema?.__schema?.types ?? [];
    const queryType = schema?.__schema?.queryType?.name ?? "Query";
    const mutationType = schema?.__schema?.mutationType?.name ?? "Mutation";
    const query = structuredClone(this.types.filter(type => type.name == queryType && type.kind == 'OBJECT').shift());
    const mutation = structuredClone(this.types.filter(type => type.name == mutationType && type.kind == 'OBJECT').shift());
    const pagination: IntrospectionInputField[] = [];
    if (query && query.fields) {
      for (const obj of query.fields) {
        let nodes = this.extractObject((obj as IntrospectionField)?.type as IntrospectionTypeRef);
        if (!nodes) continue;
        this.extractFieldsDependencies(nodes as IntrospectionType, [nodes.name], config.pathDepth);
        let filters: IntrospectionInputField = {name: ''};
        let mcpParams: IntrospectionInputField[] = [];
        const pagination: IntrospectionInputField[] = [];
        if (obj?.args && obj.args.length > 0) {
          const args = obj.args;
          for (const arg of obj?.args || []) {
            if (arg.name == 'where') {
              const filterObj = this.extractObject(arg?.type as IntrospectionTypeRef);
              if (filterObj)
                this.extractFilterDependencies(filterObj as IntrospectionType, [filterObj.name], [], config.pathDepth, mcpParams);
              filters = {
                name: arg?.name || '',
                type: arg.type || '',
                inputFields: filterObj?.inputFields || [],
              }
            }
            else if (this.isScalarField(arg)) {
              pagination.push(arg)
              mcpParams.unshift(arg)
            }
          }
        }
        this.graph.query.push({
          name: obj.name, 
          kind: nodes.kind, 
          description: obj.description, 
          fields: nodes.fields,
          where: filters,
          pagination: pagination,
          mcpParams: mcpParams,
        });
      }
    }
    if (mutation) {
      // Mutations not implemented yet.
      const mutationObjects = mutation.fields;
    }
  }

  isNonNullField(field: IntrospectionField): Boolean {
    return field?.type?.kind == "NON_NULL" || false;
  }
  
  isListField(field: IntrospectionField): Boolean {
    return field?.type?.kind == "LIST" || false;
  }

  isScalarField(field: IntrospectionField): Boolean {
    return field?.type?.kind == "SCALAR" || false;
  }

  isObjectField(field: IntrospectionField): Boolean {
    return field?.type?.kind.includes("OBJECT") || false;
  }

  getFieldType(field: IntrospectionField): IntrospectionTypeRef {
    let type = structuredClone(field.type);
    if (!type) return {kind: "SCALAR"};
    while ((!this.isScalarField({name: '', type: type}) || !this.isObjectField({name: '', type: type})) && type?.ofType) {
      type = type?.ofType;
    }
    return type;
  }

  extractFilterDependencies(
    node: IntrospectionType, 
    path: string[], 
    fields: string[], 
    depth: number, 
    mcpParams: IntrospectionInputField[], 
  ) {
    if (node && node.inputFields) {
      for (let i = 0; i < node.inputFields.length; i++) {
        let filter = node.inputFields[i];
        if (filter.name != 'or' && filter.name != 'and' && filter.name != 'any' && filter?.type?.kind == 'INPUT_OBJECT') {
          let filterObj;
          filterObj = this.extractObject(filter.type as IntrospectionTypeRef);
          if (filterObj) {
            if (
              filterObj.inputFields && 
              !path.includes(filterObj.name) && 
              depth > 0
            ) {
              let nodePath = structuredClone(path);
              nodePath.push(filterObj.name);
              let fieldsPath = structuredClone(fields);
              fieldsPath.push(filter.name)
              this.extractFilterDependencies(filterObj, nodePath, fieldsPath, depth - 1, mcpParams);
            }
            filterObj.name = filter.name;
            filterObj.description = filter.description;
            (filterObj as IntrospectionInputField).type = filter.type;
            filterObj.path = path;
            node.inputFields[i] = filterObj as IntrospectionInputField;
          }
        }
        if (
          filter.name != 'or' && 
          filter.name != 'and' && 
          filter.name != 'any' && 
          (
            this.isNonNullField(filter) || 
            this.isListField(filter) || 
            this.isScalarField(filter)
          )
        ) {
          let name: string = '';
          if (node.name.includes('OperationFilterInput') && fields.length > 0) {
            // For the operational filter include only one parameter 'eq'.
            let reverseIdx = 1;
            name = fields[fields.length-reverseIdx];
            while(name.includes('OperationFilterInput')) {
              reverseIdx++;
              name = fields[fields.length-reverseIdx];
            }
            name = fields.join('_')
          }
          else if (fields.length > 0) {
            name = fields.join('_');
            name = `${name}_${filter.name}`;
          }
          else {
            name = filter.name;
          }
          let type = this.getFieldType(filter);
          let description = fields.join(' -> ');
          if (mcpParams.filter(param => param.name == name).length == 0)
            mcpParams.push({
              name: name, 
              type: type, 
              path: path, 
              fieldsPath: fields, 
              description: `Filter parameter with next hierarcy of fields "${description}" and type of "${type.name}"`
            });
        }
      }
    }
  }

  extractFieldsDependencies(nodes: IntrospectionType, path: string[], depth: number) {
    if (nodes && nodes.fields) {
      for (let i = 0; i < nodes.fields.length; i++) {
        let node = nodes.fields[i];
        node.type = (this.isNonNullField(node) || this.isListField(node)) ? this.getFieldType(node) : node.type;
        if (this.isObjectField(node)) {
          const nodeObj = this.extractObject(node.type as IntrospectionTypeRef);
          if (nodeObj) {
            if (
              nodeObj.fields && 
              !node.name.includes('parent') && 
              !path.includes(nodeObj.name) && 
              depth > 0
            ) {
              let nodePath = structuredClone(path);
              nodePath.push(nodeObj.name);
              this.extractFieldsDependencies(nodeObj, nodePath, depth - 1);
            }
            nodeObj.name = node.name;
            nodeObj.description = node.description;
            nodeObj.path = path;
            nodes.fields[i] = nodeObj;
          }
        }
      }
    }
  }

  extractObject(obj: IntrospectionTypeRef): IntrospectionType | undefined {
    if ((obj.kind == "NON_NULL" || obj.kind == "LIST") && obj?.ofType) {
      return this.extractObject(obj.ofType)
    }
    else {
      return this.getInternalObject(obj.name as string, obj.kind);
    }
  }
  
  getInternalObject(name: string, kind: string) {
    return structuredClone(this.types.filter(object => object.name == name && object.kind == kind).shift());
  }

  // ---------- Filter normalization from mcpParams ----------
  buildWhereGraph(params: IntrospectionInputField[], filters: Record<string, any>, pointer = 0) {
    let filteredParams = (params.length > Object.keys(filters).length) ? 
                            params.filter((param) => Object.keys(filters).includes(param.name)) :
                            params;
    if (filteredParams == undefined || filteredParams.length == 0) return '';
    // Prepare filter for scalar first level params.
    let firstLevelFilterString = '';
    for (const param of filteredParams) {
      if (param?.fieldsPath?.length == 0 || false) {
        const filterStr = this.normalizeWhere(param, filters[param.name]).slice(1, -1);
        firstLevelFilterString = firstLevelFilterString.length > 0 ? `${firstLevelFilterString}, ${filterStr}` : filterStr;
      }
    }
    filteredParams = filteredParams.filter((param) => param.fieldsPath && param.fieldsPath.length > 0);

    if (filteredParams.length == 0) {
      return `{${firstLevelFilterString}}`;
    }
    else if (filteredParams.length == 1) {
      const key = Object.keys(filters).filter((paramName) => filteredParams[0].name.includes(paramName)).shift();
      if (key && key in filters) {
        filteredParams[0].fieldsPath = filteredParams[0].fieldsPath?.slice(pointer);
        filteredParams[0].path = filteredParams[0].path?.slice(pointer);
        const filterStr = this.normalizeWhere(filteredParams[0], filters[key]);
        return firstLevelFilterString.length > 0 ? `{${firstLevelFilterString}, ${filterStr.slice(1, -1)}}` : filterStr;
      }
    }
    else if (filteredParams.length > 1) {
      let idx = -1;
      let whereString = '';
      while (true) {
        idx++;
        const keys = new Set<string>();
        for (const param of filteredParams) {
          if (param.fieldsPath == undefined) continue
          if (param.fieldsPath.length <= idx) continue
          keys.add(param?.fieldsPath[idx]);
        }
        // All parameters on a common Graph path. Go to the next level. filteredParams at this point should be at least 2.
        if (keys.size == 1) continue;
        if (keys.size > 1) {
          for (const item of keys) {
            const paramsCopy = structuredClone(filteredParams.filter((param) => {
                                                                        if (param.fieldsPath && idx in param.fieldsPath) {
                                                                          return param.fieldsPath[idx] == item;
                                                                        } else {
                                                                          return false;
                                                                        }
                                                                      }));
            const filterStr = this.buildWhereGraph(paramsCopy, filters, idx).slice(1, -1)
            whereString = whereString.length > 0 ? `${whereString}, ${filterStr}` : filterStr;
          }
        }
        const commonPath = filteredParams[0]?.fieldsPath?.slice(0,idx) || [];
        whereString = `{ ${whereString} }`;
        while (commonPath.length > 0) {
          const filter = commonPath.pop();
          whereString = `{ ${filter}: ${whereString} }`
        }
        return firstLevelFilterString.length > 0 ? `{${firstLevelFilterString}, ${whereString.slice(1, -1)}}` : whereString;
      }
    }
    return '';
  }

  // ---------- Normalize single branch of filter branch ----------
  normalizeWhere(param: IntrospectionInputField, value: string | boolean) {
    let where: string = '';
    let paramObj = structuredClone(param);
    if (paramObj?.path) {
      const lastObject = paramObj?.path.at(-1);
      if (lastObject?.includes('OperationFilterInput')) {
        if (lastObject.includes('Boolean')) {
          where = `{ eq: ${value} }`
        } else {
          where = `{ eq: "${value}" }`
        }
      }
    }
    if (paramObj.fieldsPath) {
      while (paramObj.fieldsPath.length > 0) {
        const filter = paramObj.fieldsPath.pop();
        where = `{ ${filter}: ${where} }`
      }
    }
    if (where.length < 1 && this.isScalarField(paramObj)) {
      if (paramObj.type?.name == 'String') {
        where = `{ ${paramObj.name}: "${value}" }`
      } else {
        where = `{ ${paramObj.name}: ${value} }`
      }
    }
    return where;
  }

  selectionForType(obj: IntrospectionType,): string {
    if (obj?.fields == undefined) return '';
    const parts: string[] = [];
    if (obj.name == 'edges') {
      obj.fields = obj.fields.filter((item) => this.isScalarField(item))
    }
    for (const field of obj.fields) {
      if (this.isNonNullField(field) || this.isListField(field)) {
        field.type = this.getFieldType(field);
      }
      if (this.isScalarField(field)) {
        parts.push(field.name);
      } else if ((field as IntrospectionType)?.fields != undefined) {
        const subParts = this.selectionForType(field as IntrospectionType);
        if (subParts.length > 0)
          parts.push(`${field.name} { ${subParts} }`);
      }
    }
    return parts?.join(' ') || '';
  }

  // ---------- Main builder ----------
  buildQueryForRoot(options: BuildOptions) {
    const {
      rootFieldName,
      mcpParams,
      filters = {},
    } = options;

    const itemObject = this.graph.query.filter((item) => item.name == rootFieldName).shift();
    let selections = '';
    if (itemObject) {
      selections = this.selectionForType(itemObject);
    }

    // Process pagination parameters first.
    let pagination = '';
    for (const key in filters) {
      const pageItems = itemObject?.pagination?.filter((page) => page.name == key) || [];
      if (pageItems.length > 0) {
        if (pageItems[0]?.type?.name == 'Int') {
          const value = parseInt(filters[key]);
          pagination += `${key}: ${value} `;
        }
        else if (pageItems[0]?.type?.name == 'String') {
          pagination += `${key}: "${filters[key]}" `;
        }
        delete filters[key];
      }
    }

    let where = '';
    if (mcpParams) {
      where = this.buildWhereGraph(mcpParams, filters)
    }
    if (where.length > 0) {
      where = `where: ${where}`
    }
  
    const queryName = `Get_${rootFieldName}`;
    const query = `query ${queryName} {${rootFieldName} (${where} ${pagination}) {${selections}}}`.trim();
  
    return JSON.stringify({ query: query});
  }

  async requestData(rootFieldName: string, header: Record<string, any>, filters: Record<string, any>, mcpParams: IntrospectionInputField[]) {
    const query = this.buildQueryForRoot({
      rootFieldName: rootFieldName,
      mcpParams: mcpParams,
      filters: filters,
    });

    header['Content-Type'] = 'application/json';
    const requestConfig: AxiosRequestConfig = {
        method: 'POST',
        url: config.targetApiBaseUrl,
        params: [],
        headers: header,
        data: query,
        // Validate status to handle non-2xx as resolved promises
        validateStatus: (status: number) => status >= 200 && status < 500, // Handle 4xx as well
    };
    
    try {
      const response = await axios(requestConfig);
      console.error(`API response received: Status ${response.status}`);

      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          statusCode: response.status,
          data: response.data,
        };
      } else {
        // Handle 4xx client errors reported by the API
        console.error(`API returned client error ${response.status}:`, response.data);
        return {
          success: false,
          statusCode: response.status,
          error: `API Error ${response.status}: ${JSON.stringify(response.data)}`,
          data: response.data // Optionally include error data
        };
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error(`API call failed: ${axiosError.message}`, axiosError.response?.data || axiosError.code);

      if (axiosError.response) {
        // Errors during the request setup or >= 500 if validateStatus wasn't broad enough
        return {
          success: false,
          statusCode: axiosError.response.status || 500,
          error: `API Error ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data) || axiosError.message}`,
          data: axiosError.response.data
        };
      } else {
        // Network error, DNS error, etc.
        return {
          success: false,
          statusCode: 503, // Service Unavailable or similar
          error: `Network or request setup error: ${axiosError.message}`,
        };
      }
    }
  }

}
