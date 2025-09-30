import { RosterMember, StandupConversationState, StandupSessionState } from '../state.js';
import { STANDUP_QUESTIONS } from './standupManager.js';

const MAX_MESSAGE_LENGTH = 4000;

export class SummaryFormatter {
  public buildSummaryPages(
    state: StandupConversationState,
    session: StandupSessionState,
  ): { title: string; content: string }[] {
    const participants = session.order.map((id) => state.roster[id]).filter(Boolean) as RosterMember[];

    const sections = participants.map((member) => {
      const participantState = session.responses[member.id];
      const title = `## Status for ${member.name} ##`;

      if (!participantState || participantState.skipped) {
        return `${title}\n_(Skipped)_\n`;
      }

      const answers = participantState.answers.map((answer) => this.normalizeAnswer(answer));
      const bodyLines = STANDUP_QUESTIONS.map((question, index) => {
        const response = answers[index] ?? '_No response_';
        return `**${question.prompt}**\n${response}`;
      });

      return `${title}\n${bodyLines.join('\n\n')}\n`;
    });

    const reportDate = new Date(session.startedAt).toISOString().slice(0, 10);
    const summaryTitle = `Standup for ${reportDate}`;

    const pages: { title: string; content: string }[] = [];
    let currentContent = '';

    for (const section of sections) {
      if (!section.trim()) {
        continue;
      }

      const prospective = currentContent ? `${currentContent}\n\n${section}` : section;
      if (prospective.length > MAX_MESSAGE_LENGTH && currentContent) {
        pages.push({
          title: summaryTitle,
          content: currentContent.trim(),
        });
        currentContent = section;
      } else {
        currentContent = prospective;
      }
    }

    if (currentContent.trim()) {
      pages.push({
        title: summaryTitle,
        content: currentContent.trim(),
      });
    }

    const totalPages = pages.length || 1;
    return pages.map((page, index) => ({
      title: `${page.title} (${index + 1} of ${totalPages})`,
      content: page.content,
    }));
  }

  private normalizeAnswer(answer: string): string {
    if (!answer.trim()) {
      return '_No response_';
    }

    return answer.replace(/\r?\n/g, '\n\n').trim();
  }
}
