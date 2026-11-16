#!/usr/bin/env python3
"""Finite source/dependency identity inspection only. No product imports or evaluation."""
from pathlib import Path
import sys,json,hashlib,re
H=lambda b:hashlib.sha256(b).hexdigest()
mode=sys.argv[1];root=Path(sys.argv[2]);checks=[]
def require(name,condition):
 if not condition:raise ValueError(name)
 checks.append(name)
if mode=='source':
 expected={'server/index.ts': '965cbbda13bd2e9df409774d6ad649b9be6efaaec009d9f6cd4eadcfd381e84e', 'server/app.ts': 'dde8201c255d5f6c7b21c85d34d6a95159a543e1110b81bef6b0342ac56720ba', 'server/mcp/mcpServer.ts': '42c519ddd52e0882a612f06309e059b141999d88590aae0f67640b8339f25f4f'}
 for name,digest in expected.items():require('EXACT_'+name,H((root/name).read_bytes())==digest)
 app=(root/'server/app.ts').read_text();index=(root/'server/index.ts').read_text();wrapper=(root/'server/mcp/mcpServer.ts').read_text()
 require('ONE_EXISTING_SINGLETON',wrapper.count('export const mcpWrapper = new MCPWrapper();')==1 and 'new MCPWrapper('not in app+index)
 require('ONE_APP_INIT_AND_MOUNT',app.count('mcpWrapper.initialize();')==1 and app.count('mcpWrapper.mount(app);')==1 and 'mcpWrapper'not in index)
 require('GLOBAL_AUTH_BEFORE_MCP_BEFORE_STATIC_AND_404',app.index('app.use(authMiddleware);')<app.index('mcpWrapper.initialize();')<app.index('mcpWrapper.mount(app);')<app.index("app.use('/uploads'")<app.index('// Serve production React app build static files.')<app.index('// ─── 404 HANDLER'))
 require('CORS_AND_LIMITER_BEFORE_AUTH',app.index('app.use(cors<Request>')<app.index('app.use(globalLimiter);')<app.index('app.use(authMiddleware);'))
 require('SYNCHRONOUS_REGISTRATION_DECLARATIONS','public initialize(): void {'in wrapper and 'public mount(app: Application): void {'in wrapper and 'public async mount'not in wrapper)
 require('ACTUAL_STATIC_KEY_SERVICE_IMPORT','import { apiKeyService } from "../../services/apiKeyService";'in wrapper and 'await import("../../services/apiKeyService.ts")'not in wrapper)
 require('GENERIC_10MB_AND_EXACT_NATIVE_PARSER_OWNER',"const parseJsonBody = express.json({ limit: '10mb' });"in app and "req.method === 'POST' && /^\/mcp\/messages\/?$/i.test(req.path)"in app and 'await this.transport.handlePostMessage(req, res);'in wrapper and 'handlePostMessage(req, res, req.body)'not in wrapper)
 require('SHARED_TRANSPORT_ARCHITECTURE_UNCHANGED','private transport: SSEServerTransport | null = null;'in wrapper and 'this.transport = new SSEServerTransport("/mcp/messages", res);'in wrapper and 'await this.server.connect(this.transport);'in wrapper)
 require('MANAGED_AUTH_AND_PERMISSIONS_REMAIN',all(text in wrapper for text in ["req.headers.authorization","apiKeyService.validateKey(apiKey)","apiKeyService.hasPermission(keyData, 'tools:read')","apiKeyService.hasPermission(keyData, 'tools:execute')"]))
 # Test this source-only expected language, not Express execution or equivalence.
 require('EXPECTED_DEFAULT_ROUTE_SPELLINGS',all(re.fullmatch(r'/mcp/messages/?',s,re.I)is not None for s in ['/mcp/messages','/MCP/MESSAGES','/mcp/messages/']))
 require('EXPECTED_NONROUTE_SPELLINGS',all(re.fullmatch(r'/mcp/messages/?',s,re.I)is None for s in ['/mcp/messages/extra','/mcp/messages//','/v1/mcp/messages']))
elif mode=='dependencies':
 lock=json.loads(Path(sys.argv[3]).read_text());require('UNCHANGED_MAIN_LOCK',H(Path(sys.argv[3]).read_bytes())=='5545703d69f821bc68765948f91a91cd14ec782835dd7839f0099f0bebbf63f3')
 for name in ['@modelcontextprotocol/sdk','typescript']:
  want=lock['packages']['node_modules/'+name]['version'];actual=json.loads((root/name/'package.json').read_text())['version'];require('INSTALLED_'+name+'_MATCHES_EXACT_LOCK',actual==want)
 require('SDK_1251_NOT_1322',json.loads((root/'@modelcontextprotocol/sdk/package.json').read_text())['version']=='1.25.1')
 require('SDK_NATIVE_SSE_BYTES',(H((root/'@modelcontextprotocol/sdk/dist/esm/server/sse.js').read_bytes())=='df83053679bac89202e5b36d16515220d9c081d0b72a719b5d4bf065801e07c8'))
else:raise ValueError('UNKNOWN_INSPECTION_MODE')
print('MCP_INGRESS_SOURCE_INSPECTION '+json.dumps({'schema':1,'mode':mode,'checks':checks,'status':'IDENTITIES_AND_LEXICAL_SHAPE_ONLY_NOT_RUNTIME','fullProductAccepted':False},separators=(',',':')))
