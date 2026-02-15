# Task List: Agency Dashboard Implementation

- [x] **Fix System Execution Security Loophole** (Crit)
  - [x] Update `ToolHandler` to route `system_execute_command` through `ActionExecutor`
  - [x] Enforce `SAFE_MODE` / `CONFIRMATION` checks in `ActionExecutor`
- [x] **Implement WebSocket Authentication** (High)
  - [x] Add Token Validation to `wsGateway.ts` (Handshake)
  - [x] Add Token Validation to `terminalWebSocket.ts` (URL Param)
  - [x] Update Frontend `InteractiveTerminal.tsx` to send token
- [x] **Fix Terminal Zombie Processes** (Med)
  - [x] Implement Tree-Kill logic in `TerminalService` (Windows `taskkill /T`, Linux `pkill -P`)
- [x] **Fix Logic Gaps & Cleanup** (Med)
  - [x] Update `Orchestrator` to route media from `toolResults` to User
  - [x] Remove hardcoded `localhost:3005` in `InteractiveTerminal.tsx` (Use Env var)

- [/] **Planning & Analysis**
    - [x] Analyze existing frontend components.
    - [x] Create `PLAN_DE_IMPLEMENTACION_DASHBOARD.md`.

- [x] **Backend Integration (Robustness)**
    - [x] **Phase 1: Service Layer**
        - [x] `ProviderHealthManager.getHealthStats()`: Expose provider states.
        - [x] `LocalVideoService.getQueueStatus()`: Expose render queue.
    - [x] **Phase 2: Data & Types**
        - [x] Update `types.ts` with `ProviderState` and `VideoJob` interfaces (shared).
    - [x] **Phase 3: API Layer**
        - [x] Update `/v1/system/telemetry` to include health/queue stats.
        - [x] Add `POST /v1/inbox/:agentId` endpoint.

- [x] **Frontend Implementation (Aesthetics)**
    - [x] **HealthMonitor Component**: Create `components/HealthMonitor.tsx`.
        - [x] Glassmophic Panels for Gemini/Groq/OpenRouter.
        - [x] Queue Visualization list.
    - [x] **Brief Widget**: Add "Mission Control" input to `Dashboard.tsx`.
    - [ ] **Phase 7: Gmail Clone UI**
        - [/] **Layout**: Create `EmailLayout.tsx` (Sidebar, Split View).
        - [x] **Refactor**: Update `EmailPanel.tsx` to use new layout.
        - [/] **Styles**: Apply glassmorphism and animations.
        - [x] Rich Text/HTML Rendering enabled in `EmailLayout`.
    - [ ] **Phase 8: Librarian Assets Squad**
        - [/] **Squad Definition**: Create `librarianSquad.ts`.
        - [ ] **Integration**: Register in `orchestrator`.
    - [x] **App Integration**:
        - [x] Update `App.tsx` metrics polling.
        - [x] Integrate new components.

- [ ] **Verification**
    - [ ] **Browser Test**: Launch app.
    - [ ] **Circuit Test**: Manually trigger a provider failure (mock) and see red light.
    - [ ] **Mission Test**: Send a brief and verify log/introspect.

- [x] **Phase 5: Capabilities Repair (Memory, Assets, Search)**
    - [x] **Fix Tool Capabilities**: Enable `TOOL_WEB_SEARCH`, `TOOL_IMAGE_GENERATION` in `chatController.ts`.
    - [ ] **Fix Chat Memory**: Investigate why history isn't persisting properly.
    - [ ] **Verify Asset Creation**: Confirm `generate_image` tool works after enabling capabilities.
    - [ ] **Verify Web Search**: Confirm `web_search` tool works after enabling capabilities.
