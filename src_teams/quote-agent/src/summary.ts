import { STANDUP_QUESTIONS, StandupSession } from './types';

const SUMMARY_CHARACTER_LIMIT = 3900;

export function buildStandupSummaryMessages(session: StandupSession): string[] {
  const headerTitle = `Stand-up for ${new Date(session.startedAt).toISOString().slice(0, 10)}`;
  const intro = `# ${headerTitle}\nStarted by ${session.startedByName}`;
  const sections = session.participants.map((participant) => {
    const responses = session.responses[participant.userId];
    if (!responses && !session.skipped.includes(participant.userId)) {
      return `## Status for ${participant.name}\n_(No response collected)_`;
    }
    if (session.skipped.includes(participant.userId)) {
      return `## Status for ${participant.name}\n_(Skipped today)_`;
    }
    return `## Status for ${participant.name}\n**${STANDUP_QUESTIONS[0]}**\n${formatResponse(responses?.updates)}\n\n**${STANDUP_QUESTIONS[1]}**\n${formatResponse(responses?.current)}\n\n**${STANDUP_QUESTIONS[2]}**\n${formatResponse(responses?.blockers)}`;
  }).filter((section) => section.trim().length > 0);

  const body = [intro, ...sections].join('\n\n');
  return splitSummary(body, headerTitle);
}

function formatResponse(response?: string): string {
  if (!response || !response.trim()) {
    return '_No response provided_';
  }
  return response.trim();
}

function splitSummary(content: string, headerTitle: string): string[] {
  if (content.length <= SUMMARY_CHARACTER_LIMIT) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= SUMMARY_CHARACTER_LIMIT) {
      chunks.push(remaining.trimEnd());
      break;
    }

    const slice = remaining.slice(0, SUMMARY_CHARACTER_LIMIT);
    const splitIndex = findSplitPoint(slice);
    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.map((chunk, index) => {
    if (index === 0) {
      return `${chunk}\n\n(${index + 1} of ${chunks.length})`;
    }
    const suffix = ` (${index + 1} of ${chunks.length})`;
    return `# ${headerTitle}${suffix}\n\n${chunk}`;
  });
}

function findSplitPoint(chunk: string): number {
  const newlineIndex = chunk.lastIndexOf('\n\n');
  if (newlineIndex > 200) {
    return newlineIndex + 2;
  }
  const fallbackNewline = chunk.lastIndexOf('\n');
  if (fallbackNewline > 200) {
    return fallbackNewline + 1;
  }
  return chunk.length;
}
