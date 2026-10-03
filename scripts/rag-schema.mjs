/** Public record schema and private content-index schema. No raw source fields. */
export function buildRagRecordSchema() {
  const nullableString = { type: ['string','null'] };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://zaai.com/astro-aeo/schema/rag-record-v1.schema.json',
    title: 'Astro-AEO RAG record v1', type: 'object', additionalProperties: false,
    required: ['version','kind','id','pageId','chunkIndex','text','tokenCount','tokenizer','hash','pageHash','headings','oversized','metadata'],
    properties: {
      version: { const: 1 }, kind: { enum: ['page','chunk'] },
      id: { type: 'string', pattern: '^page:[a-f0-9]{64}(?::chunk:[0-9]{4,})?$' },
      pageId: { type: 'string', pattern: '^page:[a-f0-9]{64}$' }, chunkIndex: { type: ['integer','null'], minimum: 1 },
      text: { type: 'string' }, tokenCount: { type: 'integer', minimum: 0 },
      tokenizer: { type: 'object', additionalProperties: false, required: ['name','version','approximate'],
        properties: { name: {type:'string',minLength:1}, version: {type:'string',minLength:1}, approximate: {type:'boolean'} } },
      tokenizerFallback: { type:'object',additionalProperties:false,required:['reason'],properties:{reason:{enum:['preflight','count']}} },
      hash: {type:'string',pattern:'^sha256:[a-f0-9]{64}$'}, pageHash: {type:'string',pattern:'^sha256:[a-f0-9]{64}$'},
      headings: {type:'array',items:{type:'string'}}, oversized: {type:'boolean'},
      metadata: {type:'object',required:['url','pathname','title','locale','language','contentVersion','versionGroup','section'],
        propertyNames:{pattern:'^[A-Za-z][A-Za-z0-9_]{0,63}$'},
        additionalProperties:{type:['string','number','boolean','null']},
        properties: {url:{type:'string',format:'uri'},pathname:{type:'string',pattern:'^/'},title:{type:'string'},
          locale:nullableString,language:nullableString,contentVersion:nullableString,versionGroup:nullableString,section:nullableString} },
    },
    allOf: [{if:{properties:{kind:{const:'page'}}},then:{properties:{chunkIndex:{type:'null'}}},else:{properties:{chunkIndex:{type:'integer',minimum:1}}}}],
  };
}
export function buildRagIndexSchema() {
  return {
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:'https://zaai.com/astro-aeo/schema/rag-index-v1.schema.json',title:'Astro-AEO private RAG index v1',
    type:'object',additionalProperties:false,required:['version','buildDigest','inventoryComplete','buildTimeIncomplete','files'],
    properties:{version:{const:1},buildDigest:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'},inventoryComplete:{type:'boolean'},buildTimeIncomplete:{type:'boolean'},
      files:{type:'array',items:{type:'object',additionalProperties:false,required:['file','locale','contentVersion','records','hash'],
        properties:{file:{type:'string',pattern:'^[a-f0-9]+\\.jsonl$'},locale:{type:['string','null']},contentVersion:{type:['string','null']},records:{type:'integer',minimum:0},hash:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'}}}}},
  };
}
export const serializeRagRecordSchema = () => `${JSON.stringify(buildRagRecordSchema(),null,2)}\n`;
export const serializeRagIndexSchema = () => `${JSON.stringify(buildRagIndexSchema(),null,2)}\n`;
