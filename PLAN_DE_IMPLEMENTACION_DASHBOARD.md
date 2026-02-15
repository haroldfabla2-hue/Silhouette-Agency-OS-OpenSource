# Implementation Plan - Agency Dashboard (Frontend)

## Goal Description
Build a "State of the Art" Agency Dashboard in the frontend (`/src`) to visualize the "Backend Nervioso" (Dynamic Agency Swarm). This includes integration with the System Bus, Circuit Breakers, and Media Queues, using Rich Aesthetics (Glassmorphism, Animations) as requested.

## User Review Required
> [!IMPORTANT]
> This plan assumes the backend endpoints for `Circuit Breaker` and `Media Queue` status are efficiently accessible via `/v1/system/telemetry` or need to be added. I will verify this during implementation.

## Proposed Changes

### Frontend Components (`/components`)

#### [MODIFY] [Dashboard.tsx](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/components/Dashboard.tsx)
-   **Add Task Management**: Integrate a "Brief Sender" widget that posts to the Agency Inbox.
-   **Refresh**: Update visual style to match "State of the Art" glassmorphism.

#### [NEW] [HealthMonitor.tsx](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/components/HealthMonitor.tsx)
-   **Circuit Breaker Visualization**: Display status of Gemini, OpenRouter, Groq (Active/Suspended/Recovery).
-   **Media Queue Monitor**: Visualize the size and progress of the `LocalVideoService` render queue.
-   **Integrate into SystemControl**: Or add as a widget on the main Dashboard.

#### [MODIFY] [IntrospectionHub.tsx](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/components/IntrospectionHub.tsx)
-   **Refine Visualization**: Ensure "Thoughts" and "Intuition" streams are smooth and visually stunning.
-   **System Bus Integration**: Verify it listens to the correct SSE/Websocket events for "Wake-on-LAN" signals.

#### [MODIFY] [App.tsx](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/App.tsx)
-   **State Management**: Add hooks to fetch Provider Health and Media Queue states.
-   **Navigation**: Ensure deeper linking to the new views.

### Backend Services (Robust Integration)

#### [MODIFY] [services/providerHealthManager.ts](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/services/providerHealthManager.ts)
-   **Add Method**: `public getHealthStats(): Record<string, ProviderState>`
-   **Purpose**: Return the full map of provider states (Gemini, OpenRouter, Groq) so the frontend can show green/red lights.

#### [MODIFY] [services/media/localVideoService.ts](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/services/media/localVideoService.ts)
-   **Add Method**: `public getQueueStatus(): VideoJob[]`
-   **Purpose**: Return the current render queue for visualization.

#### [MODIFY] [server/index.ts](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/server/index.ts)
-   **Update Endpoint**: `/v1/system/telemetry`
    -   Include `providerHealth` (from `ProviderHealthManager.getHealthStats()`)
    -   Include `mediaQueue` (from `LocalVideoService.getQueueStatus()`)
-   **New Endpoint**: `POST /v1/inbox/:agentId`
    -   Accepts `{ message, priority }`.
    -   Routes to `SystemBus.send(agentId, ...)` or specific Agent Inbox logic.

#### [MODIFY] [types.ts](file:///d:/Proyectos%20personales/Silhouette%20Agency%20OS%20-%20LLM/types.ts)
-   **Update SystemMetrics**: Add `providerHealth` and `mediaQueue` interfaces.


## Verification Plan

### Automated Tests
-   **Browser Verification**: Use `browser_subagent` to open the Localhost URL and verify:
    -   Dashboard loads without error.
    -   "Send Brief" button triggers a backend request.
    -   Circuit Breaker panels render correctly.

### Manual Verification
-   **Visual Check**: User to confirm "Rich Aesthetics" and animations.
-   **Functional Flow**: Send a task, watch the Agent "wake up" in IntrospectionHub, see the result in the Inbox.
