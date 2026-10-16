---
title: Performance feedback and reviews
description: Giving feedback with the SBI model, writing reviews, handling underperformance with an improvement plan, documenting and recognising good work.
type: guide
tags:
  - management
  - leadership
  - team-process
  - career
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Feedback is the main tool an EM has for changing behaviour and building trust. For infrastructure teams it matters more than usual, because mistakes (a missed approval, a risky change, a quiet failure to hand over) can be costly and the best habits are invisible when they work. This note covers day-to-day feedback, formal reviews, and the harder case of sustained underperformance.

## Regular feedback

Give feedback close to the event, in private for corrective feedback and in public for praise (when the person is comfortable with that). Waiting for a review means the person learns months after the moment, and the review contains surprises. The rule: nothing in a formal review should be news.

### The SBI model

Situation, Behaviour, Impact. Describe what happened and its effect without judging the person.

- **Situation**: when and where. "In yesterday's change to the shared VPC module..."
- **Behaviour**: what you saw or heard, not interpretations. "...you merged without waiting for the second approval."
- **Impact**: what it caused, for the team or for you. "That bypassed the check we agreed on after the November outage, and the rest of the team now sees the rule as optional."

Then ask: "How did you see it?" and listen. Agree what happens next.

Weak: "You are careless with production."
Better: "On Tuesday you ran `terraform apply` from your laptop on the staging state without a plan review. It worked, but if it had changed the load balancer it would have caused an outage. Can we talk about how you decide when a change needs a second pair of eyes?"

Positive feedback uses the same shape: "In Thursday's incident you posted a status update every ten minutes (behaviour). Support could answer customers without pinging us (impact). Thank you."

> [!tip] Check the facts first
> Before giving corrective feedback, confirm the evidence: the commit, the log, the ticket. Do not rely on a second-hand account.

### Practical habits

- Aim for specific and timely. "Good job" teaches nothing.
- Give feedback on the work and the behaviour, not the person's character.
- Mix directions. Feedback upward to you is just as valuable; ask for it in [[one-on-ones]] and act on it.
- Keep a private log of what you said and when. It becomes the raw material for the review.
- After a major incident, give feedback separately from the postmortem, which stays blameless ([[blameless-postmortems]]). Postmortems examine systems; coaching on individual behaviour happens privately and rarely arises from them.

## Feedback versus review cycles

| Aspect         | Regular feedback            | Review cycle                                                |
| -------------- | --------------------------- | ----------------------------------------------------------- |
| Frequency      | Weekly, as events occur     | Once or twice a year                                        |
| Purpose        | Adjust behaviour now        | Summarise, calibrate, set direction, feed promotion and pay |
| Content        | Specific incidents and work | Patterns over the whole period                              |
| Surprise level | None                        | None                                                        |
| Written        | Rarely                      | Always                                                      |

A review is a summary of what the person has already heard, set against the expectations of their level ([[career-ladder-devops]]).

## Writing performance reviews

1. **Gather evidence for the whole period**: merged work, incident involvement, on-call, 1:1 notes, peer comments, goals set at the start. Do not rely on the last six weeks.
2. **Structure it by the ladder's dimensions**: technical scope, operational ownership, influence, communication. Rate against the level, not against peers.
3. **Use specifics.** "Migrated 14 pipelines to the shared template, cutting median build time from 18 to 11 minutes" beats "great delivery".
4. **Include the impact on others.** Platform work is often valued through what it enables. Ask the teams that depend on it.
5. **Cover gaps with the same specificity.** Name the pattern, not one bad day, and say what better looks like.
6. **Avoid recency, halo and similarity bias.** Read your notes backwards, from the oldest entry.
7. **Be careful with language.** Replace "aggressive" or "not a team player" with the behaviour. Check whether you use different words for different people.
8. **Close with next-period goals**: two or three outcomes, one growth item, and what you will do to support them.

A short template:

```markdown title="performance-review.md"
## Performance review: <name>, <role>, <level>, <review period>

### Summary

<Two to three sentences: overall assessment against the level.>

### Assessment by ladder dimension

Repeat for technical scope, operational ownership, influence and leadership, and communication.

#### <dimension>

- <yyyy-mm-dd>: <example and its impact> (<link>)
- Assessment against level: <below / meets / exceeds>, because <reason>

### Strengths to keep

- <strength, with an example>

### Areas to grow

- <area>: next step <one concrete action, by when>

### Goals for next period

1. <measurable goal>

### Employee comments

<Their view, in their words.>
```

Share the draft with the person in conversation first, then in writing. Allow them to add their own view; their self-review is data.

Consider how glue work is counted: documentation, on-call improvements, mentoring and toil reduction are often undervalued and disproportionately done by some people. Name it and weigh it.

## Handling underperformance

Underperformance is a gap between expected and actual results at a level, sustained over time. First diagnose; do not jump to a plan.

**Diagnose**

- Is the expectation clear and written down? Does the person know?
- Do they have the context, access and tools?
- Is it skill, will, or circumstance (health, personal life, on-call exhaustion, unclear priorities)? See [[on-call-health]] before assuming a motivation problem.
- Is the problem the team's system (unclear ownership, [[delegation-and-ownership]] gaps)?

**Conversation**

Be direct and kind. State the expectation, the evidence in SBI form, and the impact. Ask for their view. Agree on a follow-up date. Many cases end here, with a change.

**Improvement plan**

If the pattern continues, write a plan with HR involved where your company requires it. A good plan contains:

```markdown title="improvement-plan.md"
## Improvement plan: <name>, <role>, <dates>

### Concern

Specific behaviours or results versus the expectations of the level, with 2-3 dated examples.

### Expected standard

What good looks like, in observable terms.
Example: "Every production change has a reviewed plan, a rollback step and a verification note in the MR."

### Support

- Weekly 1:1 focused on the plan
- Pairing with <buddy> on <topic>
- Training / time allocated: <detail>

### Measures and checkpoints

| Date     | Measure                 | Target                                     |
| -------- | ----------------------- | ------------------------------------------ |
| +2 weeks | Change records complete | 100% of MRs                                |
| +4 weeks | On-call handover notes  | Written for every shift                    |
| +6 weeks | Review                  | Decide: close, extend or move to next step |

### Consequences

What happens if the standard is not met, in plain words and as per company policy.
```

Keep the period short enough to matter (commonly four to eight weeks, subject to your policy and local law), review weekly in writing, and record the outcomes. The plan must be achievable; setting a bar that cannot be met is not a plan, it is a process to exit someone.

> [!warning] Follow your HR process
> Employment law differs by country. Involve HR before any formal plan or termination discussion and do not promise outcomes.

## Documenting

- Write facts: date, event, evidence, what was said, what was agreed. Leave out guesses about motives.
- Store notes in a system with restricted access. The person can generally request records about them, so write what you would be comfortable to show.
- Send a short written summary after each formal conversation and ask for corrections.
- Keep positive documentation too. The record should reflect the whole person.

## Recognising good work

- Be specific and fast. Praise the behaviour you want repeated: "You wrote the rollback section before anyone asked."
- Make invisible work visible: thank the person who deleted 40 alerts, wrote the runbook or reviewed a difficult MR.
- Recognise publicly in team channels and in your reports to stakeholders ([[stakeholder-communication]]).
- Use the promotion process for sustained impact, not as the only way to say thank you.
- Ask what each person values: public credit, a stretch task, time off after a heavy on-call week.

## Related

- [[managing-conflict]] for when feedback turns into disagreement.
- [[first-90-days-as-em]] for when to start giving feedback to a team you have just inherited.
