# Slack Stand-Up Bot PRD

## Product Summary
- Deploy a Slack bot that automates daily stand-ups by prompting teammates, capturing answers, and publishing structured summaries in a configurable channel.
- Persist roster membership and summary-channel settings so behavior is consistent across sessions and redeployments.

## Objectives & Success Metrics
- Cut manual coordination time for distributed teams by handling the three standard stand-up questions.
- Achieve a 90% completion rate of member check-ins per initiated stand-up.
- Post summaries within 60 seconds of the final response while keeping upload failures below 2% weekly.

## Primary Users & Use Cases
- **Stand-up Facilitator:** Starts/ends stand-ups, configures report destination, monitors completion status.
- **Team Member:** Joins the roster, answers prompts, skips when unavailable.
- **Stakeholder:** Consumes the summary posts in the selected channel.

## Assumptions & Dependencies
- Workspace provides Slack RTM bot access via `SLACK_API_TOKEN` and has invited the bot into relevant channels.
- Redis instance reachable via `REDIS_URL` stores roster IDs and summary channel metadata.
- Runtime aligns with Node.js 0.12.x; linting/testing use Mocha, Chai, Sinon, JSHint, and JSCS.

## Scope
- **In scope:** stand-up orchestration, roster CRUD, summary channel configuration, Slack post summaries, help command.
- **Out of scope:** scheduling/automation, calendar integration, analytics dashboards, custom question definitions.

## User Stories
1. As a facilitator, I can start a stand-up in-channel so participants are prompted sequentially.
2. As a participant, I receive the three stand-up questions and answer without re-invoking the bot.
3. As a participant, I can skip my turn if I am unavailable.
4. As a facilitator, I can end a stand-up early and decide whether to publish the summary.
5. As a facilitator, I can set or query the channel where summaries are posted.
6. As a team member, I can join, leave, or remove others from the roster and list current members.
7. As any user, I can request help and view the command catalog.
8. As a stakeholder, I receive a structured summary post in the configured channel, split if content exceeds Slack limits.

## Functional Requirements
### Stand-Up Lifecycle
- `@bot start` validates no stand-up is active, ensures at least one roster member, defaults summary channel to the current channel if unset, announces the start, and iterates through roster members alphabetically.
- Bot prompts each participant (`<@user> are you ready?`) and only accepts readiness keywords (yes/ok variants) from the targeted user before opening a threaded conversation.
- Conversation captures multi-line responses to: “What have you done since the last standup?”, “What are you working on now?”, and “Anything in your way?”, storing content alongside user metadata.
- Any user can send `skip` or `no` while a participant is queued to move on without collecting answers.
- After every member responds or is skipped, the bot celebrates in-channel and triggers summary generation.
- `@bot end` halts the session, resets state, and prompts the issuing user to confirm summary publication; declining clears collected statuses without uploading.

### Summary Reporting
- Compile Markdown sections per participant (`##Status for Name##`) with bolded questions and double-spaced responses for readability.
- Create Slack posts via `files.upload` directed to the persisted summary channel; paginate into `Standup for YYYY-MM-DD (n of m)` when exceeding 4k characters.
- On upload failure, notify the stand-up channel of the issue and still clear cached statuses.

### Channel Configuration
- `@bot report in|to #channel` parses channel mentions; unknown formats fall back to the current channel with clarification. Persist the selection in Redis.
- `@bot where do you report?` returns the configured summary channel or guidance when none is set.

### Team Roster Management
- `@bot join` adds the invoking user if absent and confirms enrollment.
- `@bot leave`/`quit` removes the invoker; respond politely if they were not on the roster.
- `@bot remove @user` or plain username removes another member by Slack ID or display name with appropriate feedback.
- `@bot members`/`team`/`participants` lists the roster comma-separated or notes when empty.
- Persist roster IDs in Redis, hydrate full user profiles on startup, and clone the list during iteration so mid-stand-up mutations do not affect ordering.

### Help & Messaging
- `@bot help` responds with a friendly summary of available commands and behavior.
- Maintain a light, supportive tone with emoji reinforcement, ensuring copy matches current command set.

## Error Handling
- Log unexpected Redis or Slack API failures server-side. User-facing replies encourage retry without revealing stack traces.
- Prevent duplicate stand-ups, handle lifecycle commands gracefully when no session is active, and avoid silent failures.

## Open Questions
- Should scheduled automatic stand-up starts or reminders be supported?
- Do teams need customizable stand-up questions per channel?
- How should skipped users be represented in summaries for stakeholders?
