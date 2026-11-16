import { ResourceScope, ScopeClosingError, type ScopeReport } from '../runtime/resourceScope';
// =============================================================================
// CHANNEL ROUTER
// Central hub that manages all messaging channels and routes messages
// between external platforms and the Silhouette agent.
// =============================================================================

import { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from './channelInterface';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';
import { sessionManager } from '../gateway/sessionManager';
import { gateway } from '../gateway/wsGateway';
import { nervousSystem } from '../../services/connectionNervousSystem';
import { identityService, UserRole } from '../../services/identityService';
import { channelIngress } from '../../services/security/ingressEnvelope';

// ─── Channel Router ──────────────────────────────────────────────────────────

interface ChannelGeneration {
    scope:ResourceScope;
    connecting?:Promise<void>;
    closing?:Promise<ScopeReport>;
    enabled:boolean;
}
interface ChannelRecord { channel:IChannel; generation?:ChannelGeneration }
class ChannelRouter {
    private readonly operations=new ResourceScope('channel-router');
    private readonly records=new Map<string,ChannelRecord>();
    private readonly pendingChannels:Array<{name:string,action:string,reason:string}>=[];
    private pend(name:string,action:string,reason:string):void {
        if(!this.pendingChannels.some(p=>p.name===name&&p.action===action&&p.reason===reason)) this.pendingChannels.push({name,action,reason});
        this.operations.recordDiagnostic('channel-pending:'+name,new Error(reason),'UNCLASSIFIED','UNVERIFIED');
    }
    private readonly channelReports:Array<{name:string,report:ScopeReport,sdk?:unknown}>=[];
    public getLifecycleStatus(){return {pending:this.pendingChannels,reports:this.channelReports,diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    public shutdown(){return this.operations.close();}
    private closeGeneration(record:ChannelRecord,g:ChannelGeneration):Promise<ScopeReport> {
        if(!g.closing) {g.enabled=false;g.closing=g.scope.close();}
        return g.closing;
    }
    private async generation(record:ChannelRecord):Promise<ChannelGeneration> {
        const prior=record.generation;
        if(prior?.scope.accepting)return prior;
        if(prior) {
            const report=await this.closeGeneration(record,prior);
            this.pend(record.channel.name,'RECONNECT','Prior SDK generation release is unverified; no duplicate connection may be created');
            if(!report.fullyReleased)throw new Error('Prior channel generation not fully released: '+record.channel.name);
        }
        this.operations.assertAccepting();
        // Recheck after await so concurrent connectAll cannot create two generations.
        if(record.generation?.scope.accepting)return record.generation;
        const g:ChannelGeneration={scope:new ResourceScope('channel:'+record.channel.name),enabled:true};
        record.generation=g;
        g.scope.own({name:'channel-sdk:'+record.channel.name,stopIntake:()=>{
            g.enabled=false;nervousSystem.unregister('channel:'+record.channel.name);
            record.channel.beginShutdown?.();
        },close:async()=>{
            // Real accepted connect/send/router callbacks drain BEFORE disconnect.
            // The SDK's hidden handlers, reconnect and typing are NOT certified.
            await record.channel.disconnect();
            return {state:'UNVERIFIED',detail:'disconnect returned; SDK internals/reconnect/typing and registered onMessage hook release unverified'};
        }});
        this.operations.own({name:'channel-generation:'+record.channel.name,stopIntake:()=>{this.closeGeneration(record,g);},close:async()=>{
            const report=await this.closeGeneration(record,g);
            this.channelReports.push({name:record.channel.name,report,sdk:record.channel.getLifecycleStatus?.()});
            for(const d of report.diagnostics)this.operations.recordDiagnostic(record.channel.name+':'+d.resource,d.error,d.disposition,d.originalCapability);
            if(report.state==='FAILED')throw new AggregateError(report.failures.map(f=>f.error),'Channel generation failed');
            return {state:'UNVERIFIED',detail:'Channel application receipt retained; actual SDK internal drain remains unverified'};
        }});
        return g;
    }
    private connectChannel(record:ChannelRecord,g:ChannelGeneration):Promise<void> {
        if(g.connecting)return g.connecting;
        g.connecting=g.scope.run('channel-connect',async()=>{
            g.scope.assertAccepting();
            await record.channel.connect();
            if(!g.scope.accepting)throw new ScopeClosingError('channel:'+record.channel.name);
            if(!record.channel.isConnected()) {
                this.pend(record.channel.name,'VERIFY_READINESS','connect returned without connected status; SDK readiness is not established');
                throw new Error('Channel connect returned without readiness: '+record.channel.name);
            }
            nervousSystem.register({id:'channel:'+record.channel.name,name:'Channel: '+record.channel.name,type:'LOCAL_SERVICE',isRequired:false,
                checkHealth:async()=>g.scope.accepting&&record.channel.isConnected(),
                reconnect:async()=>{
                    if(!g.scope.accepting||!this.operations.accepting)return false;
                    if(record.channel.isConnected())return true;
                    this.pend(record.channel.name,'RECONNECT','SDK connection readiness lost; reconnect requires attributable generation drain, not another connect() over existing SDK');
                    return false;
                }});
            systemBus.emit(SystemProtocol.CONNECTION_RESTORED,{service:'channel:'+record.channel.name,timestamp:Date.now()},'ChannelRouter');
        });
        return g.connecting;
    }

    private channels: Map<string, IChannel> = new Map();
    private messageHandlers: MessageHandler[] = [];
    private chatToSession: Map<string, string> = new Map(); // chatId → sessionId

    // ── Registration ──────────────────────────────────────────────────────

    /**
     * Register a channel implementation.
     */
    register(channel:IChannel):void {
        this.operations.assertAccepting();
        const old=this.records.get(channel.name);
        if(old?.channel===channel)return;
        if(old)throw new Error('Channel name already owned: '+channel.name);
        const record:ChannelRecord={channel};
        this.records.set(channel.name,record);this.channels.set(channel.name,channel);
        let removeHook:void|(()=>void);
        const remove=()=>{if(typeof removeHook==='function')removeHook();};
        this.operations.own({name:'channel-hook:'+channel.name,stopIntake:remove,close:()=>{
            remove();return typeof removeHook==='function'?{state:'RELEASED'}:{state:'UNVERIFIED',detail:'Legacy channel returned no hook removal receipt; callback fenced only'};
        }});
        try { removeHook=channel.onMessage(async msg=>{
            const g=record.generation;
            if(!this.operations.accepting||!g?.enabled||!g.scope.accepting)return;
            await g.scope.run('channel-incoming',()=>this.handleIncoming(msg));
        }); } catch(error) { this.operations.recordFailure('channel-hook-registration:'+channel.name,error); throw error; }
    }
    async connectAll():Promise<void> {
        return this.operations.run('connectAll',async()=>{
            const results=await Promise.allSettled([...this.records.values()].map(async record=>{
                const g=await this.generation(record);
                try {await this.connectChannel(record,g);}
                catch(error){
                    g.scope.recordDiagnostic('channel-connect',error,'DEGRADED_FALLBACK','UNAVAILABLE');
                    if(this.operations.accepting)systemBus.emit(SystemProtocol.CONNECTION_LOST,{service:'channel:'+record.channel.name,error:String(error)},'ChannelRouter');
                    throw error;
                }
            }));
            const connected=results.filter(r=>r.status==='fulfilled').length;
            console.log('[ChannelRouter] Connect operations fulfilled: '+connected+'/'+results.length+'; SDK readiness not independently certified');
        });
    }
    async disconnectAll():Promise<void> {
        return this.operations.run('disconnectAll',async()=>{
            const reports=await Promise.all([...this.records.values()].filter(r=>r.generation).map(r=>this.closeGeneration(r,r.generation!)));
            const failures=reports.flatMap(r=>r.failures.map(f=>f.error));
            if(failures.length)throw new AggregateError(failures,'Channel disconnect failures');
        });
    }

    // ── Incoming Message Handling ─────────────────────────────────────────

    /**
     * Handle an incoming message from any channel.
     * Routes it to the appropriate session and forwards to the agent.
     */
    private async handleIncoming(msg: IncomingMessage): Promise<void> {

        try {
            // 0. Lookup User Identity and Role
            const user = identityService.getUserByChannelId(msg.channel, msg.senderId);
            msg.role = user ? user.role : UserRole.GUEST;

            // 1. Get or create a session for this chat
            const sessionId = this.getOrCreateSessionForChat(msg);

            // 2. Add message to session history
            sessionManager.addMessage(sessionId, {
                role: 'user',
                content: msg.text,
                metadata: {
                    channel: msg.channel,
                    agentId: msg.senderId,
                    userRole: msg.role, // Track role in history
                },
            });

            // 3. Forward to SystemBus for orchestrator pickup.
            // The `role` field below is an ADVISORY claim for display only.
            // Authenticated identity travels exclusively in the signed
            // ingress envelope (issued here, AFTER identity resolution) and is
            // verified at the consumption point (services/security/
            // channelAuthority.ts). The envelope binds this exact message
            // (content digest, stable id, channel+sender) to the resolved
            // principal and this conversation; it grants NO effect authority
            // by itself.
            const envelope = channelIngress.issue({
                channel: msg.channel,
                senderId: msg.senderId,
                messageId: msg.id,
                principalId: user ? user.id : null,
                conversationId: sessionId,
                content: msg.text ?? '',
            });
            systemBus.emit(SystemProtocol.USER_MESSAGE, {
                sessionId,
                message: msg.text,
                messageId: msg.id,
                channel: msg.channel,
                senderId: msg.senderId,
                senderName: msg.senderName,
                chatId: msg.chatId,
                isGroup: msg.isGroup,
                media: msg.media,
                timestamp: msg.timestamp,
                isReadOnly: msg.isReadOnly,
                role: msg.role, // Advisory claim only; authority = envelope
                envelope,
            }, `channel:${msg.channel}`);

            // 4. Notify WS clients about the channel message
            gateway.broadcast('channel.message', {
                channel: msg.channel,
                sessionId,
                senderId: msg.senderId,
                text: msg.text,
                timestamp: msg.timestamp,
            });

            // 5. Call registered handlers
            for (const handler of this.messageHandlers) {
                try {
                    await handler(msg);
                } catch (err) {
            this.operations.recordDiagnostic('handleIncoming',err,'DEGRADED_FALLBACK','UNAVAILABLE');

                    console.error(`[ChannelRouter] Handler error:`, err);
                }
            }

            console.log(`[ChannelRouter] 📨 ${msg.channel}: ${msg.senderName ?? msg.senderId} → session ${sessionId.slice(0, 8)}`);
        } catch (err) {
            this.operations.recordDiagnostic('handleIncoming',err,'DEGRADED_FALLBACK','UNAVAILABLE');

            console.error(`[ChannelRouter] Failed to handle incoming message:`, err);
        }
    }

    private getOrCreateSessionForChat(msg: IncomingMessage): string {
        const chatKey = `${msg.channel}:${msg.chatId}`;
        const sessionId = this.chatToSession.get(chatKey);

        if (sessionId) {
            const session = sessionManager.getSession(sessionId);
            if (session && session.status !== 'closed') {
                return sessionId;
            }
        }

        // Create new session
        const session = sessionManager.createSession({
            channel: msg.channel,
            clientId: msg.senderId,
            title: `${msg.channel} - ${msg.senderName ?? msg.senderId}`,
        });

        this.chatToSession.set(chatKey, session.id);
        return session.id;
    }

    // ── Outgoing Messages ─────────────────────────────────────────────────

    /**
     * Send a message via a specific channel.
     */
    async send(channelName: string, message: OutgoingMessage): Promise<string | null> {
        if(!this.operations.accepting)return null;

        const channel = this.channels.get(channelName);
        if (!channel) {
            console.error(`[ChannelRouter] Channel "${channelName}" not found`);
            return null;
        }
        if (!channel.isConnected()) {
            console.error(`[ChannelRouter] Channel "${channelName}" is not connected`);
            return null;
        }

        if (message.media && message.media.length > 0) {
            console.log(`[ChannelRouter] 📤 Sending ${message.media.length} media items to ${channelName}`);
        }

        const record=this.records.get(channelName);
        const g=record?.generation;
        if(!g?.scope.accepting)return null;
        return g.scope.run('channel-send',()=>channel.send(message));
    }

    /**
     * Reply to a message using the same channel it came from.
     */
    async reply(originalMessage: IncomingMessage, text: string, media?: OutgoingMessage['media']): Promise<string | null> {

        return this.send(originalMessage.channel, {
            chatId: originalMessage.chatId,
            text,
            replyToId: originalMessage.id,
            media,
        });
    }

    /**
     * Broadcast a message to all connected channels (or specific ones).
     */
    async broadcast(text: string, channelNames?: string[]): Promise<void> {

        const targets = channelNames
            ? channelNames.map(n => this.channels.get(n)).filter(Boolean) as IChannel[]
            : Array.from(this.channels.values());

        await Promise.allSettled(
            targets.filter(ch => ch.isConnected()).map(ch => {
                // For broadcast, we need a chatId — this is channel-specific
                // Each channel should handle broadcast differently
                console.log(`[ChannelRouter] Broadcast to ${ch.name}: ${text.slice(0, 50)}...`);
                return Promise.resolve(); // Placeholder — channels define their own broadcast
            })
        );
    }

    // ── External Handlers ─────────────────────────────────────────────────

    /**
     * Register a handler for all incoming messages.
     */
    onMessage(handler:MessageHandler):()=>void {
        this.operations.assertAccepting();this.messageHandlers.push(handler);
        return ()=>{const i=this.messageHandlers.indexOf(handler);if(i>=0)this.messageHandlers.splice(i,1);};
    }

    // ── Status ────────────────────────────────────────────────────────────

    /**
     * Get status of all channels.
     */
    getStatus(): ChannelStatus[] {
        return Array.from(this.channels.values()).map(ch => ch.getStatus());
    }

    /**
     * Get a specific channel by name.
     */
    getChannel(name: string): IChannel | undefined {
        return this.channels.get(name);
    }

    /**
     * List all registered channel names.
     */
    listChannels(): string[] {
        return Array.from(this.channels.keys());
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const channelRouter = new ChannelRouter();
