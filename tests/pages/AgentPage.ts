import { expect, type Page } from '@playwright/test';

// The agent's drafted reply on a ticket, and the admin page that runs the agent.
export class AgentPage {
  constructor(private readonly page: Page) {}

  private panel() {
    return this.page.getByRole('region', { name: 'Drafted reply from the service desk agent' });
  }

  async expectProposalShown(reply: string): Promise<void> {
    await expect(this.panel()).toBeVisible();
    await expect(this.panel().getByTestId('proposal-reply')).toHaveValue(reply);
    await expect(this.panel().getByText('AI-generated', { exact: true })).toBeVisible();
  }

  async expectNoProposal(): Promise<void> {
    await expect(this.page.getByTestId('proposal-reply')).toHaveCount(0);
    await expect(this.page.getByText('Drafted reply from the service desk agent')).toHaveCount(0);
  }

  async editReply(text: string): Promise<void> {
    await this.panel().getByTestId('proposal-reply').fill(text);
  }

  async approve(): Promise<void> {
    await this.panel()
      .getByRole('button', { name: /^Approve/ })
      .click();
  }

  async reject(reason?: string): Promise<void> {
    await this.panel().getByRole('button', { name: 'Reject' }).click();
    if (reason) await this.panel().getByLabel(/Why\?/).fill(reason);
    await this.panel().getByRole('button', { name: 'Confirm rejection' }).click();
  }

  async expectDecision(text: string): Promise<void> {
    await expect(this.panel().getByText(text)).toBeVisible();
    await expect(this.page.getByTestId('proposal-reply')).toHaveCount(0);
  }

  async expectAiComment(text: string, approver?: string): Promise<void> {
    const comment = this.page.getByTestId('comment').filter({ hasText: text });
    await expect(comment).toBeVisible();
    await expect(comment).toContainText('AI-generated');
    if (approver) await expect(comment).toContainText(`approved by ${approver}`);
  }

  async gotoAdmin(): Promise<void> {
    await this.page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Agent' })
      .click();
    await expect(this.page.getByRole('heading', { name: 'Service desk agent' })).toBeVisible();
  }
}
