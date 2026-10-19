---
title: Platform product discovery before building
description: How a platform team validates a developer problem with interviews, assumptions and a paper golden path before committing engineering time.
type: guide
tags:
  - management
  - leadership
  - team-process
  - delivery
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Platform teams fail more often by building the wrong thing well than by building the right thing badly. A new deployment abstraction, a self-service portal or a custom CLI takes months, and if developers did not need it, the cost is the months plus the support burden of something nobody asked for. Discovery is the cheap phase before that: a few weeks of conversations, a written list of assumptions and a paper prototype, ending in a documented decision to build, pivot or stop.

> [!info] Scope
> [[platform-team-operating-model]] covers how requests arrive (intake), how golden paths are owned and how the team is organised. This note covers what happens before an idea is allowed onto the roadmap: how you decide that a developer problem is real, common and worth solving. Roadmap placement is in [[platform-roadmap-multi-quarter]]; sizing and ordering are in [[planning-and-prioritization]].

## Discovery versus delivery

Delivery answers "can we build it?". Discovery answers "should we, and for whom?". The outputs differ.

| Aspect       | Discovery                                    | Delivery                              |
| ------------ | -------------------------------------------- | ------------------------------------- |
| Question     | Is the problem real, frequent and costly?    | Does the solution work reliably?      |
| Output       | Evidence, a decision, a one-pager            | Running software, docs, support model |
| Time box     | Two to four weeks, written down at the start | Sized in the roadmap                  |
| Team         | One or two engineers and a lead              | Whole squad                           |
| Failure mode | Endless research with no decision            | Shipping something nobody adopts      |

Keep discovery small. It is not a design phase for a big solution; it is a test of whether a problem deserves one.

## Writing the problem statement

Start from a problem written in the developers' terms, not a solution in yours. Compare:

- Solution-shaped: "We need a preview environment portal."
- Problem-shaped: "Reviewers cannot see a running change before merge, so UI and integration defects are found on shared staging, where they block other teams."

A usable statement has four parts: who has the problem, what they are trying to do, what gets in the way, and how you would know it is fixed. Write it in one paragraph and put a metric on the last part, for example "time from opening a merge request to a reviewable running instance". Pick metrics you can measure today; see [[dora-metrics]] for the delivery measures that platform work most often moves.

## Interview plan

Five to eight developers per problem is enough to see repeating patterns. Pick across teams, seniority and stack, and include at least one person who has built a workaround, because workarounds are the strongest evidence of a real problem. Do not interview only the people who already complain to you; that is how you build for the loudest team.

Practicalities:

- 30 minutes each, two interviewers (one asks, one takes notes), recorded only with consent.
- Ask about the last time something happened, not what they would like in general. Past behaviour is evidence; opinions about hypothetical features are not.
- Do not demo a solution in the first interview. You will get politeness instead of information.
- Write notes within the same day, in a shared table, using the developer's words.

```text title="interview-guide.txt"
Opening (2 min)
  Thank you. I want to understand how you work today. There are no
  right answers, and nothing you say is a performance signal.

Context (5 min)
  - Tell me about the service you worked on most recently.
  - Walk me through the last change you shipped, from first commit
    to running in production.

The specific job (10 min)
  - Think of the last time you needed to <see a change running before
    merge>. What did you do? What happened next?
  - What did you try first? What made you stop or change approach?
  - Who else was involved? How long did the whole thing take?
  - Was there a workaround, a script or a document you used? May I see it?

Cost and frequency (5 min)
  - How often does this come up in a typical month?
  - The last time, what did it cost you, in time or in other work
    you delayed?
  - What happens if you simply do not do it?

Current alternatives (5 min)
  - What do other people on your team do about this?
  - Have you looked at anything we provide for it? What did you
    think of it?

Closing (3 min)
  - Who else should I talk to about this?
  - Is there anything I did not ask that I should have?
```

Avoid leading questions such as "Wouldn't it be better if you could...?" or "Would you use a portal that...?". They invite a yes. Replace them with "How do you handle X today?" and "What would you do if that option were not there?".

## Assumptions register

Every proposal rests on beliefs. Write them down and rank them by risk: how bad is it if the belief is false, and how little do we know. Test the riskiest first, cheaply.

| Assumption                                       | Risk   | Test                                           | Evidence needed                             | Result  |
| ------------------------------------------------ | ------ | ---------------------------------------------- | ------------------------------------------- | ------- |
| Developers wait for a reviewable environment     | High   | Interviews; look at merge-request cycle times  | Most interviewees describe a recent delay   | Pending |
| A shared namespace per MR is acceptable to teams | High   | Paper golden path walk-through with two teams  | Two teams agree to pilot                    | Pending |
| Cost per environment stays within the budget     | Medium | Estimate from node cost allocation (FinOps)    | Estimate under the agreed ceiling           | Pending |
| Security accepts ephemeral environments          | Medium | Review with the security team                  | Written agreement on data and network rules | Pending |
| We can run it with the current team size         | Medium | Count on-call and support load in the estimate | Support estimate within the toil budget     | Pending |

For cost assumptions link to [[finops-cost-allocation-and-guardrails]] rather than inventing numbers. For support load, compare with [[toil-budget]].

## Paper golden path and prototype

Before writing code, write the golden path as the developer would experience it, step by step, in a document. If the developer has to learn five new concepts, you will see it on paper.

```markdown title="paper-golden-path.md"
## Preview environment: developer journey (draft)

1. Developer opens a merge request.
2. The pipeline builds the image and posts a comment with a URL.
3. Reviewer opens the URL, reviews the running change.
4. The environment is removed when the merge request is closed.

Open questions: data seeding, secrets, cost cap, cleanup of failed deploys.
Things the developer must NOT need to know: cluster names, namespaces,
Helm values, DNS records.
```

Then walk two or three developers through it, with a cardboard prototype: a mocked pipeline comment or a hand-created namespace for one real merge request. A manual "concierge" run, where an engineer does by hand what the automation would do, is often enough to learn whether people use the result.

## Evidence threshold and kill criteria

Decide before you start what evidence is enough, and write a kill date for each bet. Without that, discovery drifts.

- **Go** when the problem appears in most interviews, costs measurable time and an alternative does not already exist, and the riskiest assumptions are tested.
- **Pivot** when the problem is real but the solution assumption fails; re-run a shorter round with the new framing.
- **Stop** when the problem is rare, cheap or already solved. A documented "no" is a result, not a failure.

Example criteria for the preview environment bet: "Kill on 2026-11-30 if fewer than half the interviewed developers describe a delay in the last month, or if two pilot teams decline to try a manual concierge run." The date and the thresholds are the team's; the point is that they exist in writing before the first interview.

## Reporting the result

One page, in a fixed template, stored next to the roadmap so it can be found later.

```markdown title="discovery-one-pager.md"
## Discovery: <name>

**Decision:** Build / Pivot / Stop
**Date:** <date> **Owner:** <name>

**Problem:** <who, what they try to do, what blocks them>
**Evidence:** <number of interviews, key quotes, data used>
**Assumptions tested:** <table, with results>
**What we would build:** <smallest first step, not the full vision>
**What we would not build:** <explicit exclusions>
**Cost and support estimate:** <people-weeks, run cost method, toil impact>
**Risks and open questions:** <list>
**Next step and date:** <roadmap item or closure>
```

The rule: discovery output becomes either a roadmap item or a documented "no". It never silently disappears. Share the "no" with the people you interviewed, so they see that their time had an effect; this protects the next round of interviews. Use the style in [[stakeholder-communication]] for the message.

## Worked example: self-service preview environments on GKE

Problem: product teams share a single staging cluster, and changes from several teams wait in the same queue. Three interviews in, the pattern is clear: developers either merge to staging to see a change running, or skip the check.

- **Assumptions to test first:** reviewers will actually open the URL, and per-merge-request environments cost less than the delay they remove.
- **Cheap tests:** create a namespace by hand for two merge requests, post the URL in the review, and count how many reviewers open it; estimate cost from the node pool cost allocation labels.
- **Paper path:** the four-step journey above, reviewed with security for data and network boundaries, and with the platform on-call for cleanup failure handling.
- **Decision:** the pilot shows reviewers opening the URL in most cases, and cost fits the ceiling. Result: a roadmap item with a first step of one namespace per merge request on a dedicated node pool, with automatic cleanup, and an explicit exclusion of production-like data. Roadmap placement is covered in [[platform-roadmap-multi-quarter]].

## Failure modes

- **Building for the loudest team.** One senior team asks for a feature, and it becomes the platform. Check that the problem appears across teams before building.
- **Solution looking for a problem.** The team is excited about a technology and then searches for a justification. Start from interviews, not from the tool. For tooling choices see [[build-vs-buy-devops-tools]].
- **Leading interviews.** People say yes to proposals. Ask about past behaviour.
- **Endless discovery.** No kill date, no decision. Time-box it.
- **Discovery as a gate for everything.** Small fixes and operational work do not need it. Reserve discovery for bets that cost more than a few engineer-weeks, and for work that adds a new abstraction developers must learn.
- **Ignoring inner source.** Sometimes the best answer is to let a team build it and contribute it; see [[inner-source-platform]].

## Sources

- [Team Topologies](https://teamtopologies.com/): interaction modes between platform and stream-aligned teams. Check the current material on the site.

## Related

- [[platform-team-operating-model]]
- [[platform-roadmap-multi-quarter]]
- [[planning-and-prioritization]]
- [[inner-source-platform]]
- [[build-vs-buy-devops-tools]]
