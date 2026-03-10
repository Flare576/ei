# ComfyUI Workflow Field Introspection

## Problem Statement

ComfyUI workflows use arbitrary node IDs (like `"57:27"`) and field paths that aren't discoverable from the workflow JSON alone:

```json
{
  "57:27": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "a beautiful mountain landscape"
    }
  }
}
```

Without introspection, we can't:
- Validate that `"text"` is a valid field for `CLIPTextEncode`
- Know that `"text"` is a STRING type
- Build auto-completion UI for workflow fields
- Provide helpful error messages when fields are invalid

## Solution: ComfyUI REST API

✅ **ComfyUI provides full workflow introspection via REST API.**

### API Endpoints

| Endpoint | Purpose | Response Size |
|----------|---------|---------------|
| `GET /object_info` | Get schema for ALL node types | ~50-100KB |
| `GET /object_info/{NodeClass}` | Get schema for ONE node type | ~1-5KB |

### Example Response

```json
{
  "CLIPTextEncode": {
    "display_name": "CLIP Text Encode",
    "category": "conditioning",
    "input": {
      "required": {
        "text": ["STRING", {"multiline": true, "default": ""}],
        "clip": ["CLIP"]
      }
    },
    "output": ["CONDITIONING"]
  }
}
```

### Field Schema Format

**Simple types:**
```json
"field": ["STRING"]
"field": ["INT"]
"field": ["FLOAT"]
```

**With constraints:**
```json
"steps": ["INT", {"default": 20, "min": 1, "max": 10000}]
"cfg": ["FLOAT", {"default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1}]
```

**Enum/dropdown:**
```json
"sampler_name": [["euler", "euler_ancestral", "heun", "dpm_2", ...]]
```

**Complex types (node connections):**
```json
"model": ["MODEL"]
"clip": ["CLIP"]
"latent": ["LATENT"]
```

## Implementation Strategy

### Phase 1: Schema Fetch & Cache (MVP)

```typescript
// web/src/comfyui-schema.ts
export interface NodeSchema {
  display_name: string;
  category: string;
  input: {
    required: Record<string, FieldSchema>;
    optional?: Record<string, FieldSchema>;
  };
  output: string[];
}

type FieldSchema = [string] | [string, FieldConstraints] | [string[]];

interface FieldConstraints {
  default?: any;
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
}

let schemaCache: Record<string, NodeSchema> | null = null;

export async function fetchNodeSchemas(baseUrl: string): Promise<Record<string, NodeSchema>> {
  if (schemaCache) return schemaCache;
  
  const response = await fetch(`${baseUrl}/object_info`);
  if (!response.ok) {
    throw new Error(`Failed to fetch node schemas: ${response.statusText}`);
  }
  
  schemaCache = await response.json();
  return schemaCache;
}
```

### Phase 2: Field Validation

```typescript
// web/src/comfyui-schema.ts
export function validateWorkflowField(
  workflow: any,
  nodeId: string,
  fieldName: string,
  value: any,
  schemas: Record<string, NodeSchema>
): ValidationError | null {
  const node = workflow[nodeId];
  if (!node?.class_type) return { error: "Node not found" };
  
  const schema = schemas[node.class_type];
  if (!schema) return { error: `Unknown node type: ${node.class_type}` };
  
  const fieldSchema = schema.input.required[fieldName] || schema.input.optional?.[fieldName];
  if (!fieldSchema) return { error: `Unknown field: ${fieldName}` };
  
  // Parse field schema
  const [type, constraints] = Array.isArray(fieldSchema[0]) 
    ? ["ENUM", { options: fieldSchema[0] }]
    : fieldSchema;
  
  // Type validation
  if (type === "INT" && !Number.isInteger(value)) {
    return { error: "Value must be an integer" };
  }
  
  if (type === "FLOAT" && typeof value !== "number") {
    return { error: "Value must be a number" };
  }
  
  if (type === "STRING" && typeof value !== "string") {
    return { error: "Value must be a string" };
  }
  
  // Constraint validation
  if (constraints) {
    if (constraints.min !== undefined && value < constraints.min) {
      return { error: `Value must be >= ${constraints.min}` };
    }
    if (constraints.max !== undefined && value > constraints.max) {
      return { error: `Value must be <= ${constraints.max}` };
    }
    if (constraints.options && !constraints.options.includes(value)) {
      return { error: `Value must be one of: ${constraints.options.join(", ")}` };
    }
  }
  
  return null; // Valid
}
```

### Phase 3: Auto-Completion UI

```typescript
// web/src/components/Settings/WorkflowEditor.tsx
function WorkflowFieldEditor({ workflow, nodeId, fieldName }: Props) {
  const [schemas, setSchemas] = useState<Record<string, NodeSchema>>({});
  
  useEffect(() => {
    fetchNodeSchemas(baseUrl).then(setSchemas);
  }, [baseUrl]);
  
  const node = workflow[nodeId];
  const fieldSchema = schemas[node?.class_type]?.input.required[fieldName];
  
  if (!fieldSchema) return <input type="text" />; // Fallback
  
  const [type, constraints] = fieldSchema;
  
  // Enum field → dropdown
  if (Array.isArray(type)) {
    return (
      <select>
        {type.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  
  // INT/FLOAT → number input with constraints
  if (type === "INT" || type === "FLOAT") {
    return (
      <input 
        type="number"
        min={constraints?.min}
        max={constraints?.max}
        step={constraints?.step || (type === "INT" ? 1 : 0.01)}
      />
    );
  }
  
  // STRING → text/textarea
  if (type === "STRING") {
    return constraints?.multiline 
      ? <textarea rows={5} />
      : <input type="text" />;
  }
  
  // Complex type → read-only (node connection)
  return <div className="readonly-field">Connected to: {value}</div>;
}
```

### Phase 4: User-Friendly Workflow Editor (Future)

Instead of showing raw JSON:
```json
{"57:27": {"inputs": {"text": "..."}}}
```

Show human-readable form:
```
Node: CLIP Text Encode (Prompt)
  Text: [multiline textarea]
  CLIP: [Connected to node 57:30]
```

## Limitations

What introspection **cannot** do:

❌ **Dynamic enum options from remote APIs** — Some fields fetch options from `/api/models` or similar; you must call those separately  
❌ **Complex interdependencies** — "If sampler X, then steps must be divisible by Y" logic not in schema  
❌ **Runtime monkey-patched fields** — Only static `INPUT_TYPES()` introspection  
❌ **Output field names from input types** — You know a field is type `"IMAGE"`, but not which output on the source node provides it

## References

- **ComfyUI Routes Documentation:** https://docs.comfy.org/development/comfyui-server/comms_routes
- **Node Definition Spec:** https://docs.comfy.org/specs/nodedef_json
- **Librarian Research:** See `/tmp/comfyui_introspection_findings.md` for comprehensive analysis

## Current Status

**✅ Research Complete** — ComfyUI fully supports introspection  
**⏳ Implementation Pending** — Schema fetch, validation, and UI generation not yet built

### Next Steps (Post-MVP)

1. Implement `fetchNodeSchemas()` and cache on provider save
2. Add `validateWorkflowField()` to Settings UI workflow editor
3. Show validation errors when user edits workflow JSON
4. Build auto-completion dropdown for enum fields
5. (Future) Replace raw JSON editor with schema-driven form UI

---

**Last Updated:** March 10, 2026  
**Research Agent:** librarian (session: ses_32777b5adffekuLQyba5gyLOyX)
