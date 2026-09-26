/**
 * Outbound project links: the GitHub repo and a "send feedback" link that
 * opens a pre-filled new-issue form there.
 *
 * The game has no backend, so feedback goes straight to GitHub Issues: the
 * player lands on github.com/.../issues/new with a title and body template
 * filled in, and submits it from their own account.
 */

/** Public source repository. */
export const GITHUB_REPO_URL = "https://github.com/andreasonny83/airport-simulator";

/**
 * Body template for a feedback issue. Plain Markdown: GitHub shows it in the
 * issue editor, where the player fills in the blanks before submitting.
 * Browser details help reproduce rendering bugs (WebGL varies a lot between
 * devices); nothing is sent until the player submits the form themselves.
 */
export function feedbackIssueBody(): string {
  return [
    "### What happened?",
    "",
    "",
    "### What did you expect?",
    "",
    "",
    "---",
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
  ].join("\n");
}

/**
 * GitHub "new issue" URL with the title, body and `feedback` label filled
 * in. Built on click (not at load) so the screen size is current. GitHub
 * ignores the label for players without triage rights, which is harmless.
 */
export function feedbackIssueUrl(): string {
  const params = new URLSearchParams({
    title: "Feedback: ",
    body: feedbackIssueBody(),
    labels: "feedback",
  });
  return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`;
}
