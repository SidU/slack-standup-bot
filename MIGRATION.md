# Migration Guide: Reimplementing the Stand-Up Bot with Teams AI Library v2

## Objectives
- Rebuild the Slack stand-up experience described in `PRD.md` as a Microsoft Teams bot using the Teams AI Library v2 for TypeScript.
- Achieve functional parity: stand-up orchestration, roster management, configurable summary channel, and structured recap delivery.
- Adopt Microsoft-first tooling (Bot Framework + Azure hosting) while leaving Slack-specific code behind—no data migration required.

## Prerequisites
- **Azure Bot registration:** Provision a Bot Channel Registration or Azure Bot resource and record the Microsoft App ID/Password.
- **Project scaffold:** `npm init -y`, then `npm install @microsoft/teams-ai botbuilder dotenv`, plus TypeScript tooling (`typescript`, `ts-node`, `eslint`, `prettier`).
- **Runtime target:** Node.js 18+, TypeScript 5+. Configure `tsconfig.json` for ES2022 modules.
- **Hosting & storage:** Choose Azure Functions, Azure App Service, or Azure Container Apps. For persistence use `MemoryStorage` (dev) and `CosmosDbPartitionedStorage` or Azure Table Storage for production.

## Core Teams AI Building Blocks
- `Application<TurnState>` – main bot container handling incoming activities.
- `TeamsAdapter` / `CloudAdapter` – bridges Teams channels to the application.
- `MemoryStorage`, `CosmosDbPartitionedStorage` – plug into `Application` for roster + channel persistence.
- `TurnContext`, `MessageFactory` – send prompts, replies, and proactive messages.
- `app.message(pattern, handler)` – register free-form text handlers.
- `app.command('commandName', handler)` – register slash-style commands (prefix with `!` or use mentions).
- `TeamsActivityHandler` compatibility – for lifecycle events like `onMembersAdded` if needed.
- `TeamsInfo.getMember`, `TeamsInfo.getTeamDetails` – resolve user profiles and team metadata.
- `adapter.continueConversationAsync(conversationReference, logic)` – send proactive summary posts.

## Implementation Phases & Feature Mapping

### Phase 1 – Project Setup
- Create `src/teams/index.ts` to bootstrap `CloudAdapter` with `ConfigurationServiceClientCredentialFactory` and wrap it in a `TeamsAdapter` from Teams AI.
- Instantiate `new Application<TurnState>({ storage, adapter, ... })` and export Express/Azure Functions handler that calls `app.run(context)`.
- Configure environment loading via `dotenv`.

### Phase 2 – Shared Domain Services
- Port stand-up coordination logic into plain TypeScript classes (`StandupManager`, `RosterStore`).
- Inject services into handlers via custom `TurnState` (extend with `application.setTurnStateFactory`).
- Provide persistence through `app.storage.set('roster', ...)` or custom storage keys using `state.conversation.storage.write()`.

### Phase 3 – Roster & Channel Commands
| PRD Capability | Teams AI API Usage |
| --- | --- |
| Join/leave team roster | `app.command('join', handler)` reads `context.activity.from.aadObjectId`, persists via storage API. |
| Remove teammate | `app.command('remove', handler)` parses `context.activity.entities` (mentions) to resolve target, uses `TeamsInfo.getMember`. |
| List roster | `app.message(/\b(members|team|participants)\b/i, handler)` replies with `MessageFactory.text`. |
| Configure summary channel | `app.command('report', handler)` inspects `context.activity.entities` for `channelId` from mentions; persist in storage. |
| Query summary channel | `app.command('where', handler)` fetches stored channel ID. |

### Phase 4 – Stand-Up Lifecycle
| Requirement | Teams AI API Usage |
| --- | --- |
| Start session | `app.command('start', handler)` verifies state, stores session object in `state.conversation` or `state.application`. |
| Prompt participants | Use `context.sendActivity` with mention `<at>` tags. Track iteration state via storage and `TeamsInfo.getMember`. |
| Capture responses | Register `app.message(/.*/, handler)` with guard checking `state.application.currentSession` and `context.activity.from.aadObjectId`. Use `TurnContext.activity.text` for message content; accumulate in session store. |
| Skip command | Additional `app.command('skip', handler)` to advance iterator. |
| End command | `app.command('end', handler)` toggles session flag and prompts via `MessageFactory.suggestedActions`. |
| Persistent session tracking | Store session data in `state.application.sessions[channelId]` using application storage APIs. |

### Phase 5 – Summary Generation & Delivery
| Requirement | Teams AI API Usage |
| --- | --- |
| Generate formatted summary | Internal service outputs Markdown or Adaptive Card JSON. Use `CardFactory.adaptiveCard` if adopting Adaptive Cards. |
| Deliver to configured channel | Acquire `ConversationReference` via `TurnContext.getConversationReference(context.activity)` and keep in storage. Use `adapter.continueConversationAsync(appId, conversationReference, async (ctx) => { await ctx.sendActivity(...); })`. |
| Paginate long summaries | Split content and loop sending multiple `ctx.sendActivity` calls appending `(n of m)`. |
| Error handling | Wrap summary upload in try/catch; log via `app.logger` or Application Insights SDK. |

### Phase 6 – Help & Guidance
- Register `app.command('help', handler)` returning Teams-specific instructions with `MessageFactory.text` (supports Markdown subset).
- Optionally, supply Adaptive Card quick reference using `CardFactory.adaptiveCard`.

## State & Persistence Strategy
- Use `state.application` scope for team-wide data (roster, summary channel, active session) keyed by `context.activity.conversation.id` or `teamId` from `context.activity.channelData`.
- Use `state.conversation` for transient per-thread prompts if needed.
- Storage APIs: `await state.saveChangesAsync()` to persist modifications at the end of handlers.

## Testing & Tooling
- Unit tests with Jest: mock Teams AI application handlers and domain services.
- Integration tests with Bot Framework `TestAdapter` to simulate commands and verify session state transitions.
- Configure GitHub Actions workflow running `npm run lint`, `npm test`, `npm run build`.

## Deployment Strategy
- Deploy via Azure Functions (HTTP trigger calling `app.run(context)`) or Express app on App Service.
- Register messaging endpoint (e.g., `https://<app>.azurewebsites.net/api/messages`).
- Validate in Teams using Teams Toolkit or Teams Developer Portal, install to a test team, and exercise start/end/skip flows.

## Open Considerations
- Adaptive Card design for summaries vs. Markdown messages; ensure multi-post handling within Teams limits (~28k characters per message).
- Proactive messaging permissions require storing and reusing conversation references; verify compliance policies.
- Plan backlog items (scheduling, custom questions) post-reimplementation.
