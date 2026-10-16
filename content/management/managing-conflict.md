---
title: Managing conflict
description: Handling disagreement in technical teams, from tooling wars and design disputes to Dev versus Ops friction, using disagree-and-commit, escalation, ADRs and mediation.
type: guide
tags:
  - management
  - leadership
  - team-process
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Disagreement about technical matters is healthy and necessary. Unmanaged disagreement turns into stalled decisions, quiet resentment and people leaving. As a lead, your job is not to make conflict vanish but to keep it about the problem, get decisions made, and notice when it has become personal.

## Tell the types apart

Different conflicts need different tools.

| Type                | Example                                             | Typical cause                              | Main tool                            |
| ------------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| Tooling war         | Jenkins versus GitLab CI, Terraform versus OpenTofu | Identity, sunk cost, uneven information    | Criteria-based comparison, ADR       |
| Design dispute      | Single cluster or per-team clusters                 | Different priorities, unstated constraints | Written proposal, decision owner     |
| Cross-team friction | Dev wants speed, Ops wants stability                | Different incentives and pain              | Shared goals, SLOs, interaction mode |
| Interpersonal       | Two engineers who cannot work together              | Style, past events, perceived disrespect   | Private conversations, mediation     |
| Resource conflict   | Two teams need the same people                      | Scarcity                                   | Prioritisation with a named owner    |

Ask early which kind it is. A "technical" argument that keeps repeating with sharper words is often interpersonal underneath.

## Technical disagreements

### Make the disagreement explicit and about criteria

1. **State the decision to be made** in one sentence, and who owns it.
2. **List the criteria** the answer must meet: cost, reliability, migration effort, team skills, security, time. Agree these before discussing options.
3. **Write the options** with an honest summary of each, ideally by someone who prefers a different one. The test: can each side describe the other's position so that the other agrees?
4. **Run an experiment** when facts are missing. A one-week spike is cheaper than a month of debate.
5. **Time-box the discussion.** Set a decision date.

For a worked example of a comparison with explicit criteria, see [[argocd-vs-flux]], and for the resulting record, [[0001-gitops-with-argocd]]. Similar comparisons: [[gitlab-ci-vs-jenkins]], [[terraform-vs-opentofu]], [[helm-vs-kustomize]].

### Have a decision owner

Many disputes drag on because nobody knows who decides. Before the debate starts, name one person (or a small group) who decides after hearing everyone. Typical rules:

- The team that **runs and supports** the thing decides, after consulting those affected.
- For cross-team decisions, the owner of the shared platform or the architect group decides within agreed guardrails.
- If ownership is itself in dispute, that is an escalation to the manager, not a technical question.

### Disagree and commit

When the owner has decided, everyone acts on it, including those who argued against it. Make it work:

- The owner states the decision, the reasoning and the dissent heard. People accept a loss more easily when they see that their argument was understood.
- Commit means supporting the decision in public and in effort. It does not mean agreeing in private or pretending.
- Record **what would make us revisit it**: a metric, a date, an incident. "We will review after the pilot in March" gives the dissenters a path.
- Do not relitigate without new evidence. If someone brings new facts, reopen cleanly through the ADR process.
- Leaders need to commit visibly too, especially when they disagreed.

## Use ADRs to settle decisions

An architecture decision record turns a debate into an artefact. It records context, options, the decision and consequences, so later arguments start from the same facts. See [[adr/index|ADRs]] for the process and the template, and [[0001-gitops-with-argocd]] for an accepted example.

How ADRs help with conflict:

- They force **written reasoning,** which exposes weak arguments on all sides.
- They separate the **proposal** from the person. Comments go on the document.
- They create a clear status (proposed, accepted, superseded) so that "is this decided?" has an answer.
- The "consequences" section records the accepted downsides, which gives losing parties credit for having been right about the risks.
- To change a decision, someone writes a new ADR, which is the legitimate way to disagree after the fact.

Keep ADRs for decisions that are costly to reverse. For day-to-day choices, a comment on the merge request with the standard from [[code-review]] is enough.

## Dev versus Ops friction

The classic conflict has a structural cause: developers are rewarded for change and operations for stability. Blaming individuals does not help.

- **Share the goal.** Agree SLOs and an error budget. When the budget is healthy, ship faster; when it is spent, reliability work takes priority. See [[slo-burn-rate-alerting]].
- **Share the pain.** Developers take part in on-call for their services, with support from the platform team, see [[on-call-health]].
- **Be clear about interaction modes.** Is the platform team collaborating, providing a service or coaching? See [[platform-team-operating-model]].
- **Make the paved road easy,** so that the safe path is also the quick one.
- **Agree on a change process** that scales with risk, see [[production-change-checklist]]. Heavy approval for everything breeds workarounds.
- **Blameless reviews** after incidents, see [[blameless-postmortems]], keep the conversation about the system.
- **Meet in person** (or on video) when a thread has gone past a few replies. Text hardens positions.

## Escalation

Escalate when: the decision owner is unclear, the same issue has been discussed three times without a decision, a deadline is at risk, or one party refuses to engage.

1. **Talk to the other party first** and tell them you intend to escalate if you cannot agree.
2. **Escalate with a summary, not a complaint:** the decision needed, the options, each side's argument, the deadline and the recommended outcome. Both sides should be able to read the summary and agree it is fair.
3. **Go to the lowest level that can decide,** usually the two managers together.
4. **Accept the outcome** and move on. See [[stakeholder-communication]] for the summary format.

Escalation is a normal tool, not a failure. Escalating around someone without telling them is what damages trust.

## Mediating interpersonal conflict

When two engineers are in conflict, your role is to be a fair, neutral third party who wants both of them to succeed.

1. **Listen separately first.** Ask each person what happened, what impact it had on them, and what they want. Do not promise secrecy for anything that breaches policy, and say so at the start.
2. **Separate behaviour from judgement.** "In the review you wrote X" is something to work with. "He is arrogant" is not.
3. **Check your own bias.** Do you like one of them more?
4. **Bring them together** when each is ready, with a clear structure: each speaks without interruption, each restates the other's view, then agree one or two concrete changes (how reviews are written, who decides what).
5. **Agree follow-ups** and check in after a week and after a month.
6. **Document lightly** what was agreed.
7. **Know the limits.** Harassment, discrimination, bullying or safety issues are not mediated. Follow company policy and involve HR. Ongoing patterns of behaviour are a performance matter, see [[performance-feedback]].

Useful phrases:

```text title="Phrases for the conversation"
"Help me understand what you were trying to achieve."
"What would a good outcome look like for you?"
"I hear that X mattered to you. Here is the constraint I am working within."
"I'd like us to decide by Friday. Who needs to be in the room?"
"We disagree, and that is fine. What would change your mind?"
```

## Preventing conflict

- Clear ownership and decision rights, written down. See [[delegation-and-ownership]].
- Regular one-on-ones that surface tension early, see [[one-on-ones]].
- Review norms agreed by the team: tone, response time, how to disagree in a review.
- Praise in public, give difficult feedback in private.
- Rotate responsibilities so that no one owns a grievance alone.
